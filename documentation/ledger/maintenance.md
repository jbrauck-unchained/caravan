# Ledger installer maintenance, ownership, and release policy

- Applies to: `@caravan/ledger` and its WebHID-to-WebUSB handoff contract
- Current package state: `private: true`, version `0.0.0`
- Governance state: incomplete; publication and live use are blocked

This package can mutate a hardware device and depends on an externally
authorized service. Green unit tests alone are never sufficient to merge a
dependency, authority, support, privacy, or release change.

## Required accountable roles

No identity has been approved or inferred from repository history. Every row is
a hard release blocker until a named person accepts the responsibility in the
controlled project record and the enforceable review mechanism is verified.

| Role                               | Assignment                       | Required responsibility                                                                                                               |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Package maintainer                 | **UNASSIGNED — release blocker** | Own implementation correctness, contract drift, deterministic evidence, dependency review, and package incidents.                     |
| Security reviewer                  | **UNASSIGNED — release blocker** | Approve device authority, state/error semantics, privacy/redaction, dependency/artifact risk, release barrier, and incident closure.  |
| npm release owner                  | **UNASSIGNED — release blocker** | Own npm scope bootstrap, trusted publisher/OIDC binding, provenance, canary, promotion, deprecation, and release rollback.            |
| Ledger relationship/incident owner | **UNASSIGNED — release blocker** | Maintain written authorization/configuration and coordinate revocation, service, telemetry, and partner incidents.                    |
| Hardware QA owner                  | **UNASSIGNED — release blocker** | Control authorized lab devices, browser/OS matrices, evidence hygiene, physical execution, and acceptance records.                    |
| Downstream contact                 | **UNASSIGNED — release blocker** | Own consumer feature-disable, exact-version adoption, separate-click WebUSB behavior, support communication, and rollback validation. |

Product/support scope approval and a Caravan engineering reviewer are also
required by the support matrix. They may be separately assigned, but do not
replace any role above.

## Enforceable review gate

The repository currently has no reviewed CODEOWNERS assignment for this package
and this document does not claim branch protection is configured. Before a
canary:

1. maintainers must select an enforceable repository mechanism (for example,
   approved CODEOWNERS plus protected-branch required reviews);
2. the exact paths for `packages/caravan-ledger/**`, `documentation/ledger/**`,
   the wallet transport handoff, release workflows, Changesets configuration,
   lockfile, and dependency overrides must be covered;
3. package-maintainer and security approvals must be independently required for
   the security-review surfaces below;
4. the npm release owner must be required for publication/bootstrap changes;
5. bypass permissions and emergency procedure must be documented and tested;
   and
6. evidence that the repository settings enforce the rule must be linked from
   [private readiness](./private-readiness.md).

Until that mechanism is verified, no role table entry or pull-request review is
sufficient to authorize release.

## Changes that require security review

Security approval and updated deterministic/physical evidence are mandatory for
any change to:

- the fixed app authority or exact `Bitcoin` name;
- public methods, types, lifecycle states, interactions, errors, result fields,
  or consumer handoff semantics;
- plan identity, expiry, generation binding, single-use consumption, mutation
  boundary, verification, cancellation, recovery, concurrency, or runtime lease;
- model allowlist or any device/firmware/browser/OS support claim;
- genuine check, SDK action, progress/terminal mapping, error normalization, or
  state-unknown precedence;
- cleanup ordering, disconnect watchdog, HID candidate selection, release
  barrier timing/evidence, or WebUSB separation;
- SDK/runtime dependency pin, transitive dependency, lockfile resolution,
  bundling/externalization, source provenance, license, or telemetry behavior;
- endpoint, provider, origin, CSP, authentication, network destination, Ledger
  authorization, traffic policy, or browser-secret assumption;
- logging, analytics, Sentry/error capture, redaction, data retention, public
  declarations, package files, source maps, or artifact contents; or
- package version/private status, Changesets policy, npm access, OIDC workflow,
  provenance/SBOM generation, canary, promotion, deprecation, or rollback.

An apparently compatible refactor is not exempt when it touches these
invariants. A bug fix may tighten fail-closed behavior without expanding public
authority, but still needs the reviewers and affected regression evidence.

## Exact SDK upgrade policy

Ledger and RxJS runtime dependencies remain exact pins. Automated dependency
bots may open an informational proposal, but must never auto-merge an SDK or
WebHID upgrade solely because generic unit tests pass.

For every proposed pin or resolved-artifact change:

1. freeze the current release candidate and open a dedicated reviewed change;
2. record the exact old/new package versions, integrity, immutable source
   revision/archive, license, changelog, build provenance, and transitive graph;
3. diff reviewed source for constructors/defaults, model identifiers, actions,
   action inputs, interactions, progress/terminal events, errors, cancellation,
   disconnect/close behavior, network destinations, provider/authentication,
   logging, Sentry/error capture, and side effects;
4. reconcile the resolved npm artifact and packed consumer bundle against that
   immutable source; a matching version string is insufficient;
5. update the public contract, threat model, support matrix, authorization
   register, network/CSP documentation, and tests for every behavior change;
6. rerun lint, typecheck, unit/named scenarios, bounded model suite, leak/fault
   suite, packed API/artifact negative checks, clean TypeScript 4.6/Webpack 5.64
   consumers, wallet/coordinator regressions, root CI, and coverage gates;
7. run the immutable offline real-SDK/mock contract in mandatory no-skip release
   mode and record source/image digests;
