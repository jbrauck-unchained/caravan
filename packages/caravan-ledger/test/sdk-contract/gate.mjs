import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runNetworkPolicySelfTest } from "./network-policy.mjs";

const contractRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(contractRoot, "../..");
const repositoryRoot = resolve(packageRoot, "../..");
const configPath = join(contractRoot, "contract.config.json");
const packageManifestPath = join(packageRoot, "package.json");
const packageLockPath = join(repositoryRoot, "package-lock.json");
const changesetRoot = join(repositoryRoot, ".changeset");

const RUNTIME_PINS = Object.freeze({
  "@ledgerhq/device-management-kit": "1.7.1",
  "@ledgerhq/device-transport-kit-web-hid": "1.2.4",
  rxjs: "7.8.2",
});

const LOCK_PACKAGES = Object.freeze({
  "@ledgerhq/device-management-kit":
    "packages/caravan-ledger/node_modules/@ledgerhq/device-management-kit",
  "@ledgerhq/device-transport-kit-web-hid":
    "packages/caravan-ledger/node_modules/@ledgerhq/device-transport-kit-web-hid",
  rxjs: "packages/caravan-ledger/node_modules/rxjs",
});

const NETWORK_POLICY = Object.freeze({
  allowedHosts: ["127.0.0.1", "::1"],
  dns: "deny",
  liveFallback: "deny",
  explicitRandomPorts: true,
});

const REQUIRED_SCENARIOS = Object.freeze([
  "genuine-true",
  "genuine-false",
  "genuine-certificate-failure",
  "bitcoin-absent",
  "bitcoin-present",
  "install-success",
  "user-refusal-primary",
  "user-refusal-secondary",
  "device-locked-primary",
  "device-locked-secondary",
  "action-failure",
  "out-of-memory",
  "already-installed",
  "concurrent-already-installed",
  "partial-install-block-failure",
  "disconnect",
  "websocket-failure",
  "manager-failure",
  "cancel",
  "post-install-verification-failure",
  "state-isolation",
]);

const BLOCKERS = Object.freeze([
  "Reviewed SDK repository and immutable source commit",
  "Reconciled runtime package integrity-to-source map",
  "Approved mock-service source or OCI digest and rebuild procedure",
  "Schema-pinned catalog and scenario fixture digests",
  "Trusted empty-inventory versus missing-result SDK distinction",
  "Reviewed offline real-SDK runner and OS-level network isolation",
  "Named supply-chain and security approval record",
]);

class ContractGateError extends Error {
  constructor(code) {
    super(code);
    this.name = "ContractGateError";
    this.code = code;
  }
}

function fail(code) {
  throw new ContractGateError(code);
}

function assertGate(condition, code) {
  if (!condition) fail(code);
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(code);
  }
}

