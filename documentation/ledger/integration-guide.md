# Integrating the Ledger Bitcoin app installer

- Package: `@caravan/ledger`
- Contract: private v0.1 implementation candidate
- Publication/live status: blocked
- Runtime support claims: none; the compiled production model allowlist is
  intentionally empty

This guide explains the contract-compliant shape of a future consumer
integration. It does not authorize live Ledger traffic or physical testing. The
[authorization gate](./authorization-gate.md), [support matrix](./support-matrix.md),
and [private-readiness gate](./private-readiness.md) must all pass first.

## 1. Prerequisites and preload

The consumer must:

1. enforce its own authentication, entitlement, feature, and rollout policy;
2. run in an approved secure browser context with WebHID;
3. statically import the package before the user can select the prepare action;
4. call `getBitcoinInstallerSupport()` before enabling that action; and
5. create one installer for one visible workflow and dispose it on abandonment.

Do not use `await import("@caravan/ledger")` inside the click handler. A dynamic
import, earlier `await`, timer, or microtask hop can consume transient user
activation before the native WebHID chooser is invoked.

The support probe is permission-free and inert. `supported: true` means only
that the browser, secure context, and WebHID surface appear usable. It does not
mean a device, firmware, browser version, operating system, origin, or Ledger
service configuration is approved.

For `supported: false`, the optional `reason` is the first failed capability,
in this fixed order:

| Reason               | Consumer response                                                        |
| -------------------- | ------------------------------------------------------------------------ |
| `not-browser`        | Do not offer the workflow in this runtime.                               |
| `insecure-context`   | Do not prompt; move only to an approved secure-context deployment.       |
| `webhid-unavailable` | Do not prompt; this runtime lacks the required usable WebHID capability. |

An omitted `reason` accompanies `supported: true`; it does not add a support
or authorization claim.

## 2. Begin preparation from the click itself

Call `prepare()` synchronously in the original click callback. Save the returned
promise only after the call has begun discovery.

```ts
import type { BitcoinAppInstaller, BitcoinInstallPlan } from "@caravan/ledger";

declare const installer: BitcoinAppInstaller;
declare const prepareButton: HTMLButtonElement;
declare function showConfirmation(plan: BitcoinInstallPlan): void;
declare function handleInstallerFailure(error: unknown): void;

prepareButton.addEventListener("click", () => {
  const preparation = installer.prepare();
  void preparation.then(showConfirmation, handleInstallerFailure);
});
```

On success, preparation has performed only this ordered sequence:

1. native device selection;
2. connection;
3. compiled model allowlist check;
4. genuine check; and
5. a fresh installed-app listing reduced immediately to Bitcoin present or
   absent.

No installation, update, uninstall, or open action occurs during preparation.
The returned plan is an in-memory capability bound to the exact installer,
session, and generation. It is short-lived and single-use. Do not clone,
serialize, persist, reconstruct, or transfer it.

## 3. Require explicit consumer confirmation

Render confirmation from the plan's only visible field:

- `installation-required`: explain that the official Bitcoin app is absent and
  that continuing may ask for physical-device confirmation.
- `already-installed`: explain that no install or update will be attempted;
  continuing will make one fixed best-effort attempt to open Bitcoin and then
  release the management session.

Call `install(plan)` only from a distinct affirmative consumer action. The
consumer supplies no application name, endpoint, provider, token, transport,
SDK object, or configuration. Passing the exact plan is the complete authority
boundary.

For an installation-required plan, the package consumes the plan before one
fixed install dispatch, then creates a separate listing action and requires
that listing to prove Bitcoin present. Progress and vendor completion alone are
never treated as proof.

For an already-installed plan, no mutation is dispatched. Both branches then
make the same one fixed open-Bitcoin attempt and release management resources.

## 4. Interpret the result as three independent facts

