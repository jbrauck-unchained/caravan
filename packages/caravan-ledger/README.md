# `@caravan/ledger`

`@caravan/ledger` is a browser-only, framework-neutral workflow for checking a
Ledger device for the official application named exactly `Bitcoin`, installing
it only when absent, independently verifying the result, attempting to open it,
and releasing WebHID before Caravan's existing WebUSB signing flow.

> **Private readiness status:** this workspace is `private: true`, versioned
> `0.0.0`, and is not approved for publication or live Ledger service use. The
> production model allowlist is implemented but intentionally empty, so no
> device, firmware, browser, or operating-system combination is supported yet.

The package does not sign, access private keys or recovery phrases, or expose a
general Ledger management API. `@caravan/wallets` remains the owner of the
later WebUSB signing session.

## Runtime and packaging

- Browser-only operation in an approved secure context with WebHID.
- ESM-only and framework-neutral; no CommonJS entry point.
- Static import, support probing, and factory construction do not prompt for a
  device, construct the Ledger runtime, or contact a service.
- Browser-aware bundlers select `dist/browser.js`. Node and SSR select the
  management-inert `dist/index.js` entry.
- Runtime dependencies are pinned exactly to
  `@ledgerhq/device-management-kit@1.7.1`,
  `@ledgerhq/device-transport-kit-web-hid@1.2.4`, and `rxjs@7.8.2`.

`getBitcoinInstallerSupport()` reports only whether the current environment
has the required browser, secure-context, and WebHID capabilities. A positive
probe is not a support, authorization, hardware, firmware, or service-availability
claim.

When `supported` is false, `reason` is the first failed capability in this
order: `not-browser`, `insecure-context`, or `webhid-unavailable`. Do not call
`prepare()` after a negative probe. An absent `reason` accompanies the positive
capability result; it still is not a support claim.

## Safe consumer lifecycle

Import the package while loading the consumer screen. Do not dynamically import
it from the button handler: that asynchronous boundary can consume the browser's
transient user activation before the WebHID chooser begins.

The example below uses only the public package API. The consumer owns all
rendering, entitlement checks, confirmation copy, reconnect guidance, and the
later signing integration.

```ts
import {
  BitcoinInstallerError,
  createBitcoinAppInstaller,
  getBitcoinInstallerSupport,
  type BitcoinInstallPlan,
  type BitcoinInstallResult,
  type BitcoinInstallerEvent,
} from "@caravan/ledger";

declare const prepareButton: HTMLButtonElement;
declare const confirmButton: HTMLButtonElement;
declare const recoverButton: HTMLButtonElement;
declare const cancelButton: HTMLButtonElement;
declare const signingButton: HTMLButtonElement;
declare const consumerPolicyAllowsInstaller: boolean;
declare function renderEvent(event: BitcoinInstallerEvent): void;
declare function renderPlanForExplicitConfirmation(
  status: BitcoinInstallPlan["status"],
): void;
declare function renderResult(result: BitcoinInstallResult): void;
declare function renderError(error: BitcoinInstallerError): void;
declare function showReconnectGuidance(): void;
declare function beginExistingWebUsbSigningFlow(): void;

const support = getBitcoinInstallerSupport();
prepareButton.disabled = !support.supported || !consumerPolicyAllowsInstaller;
recoverButton.disabled = true;
confirmButton.disabled = true;
signingButton.disabled = true;

const installer = createBitcoinAppInstaller();
const unsubscribe = installer.subscribe(renderEvent);
let pendingPlan: BitcoinInstallPlan | undefined;
let abandoning = false;

function handleFailure(error: unknown): void {
  prepareButton.disabled = true;
  recoverButton.disabled = true;
  confirmButton.disabled = true;
  signingButton.disabled = true;
  if (error instanceof BitcoinInstallerError) {
    renderError(error);
    const mayRecover =
      !abandoning &&
      (error.code === "state-unknown" || error.code === "insufficient-space");
    recoverButton.disabled = !mayRecover;
    if (!abandoning && error.code === "cancelled") {
      prepareButton.disabled =
        !support.supported || !consumerPolicyAllowsInstaller;
    }
  }
}

function offerPlan(plan: BitcoinInstallPlan): void {
  pendingPlan = plan;
  renderPlanForExplicitConfirmation(plan.status);
  recoverButton.disabled = true;
  confirmButton.disabled = false;
}

// This call must remain directly in the click callback, before an await,
// timer, microtask hop, or dynamic import.
prepareButton.addEventListener("click", () => {
  prepareButton.disabled = true;
  const preparation = installer.prepare();
  void preparation.then(offerPlan, handleFailure);
});

// This separate consumer action is the explicit confirmation boundary.
confirmButton.addEventListener("click", () => {
  const plan = pendingPlan;
  if (!plan) return;
  pendingPlan = undefined;
  confirmButton.disabled = true;

  void installer.install(plan).then((result) => {
    renderResult(result);
    if (result.handoff === "ready") {
      // Enabling is not acquisition. WebUSB may start only from a later click.
      signingButton.disabled = false;
    } else {
      signingButton.disabled = true;
      showReconnectGuidance();
    }
  }, handleFailure);
});

// Recovery is inspection, never an automatic install retry. It also needs a
// new direct user gesture because it opens a new chooser/session.
recoverButton.addEventListener("click", () => {
  recoverButton.disabled = true;
  const recovery = installer.recover();
  void recovery.then(offerPlan, handleFailure);
});

cancelButton.addEventListener("click", () => installer.cancel());

// This is a later, independent user gesture. Do not call it from install().
signingButton.addEventListener("click", () => {
  beginExistingWebUsbSigningFlow();
});

// Await this on ordinary route abandonment. A page lifecycle event may not
// allow waiting, but should still request best-effort disposal.
async function leaveInstallerRoute(): Promise<void> {
  abandoning = true;
  unsubscribe();
  await installer.dispose();
}
window.addEventListener("pagehide", () => {
  void leaveInstallerRoute();
});
```

