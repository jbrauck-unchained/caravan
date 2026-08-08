import { BitcoinInstallerError } from "../errors";
import type { BitcoinInstallPlan } from "../types";

import type { Clock } from "./clock";

export type PlanStatus = BitcoinInstallPlan["status"];

export interface PlanContext {
  readonly instanceGeneration: number;
  readonly sessionGeneration: number;
}

export interface MintPlanInput extends PlanContext {
  readonly status: PlanStatus;
  readonly ttlMs: number;
}

export type PlanRejectionReason =
  | "unknown-plan"
  | "nonce-mismatch"
  | "instance-generation-mismatch"
  | "session-generation-mismatch"
  | "status-mismatch"
  | "expired"
  | "consumption-in-progress"
  | "clock-error"
  | "consumed"
  | "invalidated";

export type PlanCheck =
  | { readonly valid: true; readonly status: PlanStatus }
  | { readonly valid: false; readonly reason: PlanRejectionReason };

export interface PlanStoreSnapshot {
  readonly active: number;
  readonly expired: number;
  readonly consumed: number;
  readonly invalidated: number;
}

type PlanState =
  | "active"
  | "consuming"
  | "expired"
  | "consumed"
  | "invalidated";
type TerminalPlanState = Exclude<PlanState, "active" | "consuming">;

interface PlanRecord extends PlanContext {
  readonly plan: BitcoinInstallPlan;
  readonly nonce: object;
  readonly status: PlanStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
  state: PlanState;
}

const missingOwnData = Symbol("missing-own-plan-data");

function readOwnData(
  value: unknown,
  key: PropertyKey,
): unknown | typeof missingOwnData {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return missingOwnData;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor
      ? descriptor.value
      : missingOwnData;
  } catch {
    return missingOwnData;
  }
}

function isGeneration(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function snapshotContext(context: PlanContext): PlanContext {
  // Accessors and inherited values are rejected without invocation. A Proxy
  // can still trap descriptor inspection, so callers reserve/guard first.
  const instanceGeneration = readOwnData(context, "instanceGeneration");
  const sessionGeneration = readOwnData(context, "sessionGeneration");
  if (!isGeneration(instanceGeneration) || !isGeneration(sessionGeneration)) {
    throw new TypeError("Plan generations must be non-negative integers.");
  }
  return { instanceGeneration, sessionGeneration };
}

function isPlanStatus(value: unknown): value is PlanStatus {
  return value === "installation-required" || value === "already-installed";
}

interface MintPlanSnapshot extends PlanContext {
  readonly status: PlanStatus;
  readonly ttlMs: number;
}

function snapshotMintInput(input: MintPlanInput): MintPlanSnapshot {
  // Read every field exactly once through an own-data descriptor. Continue
  // through all fields even after one is malformed so Proxy trap behavior is
  // deterministic under the store's reentrancy guard.
  const instanceGeneration = readOwnData(input, "instanceGeneration");
  const sessionGeneration = readOwnData(input, "sessionGeneration");
  const status = readOwnData(input, "status");
  const ttlMs = readOwnData(input, "ttlMs");

  if (!isGeneration(instanceGeneration) || !isGeneration(sessionGeneration)) {
    throw new TypeError("Plan generations must be non-negative integers.");
  }
  if (!isPlanStatus(status)) {
    throw new TypeError("Plan status is not recognized.");
  }
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError("Plan expiry must be a positive finite duration.");
  }
  return { instanceGeneration, sessionGeneration, status, ttlMs };
}

const REENTRANT_PLAN_STORE_MESSAGE =
  "Plan store authority operation was reentered.";

/** Runtime authority for opaque, single-use installer plans. */
export class PlanStore {
  private readonly records = new WeakMap<object, PlanRecord>();

  private readonly nonces = new WeakMap<object, object>();

  /** Only live/reserved authority is retained strongly; terminal plans are weak. */
  private readonly liveRecords = new Set<PlanRecord>();

  private readonly terminalCounts: Record<TerminalPlanState, number> = {
    expired: 0,
    consumed: 0,
    invalidated: 0,
  };

  #authorityOperationInProgress = false;

  #authorityOperationPoisoned = false;

  constructor(private readonly clock: Pick<Clock, "now">) {}

