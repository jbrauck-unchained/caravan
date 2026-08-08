# Ledger backend authorization gate

## Gate status

**Not approved for live Ledger backend use or release.**

- Overall status: `unknown`
- Last reviewed: 2026-08-07
- Written Ledger agreement: Not recorded
- Production origins: Not recorded
- Approved provider and endpoints: Not recorded
- Live or automated hardware-test permission: Not recorded
- Required human sign-offs: Pending and unassigned

This register is an evidence index, not an agreement. Do not copy contracts,
credentials, tokens, confidential correspondence, personal contact details, or
other controlled material into this repository. Record only a non-sensitive
identifier or access-controlled reference.

Ledger's published legal notice states that the open-source DMK license does
not grant access to Ledger SAS backend services and that backend access requires
explicit authorization and a formal written agreement. Mocked and offline
development may continue while this gate is pending. No live Manager API or
ScriptRunner request may be made from Caravan, a consumer application, CI, or a
test harness until every blocking item below is approved.

Allowed status values are `unknown`, `requested`, `approved`, `rejected`, and
`expired`. Only an accountable human reviewer may change a field to `approved`.

## Accountable roles

| Role | Assigned person | Status | Responsibility |
| --- | --- | --- | --- |
| Ledger relationship owner | Unassigned | `unknown` | Obtain and maintain Ledger's written authorization and partner configuration. |
| Caravan release owner | Unassigned | `unknown` | Verify the evidence packet and prevent unauthorized package publication. |
| Security reviewer | Unassigned | `unknown` | Approve authority, endpoint, privacy, telemetry, and revocation controls. |
| Incident contact | Unassigned | `unknown` | Coordinate disablement and notification for authorization or service incidents. |
| Physical-device QA owner | Unassigned | `unknown` | Control live-device execution and attach non-identifying acceptance evidence. |

Role assignment is itself a release prerequisite. A role label is not evidence
that a person has accepted the responsibility.

## Agreement evidence

| Required fact | Status | Controlled evidence reference | Recorded value or constraint |
| --- | --- | --- | --- |
| Ledger agreement identifier | `unknown` | Not recorded | Not recorded |
| Agreement effective date | `unknown` | Not recorded | Not recorded |
| Agreement expiry or renewal date | `unknown` | Not recorded | Not recorded |
| Authorizing Ledger entity/contact | `unknown` | Not recorded | Not recorded |
| Authorized Caravan/consumer entity | `unknown` | Not recorded | Not recorded |
| Approved development environments | `unknown` | Not recorded | Not recorded |
| Approved staging environments | `unknown` | Not recorded | Not recorded |
| Approved production environments | `unknown` | Not recorded | Not recorded |
| Approved production origins/domains | `unknown` | Not recorded | Not recorded |
| Approved non-production origins/domains | `unknown` | Not recorded | Not recorded |
| Approved device-management actions | `unknown` | Not recorded | Must be no broader than genuine check, list installed apps, install official Bitcoin, and open Bitcoin. |
| Approved SDK versions or version policy | `unknown` | Not recorded | Proposed runtime pins are DMK `1.7.1`, WebHID transport `1.2.4`, and RxJS `7.8.2`; this is not approval or artifact evidence. |
| Reviewed SDK source/artifact identity | `unknown` | Not recorded | Record immutable source and packed-artifact integrity; a matching version string alone is insufficient. |
| Approved Manager API base URL | `unknown` | Not recorded | Not recorded |
| Approved ScriptRunner WebSocket URL | `unknown` | Not recorded | Not recorded |
| Approved provider identifier | `unknown` | Not recorded | Not recorded |
| Authentication/token requirements | `unknown` | Not recorded | No browser secret may be embedded. A client-secret requirement blocks this architecture. |
| Traffic limits and rate policy | `unknown` | Not recorded | Not recorded |
| Branding and user-notice requirements | `unknown` | Not recorded | Not recorded |
| Support/escalation obligations | `unknown` | Not recorded | Not recorded |
| Automated backend testing permission | `unknown` | Not recorded | Not recorded |
| Live physical-device testing permission | `unknown` | Not recorded | Not recorded |
| Production monitoring requirements | `unknown` | Not recorded | Not recorded |
| Incident-notification requirements | `unknown` | Not recorded | Not recorded |
| Vendor telemetry/error-capture acceptance | `unknown` | Not recorded | Must explicitly cover packaged WebHID behavior. |
| Data-retention or privacy restrictions | `unknown` | Not recorded | Not recorded |
| Revocation and emergency-disable procedure | `unknown` | Not recorded | Not recorded |

