# Ledger Bitcoin app installer threat model

- Status: Proposed implementation baseline
- Scope: `@caravan/ledger` v0.1 browser management flow and its WebUSB handoff
- Review: Security, product, Caravan engineering, and release review pending
- Live Ledger authorization: Pending; see the [authorization gate](./authorization-gate.md)

## Security objective

Provide one narrow capability: after a direct user gesture, determine whether a
genuine, explicitly supported Ledger has the official app named exactly
`Bitcoin`; install it only when absent; independently prove the result; make one
fixed best-effort attempt to open it; and release WebHID before the consumer
starts Caravan's existing WebUSB signing flow.

The package reduces authority and data exposure around Ledger's DMK. It does
not protect against arbitrary code already executing in the same origin, and it
does not replace consumer authentication, entitlement, or feature gating.

## System and trust boundaries

```text
user gesture
    |
consumer JavaScript (auth, policy, UX, rollout)
    |
@caravan/ledger (fixed Bitcoin authority, state, redaction, cleanup)
    |
browser WebHID permission and selected HIDDevice
    |
Ledger DMK and WebHID transport (vendor protocol and error surface)
    |                         |
physical Ledger screen       Ledger Manager API / ScriptRunner HSM
    |
WebHID release barrier
    |
later user gesture -> @caravan/wallets -> WebUSB signing
```

Trust assumptions and limits:

1. The browser enforces WebHID permission and secure-context requirements.
2. The user reads and confirms or refuses prompts on the physical device.
3. The pinned Ledger packages implement the protocol reviewed for the release.
4. Ledger backend access is unavailable until a written agreement approves the
   exact origins, actions, endpoints, provider, versions, and testing.
5. The consumer decides who may see or invoke the UI. The package constrains
   method authority but cannot defend against a malicious same-origin caller.
6. `@caravan/wallets` owns WebUSB only after the management handle is released.

## Protected assets

- User trust in what the browser and device are asking them to approve.
- Integrity of the official Bitcoin application state.
- Availability of the device for later signing and other applications.
- Browser permission and transport ownership.
- Privacy of device metadata, runtime identifiers, and installed applications.
- Ledger partner authorization and backend service integrity.
- Correct classification of a proven, failed, cancelled, or unknown mutation.

The flow does not handle seed words or private keys. Device-management mistakes
can nevertheless create denial of service, privacy exposure, misleading UI, or
an unexpected application state.

## Threat register

