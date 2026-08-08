# Ledger Bitcoin installer support and acceptance policy

- Status: Policy proposed; all physical evidence and human approval pending
- Compiled allowlist: Not yet implemented and contains no approved claims
- Live backend authorization: `unknown`; see the
  [authorization gate](./authorization-gate.md)
- Initial browser targets: Current stable Chrome and Edge, pending evidence

This document separates what the reviewed SDK recognizes from what Caravan is
authorized, tested, and willing to support. An SDK enum, browser capability,
vendor claim, or successful build is not a Caravan support claim.

## Support decision rule

A device model may enter a released compiled allowlist only when all of the
following are true:

1. Ledger's written agreement allows the exact environment, origin, actions,
   endpoints, provider, and dependency versions.
2. Product has selected the model/browser/OS combination for the release.
3. Engineering has implemented a fail-closed exact model allowlist.
4. Security has reviewed the dependency artifact, authority, privacy, network,
   error, cancellation, recovery, and handoff behavior.
5. Physical-device QA has completed every required path on a recorded firmware,
   browser version, and operating-system version.
6. The release owner has approved the evidence row and exact package artifact.

If any condition is unknown, pending, rejected, expired, or missing, the
combination is not supported. Unknown and untested are distinct evidence states
but both fail closed.

Remote or consumer configuration may disable an approved combination. It may
never enable a model, firmware claim, browser, operating system, origin, action,
endpoint, or provider absent from the compiled and authorized release.

## Evidence statuses

| Status | Meaning | May be claimed as supported? |
| --- | --- | --- |
| `unknown` | Required facts have not been established. | No |
| `pending` | Evidence or review is planned/in progress but incomplete. | No |
| `passed` | The named test evidence passed for an exact combination. | Not by itself; authorization and sign-offs are also required. |
| `failed` | At least one required acceptance path failed. | No |
| `unsupported` | The environment is deliberately outside v0.1 or lacks a required capability. | No |
| `approved` | All evidence, authorization, compiled policy, and human sign-offs are complete for the exact release. | Yes |
| `expired` | Evidence or authorization is no longer current. | No |

## Candidate device models

The local reviewed source baseline, whose manifest currently reports DMK
`1.7.1`, names the following model identifiers. These are candidates for
evidence collection only; none is approved or claimed. Before implementation,
the exact resolved package and packed artifact must be reconciled with
immutable reviewed source. A source/artifact or authorized-version mismatch
invalidates this table and blocks the dependent slice until the documents,
tests, and evidence are updated and reviewed.

| SDK model | SDK identifier | Compiled in v0.1 allowlist | Physical device available | Firmware evidence | Authorization | Release status |
| --- | --- | --- | --- | --- | --- | --- |
| Ledger Nano S | `nanoS` | Pending decision | `unknown` | `unknown` | `unknown` | Not supported |
| Ledger Nano S Plus | `nanoSP` | Pending decision | `unknown` | `unknown` | `unknown` | Not supported |
| Ledger Nano X | `nanoX` | Pending decision | `unknown` | `unknown` | `unknown` | Not supported |
| Ledger Stax | `stax` | Pending decision | `unknown` | `unknown` | `unknown` | Not supported |
| Ledger Flex | `flex` | Pending decision | `unknown` | `unknown` | `unknown` | Not supported |
| SDK `APEX` / identifier `apexp` | `apexp` | Pending naming and product decision | `unknown` | `unknown` | `unknown` | Not supported |
| Any other or unknown model | Not in reviewed enum | No | Not applicable | Not applicable | Not applicable | Unsupported; fail closed |

The `APEX` enum/name must not be translated into a consumer-facing model claim
until Ledger naming, authorization, product intent, and physical evidence are
reviewed.

## Firmware limitation and policy

The genuine-check, list-installed-apps, and install outputs selected for v0.1
do not expose firmware metadata. Adding a metadata action only to preflight a
firmware allowlist would widen the approved action and privacy surface.

Therefore v0.1 has these rules:

- It does not return or persist firmware or Bitcoin app version.
- It does not claim a model/firmware combination from SDK source alone.
- Physical acceptance evidence records firmware out of band without returning
  it through the package API.
- The public `unsupported-firmware` error is emitted only when the pinned SDK
  explicitly reports that condition.
