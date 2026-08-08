# Ledger Bitcoin installer support runbook

- Applies to: private `@caravan/ledger` v0.1 workflow
- Live-use status: blocked
- Support claims: none until the signed acceptance matrix is complete

This runbook preserves the package's fail-closed classifications. Support must
not convert an unknown state into a success, advise a blind install retry, or
claim that a device is supported because a browser probe, mock, or SDK enum
succeeded.

## Safety rules for every contact

- Never ask for a recovery phrase, private key, PIN, passphrase, device serial
  number, session/device identifier, APDU, full app inventory, raw browser
  object, token, credential, or screenshot containing those values.
- Never ask the user to approve an unexpected device prompt, bypass the genuine
  check, ignore the physical Ledger screen, disable browser security, or use an
  unapproved origin/service configuration.
- The physical device screen is authoritative. If its request does not match
  the reviewed consumer action, stop the flow.
- Do not copy raw SDK errors, stacks, console output, endpoints, or network
  payloads into a ticket. Use only the package-owned error fields.
- Do not start WebUSB while management is active or after
  `handoff: "reconnect-required"` without the reviewed reconnect flow and a new
  user action.
- No live backend or hardware troubleshooting is permitted while the
  [authorization gate](./authorization-gate.md) is incomplete.

## Information that may be recorded

Record only what is needed to route the issue:

- package version and consumer build identifier;
- `BitcoinInstallerError.code`, `phase`, and `recoverable`;
- the public result tuple (`status`, `appOpen`, `handoff`), if one exists;
- browser and operating-system versions;
- coarse, non-identifying timestamps and the normalized phase/interaction
  sequence; and
- whether the user chose, refused, disconnected, or followed reconnect
  guidance, without copying device/vendor text.

Do not infer a model or firmware value from an error. Physical QA records those
facts out of band only under the gated [physical QA runbook](./physical-qa-runbook.md).

## Result and handoff guidance

