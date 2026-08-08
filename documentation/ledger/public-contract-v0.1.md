# `@caravan/ledger` public contract v0.1

- Status: Frozen implementation candidate; human approval pending
- Intended first release: `0.1.0`, after a reviewed canary
- Runtime: Browser-only, secure context, WebHID-capable browser
- Module: ESM-only and framework-neutral
- Authorization: Live Ledger use and publication remain blocked by the
  [authorization gate](./authorization-gate.md)

This document is the normative public contract for the first implementation.
Examples use TypeScript syntax, but no Ledger SDK, RxJS, XState, HID,
WebSocket, endpoint, provider, session, device, APDU, or app-inventory type may
appear in the generated public declarations.

## Exported declarations

```ts
export type BitcoinInstallerPhase =
  | "idle"
  | "selecting-device"
  | "connecting"
  | "checking-genuine"
  | "checking-bitcoin-app"
  | "ready-to-install"
  | "installing"
  | "verifying"
  | "opening-bitcoin"
  | "releasing-device"
  | "ready-for-webusb"
  | "needs-recovery"
  | "cancelled"
  | "failed"
  | "disposed";

export type BitcoinInstallerInteraction =
  | "select-device"
  | "unlock-device"
  | "allow-secure-connection"
  | "confirm-install"
  | "confirm-open-bitcoin";

export interface BitcoinInstallerEvent {
  readonly phase: BitcoinInstallerPhase;
  readonly interaction?: BitcoinInstallerInteraction;
  readonly progress?: number;
}

export type BitcoinInstallerErrorCode =
  | "unsupported-environment"
  | "permission-denied"
  | "no-device-selected"
  | "device-busy"
  | "device-disconnected"
  | "device-locked"
  | "device-not-onboarded"
  | "device-not-genuine"
  | "unsupported-device"
  | "unsupported-firmware"
  | "user-refused"
  | "bitcoin-app-unsupported"
  | "insufficient-space"
  | "network-unavailable"
  | "ledger-service-unavailable"
  | "secure-channel-failed"
  | "operation-timeout"
  | "cancelled"
  | "state-unknown"
  | "internal";

export class BitcoinInstallerError extends Error {
  readonly name: "BitcoinInstallerError";
  readonly code: BitcoinInstallerErrorCode;
  readonly phase: BitcoinInstallerPhase;
  readonly recoverable: boolean;
}

// The brand exists in declarations but is not a root export. Runtime validity
// also requires private object identity and instance/session metadata.
declare const bitcoinInstallPlanBrand: unique symbol;

export interface BitcoinInstallPlan {
  readonly status: "installation-required" | "already-installed";
  readonly [bitcoinInstallPlanBrand]: never;
}

export interface BitcoinInstallResult {
  readonly status: "installed" | "already-installed";
  readonly appOpen: boolean;
  readonly handoff: "ready" | "reconnect-required";
}

export interface BitcoinAppInstaller {
  subscribe(listener: (event: BitcoinInstallerEvent) => void): () => void;
  prepare(): Promise<BitcoinInstallPlan>;
  install(plan: BitcoinInstallPlan): Promise<BitcoinInstallResult>;
  recover(): Promise<BitcoinInstallPlan>;
  cancel(): void;
  dispose(): Promise<void>;
}

export interface BitcoinInstallerSupport {
  readonly supported: boolean;
  readonly reason?:
    | "not-browser"
    | "insecure-context"
    | "webhid-unavailable";
}

export function getBitcoinInstallerSupport(): BitcoinInstallerSupport;
export function createBitcoinAppInstaller(): BitcoinAppInstaller;
```

The `cancelled` error code is required because `prepare()` and `recover()`
cannot return a plan after caller cancellation. They reject with a
package-owned error while the observable lifecycle enters `cancelled`.

## Import and capability behavior

- Importing the package evaluates no browser permission API and does not read
  `window`, `navigator`, or WebHID.
- `createBitcoinAppInstaller()` constructs no device session and opens no
  chooser.
- `getBitcoinInstallerSupport()` asks for no permission and performs no network
  or device operation.
- The support probe checks, in order: browser runtime, secure context, then a
  usable `navigator.hid` surface. The first failing condition supplies the
  reason.