| ID  | Owner                                 | Threat and impact                                                                                                                                                                            | Required mitigation                                                                                                                                                                                                                                                                          | Verification                                                                                                                                                                                                                                      | Residual risk                                                                                                                                |
| --- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | Consumer and package                  | Malicious or compromised same-origin code invokes management without product entitlement.                                                                                                    | Consumer enforces auth/flags; package exports only the bounded workflow and never a generic action, app, APDU, provider, or endpoint input.                                                                                                                                                  | Public-export and declaration allowlist; consumer review in integration and release phases.                                                                                                                                                       | Same-origin code can still call every exported method and prompt the user.                                                                   |
| T2  | Package                               | Caller-controlled app names or SDK escape hatches install/uninstall/manage something other than Bitcoin.                                                                                     | Keep `Bitcoin` as a private constant; no generic action runner, raw DMK object, uninstall, update, firmware, provider, or endpoint API.                                                                                                                                                      | Source/API review plus packed declaration and export-contract tests.                                                                                                                                                                              | A compromised vendor dependency retains broader internal capability.                                                                         |
| T3  | Package                               | A non-genuine, unknown, or unapproved model reaches mutation.                                                                                                                                | Immediately after connection, apply the compiled model allowlist before genuine check or any other management action; then require genuine success. Remote policy may only narrow.                                                                                                           | Preparation tests prove an unknown/unapproved model executes no genuine/list/install action; physical evidence is required before allowlisting.                                                                                                   | Genuine check depends on the vendor protocol and an authorized backend.                                                                      |
| T4  | Package                               | A stale, copied, forged, serialized, or cross-instance plan installs against another session.                                                                                                | Opaque object identity plus private nonce; bind to installer generation and session generation; bounded expiry; single-use consumption; invalidate on disconnect, dispose, or terminal error.                                                                                                | Plan-store unit tests for replay, expiry, forgery, cross-instance/session use, and invalidation.                                                                                                                                                  | TypeScript opacity alone is not a boundary; runtime validation is mandatory.                                                                 |
| T5  | Package                               | Two instances or overlapping methods race discovery, session ownership, or mutation.                                                                                                         | One operation per instance and one runtime-wide management lease; reject overlap deterministically; cleanup releases the lease once.                                                                                                                                                         | Deterministic concurrency and late-callback tests.                                                                                                                                                                                                | Separate browser contexts may still contend at the OS/device level.                                                                          |
| T6  | Consumer and package                  | An async import or awaited task loses the browser's transient user activation before the WebHID chooser.                                                                                     | Consumer preloads the module; `prepare()` and `recover()` invoke discovery synchronously before their first asynchronous boundary.                                                                                                                                                           | Gesture-bound browser test that fails if `requestDevice()` is delayed.                                                                                                                                                                            | Browser activation rules may change and require compatibility review.                                                                        |
| T7  | Package                               | The chooser remains open after cancellation and later resolves into a live session.                                                                                                          | Document that WebHID chooser UI cannot be programmatically aborted; cancellation unsubscribes and marks the operation stale, ignores late chooser resolution, and cleans up any late-acquired resource without continuing.                                                                   | Fake and browser tests for cancel-before-selection, late resolve, late reject, and dispose.                                                                                                                                                       | The native chooser may remain visible until the user dismisses it.                                                                           |
| T8  | Package                               | Install progress or completion is mistaken for a proven postcondition.                                                                                                                       | Treat progress as informational only; after install completion run a new independent list-installed-apps action and require exact Bitcoin presence.                                                                                                                                          | Call-order tests prove separate action instances and failure when re-list cannot prove presence.                                                                                                                                                  | The independent check still relies on the same device/vendor stack.                                                                          |
| T9  | Package                               | Cancellation, timeout, disconnect, sleep, tab close, or vendor failure occurs after mutation may have started, and a blind retry worsens state.                                              | Open a mutation window at dispatch; classify every ambiguous terminal outcome as `state-unknown`; invalidate the plan; require `recover()` and a new user-gesture session that re-lists before any later install.                                                                            | Fault matrix at every install state, including late emissions after cancellation.                                                                                                                                                                 | Browser termination can prevent graceful cleanup and final event delivery.                                                                   |
| T10 | Package                               | Full app inventory, device/session identifiers, model details, raw errors, endpoints, or APDU data escape through results, logs, persistence, or exceptions.                                 | Reduce inventory immediately to Bitcoin presence; return no version; use Caravan-owned events/errors; never attach raw cause; add no logger/analytics; never persist identifiers.                                                                                                            | Forbidden-surface, redaction, snapshot, and packed-artifact tests; security audit.                                                                                                                                                                | Vendor dependencies may process/log data internally; audit the exact artifact.                                                               |
| T11 | Package and security                  | The WebHID dependency passes an exception wrapper that retains the raw browser error to the host's current Sentry Hub; a configured host client could serialize or transmit prohibited data. | Initialize no Caravan logger or Sentry client; block release until the final consumer bundle's host-client payload and destination are approved or a reviewed upstream/patch/fork/alias mitigation removes the risk.                                                                         | The authoring-tree WebHID `1.2.4`/Sentry `6.19.7` test characterizes duplicate host-Hub capture and raw aliases under a no-client network/console/storage tripwire; final packed-browser and representative host-client evidence remain required. | A no-client observation does not characterize client serialization or transmission, and dependency or host-Sentry changes require re-review. |
| T12 | Ledger relationship and release roles | Code contacts Ledger services without written authorization or uses unapproved origins/endpoints/provider.                                                                                   | Keep package private; no live tests while gate is pending; no public override; release checklist requires controlled agreement evidence and named sign-offs.                                                                                                                                 | Network-denial tests for offline suites, artifact audit, and release-owner gate review.                                                                                                                                                           | Consumer code outside this package could contact services independently.                                                                     |
| T13 | Package and wallet implementation     | WebHID and WebUSB own the same device concurrently, or WebHID `disconnect()` returns before the OS handle closes.                                                                            | Fix existing wallet transport ownership; release all DMK resources; poll `navigator.hid.getDevices()` for the selected object with `opened === false` until a deadline; report reconnect-required otherwise.                                                                                 | Same-instance WebUSB lifecycle tests, delayed-close handoff tests, and physical browser evidence.                                                                                                                                                 | The browser may still require unplug/replug or reselection after an observed close.                                                          |
| T14 | Consumer and package                  | Browser copy misrepresents a device prompt or raw vendor text is treated as trusted instructions.                                                                                            | Emit a finite interaction vocabulary; consumer owns reviewed localized copy; state that the physical Ledger screen is authoritative; do not expose raw SDK messages.                                                                                                                         | Contract exhaustiveness tests and UX/security review.                                                                                                                                                                                             | Users may still approve an unexpected prompt without reading the device.                                                                     |
| T15 | Package                               | Cleanup paths double-close, leak, hang, or replace the original failure.                                                                                                                     | Lexical resource ownership, idempotent best-effort cleanup, bounded waits, exactly one attempted cleanup path per resource, and deterministic error precedence.                                                                                                                              | Exit-path tests for success, refusal, timeout, synchronous throw, disconnect, and cleanup failure.                                                                                                                                                | Physical/OS failures can prevent proof of closure; return reconnect-required.                                                                |
| T16 | Package and release roles             | Firmware support is claimed without observable preflight evidence.                                                                                                                           | The selected genuine/list/install outputs do not expose firmware. v0.1 will not add metadata authority merely to construct a firmware allowlist. Firmware combinations remain unclaimed until physical evidence; emit `unsupported-firmware` only when the pinned SDK explicitly reports it. | Source audit, normalized-error tests, and per-firmware physical acceptance rows.                                                                                                                                                                  | A firmware incompatibility may appear as another safe pre-dispatch error or as unknown after dispatch.                                       |
| T17 | Package                               | A missing catalog entry is incorrectly reported as a proven unsupported app/firmware condition.                                                                                              | In the local reviewed SDK baseline, `InstallAppDeviceAction` maps catalog absence to an unknown device-action error. Map an unrecognized error before dispatch to `internal`, and after dispatch to `state-unknown`; use `bitcoin-app-unsupported` only for an explicit reviewed SDK signal. | Reconcile the resolved artifact with immutable source, then run stage-aware error-normalization and offline contract tests.                                                                                                                       | Vendor mappings may change between source revisions or artifacts and require a fresh audit.                                                  |
| T18 | Release roles                         | Enum presence or vendor marketing is treated as proof that a model/browser/OS is supported.                                                                                                  | A model enters the compiled allowlist only with authorization and a complete physical evidence row; unknown and untested remain fail-closed.                                                                                                                                                 | Support-matrix review and release artifact inspection.                                                                                                                                                                                            | Hardware access may limit the initial support set.                                                                                           |