- An unknown error is never guessed to be firmware-related.
- Before install dispatch, an unrecognized SDK error maps to `internal`.
- After install dispatch, an unrecognized error maps to `state-unknown` until a
  new recovery session re-lists applications.
- A released model allowlist may still contain a model whose acceptance rows
  name tested firmware versions; those rows are evidence, not a runtime
  firmware preflight guarantee.

The reviewed `InstallAppDeviceAction` also reports catalog absence as an unknown
device-action error rather than an explicit unsupported-app or firmware error.
`bitcoin-app-unsupported` is reserved for an explicit reviewed SDK signal.

## Browser policy

| Environment | v0.1 policy | Evidence status | Notes |
| --- | --- | --- | --- |
| Current stable Google Chrome desktop | Candidate | `pending` | Exact version, OS, gesture behavior, chooser, and handoff must be recorded. |
| Current stable Microsoft Edge desktop | Candidate | `pending` | Exact version, OS, gesture behavior, chooser, and handoff must be recorded. |
| Brave desktop | Evidence-only candidate | `pending` | Do not claim until separately tested and approved. |
| Firefox desktop | Unsupported | `unsupported` | Required WebHID path is unavailable for this v0.1 design. Existing wallet U2F behavior does not change this. |
| Safari desktop | Unsupported | `unsupported` | Required WebHID path is unavailable for this v0.1 design. |
| Mobile browsers | Out of scope | `unsupported` | No mobile support in v0.1. |
| Electron or embedded webviews | Out of scope | `unsupported` | Package is for a first-party browser application. |
| Node.js, React Native, or other non-browser runtimes | Out of scope | `unsupported` | Import may be safe for tooling, but the runtime feature is unsupported. |

Support is capability-based, not user-agent-based. The public probe checks for
a browser runtime, secure context, and usable WebHID surface. A positive probe
does not turn an untested browser into a supported one.

## Secure-context and user-gesture policy

- Production and staging use must be an approved secure context.
- Browser localhost exceptions are development behavior, not production
  authorization.
- `prepare()` and `recover()` must be invoked directly from a user gesture with
  the module already loaded.
- No dynamic import, timer, or awaited task may precede WebHID discovery.
- The native WebHID chooser cannot be programmatically aborted. Cancellation
  unsubscribes/marks work stale and ignores any late chooser result.
- Every acceptance row must test chooser cancellation followed by a late user
  selection or dismissal.

## Operating-system policy

No desktop operating-system combination is currently claimed.

| Operating system | Candidate status | Required evidence |
| --- | --- | --- |
| macOS | `pending` | Exact OS release, Chrome/Edge release, permissions, install paths, disconnects, close observation, and WebUSB handoff. |
| Windows | `pending` | Exact OS release, Chrome/Edge release, driver/permission behavior, install paths, disconnects, close observation, and WebUSB handoff. |
| Linux | `pending` | Exact distribution/kernel/browser, udev/permission prerequisites, install paths, disconnects, close observation, and WebUSB handoff. |
| Other desktop operating systems | `unknown` | Product, engineering, authorization, and evidence decision required before consideration. |

Evidence from one browser or operating system does not transfer to another.

## Required physical acceptance paths

Each approved model/firmware/browser/OS cell must exercise all applicable
paths. A not-applicable result requires reviewer justification.

- [ ] Environment support probe without showing a chooser.
- [ ] Synchronous chooser invocation from a direct click.
- [ ] Chooser dismissal/no device selected.
- [ ] Permission denial, where the browser distinguishes it.
- [ ] Cancellation while chooser is open and late chooser resolution.
- [ ] Locked device and subsequent fresh preparation.
- [ ] Unknown/unallowlisted model fails closed immediately after connection,
  with no genuine/list/install action.
- [ ] Allowed model proceeds to genuine device success.
- [ ] Genuine check refusal/failure and no list or later action.
- [ ] Bitcoin already installed, with no install or update action.
- [ ] Bitcoin missing, install, and fresh independent verification.
- [ ] Install confirmation refusal.
- [ ] Insufficient space and required recovery/re-list.
- [ ] Network or Ledger service interruption before mutation.
- [ ] Disconnect and timeout at each install/verification boundary.
- [ ] Recovery using a new user gesture and fresh app listing.
- [ ] Fixed open-Bitcoin success.
- [ ] Fixed open-Bitcoin refusal/failure preserving the proven disposition.
- [ ] WebHID handle observed closed and later WebUSB signing smoke test.
- [ ] Release deadline expiration/reconnect-required guidance.
- [ ] Physical unplug/replug and repeat operation.
- [ ] Sleep/wake, permission revocation, and navigation where testable.
- [ ] No raw inventory, identifier, version, error, or vendor state in public
  events/results/logs.

