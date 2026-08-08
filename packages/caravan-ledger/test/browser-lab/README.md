# Private Ledger browser lab

This private fixture checks the browser-only parts of the Ledger installer
contract without adding a Coordinator or Trefoil demo route. It is excluded by
the package `files` allowlist and exposes counters only on the fixture's
`window`, never from `@caravan/ledger`.

The deterministic Vitest layer covers SSR/no navigator, insecure context,
missing/malformed/throwing HID, a rejecting-but-uninvoked HID facade, direct
click ordering, duplicate clicks, explicit cancellation and click-to-retry,
the wired app's dispose-before-recreation behavior after chooser dismissal,
event rendering, contained asynchronous WebUSB failure, and the separate-click
handoff controller contract. It also rejects encoded traversal in the local
server policy. Run it from the repository root:

```sh
npx vitest run --config packages/caravan-ledger/vitest.config.ts packages/caravan-ledger/test/browser-lab
```

The build layer rebuilds and locally packs `@caravan/ledger`, verifies the
packed Node entry under SSR globals, confirms this lab is absent from the
tarball, and bundles the page against the packed `dist/browser.js`. It performs
no install and no network download. The default verification removes its
temporary package and page output before exiting:

```sh
node packages/caravan-ledger/test/browser-lab/scripts/build.mjs
```

Pass `--out <new-directory>` only when retained page output is needed for
manual inspection; the path must not already exist.

The page loads `hid-facade.js` as a blocking classic script before any package
code. Package code is then preloaded during page startup, before the direct
prepare button is enabled. The separate “first dynamic import after this
click” control is an intentionally invalid example: the harness records that
the synchronous click task ended and refuses to call `prepare()`.

Native Chromium is deliberately gated. The default command fails clearly as
“not run” so it cannot be mistaken for browser evidence, and it does not
download a browser:

```sh
node packages/caravan-ledger/test/browser-lab/scripts/run-native.mjs
```

To run the Playwright-style suite, first provision the exact browser revision
through the repository's approved dependency workflow, then opt in:

```sh
CARAVAN_LEDGER_RUN_NATIVE=1 node packages/caravan-ledger/test/browser-lab/scripts/run-native.mjs
```

The server binds only to `127.0.0.1`, rejects malformed and encoded-traversal
request targets, and removes both build-owned temporary directories on clean
shutdown. The native suite, when explicitly run, fails on any page console
output, request failure, dialog, or HTTP(S) request outside loopback. Merely
listing those tests or passing Vitest/build checks is not native-browser
evidence. Injected WebHID proves application ordering and rendering only; it
does not reproduce Chromium's permission UI and is not physical-device
certification. The physical QA runbook remains required for release evidence.
