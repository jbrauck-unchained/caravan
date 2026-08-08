import type { Clock, ClockTimer } from "./clock";
import {
  createSessionFinalizer,
  type SessionFinalizer,
  type SessionFinalizerDependencies,
} from "./finalizeSession";
import { PROVISIONAL_HID_RELEASE_POLICY } from "./hidReleasePolicy";
import type {
  HidReleaseBarrier,
  HidReleaseOutcome,
} from "./waitForHidRelease";

class ManualClock implements Clock {
  readonly clearCalls: number[] = [];

  throwOnSet = false;

  throwOnClear = false;

  fireSynchronously = false;

  private nextHandle = 0;

  private readonly timers = new Map<
    number,
    { readonly callback: () => void; readonly delayMs: number }
  >();

  now(): number {
    return 0;
  }

  monotonicNow(): number {
    return 0;
  }

  setTimeout(callback: () => void, delayMs: number): ClockTimer {
    if (this.throwOnSet) throw new Error("private-clock-set-canary");
    const handle = this.nextHandle;
    this.nextHandle += 1;
    if (this.fireSynchronously) {
      callback();
    } else {
      this.timers.set(handle, { callback, delayMs });
    }
    return handle as unknown as ClockTimer;
  }

  clearTimeout(timer: ClockTimer): void {
    const handle = timer as unknown as number;
    this.clearCalls.push(handle);
    this.timers.delete(handle);
    if (this.throwOnClear) throw new Error("private-clock-clear-canary");
  }

  fireByDelay(delayMs: number): void {
    const entry = [...this.timers.entries()].find(
      ([, value]) => value.delayMs === delayMs,
    );
    if (!entry) throw new Error(`No timer has delay ${delayMs}.`);
    this.timers.delete(entry[0]);
    entry[1].callback();
  }

  count(): number {
    return this.timers.size;
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(options: {
  readonly arm?: () => Promise<void>;
  readonly disconnect?: () => Promise<void>;
  readonly outcome?: HidReleaseOutcome;
  readonly wait?: () => Promise<HidReleaseOutcome>;
} = {}): {
  readonly barrier: HidReleaseBarrier;
  readonly calls: string[];
  readonly clock: ManualClock;
  readonly dependencies: SessionFinalizerDependencies;
  readonly hooks: Readonly<Record<string, ReturnType<typeof vi.fn>>>;
} {
  const calls: string[] = [];
  const clock = new ManualClock();
  const record = (name: string): void => {
    calls.push(name);
  };
  const hooks = {
    block: vi.fn(() => record("block")),
    cancel: vi.fn(() => record("cancel")),
    unsubscribe: vi.fn(() => record("unsubscribe")),
    invalidate: vi.fn(() => record("invalidate")),
    disconnect: vi.fn(
      options.disconnect ?? (() => {
        record("disconnect");
        return Promise.resolve();
      }),
    ),
    clear: vi.fn(() => record("clear-references")),
    release: vi.fn(() => record("release-lease")),
  };
  const barrier: HidReleaseBarrier = {
    arm: vi.fn(
      options.arm ?? (() => {
        record("arm-barrier");
        return Promise.resolve();
      }),
    ),
    wait: vi.fn(
      options.wait ?? (() => {
        record("wait-barrier");
        return Promise.resolve(options.outcome ?? "released");
      }),
    ),
    cancel: vi.fn(),
  };
  const dependencies: SessionFinalizerDependencies = {
    clock,
    hidBarrier: barrier,
    blockNewWork: hooks.block,
    cancelActiveActions: hooks.cancel,
    unsubscribeLifecycle: hooks.unsubscribe,
    invalidatePlansAndSession: hooks.invalidate,
    disconnect: hooks.disconnect,
    clearPrivateReferences: hooks.clear,
    releaseLease: hooks.release,
  };
  return { barrier, calls, clock, dependencies, hooks };
}

describe("session finalizer", () => {
  it("retires resources in the reviewed order and returns only frozen handoff evidence", async () => {
    const harness = createHarness();
    const finalizer = createSessionFinalizer(harness.dependencies);

    const evidence = await finalizer.finalize();

    expect(harness.calls).toEqual([
      "block",
      "cancel",
      "unsubscribe",
      "invalidate",
      "arm-barrier",
      "disconnect",
      "wait-barrier",
      "clear-references",
      "release-lease",
    ]);
    expect(evidence).toEqual({
      hidRelease: "released",
      handoff: "ready",
    });
    expect(Object.keys(evidence).sort()).toEqual(["handoff", "hidRelease"]);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(harness.clock.count()).toBe(0);
    expect(harness.clock.clearCalls).toEqual([0]);
  });

  it("never adds own constructor or then properties to an ordinary native Promise", async () => {
    const pending = deferred<void>();
    const constructorBefore = Object.getOwnPropertyDescriptor(
      pending.promise,
      "constructor",
    );
    const thenBefore = Object.getOwnPropertyDescriptor(pending.promise, "then");
    const harness = createHarness();
    harness.dependencies.disconnect = () => pending.promise;

    const result = createSessionFinalizer(harness.dependencies).finalize();
    await flushMicrotasks();
    pending.resolve();
    await expect(result).resolves.toEqual({
      hidRelease: "released",
      handoff: "ready",
    });

    expect(constructorBefore).toBeUndefined();
    expect(thenBefore).toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(pending.promise, "constructor"),
    ).toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(pending.promise, "then"),
    ).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(pending.promise, "constructor"))
      .toBe(false);
    expect(Object.prototype.hasOwnProperty.call(pending.promise, "then")).toBe(
      false,
    );
    expect(harness.clock.count()).toBe(0);
    expect(harness.clock.clearCalls).toEqual([0]);
  });