  mint(input: MintPlanInput): BitcoinInstallPlan {
    if (!this.#beginAuthorityOperation()) {
      throw new TypeError(REENTRANT_PLAN_STORE_MESSAGE);
    }

    // Replacement revokes old authority before inspecting input descriptors
    // or the injected clock. A failed/reentrant replacement leaves no plan.
    this.#invalidateAllRecords();
    try {
      const snapshot = snapshotMintInput(input);
      if (this.#authorityOperationPoisoned) {
        throw new TypeError(REENTRANT_PLAN_STORE_MESSAGE);
      }

      let createdAt: number;
      try {
        createdAt = this.clock.now();
      } catch {
        throw new TypeError("Plan clock must produce a finite expiry.");
      }
      if (this.#authorityOperationPoisoned) {
        throw new TypeError(REENTRANT_PLAN_STORE_MESSAGE);
      }
      const expiresAt = createdAt + snapshot.ttlMs;
      if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) {
        throw new TypeError("Plan clock must produce a finite expiry.");
      }

      const nonce = Object.freeze({});
      const plan = Object.freeze({
        status: snapshot.status,
      }) as BitcoinInstallPlan;
      const record: PlanRecord = {
        plan,
        nonce,
        status: snapshot.status,
        instanceGeneration: snapshot.instanceGeneration,
        sessionGeneration: snapshot.sessionGeneration,
        createdAt,
        expiresAt,
        state: "active",
      };
      this.records.set(plan, record);
      this.nonces.set(plan, nonce);
      this.liveRecords.add(record);

      return plan;
    } finally {
      this.#finishAuthorityOperation();
    }
  }

  check(
    candidate: unknown,
    context: PlanContext,
    expectedStatus?: PlanStatus,
  ): PlanCheck {
    const checkedContext = snapshotContext(context);
    const record = this.getRecord(candidate);
    const staticCheck = this.checkStatic(
      record,
      checkedContext,
      expectedStatus,
    );
    if (!staticCheck.valid || !record) return staticCheck;

    let now: number;
    try {
      now = this.clock.now();
    } catch {
      this.transition(record, "invalidated");
      return { valid: false, reason: "clock-error" };
    }

    // `Clock` is injected. If a hostile/test clock reentered the store while
    // producing `now`, the newer terminal state wins over this stale check.
    const reentrantState = this.rejectionForState(record.state);
    if (reentrantState) return { valid: false, reason: reentrantState };
    if (
      !Number.isFinite(now) ||
      now < record.createdAt ||
      now >= record.expiresAt
    ) {
      this.transition(record, "expired");
      return { valid: false, reason: "expired" };
    }

    return { valid: true, status: record.status };
  }

  consume(
    candidate: unknown,
    context: PlanContext,
    expectedStatus?: PlanStatus,
  ): PlanCheck {
    if (!this.#beginAuthorityOperation()) {
      return { valid: false, reason: "consumption-in-progress" };
    }

    let record: PlanRecord | undefined;
    try {
      record = this.getRecord(candidate);
      const candidateCheck = this.#checkConsumableCandidate(
        record,
        expectedStatus,
      );
      if (!candidateCheck.valid || !record) return candidateCheck;

      // Reserve before context descriptor inspection or the injected clock.
      // A malformed known-plan attempt therefore cannot leave usable power.
      record.state = "consuming";

      let checkedContext: PlanContext;
      try {
        checkedContext = snapshotContext(context);
      } catch (error) {
        this.transition(record, "invalidated");
        throw error;
      }
      if (this.#authorityOperationPoisoned) {
        this.transition(record, "invalidated");
        return { valid: false, reason: "consumption-in-progress" };
      }
      if (record.instanceGeneration !== checkedContext.instanceGeneration) {
        this.transition(record, "invalidated");
        return {
          valid: false,
          reason: "instance-generation-mismatch",
        };
      }
      if (record.sessionGeneration !== checkedContext.sessionGeneration) {
        this.transition(record, "invalidated");
        return {
          valid: false,
          reason: "session-generation-mismatch",
        };
      }

      let now: number;
      try {
        now = this.clock.now();
      } catch {
        this.transition(record, "invalidated");
        return { valid: false, reason: "clock-error" };
      }

      if (this.#authorityOperationPoisoned) {
        this.transition(record, "invalidated");
        return { valid: false, reason: "consumption-in-progress" };
      }
      if (record.state !== "consuming") {
        return {
          valid: false,
          reason: this.rejectionForState(record.state) ?? "invalidated",
        };
      }
      if (
        !Number.isFinite(now) ||
        now < record.createdAt ||
        now >= record.expiresAt
      ) {
        this.transition(record, "expired");
        return { valid: false, reason: "expired" };
      }

      this.transition(record, "consumed");
      return candidateCheck;
    } catch (error) {
      if (record?.state === "consuming") {
        this.transition(record, "invalidated");
      }
      throw error;
    } finally {
      this.#finishAuthorityOperation();
    }
  }

  invalidate(candidate: unknown): void {
    if (this.#authorityOperationInProgress) {
      this.#authorityOperationPoisoned = true;
    }
    const record = this.getRecord(candidate);
    if (record?.state === "active" || record?.state === "consuming") {
      this.transition(record, "invalidated");
    }
  }

  invalidateContext(context: PlanContext): void {
    if (!this.#beginAuthorityOperation()) {
      // Do not inspect a reentrant context: even own-property descriptor
      // lookup can execute a Proxy trap. Poison/revoke the outer operation.
      this.#invalidateAllRecords();
      return;
    }

    try {
      let checkedContext: PlanContext;
      try {
        checkedContext = snapshotContext(context);
      } catch (error) {
        this.#invalidateAllRecords();
        throw error;
      }
      if (this.#authorityOperationPoisoned) {
        this.#invalidateAllRecords();
        return;
      }
      for (const record of this.liveRecords) {
        if (
          record.instanceGeneration === checkedContext.instanceGeneration &&
          record.sessionGeneration === checkedContext.sessionGeneration
        ) {
          this.transition(record, "invalidated");
        }
      }
    } finally {
      this.#finishAuthorityOperation();
    }
  }

  invalidateAll(): void {
    if (this.#authorityOperationInProgress) {
      this.#authorityOperationPoisoned = true;
    }
    this.#invalidateAllRecords();
  }

  snapshot(): PlanStoreSnapshot {
    return {
      active: Array.from(this.liveRecords).filter(
        ({ state }) => state === "active",
      ).length,
      ...this.terminalCounts,
    };
  }

  #beginAuthorityOperation(): boolean {
    if (this.#authorityOperationInProgress) {
      this.#authorityOperationPoisoned = true;
      return false;
    }
    this.#authorityOperationInProgress = true;
    this.#authorityOperationPoisoned = false;
    return true;
  }

  #finishAuthorityOperation(): void {
    if (this.#authorityOperationPoisoned) this.#invalidateAllRecords();
    this.#authorityOperationInProgress = false;
    this.#authorityOperationPoisoned = false;
  }

  #invalidateAllRecords(): void {
    for (const record of this.liveRecords) {
      this.transition(record, "invalidated");
    }
  }

  #checkConsumableCandidate(
    record: PlanRecord | undefined,
    expectedStatus?: PlanStatus,
  ): PlanCheck {
    if (!record) return { valid: false, reason: "unknown-plan" };
    if (this.nonces.get(record.plan) !== record.nonce) {
      return { valid: false, reason: "nonce-mismatch" };
    }
    const stateRejection = this.rejectionForState(record.state);
    if (stateRejection) return { valid: false, reason: stateRejection };
    if (
      record.plan.status !== record.status ||
      (expectedStatus !== undefined && expectedStatus !== record.status)
    ) {
      return { valid: false, reason: "status-mismatch" };
    }
    return { valid: true, status: record.status };
  }

  private checkStatic(
    record: PlanRecord | undefined,
    context: PlanContext,
    expectedStatus?: PlanStatus,
  ): PlanCheck {
    if (!record) return { valid: false, reason: "unknown-plan" };
    if (this.nonces.get(record.plan) !== record.nonce) {
      return { valid: false, reason: "nonce-mismatch" };
    }
    const stateRejection = this.rejectionForState(record.state);
    if (stateRejection) return { valid: false, reason: stateRejection };
    if (record.instanceGeneration !== context.instanceGeneration) {
      return { valid: false, reason: "instance-generation-mismatch" };
    }
    if (record.sessionGeneration !== context.sessionGeneration) {
      return { valid: false, reason: "session-generation-mismatch" };
    }
    if (
      record.plan.status !== record.status ||
      (expectedStatus !== undefined && expectedStatus !== record.status)
    ) {
      return { valid: false, reason: "status-mismatch" };
    }
    return { valid: true, status: record.status };
  }

  private rejectionForState(
    state: PlanState,
  ): PlanRejectionReason | undefined {
    switch (state) {
      case "active":
        return undefined;
      case "consuming":
        return "consumption-in-progress";
      case "expired":
      case "consumed":
      case "invalidated":
        return state;
    }
  }

  private getRecord(candidate: unknown): PlanRecord | undefined {
    if (
      (typeof candidate !== "object" || candidate === null) &&
      typeof candidate !== "function"
    ) {
      return undefined;
    }
    return this.records.get(candidate);
  }

  private transition(record: PlanRecord, state: TerminalPlanState): void {
    if (record.state !== "active" && record.state !== "consuming") return;
    record.state = state;
    this.liveRecords.delete(record);
    this.terminalCounts[state] += 1;
  }
}