| Field                           | Consumer meaning                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `status: "installed"`           | An install was dispatched and a later independent listing proved Bitcoin present.                                      |
| `status: "already-installed"`   | Preparation proved Bitcoin present and no install/update was dispatched.                                               |
| `appOpen: true`                 | The fixed open attempt completed successfully.                                                                         |
| `appOpen: false`                | Open was refused, failed, timed out, or was cancelled after disposition was proven. The status remains valid.          |
| `handoff: "ready"`              | The privately selected HID object was observed closed before the deadline.                                             |
| `handoff: "reconnect-required"` | The close could not be proved or observation was ambiguous/unavailable. This is guidance, not an installation failure. |

Do not infer app-open state from `status`, or release state from `appOpen`.
The package never returns a Bitcoin version.

## 5. Start WebUSB only from a later click

`ready-for-webusb` is the terminal management phase for both handoff values. It
does not mean WebUSB permission was transferred or a signing connection exists.

For `handoff: "ready"`, the consumer may enable its existing signing action.
That action must acquire WebUSB only when the user clicks it later. Never invoke
`@caravan/wallets`, a WebUSB chooser, key export, or signing from the
`install()` continuation.

For `handoff: "reconnect-required"`, keep the signing action disabled. Show the
reviewed reconnect/reselection guidance, require the user to complete it, and
require a new explicit consumer action before any later signing attempt. Do not
silently treat elapsed time, disconnect completion, or a page transition as
proof of release.

The installer package has no runtime dependency on `@caravan/wallets` and must
not call it.

## 6. Cancellation, recovery, and disposal

### Cancellation

`cancel()` is synchronous intent, cooperative, and idempotent. It cannot close
the browser's native chooser. It marks current work stale, cancels local
orchestration where safe, and waits for owned finalization through the active
method promise. A device exchange can finish after cancellation was requested.

- Before install dispatch, cancellation safely produces `cancelled`.
- During install or verification, if mutation may have occurred and Bitcoin has
  not been independently proved present, the result is `state-unknown` and the
  phase becomes `needs-recovery`.
- During the non-authoritative open attempt, cancellation preserves the proven
  disposition, sets `appOpen: false`, and continues release.
- During release, cancellation does not interrupt the release barrier.

### Recovery

`recover()` is valid only from the `needs-recovery` phase. That phase follows
`state-unknown` and also the reviewed `insufficient-space` install failure. Call
recovery directly from a new user gesture. It starts a new chooser and session,
repeats the model and genuine gates, and performs a fresh app listing. It
returns a new plan and never retries installation automatically or trusts the
earlier action, progress, or completion.

### Disposal

`dispose()` is asynchronous, idempotent, and permanent. Await it during normal
route transitions, modal closure, or component teardown wherever the consumer
lifecycle permits. A page lifecycle callback that cannot wait should still
request it as best effort. Disposal invalidates every plan, stops or ignores
late callbacks, and completes the one owned cleanup path before releasing the
runtime lease. It is not rollback: disposal during an ambiguous mutation keeps
the active install promise's `state-unknown` (or preserved
`insufficient-space`) truth even though the installer itself becomes
`disposed`. Do not reuse a disposed installer.

## Public package functions

| Function                       | Contract                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `getBitcoinInstallerSupport()` | Permission-free capability probe; it performs no device, permission, or network operation and grants no support authority. |
| `createBitcoinAppInstaller()`  | Constructs a lazy facade without opening a chooser or device session.                                                      |

## Public methods

| Method                | Contract                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `subscribe(listener)` | Receives future package-owned events; listener failures are isolated. Its unsubscribe function is idempotent.                 |
| `prepare()`           | Direct-click read-only preparation from `idle` or `cancelled`; returns one opaque plan.                                       |
| `install(plan)`       | Explicit confirmation boundary; consumes the exact current plan and completes install/no-op, verification, open, and release. |
| `recover()`           | Direct-click fresh inspection from `needs-recovery`; never auto-installs.                                                     |
| `cancel()`            | Idempotent cooperative cancellation intent; terminal classification arrives through the active promise.                       |
| `dispose()`           | Idempotent permanent cleanup; returns a promise that should be awaited.                                                       |

