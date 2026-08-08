import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(packageRoot, "package.json");
const declarationPath = join(packageRoot, "dist", "index.d.ts");
const runtimePath = join(packageRoot, "dist", "index.js");

const APPROVED_DECLARATION_EXPORTS = [
  "BitcoinAppInstaller",
  "BitcoinInstallPlan",
  "BitcoinInstallResult",
  "BitcoinInstallerError",
  "BitcoinInstallerErrorCode",
  "BitcoinInstallerEvent",
  "BitcoinInstallerInteraction",
  "BitcoinInstallerPhase",
  "BitcoinInstallerSupport",
  "getBitcoinInstallerSupport",
].sort();

const APPROVED_RUNTIME_EXPORTS = [
  "BitcoinInstallerError",
  "getBitcoinInstallerSupport",
].sort();

const APPROVED_PACKED_FILES = [
  "LICENSE",
  "README.md",
  "dist/index.d.ts",
  "dist/index.js",
  "package.json",
].sort();

const FORBIDDEN_DECLARATION_SURFACES = [
  ["Ledger package import", /@ledgerhq/i],
  ["RxJS", /\brxjs\b/i],
  [
    "reactive SDK type",
    /\b(?:Observable|OperatorFunction|Subject|Subscriber|Subscription)\b/,
  ],
  ["XState", /\bxstate\b/i],
  ["HID type", /\b(?:HID(?:[A-Z][A-Za-z0-9_]*)?|WebHid[A-Z][A-Za-z0-9_]*)\b/],
  ["device identifier", /\bDeviceId\b/],
  ["device session identifier", /\bDeviceSessionId\b/],
  ["session detail", /\bsession(?:[A-Z][A-Za-z0-9_]*)?\b/i],
  [
    "app inventory",
    /\b(?:installedApps?|inventor(?:y|ies)|(?:app|application)Hash|hash_code_data)\b/i,
  ],
  ["provider", /\bprovider(?:Id)?\b/i],
  ["endpoint", /\b(?:endpoint(?:Url)?|managerApiUrl|scriptRunnerUrl)\b/i],
  ["APDU", /\bAPDU\b/i],
  ["generic app authority", /\b(?:app|application)Name\b/i],
  ["internal port", /\b(?:DmkPort|HidPort|PlanStore)\b/],
  ["test seam", /\b(?:ScriptedDmk|FakeDmk|TestDmk)\b/],
];

const APPROVED_DEV_DEPENDENCIES = [
  "@caravan/eslint-config@*",
  "@caravan/typescript-config@*",
  "typescript@^5.3.3",
].sort();

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

function declarationExports(path) {
  const program = ts.createProgram([path], {
    module: ts.ModuleKind.ESNext,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  });
  const source = program.getSourceFile(path);
  assert(source, "Built declaration entry could not be parsed.");
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert(
    diagnostics.length === 0,
    `Built declarations have TypeScript diagnostics: ${ts.formatDiagnostics(
      diagnostics,
      {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => packageRoot,
        getNewLine: () => "\n",
      },
    )}`,
  );
  const moduleSymbol = program.getTypeChecker().getSymbolAtLocation(source);
  assert(moduleSymbol, "Built declaration entry is not an external module.");
  return program
    .getTypeChecker()
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.getName());
}