No test may contact Ledger services until the authorization register explicitly
allows that environment and form of testing.

## Acceptance evidence table

Create one row per exact combination. Do not put serial numbers, runtime device
IDs, session IDs, HID objects, full app inventories, raw errors, tokens, or
personal data in this table or its attachments.

| Evidence ID | Date | Model | Firmware | Browser/version | OS/version | Prepare | Missing/install/verify | Already installed/no mutation | Refusal | Disconnect/timeout/recovery | HID to WebUSB | Authorization reference | QA review | Security review | Release decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not recorded | Unassigned/pending | Unassigned/pending | Not approved |

Evidence attachments should contain the package version/tarball digest, pinned
dependency versions, mock or live mode, non-sensitive steps, expected versus
observed result, and sanitized failure classification.

## Compiled allowlist requirements

The runtime allowlist is implemented in a later phase, not in this policy-only
phase. Its implementation must:

- use a closed package-owned set of exact SDK model identifiers;
- default to empty/unsupported for unknown values;
- execute immediately after connection and before genuine check, app listing,
  or any other management action;
- be covered by an exhaustive test for every known enum member plus an unknown
  value;
- prevent remote/product configuration from widening the set;
- avoid returning model identifiers in public events, plans, results, or
  errors; and
- change only through reviewed source, acceptance evidence, authorization, and
  semver process.

The first release's actual entries remain pending. A package must not be made
public while the approved set is empty or differs from the signed evidence.

## Release sign-offs

No sign-off is currently recorded.

| Review | Assigned person | Status | Evidence/reference |
| --- | --- | --- | --- |
| Product support scope | Unassigned | `pending` | Not recorded |
| Caravan engineering | Unassigned | `pending` | Not recorded |
| Security and privacy | Unassigned | `pending` | Not recorded |
| Ledger relationship/authorization | Unassigned | `pending` | Not recorded |
| Physical-device QA | Unassigned | `pending` | Not recorded |
| Release owner | Unassigned | `pending` | Not recorded |

## Release gate

- [ ] Initial compiled allowlist entries match approved evidence exactly.
- [ ] At least one complete, authorized physical combination is approved for
  every support claim.
- [ ] Every browser and OS claim has its own current evidence.
- [ ] Firmware evidence and its runtime limitation are disclosed and accepted.
- [ ] Unknown model and explicit SDK firmware failure tests fail closed.
- [ ] Catalog-absence and unrecognized-error mappings match the pinned source.
- [ ] Resolved SDK artifacts match reviewed immutable source; any version or
  behavior mismatch has been reconciled and re-reviewed.
- [ ] Authorization, origins, endpoints, provider, versions, telemetry, and
  test permissions are approved.
- [ ] WebHID-to-WebUSB evidence includes both ready and reconnect-required paths.
- [ ] The exact canary artifact passes consumer, security, and physical review.
- [ ] Every accountable human sign-off is recorded.

## Known unsupported and unclaimed behavior

- Arbitrary applications, updates, downgrades, uninstall, firmware, language
  packs, provider management, raw APDUs, and signing are outside v0.1.
- Firefox, Safari, mobile, Electron, React Native, and Node.js execution are not
  supported.
- No device, firmware, browser, or operating-system combination is approved at
  the time of this policy.
- A remote flag cannot convert a pending or unknown combination into support.
- Package import or a successful environment probe is not a support promise.

## Related documents and sources

- [Package architecture ADR](./adr/0001-ledger-bitcoin-installer-package.md)
- [Public contract v0.1](./public-contract-v0.1.md)
- [Threat model](./threat-model.md)
- [Authorization gate](./authorization-gate.md)
- [Ledger DMK legal notice and published versions](https://developers.ledger.com/docs/device-interaction/getting-started)
- [Ledger WebHID setup guidance](https://developers.ledger.com/docs/device-interaction/dmk-ts/beginner/setup)
- [Ledger discovery and connection guidance](https://developers.ledger.com/docs/device-interaction/dmk-ts/beginner/discover_and_connect)
