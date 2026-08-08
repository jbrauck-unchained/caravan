import {
  DeviceActionStatus,
  GenuineCheckDeviceAction,
  ListInstalledAppsDeviceAction,
  UserInteractionRequired,
} from "@ledgerhq/device-management-kit";

import { DmkAdapter } from "./dmkAdapter";
import type {
  DmkActionKind,
  DmkActionRequest,
  DmkActionState,
  DmkObserver,
} from "./dmkPort";

function nativeStream<T>() {
  let observer: DmkObserver<T> | undefined;
  let closed = false;
  const unsubscribe = vi.fn(() => {
    closed = true;
  });
  return {
    stream: {
      subscribe: vi.fn((nextObserver: DmkObserver<T>) => {
        observer = nextObserver;
        return {
          get closed() {
            return closed;
          },
          unsubscribe,
        };
      }),
    },
    next(value: T) {
      observer?.next(value);
    },
    error(error: unknown) {
      closed = true;
      observer?.error(error);
    },
    complete() {
      closed = true;
      observer?.complete();
    },
    unsubscribe,
  };
}

function makeRuntime() {
  return {
    isEnvironmentSupported: vi.fn(() => true),
    startDiscovering: vi.fn(),
    stopDiscovering: vi.fn(() => Promise.resolve()),
    connect: vi.fn(),
    getConnectedDevice: vi.fn(),
    getDeviceSessionState: vi.fn(),
    disconnect: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    executeDeviceAction: vi.fn(),
  };
}

type ReadOnlyActionKind = Extract<DmkActionKind, "genuine" | "list-bitcoin">;

async function makeConnectedAdapter() {
  const discovery = nativeStream<typeof nativeDevice>();
  const runtime = makeRuntime();
  runtime.startDiscovering.mockReturnValue(discovery.stream);
  runtime.connect.mockResolvedValue("native-session-secret");
  runtime.getConnectedDevice.mockReturnValue({ modelId: "nanoS" });
  const adapter = new DmkAdapter(runtime as never);
  const discoveryOperation = adapter.startDiscovery();
  let selected: Parameters<typeof adapter.connect>[0] | undefined;
  const discoverySubscription = discoveryOperation.stream.subscribe({
    next: (device) => {
      selected = device;
    },
    error: vi.fn(),
    complete: vi.fn(),
  });
  discovery.next(nativeDevice);
  discoveryOperation.cancel();
  discoverySubscription.unsubscribe();
  const session = await adapter.connect(selected!);
  return { adapter, runtime, session };
}

async function makeActionHarness<K extends ReadOnlyActionKind>(kind: K) {
  const { adapter, runtime, session } = await makeConnectedAdapter();
  const source = nativeStream<unknown>();
  const nativeCancel = vi.fn();
  runtime.executeDeviceAction.mockReturnValue({
    observable: source.stream,
    cancel: nativeCancel,
  });
  const request = { kind } as Extract<DmkActionRequest, { readonly kind: K }>;
  const operation = adapter.runAction(session, request);
  const states: DmkActionState<K>[] = [];
  const observer = {
    next: vi.fn((state: DmkActionState<K>) => {
      states.push(state);
    }),
    error: vi.fn(),
    complete: vi.fn(),
  };
  const subscription = operation.stream.subscribe(observer);
  return {
    adapter,
    runtime,
    session,
    source,
    nativeCancel,
    operation,
    states,
    observer,
    subscription,
  };
}

function installedApp(name: string) {
  return {
    flags: 7,
    hash: `private-hash-for-${name}`,
    hash_code_data: `private-code-hash-for-${name}`,
    name,
  };
}

function callableInstalledApp(name: string) {
  const app = () => undefined;
  Object.defineProperties(app, {
    flags: { value: 7 },
    hash: { value: `private-hash-for-${name}` },
    hash_code_data: { value: `private-code-hash-for-${name}` },
    name: { value: name },
  });
  return app;
}

function expectFailedClosedState(states: readonly DmkActionState[]): void {
  expect(states).toHaveLength(1);
  expect(states[0]).toMatchObject({ status: "error" });
  if (states[0]?.status !== "error") {
    throw new Error("Expected a failed-closed adapter state.");
  }
  expect(states[0].rawError).toMatchObject({
    _tag: expect.stringMatching(
      /^(InvalidDmkActionStateError|IndeterminateInstalledAppsError)$/,
    ),
  });
}