## Risk classification and slice ownership

Severity reflects impact if the mitigation fails, not likelihood. A high-risk
row blocks the owning phase and release until its named verification is green
or security records an explicit blocking/acceptance decision.

| Severity | Threats     | Owning verification slices                                                                                                         |
| -------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| High     | T1-T5       | 2.5-2.6 public/artifact boundary; 3.3 session/model gate; 3.8 plan validation; 6.7 lifecycle model; 7.7 release review             |
| High     | T8-T12, T17 | 3.5 redaction; 4.2-4.8 mutation/verification/error/recovery; 6.3 offline SDK contract; 6.5-6.6 artifact/privacy; 7.3 authorization |
| High     | T13, T15    | 1.1-1.5 wallet ownership; 5.1-5.6 release barrier/handoff; 6.7 lifecycle model; 7.6 physical handoff                               |
| Medium   | T6-T7, T14  | 3.2 discovery activation; 3.5 interaction mapping; 3.9 read-only scenarios; 6.4 browser lab; 7.1 documentation                     |
| Medium   | T16, T18    | 0.5 support policy; 3.3 compiled model gate; 6.3 SDK contract; 7.4-7.7 physical evidence and release review                        |

An SDK source/artifact mismatch invalidates T3, T11, T16, T17, and T18
evidence. The dependent slice must stop until the exact resolved artifact is
reconciled with immutable reviewed source and the affected documents/tests are
updated.

