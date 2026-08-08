# Ledger Bitcoin installer documentation

The `@caravan/ledger` workspace is private `0.0.0`, live use is unauthorized,
the production model allowlist is empty, and no physical combination is
supported. These documents describe the implementation candidate and the gates
required before that can change.

## Normative design and security

1. [Public contract v0.1](./public-contract-v0.1.md) — frozen public API,
   lifecycle, cancellation, recovery, error, privacy, and handoff semantics.
2. [Architecture decision](./adr/0001-ledger-bitcoin-installer-package.md) —
   package boundary and dependency direction.
3. [Threat model](./threat-model.md) — authority, mutation, privacy, transport,
   and release threats.
4. [Authorization gate](./authorization-gate.md) — written Ledger agreement,
   configuration, test permission, and live-use evidence register.
5. [Support and acceptance policy](./support-matrix.md) — evidence rules and
   the currently empty support matrix.

If explanatory documentation conflicts with the frozen public contract, the
contract controls and the discrepancy blocks release until reviewed.

## Integration and operations

- [Consumer integration guide](./integration-guide.md) — preload, direct-click
  preparation, explicit confirmation, result handling, separate-click WebUSB,
  cancellation, recovery, disposal, and every public phase.
- [Coordinator proof of concept](./coordinator-poc.md) — explicit local-only
  simulated acceptance mode for the fixed Bitcoin install experience.
- [Support runbook](./support-runbook.md) — every public error and safe operator
  response without state guessing, blind retries, or sensitive-data requests.
- [Physical QA runbook](./physical-qa-runbook.md) — authorization-gated browser,
  device, privacy, fault, and WebHID-to-WebUSB evidence procedure.
- [Maintenance and release policy](./maintenance.md) — required ownership,
  security review surfaces, SDK upgrades, incidents, OIDC/canary, and rollback.

## Readiness

- [Private-readiness evidence](./private-readiness.md) — verified local/static
  controls, pending deterministic jobs, and explicit external release blockers.

No checklist in this directory authorizes a live call by itself. Only named
accountable humans may approve controlled evidence in the authorization,
support, privacy, physical, and release gates. Never place credentials,
contract text, recovery material, device identifiers, raw errors, or personal
contact details in these files.