- `supported: true` reports environment capability only. It is not a claim
  about authorization, device model, firmware, browser version, operating
  system, Ledger service availability, or physical acceptance.
- Missing or malformed globals return a finite unsupported result rather than
  throwing.

The consumer must preload the module. Dynamic import in the click handler can
consume transient user activation before `requestDevice()`.

## Event rules

- Events contain only package-owned values.
- Events are emitted in transition order. A new subscription observes future
  transitions; consumers should render their own initial idle state.
- The returned unsubscribe function is idempotent.
- Listener failure must not interrupt the device operation, affect another
  listener, or expose internal state. The package does not log listener values
  or exceptions.
- `interaction` is present only while the named user action is currently
  required. The physical device screen is authoritative.
- `progress` is present only when the underlying operation provides meaningful
  progress. It is clamped to an integer from 0 through 100 and is monotonic
  within one action. It is not proof of completion or installation.
- Vendor text and unrecognized vendor interactions never cross this boundary.

## State transitions

| From | Trigger or condition | To | Required effect |
| --- | --- | --- | --- |
| `idle` | `prepare()` | `selecting-device` | Invoke discovery synchronously from the caller's user gesture. |
| `selecting-device` | Exactly one selection is accepted | `connecting` | Ignore any result belonging to a cancelled/stale operation. |
| `connecting` | Session established and connected model is in the compiled allowlist | `checking-genuine` | Own the session and transport; start genuine check only after the model gate passes. |
| `connecting` | Connected model is unknown or absent from the compiled allowlist | `failed` | Emit `unsupported-device`; execute no genuine/list/install action; invalidate state and clean up. |
| `checking-genuine` | Genuine result true | `checking-bitcoin-app` | Continue read-only preparation. |
| `checking-genuine` | False or safe terminal error | `failed` | Do not list or mutate; invalidate state and clean up. |
| `checking-bitcoin-app` | Fresh list shows Bitcoin absent | `ready-to-install` | Mint one installation-required plan. |
| `checking-bitcoin-app` | Fresh list shows Bitcoin present | `ready-to-install` | Mint one already-installed plan; retain no inventory or version. |
| `ready-to-install` | `install(validPlan)` with installation required | `installing` | Consume plan before dispatch and enter mutation window. |
| `ready-to-install` | `install(validPlan)` with Bitcoin already present | `opening-bitcoin` | Perform no install/update action. |
| `installing` | Install action completes | `verifying` | Start a new independent list action; progress is insufficient. |
| `installing` or `verifying` | Ambiguous cancellation/failure/disconnect/timeout | `needs-recovery` | Reject with `state-unknown`; no blind retry. |
| `verifying` | Fresh list proves Bitcoin present | `opening-bitcoin` | Preserve status `installed`. |
| `verifying` | Bitcoin presence is not proven | `needs-recovery` | Reject with `state-unknown`. |
| `opening-bitcoin` | One fixed open attempt succeeds, fails, or is refused | `releasing-device` | Preserve proven installation status; set `appOpen` accordingly. |
| `releasing-device` | Selected HID object observed with `opened === false` | `ready-for-webusb` | Resolve with `handoff: "ready"`. |
| `releasing-device` | Release deadline expires or observation fails | `ready-for-webusb` | Resolve proven disposition with `handoff: "reconnect-required"`. |
| Read-only phase | Caller cancellation completes cleanup | `cancelled` | Reject pending method with code `cancelled`; a fresh `prepare()` is allowed. |
| Any live phase | Unambiguous terminal error | `failed` | Reject with normalized error and clean up. |
| `needs-recovery` | `recover()` from a new user gesture | `selecting-device` | Start a new session and re-list; never dispatch install automatically. |
| Terminal phase | `dispose()` | `disposed` | Idempotently release remaining resources and permanently disable instance. |

`ready-for-webusb` names the terminal management state for either handoff
result. The result field distinguishes observed release from reconnect-needed;
it does not imply that WebUSB permission was silently acquired.

## Method contracts

### `subscribe(listener)`

Preconditions:

- `listener` is callable.
- The installer is not required to remain undisposed for unsubscription.