  it("latches before hostile reentrancy and shares one promise across every caller path", async () => {
    const harness = createHarness();
    const finalizerHolder: { current?: SessionFinalizer } = {};
    const currentFinalizer = (): SessionFinalizer => {
      if (!finalizerHolder.current) throw new Error("Missing test finalizer.");
      return finalizerHolder.current;
    };
    let reentrantCancel: Promise<unknown> | undefined;
    let reentrantDispose: Promise<unknown> | undefined;
    const block = vi.fn(() => {
      harness.calls.push("block");
      reentrantCancel = currentFinalizer().finalize();
    });
    const invalidate = vi.fn(() => {
      harness.calls.push("invalidate");
      reentrantDispose = currentFinalizer().finalize();
    });
    harness.dependencies.blockNewWork = block;
    harness.dependencies.invalidatePlansAndSession = invalidate;
    const finalizer = createSessionFinalizer(harness.dependencies);
    finalizerHolder.current = finalizer;

    const first = finalizer.finalize();
    const repeatedCancel = finalizer.finalize();
    const repeatedDispose = finalizer.finalize();

    expect(reentrantCancel).toBe(first);
    expect(reentrantDispose).toBe(first);
    expect(repeatedCancel).toBe(first);
    expect(repeatedDispose).toBe(first);
    await expect(first).resolves.toMatchObject({ handoff: "ready" });
    expect(finalizer.finalize()).toBe(first);
    expect(block).toHaveBeenCalledTimes(1);
    expect(harness.hooks.cancel).toHaveBeenCalledTimes(1);
    expect(harness.hooks.unsubscribe).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(harness.hooks.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.hooks.clear).toHaveBeenCalledTimes(1);
    expect(harness.hooks.release).toHaveBeenCalledTimes(1);
    expect(harness.barrier.arm).toHaveBeenCalledTimes(1);
    expect(harness.barrier.wait).toHaveBeenCalledTimes(1);
  });