const manifest = readJson(manifestPath);
const rootExport = manifest.exports?.["."];
assert(manifest.name === "@caravan/ledger", "Unexpected package name.");
assert(manifest.version === "0.0.0", "Foundation version must remain 0.0.0.");
assert(manifest.private === true, "Foundation package must remain private.");
assert(manifest.type === "module", "Package must remain ESM-only.");
assert(!Object.hasOwn(manifest, "main"), "A CommonJS main entry is forbidden.");
assert(
  manifest.types === "./dist/index.d.ts",
  "Unexpected top-level declaration entry.",
);
assert(manifest.module === "./dist/index.js", "Unexpected module entry.");
assert(manifest.browser === "./dist/index.js", "Unexpected browser entry.");
assert(
  !Object.hasOwn(manifest, "sideEffects"),
  "sideEffects must remain unset until the SDK artifact review allows it.",
);
assert(!Object.hasOwn(manifest, "bin"), "Package executables are forbidden.");
assert(
  !Object.hasOwn(manifest, "peerDependencies"),
  "The reviewed runtime dependencies must not be shifted to peers.",
);
assert(
  !Object.hasOwn(manifest, "overrides"),
  "Package-local dependency overrides are not approved.",
);
assert(
  rootExport && typeof rootExport === "object",
  "Root export map is missing.",
);
assertExact(Object.keys(manifest.exports), ["."], "Package export subpaths");
assertExact(
  Object.keys(rootExport),
  ["browser", "import", "types"],
  "Root export conditions",
);
assert(
  !Object.hasOwn(rootExport, "require"),
  "A CommonJS require condition is forbidden.",
);
assert(
  rootExport.types === "./dist/index.d.ts",
  "Unexpected declaration entry.",
);
assert(rootExport.import === "./dist/index.js", "Unexpected ESM entry.");
assert(rootExport.browser === "./dist/index.js", "Unexpected browser entry.");
assertExact(
  manifest.files,
  ["dist", "README.md", "LICENSE"],
  "Manifest file allowlist",
);
assertExact(
  Object.entries(manifest.devDependencies ?? {}).map(
    ([name, version]) => `${name}@${version}`,
  ),
  APPROVED_DEV_DEPENDENCIES,
  "Package development dependencies",
);
for (const lifecycleScript of [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
]) {
  assert(
    !Object.hasOwn(manifest.scripts ?? {}, lifecycleScript),
    `Package lifecycle script ${lifecycleScript} is forbidden.`,
  );
}
assertExact(
  Object.entries(manifest.dependencies).map(
    ([name, version]) => `${name}@${version}`,
  ),
  [
    "@ledgerhq/device-management-kit@1.7.1",
    "@ledgerhq/device-transport-kit-web-hid@1.2.4",
    "rxjs@7.8.2",
  ],
  "Runtime dependency pins",
);

const declarationText = readFileSync(declarationPath, "utf8");
const runtimeText = readFileSync(runtimePath, "utf8");
assertExact(
  declarationExports(declarationPath),
  APPROVED_DECLARATION_EXPORTS,
  "Public declaration exports",
);
for (const [label, pattern] of FORBIDDEN_DECLARATION_SURFACES) {
  assert(
    !pattern.test(declarationText),
    `Built declarations expose forbidden ${label}.`,
  );
}
for (const pattern of [
  /@ledgerhq/i,
  /\brxjs\b/i,
  /reflect-metadata/i,
  /\brequire\s*\(/,
  /\bmodule\.exports\b/,
  /["']node:(?:assert|buffer|crypto|events|fs|http|https|net|os|path|process|stream|tls|url|util|vm|zlib)/,
]) {
  assert(
    !pattern.test(runtimeText),
    `Built runtime contains forbidden dependency surface ${pattern}.`,
  );
}

const runtimeModule = await import(
  `${pathToFileURL(runtimePath).href}?artifact-contract`
);
assertExact(
  Object.keys(runtimeModule),
  APPROVED_RUNTIME_EXPORTS,
  "Public runtime exports",
);

const npmCache = mkdtempSync(join(tmpdir(), "caravan-ledger-artifact-npm-"));
let packResult;
try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_PATH: "",
        npm_config_audit: "false",
        npm_config_cache: npmCache,
        npm_config_fund: "false",
        npm_config_update_notifier: "false",
      },
    },
  );
  [packResult] = JSON.parse(packOutput);
} finally {
  rmSync(npmCache, { force: true, recursive: true });
}

assert(packResult, "npm pack did not describe an artifact.");
assert(packResult.name === "@caravan/ledger", "Packed the wrong package.");
assert(packResult.version === "0.0.0", "Packed package version changed.");
assertExact(
  packResult.files.map(({ path }) => path),
  APPROVED_PACKED_FILES,
  "Packed file allowlist",
);
assert(
  Array.isArray(packResult.bundled) && packResult.bundled.length === 0,
  "Runtime dependencies must remain external rather than bundled into the tarball.",
);

console.log(
  JSON.stringify(
    {
      declarationExports: APPROVED_DECLARATION_EXPORTS,
      packedFiles: APPROVED_PACKED_FILES,
      runtimeExports: APPROVED_RUNTIME_EXPORTS,
    },
    null,
    2,
  ),
);
