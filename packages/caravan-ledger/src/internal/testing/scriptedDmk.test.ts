import { systemClock } from "../clock";
import type {
  DmkActionState,
  DmkDiscoveredDevice,
  DmkObserver,
  DmkSession,
} from "../dmkPort";

import { ScriptedDmk } from "./scriptedDmk";

const device: DmkDiscoveredDevice = {
  internalDeviceId: "test-device",
  modelId: "test-model",
};

const session: DmkSession = {
  internalSessionId: "test-session",
  modelId: "test-model",
};

function observer<T>() {
  return {
    values: [] as T[],
    errors: [] as unknown[],
    completions: 0,
    port: undefined as unknown as DmkObserver<T>,
  };
}

function attachPort<T>(target: ReturnType<typeof observer<T>>): void {
  target.port = {
    next: (value) => target.values.push(value),
    error: (error) => target.errors.push(error),
    complete: () => {
      target.completions += 1;
    },
  };
}

describe("ScriptedDmk", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records environment, discovery, connection, action, and cleanup order", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }, { type: "complete" }])
      .queueConnect({ type: "resolve", value: session })
      .queueAction("genuine", [
        { type: "next", value: { status: "not-started" } },
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ]);
    const discoveryObserver = observer<DmkDiscoveredDevice>();
    attachPort(discoveryObserver);
    const actionObserver = observer<DmkActionState<"genuine">>();
    attachPort(actionObserver);

    expect(fake.isEnvironmentSupported()).toBe(true);
    fake.startDiscovery().stream.subscribe(discoveryObserver.port);
    const connected = await fake.connect(device);
    const actionSubscription = fake
      .runAction(connected, { kind: "genuine" })
      .stream.subscribe(actionObserver.port);
    actionSubscription.unsubscribe();
    await fake.disconnect(connected);
    await fake.close();

    expect(discoveryObserver.values).toEqual([device]);
    expect(actionObserver.values.at(-1)).toEqual({
      status: "completed",
      output: { isGenuine: true },
    });
    expect(fake.calls.map((call) => call.type)).toEqual([
      "environment-support",
      "start-discovery",
      "subscribe",
      "next",
      "complete",
      "connect",
      "run-action",
      "subscribe",
      "next",
      "next",
      "unsubscribe",
      "disconnect",
      "close",
    ]);
    expect(fake.resources()).toMatchObject({
      discoveryCount: 1,
      actionCount: 1,
      connectCount: 1,
      disconnectCount: 1,
      closeCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("supports asynchronous duplicate states and never-settling streams", () => {
    const pending: DmkActionState<"install-bitcoin"> = {
      status: "pending",
      progress: 10,
    };
    const fake = new ScriptedDmk(systemClock).queueAction("install-bitcoin", [
      { type: "next", value: pending, atMs: 5 },
      { type: "next", value: pending, atMs: 10 },
      { type: "never" },
    ]);
    const target = observer<DmkActionState<"install-bitcoin">>();
    attachPort(target);

    fake
      .runAction(session, { kind: "install-bitcoin" })
      .stream.subscribe(target.port);
    vi.advanceTimersByTime(10);

    expect(target.values).toEqual([pending, pending]);
    expect(target.completions).toBe(0);
    expect(fake.resources().activeSubscriptions).toBe(1);
  });

  it("models the install-only mutation marker as false until its exact step", () => {
    const fake = new ScriptedDmk(systemClock).queueAction("install-bitcoin", [
      { type: "next", value: { status: "pending", progress: 0 }, atMs: 2 },
      { type: "attempt-install-mutation", atMs: 5 },
      { type: "next", value: { status: "pending", progress: 0.5 }, atMs: 8 },
    ]);
    const target = observer<DmkActionState<"install-bitcoin">>();
    attachPort(target);
    const operation = fake.runAction(session, { kind: "install-bitcoin" });

    expect(operation.dispatchStarted()).toBe(true);
    expect(operation.mutationAttempted()).toBe(false);
    operation.stream.subscribe(target.port);
    vi.advanceTimersByTime(4);
    expect(operation.mutationAttempted()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(operation.mutationAttempted()).toBe(true);
    expect(
      fake.calls.filter((call) => call.type === "attempt-install-mutation"),
    ).toHaveLength(1);
  });

  it("can model an adversarial mutation attempt that wins after cancellation", () => {
    const fake = new ScriptedDmk(systemClock).queueAction("install-bitcoin", [
      {
        type: "attempt-install-mutation",
        atMs: 5,
        afterCancel: true,
      },
    ]);
    const target = observer<DmkActionState<"install-bitcoin">>();
    attachPort(target);
    const operation = fake.runAction(session, { kind: "install-bitcoin" });
    operation.stream.subscribe(target.port);

    operation.cancel();
    expect(operation.mutationAttempted()).toBe(false);
    vi.advanceTimersByTime(5);
    expect(operation.mutationAttempted()).toBe(true);
  });

  it("cancels and unsubscribes idempotently while allowing adversarial late delivery", () => {
    const late: DmkActionState<"open-bitcoin"> = {
      status: "completed",
      output: { appOpened: true },
    };
    const fake = new ScriptedDmk(systemClock).queueAction("open-bitcoin", [
      { type: "next", value: { status: "pending" }, atMs: 5 },
      { type: "next", value: late, atMs: 10, afterCancel: true },
    ]);
    const target = observer<DmkActionState<"open-bitcoin">>();
    attachPort(target);
    const operation = fake.runAction(session, { kind: "open-bitcoin" });
    const subscription = operation.stream.subscribe(target.port);

    operation.cancel();
    operation.cancel();
    subscription.unsubscribe();
    subscription.unsubscribe();
    vi.advanceTimersByTime(10);

    expect(target.values).toEqual([late]);
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("does not retain normal timers queued after synchronous cancellation", () => {
    const late: DmkActionState<"open-bitcoin"> = {
      status: "completed",
      output: { appOpened: false },
    };
    const fake = new ScriptedDmk(systemClock).queueAction("open-bitcoin", [
      { type: "next", value: { status: "pending" } },
      { type: "next", value: late, atMs: 10 },
      { type: "next", value: late, atMs: 20, afterCancel: true },
    ]);
    const values: DmkActionState<"open-bitcoin">[] = [];
    const operation = fake.runAction(session, { kind: "open-bitcoin" });
    const subscription = operation.stream.subscribe({
      next: (value) => {
        values.push(value);
        if (values.length === 1) {
          operation.cancel();
        }
      },
      error: vi.fn(),
      complete: vi.fn(),
    });

    expect(fake.resources().scheduledTimers).toBe(1);
    vi.advanceTimersByTime(20);
    expect(values).toEqual([{ status: "pending" }, late]);
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      scheduledTimers: 0,
    });
    subscription.unsubscribe();
  });

  it("can throw during subscription and return async promise failures", async () => {
    const subscriptionError = new Error("symbolic subscription failure");
    const connectionError = new Error("symbolic connection failure");
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([
        { type: "throw-on-subscribe", error: subscriptionError },
      ])
      .queueConnect({
        type: "reject",
        error: connectionError,
        afterMs: 25,
      });
    const target = observer<DmkDiscoveredDevice>();
    attachPort(target);

    expect(() => fake.startDiscovery().stream.subscribe(target.port)).toThrow(
      subscriptionError,
    );
    const connectionResult = fake.connect(device).catch((error) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await connectionResult).toBe(connectionError);
    expect(fake.resources()).toMatchObject({
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("can deterministically leave a cleanup promise unsettled", async () => {
    const fake = new ScriptedDmk(systemClock).queueClose({ type: "never" });
    const closeResult = fake.close();

    await expect(
      Promise.race([
        closeResult.then(() => "settled" as const),
        Promise.resolve("pending" as const),
      ]),
    ).resolves.toBe("pending");
    expect(fake.resources()).toMatchObject({
      closeCount: 1,
      scheduledTimers: 0,
    });
  });

  it("scripts metadata-free session lifecycle completion and errors", () => {
    const lifecycleError = new Error("symbolic lifecycle failure");
    const completionTarget = observer<never>();
    const errorTarget = observer<never>();
    attachPort(completionTarget);
    attachPort(errorTarget);
    const fake = new ScriptedDmk(systemClock)
      .queueSessionLifecycle([{ type: "complete" }])
      .queueSessionLifecycle([{ type: "error", error: lifecycleError }]);

    fake.observeSessionLifecycle(session).subscribe(completionTarget.port);
    fake.observeSessionLifecycle(session).subscribe(errorTarget.port);

    expect(completionTarget.values).toEqual([]);
    expect(completionTarget.completions).toBe(1);
    expect(errorTarget.values).toEqual([]);
    expect(errorTarget.errors).toEqual([lifecycleError]);
    expect(fake.resources()).toMatchObject({
      sessionLifecycleCount: 2,
      activeSubscriptions: 0,
    });
  });

  it("rejects out-of-order generic action authority", () => {
    const fake = new ScriptedDmk(systemClock).queueAction("genuine", [
      { type: "never" },
    ]);

    expect(() => fake.runAction(session, { kind: "list-bitcoin" })).toThrow(
      "Expected scripted action genuine, received list-bitcoin.",
    );
    expect(fake.resources().actionCount).toBe(0);
  });

  it("rejects missing connection and lifecycle scripts synchronously", () => {
    const fake = new ScriptedDmk(systemClock);

    expect(() => fake.connect(device)).toThrow(
      "No connection script is queued.",
    );
    expect(() => fake.observeSessionLifecycle(session)).toThrow(
      "No session lifecycle script is queued.",
    );
  });

  it("rejects a second subscription to the same scripted operation", () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "never" },
    ]);
    const operation = fake.startDiscovery();
    const target = observer<DmkDiscoveredDevice>();
    attachPort(target);

    operation.stream.subscribe(target.port);

    expect(() => operation.stream.subscribe(target.port)).toThrow(
      "can only be subscribed once",
    );
  });

  it("rejects invalid stream and promise delays before scheduling host timers", () => {
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([
        { type: "next", value: device, atMs: Number.NaN },
      ])
      .queueConnect({ type: "resolve", value: session, afterMs: -1 });
    const target = observer<DmkDiscoveredDevice>();
    attachPort(target);

    expect(() => fake.startDiscovery().stream.subscribe(target.port)).toThrow(
      "Script times must be finite and non-negative.",
    );
    expect(() => fake.connect(device)).toThrow(
      "Script times must be finite and non-negative.",
    );
  });

  it("ignores a cleared timer callback retained by a hostile clock", () => {
    const retainingClock = {
      ...systemClock,
      clearTimeout: vi.fn(),
    };
    const fake = new ScriptedDmk(retainingClock).queueAction("open-bitcoin", [
      {
        type: "next",
        value: { status: "completed", output: { appOpened: true } },
        atMs: 5,
      },
    ]);
    const target = observer<DmkActionState<"open-bitcoin">>();
    attachPort(target);
    const operation = fake.runAction(session, { kind: "open-bitcoin" });
    operation.stream.subscribe(target.port);

    operation.cancel();
    vi.advanceTimersByTime(5);

    expect(target.values).toEqual([]);
    expect(retainingClock.clearTimeout).toHaveBeenCalledOnce();
  });

  it("ignores a mutation marker injected into a non-install script", () => {
    const fake = new ScriptedDmk(systemClock).queueAction("open-bitcoin", [
      { type: "attempt-install-mutation" } as never,
      {
        type: "next",
        value: { status: "completed", output: { appOpened: false } },
      },
    ]);
    const target = observer<DmkActionState<"open-bitcoin">>();
    attachPort(target);

    fake
      .runAction(session, { kind: "open-bitcoin" })
      .stream.subscribe(target.port);

    expect(target.values).toEqual([
      { status: "completed", output: { appOpened: false } },
    ]);
    expect(
      fake.calls.filter((call) => call.type === "attempt-install-mutation"),
    ).toHaveLength(0);
  });

  it("supports an explicitly scripted synchronous promise throw", () => {
    const thrown = new Error("scripted synchronous connection failure");
    const fake = new ScriptedDmk(systemClock).queueConnect({
      type: "throw",
      error: thrown,
    });

    expect(() => fake.connect(device)).toThrow(thrown);
  });
});
