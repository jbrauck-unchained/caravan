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

| Control                      | Status            | Current evidence                                                                                                                                |
| ---------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Publication lock             | `verified-static` | `packages/caravan-ledger/package.json` is `private: true`, version `0.0.0`; artifact tests assert both.                                         |
| Runtime pins                 | `verified-static` | Manifest and lock select DMK `1.7.1`, WebHID transport `1.2.4`, and RxJS `7.8.2` exactly. This is not immutable source provenance.              |
| Closed public root           | `verified-static` | One package root export; declarations/runtime are guarded by an exact allowlist and forbidden-surface scan.                                     |
| Package files                | `verified-static` | Manifest allows only `dist`, `README.md`, and `LICENSE`; artifact test expects six packed files and no bundled runtime dependency.              |
| ESM/browser boundary         | `verified-static` | No CommonJS entry; browser and Node/SSR entries are distinct; import probes exist.                                                              |
| TypeDoc input boundary       | `verified-static` | TypeDoc admits direct `packages/*/src/index.ts` entries and explicitly excludes `packages/*/test/**`; private consumer fixtures are not inputs. |
| Model authority              | `verified-static` | The compiled production allowlist is implemented and empty. All known and unknown models fail closed.                                           |
| Service authorization marker | `verified-static` | Internal production-shaped service configuration remains explicitly `unapproved`; release assertion remains fail-closed.                        |
| Generic authority exclusions | `verified-static` | Public contract/artifact scan excludes app name, provider/endpoint, raw action, transport, SDK, APDU, inventory, identifier, and test seams.    |
| SDK contract admission       | `verified-static` | The required path rejects missing provenance; guards accept the blocked state only under the private `0.0.0`/no-changeset lock.                 |
| Contract network policy      | `verified-static` | Loopback-only/DNS-deny interception self-tests with inert adapters; a real SDK run and OS/container isolation remain absent.                    |

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
network-denial trace, final privacy result, wallet/coordinator/root regression,
or release-workflow result is currently claimed. The vendor observation below
is explicitly a dirty authoring-tree characterization, not a `local-pass`,
packed-host transmission result, privacy acceptance, or immutable evidence.

## Required deterministic and artifact gate

Run every row on the exact clean candidate commit with Node/npm and runner/image
identity recorded. A release job must fail when a required offline/browser
contract is absent or skipped.

| Required evidence                                                          | Canonical/current command or required harness                                         | Status                     | Closure requirement                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package lint, type, unit/scenario, private, build, artifact, and consumers | `npm run ci --workspace=@caravan/ledger`                                              | `pending` final-commit run | Immutable CI link and complete output for the exact commit/tarball. The package CI composes the runnable private gates and package gates below, but excludes the native gate.                        |
| Unit/named lifecycle and race scenarios                                    | `npm test --workspace=@caravan/ledger`                                                | `pending` final-commit run | Include finalizer, HID, recovery, and other named `src` scenarios with sanitized deterministic traces; the cross-package handoff is the separate row below.                                          |
| Critical/module and package branch coverage                                | `npm run test:coverage --workspace=@caravan/ledger`                                   | `pending` final-commit run | The command enforces at least 95% package branch coverage without ignore annotations; retain 100% coverage on the small reviewed mapping/policy modules and record any future exclusion explicitly.  |
| Bounded lifecycle model suite                                              | `npm run test:model --workspace=@caravan/ledger`                                      | `pending` final-commit run | Deterministic bounded sequences drive the real facade, compare a reference model, minimize sanitized failures, and prove minimization on an intentionally illegal symbolic trace.                    |
| Immutable offline real-SDK/mock contract                                   | `npm run test:ledger-contract --workspace=@caravan/ledger`                            | `blocked-external`         | Required fails without approved provenance and still fails until a reviewed real runner exists. External source, mock, fixture, and network evidence remain required.                                |
| Synthetic browser behavior and packed browser build                        | `npm run test:browser --workspace=@caravan/ledger`                                    | `pending` final-commit run | Run deterministic activation/lifecycle UI tests, then rebuild, pack, SSR-check, and bundle the private lab from the packed browser entry without treating it as native UI.                           |
| Playwright Chromium with injected WebHID facade                            | `CARAVAN_LEDGER_RUN_NATIVE=1 npm run test:browser-native --workspace=@caravan/ledger` | `pending` final-commit run | CI installs the browser revision managed by exact `@playwright/test` `1.60.0`; the gate fails nonzero when not opted in or when that binary is absent. Record exact browser and runner identities.   |
| Real native chooser and physical WebHID behavior                           | Authorized browser/device matrix harness not yet approved                             | `blocked-external`         | The synthetic facade cannot establish chooser, device, privacy, network, or OS-handle behavior. Written authorization and a pinned browser/OS/device matrix remain required.                         |
| Packed public API/artifact negative checks                                 | `npm run test:artifact --workspace=@caravan/ledger`                                   | `pending` final-commit run | Exact declarations/runtime/files/dependencies plus forbidden identifiers, endpoints, SDK types, sourcemaps, and secrets on the final tarball.                                                        |
| Clean legacy and modern consumer compatibility                             | `npm run test:consumer --workspace=@caravan/ledger`                                   | `pending` final-commit run | Both disposable runners install the exact tarball. The legacy lane pins TypeScript 4.6.4/Webpack 5.64.4 and both lanes enforce their reviewed export/dependency/bundle rules.                        |
| Cross-package separate-click/no-overlap handoff                            | `npm run test:handoff --workspace=@caravan/ledger`                                    | `pending` final-commit run | Prove management release/reconnect gating, a distinct signing click, no runtime installer-to-wallet dependency, and close-once WebUSB ownership.                                                     |
| SSR/Node inert import                                                      | `npm run test:import --workspace=@caravan/ledger`                                     | `pending` final-commit run | No browser globals, permission/device/runtime/network work on import/factory; unsupported facade remains finite.                                                                                     |
| Documentation/TypeDoc                                                      | `npm run docs` plus `npm run test:documentation --workspace=@caravan/ledger`          | `pending` final-commit run | Generated API includes the direct Ledger package entry and excludes nested private consumer fixtures; packed-package examples compile with only public imports and local links/copy remain reviewed. |
| Wallet transport regression                                                | Wallet package test/build commands selected by Caravan CI                             | `pending`                  | Exact owned WebUSB transport close-once/no-overlap suite passes.                                                                                                                                     |
| Coordinator/downstream regression                                          | `npm run build:coordinator` and required coordinator tests/e2e where selected         | `pending`                  | No consumer API/bundle/lifecycle regression; no Trefoil modification is implied.                                                                                                                     |
| Root regression                                                            | `npm run ci`                                                                          | `pending`                  | Complete root build/lint/test on exact commit with no waived failure.                                                                                                                                |
| Changeset/release safety                                                   | `npx changeset status --since=origin/main`, workflow/config review, pack dry-run      | `pending`                  | Prove private package cannot publish; do not add a publishable Changeset while this gate is incomplete.                                                                                              |
| Dependency/license/SBOM/provenance                                         | Approved repository tooling not yet recorded                                          | `pending`                  | Exact shipped transitive graph, licenses/obligations, SBOM, npm integrity, immutable source mapping, and provenance evidence.                                                                        |