| Observation                     | Support response                                                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status: "installed"`           | Say only that one install was followed by an independent listing that proved Bitcoin present. Do not claim a version.                                                   |
| `status: "already-installed"`   | Say that preparation found Bitcoin present and no install/update was dispatched.                                                                                        |
| `appOpen: false`                | Preserve the proven status. Ask the user to open Bitcoin manually on the device if the later signing flow requires it; do not repeat installation.                      |
| `handoff: "ready"`              | Management observed the selected HID object closed. The user must still initiate WebUSB from a later click.                                                             |
| `handoff: "reconnect-required"` | Installation status, if returned, remains valid. Keep signing disabled, show approved reconnect/reselection steps, and require a new user action. Do not rerun install. |
| Phase `ready-for-webusb`        | Inspect the result's `handoff`; the phase is terminal for both ready and reconnect-required outcomes.                                                                   |

Future reviewed reconnect copy may ask the user to close competing
Ledger/browser flows, disconnect and reconnect the cable/device as appropriate,
unlock the device, open Bitcoin manually if needed, and then choose a new
explicit continue action. No such copy is approved by this runbook alone, and
it must not promise silent WebUSB permission transfer.

## Public error codes

`recoverable: true` means the contract defines a safe next step. It never means
“repeat the same install call.” Preserve the reported `phase`; post-dispatch
ambiguity takes precedence over a more specific low-level symptom.

The `failed` phase is terminal for that installer. Where the table permits a
later fresh preparation, support must first have the consumer await disposal
and create a new installer workflow. The existing installer is reusable only
after `cancelled`, or through `recover()` from `needs-recovery`.

| Code                         | Meaning                                                                                         | Safe user/operator response                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsupported-environment`    | The capability probe or browser boundary failed.                                                | Do not show a chooser. Use only an evidence-approved secure desktop browser/environment. A positive probe elsewhere is not a support claim.                                            |
| `permission-denied`          | Browser device permission was explicitly denied before mutation.                                | Respect the refusal. If product policy permits, offer a later fresh preparation from a new click; do not direct the user to weaken browser security.                                   |
| `no-device-selected`         | The chooser returned no usable selection.                                                       | Allow dismissal. A later fresh click may begin a new preparation; do not infer disconnection or unsupported hardware.                                                                  |
| `device-busy`                | Another installer/runtime/device use owns the management boundary.                              | Wait for it to finish or close the competing approved flow, then start a fresh preparation. Never overlap management and signing transports.                                           |
| `device-disconnected`        | The device disconnected before mutation could occur.                                            | Reconnect, unlock, and begin a fresh preparation. If mutation may have started, the package reports `state-unknown` instead.                                                           |
| `device-locked`              | The pinned SDK explicitly reported a locked device before mutation.                             | Ask the user to unlock on the physical device, then begin a fresh preparation. Do not request or handle the PIN.                                                                       |
| `device-not-onboarded`       | The device is not ready for this management operation.                                          | Stop. Use an official onboarding/support path only if it is separately approved before use; otherwise escalate. Never handle recovery material.                                        |
| `device-not-genuine`         | The genuine action returned false.                                                              | Stop immediately. Do not list, install, retry around the check, or tell the user to trust the device. Escalate through the assigned security/Ledger relationship path when one exists. |
| `unsupported-device`         | The connected model is outside the compiled approved allowlist.                                 | Stop. Do not override or remotely widen policy. The current private build's allowlist is empty, so no model is yet accepted.                                                           |
| `unsupported-firmware`       | The pinned SDK explicitly reported an unsupported firmware condition.                           | Stop the Caravan flow. Use Ledger/support guidance only if separately approved before use; otherwise escalate. Do not guess a firmware version or add metadata authority.              |
| `user-refused`               | The physical-device action was refused in a safely classified state.                            | Respect the refusal. Do not coach approval. A later fresh preparation is allowed only when the reported phase is safely pre-mutation.                                                  |
| `bitcoin-app-unsupported`    | An explicit reviewed SDK signal says the Bitcoin app operation is unsupported.                  | Stop and escalate with only normalized evidence. Do not infer this code from catalog absence or attempt another application.                                                           |
| `insufficient-space`         | The install path explicitly reported insufficient space.                                        | Do not retry installation. Offer `recover()` from a new click so current state is re-listed. Storage management is outside this package and requires separately approved guidance.     |
| `network-unavailable`        | An explicit network failure occurred in a safely classified stage.                              | Preserve the reported classification. Before mutation, a later fresh preparation may be offered after connectivity returns. After possible dispatch, only recovery is safe.            |
| `ledger-service-unavailable` | The configured Ledger service path was unavailable.                                             | Stop live attempts. Use only an incident route approved and owned before live use; an absent route blocks resumption. Do not switch endpoints or providers.                            |
| `secure-channel-failed`      | The expected secure connection could not be completed.                                          | Stop. Follow the phase-specific fresh preparation or recovery path; never bypass the secure channel or introduce a secret/config override.                                             |
| `operation-timeout`          | A read-only or otherwise provably non-mutating operation exceeded its reviewed bound.           | Allow cleanup to finish. A new preparation may be offered only if the returned phase/error permits it. Mutation timeout is instead `state-unknown`.                                    |
| `cancelled`                  | Caller cancellation completed while state remained safely non-mutating/unconsumed.              | Confirm cancellation. A fresh direct-click `prepare()` may be offered after cleanup; the native chooser might still need user dismissal.                                               |
| `state-unknown`              | Mutation may have reached the device or independent verification did not prove Bitcoin present. | Offer only `recover()` from a new direct user gesture. Never reuse the old plan, automatically retry install, or treat progress/completion as proof.                                   |
| `internal`                   | A contract/programmer or unrecognized pre-mutation failure was normalized.                      | Stop this installer, await disposal, and capture only the allowed public fields. Escalate to the package maintainer/security reviewer; do not expose or request raw causes.            |

## Common incident paths

### Lock, onboarding, or refusal

Keep these distinct. Unlocking occurs only on the device, onboarding is outside
this package, and refusal is always respected. A support person must never
request credentials or instruct approval merely to make the workflow proceed.

### Non-genuine result

No continuation is allowed. Preserve the normalized evidence, dispose the
installer, and escalate through assigned security and Ledger relationship
owners. Those roles are currently unassigned, which is itself a release blocker.

### Insufficient space

Do not offer install again. Use a new-click `recover()` to learn whether the
first attempt changed state. If Bitcoin remains absent, exit the installer and
use device-management guidance only if it has been separately approved; if no
such guidance exists, stop and escalate. The package has no storage cleanup or
uninstall authority.

### Service outage or secure-channel failure

Do not redirect traffic, inject a provider, retry across unknown endpoints, or
embed credentials. Pause new sessions, allow active sessions to clean up, and
follow the incident policy in [maintenance](./maintenance.md).

### State unknown

This classification is deliberately stronger than the apparent low-level
error. Only recovery may produce a new plan. If recovery cannot prove state,
stop and escalate; do not blind retry.

### Release timeout or ambiguity

`handoff: "reconnect-required"` is not an installation failure. Preserve the
returned status and `appOpen` value, prevent automatic WebUSB, and follow the
reviewed reconnect path. Repeated timeout/ambiguity is a browser/device
compatibility finding, not a reason to lengthen the deadline without review.

## Escalation and closure

Until named roles accept the [maintenance policy](./maintenance.md), every
security, privacy, authorization, hardware, and release escalation is blocked
from production resolution. A ticket may be closed as user-cancelled or
unsupported only when that matches the public classification; do not relabel an
unknown mutation as success or harmless failure.
