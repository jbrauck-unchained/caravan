# ADR 0001: Isolate Ledger Bitcoin app installation in `@caravan/ledger`

- Status: Proposed implementation baseline
- Decision date: Pending
- Review: Product, Caravan engineering, security, and release approval pending
- External authorization: Pending; see the [authorization gate](../authorization-gate.md)

## Context

Caravan currently signs with Ledger devices through `@caravan/wallets` and a
WebUSB transport. A first-party browser application also needs a narrowly
scoped way to check for Ledger's official Bitcoin app, install it when absent,
and return the device to the existing signing path.

Ledger's Device Management Kit (DMK) can discover devices over WebHID and can
perform genuine-check, app-inventory, installation, and open-app actions. Its
full API also exposes raw APDUs, arbitrary application names, uninstall and
update operations, firmware-related operations, endpoints, providers, session
identifiers, device identifiers, observables, and transport objects. Caravan
does not need or authorize that broader surface.

Ledger's published legal notice distinguishes open-source use of the DMK from
permission to access Ledger backend services. The implementation may be built
and tested offline, but it must not make live backend requests until the
[authorization evidence register](../authorization-gate.md) is approved.

## Decision

Caravan will add a separate package named `@caravan/ledger`.

The first public release will be browser-only, ESM-only, framework-neutral,
and safe to import without evaluating `window`, `navigator`, or WebHID access.
It will own WebHID only for the bounded management lifecycle below:

1. A preloaded consumer calls `prepare()` directly from a user gesture.
2. The package asks the browser to select one Ledger and connects.
3. Before starting any management action, including genuine check, it applies
   a fail-closed compiled model policy to the connected device.
4. Only an allowed model proceeds to genuine check and then to an app-list
   action, whose result is reduced to the single fact "Bitcoin present or
   absent."
5. The package returns an opaque, expiring, instance- and session-bound plan.
6. `install(plan)` is the explicit consumer-confirmation boundary. If Bitcoin
   is absent, it installs only the exact internal constant `Bitcoin` and proves
   the postcondition with a fresh, independent app-list action. If Bitcoin is
   already present, it performs no mutation.
7. After either verified branch, it makes one fixed, best-effort attempt to
   open `Bitcoin`. Failure or refusal to open does not erase a proven install
   result.
8. It disconnects and disposes every management resource it owns, then waits a
   bounded period to observe the selected WebHID handle closed.
9. It reports whether a later, separate user gesture can proceed to Caravan's
   existing WebUSB signing flow or whether reconnect/reselection is required.

The exact public lifecycle is defined in the
[v0.1 contract](../public-contract-v0.1.md). `@caravan/wallets` remains the
signing API and must never share concurrent device ownership with
`@caravan/ledger`.

## Authority boundary

The `0.1.0` package may:

- discover one Ledger through WebHID after a direct user gesture;
- fail closed against a compiled device-model policy immediately after
  connection and before genuine check or any other management action;
- check that an allowed selected device is genuine;
- determine only whether the official app named exactly `Bitcoin` is present;
- install that app only when a valid package-created plan says it is absent;
- independently re-list apps to prove the installation result;
- make one fixed, best-effort attempt to open `Bitcoin`; and
- close its own management resources and report handoff readiness.

The package must not:

- accept an application name from a caller;
- update, downgrade, or uninstall an application;
- manage firmware, operating systems, language packs, providers, or catalogs;
- expose raw APDUs or a generic command/action runner;
- expose DMK, RxJS, XState, HID, WebSocket, session, transport, provider, or
  endpoint objects or types;
- expose the installed Bitcoin version or the full installed-app inventory;
- replace `@caravan/wallets` or migrate signing from WebUSB to WebHID;
- support Node.js, React Native, Electron, mobile browsers, Firefox, or Safari;
- persist or emit stable device identity, runtime device/session identifiers,
  raw vendor errors, or app inventory;
- initialize analytics, console logging, or error reporting; or
- contact Ledger backend services before written authorization is recorded.

Future management capabilities require a separate ADR, an explicit authority
and privacy review, and an intentional semver change. The first API will not
contain placeholders for those capabilities.

## Reviewed SDK baseline and mismatch rule

The implementation candidate pins are
`@ledgerhq/device-management-kit@1.7.1`,
`@ledgerhq/device-transport-kit-web-hid@1.2.4`, and `rxjs@7.8.2`.
Phase 0 statements about SDK enums, defaults, actions, and errors describe the
reviewed source baseline; they are not proof that a later lockfile, installed
package, packed artifact, or Ledger-authorized version is identical.

Before SDK-dependent implementation continues, engineering must reconcile the
exact resolved artifacts with reviewed immutable source. If the resolved or
authorized version differs, every affected mapping and support assumption
returns to unknown: stop the dependent slice, update these documents and the
playbook, review the source and artifact, and add or update contract tests.
Agents must never adapt an SDK mismatch silently.

## Ownership and trust boundaries

- The consumer owns user authentication, entitlement, feature flags, UX,
  localization, analytics, support content, and rollout.
- `@caravan/ledger` owns operation ordering, the fixed app name, plan validity,
  concurrency control, redaction, cleanup, and the WebHID lifecycle.
- Ledger DMK owns the device protocol and secure-channel implementation.
- Ledger services own backend authorization and delivery of official app data.
- The physical device screen is authoritative for user confirmation.
- `@caravan/wallets` owns the later WebUSB signing lifecycle.

The package limits the damage available through its public surface, but it is
not an authorization boundary against malicious same-origin JavaScript.

## Consequences

- The package is intentionally stateful during a short management session,
  unlike the existing stateless wallet-interaction abstraction.
- Consumers receive a small Caravan-owned state and error vocabulary instead
  of vendor objects.
- Cancellation during a mutating action cannot prove rollback; ambiguous
  outcomes require recovery and a fresh app listing.
- App-install success is never inferred from progress or action completion.
- WebHID disconnect completion is not proof that the operating-system handle
  has closed; handoff needs an independent bounded release observation.
- The initial package stays private and versioned `0.0.0` until authorization,
  security, compatibility, and physical-device release gates pass.

## Alternatives rejected

### Add DMK to `@caravan/wallets`

Rejected because it combines management and signing authority, expands an
already broad package, complicates transport ownership, and exposes an ESM-only
WebHID dependency to existing consumers.

### Export a generic `installApp(name)` or DMK facade

Rejected because it grants arbitrary device-management authority and makes the
package a Ledger Live replacement rather than a Bitcoin-specific primitive.

### Reimplement Ledger's protocol

Rejected because the official DMK is the selected protocol implementation.
Caravan will reduce and constrain its API, not reproduce its APDUs or secure
channel.

### Migrate signing to WebHID in the same release

Rejected because the goal is a deterministic handoff to the established
WebUSB signing path. A transport migration is independent work.

## Verification references

- [Threat model](../threat-model.md)
- [Public contract v0.1](../public-contract-v0.1.md)
- [Support and acceptance policy](../support-matrix.md)
- [Ledger DMK legal notice](https://developers.ledger.com/docs/device-interaction/getting-started)
- [Ledger secure-channel actions](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/device-management-kit/secure-channel)