`npm run test:private --workspace=@caravan/ledger` composes the model, privacy,
handoff, synthetic browser, and packed browser-build checks. It deliberately
does not invoke `test:browser-native`; an absent or unrequested native browser
must remain a visible nonzero gate state, not a silently skipped success.
`test:consumer` and `test:package` each build when called directly, while the
package path reuses that build for both disposable consumer runners. Package CI
also reuses the build performed by its immediately preceding packed browser-lab
gate instead of rebuilding the same working tree.

`npm run test:ledger-contract:guard --workspace=@caravan/ledger` is an admission
guard in ordinary CI, not the SDK contract. In the current blocked state it can
only report that runtime pins, artifact exclusion, network-deny interception,
and the private `0.0.0`/no-changeset release lock are intact; its stable output
states `ledger_release=DENIED`, `contract=BLOCKED_EXTERNAL`, and
`required_run=NOT_RUN`. A Ledger canary or stable transition must use the
non-skippable `test:ledger-contract` command.
`npm run test:ledger-contract:release-guard --workspace=@caravan/ledger` permits
unrelated Caravan releases while those Ledger locks remain closed, but routes
any public/versioned/changeset transition to the required failing command.

The repository requires Node 24 and npm `11.14.1`; CI currently selects Node 24
by major line rather than recording an exact patch. The final evidence must
record the actual patch and runner image used, not assume equivalence from the
workflow declaration.

## Privacy and network gate

| Requirement                                              | Status                        | Blocker                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Caravan-owned public redaction/forbidden surfaces        | `pending` final artifact      | `npm run test:privacy --workspace=@caravan/ledger` is the runnable authoring characterization for errors, events, plans, results, console, storage, and network tripwires; repeat it against the exact final artifact and packed declarations.                                                              |
| Vendor WebHID `@sentry/minimal` behavior                 | `blocked-external`            | The same privacy command characterizes the resolved WebHID `1.2.4`/Sentry `6.19.7` without a client; the authoring tree observes two host-Hub captures of a wrapper retaining the raw browser error. Exact packed host-client payload/destination evidence and named privacy/authorization approval remain. |
| Exact Ledger HTTPS/WSS/provider/origin/CSP configuration | `blocked-external`            | Written authorization and controlled production configuration are absent. Observed SDK defaults are not permission.                                                                                                                                                                                         |
| Browser secret                                           | `verified-static` design rule | None is accepted. If authorization requires one, stop and redesign; never embed it.                                                                                                                                                                                                                         |
| No-live fallback in offline SDK admission                | `verified-static` enforcement | Required fails before execution without immutable mock evidence. Process-local interception denies DNS/non-loopback requests before inert adapters; real-run and OS-firewall evidence remain absent.                                                                                                        |

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
2. **Immutable SDK/mock contract:** the admission and no-skip command are
   implemented and remain nonzero as designed. Reviewed upstream source and
   resolved npm artifacts are not reconciled; no approved mock source/image,
   rebuild, fixture, runner, or network-isolation digest and no real offline
   contract run are recorded. Pinned DMK `1.7.1` also represents both a genuine
   empty app inventory and stream completion without a result as
   `installedApps: []`; a reviewed SDK patch/upgrade must create a trusted
   distinction before the Bitcoin-absent contract can pass.
3. **Real browser/native UI:** the exact Playwright dependency and its managed
   Chromium exercise the injected WebHID facade, but no approved native chooser,
   physical device, privacy/network, or pinned runner-image matrix is recorded.
4. **Vendor Sentry:** the authoring-tree resolved-runtime characterization
   observes duplicate host-Hub capture and raw-error retention. The exact packed
   bundle with a representative host client,
   serialization/destination/retention evidence, and named acceptance or a
   reviewed mitigation remain absent.
5. **Physical support matrix:** the compiled model allowlist is empty and no
   model/firmware/browser/OS row has authorized physical evidence or sign-off.
   The conservative adapter rejects ambiguous `installedApps: []`, so a genuine
   zero-app device cannot currently prepare; simply accepting the empty array
   would also accept a missing SDK result and is not an approved correction.
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