  it("arms fully before disconnect and waits for release only afterward", async () => {
    const arm = deferred<void>();
    const harness = createHarness({
      arm: () => {
        harness.calls.push("arm-barrier");
        return arm.promise;
      },
    });
    const result = createSessionFinalizer(harness.dependencies).finalize();

    await flushMicrotasks();
    expect(harness.calls).toEqual([
      "block",
      "cancel",
      "unsubscribe",
      "invalidate",
      "arm-barrier",
    ]);

    arm.resolve();
    await expect(result).resolves.toMatchObject({ handoff: "ready" });
    expect(harness.calls.slice(5)).toEqual([
      "disconnect",
      "wait-barrier",
      "clear-references",
      "release-lease",
    ]);
  });

  it("bounds a never-settling disconnect with timer handle zero without aborting it", async () => {
    const pendingDisconnect = deferred<void>();
    const harness = createHarness({
      disconnect: () => {
        harness.calls.push("disconnect");
        return pendingDisconnect.promise;
      },
    });
    const result = createSessionFinalizer(harness.dependencies).finalize();

    await flushMicrotasks();
    expect(harness.clock.count()).toBe(1);
    expect(harness.calls).not.toContain("wait-barrier");

    harness.clock.fireByDelay(
      PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
    );
    await expect(result).resolves.toEqual({
      hidRelease: "released",
      handoff: "ready",
    });
    expect(harness.hooks.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.barrier.cancel).not.toHaveBeenCalled();
    expect(harness.clock.count()).toBe(0);
  });

  it("observes a late disconnect rejection after timeout without changing settled evidence", async () => {
    const pendingDisconnect = deferred<void>();
    const rawError = new Error("private-late-disconnect-canary");
    const harness = createHarness({
      disconnect: () => {
        harness.calls.push("disconnect");
        return pendingDisconnect.promise;
      },
    });
    const result = createSessionFinalizer(harness.dependencies).finalize();
    await flushMicrotasks();
    harness.clock.fireByDelay(
      PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
    );

    const evidence = await result;
    pendingDisconnect.reject(rawError);
    await flushMicrotasks();

    expect(evidence).toEqual({ hidRelease: "released", handoff: "ready" });
    expect(JSON.stringify(evidence)).not.toContain(rawError.message);
    expect(harness.hooks.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.hooks.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "constructor",
      () => {
        const pending = deferred<void>();
        const hostileAccess = vi.fn(() => {
          throw new Error("private-promise-constructor-canary");
        });
        Object.defineProperty(pending.promise, "constructor", {
          configurable: true,
          get: hostileAccess,
        });
        return { ...pending, hostileAccess };
      },
    ],
    [
      "then handler",
      () => {
        const pending = deferred<void>();
        const hostileAccess = vi.fn(() => {
          throw new Error("private-promise-then-canary");
        });
        Object.defineProperty(pending.promise, "then", {
          configurable: true,
          get: hostileAccess,
        });
        return { ...pending, hostileAccess };
      },
    ],
  ])("intrinsically observes a late rejection despite hostile genuine Promise %s", async (_label, makePendingPromise) => {
    const pending = makePendingPromise();
    const constructorBefore = Object.getOwnPropertyDescriptor(
      pending.promise,
      "constructor",
    );
    const thenBefore = Object.getOwnPropertyDescriptor(pending.promise, "then");
    const harness = createHarness();
    let disconnectCalls = 0;
    harness.dependencies.disconnect = () => {
      disconnectCalls += 1;
      harness.calls.push("disconnect");
      return pending.promise;
    };
    const result = createSessionFinalizer(harness.dependencies).finalize();
    await flushMicrotasks();

    expect(harness.clock.count()).toBe(1);
    expect(harness.calls).not.toContain("wait-barrier");
    harness.clock.fireByDelay(
      PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
    );
    await expect(result).resolves.toEqual({
      hidRelease: "released",
      handoff: "reconnect-required",
    });

    expect(harness.calls.slice(-3)).toEqual([
      "wait-barrier",
      "clear-references",
      "release-lease",
    ]);
    expect(disconnectCalls).toBe(1);
    expect(harness.barrier.wait).toHaveBeenCalledTimes(1);
    expect(harness.hooks.clear).toHaveBeenCalledTimes(1);
    expect(harness.hooks.release).toHaveBeenCalledTimes(1);
    expect(harness.clock.count()).toBe(0);
    expect(harness.clock.clearCalls).toEqual([0]);
    expect(pending.hostileAccess).not.toHaveBeenCalled();
    expect(
      Object.getOwnPropertyDescriptor(pending.promise, "constructor"),
    ).toEqual(constructorBefore);
    expect(Object.getOwnPropertyDescriptor(pending.promise, "then")).toEqual(
      thenBefore,
    );
    expect(Object.prototype.hasOwnProperty.call(pending.promise, "constructor"))
      .toBe(constructorBefore !== undefined);

    pending.reject(new Error("private-late-native-promise-canary"));
    await flushMicrotasks();
    expect(harness.barrier.wait).toHaveBeenCalledTimes(1);
    expect(harness.hooks.clear).toHaveBeenCalledTimes(1);
    expect(harness.hooks.release).toHaveBeenCalledTimes(1);
  });