Postconditions:

- The listener receives future normalized transitions until it unsubscribes or
  the installer is disposed.
- The returned function can be called repeatedly without side effects.

### `prepare()`

Preconditions:

- Called directly from a user gesture with the package already loaded.
- Installer phase is `idle` or `cancelled`.
- No other installer owns the runtime-wide management lease.
- The caller has checked product policy; the package is not an entitlement
  boundary.

Synchronous requirement:

`prepare()` must begin the WebHID discovery call during the original JavaScript
user-gesture task, before its first `await`, timer, microtask hop, or dynamic
import. Returning a promise does not relax this requirement.

Postconditions on success:

- Exactly one session has passed the compiled model gate and then genuine
  check, in that order.
- A fresh app-list result has been reduced to Bitcoin present or absent.
- One opaque plan is returned and the session remains exclusively owned while
  awaiting `install(plan)` for a bounded period.
- No mutation or open-app action has occurred.

### `install(plan)`

Preconditions:

- Phase is `ready-to-install`.
- The plan is the unexpired, unconsumed object minted by this installer for the
  current instance and session generations.
- The call itself is the explicit consumer-confirmation boundary.

Runtime plan validation rejects copied, structurally forged, serialized,
expired, replayed, cross-instance, cross-session, disconnected, or disposed
plans. Invalid-plan misuse is a generic `internal` contract failure; it grants
no device authority, invalidates the session, and requires a new installer.
The plan expiry duration is bounded implementation policy, not a public API.

For `installation-required`, the method:

1. atomically consumes the plan;
2. dispatches one install action whose app name is the private exact constant
   `Bitcoin`;
3. independently re-lists installed applications after action completion;
4. proceeds only if the new list proves Bitcoin present;
5. makes one best-effort fixed open-Bitcoin attempt; and
6. releases management resources and resolves the result.

For `already-installed`, the method performs no installation, update, or other
mutation. It proceeds directly to the same one fixed open attempt and release.

Open refusal, timeout, or failure after the installation disposition is proven
does not reject the method. It produces `appOpen: false`. The package never
exports a separate or generic open-app function.

### `recover()`

Preconditions:

- Phase is `needs-recovery`.
- Called directly from a new user gesture.

`recover()` begins discovery synchronously in the new user-gesture task. It
creates a new session, applies the compiled model gate before the genuine
action, then repeats genuine check and runs a fresh app listing. It returns a
newly bound plan. It never retries installation, trusts the previous session,
or treats old progress/completion as evidence.

### `cancel()`

`cancel()` is synchronous intent and idempotent. It cancels/unsubscribes local
orchestration as far as the current phase permits. The promise for the active
method reports the eventual terminal classification after cleanup.

The native WebHID chooser cannot be programmatically dismissed. Cancellation
while it is open marks the operation stale, unsubscribes where possible,
ignores late selection/rejection, and cleans up a late-acquired handle without
connecting or running a device action.

### `dispose()`

`dispose()` is asynchronous, idempotent, and permanent. It invalidates every
plan and generation, stops/ignores future callbacks, attempts cleanup exactly
once per owned resource, and releases the runtime lease. After it resolves,
all methods except repeated `dispose()` and stale unsubscribe callbacks fail
without device or permission activity.

Disposal during an ambiguous mutation follows the same `state-unknown` rule as
cancellation. Cleanup failures do not make disposal non-idempotent.

## Cancellation table

| Phase at `cancel()` | Method outcome | Terminal classification |
| --- | --- | --- |
| `idle` | No operation; no effect | `idle` |
| `selecting-device` | Chooser may remain visible; ignore late result; reject `prepare()`/`recover()` with `cancelled` after cleanup | `cancelled` |
| `connecting`, `checking-genuine`, `checking-bitcoin-app` | Cancel action/subscription, clean up, reject with `cancelled` unless a disconnect makes the state otherwise unsafe | `cancelled` |
| `ready-to-install` | Invalidate plan and release without mutation | `cancelled` |
| `installing`, or `verifying` before Bitcoin is independently proven | Cancel locally, invalidate plan, clean up, reject with `state-unknown` | `needs-recovery` |
| `opening-bitcoin` after disposition is proven | Stop/ignore open work, release, resolve proven result with `appOpen: false` | `ready-for-webusb` |
| `releasing-device` | Do not interrupt cleanup/release barrier; resolve normal proven result | `ready-for-webusb` |
| `needs-recovery`, `cancelled`, `failed`, `ready-for-webusb` | No effect | Unchanged |
| `disposed` | No effect | `disposed` |