Before enabling the preparation button, the consumer must also enforce its own
authentication, entitlement, feature, and rollout policy. The package narrows
device authority; it is not an access-control boundary.

## Plans, confirmation, and results

`prepare()` performs selection, connection, the compiled model gate, a genuine
check, and a fresh Bitcoin-presence inspection. It performs no install, update,
uninstall, or open action. It returns one opaque, short-lived, single-use plan:

- `installation-required` means the fresh inspection found Bitcoin absent.
- `already-installed` means the fresh inspection found Bitcoin present; the
  later `install(plan)` call performs no install or update mutation.

The caller must display its own explicit confirmation before passing that exact
plan object to `install(plan)`. A copied, serialized, forged, expired, replayed,
cross-instance, cross-session, disconnected, cancelled, or disposed plan has no
authority.

The three result fields are independent:

| Field                           | Meaning                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `status: "installed"`           | One install was dispatched and a new independent listing later proved Bitcoin present.                  |
| `status: "already-installed"`   | Preparation proved Bitcoin present and no install/update was dispatched.                                |
| `appOpen: true`                 | The one fixed open-Bitcoin attempt completed successfully.                                              |
| `appOpen: false`                | Open was refused, failed, timed out, or was cancelled after the Bitcoin disposition was already proven. |
| `handoff: "ready"`              | The selected WebHID object was observed closed before the release deadline.                             |
| `handoff: "reconnect-required"` | Release could not be proved; preserve the Bitcoin disposition but require the reviewed reconnect path.  |

`ready-for-webusb` is the terminal management phase for both handoff values.
Even `handoff: "ready"` does not grant WebUSB permission or authorize an
automatic signing connection. Signing starts only from a later consumer-owned
click. A reconnect-required result must not automatically open WebUSB.

## Cancellation, recovery, and disposal

- `cancel()` is synchronous, cooperative, and idempotent. A browser chooser or
  device exchange may finish after cancellation was requested; stale results
  are ignored and cleanup remains awaited by the active promise.
- Cancellation before mutation rejects with `cancelled`. Once mutation may
  have started and before a fresh listing proves Bitcoin present, ambiguity is
  `state-unknown` and the lifecycle enters `needs-recovery`.
- `recover()` is valid only from `needs-recovery`, including the reviewed
  `insufficient-space` path as well as `state-unknown`. It must be called
  directly from a new user gesture, creates a new session, and rechecks genuine
  status and Bitcoin presence. It never retries installation automatically.
- `dispose()` is asynchronous, idempotent, and permanent. Await it on normal
  abandonment or navigation wherever the consumer lifecycle allows. It
  invalidates plans and waits for owned cleanup; repeated disposal is safe.
  Disposal is not rollback and does not erase mutation truth: an active install
  still rejects with `state-unknown` or the preserved `insufficient-space`
  classification when that is the safe outcome.

See the [integration guide](../../documentation/ledger/integration-guide.md)
for every public phase and the
[support runbook](../../documentation/ledger/support-runbook.md) for every
public error and safe operator response.

## Security, privacy, and network boundary

- The physical Ledger screen is authoritative. Consumer copy must never advise
  approving an unexpected prompt or disclosing a PIN, passphrase, or recovery
  phrase.
- Caravan returns no full app inventory, Bitcoin version, firmware, device or
  session identifier, raw vendor error, APDU/status word, endpoint, provider,
  transport, HID object, observable, actor, or SDK object.
- The package initializes no Caravan logger, analytics client, or error-reporting
  destination. The pinned WebHID dependency's Sentry behavior still requires
  empirical privacy approval before release.
- Exact production Ledger destinations and CSP directives are intentionally not
  consumer documentation until written authorization is reconciled. The public
  API accepts no endpoint, provider, token, or credential.
- No browser secret is supported.

## Non-goals and support status

There is no public authority for arbitrary applications, update, downgrade,
uninstall, storage cleanup, firmware or language management, raw APDUs, custom
providers/endpoints, signing, or internal Ledger objects. Non-Chromium desktop
browsers, mobile browsers, embedded webviews, Electron, React Native, and Node
runtime operation are outside v0.1.

No physical combination is currently approved. Consult the
[support and acceptance policy](../../documentation/ledger/support-matrix.md),
[private-readiness evidence](../../documentation/ledger/private-readiness.md),
and [authorization gate](../../documentation/ledger/authorization-gate.md)
before any integration or live exercise.

## Development

Use Node 24 and npm 11.14.1 as pinned by the repository.

```sh
npm run ci --workspace=@caravan/ledger
```

The package gate runs lint, typechecking, unit/scenario tests, build, neutral
import checks, packed API/artifact checks, and a clean TypeScript 4.6/Webpack
5.64 consumer fixture. These deterministic gates do not replace the pending
offline SDK provenance contract, real-browser privacy/native UI evidence,
authorized physical matrix, root regression, or human release approvals.