  it.each(["constructor", "then"] as const)(
    "observes late hostile native Promise %s rejection when the clock getter throws",
    async (property) => {
      const pending = deferred<void>();
      const hostileAccess = vi.fn(() => {
        throw new Error(`private-clock-${property}-canary`);
      });
      Object.defineProperty(pending.promise, property, {
        configurable: true,
        get: hostileAccess,
      });
      const descriptorBefore = Object.getOwnPropertyDescriptor(
        pending.promise,
        property,
      );
      const harness = createHarness();
      let disconnectCalls = 0;
      harness.dependencies.disconnect = () => {
        disconnectCalls += 1;
        harness.calls.push("disconnect");
        return pending.promise;
      };
      const clockAccess = vi.fn(() => {
        throw new Error("private-clock-getter-canary");
      });
      Object.defineProperty(harness.dependencies, "clock", {
        configurable: true,
        get: clockAccess,
      });

      const evidence = await createSessionFinalizer(
        harness.dependencies,
      ).finalize();

      expect(evidence).toEqual({
        hidRelease: "released",
        handoff: "reconnect-required",
      });
      expect(disconnectCalls).toBe(1);
      expect(clockAccess).toHaveBeenCalledTimes(1);
      expect(hostileAccess).not.toHaveBeenCalled();
      expect(harness.barrier.wait).toHaveBeenCalledTimes(1);
      expect(harness.hooks.clear).toHaveBeenCalledTimes(1);
      expect(harness.hooks.release).toHaveBeenCalledTimes(1);
      expect(harness.clock.count()).toBe(0);
      expect(
        Object.getOwnPropertyDescriptor(pending.promise, property),
      ).toEqual(descriptorBefore);

      pending.reject(new Error("private-clock-late-rejection-canary"));
      await flushMicrotasks();
      expect(harness.hooks.release).toHaveBeenCalledTimes(1);
    },
  );

  it("does not mutate a non-configurable hostile constructor outside the disconnect contract", async () => {
    const pending = deferred<void>();
    const hostileConstructor = vi.fn(() => {
      throw new Error("private-non-configurable-constructor-canary");
    });
    Object.defineProperty(pending.promise, "constructor", {
      configurable: false,
      get: hostileConstructor,
    });
    const descriptorBefore = Object.getOwnPropertyDescriptor(
      pending.promise,
      "constructor",
    );
    const harness = createHarness();
    let disconnectCalls = 0;
    harness.dependencies.disconnect = () => {
      disconnectCalls += 1;
      harness.calls.push("disconnect");
      return pending.promise;
    };

    const evidence = await createSessionFinalizer(
      harness.dependencies,
    ).finalize();

    // ECMAScript offers no observer that can bypass a non-configurable hostile
    // species constructor. This unsupported hook shape remains pending here;
    // the finalizer must stay total and must never mutate it.
    expect(evidence).toEqual({
      hidRelease: "released",
      handoff: "reconnect-required",
    });
    expect(disconnectCalls).toBe(1);
    expect(hostileConstructor).toHaveBeenCalledTimes(1);
    expect(harness.barrier.wait).toHaveBeenCalledTimes(1);
    expect(harness.hooks.clear).toHaveBeenCalledTimes(1);
    expect(harness.hooks.release).toHaveBeenCalledTimes(1);
    expect(harness.clock.count()).toBe(0);
    expect(
      Object.getOwnPropertyDescriptor(pending.promise, "constructor"),
    ).toEqual(descriptorBefore);
  });

