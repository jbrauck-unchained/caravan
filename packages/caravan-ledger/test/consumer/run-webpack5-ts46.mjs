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
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureTemplate = fileURLToPath(
  new URL("./webpack5-ts46/", import.meta.url),
);

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

function runNpm(arguments_, cwd, options = {}) {
  const { env, ...execOptions } = options;
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
    ...execOptions,
  });
}

function compileWithTypescript46(fixtureRoot, typescriptPackagePath) {
  const compilerPath = join(dirname(typescriptPackagePath), "bin", "tsc");
  execFileSync(process.execPath, [compilerPath, "--project", fixtureRoot], {
    cwd: fixtureRoot,
    encoding: "utf8",
    stdio: "pipe",
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
    stats = await new Promise((resolve, reject) => {
      compiler.run((error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
  } catch (error) {
    compilationFailure = error;
  }
  try {
    await new Promise((resolve, reject) => {
      compiler.close((error) => (error ? reject(error) : resolve()));
    });
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

function denyGlobalRead(name) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  assert(
    !original || original.configurable,
    `Cannot safely instrument non-configurable global ${name}.`,
  );
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new Error(`Packed bundle read ${name} during a side-effect check.`);
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(globalThis, name, original);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  };
}

function denyConsoleCall(name) {
  const original = Object.getOwnPropertyDescriptor(console, name);
  assert(original?.configurable, `Cannot safely instrument console.${name}.`);
  Object.defineProperty(console, name, {
    configurable: true,
    value() {
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

try {
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
      { stdio: "pipe" },
    );
  } catch {
    throw new Error(
      "The disposable consumer could not install its exact dependency set. This clean proof may require npm registry access.",
    );
  }
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
  for (const artifactPath of ["dist/index.d.ts", "dist/index.js"]) {
    assert(
      readFileSync(join(installedPackageRoot, artifactPath)).equals(
        readFileSync(join(packageRoot, artifactPath)),
      ),
      `Installed ${artifactPath} differs from the freshly packed build.`,
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

  compileWithTypescript46(fixtureRoot, typescriptPackagePath);
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

  assert(
    ledgerModuleCount >= 1,
    "Webpack did not resolve the packed public ESM entry.",
  );
  const installedRuntimePath = realpathSync(
    join(installedPackageRoot, "dist", "index.js"),
  );
  assert(
    moduleEvidence.some((evidence) => evidence.includes(installedRuntimePath)),
    "Webpack did not use the packed dist/index.js browser/ESM entry.",
  );
  assert(
    moduleEvidence.every((evidence) => !evidence.includes(packageRoot)),
    "Webpack resolved Caravan workspace source instead of the tarball.",
  );
  assert(
    ledgerSdkModuleCount === 0,
    "The public root pulled Ledger SDK code into the bundle.",
  );
  assert(
    nodePolyfillModuleCount === 0,
    "The public root pulled Node polyfill modules into the browser bundle.",
  );
  assert(
    rxjsModuleCount === 0,
    "The public root pulled RxJS into the consumer bundle.",
  );
  assert(
    reflectMetadataModuleCount === 0,
    "The public root pulled reflect-metadata into the consumer bundle.",
  );
  assert(
    !/require\s*\(\s*["']@ledgerhq[\\/]device-transport-kit-web-hid/.test(
      bundleText,
    ),
    "The browser bundle contains a CommonJS WebHID require.",
  );
  assert(!/\bmodule\.exports\b/.test(bundleText), "Webpack output is not ESM.");
  assert(
    /\bexport\s*\{/.test(bundleText),
    "Webpack output does not contain an ESM export.",
  );
  for (const [label, pattern] of [
    ["Ledger SDK", /@ledgerhq/i],
    ["RxJS", /\brxjs\b/i],
    ["reflect-metadata", /reflect-metadata/i],
    ["XState", /\bxstate\b/i],
  ]) {
    assert(!pattern.test(bundleText), `Browser bundle retains ${label} code.`);
  }
  assert(
    !/require\s*\(\s*["'](?:node:)?(?:assert|buffer|crypto|events|fs|http|https|net|os|path|process|stream|tls|url|util|vm|zlib)/.test(
      bundleText,
    ),
    "Webpack output requires an unapproved Node builtin or polyfill.",
  );

  const importRestorers = [
    replaceGlobal("window", undefined),
    replaceGlobal("navigator", undefined),
    ...["EventSource", "WebSocket", "XMLHttpRequest", "fetch"].map(
      denyGlobalRead,
    ),
    ...["debug", "error", "info", "log", "warn"].map(denyConsoleCall),
  ];
  let runtimeModule;
  try {
    runtimeModule = await import(
      `${pathToFileURL(bundlePath).href}?consumer-proof`
    );
    assert(
      JSON.stringify(runtimeModule.supportAtImport) ===
        JSON.stringify({ supported: false, reason: "not-browser" }),
      "Packed browser bundle was not SSR-safe at import.",
    );
  } finally {
    restoreAll(importRestorers);
  }

  let requestDeviceCalls = 0;
  let getDevicesCalls = 0;
  const restoreBrowserWindow = replaceGlobal("window", {
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
      denyGlobalRead,
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
    const safeError = runtimeModule.makeSafeError();
    assert(
      safeError.name === "BitcoinInstallerError",
      "Safe error export is unusable.",
    );
    assert(!Object.hasOwn(safeError, "cause"), "Safe error exposed a cause.");
  } finally {
    restoreAll(browserSideEffectRestorers);
    restoreBrowserNavigator();
    restoreBrowserWindow();
  }

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

  const baseline = readJson(join(fixtureRoot, "baseline.json"));
  assert(
    baseline.typescriptVersion === typescriptPackage.version &&
      baseline.webpackVersion === webpackPackage.version,
    "Bundle baseline was recorded with different compatibility tooling.",
  );
  for (const field of ["gzipBytes", "moduleCount", "uncompressedBytes"]) {
    assert(
      Number.isSafeInteger(baseline[field]) && baseline[field] >= 0,
      `Bundle baseline ${field} must be a non-negative integer.`,
    );
  }
  const uncompressedBytes = bundle.byteLength;
  const gzipBytes = gzipSync(bundle).byteLength;
  const npmVersion = runNpm(["--version"], fixtureRoot).trim();
  const report = {
    baseline: {
      gzipDeltaBytes: gzipBytes - baseline.gzipBytes,
      moduleDelta: modules.length - baseline.moduleCount,
      uncompressedDeltaBytes: uncompressedBytes - baseline.uncompressedBytes,
    },
    bundle: {
      asset: "consumer.mjs",
      gzipBytes,
      ledgerModuleCount,
      ledgerSdkModuleCount,
      moduleCount: modules.length,
      nodePolyfillModuleCount,
      reflectMetadataModuleCount,
      rxjsModuleCount,
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
    },
    tooling: {
      node: process.version,
      npm: npmVersion,
      typescript: typescriptPackage.version,
      webpack: webpackPackage.version,
    },
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  rmSync(runRoot, { force: true, recursive: true });
}