function sortedEntries(value) {
  return Object.entries(value ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
}

function assertExactObject(actual, expected, code) {
  assertGate(
    JSON.stringify(sortedEntries(actual)) ===
      JSON.stringify(sortedEntries(expected)),
    code,
  );
}

function assertExactArray(actual, expected, code) {
  assertGate(
    Array.isArray(actual) &&
      JSON.stringify(actual) === JSON.stringify(expected),
    code,
  );
}

function assertObjectKeys(actual, expected, code) {
  assertGate(actual && typeof actual === "object", code);
  assertExactArray(Object.keys(actual).sort(), [...expected].sort(), code);
}

function assertRuntimePins(manifest, lock, config) {
  assertExactObject(
    manifest.dependencies,
    RUNTIME_PINS,
    "runtime-dependency-pins-changed",
  );
  assertExactObject(
    lock.packages?.["packages/caravan-ledger"]?.dependencies,
    RUNTIME_PINS,
    "workspace-lock-pins-changed",
  );
  assertExactObject(
    config.runtimePins,
    RUNTIME_PINS,
    "contract-runtime-pins-changed",
  );

  for (const [name, version] of Object.entries(RUNTIME_PINS)) {
    const lockEntry = lock.packages?.[LOCK_PACKAGES[name]];
    assertGate(lockEntry?.version === version, "resolved-runtime-pin-changed");
    assertGate(
      typeof lockEntry.integrity === "string" &&
        lockEntry.integrity.startsWith("sha512-"),
      "resolved-runtime-integrity-missing",
    );
    assertGate(
      typeof lockEntry.resolved === "string" &&
        (() => {
          try {
            return (
              new URL(lockEntry.resolved).hostname === "registry.npmjs.org"
            );
          } catch {
            return false;
          }
        })(),
      "resolved-runtime-source-unexpected",
    );
  }
}

function assertPackageBoundary(manifest) {
  assertGate(manifest.name === "@caravan/ledger", "package-name-changed");
  assertExactArray(
    manifest.files,
    ["dist", "README.md", "LICENSE"],
    "package-files-changed",
  );
  assertGate(
    manifest.files.every(
      (entry) =>
        typeof entry === "string" &&
        entry !== "test" &&
        !entry.startsWith("test/") &&
        entry !== "test\\" &&
        !entry.startsWith("test\\"),
    ),
    "contract-infrastructure-entered-package",
  );
  for (const [name, value] of Object.entries(manifest.dependencies ?? {})) {
    assertGate(
      !/mock(?:server)?/iu.test(name),
      "mock-runtime-dependency-present",
    );
    assertGate(
      typeof value === "string" && !isLocalReference(value),
      "local-runtime-dependency-present",
    );
  }
}

function isLocalReference(value) {
  return (
    isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    /^\\\\/u.test(value) ||
    /^~/u.test(value) ||
    /^(?:file|link|workspace):/iu.test(value)
  );
}

function ledgerChangesets() {
  assertGate(existsSync(changesetRoot), "changeset-directory-missing");
  return readdirSync(changesetRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name !== "README.md",
    )
    .filter((entry) => {
      const text = readFileSync(join(changesetRoot, entry.name), "utf8");
      const frontmatter = text.split(/^---\s*$/mu)[1] ?? "";
      return /^\s*["']?@caravan\/ledger["']?\s*:/mu.test(frontmatter);
    })
    .map((entry) => entry.name)
    .sort();
}

function assertReleaseLocked(manifest) {
  assertGate(manifest.private === true, "private-release-lock-open");
  assertGate(manifest.version === "0.0.0", "foundation-version-lock-open");
  assertGate(ledgerChangesets().length === 0, "ledger-changeset-present");
}

function assertBlockedConfig(config) {
  assertObjectKeys(
    config,
    [
      "schemaVersion",
      "status",
      "runtimePins",
      "networkPolicy",
      "requiredScenarios",
      "approval",
      "provenance",
      "mockService",
      "fixtures",
      "runner",
      "blockers",
    ],
    "blocked-contract-record-shape-changed",
  );
  assertGate(config.schemaVersion === 1, "contract-schema-version-changed");
  assertGate(config.status === "blocked-external", "blocked-state-changed");
  assertExactObject(
    config.networkPolicy,
    NETWORK_POLICY,
    "network-policy-config-changed",
  );
  assertExactArray(
    config.requiredScenarios,
    REQUIRED_SCENARIOS,
    "required-scenario-set-changed",
  );
  for (const key of [
    "approval",
    "provenance",
    "mockService",
    "fixtures",
    "runner",
  ]) {
    assertGate(config[key] === null, "unapproved-contract-evidence-present");
  }
  assertExactArray(
    config.blockers,
    BLOCKERS,
    "external-blocker-record-invalid",
  );
}

function assertHttpsUrl(value, code) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(code);
  }
  const hostname = parsed.hostname
    .replace(/^\[|\]$/gu, "")
    .replace(/\.$/u, "")
    .toLowerCase();
  assertGate(
    parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      hostname !== "localhost" &&
      !hostname.endsWith(".localhost") &&
      isIP(hostname) === 0,
    code,
  );
  return parsed;
}

function assertGitRepositoryUrl(value, code) {
  const parsed = assertHttpsUrl(value, code);
  assertGate(
    parsed.pathname.endsWith(".git") &&
      !/(?:^|\/)(?:tree|blob|commit|commits|refs|archive)(?:\/|$)/iu.test(
        parsed.pathname,
      ),
    code,
  );
}

function assertCommit(value, code) {
  assertGate(typeof value === "string" && /^[a-f0-9]{40}$/u.test(value), code);
}

function assertDigest(value, code) {
  assertGate(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), code);
}