## Mutation and recovery rule

The mutation window begins immediately before the install action is dispatched.
From that point until an independent list action proves Bitcoin present, the
package must assume that cancellation or failure may have left device state
changed.

- Before dispatch, recognized safe failures may use their specific public code.
- During or after dispatch, cancellation, timeout, disconnect, unrecognized
  error, or inability to verify is `state-unknown`.
- A specific low-level error does not override `state-unknown` when mutation is
  ambiguous.
- `recover()` never retries install. It starts a new click-bound discovery and
  re-lists applications, producing a new plan only after the state is known.

## Firmware evidence limitation

The reviewed genuine-check, list-installed-apps, and install outputs selected
for v0.1 do not provide firmware metadata. Adding `GetDeviceMetadata` solely to
preflight a firmware allowlist would widen the action and data surface.

Therefore:

- no exact firmware version is exposed through the public API;
- no firmware combination is claimed solely from SDK source;
- `unsupported-firmware` is emitted only when the pinned SDK returns an
  explicit reviewed signal;
- unknown errors are classified by mutation stage, not guessed to be firmware;
  and
- support claims depend on recorded physical evidence in the
  [support matrix](./support-matrix.md).

## WebHID chooser cancellation limitation

`navigator.hid.requestDevice()` does not provide a package-controlled abort
handle. `cancel()` can stop Caravan orchestration and unsubscribe from vendor
state, but cannot dismiss the native chooser. The implementation must ignore a
late result after cancellation and make one cleanup attempt if a device handle
was acquired. It must never connect or begin a device action from that stale
result.

## Privacy inventory

### Values allowed to cross the public API

- Caravan-owned lifecycle phase.
- Caravan-owned normalized interaction, when one is required.
- Integer progress from 0 through 100 only when meaningful and normalized.
- Opaque plan with only `installation-required` or `already-installed` status.
- Final `installed` or `already-installed` disposition.
- Whether the fixed open-Bitcoin attempt succeeded.
- Whether WebHID release was observed or reconnect is required.
- Caravan-owned error code, phase, recoverability, and generic stable message.

### Values prohibited from crossing, logging, or persistence

- Full installed-app inventory, app hashes, sizes, flags, dependencies, or
  versions, including the Bitcoin version.
- Runtime device ID, session ID, HID object, USB identifiers, serial number,
  product name, or other fingerprinting material.
- Ledger SDK types, observables, XState actors, transport/session objects,
  WebSocket objects, endpoints, providers, tokens, or catalogs.
- Raw APDUs, status words, device responses, vendor messages, raw errors,
  causes, vendor stacks copied into a public error, or input data.
- Persistent plan tokens or any cross-session device identity.

The internal runtime may hold the selected HID object and transient session
identifier only for ownership and cleanup. They are discarded when the session
ends and are never used as stable identity.

## Resolved dependency privacy observation