## Plan security and lifetime

A plan is an in-memory capability, not a serializable installation plan.

- The visible `status` is the only public data.
- JSON or structured cloning cannot create a valid plan.
- A private identity/nonce and instance/session generations are checked at
  runtime.
- A plan is single-use and consumed before install dispatch.
- It expires after a bounded implementation-defined interval.
- Disconnect, cancellation, recovery, terminal error, runtime lease loss, or
  disposal invalidates it.
- A plan never contains device/session identifiers, app inventory, version,
  endpoint, provider, catalog data, or vendor objects.

## Result semantics

| Field | Meaning |
| --- | --- |
| `status: "installed"` | A mutation was dispatched and a later independent list proved Bitcoin present. |
| `status: "already-installed"` | Preparation proved Bitcoin present and no install/update mutation was dispatched. |
| `appOpen: true` | The one fixed open-Bitcoin attempt completed successfully. |
| `appOpen: false` | The open attempt was refused, failed, timed out, or was cancelled after install disposition was proven. |
| `handoff: "ready"` | Before the deadline, the package observed the selected permitted HID object report `opened === false`. |
| `handoff: "reconnect-required"` | The close could not be observed by the deadline or the browser requires physical reconnect/reselection. |

No result exposes the installed Bitcoin version. `handoff: "ready"` does not
promise that WebUSB is already permitted or that signing can start without a
later user gesture.

## Error contract

`BitcoinInstallerError` exposes only `name`, inherited generic `message`,
`code`, `phase`, and `recoverable`. The package never attaches a raw `cause`,
vendor error, APDU/status word, endpoint, provider, input, app inventory, or
device/session identifier. `stack` is not part of the public contract, and the
package never copies a vendor stack into a public error. Consumers must not
show `message` as localized instructions; it is stable diagnostic copy.

`phase` is the operational phase in which the problem was classified, not a
vendor state. `recoverable` means the contract offers a safe next step; it does
not mean retry the same install call.

| Code | Contract meaning and safe next step |
| --- | --- |
| `unsupported-environment` | Capability probe failed. Do not prompt; use another supported environment. |
| `permission-denied` | Browser permission was explicitly denied. A later fresh user gesture may retry if product policy permits. |
| `no-device-selected` | Chooser returned no usable selection. A later fresh user gesture may retry. |
| `device-busy` | Device or runtime management lease is unavailable before mutation. Wait/close competing use, then start a fresh preparation. |
| `device-disconnected` | Device disconnected before mutation was possible. After install dispatch this is instead `state-unknown`. |
| `device-locked` | Explicit locked signal before mutation. Unlock and begin fresh preparation. After dispatch, ambiguity wins. |
| `device-not-onboarded` | Explicit pre-mutation SDK signal; do not continue. |
| `device-not-genuine` | Genuine action returned false; no later action is allowed. |
| `unsupported-device` | Model is absent from the compiled allowlist or outside authorization. Remote policy cannot widen it. |
| `unsupported-firmware` | Used only when the pinned SDK explicitly reports this condition. v0.1 does not preflight firmware metadata or infer this code from unknown errors. |
| `user-refused` | Physical-device refusal before install dispatch, or an explicit safely classified refusal. Ambiguity after dispatch wins. |
| `bitcoin-app-unsupported` | Used only for an explicit reviewed SDK signal. Catalog absence from the reviewed install action is not such a signal. |
| `insufficient-space` | Explicit install error; enter recovery and re-list before offering any later install. |
| `network-unavailable` | Explicit network failure before mutation. After install dispatch, ambiguity wins unless independently verified. |
| `ledger-service-unavailable` | Explicit Ledger service/WebSocket availability failure, classified by stage. |
| `secure-channel-failed` | Explicit secure-channel failure, classified by stage. |
| `operation-timeout` | Read-only or otherwise provably non-mutating timeout. Mutation timeout is `state-unknown`. |
| `cancelled` | Caller cancelled read-only work or an unconsumed plan. A new direct user gesture may prepare again. |
| `state-unknown` | Mutation may have reached the device or verification did not prove the postcondition. Only `recover()` is safe. |
| `internal` | Unrecognized or contract/programmer error before mutation. Raw details are retained only in test-local evidence, never public output. |