8. repeat the real-browser native UI, network, console, and privacy canary audit;
9. have the Ledger relationship owner confirm that the exact versions,
   destinations, actions, and telemetry remain authorized; and
10. execute the security-approved physical regression subset for every support
    claim affected by the change.

Any unknown mapping, source/artifact mismatch, unexpected network/capture path,
coverage regression, test skip, physical failure, or expired authorization
blocks the upgrade. Never preserve a claim by loosening a test or silently
mapping a new vendor state to an existing success.

## Routine maintenance evidence

For each candidate commit, the package maintainer records:

- commit and clean-tree status;
- Node/npm versions and CI runner identity;
- package/lock dependency pins and integrity;
- deterministic suite, coverage, packed tarball, public declaration/export,
  consumer bundle/module/size, and forbidden-surface results;
- offline SDK/mock provenance and no-network result;
- browser binary/image, native chooser/gesture, console/network/privacy result;
- wallet, coordinator, and root regression result;
- authorization/support evidence expiry; and
- named approvals with links to controlled records.

Local success is useful engineering evidence but is not immutable CI or release
evidence. Failed, skipped, unavailable, or unowned checks remain blockers and
must be recorded explicitly in [private readiness](./private-readiness.md).

## Incident classification and response

| Incident                                                                | Immediate response                                                                                                                  | Required owner path before resuming                                                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Ledger authorization expires, is rejected, or is revoked                | Prevent new consumer sessions; allow only minimum safe cleanup; stop live/backend/physical tests and publication.                   | Ledger relationship/incident owner, security reviewer, downstream contact, and release owner reconcile new written evidence. |
| Ledger backend/service or configuration incident                        | Pause new sessions, preserve state-unknown precedence, do not redirect endpoints/providers, and communicate approved user guidance. | Relationship/incident owner verifies service/configuration and security approves resumption.                                 |
| Malicious, compromised, vulnerable, or provenance-mismatched dependency | Disable downstream entry, quarantine the artifact, stop installs/releases, preserve evidence without executing unknown code.        | Package maintainer and security reviewer complete source/artifact/SBOM analysis and a clean replacement review.              |
| Privacy/Sentry capture or unexpected network destination                | Stop affected execution and data collection; preserve only sanitized evidence; follow notification/retention obligations.           | Security/privacy and Ledger relationship owners approve mitigation or explicit acceptance; functional tests cannot waive it. |
| Broken package release or lifecycle/cleanup defect                      | Disable the consumer feature, stop promotion, classify active ambiguous mutations as unknown, and prepare a reviewed patch.         | Package maintainer, security reviewer, npm release owner, and downstream contact validate patch/deprecation/communication.   |
| WebHID/WebUSB overlap or false-ready result                             | Disable the flow immediately and stop physical testing. Do not increase timeouts or force-close devices as mitigation.              | Security and hardware QA require corrected deterministic, browser, and physical handoff evidence.                            |
| Device prompt/authority mismatch                                        | Stop the session and advise no approval. Treat as a security incident; do not attempt another app/action.                           | Package maintainer, security reviewer, and Ledger relationship owner reconcile source, artifact, and authorization.          |

All incidents must record detection time, affected versions/environments,
public normalized state, exposure assessment, containment, owner decisions,
consumer communication, and evidence required to resume. Do not place secrets,
device identifiers, raw payloads, vendor errors, or personal details in the
public repository.

## Rollback and disable policy

npm publication is effectively immutable; rollback must not depend on
unpublishing a version. A future approved plan must combine:

1. consumer feature disable to prevent new installer sessions;
2. safe completion/cleanup guidance for work already in progress;
3. npm deprecation of the affected version with approved non-sensitive copy;
4. a reviewed patched version when code remediation is required;
5. exact downstream pin/update and verification;
6. support/security/Ledger notifications under the incident policy; and
7. refreshed deterministic, browser, physical, authorization, and canary
   evidence before re-enablement.

A future downstream feature flag may only narrow or disable access. It is not a
Caravan runtime kill switch and cannot enable a model, origin, action, endpoint,
provider, or package version not already compiled and approved.

## npm, Changesets, OIDC, canary, and promotion

The repository's current Changesets default is restricted access. The existing
release workflow requests an OIDC identity token, but the official npm package,
trusted-publisher binding, environment protection, ownership, and new-package
bootstrap have not been verified. There is no reviewed npm-token fallback.

While readiness is incomplete:

- keep `@caravan/ledger` at `0.0.0` with `private: true`;
- do not add a publishable Changeset, `publishConfig`, npm token, or release
  workaround;
- do not infer package ownership from organization/repository access; and
- do not test publication against the public registry.

At the controlled canary gate, the named npm release owner must:

1. verify the official repository, exact release workflow path/ref, protected
   GitHub environment, npm scope/package ownership, trusted publisher, and
   least-privilege OIDC settings;
2. prove no token fallback exists in workflow, environment, or maintainer
   instructions;
3. configure public access explicitly for the new public package because the
   repository default is restricted;
4. generate and review provenance, SBOM, license obligations, tarball contents,
   declarations/exports, dependency graph, and integrity digest;
5. publish only the exact approved canary artifact;
6. install that canary by exact version in clean supported consumers and repeat
   the required browser/physical/privacy checks; and
7. obtain named promotion approval or deprecate the canary.

Only the later controlled canary slice may change private/version/publication
metadata. This policy deliberately does not make the current package
publishable.