## Observed SDK defaults are not permission

The local reviewed source baseline, whose manifest currently reports DMK
`1.7.1`, contains these defaults:

| Setting | Observed source value | Authorization status |
| --- | --- | --- |
| Manager API | `https://manager.api.live.ledger.com/api` | `unknown` |
| ScriptRunner WebSocket | `wss://scriptrunner.api.live.ledger.com/update` | `unknown` |
| Provider | `1` | `unknown` |

These values document dependency behavior only. They must not be interpreted as
Ledger approval, copied into a public configuration API, or contacted during
offline development. They also do not prove that a separately installed or
packed `1.7.1` artifact has identical behavior. Engineering must bind the
release to reviewed immutable source and verify the resolved artifact. If the
source, artifact, or Ledger-authorized version differs, affected defaults and
mappings return to `unknown` until the contract, threat model, support policy,
tests, and authorization evidence are updated and reviewed. If Ledger approves
different settings, engineering and security must review the architecture
before changing a released package.

The browser package will not expose an endpoint or provider override. Remote
product configuration may disable or narrow usage, but may not redirect Ledger
traffic or grant new device-management authority.

## Privacy and telemetry evidence

The reviewed WebHID transport source imports `@sentry/minimal` and invokes
`captureException` on selected transport failures. Caravan will not initialize
a console logger, analytics client, or error-reporting destination in
`@caravan/ledger`, but the packaged transitive behavior still requires review.

Before approval, attach evidence for all of the following without including
secrets or device identifiers in git:

- [ ] Determine whether `@sentry/minimal` sends any data without consumer
  initialization in the exact packed dependency graph.
- [ ] Inventory the data supplied to vendor capture calls.
- [ ] Confirm the behavior is allowed by the Ledger agreement and applicable
  consumer privacy policy.
- [ ] Record whether tree shaking or another supported configuration changes
  the behavior without breaking required dependency side effects.
- [ ] Confirm no Caravan logger, analytics, or additional network destination
  is initialized by the package.
- [ ] Record the security review decision and controlled evidence reference.

## Live-use release gate

Every item must be satisfied before any live backend or release-candidate
exercise. An unchecked item is blocking.

- [ ] All accountable roles are assigned and have accepted responsibility.
- [ ] A formal written agreement is effective and its controlled identifier is
  recorded.
- [ ] Allowed actions explicitly include the complete proposed flow.
- [ ] Every origin and environment that will contact Ledger is approved.
- [ ] SDK versions and all endpoint/provider values are approved.
- [ ] Resolved SDK artifacts match the reviewed immutable source and recorded
  integrity evidence; no version or behavior mismatch remains.
- [ ] The architecture does not require a browser-embedded secret. If it does,
  work is stopped and redesigned with Ledger and security.
- [ ] Automated and physical-device test permissions are recorded separately.
- [ ] Traffic, privacy, telemetry, branding, support, monitoring, and incident
  requirements are recorded and implemented.
- [ ] The compiled device-model policy is no wider than the agreement and the
  completed physical evidence in the [support matrix](./support-matrix.md).
- [ ] Security has approved the packed dependency and network-destination audit.
- [ ] The release owner has reviewed the exact package tarball and configuration.
- [ ] Product, engineering, security, QA, and release sign-offs are attached by
  accountable humans.

## Renewal, expiry, rejection, and revocation

The relationship owner must review the register before the recorded renewal or
expiry date. Any expired, rejected, or revoked authorization immediately makes
the live-use gate fail.

The response plan must identify, before release:

1. who receives the Ledger or security notice;
2. who changes the consumer feature flag to prevent new installer sessions;
3. whether a package release is also required to disable affected behavior;
4. how in-progress sessions are allowed to clean up without beginning a new
   mutation;
5. how consumers and support are notified; and
6. which evidence is required before live use can resume.

A remote feature flag may narrow or disable use. It may not enable an origin,
model, action, endpoint, provider, or environment absent from the compiled and
approved package policy.

## Change control

Changes to actions, app name, origins, endpoints, provider, authentication,
telemetry, SDK major/minor version, or data handling invalidate affected
approvals until re-reviewed. Evidence marked `expired` remains in the register
history; it must not be silently overwritten with a new approval.

## Sources

- [Ledger DMK documentation and legal notice](https://developers.ledger.com/docs/device-interaction/getting-started)
- [Ledger secure-channel actions](https://developers.ledger.com/docs/device-interaction/dmk-ts/references/device-management-kit/secure-channel)
- [Package architecture decision](./adr/0001-ledger-bitcoin-installer-package.md)
- [Threat model](./threat-model.md)
