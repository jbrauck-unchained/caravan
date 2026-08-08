import { PlanStore, type PlanContext } from "./planStore";

describe("PlanStore", () => {
  const context: PlanContext = {
    instanceGeneration: 2,
    sessionGeneration: 7,
  };
  let now: number;
  let store: PlanStore;

  beforeEach(() => {
    now = 1_000;
    store = new PlanStore({ now: () => now });
  });

  it("mints a frozen, non-serializable-by-structure plan with safe JSON", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.keys(plan)).toEqual(["status"]);
    expect(Reflect.ownKeys(plan)).toEqual(["status"]);
    expect(JSON.stringify(plan)).toBe('{"status":"installation-required"}');
    expect(store.check(plan, context)).toEqual({
      valid: true,
      status: "installation-required",
    });
    expect(store.check({ status: "installation-required" }, context)).toEqual({
      valid: false,
      reason: "unknown-plan",
    });
  });

  it("binds exact object identity to instance and session generations", () => {
    const plan = store.mint({
      ...context,
      status: "already-installed",
      ttlMs: 100,
    });

    expect(store.check(plan, { ...context, instanceGeneration: 3 })).toEqual({
      valid: false,
      reason: "instance-generation-mismatch",
    });
    expect(store.check(plan, { ...context, sessionGeneration: 8 })).toEqual({
      valid: false,
      reason: "session-generation-mismatch",
    });
    expect(store.check(plan, context, "installation-required")).toEqual({
      valid: false,
      reason: "status-mismatch",
    });
  });

  it("expires at the exact deadline", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    now = 1_099;
    expect(store.check(plan, context).valid).toBe(true);

    now = 1_100;
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "expired",
    });
  });

  it("consumes atomically and rejects reuse", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });

    expect(store.consume(plan, context)).toEqual({
      valid: true,
      status: "installation-required",
    });
    expect(store.consume(plan, context)).toEqual({
      valid: false,
      reason: "consumed",
    });
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 0,
      consumed: 1,
      invalidated: 0,
    });
  });

  it("invalidates by identity, generation, all plans, and replacement", () => {
    const replaced = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    const active = store.mint({
      ...context,
      status: "already-installed",
      ttlMs: 100,
    });
    expect(store.check(replaced, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });

    store.invalidateContext(context);
    expect(store.check(active, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });

    const finalPlan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    store.invalidate(finalPlan);
    store.invalidateAll();
    expect(store.check(finalPlan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
  });

  it("rejects unsafe generation and expiry inputs", () => {
    expect(() =>
      store.mint({
        instanceGeneration: -1,
        sessionGeneration: 0,
        status: "installation-required",
        ttlMs: 100,
      }),
    ).toThrow("Plan generations must be non-negative integers.");
    expect(() =>
      store.mint({
        ...context,
        status: "installation-required",
        ttlMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow("Plan expiry must be a positive finite duration.");
    expect(() =>
      store.mint({
        ...context,
        status: "unreviewed-app" as never,
        ttlMs: 100,
      }),
    ).toThrow("Plan status is not recognized.");
  });

  it("fails closed when the injected clock rolls back or cannot bound expiry", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });

    now = 999;
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "expired",
    });

    now = Number.MAX_VALUE;
    expect(() =>
      store.mint({
        ...context,
        status: "installation-required",
        ttlMs: Number.MAX_VALUE,
      }),
    ).toThrow("Plan clock must produce a finite expiry.");
  });
});
