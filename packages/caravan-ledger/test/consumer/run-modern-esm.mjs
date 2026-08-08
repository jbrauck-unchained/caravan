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
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtureTemplate = fileURLToPath(
  new URL("./modern-esm/", import.meta.url),
);
const DEFAULT_NPM_TIMEOUT_MS = 30_000;
const DEFAULT_CLEAN_INSTALL_TIMEOUT_MS = 120_000;
const EXPECTED_NODE_MAJOR = 24;
const EXPECTED_NPM_VERSION = "11.14.1";
const observedSideEffects = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  process.stderr.write(`[consumer:modern-esm] ${message}\n`);
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

const runRoot = mkdtempSync(join(tmpdir(), "caravan-ledger-modern-consumer-"));
const fixtureRoot = join(runRoot, "fixture");
const packDestination = join(runRoot, "packed");
const npmCache = join(runRoot, "npm-cache");

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

function runCleanInstall() {
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
      `The modern disposable consumer install ${detail}. This clean proof requires registry/cache access for its exact dependency set.`,
      { cause: error },
    );
  }
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

function collectPhysicalDependencyPaths(dependencyName) {
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
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
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

function sanitizeModulePath(value, pathMappings) {
  let sanitized = String(value).replaceAll("\\", "/");
  for (const [path, replacement] of pathMappings) {
    sanitized = sanitized.replaceAll(path.replaceAll("\\", "/"), replacement);
  }
  return sanitized.replaceAll(/file:\/\//gu, "");
}

const FORBIDDEN_BROWSER_RUNTIME_MODULE =
  /(?:^|[\\/])node_modules[\\/](?:node-hid|usb|ws)(?:[\\/]|$)|@ledgerhq[\\/](?:device-transport-kit-node(?:-[^\\/]+)?|device-transport-kit-web-usb|hw-transport-node(?:-[^\\/]+)?|hw-transport-webusb)(?:[\\/]|$)/u;

let runCompleted = false;

try {
  reportStage("validating the checked-in modern ESM fixture");
  for (const generatedName of ["bundle", "node_modules", "package-lock.json"]) {
    assert(
      !existsSync(join(fixtureTemplate, generatedName)),
      `Modern fixture contains generated install output: ${generatedName}.`,
    );
  }
  cpSync(fixtureTemplate, fixtureRoot, { recursive: true });
  mkdirSync(packDestination, { recursive: true });
  const fixtureManifestPath = join(fixtureRoot, "package.json");
  const fixtureManifest = readJson(fixtureManifestPath);
  assert(
    fixtureManifest.private === true,
    "Modern fixture must remain private.",
  );
  assertExact(
    Object.keys(fixtureManifest.dependencies ?? {}),
    ["@caravan/ledger"],
    "Modern fixture runtime dependencies",
  );
  assertExact(
    Object.entries(fixtureManifest.devDependencies ?? {}).map(
      ([name, version]) => `${name}@${version}`,
    ),
    ["esbuild@0.25.3"],
    "Modern fixture tooling",
  );
  const directDeclarations = [
    ...Object.keys(fixtureManifest.dependencies ?? {}),
    ...Object.keys(fixtureManifest.devDependencies ?? {}),
  ];
  assert(
    directDeclarations.every(
      (name) =>
        name !== "rxjs" &&
        name !== "reflect-metadata" &&
        !name.startsWith("@ledgerhq/"),
    ),
    "Modern fixture must not directly declare Ledger SDK, RxJS, or reflect-metadata packages.",
  );
  assert(
    Number(process.versions.node.split(".")[0]) === EXPECTED_NODE_MAJOR,
    `Modern clean consumer evidence requires Node ${EXPECTED_NODE_MAJOR}.x; received ${process.version}.`,
  );
  const npmVersion = runNpm(["--version"], packageRoot).trim();
  assert(
    npmVersion === EXPECTED_NPM_VERSION,
    `Modern clean consumer evidence requires npm ${EXPECTED_NPM_VERSION}; received ${npmVersion}.`,
  );

  reportStage("packing the production artifact");
  const [packResult] = JSON.parse(
    runNpm(
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        packDestination,
      ],
      packageRoot,
    ),
  );
  assert(packResult, "npm pack did not produce a package artifact.");
  assert(
    packResult.name === "@caravan/ledger" && packResult.version === "0.0.0",
    "Packed the wrong package identity.",
  );
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
    "Modern consumer tarball file allowlist",
  );
  assert(
    Array.isArray(packResult.bundled) && packResult.bundled.length === 0,
    "Modern consumer tarball unexpectedly bundles runtime dependencies.",
  );
  const tarballPath = join(packDestination, packResult.filename);
  fixtureManifest.dependencies["@caravan/ledger"] = `file:${tarballPath}`;
  writeFileSync(
    fixtureManifestPath,
    `${JSON.stringify(fixtureManifest, null, 2)}\n`,
    "utf8",
  );

  runCleanInstall();
  assert(
    !existsSync(join(fixtureRoot, "package-lock.json")),
    "Modern disposable install wrote a package lock.",
  );
  reportStage("auditing tarball and tool resolution");
  const installedPackageRoot = join(
    fixtureRoot,
    "node_modules",
    "@caravan",
    "ledger",
  );
  assert(
    !lstatSync(installedPackageRoot).isSymbolicLink(),
    "Modern consumer installed a source link instead of the packed artifact.",
  );
  const installedNodeModulesRoot = `${realpathSync(
    join(fixtureRoot, "node_modules"),
  )}${sep}`;
  assert(
    realpathSync(installedPackageRoot).startsWith(installedNodeModulesRoot),
    "Modern packed package resolved outside disposable node_modules.",
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
  const esbuildPackagePath = fixtureRequire.resolve("esbuild/package.json");
  assert(
    realpathSync(esbuildPackagePath).startsWith(installedNodeModulesRoot),
    "Modern tooling resolved outside the disposable fixture.",
  );
  const esbuildPackage = readJson(esbuildPackagePath);
  assert(
    esbuildPackage.version === "0.25.3",
    `Expected esbuild 0.25.3, received ${esbuildPackage.version}.`,
  );
  const { build } = await withTimeout(
    import(pathToFileURL(fixtureRequire.resolve("esbuild"))),
    npmTimeoutMs,
    "esbuild module import",
  );

  reportStage("building the modern browser ESM consumer");
  const bundlePath = join(fixtureRoot, "bundle", "consumer.mjs");
  const buildResult = await withTimeout(
    build({
      absWorkingDir: fixtureRoot,
      bundle: true,
      conditions: ["browser", "import", "module", "default"],
      entryPoints: ["src/index.js"],
      format: "esm",
      logLevel: "silent",
      mainFields: ["browser", "module", "main"],
      metafile: true,
      minify: true,
      outfile: bundlePath,
      platform: "browser",
      target: ["es2022"],
      treeShaking: true,
    }),
    npmTimeoutMs,
    "Modern ESM bundle",
  );
  assert(buildResult.metafile, "esbuild returned no module metadata.");
  const inputPaths = Object.keys(buildResult.metafile.inputs);
  assert(
    inputPaths.some((path) =>
      path.endsWith("node_modules/@caravan/ledger/dist/browser.js"),
    ),
    "Modern ESM build did not select the packed browser export.",
  );
  assert(
    inputPaths.every(
      (path) => !path.endsWith("node_modules/@caravan/ledger/dist/index.js"),
    ),
    "Modern ESM build selected the neutral Node entry.",
  );
  assert(
    inputPaths.some((path) => path.includes("node_modules/@ledgerhq/")),
    "Modern ESM build omitted the expected Ledger SDK graph.",
  );
  assert(
    inputPaths.some((path) => path.includes("node_modules/rxjs/")),
    "Modern ESM build omitted the expected RxJS graph.",
  );
  assert(
    inputPaths.some((path) => path.includes("node_modules/reflect-metadata/")),
    "Modern ESM build tree-shook the required reflect-metadata side effect.",
  );
  const forbiddenNodeModulePattern =
    /(?:assert|buffer|console|constants|crypto|domain|events|http|https|os|path|process|punycode|querystring|stream|string_decoder|timers|tty|url|util|vm|zlib)-browserify|node-libs-browser|process[\\/]browser|readable-stream/u;
  assert(
    inputPaths.every((path) => !forbiddenNodeModulePattern.test(path)),
    "Modern browser build included an unapproved Node polyfill module.",
  );
  const forbiddenRuntimeModuleCount = inputPaths.filter((path) =>
    FORBIDDEN_BROWSER_RUNTIME_MODULE.test(path),
  ).length;
  assert(
    forbiddenRuntimeModuleCount === 0,
    "Modern browser build included Node-only ws/HID/USB or WebUSB transport modules.",
  );
  const bundle = readFileSync(bundlePath);
  const bundleText = bundle.toString("utf8");
  assert(/\bexport\s*\{/u.test(bundleText), "Modern output is not ESM.");
  assert(
    !/require\s*\(\s*["']@ledgerhq[\\/]device-transport-kit-web-hid/u.test(
      bundleText,
    ),
    "Modern bundle contains a CommonJS WebHID require.",
  );
  assert(
    !/require\s*\(\s*["'](?:node:)?(?:assert|buffer|crypto|events|fs|http|https|net|os|path|process|stream|tls|url|util|vm|zlib)/u.test(
      bundleText,
    ),
    "Modern bundle requires an unapproved Node builtin or polyfill.",
  );

  reportStage(
    "checking modern import-time permissions, network, and console effects",
  );
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
      import(`${pathToFileURL(bundlePath).href}?modern-proof`),
      npmTimeoutMs,
      "Modern bundle import",
    );
    assert(
      JSON.stringify(runtimeModule.supportAtImport) ===
        JSON.stringify({ supported: false, reason: "not-browser" }),
      "Modern packed browser bundle was not SSR-safe at import.",
    );
    assert(
      runtimeModule.installerAtImport &&
        typeof runtimeModule.installerAtImport.prepare === "function",
      "Modern packed browser factory was not usable during guarded import.",
    );
    await withTimeout(
      runtimeModule.installerAtImport.dispose(),
      npmTimeoutMs,
      "Modern SSR-safe installer disposal",
    );
    assertExact(observedSideEffects, [], "Modern SSR import side effects");
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
      "Modern support probe rejected a valid capability surface.",
    );
    assert(
      requestDeviceCalls === 0,
      "Modern support probe invoked requestDevice.",
    );
    assert(getDevicesCalls === 0, "Modern support probe invoked getDevices.");
    const installer = runtimeModule.makeInstaller();
    assert(
      installer && typeof installer.prepare === "function",
      "Modern browser factory did not return the reviewed facade.",
    );
    assert(requestDeviceCalls === 0, "Modern factory invoked requestDevice.");
    assert(getDevicesCalls === 0, "Modern factory invoked getDevices.");
    await withTimeout(
      installer.dispose(),
      npmTimeoutMs,
      "Modern browser installer disposal",
    );
    assert(
      requestDeviceCalls === 0,
      "Modern factory disposal invoked requestDevice.",
    );
    assert(
      getDevicesCalls === 0,
      "Modern factory disposal invoked getDevices.",
    );
    const safeError = runtimeModule.makeSafeError();
    assert(
      safeError.name === "BitcoinInstallerError" &&
        !Object.hasOwn(safeError, "cause"),
      "Modern safe error export is unusable or exposes a cause.",
    );
    assertExact(
      observedSideEffects,
      [],
      "Modern browser probe/factory side effects",
    );
  } finally {
    restoreAll(browserSideEffectRestorers);
    restoreBrowserNavigator();
    restoreBrowserWindow();
  }

  reportStage("checking singleton transitive runtime dependencies");
  const dependencyTree = JSON.parse(
    runNpm(["ls", "rxjs", "reflect-metadata", "--all", "--json"], fixtureRoot),
  );
  const rxjsVersions = [
    ...collectDependencyVersions(dependencyTree, "rxjs"),
  ].sort();
  const reflectMetadataVersions = [
    ...collectDependencyVersions(dependencyTree, "reflect-metadata"),
  ].sort();
  const rxjsInstallPaths = collectPhysicalDependencyPaths("rxjs");
  const reflectMetadataInstallPaths =
    collectPhysicalDependencyPaths("reflect-metadata");
  assertExact(rxjsVersions, ["7.8.2"], "Modern installed RxJS versions");
  assertExact(
    reflectMetadataVersions,
    ["0.2.2"],
    "Modern installed reflect-metadata versions",
  );
  assert(
    rxjsInstallPaths.length === 1,
    `Expected one modern physical RxJS installation, received ${rxjsInstallPaths.length}.`,
  );
  assert(
    reflectMetadataInstallPaths.length === 1,
    `Expected one modern physical reflect-metadata installation, received ${reflectMetadataInstallPaths.length}.`,
  );

  const outputMetadata = Object.values(buildResult.metafile.outputs)[0];
  assert(outputMetadata, "Modern build reported no output metadata.");
  const pathMappings = [
    [realpathSync(fixtureRoot), "<fixture>"],
    [realpathSync(packageRoot), "<workspace-package>"],
    [realpathSync(runRoot), "<run>"],
  ].sort((left, right) => right[0].length - left[0].length);
  const largestModules = Object.entries(outputMetadata.inputs ?? {})
    .map(([path, metadata]) => ({
      bytes: metadata.bytesInOutput,
      path: sanitizeModulePath(path, pathMappings),
    }))
    .filter(({ bytes }) => bytes > 0)
    .sort(
      (left, right) =>
        right.bytes - left.bytes || left.path.localeCompare(right.path),
    )
    .slice(0, 10);
  assert(
    largestModules.every(
      ({ path }) =>
        !path.includes(realpathSync(runRoot)) &&
        !path.includes(realpathSync(packageRoot)),
    ),
    "Modern largest-module reporting exposed an unstable absolute path.",
  );
  reportStage("clean modern packed consumer lifecycle completed");
  console.log(
    JSON.stringify(
      {
        bundle: {
          asset: "consumer.mjs",
          brotliBytes: brotliCompressSync(bundle).byteLength,
          forbiddenRuntimeModuleCount,
          gzipBytes: gzipSync(bundle).byteLength,
          largestModules,
          largestModuleByteBasis: "esbuild-bytes-in-output",
          minifiedBytes: bundle.byteLength,
          moduleCount: inputPaths.length,
          moduleCountBasis: "esbuild-metafile-input-count",
          totalBytes: bundle.byteLength,
          uncompressedBytes: bundle.byteLength,
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
          scripts: "disabled",
        },
        package: {
          declaredRuntimeDependencies: Object.keys(
            fixtureManifest.dependencies,
          ),
          installedFromTarball: true,
          selectedExport: "browser",
        },
        tooling: {
          esbuild: esbuildPackage.version,
          node: process.version,
          npm: npmVersion,
        },
      },
      null,
      2,
    ),
  );
  runCompleted = true;
} finally {
  try {
    rmSync(runRoot, { force: true, recursive: true });
  } catch (error) {
    if (runCompleted) {
      throw new Error("Modern disposable consumer cleanup failed.", {
        cause: error,
      });
    }
    reportStage("cleanup also failed; preserving the primary failure");
  }
}