const nativeDevice = {
  id: "native-device-secret",
  name: "private device name",
  deviceModel: {
    id: "native-device-secret",
    model: "nanoS",
    name: "private model name",
  },
  transport: "WEB-HID",
};

describe("DMK adapter", () => {
  it("starts WebHID synchronously and reduces discovery to opaque identity", () => {
    const calls: string[] = [];
    const discovery = nativeStream<typeof nativeDevice>();
    const runtime = makeRuntime();
    runtime.startDiscovering.mockImplementation(() => {
      calls.push("start");
      return discovery.stream;
    });
    discovery.stream.subscribe.mockImplementation((observer) => {
      calls.push("subscribe");
      const subscription = {
        closed: false,
        unsubscribe: discovery.unsubscribe,
      };
      observer.next(nativeDevice);
      return subscription;
    });
    const adapter = new DmkAdapter(runtime as never);
    const values: unknown[] = [];

    const operation = adapter.startDiscovery();
    const subscription = operation.stream.subscribe({
      next: (device) => values.push(device),
      error: vi.fn(),
      complete: vi.fn(),
    });

    expect(calls).toEqual(["start", "subscribe"]);
    expect(runtime.startDiscovering).toHaveBeenCalledWith({
      transport: "WEB-HID",
    });
    expect(values).toEqual([{ internalDeviceId: "caravan-device-1" }]);
    expect(JSON.stringify(values)).not.toContain("native-device-secret");
    expect(JSON.stringify(values)).not.toContain("private device name");
    operation.cancel();
    operation.cancel();
    subscription.unsubscribe();
    subscription.unsubscribe();
    expect(runtime.stopDiscovering).toHaveBeenCalledOnce();
    expect(discovery.unsubscribe).toHaveBeenCalledOnce();
  });

  it("contains asynchronous stop failures and cannot subscribe after cancellation", async () => {
    const discovery = nativeStream<typeof nativeDevice>();
    const runtime = makeRuntime();
    runtime.startDiscovering.mockReturnValue(discovery.stream);
    runtime.stopDiscovering.mockRejectedValue(
      new Error("private transport cleanup failure"),
    );
    const adapter = new DmkAdapter(runtime as never);
    const next = vi.fn();
    const error = vi.fn();
    const complete = vi.fn();

    const operation = adapter.startDiscovery();
    operation.cancel();
    operation.cancel();
    const subscription = operation.stream.subscribe({ next, error, complete });
    await Promise.resolve();

    expect(runtime.stopDiscovering).toHaveBeenCalledOnce();
    expect(discovery.stream.subscribe).not.toHaveBeenCalled();
    expect(subscription.closed).toBe(true);
    expect(next).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("connects the exact selected device with refresh disabled and hides native IDs", async () => {
    const discovery = nativeStream<typeof nativeDevice>();
    const lifecycle = nativeStream<unknown>();
    const runtime = makeRuntime();
    runtime.startDiscovering.mockReturnValue(discovery.stream);
    runtime.connect.mockResolvedValue("native-session-secret");
    runtime.getConnectedDevice.mockReturnValue({ modelId: "nanoS" });
    runtime.getDeviceSessionState.mockReturnValue(lifecycle.stream);
    const adapter = new DmkAdapter(runtime as never);
    const operation = adapter.startDiscovery();
    let selected: Parameters<typeof adapter.connect>[0] | undefined;
    operation.stream.subscribe({
      next: (device) => {
        selected = device;
      },
      error: vi.fn(),
      complete: vi.fn(),
    });
    discovery.next(nativeDevice);
    operation.cancel();

    const session = await adapter.connect(selected!);
    expect(runtime.connect).toHaveBeenCalledWith({
      device: nativeDevice,
      sessionRefresherOptions: { isRefresherDisabled: true },
    });
    expect(runtime.getConnectedDevice).toHaveBeenCalledWith({
      sessionId: "native-session-secret",
    });
    expect(session).toEqual({
      internalSessionId: "caravan-session-1",
      modelId: "nanoS",
    });
    expect(JSON.stringify(session)).not.toContain("native-session-secret");

    const values: unknown[] = [];
    const completions = vi.fn();
    const lifecycleSubscription = adapter
      .observeSessionLifecycle(session)
      .subscribe({
        next: (value) => values.push(value),
        error: vi.fn(),
        complete: completions,
      });
    lifecycle.next({ sessionId: "native-session-secret", private: true });
    lifecycle.complete();
    expect(values).toEqual([]);
    expect(completions).toHaveBeenCalledOnce();
    lifecycleSubscription.unsubscribe();

    await adapter.disconnect(session);
    await adapter.disconnect(session);
    expect(runtime.disconnect).toHaveBeenCalledOnce();
    expect(runtime.disconnect).toHaveBeenCalledWith({
      sessionId: "native-session-secret",
    });
    expect(lifecycle.unsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects fabricated device capabilities before native connection", async () => {
    const runtime = makeRuntime();
    const adapter = new DmkAdapter(runtime as never);

    await expect(
      adapter.connect({ internalDeviceId: "caravan-device-1" }),
    ).rejects.toThrow("not owned by this adapter");
    expect(runtime.connect).not.toHaveBeenCalled();
  });

  it("disconnects once after post-connect setup failure and keeps it primary", async () => {
    const discovery = nativeStream<typeof nativeDevice>();
    const runtime = makeRuntime();
    const setupError = new Error("symbolic connected-device failure");
    runtime.startDiscovering.mockReturnValue(discovery.stream);
    runtime.connect.mockResolvedValue("native-session-secret");
    runtime.getConnectedDevice.mockImplementation(() => {
      throw setupError;
    });
    runtime.disconnect.mockRejectedValue(new Error("symbolic cleanup failure"));
    const adapter = new DmkAdapter(runtime as never);
    const operation = adapter.startDiscovery();
    let selected: Parameters<typeof adapter.connect>[0] | undefined;
    operation.stream.subscribe({
      next: (device) => {
        selected = device;
      },
      error: vi.fn(),
      complete: vi.fn(),
    });
    discovery.next(nativeDevice);

    await expect(adapter.connect(selected!)).rejects.toBe(setupError);
    expect(runtime.disconnect).toHaveBeenCalledOnce();
  });

  it.each(["install-bitcoin", "open-bitcoin"] as const)(
    "keeps %s unavailable without constructing a native action",
    (kind) => {
      const runtime = makeRuntime();
      const adapter = new DmkAdapter(runtime as never);

      expect(() =>
        adapter.runAction(
          { internalSessionId: "opaque", modelId: "nanoS" },
          { kind },
        ),
      ).toThrow("not available yet");
      expect(runtime.executeDeviceAction).not.toHaveBeenCalled();
    },
  );

  it("rejects an unrecognized runtime action without widening native authority", async () => {
    const { adapter, runtime, session } = await makeConnectedAdapter();

    expect(() =>
      adapter.runAction(session, { kind: "future-action" } as never),
    ).toThrow("not available yet");
    expect(runtime.executeDeviceAction).not.toHaveBeenCalled();
  });

  it("rejects a fabricated session before executing a read-only action", () => {
    const runtime = makeRuntime();
    const adapter = new DmkAdapter(runtime as never);

    expect(() =>
      adapter.runAction(
        { internalSessionId: "opaque", modelId: "nanoS" },
        { kind: "genuine" },
      ),
    ).toThrow("not owned by this adapter");
    expect(runtime.executeDeviceAction).not.toHaveBeenCalled();
  });

  it("constructs the exact genuine action with reviewed input and no logger authority", async () => {
    const { runtime, nativeCancel } = await makeActionHarness("genuine");

    expect(runtime.executeDeviceAction).toHaveBeenCalledOnce();
    const executeInput = runtime.executeDeviceAction.mock.calls[0]?.[0] as {
      readonly sessionId: string;
      readonly deviceAction: GenuineCheckDeviceAction;
    };
    expect(executeInput.sessionId).toBe("native-session-secret");
    expect(executeInput.deviceAction).toBeInstanceOf(GenuineCheckDeviceAction);
    expect(executeInput.deviceAction.input).toEqual({
      unlockTimeout: 60_000,
    });
    expect(Object.keys(executeInput.deviceAction.input)).toEqual([
      "unlockTimeout",
    ]);
    expect(executeInput.deviceAction.inspect).toBe(false);
    expect(Reflect.get(executeInput.deviceAction, "logger")).toBeUndefined();
    expect(
      Reflect.get(executeInput.deviceAction, "loggerFactory"),
    ).toBeUndefined();
    expect(nativeCancel).not.toHaveBeenCalled();
  });

  it("constructs the exact list action with reviewed input and no optional authority", async () => {
    const { runtime } = await makeActionHarness("list-bitcoin");

    expect(runtime.executeDeviceAction).toHaveBeenCalledOnce();
    const executeInput = runtime.executeDeviceAction.mock.calls[0]?.[0] as {
      readonly sessionId: string;
      readonly deviceAction: ListInstalledAppsDeviceAction;
    };
    expect(executeInput.sessionId).toBe("native-session-secret");
    expect(executeInput.deviceAction).toBeInstanceOf(
      ListInstalledAppsDeviceAction,
    );
    expect(executeInput.deviceAction.input).toEqual({
      unlockTimeout: 60_000,
    });
    expect(Object.keys(executeInput.deviceAction.input)).toEqual([
      "unlockTimeout",
    ]);
    expect(executeInput.deviceAction.inspect).toBe(false);
    expect(Reflect.get(executeInput.deviceAction, "logger")).toBeUndefined();
    expect(
      Reflect.get(executeInput.deviceAction, "loggerFactory"),
    ).toBeUndefined();
  });

  it("maps every genuine non-error status and never reads the fingerprint", async () => {
    const harness = await makeActionHarness("genuine");
    const fingerprintGetter = vi.fn(() => "private-fingerprint-canary");
    const secureIntermediate = {
      requiredUserInteraction: UserInteractionRequired.AllowSecureConnection,
    };
    Object.defineProperty(secureIntermediate, "deviceId", {
      enumerable: true,
      get: fingerprintGetter,
    });

    harness.source.next({ status: DeviceActionStatus.NotStarted });
    harness.source.next({
      status: DeviceActionStatus.Pending,
      intermediateValue: {
        requiredUserInteraction: UserInteractionRequired.None,
        deviceId: "private-fingerprint-canary",
      },
    });
    harness.source.next({
      status: DeviceActionStatus.Pending,
      intermediateValue: {
        requiredUserInteraction: UserInteractionRequired.UnlockDevice,
      },
    });
    harness.source.next({
      status: DeviceActionStatus.Pending,
      intermediateValue: secureIntermediate,
    });
    harness.source.next({
      status: DeviceActionStatus.Completed,
      output: { isGenuine: true },
    });
    harness.source.next({
      status: DeviceActionStatus.Error,
      error: new Error("late private error"),
    });
    harness.source.complete();

    expect(harness.states).toEqual([
      { status: "not-started" },
      { status: "pending" },
      { status: "pending", interaction: "unlock-device" },
      { status: "pending", interaction: "allow-secure-connection" },
      { status: "completed", output: { isGenuine: true } },
    ]);
    expect(fingerprintGetter).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.states)).not.toContain(
      "private-fingerprint-canary",
    );
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.nativeCancel).not.toHaveBeenCalled();
    expect(harness.observer.complete).not.toHaveBeenCalled();
  });

  it("preserves a native action error only on the internal error state", async () => {
    const harness = await makeActionHarness("genuine");
    const rawError = Object.freeze({
      _tag: "DeviceLockedError",
      privateDetail: "private-error-canary",
    });

    harness.source.next({
      status: DeviceActionStatus.Error,
      error: rawError,
    });

    expect(harness.states).toEqual([{ status: "error", rawError }]);
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.nativeCancel).not.toHaveBeenCalled();
  });

  it("maps stopped as terminal and ignores later completion", async () => {
    const harness = await makeActionHarness("genuine");

    harness.source.next({ status: DeviceActionStatus.Stopped });
    harness.source.next({
      status: DeviceActionStatus.Completed,
      output: { isGenuine: true },
    });

    expect(harness.states).toEqual([{ status: "stopped" }]);
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.nativeCancel).not.toHaveBeenCalled();
  });

  it("forwards observable error and completion without inventing action evidence", async () => {
    const errorHarness = await makeActionHarness("genuine");
    const streamError = new Error("symbolic native stream error");
    errorHarness.source.error(streamError);

    expect(errorHarness.observer.error).toHaveBeenCalledOnce();
    expect(errorHarness.observer.error).toHaveBeenCalledWith(streamError);
    expect(errorHarness.states).toEqual([]);
    expect(errorHarness.source.unsubscribe).toHaveBeenCalledOnce();

    const completeHarness = await makeActionHarness("genuine");
    completeHarness.source.complete();

    expect(completeHarness.observer.complete).toHaveBeenCalledOnce();
    expect(completeHarness.states).toEqual([]);
    expect(completeHarness.source.unsubscribe).toHaveBeenCalledOnce();
  });

  it("contains a pending observer failure and cleans up both native paths once", async () => {
    const harness = await makeActionHarness("genuine");
    const privateListenerError = new Error("private-listener-canary");
    harness.observer.next.mockImplementation(() => {
      throw privateListenerError;
    });

    expect(() =>
      harness.source.next({ status: DeviceActionStatus.NotStarted }),
    ).not.toThrow();
    harness.source.next({
      status: DeviceActionStatus.Completed,
      output: { isGenuine: true },
    });

    expect(harness.observer.next).toHaveBeenCalledOnce();
    expect(harness.nativeCancel).toHaveBeenCalledOnce();
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.states).toEqual([]);
  });

  it("contains terminal next, error, and complete observer failures", async () => {
    const terminalHarness = await makeActionHarness("genuine");
    terminalHarness.observer.next.mockImplementation(() => {
      throw new Error("private-terminal-listener-canary");
    });
    expect(() =>
      terminalHarness.source.next({
        status: DeviceActionStatus.Completed,
        output: { isGenuine: true },
      }),
    ).not.toThrow();
    expect(terminalHarness.nativeCancel).toHaveBeenCalledOnce();
    expect(terminalHarness.source.unsubscribe).toHaveBeenCalledOnce();

    const errorHarness = await makeActionHarness("genuine");
    errorHarness.observer.error.mockImplementation(() => {
      throw new Error("private-error-listener-canary");
    });
    expect(() =>
      errorHarness.source.error(new Error("private-native-error-canary")),
    ).not.toThrow();
    expect(errorHarness.nativeCancel).toHaveBeenCalledOnce();
    expect(errorHarness.source.unsubscribe).toHaveBeenCalledOnce();

    const completeHarness = await makeActionHarness("genuine");
    completeHarness.observer.complete.mockImplementation(() => {
      throw new Error("private-complete-listener-canary");
    });
    expect(() => completeHarness.source.complete()).not.toThrow();
    expect(completeHarness.nativeCancel).toHaveBeenCalledOnce();
    expect(completeHarness.source.unsubscribe).toHaveBeenCalledOnce();
  });

  it("contains synchronous terminal cleanup during native subscription", async () => {
    const { adapter, runtime, session } = await makeConnectedAdapter();
    const unsubscribe = vi.fn();
    const nativeCancel = vi.fn();
    const subscribe = vi.fn((observer: DmkObserver<unknown>) => {
      observer.next({
        status: DeviceActionStatus.Completed,
        output: { isGenuine: false },
      });
      return { closed: true, unsubscribe };
    });
    runtime.executeDeviceAction.mockReturnValue({
      observable: { subscribe },
      cancel: nativeCancel,
    });
    const states: DmkActionState<"genuine">[] = [];

    const operation = adapter.runAction(session, { kind: "genuine" });
    const subscription = operation.stream.subscribe({
      next: (state) => states.push(state),
      error: vi.fn(),
      complete: vi.fn(),
    });

    expect(states).toEqual([
      { status: "completed", output: { isGenuine: false } },
    ]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    subscription.unsubscribe();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(nativeCancel).not.toHaveBeenCalled();
  });

  it("contains hostile synchronous terminal teardown before subscription assignment", async () => {
    const { adapter, runtime, session } = await makeConnectedAdapter();
    const nativeCancel = vi.fn(() => {
      throw new Error("private-cancel-canary");
    });
    const unsubscribeGetter = vi.fn(() => {
      throw new Error("private-unsubscribe-canary");
    });
    const nativeSubscription = { closed: false };
    Object.defineProperty(nativeSubscription, "unsubscribe", {
      get: unsubscribeGetter,
    });
    const subscribe = vi.fn((observer: DmkObserver<unknown>) => {
      observer.next({
        status: DeviceActionStatus.Completed,
        output: { isGenuine: true },
      });
      return nativeSubscription;
    });
    runtime.executeDeviceAction.mockReturnValue({
      observable: { subscribe },
      cancel: nativeCancel,
    });
    const next = vi.fn();

    const operation = adapter.runAction(session, { kind: "genuine" });
    let subscription: ReturnType<typeof operation.stream.subscribe> | undefined;
    expect(() => {
      subscription = operation.stream.subscribe({
        next,
        error: vi.fn(),
        complete: vi.fn(),
      });
    }).not.toThrow();

    expect(next).toHaveBeenCalledOnce();
    expect(nativeCancel).toHaveBeenCalledOnce();
    expect(unsubscribeGetter).toHaveBeenCalledOnce();
    expect(subscription?.closed).toBe(true);
    expect(() => subscription?.unsubscribe()).not.toThrow();
    expect(nativeCancel).toHaveBeenCalledOnce();
    expect(unsubscribeGetter).toHaveBeenCalledOnce();
  });

  it("propagates a synchronous execute failure without subscribing or retrying", async () => {
    const { adapter, runtime, session } = await makeConnectedAdapter();
    const executeError = new Error("symbolic execute failure");
    runtime.executeDeviceAction.mockImplementation(() => {
      throw executeError;
    });

    expect(() => adapter.runAction(session, { kind: "genuine" })).toThrow(
      executeError,
    );
    expect(runtime.executeDeviceAction).toHaveBeenCalledOnce();
  });

  it("cancels and cleans up a synchronous subscription failure", async () => {
    const { adapter, runtime, session } = await makeConnectedAdapter();
    const subscriptionError = new Error("symbolic subscription failure");
    const nativeCancel = vi.fn();
    const subscribe = vi.fn(() => {
      throw subscriptionError;
    });
    runtime.executeDeviceAction.mockReturnValue({
      observable: { subscribe },
      cancel: nativeCancel,
    });
    const operation = adapter.runAction(session, { kind: "genuine" });

    expect(() =>
      operation.stream.subscribe({
        next: vi.fn(),
        error: vi.fn(),
        complete: vi.fn(),
      }),
    ).toThrow(subscriptionError);
    expect(nativeCancel).toHaveBeenCalledOnce();
  });

  it("rejects a missing native subscription and cancels once", async () => {
    const { adapter, runtime, session } = await makeConnectedAdapter();
    const nativeCancel = vi.fn();
    runtime.executeDeviceAction.mockReturnValue({
      observable: { subscribe: vi.fn(() => null) },
      cancel: nativeCancel,
    });
    const operation = adapter.runAction(session, { kind: "genuine" });

    expect(() =>
      operation.stream.subscribe({
        next: vi.fn(),
        error: vi.fn(),
        complete: vi.fn(),
      }),
    ).toThrow("invalid subscription");
    expect(nativeCancel).toHaveBeenCalledOnce();
  });

  it("cancels once, unsubscribes once, and ignores adversarial late states", async () => {
    const harness = await makeActionHarness("genuine");

    harness.operation.cancel();
    harness.operation.cancel();
    harness.subscription.unsubscribe();
    harness.subscription.unsubscribe();
    harness.source.next({
      status: DeviceActionStatus.Completed,
      output: { isGenuine: true },
    });
    harness.source.error(new Error("late private error"));
    harness.source.complete();

    expect(harness.nativeCancel).toHaveBeenCalledOnce();
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.states).toEqual([]);
    expect(harness.observer.error).not.toHaveBeenCalled();
    expect(harness.observer.complete).not.toHaveBeenCalled();
    expect(harness.subscription.closed).toBe(true);
  });

  it("fails closed when a native closed getter throws and contains teardown failures", async () => {
    const { adapter, runtime, session } = await makeConnectedAdapter();
    const closedGetter = vi.fn(() => {
      throw new Error("private-closed-canary");
    });
    const unsubscribe = vi.fn(() => {
      throw new Error("private-unsubscribe-canary");
    });
    const nativeCancel = vi.fn(() => {
      throw new Error("private-cancel-canary");
    });
    runtime.executeDeviceAction.mockReturnValue({
      observable: {
        subscribe: vi.fn(() => ({
          get closed() {
            return closedGetter();
          },
          unsubscribe,
        })),
      },
      cancel: nativeCancel,
    });
    const operation = adapter.runAction(session, { kind: "genuine" });
    const subscription = operation.stream.subscribe({
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    });

    expect(subscription.closed).toBe(true);
    expect(closedGetter).toHaveBeenCalledOnce();
    expect(nativeCancel).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(() => subscription.unsubscribe()).not.toThrow();
    operation.cancel();
    expect(nativeCancel).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("cancels before subscription without touching the native observable", async () => {
    const { adapter, runtime, session } = await makeConnectedAdapter();
    const source = nativeStream<unknown>();
    const nativeCancel = vi.fn();
    runtime.executeDeviceAction.mockReturnValue({
      observable: source.stream,
      cancel: nativeCancel,
    });
    const operation = adapter.runAction(session, { kind: "genuine" });

    operation.cancel();
    operation.cancel();
    const subscription = operation.stream.subscribe({
      next: vi.fn(),
      error: vi.fn(),
      complete: vi.fn(),
    });

    expect(nativeCancel).toHaveBeenCalledOnce();
    expect(source.stream.subscribe).not.toHaveBeenCalled();
    expect(subscription.closed).toBe(true);
  });

  it.each([
    ["missing", {}],
    ["string", { isGenuine: "true" }],
    ["number", { isGenuine: 1 }],
    ["null", { isGenuine: null }],
    [
      "callable",
      Object.assign(() => undefined, { isGenuine: true }),
    ],
  ])("fails closed for %s genuine output", async (_label, output) => {
    const harness = await makeActionHarness("genuine");

    harness.source.next({ status: DeviceActionStatus.Completed, output });

    expectFailedClosedState(harness.states);
    expect(harness.nativeCancel).toHaveBeenCalledOnce();
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
  });

  it("never executes accessors while rejecting malformed genuine evidence", async () => {
    const harness = await makeActionHarness("genuine");
    const getter = vi.fn(() => true);
    const output = {};
    Object.defineProperty(output, "isGenuine", {
      enumerable: true,
      get: getter,
    });

    harness.source.next({ status: DeviceActionStatus.Completed, output });

    expect(getter).not.toHaveBeenCalled();
    expectFailedClosedState(harness.states);
    expect(harness.nativeCancel).toHaveBeenCalledOnce();
  });

  it.each(["bitcoin", "Bitcoin ", " Bitcoin", "Bitcoin Test", "BITCOIN"])(
    "does not accept the lookalike app name %j",
    async (name) => {
      const harness = await makeActionHarness("list-bitcoin");

      harness.source.next({
        status: DeviceActionStatus.Completed,
        output: { installedApps: [installedApp(name)] },
      });

      expect(harness.states).toEqual([
        { status: "completed", output: { bitcoinPresent: false } },
      ]);
      expect(harness.nativeCancel).not.toHaveBeenCalled();
      expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
    },
  );

  it("matches exact Bitcoin and immediately discards the complete inventory", async () => {
    const harness = await makeActionHarness("list-bitcoin");
    const inventory = [
      installedApp("private-app-name-canary"),
      {
        flags: 8675309,
        hash: "private-bitcoin-hash-canary",
        hash_code_data: "private-bitcoin-code-hash-canary",
        name: "Bitcoin",
      },
      installedApp("another-private-app-canary"),
    ];

    harness.source.next({
      status: DeviceActionStatus.Completed,
      output: { installedApps: inventory },
    });

    expect(harness.states).toEqual([
      { status: "completed", output: { bitcoinPresent: true } },
    ]);
    const serialized = JSON.stringify(harness.states);
    expect(serialized).toBe(
      '[{"status":"completed","output":{"bitcoinPresent":true}}]',
    );
    expect(serialized).not.toContain("private-app-name-canary");
    expect(serialized).not.toContain("private-bitcoin-hash-canary");
    expect(serialized).not.toContain("8675309");
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
    expect(harness.nativeCancel).not.toHaveBeenCalled();
  });

  it("treats an empty native inventory as indeterminate and cancels", async () => {
    const harness = await makeActionHarness("list-bitcoin");

    harness.source.next({
      status: DeviceActionStatus.Completed,
      output: { installedApps: [] },
    });

    expectFailedClosedState(harness.states);
    if (harness.states[0]?.status !== "error") {
      throw new Error("Expected empty inventory to fail closed.");
    }
    expect(harness.states[0].rawError).toMatchObject({
      name: "IndeterminateInstalledAppsError",
      _tag: "IndeterminateInstalledAppsError",
    });
    expect(harness.nativeCancel).toHaveBeenCalledOnce();
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing array", {}],
    ["non-array", { installedApps: "private-inventory-canary" }],
    [
      "missing flags",
      { installedApps: [{ ...installedApp("Bitcoin"), flags: undefined }] },
    ],
    [
      "non-finite flags",
      { installedApps: [{ ...installedApp("Bitcoin"), flags: Number.NaN }] },
    ],
    [
      "missing hash",
      { installedApps: [{ ...installedApp("Bitcoin"), hash: undefined }] },
    ],
    [
      "missing code hash",
      {
        installedApps: [
          { ...installedApp("Bitcoin"), hash_code_data: undefined },
        ],
      },
    ],
    [
      "non-string name",
      { installedApps: [{ ...installedApp("Bitcoin"), name: 1 }] },
    ],
    [
      "callable app",
      { installedApps: [callableInstalledApp("Bitcoin")] },
    ],
    ["sparse inventory", { installedApps: new Array(1) }],
  ])("fails closed for malformed list output: %s", async (_label, output) => {
    const harness = await makeActionHarness("list-bitcoin");

    harness.source.next({ status: DeviceActionStatus.Completed, output });

    expectFailedClosedState(harness.states);
    expect(JSON.stringify(harness.states)).not.toContain(
      "private-inventory-canary",
    );
    expect(harness.nativeCancel).toHaveBeenCalledOnce();
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not invoke inventory accessors while failing closed", async () => {
    const harness = await makeActionHarness("list-bitcoin");
    const getter = vi.fn(() => [installedApp("Bitcoin")]);
    const output = {};
    Object.defineProperty(output, "installedApps", {
      enumerable: true,
      get: getter,
    });

    harness.source.next({ status: DeviceActionStatus.Completed, output });

    expect(getter).not.toHaveBeenCalled();
    expectFailedClosedState(harness.states);
    expect(harness.nativeCancel).toHaveBeenCalledOnce();
  });

  it("does not invoke installed-app field accessors while failing closed", async () => {
    const harness = await makeActionHarness("list-bitcoin");
    const getter = vi.fn(() => "Bitcoin");
    const app = {
      flags: 7,
      hash: "private-hash-canary",
      hash_code_data: "private-code-hash-canary",
    };
    Object.defineProperty(app, "name", {
      enumerable: true,
      get: getter,
    });

    harness.source.next({
      status: DeviceActionStatus.Completed,
      output: { installedApps: [app] },
    });

    expect(getter).not.toHaveBeenCalled();
    expectFailedClosedState(harness.states);
    expect(JSON.stringify(harness.states)).not.toContain("private-hash-canary");
    expect(harness.nativeCancel).toHaveBeenCalledOnce();
  });

  it("fails closed on proxy traps without copying or logging private evidence", async () => {
    const logSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
    ];
    try {
      const harness = await makeActionHarness("list-bitcoin");
      const state = new Proxy(
        {},
        {
          getOwnPropertyDescriptor: () => {
            throw new Error("private-proxy-canary");
          },
        },
      );

      harness.source.next(state);

      expectFailedClosedState(harness.states);
      expect(JSON.stringify(harness.states)).not.toContain(
        "private-proxy-canary",
      );
      expect(harness.nativeCancel).toHaveBeenCalledOnce();
      expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
      for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of logSpies) spy.mockRestore();
    }
  });

  it.each([
    ["unknown status", { status: "future-status" }],
    [
      "unknown interaction",
      {
        status: DeviceActionStatus.Pending,
        intermediateValue: { requiredUserInteraction: "future-interaction" },
      },
    ],
    [
      "missing interaction",
      { status: DeviceActionStatus.Pending, intermediateValue: {} },
    ],
    ["missing error", { status: DeviceActionStatus.Error }],
    ["missing output", { status: DeviceActionStatus.Completed }],
  ])("fails closed and cancels for %s", async (_label, state) => {
    const harness = await makeActionHarness("genuine");

    harness.source.next(state);

    expectFailedClosedState(harness.states);
    expect(harness.nativeCancel).toHaveBeenCalledOnce();
    expect(harness.source.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not execute state or interaction getters", async () => {
    const statusHarness = await makeActionHarness("genuine");
    const statusGetter = vi.fn(() => DeviceActionStatus.Completed);
    const state = {};
    Object.defineProperty(state, "status", {
      enumerable: true,
      get: statusGetter,
    });
    statusHarness.source.next(state);

    expect(statusGetter).not.toHaveBeenCalled();
    expectFailedClosedState(statusHarness.states);

    const interactionHarness = await makeActionHarness("genuine");
    const interactionGetter = vi.fn(() => UserInteractionRequired.None);
    const intermediateValue = {};
    Object.defineProperty(intermediateValue, "requiredUserInteraction", {
      enumerable: true,
      get: interactionGetter,
    });
    interactionHarness.source.next({
      status: DeviceActionStatus.Pending,
      intermediateValue,
    });

    expect(interactionGetter).not.toHaveBeenCalled();
    expectFailedClosedState(interactionHarness.states);
    expect(statusHarness.nativeCancel).toHaveBeenCalledOnce();
    expect(interactionHarness.nativeCancel).toHaveBeenCalledOnce();
  });
});
