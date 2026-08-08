import { BitcoinInstallerError } from "../errors";

import {
  consumeInstallPlan,
  type MintPlanInput,
  PlanStore,
  type PlanContext,
  readInstallPlanRejectionDiagnostic,
} from "./planStore";

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

  it("poisons a consumption when its hostile clock reenters", () => {
    let clockReads = 0;
    const planHolder: { current?: ReturnType<PlanStore["mint"]> } = {};
    let reentrantResult: ReturnType<PlanStore["consume"]> | undefined;
    store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (clockReads === 2) {
          reentrantResult = store.consume(planHolder.current, context);
        }
        return now;
      },
    });
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    planHolder.current = plan;

    expect(store.consume(plan, context)).toEqual({
      valid: false,
      reason: "consumption-in-progress",
    });
    expect(reentrantResult).toEqual({
      valid: false,
      reason: "consumption-in-progress",
    });
    expect(store.consume(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 0,
      consumed: 0,
      invalidated: 1,
    });
  });

  it("poisons a reserved consumption when its clock invalidates it", () => {
    let clockReads = 0;
    const planHolder: { current?: ReturnType<PlanStore["mint"]> } = {};
    store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (clockReads === 2) store.invalidate(planHolder.current);
        return now;
      },
    });
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    planHolder.current = plan;

    expect(store.consume(plan, context)).toEqual({
      valid: false,
      reason: "consumption-in-progress",
    });
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 0,
      consumed: 0,
      invalidated: 1,
    });
  });

  it("reports the terminal state created by a reentrant check clock", () => {
    let clockReads = 0;
    const planHolder: { current?: ReturnType<PlanStore["mint"]> } = {};
    store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (clockReads === 2) store.invalidate(planHolder.current);
        return now;
      },
    });
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    planHolder.current = plan;

    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 0,
      consumed: 0,
      invalidated: 1,
    });
  });

  it("invalidates a checked plan when its clock throws", () => {
    let clockReads = 0;
    store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (clockReads === 2) throw new Error("private-check-clock-canary");
        return now;
      },
    });
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });

    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "clock-error",
    });
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
  });

  it("exposes consuming and expired states without restoring authority", () => {
    let clockReads = 0;
    const planHolder: { current?: ReturnType<PlanStore["mint"]> } = {};
    let reentrantCheck: ReturnType<PlanStore["check"]> | undefined;
    store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (clockReads === 2) {
          reentrantCheck = store.check(planHolder.current, context);
        }
        return now;
      },
    });
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    planHolder.current = plan;

    expect(store.consume(plan, context)).toEqual({
      valid: true,
      status: "installation-required",
    });
    expect(reentrantCheck).toEqual({
      valid: false,
      reason: "consumption-in-progress",
    });

    const expiring = store.mint({
      ...context,
      status: "already-installed",
      ttlMs: 100,
    });
    now = 1_100;
    expect(store.check(expiring, context)).toEqual({
      valid: false,
      reason: "expired",
    });
    expect(store.check(expiring, context)).toEqual({
      valid: false,
      reason: "expired",
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

  it("leaves nonmatching generations active during scoped invalidation", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });

    store.invalidateContext({
      instanceGeneration: context.instanceGeneration + 1,
      sessionGeneration: context.sessionGeneration,
    });

    expect(store.check(plan, context)).toEqual({
      valid: true,
      status: "installation-required",
    });
  });

  it("poisons outer scoped invalidation before a reentrant context can survive", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    let reentered = false;
    const proxyContext = new Proxy(context, {
      getOwnPropertyDescriptor: (target, key) => {
        if (!reentered) {
          reentered = true;
          store.invalidateContext(context);
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    store.invalidateContext(proxyContext);

    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
    expect(store.snapshot().invalidated).toBe(1);
  });

  it("snapshots every mint field exactly once through own-data descriptors", () => {
    const reads = new Map<PropertyKey, number>();
    const input = new Proxy(
      {
        ...context,
        status: "installation-required" as const,
        ttlMs: 100,
      },
      {
        getOwnPropertyDescriptor: (target, key) => {
          reads.set(key, (reads.get(key) ?? 0) + 1);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );

    const plan = store.mint(input);

    expect(plan.status).toBe("installation-required");
    expect(Object.fromEntries(reads)).toEqual({
      instanceGeneration: 1,
      sessionGeneration: 1,
      status: 1,
      ttlMs: 1,
    });
    expect(store.snapshot().active).toBe(1);
  });

  it("revokes old authority before a replacement input Proxy can reenter", () => {
    const oldPlan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    let reentrantResult: ReturnType<PlanStore["consume"]> | undefined;
    const replacement = new Proxy(
      {
        ...context,
        status: "already-installed" as const,
        ttlMs: 100,
      },
      {
        getOwnPropertyDescriptor: (target, key) => {
          if (key === "instanceGeneration") {
            reentrantResult = store.consume(oldPlan, context);
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );

    expect(() => store.mint(replacement)).toThrow(
      "Plan store authority operation was reentered.",
    );
    expect(reentrantResult).toEqual({
      valid: false,
      reason: "consumption-in-progress",
    });
    expect(store.check(oldPlan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 0,
      consumed: 0,
      invalidated: 1,
    });
  });

  it("rejects a directly reentrant mint and poisons the outer operation", () => {
    let reentrantError: unknown;
    let reentered = false;
    const input = new Proxy(
      {
        ...context,
        status: "installation-required" as const,
        ttlMs: 100,
      },
      {
        getOwnPropertyDescriptor: (target, key) => {
          if (!reentered) {
            reentered = true;
            try {
              store.mint({
                ...context,
                status: "already-installed",
                ttlMs: 100,
              });
            } catch (error) {
              reentrantError = error;
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      },
    );

    expect(() => store.mint(input)).toThrow(
      "Plan store authority operation was reentered.",
    );
    expect(reentrantError).toBeInstanceOf(TypeError);
    expect(store.snapshot().active).toBe(0);
  });

  it("revokes old authority before a replacement clock can reenter", () => {
    let clockReads = 0;
    const oldPlanHolder: { current?: ReturnType<PlanStore["mint"]> } = {};
    let reentrantResult: ReturnType<PlanStore["consume"]> | undefined;
    store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (clockReads === 2) {
          reentrantResult = store.consume(oldPlanHolder.current, context);
        }
        return now;
      },
    });
    const oldPlan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    oldPlanHolder.current = oldPlan;

    expect(() =>
      store.mint({
        ...context,
        status: "already-installed",
        ttlMs: 100,
      }),
    ).toThrow("Plan store authority operation was reentered.");
    expect(reentrantResult).toEqual({
      valid: false,
      reason: "consumption-in-progress",
    });
    expect(store.check(oldPlan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 0,
      consumed: 0,
      invalidated: 1,
    });
  });

  it.each(["invalidateAll", "invalidate", "invalidateContext"] as const)(
    "poisons replacement mint when its clock calls %s",
    (revocation) => {
      let clockReads = 0;
      let accessorCalls = 0;
      const oldPlanHolder: { current?: ReturnType<PlanStore["mint"]> } = {};
      const hostileContext = Object.defineProperties(
        {},
        {
          instanceGeneration: {
            get: () => {
              accessorCalls += 1;
              return context.instanceGeneration;
            },
          },
          sessionGeneration: {
            get: () => {
              accessorCalls += 1;
              return context.sessionGeneration;
            },
          },
        },
      ) as PlanContext;
      store = new PlanStore({
        now: () => {
          clockReads += 1;
          if (clockReads === 2) {
            switch (revocation) {
              case "invalidateAll":
                store.invalidateAll();
                break;
              case "invalidate":
                store.invalidate(oldPlanHolder.current);
                break;
              case "invalidateContext":
                store.invalidateContext(hostileContext);
                break;
            }
          }
          return now;
        },
      });
      const oldPlan = store.mint({
        ...context,
        status: "installation-required",
        ttlMs: 100,
      });
      oldPlanHolder.current = oldPlan;

      expect(() =>
        store.mint({
          ...context,
          status: "already-installed",
          ttlMs: 100,
        }),
      ).toThrow("Plan store authority operation was reentered.");
      expect(accessorCalls).toBe(0);
      expect(store.check(oldPlan, context)).toEqual({
        valid: false,
        reason: "invalidated",
      });
      expect(store.snapshot()).toEqual({
        active: 0,
        expired: 0,
        consumed: 0,
        invalidated: 1,
      });
    },
  );

  it.each(["invalidateAll", "invalidate", "invalidateContext"] as const)(
    "poisons consumption when its context Proxy calls %s",
    (revocation) => {
      const plan = store.mint({
        ...context,
        status: "installation-required",
        ttlMs: 100,
      });
      let accessorCalls = 0;
      const hostileContext = Object.defineProperties(
        {},
        {
          instanceGeneration: {
            get: () => {
              accessorCalls += 1;
              return context.instanceGeneration;
            },
          },
          sessionGeneration: {
            get: () => {
              accessorCalls += 1;
              return context.sessionGeneration;
            },
          },
        },
      ) as PlanContext;
      const proxyContext = new Proxy(context, {
        getOwnPropertyDescriptor: (target, key) => {
          if (key === "instanceGeneration") {
            switch (revocation) {
              case "invalidateAll":
                store.invalidateAll();
                break;
              case "invalidate":
                store.invalidate(plan);
                break;
              case "invalidateContext":
                store.invalidateContext(hostileContext);
                break;
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });

      expect(store.consume(plan, proxyContext)).toEqual({
        valid: false,
        reason: "consumption-in-progress",
      });
      expect(accessorCalls).toBe(0);
      expect(store.check(plan, context)).toEqual({
        valid: false,
        reason: "invalidated",
      });
      expect(store.snapshot()).toEqual({
        active: 0,
        expired: 0,
        consumed: 0,
        invalidated: 1,
      });
    },
  );

  it("rejects mint accessors and inherited fields without invoking them", () => {
    const oldPlan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    let getterCalls = 0;
    const accessorInput = Object.defineProperties(
      {
        ...context,
      },
      {
        status: {
          get: () => {
            getterCalls += 1;
            return "already-installed";
          },
        },
        ttlMs: {
          get: () => {
            getterCalls += 1;
            return 100;
          },
        },
      },
    ) as MintPlanInput;

    expect(() => store.mint(accessorInput)).toThrow(
      "Plan status is not recognized.",
    );
    expect(getterCalls).toBe(0);
    expect(store.check(oldPlan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });

    const replacement = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    const inheritedInput = Object.assign(
      Object.create({
        status: "already-installed",
        ttlMs: 100,
      }) as object,
      context,
    ) as MintPlanInput;
    expect(() => store.mint(inheritedInput)).toThrow(
      "Plan status is not recognized.",
    );
    expect(store.check(replacement, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });

    const contextReplacement = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    const contextAccessorInput = Object.defineProperties(
      {
        status: "already-installed",
        ttlMs: 100,
      },
      {
        instanceGeneration: {
          get: () => {
            getterCalls += 1;
            return context.instanceGeneration;
          },
        },
        sessionGeneration: {
          get: () => {
            getterCalls += 1;
            return context.sessionGeneration;
          },
        },
      },
    ) as MintPlanInput;
    expect(() => store.mint(contextAccessorInput)).toThrow(
      "Plan generations must be non-negative integers.",
    );
    expect(getterCalls).toBe(0);
    expect(store.check(contextReplacement, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
    expect(store.snapshot().active).toBe(0);
  });

  it("poisons both consume paths when a context Proxy reenters", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    let reentrantResult: ReturnType<PlanStore["consume"]> | undefined;
    const proxyContext = new Proxy(context, {
      getOwnPropertyDescriptor: (target, key) => {
        if (key === "instanceGeneration") {
          reentrantResult = store.consume(plan, context);
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    expect(store.consume(plan, proxyContext)).toEqual({
      valid: false,
      reason: "consumption-in-progress",
    });
    expect(reentrantResult).toEqual({
      valid: false,
      reason: "consumption-in-progress",
    });
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 0,
      consumed: 0,
      invalidated: 1,
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

  it("rejects malformed consume context and revokes the reserved authority", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });

    expect(() =>
      store.consume(plan, {
        instanceGeneration: -1,
        sessionGeneration: context.sessionGeneration,
      }),
    ).toThrow("Plan generations must be non-negative integers.");
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });

    const checkOnlyPlan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    expect(() =>
      store.check(checkOnlyPlan, {
        instanceGeneration: context.instanceGeneration,
        sessionGeneration: Number.NaN,
      }),
    ).toThrow("Plan generations must be non-negative integers.");
    expect(store.check(checkOnlyPlan, context).valid).toBe(true);
  });

  it("does not invoke reentrant context getters or consume their plan", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    let getterCalls = 0;
    const hostileContext = Object.defineProperties(
      {},
      {
        instanceGeneration: {
          enumerable: true,
          get: () => {
            getterCalls += 1;
            return context.instanceGeneration;
          },
        },
        sessionGeneration: {
          enumerable: true,
          get: () => context.sessionGeneration,
        },
      },
    ) as PlanContext;

    expect(() => store.consume(plan, hostileContext)).toThrow(
      "Plan generations must be non-negative integers.",
    );
    expect(getterCalls).toBe(0);
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
  });

  it("does not invoke hostile context access and revokes its reservation", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    const hostileContext = Object.defineProperty({}, "instanceGeneration", {
      get: () => {
        throw new Error("private-context-canary");
      },
    }) as PlanContext;

    expect(() => store.consume(plan, hostileContext)).toThrow(
      "Plan generations must be non-negative integers.",
    );
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
  });

  it("contains a context Proxy that rejects descriptor inspection", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    const hostileContext = new Proxy(context, {
      getOwnPropertyDescriptor: () => {
        throw new Error("private-context-descriptor-canary");
      },
    });

    expect(() => store.consume(plan, hostileContext)).toThrow(
      "Plan generations must be non-negative integers.",
    );
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
  });

  it("rejects callable and primitive candidates without invoking them", () => {
    const callable = vi.fn();

    expect(store.check(callable, context)).toEqual({
      valid: false,
      reason: "unknown-plan",
    });
    expect(store.consume(42, context)).toEqual({
      valid: false,
      reason: "unknown-plan",
    });
    expect(callable).not.toHaveBeenCalled();
  });

  it("rejects primitive contexts before consulting candidate authority", () => {
    const candidate = vi.fn();

    expect(() => store.check(candidate, 42 as never)).toThrow(
      "Plan generations must be non-negative integers.",
    );
    expect(candidate).not.toHaveBeenCalled();
  });

  it("binds consumption to the stored status before reading context or time", () => {
    let clockReads = 0;
    let clockAccessAllowed = true;
    store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (!clockAccessAllowed) {
          throw new Error("private-status-clock-canary");
        }
        return now;
      },
    });
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    const contextInspection = vi.fn(() => {
      throw new Error("private-status-context-canary");
    });
    const hostileContext = new Proxy(context, {
      getOwnPropertyDescriptor: contextInspection,
    });
    clockAccessAllowed = false;

    expect(store.consume(plan, hostileContext, "already-installed")).toEqual({
      valid: false,
      reason: "status-mismatch",
    });
    expect(contextInspection).not.toHaveBeenCalled();
    expect(clockReads).toBe(1);

    clockAccessAllowed = true;
    expect(store.check(plan, context)).toEqual({
      valid: true,
      status: "installation-required",
    });
  });

  it("rejects inherited consume context and revokes its reservation", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    const inheritedContext = Object.create(context) as PlanContext;

    expect(() => store.consume(plan, inheritedContext)).toThrow(
      "Plan generations must be non-negative integers.",
    );
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
  });

  it("does not invoke invalidation-context accessors and revokes authority", () => {
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    let getterCalls = 0;
    const accessorContext = Object.defineProperties(
      {},
      {
        instanceGeneration: {
          get: () => {
            getterCalls += 1;
            return context.instanceGeneration;
          },
        },
        sessionGeneration: {
          get: () => {
            getterCalls += 1;
            return context.sessionGeneration;
          },
        },
      },
    ) as PlanContext;

    expect(() => store.invalidateContext(accessorContext)).toThrow(
      "Plan generations must be non-negative integers.",
    );
    expect(getterCalls).toBe(0);
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
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

  it("rejects a throwing replacement clock after revoking active authority", () => {
    let clockReads = 0;
    store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (clockReads === 2) throw new Error("private-mint-clock-canary");
        return now;
      },
    });
    const replaced = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });

    expect(() =>
      store.mint({
        ...context,
        status: "already-installed",
        ttlMs: 100,
      }),
    ).toThrow("Plan clock must produce a finite expiry.");
    expect(store.check(replaced, context)).toEqual({
      valid: false,
      reason: "invalidated",
    });
  });
});

describe("consumeInstallPlan", () => {
  const context: PlanContext = {
    instanceGeneration: 2,
    sessionGeneration: 7,
  };

  function setup(now = 1_000): {
    readonly store: PlanStore;
    readonly plan: ReturnType<PlanStore["mint"]>;
  } {
    const store = new PlanStore({ now: () => now });
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    return { store, plan };
  }

  it("returns only the stored status and consumes before returning", () => {
    const { store, plan } = setup();

    expect(consumeInstallPlan(store, plan, context)).toBe(
      "installation-required",
    );
    expect(store.check(plan, context)).toEqual({
      valid: false,
      reason: "consumed",
    });
  });

  it.each([
    "copied",
    "foreign-store",
    "wrong-instance",
    "wrong-session",
    "invalid-context",
    "expired",
    "invalidated",
    "replayed",
  ] as const)(
    "rejects %s authority with one generic error before later code can mutate",
    (scenario) => {
      let now = 1_000;
      const store = new PlanStore({ now: () => now });
      const plan = store.mint({
        ...context,
        status: "installation-required",
        ttlMs: 100,
      });
      let candidate: unknown = plan;
      let suppliedContext = context;

      switch (scenario) {
        case "copied":
          candidate = JSON.parse(JSON.stringify(plan));
          break;
        case "foreign-store": {
          const foreignStore = new PlanStore({ now: () => now });
          candidate = foreignStore.mint({
            ...context,
            status: "installation-required",
            ttlMs: 100,
          });
          break;
        }
        case "wrong-instance":
          suppliedContext = { ...context, instanceGeneration: 3 };
          break;
        case "wrong-session":
          suppliedContext = { ...context, sessionGeneration: 8 };
          break;
        case "invalid-context":
          suppliedContext = {
            ...context,
            sessionGeneration: Number.NaN,
          };
          break;
        case "expired":
          now = 1_100;
          break;
        case "invalidated":
          store.invalidate(plan);
          break;
        case "replayed":
          expect(consumeInstallPlan(store, plan, context)).toBe(
            "installation-required",
          );
          break;
      }

      let mutationAttempts = 0;
      let thrown: unknown;
      try {
        consumeInstallPlan(store, candidate, suppliedContext);
        mutationAttempts += 1;
      } catch (error) {
        thrown = error;
      }

      expect(mutationAttempts).toBe(0);
      expect(thrown).toBeInstanceOf(BitcoinInstallerError);
      expect(thrown).toMatchObject({
        code: "internal",
        phase: "ready-to-install",
        recoverable: false,
        message: "The operation could not be completed.",
      });
      expect(JSON.stringify(thrown)).not.toMatch(
        /copied|foreign|instance|session|expired|invalidated|replayed|nonce/i,
      );
      expect(store.snapshot().active).toBe(0);
      expect(readInstallPlanRejectionDiagnostic(thrown)).toBeDefined();
    },
  );

  it("fails both paths closed when the generic boundary itself is reentered", () => {
    let clockReads = 0;
    const planHolder: { current?: ReturnType<PlanStore["mint"]> } = {};
    let reentrantError: unknown;
    const store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (clockReads === 2) {
          try {
            consumeInstallPlan(store, planHolder.current, context);
          } catch (error) {
            reentrantError = error;
          }
        }
        return 1_000;
      },
    });
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });
    planHolder.current = plan;

    expect(() => consumeInstallPlan(store, plan, context)).toThrowError(
      BitcoinInstallerError,
    );
    expect(reentrantError).toMatchObject({ code: "internal" });
    expect(store.snapshot()).toEqual({
      active: 0,
      expired: 0,
      consumed: 0,
      invalidated: 1,
    });
  });

  it("converts a hostile clock failure to a generic error without authority", () => {
    let clockReads = 0;
    const store = new PlanStore({
      now: () => {
        clockReads += 1;
        if (clockReads > 1) throw new Error("private-clock-canary");
        return 1_000;
      },
    });
    const plan = store.mint({
      ...context,
      status: "installation-required",
      ttlMs: 100,
    });

    let thrown: unknown;
    try {
      consumeInstallPlan(store, plan, context);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: "internal",
      message: "The operation could not be completed.",
    });
    expect(JSON.stringify(thrown)).not.toContain("private-clock-canary");
    expect(readInstallPlanRejectionDiagnostic(thrown)).toBe("clock-error");
  });

  it("does not disclose diagnostics for unrelated errors", () => {
    expect(readInstallPlanRejectionDiagnostic(new Error("unrelated"))).toBe(
      undefined,
    );
  });
});