  it("contains hostile thenable normalization and clears timer handle zero", async () => {
    const thenGetter = vi.fn(() => {
      throw new Error("private-thenable-normalization-canary");
    });
    const hostileThenable = Object.defineProperty({}, "then", {
      configurable: true,
      get: thenGetter,
    });
    const harness = createHarness({
      disconnect: () => {
        harness.calls.push("disconnect");
        return hostileThenable as Promise<void>;
      },
    });

    await expect(
      createSessionFinalizer(harness.dependencies).finalize(),
    ).resolves.toEqual({
      hidRelease: "released",
      handoff: "reconnect-required",
    });

    expect(thenGetter).toHaveBeenCalledTimes(1);
    expect(harness.hooks.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.barrier.wait).toHaveBeenCalledTimes(1);
    expect(harness.hooks.release).toHaveBeenCalledTimes(1);
    expect(harness.clock.count()).toBe(0);
    expect(harness.clock.clearCalls).toEqual([0]);
  });

  it("keeps a late hostile-thenable rejection observed after timeout", async () => {
    let rejectDisconnect: ((error: unknown) => void) | undefined;
    const hostileThenable = {
      then: (
        _resolve: () => void,
        reject: (error: unknown) => void,
      ): void => {
        rejectDisconnect = reject;
      },
    };
    const harness = createHarness({
      disconnect: () => {
        harness.calls.push("disconnect");
        return hostileThenable as Promise<void>;
      },
    });
    const result = createSessionFinalizer(harness.dependencies).finalize();
    await flushMicrotasks();

    expect(rejectDisconnect).toBeTypeOf("function");
    expect(harness.clock.count()).toBe(1);
    harness.clock.fireByDelay(
      PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
    );
    await expect(result).resolves.toEqual({
      hidRelease: "released",
      handoff: "reconnect-required",
    });

    rejectDisconnect?.(new Error("private-late-thenable-canary"));
    await flushMicrotasks();
    expect(harness.hooks.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.barrier.wait).toHaveBeenCalledTimes(1);
    expect(harness.hooks.clear).toHaveBeenCalledTimes(1);
    expect(harness.hooks.release).toHaveBeenCalledTimes(1);
    expect(harness.clock.count()).toBe(0);
    expect(harness.clock.clearCalls).toEqual([0]);
  });

  it.each<[string, () => Promise<void>]>([
    ["resolved", () => Promise.resolve()],
    ["rejected", () => Promise.reject({ tag: "DeviceSessionNotFound" })],
    ["throwing", () => {
      throw new Error("private-disconnect-canary");
    }],
  ])("always observes HID release after a %s disconnect", async (_label, disconnect) => {
    const harness = createHarness({
      disconnect: () => {
        harness.calls.push("disconnect");
        return disconnect();
      },
    });

    await expect(
      createSessionFinalizer(harness.dependencies).finalize(),
    ).resolves.toEqual({ hidRelease: "released", handoff: "ready" });
    expect(harness.barrier.wait).toHaveBeenCalledTimes(1);
    expect(harness.hooks.release).toHaveBeenCalledTimes(1);
  });

