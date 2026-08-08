# `@caravan/ledger` private-readiness evidence

- Gate: Phase 6 private package hardening
- Status: **INCOMPLETE — release and live use blocked**
- Package policy: `private: true`, version `0.0.0`
- Evidence date: 2026-08-08
- Intended use of this file: index evidence; never waive a failed or missing
  gate

This package is production-shaped but not production-approved. Local tests and
source inspection do not establish Ledger authorization, immutable SDK/mock
provenance, browser-native behavior, privacy acceptance, physical support, npm
ownership, or human release approval.

## Status vocabulary

| Status             | Meaning                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `verified-static`  | The current repository text directly establishes the stated control. It is not runtime or release evidence.                 |
| `local-pass`       | The named command passed on the authoring working tree. Any later diff invalidates it; immutable CI must repeat it.         |
| `pending`          | Required evidence has not been run, recorded, or tied to the exact final commit/artifact.                                   |
| `blocked-external` | Completion requires authorization, hardware, service/privacy evidence, ownership, or another human-controlled prerequisite. |
| `failed`           | A required check failed. The gate remains closed until a focused correction and rerun.                                      |

`local-pass` must never be promoted to immutable evidence without a clean
commit, CI run/artifact link, exact toolchain/runner identity, and reviewer.

## Verified repository controls

The following controls were inspected in the current source. They must be
rechecked on the final commit and packed tarball.

| Control                      | Status            | Current evidence                                                                                                                             |
| ---------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication lock             | `verified-static` | `packages/caravan-ledger/package.json` is `private: true`, version `0.0.0`; artifact tests assert both.                                      |
| Runtime pins                 | `verified-static` | Manifest and lock select DMK `1.7.1`, WebHID transport `1.2.4`, and RxJS `7.8.2` exactly. This is not immutable source provenance.           |
| Closed public root           | `verified-static` | One package root export; declarations/runtime are guarded by an exact allowlist and forbidden-surface scan.                                  |
| Package files                | `verified-static` | Manifest allows only `dist`, `README.md`, and `LICENSE`; artifact test expects six packed files and no bundled runtime dependency.           |
| ESM/browser boundary         | `verified-static` | No CommonJS entry; browser and Node/SSR entries are distinct; import probes exist.                                                           |
| Model authority              | `verified-static` | The compiled production allowlist is implemented and empty. All known and unknown models fail closed.                                        |
| Service authorization marker | `verified-static` | Internal production-shaped service configuration remains explicitly `unapproved`; release assertion remains fail-closed.                     |
| Generic authority exclusions | `verified-static` | Public contract/artifact scan excludes app name, provider/endpoint, raw action, transport, SDK, APDU, inventory, identifier, and test seams. |

The exact npm artifact is not yet reconciled to reviewed immutable upstream
source. Version strings and lock integrity alone do not close that gap.

## Working-tree observation policy

No current `local-pass` is recorded in this index. Earlier observations were
made on a changing, uncommitted implementation and were superseded by later
source and test integration. Snapshot-specific commit references, test counts,
and warning counts are deliberately not retained as current evidence.

Local runs remain useful engineering feedback, but a gate row below stays
`pending` until the exact clean candidate commit, packed tarball, toolchain,
runner/image, complete output, and reviewer are recorded together. No coverage
percentage, browser binary, native chooser behavior, mock digest,
network-denial trace, privacy canary result, wallet/coordinator/root regression,
or release-workflow result is currently claimed.

## Required deterministic and artifact gate

Run every row on the exact clean candidate commit with Node/npm and runner/image
identity recorded. A release job must fail when a required offline/browser
contract is absent or skipped.

