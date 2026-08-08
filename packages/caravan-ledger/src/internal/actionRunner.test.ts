import {
  runDmkAction,
  type DmkActionRunResult,
  type DmkPendingState,
} from "./actionRunner";
import { systemClock } from "./clock";
import type { DmkActionState, DmkOperation, DmkSession } from "./dmkPort";
import { ScriptedDmk } from "./testing/scriptedDmk";

const session: DmkSession = {
  internalSessionId: "test-session",
  modelId: "test-model",
};

describe("runDmkAction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("settles synchronous completion and unsubscribes exactly once", async () => {
    const fake = new ScriptedDmk(systemClock).queueAction("genuine", [
      { type: "next", value: { status: "not-started" } },
      {
        type: "next",
        value: { status: "completed", output: { isGenuine: true } },
      },
    ]);
    const run = runDmkAction(fake.runAction(session, { kind: "genuine" }));

    await expect(run.result).resolves.toEqual({
      status: "completed",
      output: { isGenuine: true },
    });
    run.cancel();
    expect(fake.resources()).toMatchObject({
      actionCount: 1,
      cancelCount: 0,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
    });
    expect(fake.calls.filter((call) => call.type === "subscribe")).toHaveLength(
      1,
    );
  });

  it("distinguishes action errors and stopped states", async () => {
    const rawError = new Error("test-only raw failure");
    const errorFake = new ScriptedDmk(systemClock).queueAction("genuine", [
      { type: "next", value: { status: "error", rawError } },
    ]);
    const stoppedFake = new ScriptedDmk(systemClock).queueAction("genuine", [
      { type: "next", value: { status: "stopped" } },
    ]);

    await expect(
      runDmkAction(errorFake.runAction(session, { kind: "genuine" })).result,
    ).resolves.toEqual({ status: "action-error", rawError });
    await expect(
      runDmkAction(stoppedFake.runAction(session, { kind: "genuine" })).result,
    ).resolves.toEqual({ status: "stopped" });
    expect(errorFake.resources().unsubscribeCount).toBe(1);
    expect(stoppedFake.resources().unsubscribeCount).toBe(1);
  });

  it("preserves the private install verification-required settlement", async () => {
    const fake = new ScriptedDmk(systemClock).queueAction(
      "install-bitcoin",
      [{ type: "next", value: { status: "verification-required" } }],
    );

    await expect(
      runDmkAction(
        fake.runAction(session, { kind: "install-bitcoin" }),
      ).result,
    ).resolves.toEqual({ status: "verification-required" });
    expect(fake.resources()).toMatchObject({
      cancelCount: 0,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("distinguishes observable error from a thrown subscription", async () => {
    const streamError = new Error("stream error");
    const subscriptionError = new Error("subscription error");
    const unsubscribe = vi.fn();
    const streamCancel = vi.fn();
    const streamOperation: DmkOperation<DmkActionState<"genuine">> = {
      stream: {
        subscribe: (observer) => {
          observer.error(streamError);
          return { closed: false, unsubscribe };
        },
      },
      cancel: streamCancel,
    };
    const thrownCancel = vi.fn();
    const thrownOperation: DmkOperation<DmkActionState<"genuine">> = {
      stream: {
        subscribe: () => {
          throw subscriptionError;
        },
      },
      cancel: thrownCancel,
    };

    await expect(runDmkAction(streamOperation).result).resolves.toEqual({
      status: "stream-error",
      rawError: streamError,
    });
    const thrownRun = runDmkAction(thrownOperation);
    await expect(thrownRun.result).resolves.toEqual({
      status: "subscription-error",
      rawError: subscriptionError,
    });
    thrownRun.cancel();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(streamCancel).not.toHaveBeenCalled();
    expect(thrownCancel).toHaveBeenCalledTimes(1);
  });

  it("lets cancellation win over adversarial late completion", async () => {
    const onPending = vi.fn();
    const fake = new ScriptedDmk(systemClock).queueAction("genuine", [
      {
        type: "next",
        value: { status: "pending", progress: 10 },
        atMs: 5,
      },
      {
        type: "next",
        value: { status: "completed", output: { isGenuine: true } },
        atMs: 10,
        afterCancel: true,
      },
    ]);
    const run = runDmkAction(fake.runAction(session, { kind: "genuine" }), {
      onPending,
    });

    run.cancel();
    run.cancel();
    await expect(run.result).resolves.toEqual({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(10);
    await expect(run.result).resolves.toEqual({ status: "cancelled" });

    expect(onPending).not.toHaveBeenCalled();
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("deduplicates pending states, strips extras, and isolates listeners", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    const consoleLog = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(vi.fn());
    const mutationAttempts: boolean[] = [];
    const onPending = vi.fn((state: DmkPendingState) => {
      try {
        (state as { progress?: number }).progress = 99;
        mutationAttempts.push(false);
      } catch {
        mutationAttempts.push(true);
      }
      throw new Error("listener failure");
    });
    const first = {
      status: "pending" as const,
      interaction: "unlock-device" as const,
      progress: 10,
      secret: "must-not-cross",
    };
    const second: DmkPendingState = {
      status: "pending",
      interaction: "unlock-device",
      progress: 20,
    };
    const fake = new ScriptedDmk(systemClock).queueAction("genuine", [
      { type: "next", value: first },
      { type: "next", value: first },
      { type: "next", value: second },
      { type: "next", value: second },
      {
        type: "next",
        value: { status: "completed", output: { isGenuine: true } },
      },
    ]);

    await expect(
      runDmkAction(fake.runAction(session, { kind: "genuine" }), {
        onPending,
      }).result,
    ).resolves.toMatchObject({ status: "completed" });

    expect(onPending).toHaveBeenCalledTimes(2);
    expect(mutationAttempts).toEqual([true, true]);
    expect(onPending.mock.calls.every(([state]) => Object.isFrozen(state))).toBe(
      true,
    );
    expect(onPending.mock.calls[0]?.[0]).toEqual({
      status: "pending",
      interaction: "unlock-device",
      progress: 10,
    });
    expect(JSON.stringify(onPending.mock.calls)).not.toContain(
      "must-not-cross",
    );
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("ignores every notification after the first terminal state", async () => {
    const lateError = new Error("late private failure");
    const onPending = vi.fn();
    const fake = new ScriptedDmk(systemClock).queueAction("genuine", [
      {
        type: "next",
        value: { status: "completed", output: { isGenuine: true } },
      },
      {
        type: "error",
        error: lateError,
        atMs: 1,
        afterCancel: true,
      },
      { type: "complete", atMs: 2, afterCancel: true },
      {
        type: "next",
        value: { status: "pending", interaction: "unlock-device" },
        atMs: 3,
        afterCancel: true,
      },
    ]);
    const run = runDmkAction(fake.runAction(session, { kind: "genuine" }), {
      onPending,
    });

    await expect(run.result).resolves.toEqual({
      status: "completed",
      output: { isGenuine: true },
    });
    await vi.advanceTimersByTimeAsync(3);
    await expect(run.result).resolves.toEqual({
      status: "completed",
      output: { isGenuine: true },
    });
    expect(onPending).not.toHaveBeenCalled();
    expect(fake.resources()).toMatchObject({
      cancelCount: 0,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("does not infer completion from 100 percent progress or elapsed time", async () => {
    const fake = new ScriptedDmk(systemClock).queueAction("install-bitcoin", [
      { type: "next", value: { status: "pending", progress: 100 } },
      { type: "never" },
    ]);
    const run = runDmkAction(
      fake.runAction(session, { kind: "install-bitcoin" }),
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(
      Promise.race([
        run.result.then((terminal) => terminal),
        Promise.resolve("still-pending" as const),
      ]),
    ).resolves.toBe("still-pending");

    run.cancel();
    await expect(run.result).resolves.toEqual({ status: "cancelled" });
  });

  it("fails closed when a stream completes without a terminal state", async () => {
    const unsubscribe = vi.fn();
    const cancel = vi.fn();
    const operation: DmkOperation<DmkActionState<"genuine">> = {
      stream: {
        subscribe: (observer) => {
          observer.complete();
          return { closed: true, unsubscribe };
        },
      },
      cancel,
    };

    await expect(runDmkAction(operation).result).resolves.toEqual({
      status: "stream-completed",
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("fails closed and unsubscribes from an unrecognized runtime state", async () => {
    const unsubscribe = vi.fn();
    const cancel = vi.fn();
    const operation: DmkOperation<DmkActionState<"genuine">> = {
      stream: {
        subscribe: (observer) => {
          observer.next({ status: "future-state" } as never);
          return { closed: false, unsubscribe };
        },
      },
      cancel,
    };

    await expect(runDmkAction(operation).result).resolves.toEqual({
      status: "invalid-state",
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps cancellation idempotent when vendor cleanup throws", async () => {
    const unsubscribe = vi.fn(() => {
      throw new Error("unsubscribe failure");
    });
    const cancel = vi.fn(() => {
      throw new Error("cancel failure");
    });
    const operation: DmkOperation<DmkActionState<"genuine">> = {
      stream: {
        subscribe: () => ({ closed: false, unsubscribe }),
      },
      cancel,
    };
    const run = runDmkAction(operation);

    expect(() => {
      run.cancel();
      run.cancel();
    }).not.toThrow();
    await expect(run.result).resolves.toEqual({ status: "cancelled" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("has a closed terminal result vocabulary", () => {
    const terminals: ReadonlyArray<DmkActionRunResult<"genuine">["status"]> = [
      "completed",
      "action-error",
      "stopped",
      "stream-error",
      "subscription-error",
      "stream-completed",
      "invalid-state",
      "cancelled",
    ];

    expect(terminals).toHaveLength(8);
  });
});