export type InstallPlanRejectionDiagnostic =
  | PlanRejectionReason
  | "plan-store-failure";

const installPlanDiagnostics = new WeakMap<
  BitcoinInstallerError,
  InstallPlanRejectionDiagnostic
>();

/**
 * Cross the explicit install confirmation boundary synchronously.
 *
 * The stored status, never caller-visible structure, selects the later branch.
 * Every rejection is the same safe public `internal` error; a finite reason is
 * retained only in this private module for controlled diagnostics/tests.
 */
export function consumeInstallPlan(
  store: PlanStore,
  candidate: unknown,
  context: PlanContext,
): PlanStatus {
  let rejection: InstallPlanRejectionDiagnostic | undefined;
  try {
    const consumed = store.consume(candidate, context);
    if (consumed.valid) return consumed.status;
    rejection = consumed.reason;
  } catch {
    rejection = "plan-store-failure";
  }

  // Invalid-plan misuse revokes every remaining capability for the instance.
  // This is synchronous and runs before the caller can dispatch an action.
  store.invalidateAll();
  const error = new BitcoinInstallerError(
    "internal",
    "ready-to-install",
    false,
  );
  installPlanDiagnostics.set(error, rejection);
  throw error;
}

/** Internal-only lookup; the diagnostic is never stored on the public error. */
export function readInstallPlanRejectionDiagnostic(
  error: unknown,
): InstallPlanRejectionDiagnostic | undefined {
  return error instanceof BitcoinInstallerError
    ? installPlanDiagnostics.get(error)
    : undefined;
}