| Required evidence                                                          | Canonical/current command or required harness                                    | Status                     | Closure requirement                                                                                                                                               |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package lint, type, unit/scenario, build, import, artifact, clean consumer | `npm run ci --workspace=@caravan/ledger`                                         | `pending` final-commit run | Immutable CI link and complete output for the exact commit/tarball.                                                                                               |
| Unit/named lifecycle and race scenarios                                    | `npm test --workspace=@caravan/ledger`                                           | `pending` final-commit run | Include finalizer, HID, recovery, and other named `src` scenarios with sanitized deterministic traces; the cross-package handoff is the separate row below.       |
| Critical/module and package branch coverage                                | No approved enforcing script is currently indexed                                | `pending`                  | Enforce reviewed critical-module targets and at least the agreed package target; record exclusions, owner, and expiry rather than gaming coverage.                |
| Bounded lifecycle model suite                                              | No completed model-gate command is currently indexed                             | `pending`                  | Deterministic seeded/exhaustive sequences, minimized sanitized failures, CI budget, and a deliberate invariant-violation proof.                                   |
| Immutable offline real-SDK/mock contract                                   | No approved source/image/digest and no mandatory no-skip command are recorded    | `pending`                  | Record immutable upstream source, mock source/image digest, behavior contract, no-live-network proof, and a release-mode skip failure.                            |
| Browser lab/native WebHID UI                                               | No approved browser binary/image/harness is recorded                             | `pending`                  | Pin binary/image and OS; prove direct-click chooser, cancellation, native events, release timing, console/network capture, and no live fallback.                  |
| Packed public API/artifact negative checks                                 | `npm run test:artifact --workspace=@caravan/ledger`                              | `pending` final-commit run | Exact declarations/runtime/files/dependencies plus forbidden identifiers, endpoints, SDK types, sourcemaps, and secrets on the final tarball.                     |
| Clean consumer compatibility                                               | `npm run test:consumer --workspace=@caravan/ledger`                              | `pending` final-commit run | Fresh cache/install, exact tarball, TypeScript 4.6.4, Webpack 5.64.4, no warnings/polyfills/duplicate critical dependencies; refresh reviewed lifecycle baseline. |
| Cross-package separate-click/no-overlap handoff                            | `npm run test:handoff --workspace=@caravan/ledger`                               | `pending` final-commit run | Prove management release/reconnect gating, a distinct signing click, no runtime installer-to-wallet dependency, and close-once WebUSB ownership.                  |
| SSR/Node inert import                                                      | `npm run test:import --workspace=@caravan/ledger`                                | `pending` final-commit run | No browser globals, permission/device/runtime/network work on import/factory; unsupported facade remains finite.                                                  |
| Documentation/TypeDoc                                                      | `npm run docs` plus repository-approved Markdown/link/forbidden-copy checks      | `pending`                  | Generated API includes the package and examples compile using only public imports; all local/external links and dangerous copy reviewed.                          |
| Wallet transport regression                                                | Wallet package test/build commands selected by Caravan CI                        | `pending`                  | Exact owned WebUSB transport close-once/no-overlap suite passes.                                                                                                  |
| Coordinator/downstream regression                                          | `npm run build:coordinator` and required coordinator tests/e2e where selected    | `pending`                  | No consumer API/bundle/lifecycle regression; no Trefoil modification is implied.                                                                                  |
| Root regression                                                            | `npm run ci`                                                                     | `pending`                  | Complete root build/lint/test on exact commit with no waived failure.                                                                                             |
| Changeset/release safety                                                   | `npx changeset status --since=origin/main`, workflow/config review, pack dry-run | `pending`                  | Prove private package cannot publish; do not add a publishable Changeset while this gate is incomplete.                                                           |
| Dependency/license/SBOM/provenance                                         | Approved repository tooling not yet recorded                                     | `pending`                  | Exact shipped transitive graph, licenses/obligations, SBOM, npm integrity, immutable source mapping, and provenance evidence.                                     |

The repository requires Node 24 and npm `11.14.1`; CI currently selects Node 24
by major line rather than recording an exact patch. The final evidence must
record the actual patch and runner image used, not assume equivalence from the
workflow declaration.

