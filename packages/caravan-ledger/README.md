# `@caravan/ledger`

`@caravan/ledger` is a browser-only, framework-neutral package for a narrowly
scoped Ledger Bitcoin app preparation flow. It is separate from
`@caravan/wallets`, which continues to own WebUSB signing.

This workspace is a private, versioned `0.0.0` implementation foundation and
cannot be published. Its parameterless public factory now exposes the complete
Phase 3 read-only preparation flow against deterministic fakes. Production
hardware remains fail closed because the reviewed production model allowlist is
intentionally empty.

## Runtime and packaging

- Modern secure-context browsers with WebHID only
- ECMAScript modules only; no CommonJS entry point
- No browser globals or permission APIs touched while importing the package
- No React, Redux, Node.js polyfills, or signing dependency

The package has two ESM artifacts behind one root export. Browser-aware
bundlers select `dist/browser.js`, which statically imports the pinned Ledger
adapter but does not construct it until `prepare()`. Native Node and SSR select
the SDK-free `dist/index.js`; its factory returns the same facade but always
reports an unsupported environment. `module` and `browser` point to the browser
artifact for older bundlers, while the ordered `node` export condition keeps
native Node on the neutral artifact.

## Read-only API

```ts
import { createBitcoinAppInstaller } from "@caravan/ledger";

const installer = createBitcoinAppInstaller();
const unsubscribe = installer.subscribe((event) => {
  renderLedgerProgress(event);
});

try {
  const plan = await installer.prepare();
  renderConfirmation(plan.status);
} finally {
  unsubscribe();
  await installer.dispose();
}
```

`prepare()` performs only support checking, device selection, connection,
genuine checking, and exact Bitcoin-presence inspection. It never installs,
updates, uninstalls, or opens an app. A successful result is a frozen,
in-memory, instance/session-bound plan with a five-minute lifetime. Serialized,
forged, foreign, expired, cancelled, disconnected, and disposed plans carry no
authority. Phase 3 deliberately rejects `install()` and `recover()` before any
mutating action exists.

The initial `prepare()` call must remain directly inside the user activation
that is allowed to open the WebHID chooser. Support checking, realm-wide lease
reservation, the selecting transition, discovery start, and discovery
subscription all occur synchronously in that call.

## Reviewed runtime dependencies

The private foundation pins and externalizes these runtime dependencies:

- `@ledgerhq/device-management-kit@1.7.1`
- `@ledgerhq/device-transport-kit-web-hid@1.2.4`
- `rxjs@7.8.2`

The browser root is evaluated through Vitest and through a clean packed Webpack
5.64.4 consumer without constructing DMK, requesting permission, enumerating
devices, opening a network connection, or logging. A separate native-Node gate
proves the package export resolves to the neutral artifact. The pinned Ledger
packages' published ESM entries currently contain directory re-exports that
Node does not resolve directly, which is why native Node must not select the
browser artifact.

## Cleanup limitation

The pinned DMK boundary exposes `connect()` and `disconnect()` only as promises;
it provides no abort signal or bounded settlement guarantee. If either promise
never settles, cancellation/disposal must retain the realm-wide lease and await
it so that a late connection cannot create an unowned device session. Releasing
the lease early or resolving `dispose()` would falsely claim cleanup. The race
suite pins this fail-closed limitation until a reviewed bounded cleanup policy
or an abortable pinned-SDK primitive exists.

## Authority boundary

The intended first public contract will manage only Ledger's official app named
exactly `Bitcoin`. It will not expose arbitrary app names, updates, downgrades,
uninstall, firmware, language packs, raw APDUs, Ledger transports, providers,
endpoints, or signing.

The normative architecture, authorization, security, public-contract, and
support decisions live in the repository's
[Ledger governance documents](../../documentation/ledger/adr/0001-ledger-bitcoin-installer-package.md).

## Development

Use the Node and npm versions pinned by the Caravan repository.

```sh
npm run ci --workspace=@caravan/ledger
```

`test:artifact` checks the actual built declarations, runtime export snapshot,
manifest policy, and `npm pack --dry-run` file allowlist. `test:consumer` packs
the package, installs that tarball into a disposable fixture whose only runtime
dependency is `@caravan/ledger`, compiles it with TypeScript 4.6.4, and creates
a production ESM bundle with Webpack 5.64.4. The compatibility compiler and
bundler are fixture-only dev dependencies and never enter this package's
manifest or tarball. Standalone packaging tests rebuild first so stale output
cannot pass. The consumer install uses a fresh disposable npm cache and may
require npm registry access to fetch the exact pinned compatibility tooling;
it never writes install state into the workspace or the packed package.

The Phase 3 packed-consumer baseline records the browser entry plus the expected
Ledger SDK, RxJS, and `reflect-metadata` graph. The clean install verifies one
RxJS 7.8.2 and one `reflect-metadata` 0.2.2 physical copy. Sizes and module
counts are recorded as evidence, not enforced as a byte budget.

Live Ledger backend or physical-device tests are prohibited until the
[authorization gate](../../documentation/ledger/authorization-gate.md) records
the required written agreement, configuration, test permission, and human
sign-offs.