## Public lifecycle phases

Events describe normalized package state, not vendor state. New subscribers see
future transitions only; consumers render their own initial idle view.

| Phase                  | What it means and what the consumer may do                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `idle`                 | No operation is active. A direct user action may call `prepare()`.                                                         |
| `selecting-device`     | The native chooser has been requested. Show selection guidance; cancellation cannot dismiss the chooser itself.            |
| `connecting`           | The selected device is being connected and gated. Do not start another device transport.                                   |
| `checking-genuine`     | The allowed model is undergoing a genuine check. Follow only normalized interaction events and the physical device screen. |
| `checking-bitcoin-app` | A fresh listing is being reduced to Bitcoin present/absent. Do not infer or display inventory.                             |
| `ready-to-install`     | One opaque plan is available. Render explicit confirmation; do not delay, persist, or copy the plan.                       |
| `installing`           | The fixed Bitcoin install path is active. Progress is informational, not proof.                                            |
| `verifying`            | A separate fresh listing is proving the postcondition. Do not offer retry.                                                 |
| `opening-bitcoin`      | One fixed best-effort open attempt is active after disposition is proven.                                                  |
| `releasing-device`     | Cleanup, disconnect, and bounded HID release observation are in progress. Do not start WebUSB or interrupt the barrier.    |
| `ready-for-webusb`     | Management is terminal for either handoff result. Inspect `handoff`; only a later user click may begin signing.            |
| `needs-recovery`       | Mutation state is not safely known. Offer only a new-click `recover()` inspection, never install retry.                    |
| `cancelled`            | Read-only/unconsumed work was cancelled and cleanup completed. A fresh direct-click `prepare()` may be offered.            |
| `failed`               | A normalized terminal failure occurred and cleanup completed. Follow the error-specific safe response.                     |
| `disposed`             | The installer is permanently inactive. Create a new installer only from a new consumer workflow.                           |

## Public interactions and progress

The only interaction values are `select-device`, `unlock-device`,
`allow-secure-connection`, `confirm-install`, and `confirm-open-bitcoin`.
Display reviewed consumer-owned copy for these finite values. The physical
device screen is authoritative; raw vendor text is never an instruction source.

`progress`, when present, is a monotonic integer from 0 through 100 within one
action. It is suitable for presentation only and proves neither completion nor
installation.

## Error handling

Catch `BitcoinInstallerError` and branch on its finite `code`. Its generic
`message` is diagnostic copy, not localized user instruction. `phase` reports
where Caravan classified the problem; `recoverable` means the contract defines
a safe next step, not that repeating the same method is safe.

An installer in `failed` is terminal: await `dispose()` and create a new
installer workflow before any error-specific later preparation. The same
installer may prepare again after `cancelled`; it may call `recover()` only from
`needs-recovery`.

The complete code-by-code operator response is in the
[support runbook](./support-runbook.md). In particular, only `recover()` is
safe after `state-unknown`; never call `install()` again with the old plan.

## Security, privacy, and non-goals

The package never asks for, reads, or handles recovery phrases, private keys,
or signing data. Never instruct a user to disclose a PIN/passphrase or approve
an unexpected Ledger prompt.

Public values contain no full app inventory, installed version, firmware,
device/session identifier, raw SDK error or stack, APDU/status word, endpoint,
provider, HID/transport object, observable, actor, or vendor message. Consumers
must apply the same rule to their own logs and telemetry.

There is no public API for arbitrary apps, update/downgrade, uninstall, storage
cleanup, firmware/language management, raw APDUs, custom endpoints/providers,
logger control, analytics, persistence, signing, or internal dependency
injection. Do not build integration behavior around source-internal test seams.

Exact Ledger service destinations and CSP requirements remain undocumented for
consumer use until written authorization is reconciled. No browser secret is
allowed. See the [threat model](./threat-model.md) and
[maintenance policy](./maintenance.md).