## Privacy and network gate

| Requirement                                              | Status                        | Blocker                                                                                                                                                           |
| -------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caravan-owned public redaction/forbidden surfaces        | `pending` final artifact      | Repeat canary tests across events, results, errors, console, storage, and packed declarations.                                                                    |
| Vendor WebHID `@sentry/minimal` behavior                 | `blocked-external`            | Empirically characterize the exact consumer bundle, payload fields, hub/destination behavior, and mitigation; obtain security/privacy and authorization approval. |
| Exact Ledger HTTPS/WSS/provider/origin/CSP configuration | `blocked-external`            | Written authorization and controlled production configuration are absent. Observed SDK defaults are not permission.                                               |
| Browser secret                                           | `verified-static` design rule | None is accepted. If authorization requires one, stop and redesign; never embed it.                                                                               |
| No-live fallback in offline/browser tests                | `pending`                     | Harness must fail closed on missing mock/service and deny unexpected network, rather than silently reaching production.                                           |

A functional pass cannot downgrade a telemetry, privacy, provenance, or network
finding.

## Explicit Phase 7 blockers

Every item below is unresolved and blocks live use, a canary, support claims,
and publication:

1. **Written Ledger authorization and production configuration:** agreement
   identifier/effective/expiry, actions, environments/origins, exact SDKs,
   endpoints/provider, automated and physical testing permissions, traffic,
   privacy/telemetry, branding/support, monitoring, and incident obligations are
   not approved.
2. **Immutable SDK/mock contract:** reviewed upstream source and resolved npm
   artifacts are not reconciled; no approved mock source/image digest or
   mandatory offline contract run is recorded.
3. **Real browser/native UI:** no pinned browser binary/image or approved native
   chooser/WebHID/privacy/network run is recorded.
4. **Vendor Sentry:** packed WebHID capture behavior and destination/payload
   handling lack empirical evidence and named acceptance/mitigation.
5. **Physical support matrix:** the compiled model allowlist is empty and no
   model/firmware/browser/OS row has authorized physical evidence or sign-off.
6. **Named ownership/enforcement:** all roles in
   [maintenance](./maintenance.md) are unassigned and no verified required-review
   mechanism is recorded.
7. **npm/OIDC bootstrap:** official npm scope/package ownership, trusted
   publisher binding, protected workflow/environment, public access, provenance,
   SBOM, and no-token-fallback evidence are absent.
8. **Canary and downstream proof:** no controlled canary exists; no exact-canary
   clean consumer, authorized physical, privacy, support, rollback, or promotion
   decision exists.
9. **Publication:** the package must remain private `0.0.0`; no release
   Changeset or public manifest transition is authorized.

## Human gate

| Approval                           | Assignment/status                | Required evidence                                                                       |
| ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| Package maintainer                 | **UNASSIGNED — release blocker** | Final deterministic/artifact evidence and implementation acceptance                     |
| Security/privacy reviewer          | **UNASSIGNED — release blocker** | Authority, redaction, dependency, Sentry, network, HID handoff, and incident acceptance |
| Ledger relationship/incident owner | **UNASSIGNED — release blocker** | Written authorization/configuration and incident/renewal acceptance                     |
| Hardware QA owner                  | **UNASSIGNED — release blocker** | Controlled physical matrix and sanitized evidence                                       |
| npm release owner                  | **UNASSIGNED — release blocker** | Trusted publishing/bootstrap, artifact, canary, promotion, and rollback                 |
| Downstream/product contact         | **UNASSIGNED — release blocker** | Consumer lifecycle, support scope, feature-disable, and rollout acceptance              |

## Gate decision

**Not ready for Phase 7 execution, canary, live service use, support claims, or
publication.** Close the pending deterministic rows on the exact final commit,
then obtain the external and human evidence without weakening tests or widening
the public authority. The safe current outcome is a private, unpublished,
fail-closed package.