  it.each<[HidReleaseOutcome, "ready" | "reconnect-required"]>([
    ["released", "ready"],
    ["ambiguous", "reconnect-required"],
    ["unavailable", "reconnect-required"],
    ["timed-out", "reconnect-required"],
  ])("maps %s release evidence to %s", async (outcome, handoff) => {
    const harness = createHarness({ outcome });

    await expect(
      createSessionFinalizer(harness.dependencies).finalize(),
    ).resolves.toEqual({ hidRelease: outcome, handoff });
  });

  it("contains every throwing hook, still attempts exact cleanup, and redacts errors", async () => {
    const calls: string[] = [];
    const throwingHook = (name: string): (() => never) => () => {
      calls.push(name);
      throw new Error(`private-${name}-canary`);
    };
    const clock = new ManualClock();
    const barrier: HidReleaseBarrier = {
      arm: throwingHook("arm"),
      wait: throwingHook("wait"),
      cancel: vi.fn(),
    };
    const dependencies: SessionFinalizerDependencies = {
      clock,
      hidBarrier: barrier,
      blockNewWork: throwingHook("block"),
      cancelActiveActions: throwingHook("cancel"),
      unsubscribeLifecycle: throwingHook("unsubscribe"),
      invalidatePlansAndSession: throwingHook("invalidate"),
      disconnect: throwingHook("disconnect"),
      clearPrivateReferences: throwingHook("clear"),
      releaseLease: throwingHook("release"),
    };

    const evidence = await createSessionFinalizer(dependencies).finalize();

    expect(calls).toEqual([
      "block",
      "cancel",
      "unsubscribe",
      "invalidate",
      "arm",
      "disconnect",
      "wait",
      "clear",
      "release",
    ]);
    expect(evidence).toEqual({
      hidRelease: "unavailable",
      handoff: "reconnect-required",
    });
    expect(JSON.stringify(evidence)).not.toContain("private-");
  });

  it("continues conservatively when the disconnect clock cannot schedule or clear", async () => {
    const cannotSchedule = createHarness();
    cannotSchedule.clock.throwOnSet = true;
    await expect(
      createSessionFinalizer(cannotSchedule.dependencies).finalize(),
    ).resolves.toEqual({
      hidRelease: "released",
      handoff: "reconnect-required",
    });

    const cannotClear = createHarness();
    cannotClear.clock.throwOnClear = true;
    await expect(
      createSessionFinalizer(cannotClear.dependencies).finalize(),
    ).resolves.toEqual({
      hidRelease: "released",
      handoff: "reconnect-required",
    });
    expect(cannotClear.hooks.release).toHaveBeenCalledTimes(1);
  });

  it("contains unsupported async hook returns without delaying ordered cleanup", async () => {
    const harness = createHarness();
    harness.dependencies.cancelActiveActions = vi.fn(() =>
      Promise.reject(new Error("private-async-hook-canary")),
    );

    await expect(
      createSessionFinalizer(harness.dependencies).finalize(),
    ).resolves.toEqual({
      hidRelease: "released",
      handoff: "reconnect-required",
    });
    await flushMicrotasks();
    expect(harness.hooks.release).toHaveBeenCalledTimes(1);
  });

  it("fails closed for invalid barrier output and synchronously firing clocks", async () => {
    const invalidBarrier = createHarness({
      wait: () => Promise.resolve("spoofed" as HidReleaseOutcome),
    });
    await expect(
      createSessionFinalizer(invalidBarrier.dependencies).finalize(),
    ).resolves.toEqual({
      hidRelease: "unavailable",
      handoff: "reconnect-required",
    });

    const synchronousClock = createHarness();
    synchronousClock.clock.fireSynchronously = true;
    await expect(
      createSessionFinalizer(synchronousClock.dependencies).finalize(),
    ).resolves.toEqual({
      hidRelease: "released",
      handoff: "reconnect-required",
    });
    expect(synchronousClock.hooks.disconnect).toHaveBeenCalledTimes(1);
    expect(synchronousClock.hooks.release).toHaveBeenCalledTimes(1);
  });
});
