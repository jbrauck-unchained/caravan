# Ledger Bitcoin installer proof of concept

This proof of concept has two deliberately separate modes.

The browser integration uses Ledger's official TypeScript Device Management
Kit directly. The separate Bacca/`ledger_installer` repository is a native
Rust HID application and is not imported into the coordinator.

## Offline experience mode

```sh
npm run dev:ledger-poc
```

This mode uses the deterministic in-memory adapter. It does not request a
device, open WebHID, or contact Ledger.

## Authorized hardware mode

```sh
npm run dev:ledger-hardware-poc
```

This builds and loads the real private `@caravan/ledger` package, which wraps
Ledger's official TypeScript Device Management Kit and WebHID transport. The
page remains locked and makes no Ledger backend request by default.

Only after the external authorization and configuration checklist below has
been completed should an operator explicitly unlock the controls:

```sh
CARAVAN_LEDGER_BACKEND_AUTHORIZED=true npm run dev:ledger-hardware-poc
```

That environment variable is an operator acknowledgement, not an
authorization mechanism. The package's compiled device-model allowlist is an
independent fail-closed gate and is intentionally empty in this branch.

Ledger's [DMK legal notice](https://developers.ledger.com/docs/device-interaction/getting-started)
permits development, testing, and integration with the open-source kit but
requires explicit written Ledger SAS authorization before accessing its live
backend services.

## Real execution path already present

1. Start Ledger-only WebHID discovery synchronously from the user's click.
2. Connect one device and reject models outside the compiled allowlist.
3. Run Ledger's genuine-device action.
4. List installed apps and return only whether exact `Bitcoin` is present.
5. Mint a short-lived, instance-bound, one-use confirmation plan.
6. On a separate click, install only the literal official `Bitcoin` app.
7. Run a fresh independent app listing and require exact Bitcoin presence.
8. Make one best-effort attempt to open Bitcoin.
9. Disconnect and wait for the selected WebHID handle to report closed.
10. Return either `ready` or honest `reconnect-required` handoff guidance.

No code in this flow signs, exports keys, reads a seed, or accepts a caller
supplied app name, endpoint, provider, device identifier, or raw APDU.

## External enablement checklist

Before making a live call, record and approve all of the following:

- A written Ledger SAS agreement covering backend use, with identifier,
  effective/expiry dates, renewal/revocation terms, and named contacts.
- Explicit permission for genuine check, installed-app listing, installation
  of only Bitcoin, and opening only Bitcoin.
- Approved local, test, preview, and production HTTPS origins.
- The approved Manager API URL, ScriptRunner WebSocket URL, and provider ID.
- Approved DMK and WebHID package versions and artifact/source identity.
- Confirmation that no browser secret or client credential is required. If a
  secret is required, stop and redesign around a trusted backend.
- Approved Ledger model IDs, firmware versions, Chrome/Edge versions, and
  operating systems, backed by physical-device evidence.
- CSP `connect-src` rules for the exact approved HTTPS and WSS destinations.
- A privacy decision for the WebHID dependency's direct Sentry exception hook.
- A decision or upstream fix for DMK 1.7.1's ambiguous empty app inventory.
- A runtime feature-disable and authorization-revocation procedure.
- Named security, release, Ledger-relationship, and hardware-QA owners.
- A dedicated, backed-up, non-customer, no-value lab Ledger for mutation tests.

The current reviewed SDK defaults are Manager API
`https://manager.api.live.ledger.com/api`, ScriptRunner
`wss://scriptrunner.api.live.ledger.com/update`, and provider `1`. Defaults are
technical evidence only; they are not proof of authorization.

## Known SDK limitation

DMK 1.7.1 reports the same terminal `installedApps: []` value for both a
legitimately empty device and a ScriptRunner completion that emitted no result.
The Caravan wrapper therefore treats every empty inventory as indeterminate
and does not authorize installation from it. This means a completely blank
Ledger cannot use the install path until Ledger provides distinguishable result
evidence or an independently reviewed workaround is approved.

## Physical acceptance path after authorization

Use current desktop Chrome and Edge over HTTPS with one approved lab Ledger.
Exercise app already present, app absent with another app present, refusal,
disconnect during install, insufficient storage, cancellation, recovery, and
WebHID release/reconnect. Never enter a PIN or recovery phrase in Caravan; the
physical Ledger screen is authoritative.
