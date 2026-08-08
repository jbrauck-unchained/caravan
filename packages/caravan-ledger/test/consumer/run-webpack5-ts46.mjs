import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureTemplate = fileURLToPath(
  new URL("./webpack5-ts46/", import.meta.url),
);
const DEFAULT_NPM_TIMEOUT_MS = 30_000;
const DEFAULT_CLEAN_INSTALL_TIMEOUT_MS = 120_000;
const EXPECTED_NODE_MAJOR = 24;
const EXPECTED_NPM_VERSION = "11.14.1";
const BUNDLE_METRIC_FIELDS = [
  "brotliBytes",
  "gzipBytes",
  "moduleCount",
  "uncompressedBytes",
];
const observedSideEffects = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertExact(actual, expected, label) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  assert(
    JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected),
    `${label} changed. Expected ${JSON.stringify(normalizedExpected)}, received ${JSON.stringify(normalizedActual)}.`,
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readTimeout(name, fallback) {
  const configured = process.env[name];
  if (configured === undefined) return fallback;
  const timeout = Number(configured);
  assert(
    Number.isSafeInteger(timeout) && timeout >= 1_000 && timeout <= 600_000,
    `${name} must be an integer between 1000 and 600000 milliseconds.`,
  );
  return timeout;
}

const npmTimeoutMs = readTimeout(
  "CARAVAN_LEDGER_CONSUMER_NPM_TIMEOUT_MS",
  DEFAULT_NPM_TIMEOUT_MS,
);
const cleanInstallTimeoutMs = readTimeout(
  "CARAVAN_LEDGER_CONSUMER_INSTALL_TIMEOUT_MS",
  DEFAULT_CLEAN_INSTALL_TIMEOUT_MS,
);

function reportStage(message) {
  process.stderr.write(`[consumer:webpack5-ts46] ${message}\n`);
}

