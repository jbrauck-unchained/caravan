# Offline Ledger SDK contract admission gate

## Current state

The real-SDK contract is **blocked by external inputs and has not run**. This
directory does not claim SDK/mock compatibility. It provides a fail-closed
admission gate, an explicit private-release lock, and a process-local
loopback-only network policy while the approved harness inputs are absent.

`contract.config.json` deliberately records `blocked-external` with null
approval, provenance, mock, fixture, and runner records. Do not replace those
nulls with values copied from a developer checkout. In particular,
a local sibling SDK checkout, a floating branch, a mutable image tag, or a
private mock package added to Caravan dependencies is not acceptable evidence.

No script here contacts a Ledger service. The network self-test invokes guarded
APIs with a Ledger hostname only after replacing every exercised adapter with an
inert sentinel; it proves the policy rejects the attempt before any DNS or
network adapter can run.

## Commands and exit meaning

Run these from `packages/caravan-ledger`:

```sh
node test/sdk-contract/gate.mjs guard
node test/sdk-contract/gate.mjs required
node test/sdk-contract/gate.mjs release
node test/sdk-contract/gate.mjs network-self-test
```

- `guard` is suitable for ordinary package CI. Today it exits zero only after
  proving that the package remains private at `0.0.0`, no Ledger changeset is
  present, runtime pins and resolved npm artifacts remain exact, contract test
  files stay outside the packed allowlist, the checked-in state is explicitly
  blocked, the required path rejects that state, and the inert network-policy
  self-test passes. Its output says `ledger_release=DENIED` and
  `contract=BLOCKED_EXTERNAL`; it is not a contract-test pass.
- `required` is the canary/stable SDK-contract command. It exits nonzero today
  with `immutable-provenance-absent`. There is no environment-variable skip or
  local-path override.
- `release` permits unrelated Caravan releases only while the Ledger package is
  private `0.0.0` and has no changeset. Opening any of those locks makes it take
  the mandatory `required` path, which cannot silently skip.
- `network-self-test` checks the process-local deny policy alone. It is useful
  engineering evidence, not proof of an OS firewall or real SDK behavior.

The gate-owned stable status line intentionally contains no source path, URL,
device/session identifier, protocol response, or raw service diagnostic.
Unexpected gate failures use a generic code instead of printing a stack;
package-manager wrappers may still add their standard workspace metadata.

## Inputs required before the real suite can exist

An owner-approved change must replace the blocked record with all of the
following. The gate accepts none of these from environment variables:

1. A named human approval record and HTTPS review URL.
2. The reviewed SDK repository URL and a full 40-character commit SHA.
3. The mock service semantic version, its repository and source commit, and
   either an organization-owned OCI reference ending in
   `@sha256:<64 hex characters>` or an approved exact-commit source build.
4. A digest-pinned mapping from the installed runtime package artifacts and npm
   integrities to the reviewed source, plus a digest-pinned rebuild procedure.
5. An independently reviewed, digest-pinned network isolation launcher.
   Process-local JavaScript interception is defense in depth; release evidence
   also requires an OS/container rule that denies DNS and non-loopback traffic
   for the runner and mock service.
6. Schema-versioned catalog and scenario files plus SHA-256 digests. They must
   contain no production endpoint, credential, real device identifier, or
   customer data and must seed all Manager/ScriptRunner data locally.
7. A digest-pinned, reviewed runner that starts the mock on random loopback
   ports, health-checks it, creates fresh device/session state per scenario,
   runs production `dmkAdapter` and `actionRunner` code, and always stops the
   service while retaining only sanitized diagnostics.

The present `required` command intentionally still fails with
`approved-offline-runner-not-implemented` after descriptor admission. That
failure must only be replaced when the real start/health/run/stop
implementation and its fixtures can be reviewed together. Merely filling out
the JSON cannot turn this gate green.

There is also a pinned-SDK behavior blocker: DMK `1.7.1` currently presents
both a genuine empty app inventory and completion without a result as
`installedApps: []`. Caravan conservatively rejects that ambiguous value, so a
fresh zero-app device cannot yet reach the Bitcoin-absent plan. The contract
cannot approve that scenario until a reviewed SDK patch or upgrade provides a
trusted distinction; simply accepting every empty array would fail closed-state
requirements.

## Required fixture and behavior contract

The semantic scenario list in `contract.config.json` is fixed so that sanitized
results need not expose raw status words. The reviewed fixtures must internally
cover genuine true/false and certificate failure; Bitcoin absent/present;
successful install; both user-refusal responses (`5501`, `6985`); both locked
responses (`5515`, `6982`); action/certificate failure (`6d00`); out of memory
(`6a84`); already installed (`6a80`); a concurrent already-installed race; a
chosen partial install-block failure; disconnect; WebSocket failure; Manager
failure; cancel; wrapper verification failure; and cross-scenario state
isolation.

The real suite must assert actual SDK state tags, monotonic clamped progress,
terminal completion followed by a separate fresh `ListInstalledApps` action,
cooperative cancellation, and the frozen Caravan error/event mapping. Other
installed applications, hashes, raw protocol/status data, URLs, and
device/session identifiers must never enter public results or CI artifacts.

Fixtures and harness code live under `test/sdk-contract`, while the package
manifest's file allowlist remains `dist`, `README.md`, and `LICENSE`. Mock
transport/client packages, if approved later, are test-only and must never
enter runtime dependencies or the npm tarball.
