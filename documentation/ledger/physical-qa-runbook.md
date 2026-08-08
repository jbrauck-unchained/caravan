# Ledger installer physical QA runbook

## Stop gate

**Do not connect a physical device or allow the package to contact a Ledger
service under this runbook yet.** Live and physical execution is prohibited
until every prerequisite below is recorded as approved by an accountable human.
The current private package remains `0.0.0`, its production model allowlist is
empty, and it has no supported hardware combination.

This document is a safe execution template for a later authorized exercise. It
is not authorization, a test waiver, or a procedure for bypassing the compiled
policy.

## Required approvals before scheduling

- [ ] The [authorization gate](./authorization-gate.md) records an effective
      written agreement and separate permission for the exact test origin,
      environment, actions, SDK versions, service configuration, automated traffic,
      and physical-device exercise.
- [ ] The agreement's controlled reference, effective/expiry dates, traffic
      limits, incident contacts, privacy constraints, and telemetry decision are
      current. No confidential agreement text is copied into git.
- [ ] The exact Manager/ScriptRunner/provider configuration and required CSP
      have been reconciled and reviewed. No browser secret is required.
- [ ] The pinned WebHID Sentry behavior has been empirically characterized in
      the exact consumer bundle and approved or mitigated by security/privacy and
      the Ledger relationship owner.
- [ ] The [private-readiness gate](./private-readiness.md) is green for the
      exact commit and tarball: deterministic suites, immutable mock/offline SDK
      contract, clean consumers, artifact/API/privacy checks, wallet/coordinator
      regression, coverage, and root CI.
- [ ] Package maintainer, security reviewer, Ledger relationship/incident owner,
      physical QA owner, downstream contact, and release owner are named and have
      accepted their responsibilities.
- [ ] A controlled QA source policy for the exact candidate model has been
      reviewed against authorization. The production allowlist must not be bypassed
      through runtime configuration or an internal test seam.
- [ ] The exact lab device model/firmware, browser binary/version, operating
      system/version, approved origin, package commit, packed tarball digest, and
      dependency integrity are recorded in the controlled test plan.
- [ ] A dedicated test device and test wallet with no production funds are
      available. Test personnel know how to stop without entering or disclosing
      recovery material.

Any unchecked, expired, mismatched, or unavailable item stops the exercise.
The person running QA may not self-approve a missing authorization, privacy, or
release gate.

## Safety and privacy rules

- Never enter a recovery phrase, private key, or passphrase as part of this
  runbook, and never photograph, transmit, or record one. Never disclose or
  record a PIN. If an approved locked-device case requires an unlock, the
  operator may enter the dedicated lab device's known PIN only on the physical
  device, shielded from observers; never enter it in the browser, consumer, log,
  screenshot, or evidence record. Also never record a device serial number,
  session/device identifier, HID object, APDU, token, credential, full app
  inventory, raw error, or service payload.
- The physical Ledger screen is authoritative. Stop on an unexpected app name,
  action, destination, or prompt; do not approve it to continue testing.
- Test only the fixed official app name `Bitcoin`. Do not exercise update,
  downgrade, uninstall, storage cleanup, firmware/language management, arbitrary
  apps, raw commands, or signing from this package.
- Do not change endpoints/providers, disable genuine checks, widen the model set
  remotely, patch out release checks, initialize logging/telemetry, or extend a
  timeout to make a case pass.
- Keep management and signing separate. WebUSB begins only from a later user
  click after an acceptable handoff. Never force-close an ambiguous HID device.
- Pause immediately on unexpected network traffic, raw-data capture, a privacy
  canary, state-machine violation, model mismatch, or inability to identify the
  exact artifact under test.

## Evidence record

Create one controlled record per exact model/firmware/browser/OS cell. Use a
non-identifying evidence ID and record:

| Field                | Required value                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Evidence ID and date | Non-identifying identifier and UTC date/time                                                  |
| Authorization        | Controlled agreement/test-permission reference and expiry                                     |
| Artifact             | Commit, package version, tarball digest, dependency-lock digest                               |
| Environment          | Approved origin, browser binary/version, OS/version                                           |
| Device               | Model and firmware only; no serial/runtime identifier                                         |
| Network/privacy      | Approved destinations expected; sanitized observation result and Sentry decision reference    |
| Scenario             | Named case from this runbook, expected public phases/result/error                             |
| Observation          | Sanitized package-owned events/error/result only                                              |
| Resource outcome     | Management cleanup, HID observation, later-click WebUSB result, leak counters where available |
| Review               | QA, engineering, security, and release decisions with controlled references                   |

Screenshots and traces must be reviewed and redacted before attachment. Do not
capture the user's computer broadly. Store controlled artifacts outside git
when they can contain device, account, network, or personal data.

## Preflight on the exact artifact

1. Verify the checked-out commit and packed tarball digest against the approved
   test plan.
2. Verify `@caravan/ledger` is still private `0.0.0`; physical evidence does not
   authorize publication.
3. Verify exact dependency pins and lock integrity.
4. Rerun the approved deterministic/offline/private-readiness commands. A skip,
   changed baseline, or warning that weakens a gate is a failure.
5. Start the approved clean consumer and browser binary with network capture
   scoped to the test application. Confirm no request occurs on import, support
   probing, or installer construction.
