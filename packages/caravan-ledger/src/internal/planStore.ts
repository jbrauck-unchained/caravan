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

type PlanState = "active" | "expired" | "consumed" | "invalidated";
type TerminalPlanState = Exclude<PlanState, "active">;

interface PlanRecord extends PlanContext {
  readonly plan: BitcoinInstallPlan;
  readonly nonce: object;
  readonly status: PlanStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
  state: PlanState;
}

function isGeneration(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertContext(context: PlanContext): void {
  if (
    !isGeneration(context.instanceGeneration) ||
    !isGeneration(context.sessionGeneration)
  ) {
    throw new TypeError("Plan generations must be non-negative integers.");
  }
}

function isPlanStatus(value: unknown): value is PlanStatus {
  return value === "installation-required" || value === "already-installed";
}

/** Runtime authority for opaque, single-use installer plans. */
export class PlanStore {
  private readonly records = new WeakMap<object, PlanRecord>();

  private readonly nonces = new WeakMap<object, object>();

  /** Only live authority is retained strongly; terminal plans remain weak. */
  private readonly activeRecords = new Set<PlanRecord>();

  private readonly terminalCounts: Record<TerminalPlanState, number> = {
    expired: 0,
    consumed: 0,
    invalidated: 0,
  };

  constructor(private readonly clock: Pick<Clock, "now">) {}

  mint(input: MintPlanInput): BitcoinInstallPlan {
    assertContext(input);
    if (!isPlanStatus(input.status)) {
      throw new TypeError("Plan status is not recognized.");
    }
    if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0) {
      throw new TypeError("Plan expiry must be a positive finite duration.");
    }

    const createdAt = this.clock.now();
    const expiresAt = createdAt + input.ttlMs;
    if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt)) {
      throw new TypeError("Plan clock must produce a finite expiry.");
    }

    // One installer may have at most one unconsumed plan.
    this.invalidateAll();

    const nonce = Object.freeze({});
    const plan = Object.freeze({ status: input.status }) as BitcoinInstallPlan;
    const record: PlanRecord = {
      plan,
      nonce,
      status: input.status,
      instanceGeneration: input.instanceGeneration,
      sessionGeneration: input.sessionGeneration,
      createdAt,
      expiresAt,
      state: "active",
    };
    this.records.set(plan, record);
    this.nonces.set(plan, nonce);
    this.activeRecords.add(record);

    return plan;
  }

  check(
    candidate: unknown,
    context: PlanContext,
    expectedStatus?: PlanStatus,
  ): PlanCheck {
    assertContext(context);
    const record = this.getRecord(candidate);
    if (!record) {
      return { valid: false, reason: "unknown-plan" };
    }
    if (this.nonces.get(record.plan) !== record.nonce) {
      return { valid: false, reason: "nonce-mismatch" };
    }
    if (record.state !== "active") {
      return { valid: false, reason: record.state };
    }
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
    const now = this.clock.now();
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
    const check = this.check(candidate, context, expectedStatus);
    if (!check.valid) {
      return check;
    }

    const record = this.getRecord(candidate);
    if (!record) {
      return { valid: false, reason: "unknown-plan" };
    }
    this.transition(record, "consumed");
    return check;
  }

  invalidate(candidate: unknown): void {
    const record = this.getRecord(candidate);
    if (record?.state === "active") {
      this.transition(record, "invalidated");
    }
  }

  invalidateContext(context: PlanContext): void {
    assertContext(context);
    for (const record of this.activeRecords) {
      if (
        record.instanceGeneration === context.instanceGeneration &&
        record.sessionGeneration === context.sessionGeneration
      ) {
        this.transition(record, "invalidated");
      }
    }
  }

  invalidateAll(): void {
    for (const record of this.activeRecords) {
      this.transition(record, "invalidated");
    }
  }

  snapshot(): PlanStoreSnapshot {
    return {
      active: this.activeRecords.size,
      ...this.terminalCounts,
    };
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
    if (record.state !== "active") {
      return;
    }
    record.state = state;
    this.activeRecords.delete(record);
    this.terminalCounts[state] += 1;
  }
}
