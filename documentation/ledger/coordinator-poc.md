# Coordinator Bitcoin installer proof of concept

This private acceptance mode demonstrates the coordinator experience for the
fixed Ledger `Bitcoin` app workflow. It uses the exact public
`@caravan/ledger` installer contract with a deterministic simulator. It never
opens WebHID or WebUSB, contacts Ledger, changes a physical device, or grants
permission to enable live use.

## Start the proof of concept

Use Node 24 and npm 11.14.1 from the repository root:

```sh
npm run dev:ledger-poc
```

Open the coordinator URL printed by Vite, then select **Ledger Bitcoin App** in
the navigation. The direct route is `/#/ledger-bitcoin`.

The route is compiled out of ordinary coordinator builds. It exists only when
the explicit `CARAVAN_LEDGER_POC=true` acceptance flag is used; the supported
local entry point above sets that flag, and every screen carries a simulation
warning. Any opted-in build is private acceptance evidence, not a production
release candidate.

## Acceptance scenarios

Run each selectable scenario from a fresh reset:

1. **Install succeeds** — check the simulated Ledger, review the
   installation-required confirmation, install, observe progress, and verify
   the installed/opened/released result.
2. **Already installed** — verify the screen promises no install or update,
   then performs only the fixed open-and-release continuation.
3. **User refuses** — verify a pre-install secure-connection refusal is finite,
   sanitized, and retryable without claiming installation.
4. **State unknown and recovery** — verify an ambiguous mutation requires a new
   recovery action and never retries installation automatically.
5. **Reconnect required** — verify successful installation is preserved while
   release ambiguity is shown separately.

For every scenario, confirm that no signing action appears and no WebUSB flow
starts. Browser developer tools should show no Ledger or other non-local
network request caused by the simulator.

## What this proves

This mode proves coordinator copy, sequencing, confirmation, progress,
cancellation, recovery, result interpretation, and cleanup against the frozen
package contract. All device-state and success claims in the flow are explicitly
marked as simulated. The same visual flow can later receive the real installer
factory after authorization.

It does not prove Ledger's native chooser, genuine check, Manager or
ScriptRunner services, physical prompts, app installation, OS handle release,
or any device/browser/firmware support row. Those remain governed by the
[authorization gate](./authorization-gate.md) and
[physical QA runbook](./physical-qa-runbook.md).