In the current authoring-tree dependency graph, the deterministic
[vendor-Sentry characterization](../../packages/caravan-ledger/test/privacy/vendor-sentry.test.ts)
imports the installed package entry for WebHID transport `1.2.4` and exercises
its real discovery failure path with `@sentry/minimal` and `@sentry/hub`
`6.19.7`. For a rejected `navigator.hid.requestDevice()` call, the observed
behavior is:

1. WebHID constructs one `NoAccessibleDeviceError` wrapper.
2. Its own enumerable fields are `_tag`, `err`, and `originalError`; both error
   fields reference the same raw browser `Error`, including its message, stack,
   cause, and any attached metadata.
3. `captureException` reaches the host's current Hub twice with that same
   wrapper: once at the request boundary and once when discovery propagates the
   failure. Each invocation has a separate Sentry synthetic-exception hint.
4. With an isolated Hub that has no client, the real Hub method produced no
   observed `fetch`, WebSocket, XHR, beacon, console, or web-storage access in
   the controlled Node/Vitest run.

The same suite drives the real Caravan facade with canaries in raw errors,
runtime device/session identity, HID metadata, app/hash-shaped data, APDU-shaped
data, URL/query, response, and stack fields. Its public errors, lifecycle
events, plans, and results retained only the finite Caravan contract. The
existing [runtime construction test](../../packages/caravan-ledger/src/internal/dmkRuntime.test.ts)
also asserts that Caravan does not call the SDK builder's `addLogger` hook.

This authoring-tree observation establishes capture invocation and the object
supplied to the host Hub for the resolved local graph; it is not native-browser
evidence and does not characterize serialization, transport, sampling,
integrations, or destinations when a consumer has a real Sentry client. T11
therefore remains a release blocker pending a final packed consumer run with
representative host configuration plus named security, privacy,
Ledger-authorization, and release approval. Functional success and the
no-client no-network observation do not waive that decision.

## Verification and release evidence

The following are mandatory before the relevant phase is accepted:

- Phase 2: root export allowlist, declaration inspection, tarball inspection,
  SSR-safe import, and deterministic fake ports.
- Phase 3: gesture-bound discovery, connect/model/genuine/list fail-closed
  ordering,
  inventory reduction, plan binding, chooser late-resolution handling, and
  read-only cancellation.
- Phase 4: install dispatch boundary, independent verification, exhaustive
  fault injection, recovery-only ambiguous outcomes, and pinned-SDK error audit.
- Phase 5: exactly-once resource cleanup and bounded WebHID-to-WebUSB handoff.
- Phase 6: offline integration, dependency/network/privacy audit, consumer
  bundle evidence, and security review.
- Phase 7: written Ledger authorization, physical acceptance evidence, named
  human sign-offs, exact tarball review, canary evidence, and release decision.

## Residual risks requiring explicit acceptance

- Same-origin compromise can invoke the bounded API and show a native chooser.
- The browser chooser cannot be dismissed programmatically.
- Browser termination can interrupt cleanup and suppress a terminal result.
- Ledger dependencies and services remain trusted protocol components.
- Vendor telemetry behavior may change with the dependency graph.
- A clean WebHID close does not guarantee silent WebUSB permission transfer.
- Firmware compatibility cannot be comprehensively preflighted with the chosen
  narrow action set.
- Physical evidence is pending; no model/firmware/browser/OS combination is
  currently claimed.

## Related decisions and sources

- [Package architecture ADR](./adr/0001-ledger-bitcoin-installer-package.md)
- [Public contract v0.1](./public-contract-v0.1.md)
- [Authorization gate](./authorization-gate.md)
- [Support and acceptance policy](./support-matrix.md)
- [Ledger DMK legal notice](https://developers.ledger.com/docs/device-interaction/getting-started)
- [Ledger secure-channel actions](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/device-management-kit/secure-channel)
- [Ledger device discovery and connection](https://developers.ledger.com/docs/device-interaction/dmk-ts/beginner/discover_and_connect)