6. Confirm the consumer imported the package before enabling the button and
   calls `prepare()` directly in the click task.
7. Confirm the consumer has no app-name, endpoint, provider, credential,
   transport, raw action, or internal dependency control.

Do not invent a browser-lab command. Record the reviewed harness command only
after its source, binary/image digest, network mode, and authorization are part
of the private-readiness evidence.

## Required scenario sequence

Run named cases independently and reset to a known lab state between cases.
Do not carry a plan, session, permission assumption, or success claim from one
case to another.

### A. Inert and chooser behavior

1. Import, probe support, and construct the installer; prove no chooser, device
   connection, service request, or logging occurs.
2. Trigger preparation from a direct click and record synchronous chooser
   appearance.
3. Dismiss the chooser and record `no-device-selected` or the browser's approved
   equivalent path.
4. Deny permission where the browser exposes a distinct denial path.
5. Cancel while the chooser is open, then exercise both late dismissal and late
   selection. Prove late work cannot connect or begin an action.
6. Repeat with a competing management/signing owner and verify `device-busy`
   without transport overlap.

### B. Model, genuine, and read-only gates

1. Connect an unknown/unapproved model and prove it stops with
   `unsupported-device` before genuine, list, or mutation.
2. For an authorization-approved candidate compiled into the controlled QA
   policy, exercise locked, not-onboarded where safely available, genuine
   refusal/failure, service failure, and successful genuine/list paths.
3. Prove no public event/error/log contains model/firmware, app inventory,
   Bitcoin version, identifier, raw vendor text, or privacy canary.

The current empty production allowlist permits only the fail-closed unsupported
case. Do not proceed to an allowed-model path until the required reviewed source
policy exists.

### C. Already-installed path

1. Prepare a state where a fresh listing reports Bitcoin present.
2. Confirm the plan reports only `already-installed`.
3. Explicitly confirm and prove no install or update action is dispatched.
4. Exercise open success and refusal/failure separately.
5. Verify the result preserves `status: "already-installed"` and reports
   `appOpen` independently.

### D. Missing/install/verify path

1. Prepare a state where Bitcoin is absent and confirm
   `installation-required`.
2. Exercise consumer cancellation before confirmation; prove no mutation.
3. Exercise physical install refusal and preserve the safe classification.
4. On the authorized success case, approve only the expected Bitcoin prompt.
5. Prove install progress/completion does not resolve success; a new independent
   listing must prove Bitcoin present.
6. Record `status: "installed"` only after that proof.
7. Exercise insufficient space and verify a new-click recovery re-lists before
   any new plan is offered. Do not perform storage cleanup through this package.

### E. Ambiguous mutation and recovery

At each authorized install/verification boundary, use the approved fault method
to exercise cancellation, disconnect, service loss, timeout, navigation, and
late vendor emissions. Never create a fault that risks a non-test device.

For every ambiguous case:

1. require `state-unknown`/`needs-recovery`;
2. prove the old plan cannot be reused;
3. prove no automatic install retry occurs;
4. call `recover()` only from a new user click; and
5. require a new session, genuine check, and fresh listing before a new plan.

### F. Release and separate-click WebUSB handoff

Exercise at least:

- immediate observed close;
- delayed close;
- physical removal;
- release deadline expiration;
- observation rejection/unavailability;
- two devices, including same-model ambiguity;
- disconnect success before close;
- disconnect rejection followed by close;
- disconnect rejection plus timeout; and
- a never-settling disconnect bounded by the reviewed watchdog.

For each case, record the exact public result and prove:

1. `ready-for-webusb` is terminal for either handoff value;
2. only observed unique release yields `handoff: "ready"`;
3. ambiguity/unavailability/timeout yields `reconnect-required` without changing
   a proven installation status;
4. WebUSB never starts from the `install()` continuation;
5. the signing chooser/acquisition begins only on a later user click when the
   approved handoff/reconnect conditions are satisfied; and
6. every timer, listener, subscription, plan, session, transport reference, and
   runtime lease is released exactly once.

### G. Repetition and platform behavior

Repeat authorized success, refusal, cancellation, recovery, and reconnect paths
across unplug/replug cycles. Exercise sleep/wake, permission revocation, and
navigation where the platform permits. Run the full row separately for every
claimed browser and OS; evidence does not transfer between them.

## Stop, failure, and incident handling

Stop the current case and prevent new sessions when:

- the observed action or prompt differs from the fixed contract;
- mutation state cannot be classified as the package reports;
- WebUSB overlaps WebHID or starts without a later click;
- a raw/private value appears in output, logging, capture, or traffic;
- a release/resource leak occurs;
- authorization, configuration, artifact identity, or test permission is
  uncertain; or
- a dependency/service incident is announced.

Allow an active session only the minimum cleanup needed to stop safely. Follow
the [maintenance incident procedure](./maintenance.md). Do not work around a
failure by changing the model policy, service configuration, timeout, error
mapping, privacy capture, or test expectation.

## Completion criteria

A row passes only when every applicable required path is recorded, failures are
resolved rather than waived, network/privacy observations match authorization,
and QA, engineering, security, and release owners approve the exact artifact.
A not-applicable path needs written reviewer justification. One passed row
supports only that exact model/firmware/browser/OS combination and does not make
the private package publishable by itself.