The local reviewed `InstallAppDeviceAction` baseline maps a missing catalog
entry to an unknown device-action error rather than an explicit
unsupported-app or unsupported-firmware error. That mapping is provisional
until the resolved package artifact is reconciled with immutable reviewed
source and passes the offline SDK contract suite. Until reviewed evidence
changes, the error maps to `internal` if the install action was not dispatched
and `state-unknown` after dispatch.

## SDK baseline and drift handling

This contract targets exact runtime pins DMK `1.7.1`, WebHID transport `1.2.4`,
and RxJS `7.8.2`. A matching version string is not enough: the resolved package
and packed consumer artifact must be traceable to reviewed immutable source.

If constructors, model identifiers, action tags, interactions, errors,
progress, cleanup behavior, defaults, or transitive telemetry differ from the
reviewed baseline, the affected mapping is unknown and implementation stops.
The contract, threat model, support policy, authorization register, and tests
must be updated and reviewed before work resumes. SDK drift never authorizes a
new public state, error, action, model, endpoint, or provider automatically.

## Firmware policy limitation

The selected genuine, list, and install outputs in the reviewed SDK do not
expose firmware metadata. v0.1 will not widen its authority to a metadata action
solely to create a firmware preflight allowlist. Consequently:

- public methods and results expose no firmware or Bitcoin version;
- physical firmware combinations remain unclaimed until evidence is recorded;
- exact SDK `unsupported-firmware` signals are normalized when available; and
- unknown failures are never guessed to be firmware failures.

See the [support policy](./support-matrix.md) for claim requirements.

## Resource ownership and handoff

- At most one discovery, session, action, and operation exists per instance.
- At most one installer instance owns the runtime management lease.
- The package attempts exactly one cleanup path for every owned subscription,
  action, session, transport/runtime, timer, and listener.
- Cleanup is idempotent and best effort, uses bounded waits, and preserves the
  primary operation classification.
- Vendor `disconnect()` completion is insufficient because the reviewed WebHID
  sender starts `HIDDevice.close()` without awaiting it.
- The package therefore observes permitted devices with
  `navigator.hid.getDevices()` and checks the selected object identity until
  `opened === false` or the release deadline expires.
- The consumer starts WebUSB signing only after the returned result and in a
  separate user gesture. Management and signing never hold the device
  concurrently.

## Semver and change control

The following require a reviewed public-contract change and at least a minor
release while the package is pre-1.0:

- adding a method, option, lifecycle phase, interaction, error code, result, or
  support reason;
- expanding the managed application or accepting any caller-selected name;
- adding update, uninstall, firmware, language, provider, endpoint, APDU, or
  signing authority;
- exposing version, model, inventory, identifiers, raw errors, or vendor types;
- changing cancellation, mutation ambiguity, plan validity, verification, or
  handoff semantics; or
- claiming a new browser/device/OS combination.

Bug fixes may tighten redaction, cleanup, or fail-closed behavior without
expanding authority. Dependency changes require a source, artifact, privacy,
and authorization review even when the public TypeScript surface is unchanged.

## Explicit exclusions

The contract contains no app-name option, update/downgrade/uninstall method,
firmware or OS operation, language-pack operation, provider/endpoint setting,
raw APDU access, generic action runner, DMK injection, logger control,
analytics, persistence, Bitcoin version, installed-app inventory, device ID,
session ID, HID object, WebSocket object, observable, actor, signing method, or
Trefoil-specific policy.

## Related documents

- [Package architecture ADR](./adr/0001-ledger-bitcoin-installer-package.md)
- [Threat model](./threat-model.md)
- [Authorization gate](./authorization-gate.md)
- [Support and acceptance policy](./support-matrix.md)