function withTimeout(promise, timeout, label) {
  let timeoutId;
  const deadline = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeout} ms.`)),
      timeout,
    );
  });
  return Promise.race([promise, deadline]).finally(() =>
    clearTimeout(timeoutId),
  );
}

function runNpm(arguments_, cwd, options = {}) {
  const { env, timeout = npmTimeoutMs, ...execOptions } = options;
  return execFileSync("npm", arguments_, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_PATH: "",
      npm_config_audit: "false",
      npm_config_cache: npmCache,
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
      ...env,
    },
    maxBuffer: 10 * 1024 * 1024,
    timeout,
    ...execOptions,
  });
}

function runCleanInstall(fixtureRoot) {
  reportStage(
    `installing the exact disposable dependency graph (timeout ${cleanInstallTimeoutMs} ms)`,
  );
  try {
    runNpm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--strict-peer-deps",
      ],
      fixtureRoot,
      { stdio: "pipe", timeout: cleanInstallTimeoutMs },
    );
  } catch (error) {
    const timedOut =
      error?.code === "ETIMEDOUT" ||
      (error?.signal === "SIGTERM" && error?.status === null);
    const detail = timedOut
      ? `timed out after ${cleanInstallTimeoutMs} ms`
      : "failed";
    throw new Error(
      `The disposable consumer install ${detail}. This clean proof requires registry/cache access for its exact dependency set; no baseline was refreshed.`,
      { cause: error },
    );
  }
}

function compileWithTypescript46(fixtureRoot, typescriptPackagePath) {
  const compilerPath = join(dirname(typescriptPackagePath), "bin", "tsc");
  execFileSync(process.execPath, [compilerPath, "--project", fixtureRoot], {
    cwd: fixtureRoot,
    encoding: "utf8",
    stdio: "pipe",
    timeout: npmTimeoutMs,
  });
}

async function bundleWithWebpack564(fixtureRoot, webpack) {
  const configPath = join(fixtureRoot, "webpack.config.cjs");
  delete require.cache[configPath];
  const config = require(configPath);
  const compiler = webpack(config);
  let compilationFailure;
  let stats;
  try {
    stats = await withTimeout(
      new Promise((resolve, reject) => {
        compiler.run((error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      }),
      npmTimeoutMs,
      "Webpack compilation",
    );
  } catch (error) {
    compilationFailure = error;
  }
  try {
    await withTimeout(
      new Promise((resolve, reject) => {
        compiler.close((error) => (error ? reject(error) : resolve()));
      }),
      npmTimeoutMs,
      "Webpack compiler cleanup",
    );
  } catch (error) {
    compilationFailure ??= error;
  }
  if (compilationFailure) throw compilationFailure;
  assert(stats, "Webpack returned no compilation statistics.");
  if (stats.hasErrors()) {
    throw new Error(stats.toString({ all: false, errors: true }));
  }
  if (stats.hasWarnings()) {
    throw new Error(stats.toString({ all: false, warnings: true }));
  }
  return stats.toJson({
    all: false,
    assets: true,
    errors: true,
    modules: true,
    nestedModules: true,
    warnings: true,
  });
}

function flattenModules(modules = []) {
  const flattened = [];
  for (const module of modules) {
    flattened.push(module);
    flattened.push(...flattenModules(module.modules));
  }
  return flattened;
}

function sanitizeModulePath(value, pathMappings) {
  let sanitized = String(value).replaceAll("\\", "/");
  for (const [path, replacement] of pathMappings) {
    sanitized = sanitized.replaceAll(path.replaceAll("\\", "/"), replacement);
  }
  return sanitized.replaceAll(/file:\/\//gu, "");
}

const FORBIDDEN_BROWSER_RUNTIME_MODULE =
  /(?:^|[\\/])node_modules[\\/](?:node-hid|usb|ws)(?:[\\/]|$)|@ledgerhq[\\/](?:device-transport-kit-node(?:-[^\\/]+)?|device-transport-kit-web-usb|hw-transport-node(?:-[^\\/]+)?|hw-transport-webusb)(?:[\\/]|$)/u;

function largestMeaningfulModules(modules, pathMappings, limit = 10) {
  const byPath = new Map();
  for (const module of modules) {
    if (
      typeof module.size !== "number" ||
      module.size <= 0 ||
      module.moduleType === "runtime" ||
      (Array.isArray(module.modules) && module.modules.length > 0)
    ) {
      continue;
    }
    const rawPath = module.name ?? module.identifier;
    if (!rawPath || /^webpack\/(?:runtime|container)\b/u.test(rawPath)) {
      continue;
    }
    const path = sanitizeModulePath(rawPath, pathMappings);
    const bytes = Math.round(module.size);
    const previous = byPath.get(path);
    if (previous === undefined || previous < bytes) byPath.set(path, bytes);
  }
  return [...byPath]
    .map(([path, bytes]) => ({ bytes, path }))
    .sort(
      (left, right) =>
        right.bytes - left.bytes || left.path.localeCompare(right.path),
    )
    .slice(0, limit);
}

function validateAndEvaluateBudget(baseline, metrics) {
  assert(
    baseline.schemaVersion === 2,
    "Bundle baseline schemaVersion must be 2.",
  );
  assert(
    baseline.captureStatus === "current-clean-slice-6.5" &&
      typeof baseline.capturedFor === "string",
    "Bundle baseline must come from a completed clean Slice 6.5 capture.",
  );
  assert(
    baseline.typescriptVersion === "4.6.4" &&
      baseline.webpackVersion === "5.64.4" &&
      baseline.nodeMajor === EXPECTED_NODE_MAJOR &&
      baseline.npmVersion === EXPECTED_NPM_VERSION,
    "Bundle baseline was recorded with different compatibility tooling.",
  );

  const capturedMetrics = baseline.capturedMetrics ?? {};
  const policy = baseline.budgetPolicy ?? {};
  const derivation = policy.derivation ?? {};
  const warning = policy.warning ?? {};
  const failure = policy.failure ?? {};
  for (const field of BUNDLE_METRIC_FIELDS) {
    assert(
      capturedMetrics[field] === null ||
        (Number.isSafeInteger(capturedMetrics[field]) &&
          capturedMetrics[field] >= 0),
      `Captured bundle metric ${field} must be null or a non-negative integer.`,
    );
    assert(
      Number.isSafeInteger(metrics[field]) && metrics[field] >= 0,
      `Observed bundle metric ${field} must be a non-negative integer.`,
    );
  }
  assert(
    ["gzipBytes", "moduleCount", "uncompressedBytes"].every(
      (field) => capturedMetrics[field] !== null,
    ),
    "Only a historical brotli capture may be pending.",
  );
  const roundUp = (value, increment) =>
    Math.ceil(value / increment) * increment;
  const capturedBrotliBasis =
    capturedMetrics.brotliBytes ?? capturedMetrics.gzipBytes;
  const expectedWarning = {
    brotliBytes: roundUp(
      capturedBrotliBasis * derivation.warningMultiplier,
      derivation.byteRounding,
    ),
    gzipBytes: roundUp(
      capturedMetrics.gzipBytes * derivation.warningMultiplier,
      derivation.byteRounding,
    ),
    moduleCount: Math.ceil(
      capturedMetrics.moduleCount * derivation.moduleWarningMultiplier,
    ),
    uncompressedBytes: roundUp(
      capturedMetrics.uncompressedBytes * derivation.warningMultiplier,
      derivation.byteRounding,
    ),
  };
  const expectedFailure = {
    brotliBytes: roundUp(
      capturedBrotliBasis * derivation.failureMultiplier,
      derivation.byteRounding,
    ),
    gzipBytes: roundUp(
      capturedMetrics.gzipBytes * derivation.failureMultiplier,
      derivation.byteRounding,
    ),
    moduleCount: Math.ceil(
      capturedMetrics.moduleCount * derivation.moduleFailureMultiplier,
    ),
    uncompressedBytes: roundUp(
      capturedMetrics.uncompressedBytes * derivation.failureMultiplier,
      derivation.byteRounding,
    ),
  };
  assert(
    BUNDLE_METRIC_FIELDS.every(
      (field) =>
        warning[field] === expectedWarning[field] &&
        failure[field] === expectedFailure[field],
    ),
    "Absolute bundle ceilings must match the documented baseline derivation.",
  );
  const status = {};
  const warnings = [];
  const failures = [];
  for (const field of BUNDLE_METRIC_FIELDS) {
    assert(
      Number.isSafeInteger(warning[field]) && warning[field] >= 0,
      `Warning budget ${field} must be a non-negative integer.`,
    );
    assert(
      Number.isSafeInteger(failure[field]) && failure[field] >= warning[field],
      `Failure budget ${field} must be an integer at least as large as its warning budget.`,
    );
    if (metrics[field] > failure[field]) {
      status[field] = "failure";
      failures.push(
        `${field}=${metrics[field]} exceeds failure ceiling ${failure[field]}`,
      );
    } else if (metrics[field] > warning[field]) {
      status[field] = "warning";
      warnings.push(
        `${field}=${metrics[field]} exceeds warning ceiling ${warning[field]}`,
      );
    } else {
      status[field] = "within-budget";
    }
  }
  assert(
    failures.length === 0,
    `Reviewed bundle budget failed: ${failures.join("; ")}.`,
  );
  for (const warningMessage of warnings) {
    reportStage(`BUDGET WARNING: ${warningMessage}`);
  }
  return { status, warnings };
}

function collectDependencyVersions(tree, dependencyName, versions = new Set()) {
  for (const [name, dependency] of Object.entries(tree.dependencies ?? {})) {
    if (name === dependencyName && dependency.version) {
      versions.add(dependency.version);
    }
    collectDependencyVersions(dependency, dependencyName, versions);
  }
  return versions;
}

function collectPhysicalDependencyPaths(fixtureRoot, dependencyName) {
  const suffix = join("node_modules", ...dependencyName.split("/"));
  const paths = runNpm(
    ["ls", dependencyName, "--all", "--parseable"],
    fixtureRoot,
  )
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter((path) => path.endsWith(suffix))
    .map((path) => realpathSync(path));
  return [...new Set(paths)].sort();
}

function replaceGlobal(name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  assert(
    !original || original.configurable,
    `Cannot safely instrument non-configurable global ${name}.`,
  );
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
  return () => {
    if (original) {
      Object.defineProperty(globalThis, name, original);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  };
}

function denyGlobalUse(name) {
  return replaceGlobal(name, forbiddenCall(name));
}

function forbiddenCall(name) {
  return function () {
    observedSideEffects.push(name);
    throw new Error(
      `Packed bundle invoked ${name} during a side-effect check.`,
    );
  };
}

function denyConsoleCall(name) {
  const original = Object.getOwnPropertyDescriptor(console, name);
  assert(original?.configurable, `Cannot safely instrument console.${name}.`);
  Object.defineProperty(console, name, {
    configurable: true,
    value() {
      observedSideEffects.push(`console.${name}`);
      throw new Error(`Packed bundle called console.${name}.`);
    },
    writable: true,
  });
  return () => Object.defineProperty(console, name, original);
}

function restoreAll(restorers) {
  for (const restore of [...restorers].reverse()) restore();
}

const runRoot = mkdtempSync(join(tmpdir(), "caravan-ledger-consumer-"));
const fixtureRoot = join(runRoot, "fixture");
const packDestination = join(runRoot, "packed");
const npmCache = join(runRoot, "npm-cache");
let runCompleted = false;

try {
  reportStage("validating the checked-in compatibility fixture");
  for (const generatedName of [
    "bundle",
    "compiled",
    "node_modules",
    "package-lock.json",
  ]) {
    assert(
      !existsSync(join(fixtureTemplate, generatedName)),
      `Compatibility fixture contains generated install output: ${generatedName}.`,
    );
  }
  cpSync(fixtureTemplate, fixtureRoot, { recursive: true });
  mkdirSync(packDestination, { recursive: true });
  const fixtureManifestPath = join(fixtureRoot, "package.json");
  const fixtureManifest = readJson(fixtureManifestPath);
  assertExact(
    Object.keys(fixtureManifest.dependencies ?? {}),
    ["@caravan/ledger"],
    "Fixture runtime dependencies",
  );
  assertExact(
    Object.entries(fixtureManifest.devDependencies ?? {}).map(
      ([name, version]) => `${name}@${version}`,
    ),
    ["typescript@4.6.4", "webpack@5.64.4"],
    "Fixture compatibility tooling",
  );
  assert(
    Number(process.versions.node.split(".")[0]) === EXPECTED_NODE_MAJOR,
    `Clean consumer evidence requires Node ${EXPECTED_NODE_MAJOR}.x; received ${process.version}.`,
  );
  const npmVersion = runNpm(["--version"], packageRoot).trim();
  assert(
    npmVersion === EXPECTED_NPM_VERSION,
    `Clean consumer evidence requires npm ${EXPECTED_NPM_VERSION}; received ${npmVersion}.`,
  );

  reportStage("packing the production artifact");
  const packOutput = runNpm(
    [
      "pack",
      "--json",
      "--ignore-scripts",
      "--pack-destination",
      packDestination,
    ],
    packageRoot,
  );
  const [packResult] = JSON.parse(packOutput);
  assert(packResult, "npm pack did not produce a package artifact.");
  assert(packResult.name === "@caravan/ledger", "Packed the wrong package.");
  assert(packResult.version === "0.0.0", "Packed package version changed.");
  assertExact(
    packResult.files.map(({ path }) => path),
    [
      "LICENSE",
      "README.md",
      "dist/browser.js",
      "dist/index.d.ts",
      "dist/index.js",
      "package.json",
    ],
    "Consumer tarball file allowlist",
  );
  assert(
    Array.isArray(packResult.bundled) && packResult.bundled.length === 0,
    "Consumer tarball unexpectedly bundles runtime dependencies.",
  );
  const tarballPath = join(packDestination, packResult.filename);
  fixtureManifest.dependencies["@caravan/ledger"] = `file:${tarballPath}`;
  writeFileSync(
    fixtureManifestPath,
    `${JSON.stringify(fixtureManifest, null, 2)}\n`,
    "utf8",
  );

  runCleanInstall(fixtureRoot);
  assert(
    !existsSync(join(fixtureRoot, "package-lock.json")),
    "Disposable compatibility install wrote a package lock.",
  );
  reportStage("auditing the installed tarball and dependency locations");
  const installedPackageRoot = join(
    fixtureRoot,
    "node_modules",
    "@caravan",
    "ledger",
  );
  assert(
    !lstatSync(installedPackageRoot).isSymbolicLink(),
    "Consumer installed a source link instead of the packed artifact.",
  );
  const installedNodeModulesRoot = `${realpathSync(
    join(fixtureRoot, "node_modules"),
  )}${sep}`;
  assert(
    realpathSync(installedPackageRoot).startsWith(installedNodeModulesRoot),
    "Packed package resolved outside the disposable consumer node_modules.",
  );
  const installedManifest = readJson(
    join(installedPackageRoot, "package.json"),
  );
  assert(
    installedManifest.name === "@caravan/ledger" &&
      installedManifest.version === "0.0.0" &&
      installedManifest.private === true &&
      installedManifest.type === "module",
    "Installed tarball identity or private ESM policy changed.",
  );
  assert(
    !Object.hasOwn(installedManifest, "main") &&
      !Object.hasOwn(installedManifest, "sideEffects") &&
      !Object.hasOwn(installedManifest.exports?.["."] ?? {}, "require"),
    "Installed tarball exposes CommonJS or an unreviewed side-effect policy.",
  );
  assert(
    installedManifest.devDependencies?.typescript !== "4.6.4" &&
      !Object.hasOwn(installedManifest.devDependencies ?? {}, "webpack") &&
      !Object.hasOwn(
        installedManifest.devDependencies ?? {},
        "typescript-4-6",
      ) &&
      !Object.hasOwn(installedManifest.devDependencies ?? {}, "webpack-5-64"),
    "Compatibility tooling leaked into the packed package manifest.",
  );
  for (const artifactPath of [
    "dist/browser.js",
    "dist/index.d.ts",
    "dist/index.js",
  ]) {
    const artifactStat = lstatSync(join(installedPackageRoot, artifactPath));
    assert(
      artifactStat.isFile() &&
        !artifactStat.isSymbolicLink() &&
        artifactStat.size > 0,
      `Installed tarball artifact ${artifactPath} is missing, empty, or linked.`,
    );
  }

  const fixtureRequire = createRequire(fixtureManifestPath);
  const typescriptPackagePath = fixtureRequire.resolve(
    "typescript/package.json",
  );
  const typescriptPackage = readJson(typescriptPackagePath);
  const webpackPackagePath = fixtureRequire.resolve("webpack/package.json");
  const webpackPackage = readJson(webpackPackagePath);
  const webpack = fixtureRequire("webpack");
  assert(
    realpathSync(typescriptPackagePath).startsWith(installedNodeModulesRoot) &&
      realpathSync(webpackPackagePath).startsWith(installedNodeModulesRoot),
    "Compatibility tooling resolved outside the disposable fixture.",
  );
  assert(
    typescriptPackage.version === "4.6.4",
    `Expected TypeScript 4.6.4, received ${typescriptPackage.version}.`,
  );
  assert(
    webpackPackage.version === "5.64.4",
    `Expected Webpack 5.64.4, received ${webpackPackage.version}.`,
  );

  reportStage("compiling with TypeScript 4.6.4");
  compileWithTypescript46(fixtureRoot, typescriptPackagePath);
  reportStage("bundling with Webpack 5.64.4");
  const webpackStats = await bundleWithWebpack564(fixtureRoot, webpack);
  assertExact(
    (webpackStats.assets ?? []).map(({ name }) => name),
    ["consumer.mjs"],
    "Webpack output assets",
  );
  const bundlePath = join(fixtureRoot, "bundle", "consumer.mjs");
  const bundle = readFileSync(bundlePath);
  const bundleText = bundle.toString("utf8");
  const modules = flattenModules(webpackStats.modules);
  const pathMappings = [
    [realpathSync(fixtureRoot), "<fixture>"],
    [realpathSync(packageRoot), "<workspace-package>"],
    [realpathSync(runRoot), "<run>"],
  ].sort((left, right) => right[0].length - left[0].length);
  const largestModules = largestMeaningfulModules(modules, pathMappings);
  assert(
    largestModules.every(
      ({ path }) =>
        !path.includes(realpathSync(runRoot)) &&
        !path.includes(realpathSync(packageRoot)),
    ),
    "Largest-module reporting exposed an unstable absolute path.",
  );
  const moduleEvidence = modules.map(
    (module) => `${module.name ?? ""} ${module.identifier ?? ""}`,
  );
  const countModules = (pattern) =>
    moduleEvidence.filter((evidence) => pattern.test(evidence)).length;
  const ledgerModuleCount = countModules(/@caravan[\\/]ledger/);
  const ledgerSdkModuleCount = countModules(/@ledgerhq/);
  const nodePolyfillModuleCount = countModules(
    /(?:assert|buffer|console|constants|crypto|domain|events|http|https|os|path|process|punycode|querystring|stream|string_decoder|timers|tty|url|util|vm|zlib)-browserify|node-libs-browser|process[\/]browser|readable-stream/,
  );
  const rxjsModuleCount = countModules(/[\\/]rxjs[\\/]/);
  const reflectMetadataModuleCount = countModules(/[\\/]reflect-metadata[\\/]/);
  const forbiddenRuntimeModuleCount = countModules(
    FORBIDDEN_BROWSER_RUNTIME_MODULE,
  );

  assert(
    ledgerModuleCount >= 1,
    "Webpack did not resolve the packed public ESM entry.",
  );
  const installedRuntimePath = realpathSync(
    join(installedPackageRoot, "dist", "browser.js"),
  );
  assert(
    moduleEvidence.some((evidence) => evidence.includes(installedRuntimePath)),
    "Webpack did not use the packed dist/browser.js browser entry.",
  );
  const installedNeutralRuntimePath = realpathSync(
    join(installedPackageRoot, "dist", "index.js"),
  );
  assert(
    moduleEvidence.every(
      (evidence) => !evidence.includes(installedNeutralRuntimePath),
    ),
    "Webpack selected the neutral Node entry instead of the browser entry.",
  );
  assert(
    moduleEvidence.every((evidence) => !evidence.includes(packageRoot)),
    "Webpack resolved Caravan workspace source instead of the tarball.",
  );
  assert(
    ledgerSdkModuleCount > 0,
    "The browser entry did not include its expected Ledger SDK graph.",
  );
  assert(
    nodePolyfillModuleCount === 0,
    "The public root pulled Node polyfill modules into the browser bundle.",
  );
  assert(
    forbiddenRuntimeModuleCount === 0,
    "The public root pulled Node-only ws/HID/USB or WebUSB transport modules into the browser bundle.",
  );
  assert(
    rxjsModuleCount > 0,
    "The browser entry did not include its expected RxJS graph.",
  );
  assert(
    reflectMetadataModuleCount > 0,
    "The browser entry did not include its expected reflect-metadata graph.",
  );
  assert(
    !/require\s*\(\s*["']@ledgerhq[\\/]device-transport-kit-web-hid/.test(
      bundleText,
    ),
    "The browser bundle contains a CommonJS WebHID require.",
  );
  assert(
    /\bexport\s*\{/.test(bundleText),
    "Webpack output does not contain an ESM export.",
  );
  assert(
    !/require\s*\(\s*["'](?:node:)?(?:assert|buffer|crypto|events|fs|http|https|net|os|path|process|stream|tls|url|util|vm|zlib)/.test(
      bundleText,
    ),
    "Webpack output requires an unapproved Node builtin or polyfill.",
  );

  reportStage("checking import-time permissions, network, and console effects");
  const importRestorers = [
    replaceGlobal("window", undefined),
    replaceGlobal("navigator", undefined),
    ...["EventSource", "WebSocket", "XMLHttpRequest", "fetch"].map(
      denyGlobalUse,
    ),
    ...["debug", "error", "info", "log", "warn"].map(denyConsoleCall),
  ];
  let runtimeModule;
  try {
    runtimeModule = await withTimeout(
      import(`${pathToFileURL(bundlePath).href}?consumer-proof`),
      npmTimeoutMs,
      "Webpack bundle import",
    );
    assert(
      JSON.stringify(runtimeModule.supportAtImport) ===
        JSON.stringify({ supported: false, reason: "not-browser" }),
      "Packed browser bundle was not SSR-safe at import.",
    );
    assert(
      runtimeModule.installerAtImport &&
        typeof runtimeModule.installerAtImport.prepare === "function",
      "Packed browser factory was not usable during guarded import.",
    );
    await withTimeout(
      runtimeModule.installerAtImport.dispose(),
      npmTimeoutMs,
      "SSR-safe installer disposal",
    );
    assertExact(observedSideEffects, [], "SSR import side effects");
  } finally {
    restoreAll(importRestorers);
  }

  let requestDeviceCalls = 0;
  let getDevicesCalls = 0;
  const restoreBrowserWindow = replaceGlobal("window", {
    EventSource: forbiddenCall("window.EventSource"),
    WebSocket: forbiddenCall("window.WebSocket"),
    XMLHttpRequest: forbiddenCall("window.XMLHttpRequest"),
    fetch: forbiddenCall("window.fetch"),
    isSecureContext: true,
  });
  const restoreBrowserNavigator = replaceGlobal("navigator", {
    hid: {
      getDevices() {
        getDevicesCalls += 1;
        return Promise.resolve([]);
      },
      requestDevice() {
        requestDeviceCalls += 1;
        return Promise.resolve([]);
      },
    },
  });
  const browserSideEffectRestorers = [
    ...["EventSource", "WebSocket", "XMLHttpRequest", "fetch"].map(
      denyGlobalUse,
    ),
    ...["debug", "error", "info", "log", "warn"].map(denyConsoleCall),
  ];
  try {
    assert(
      JSON.stringify(runtimeModule.readSupport()) ===
        JSON.stringify({ supported: true }),
      "Packed support probe rejected a valid capability surface.",
    );
    assert(requestDeviceCalls === 0, "Support probing invoked requestDevice.");
    assert(getDevicesCalls === 0, "Support probing invoked getDevices.");
    const installer = runtimeModule.makeInstaller();
    assert(
      installer && typeof installer.prepare === "function",
      "Packed browser factory did not return the reviewed facade.",
    );
    assert(requestDeviceCalls === 0, "Factory invoked requestDevice.");
    assert(getDevicesCalls === 0, "Factory invoked getDevices.");
    await withTimeout(
      installer.dispose(),
      npmTimeoutMs,
      "Browser installer disposal",
    );
    assert(requestDeviceCalls === 0, "Factory disposal invoked requestDevice.");
    assert(getDevicesCalls === 0, "Factory disposal invoked getDevices.");
    const safeError = runtimeModule.makeSafeError();
    assert(
      safeError.name === "BitcoinInstallerError",
      "Safe error export is unusable.",
    );
    assert(!Object.hasOwn(safeError, "cause"), "Safe error exposed a cause.");
    assertExact(observedSideEffects, [], "Browser probe/factory side effects");
  } finally {
    restoreAll(browserSideEffectRestorers);
    restoreBrowserNavigator();
    restoreBrowserWindow();
  }

  reportStage("checking singleton runtime dependency installations");
  const dependencyTree = JSON.parse(
    runNpm(["ls", "rxjs", "reflect-metadata", "--all", "--json"], fixtureRoot),
  );
  const rxjsVersions = [
    ...collectDependencyVersions(dependencyTree, "rxjs"),
  ].sort();
  const reflectMetadataVersions = [
    ...collectDependencyVersions(dependencyTree, "reflect-metadata"),
  ].sort();
  const rxjsInstallPaths = collectPhysicalDependencyPaths(fixtureRoot, "rxjs");
  const reflectMetadataInstallPaths = collectPhysicalDependencyPaths(
    fixtureRoot,
    "reflect-metadata",
  );
  assertExact(rxjsVersions, ["7.8.2"], "Installed RxJS versions");
  assertExact(
    reflectMetadataVersions,
    ["0.2.2"],
    "Installed reflect-metadata versions",
  );
  assert(
    rxjsInstallPaths.length === 1,
    `Expected one physical RxJS installation, received ${rxjsInstallPaths.length}.`,
  );
  assert(
    reflectMetadataInstallPaths.length === 1,
    `Expected one physical reflect-metadata installation, received ${reflectMetadataInstallPaths.length}.`,
  );

  const uncompressedBytes = bundle.byteLength;
  const gzipBytes = gzipSync(bundle).byteLength;
  const brotliBytes = brotliCompressSync(bundle).byteLength;
  const bundleMetrics = {
    brotliBytes,
    gzipBytes,
    moduleCount: modules.length,
    uncompressedBytes,
  };
  const baseline = readJson(join(fixtureRoot, "baseline.json"));
  assert(
    baseline.typescriptVersion === typescriptPackage.version &&
      baseline.webpackVersion === webpackPackage.version,
    "Bundle baseline was recorded with different compatibility tooling.",
  );
  const budgetEvaluation = validateAndEvaluateBudget(baseline, bundleMetrics);
  reportStage("clean packed consumer lifecycle completed");
  const report = {
    baseline: {
      captureStatus: baseline.captureStatus,
      capturedFor: baseline.capturedFor,
      deltas: Object.fromEntries(
        BUNDLE_METRIC_FIELDS.map((field) => [
          field,
          baseline.capturedMetrics[field] === null
            ? null
            : bundleMetrics[field] - baseline.capturedMetrics[field],
        ]),
      ),
      refreshCandidate: {
        captureStatus: "current-clean-slice-6.5",
        capturedFor:
          "Slice 6.5 complete packed lifecycle: TypeScript 4.6.4 and Webpack 5.64.4",
        capturedMetrics: bundleMetrics,
      },
    },
    budget: {
      failure: baseline.budgetPolicy.failure,
      status: budgetEvaluation.status,
      warning: baseline.budgetPolicy.warning,
      warnings: budgetEvaluation.warnings,
    },
    bundle: {
      asset: "consumer.mjs",
      brotliBytes,
      gzipBytes,
      largestModules,
      largestModuleByteBasis: "webpack-reported-module-size",
      ledgerModuleCount,
      ledgerSdkModuleCount,
      forbiddenRuntimeModuleCount,
      minifiedBytes: uncompressedBytes,
      moduleCount: modules.length,
      moduleCountBasis:
        "flattened-webpack-stats-including-nested-concatenated-members",
      nodePolyfillModuleCount,
      reflectMetadataModuleCount,
      rxjsModuleCount,
      totalBytes: uncompressedBytes,
      uncompressedBytes,
    },
    installed: {
      reflectMetadataPhysicalCopies: reflectMetadataInstallPaths.length,
      reflectMetadataVersions,
      rxjsPhysicalCopies: rxjsInstallPaths.length,
      rxjsVersions,
    },
    install: {
      cache: "disposable",
      packageLockWritten: false,
      registryAccess: "may-be-required-for-clean-exact-tooling-install",
      scripts: "disabled",
    },
    package: {
      declaredRuntimeDependencies: Object.keys(fixtureManifest.dependencies),
      installedFromTarball: true,
      sideEffectsField: Object.hasOwn(installedManifest, "sideEffects")
        ? "present"
        : "absent",
      selectedExport: "browser",
    },
    tooling: {
      node: process.version,
      npm: npmVersion,
      typescript: typescriptPackage.version,
      webpack: webpackPackage.version,
    },
  };
  console.log(JSON.stringify(report, null, 2));
  runCompleted = true;
} finally {
  try {
    rmSync(runRoot, { force: true, recursive: true });
  } catch (error) {
    if (runCompleted) {
      throw new Error("Disposable consumer cleanup failed.", { cause: error });
    }
    reportStage("cleanup also failed; preserving the primary failure");
  }
}