function resolvePinnedFile(entry, label) {
  assertGate(entry && typeof entry === "object", `${label}-record-missing`);
  assertObjectKeys(entry, ["path", "sha256"], `${label}-record-invalid`);
  assertGate(
    typeof entry.path === "string" &&
      entry.path.length > 0 &&
      !isLocalReference(entry.path) &&
      !entry.path.split(/[\\/]/u).includes("..") &&
      !entry.path.split(/[\\/]/u).includes("."),
    `${label}-path-invalid`,
  );
  assertDigest(entry.sha256, `${label}-digest-invalid`);
  const path = resolve(contractRoot, entry.path);
  const relativePath = relative(contractRoot, path);
  assertGate(
    relativePath !== "" &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`),
    `${label}-path-escaped`,
  );
  assertGate(
    existsSync(path) && lstatSync(path).isFile(),
    `${label}-file-missing`,
  );
  const actualDigest = createHash("sha256")
    .update(readFileSync(path))
    .digest("hex");
  assertGate(actualDigest === entry.sha256, `${label}-digest-mismatch`);
  return path;
}

function assertNoMutableOrLocalStrings(value, key = "contract") {
  if (typeof value === "string") {
    assertGate(
      !isLocalReference(value) &&
        !/(?:^|[/:@_-])(?:main|master|develop|development|latest|next)(?:$|[/:@_.-])/iu.test(
          value,
        ) &&
        !/(?:TODO|TBD|REPLACE_ME|EXAMPLE|PLACEHOLDER|UNAPPROVED|PENDING)/iu.test(
          value,
        ),
      `${key}-mutable-or-local-value`,
    );
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoMutableOrLocalStrings(item, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      assertNoMutableOrLocalStrings(childValue, `${key}-${childKey}`);
    }
  }
}

function assertApprovedConfig(config) {
  assertGate(config.schemaVersion === 1, "contract-schema-version-changed");
  assertGate(config.status === "approved", "immutable-provenance-absent");
  assertObjectKeys(
    config,
    [
      "schemaVersion",
      "status",
      "runtimePins",
      "networkPolicy",
      "requiredScenarios",
      "approval",
      "provenance",
      "mockService",
      "fixtures",
      "runner",
      "networkIsolation",
    ],
    "approved-contract-record-invalid",
  );
  assertExactObject(
    config.networkPolicy,
    NETWORK_POLICY,
    "network-policy-config-changed",
  );
  assertExactArray(
    config.requiredScenarios,
    REQUIRED_SCENARIOS,
    "required-scenario-set-changed",
  );

  assertObjectKeys(
    config.approval,
    ["status", "recordUrl", "reviewer"],
    "approval-record-invalid",
  );
  assertGate(config.approval.status === "approved", "approval-record-missing");
  assertHttpsUrl(config.approval.recordUrl, "approval-record-url-invalid");
  assertGate(
    typeof config.approval.reviewer === "string" &&
      config.approval.reviewer.length >= 3,
    "approval-reviewer-missing",
  );

  assertObjectKeys(
    config.provenance,
    [
      "sdkRepository",
      "sdkCommit",
      "mockServiceVersion",
      "mockSource",
      "rebuildProcedure",
      "runtimeArtifactMap",
    ],
    "provenance-record-invalid",
  );
  assertGitRepositoryUrl(
    config.provenance.sdkRepository,
    "sdk-repository-url-invalid",
  );
  assertCommit(config.provenance.sdkCommit, "sdk-commit-invalid");
  assertGate(
    typeof config.provenance?.mockServiceVersion === "string" &&
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(
        config.provenance.mockServiceVersion,
      ),
    "mock-service-version-invalid",
  );
  assertGate(
    ["oci", "git"].includes(config.provenance?.mockSource?.kind),
    "mock-source-kind-invalid",
  );
  assertObjectKeys(
    config.provenance.mockSource,
    config.provenance.mockSource.kind === "oci"
      ? ["kind", "repository", "commit", "image"]
      : ["kind", "repository", "commit"],
    "mock-source-record-invalid",
  );
  assertGitRepositoryUrl(
    config.provenance?.mockSource?.repository,
    "mock-source-url-invalid",
  );
  assertCommit(
    config.provenance?.mockSource?.commit,
    "mock-source-commit-invalid",
  );
  if (config.provenance.mockSource.kind === "oci") {
    assertGate(
      typeof config.provenance.mockSource.image === "string" &&
        /^[a-z0-9.-]+(?::[1-9][0-9]{0,4})?\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/u.test(
          config.provenance.mockSource.image,
        ),
      "mock-image-digest-invalid",
    );
    const registry = config.provenance.mockSource.image.split("/", 1)[0];
    const registryHost = registry
      .replace(/:[1-9][0-9]{0,4}$/u, "")
      .replace(/\.$/u, "");
    assertGate(
      registryHost !== "localhost" &&
        !registryHost.endsWith(".localhost") &&
        isIP(registryHost) === 0 &&
        !/^[0-9.]+$/u.test(registryHost),
      "mock-image-registry-invalid",
    );
  } else {
    assertGate(
      config.provenance.mockSource.image === undefined,
      "git-mock-source-has-image",
    );
  }
  resolvePinnedFile(config.provenance.rebuildProcedure, "rebuild-procedure");
  resolvePinnedFile(
    config.provenance.runtimeArtifactMap,
    "runtime-artifact-map",
  );

  assertObjectKeys(
    config.mockService,
    [
      "fixtureSchemaVersion",
      "randomLoopbackPorts",
      "freshStatePerScenario",
      "liveFallback",
    ],
    "mock-service-record-invalid",
  );
  assertGate(
    typeof config.mockService?.fixtureSchemaVersion === "string" &&
      /^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(
        config.mockService.fixtureSchemaVersion,
      ),
    "fixture-schema-version-invalid",
  );
  assertGate(
    config.mockService?.randomLoopbackPorts === true &&
      config.mockService?.freshStatePerScenario === true &&
      config.mockService?.liveFallback === false,
    "mock-service-policy-invalid",
  );

  assertObjectKeys(
    config.fixtures,
    ["catalog", "scenarios"],
    "fixture-record-invalid",
  );
  resolvePinnedFile(config.fixtures.catalog, "catalog-fixture");
  resolvePinnedFile(config.fixtures.scenarios, "scenario-fixture");
  resolvePinnedFile(config.runner, "contract-runner");
  resolvePinnedFile(config.networkIsolation, "network-isolation-launcher");
  assertNoMutableOrLocalStrings(config);
}

function blockedRequiredCode(config) {
  try {
    assertApprovedConfig(config);
  } catch (error) {
    if (error instanceof ContractGateError) return error.code;
    throw error;
  }
  return null;
}

async function runRequired(config) {
  assertApprovedConfig(config);

  // The approved descriptor and its runner do not exist yet. Do not turn this
  // admission check into a false contract pass by executing an unreviewed local
  // checkout, a mutable source, or an arbitrary command supplied via an env var.
  // When those artifacts are approved, this branch must be replaced by reviewed
  // start/health/run/stop orchestration under independently enforced network
  // isolation, with its own correction review.
  fail("approved-offline-runner-not-implemented");
}

async function main() {
  const mode = process.argv[2];
  assertGate(
    ["guard", "release", "required", "network-self-test"].includes(mode),
    "usage",
  );

  await runNetworkPolicySelfTest();
  if (mode === "network-self-test") {
    process.stdout.write(
      "LEDGER_CONTRACT_NETWORK_POLICY_ACTIVE live_and_dns_adapters=not_reached\n",
    );
    return;
  }

  const manifest = readJson(packageManifestPath, "package-manifest-invalid");
  const lock = readJson(packageLockPath, "package-lock-invalid");
  const config = readJson(configPath, "contract-config-invalid");
  assertPackageBoundary(manifest);
  assertRuntimePins(manifest, lock, config);

  if (mode === "required") {
    await runRequired(config);
    return;
  }

  if (config.status === "blocked-external") {
    assertBlockedConfig(config);
    assertReleaseLocked(manifest);
    assertGate(
      blockedRequiredCode(config) === "immutable-provenance-absent",
      "required-gate-did-not-fail-closed",
    );
    const label =
      mode === "release"
        ? "LEDGER_CONTRACT_RELEASE_LOCK_ACTIVE"
        : "LEDGER_CONTRACT_CI_GUARD_ACTIVE";
    process.stdout.write(
      `${label} package=private@0.0.0 ledger_release=DENIED contract=BLOCKED_EXTERNAL required_run=NOT_RUN\n`,
    );
    return;
  }

  // Once an approved descriptor exists, neither ordinary CI nor release may
  // take the private-lock shortcut: both must execute the required contract.
  await runRequired(config);
}

try {
  await main();
} catch (error) {
  const code =
    error instanceof ContractGateError ? error.code : "unexpected-gate-error";
  process.stderr.write(`LEDGER_CONTRACT_BLOCKED code=${code}\n`);
  process.exitCode = 1;
}
