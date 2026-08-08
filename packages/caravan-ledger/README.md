# `@caravan/ledger`

`@caravan/ledger` is a browser-only, framework-neutral package for a narrowly
scoped Ledger Bitcoin app preparation flow. It is separate from
`@caravan/wallets`, which continues to own WebUSB signing.

This workspace is an implementation foundation only. It is private, versioned
`0.0.0`, and cannot be published. No usable device-management API exists yet.

## Runtime and packaging

- Modern secure-context browsers with WebHID only
- ECMAScript modules only; no CommonJS entry point
- No browser globals or permission APIs touched while importing the package
- No React, Redux, Node.js polyfills, or signing dependency

## Reviewed runtime dependencies

The private foundation pins and externalizes these runtime dependencies:

- `@ledgerhq/device-management-kit@1.7.1`
- `@ledgerhq/device-transport-kit-web-hid@1.2.4`
- `rxjs@7.8.2`

The supported package-root exports are evaluated as bundler-transformed source
through Vitest's Vite transform without constructing DMK, a transport, an
action, or an observable. This is neither a native-Node dependency import proof
nor the consumer browser-bundle proof. The public package root stays lazy and
Node/SSR-safe. The pinned Ledger packages' published ESM entries currently
contain directory re-exports that Node does not resolve directly;
browser-bundler compatibility and the eventual production adapter boundary
require explicit proof before a canary.

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

The Phase 2 bundle baseline is 2,337 uncompressed bytes and 1,031 gzip bytes
across five reported modules. Ledger SDK, RxJS, and `reflect-metadata` module
counts are all zero because this phase intentionally exports no production SDK
adapter. The clean install still verifies one RxJS 7.8.2 and one
`reflect-metadata` 0.2.2 in the external dependency graph. Sizes are recorded
as evidence, not enforced as a byte budget.

Live Ledger backend or physical-device tests are prohibited until the
[authorization gate](../../documentation/ledger/authorization-gate.md) records
the required written agreement, configuration, test permission, and human
sign-offs.
