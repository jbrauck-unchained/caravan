import type { BitcoinInstallerEvent } from "../events";

import { systemClock, type Clock, type ClockTimer } from "./clock";
import { DiscoveryBoundaryError } from "./discovery";
import type {
  DmkActionOperation,
  DmkActionState,
  DmkDiscoveredDevice,
  DmkObserver,
  DmkPort,
  DmkSession,
  DmkSubscription,
} from "./dmkPort";
import type { HidPort } from "./hidPort";
import {
  ReadOnlyPrepareOperation,
  type OperationTerminalPhase,
} from "./operation";
import { PlanStore } from "./planStore";
import {
  acquireRuntimeLease,
  resetRuntimeLeaseForTesting,
  type RuntimeLease,
} from "./runtimeLease";
import {
  GenuineLedgerSessionRequiredError,
  InactiveLedgerSessionError,
} from "./session";
import { createCandidateModelPolicyForTesting } from "./supportedModels";
import { ScriptedDmk } from "./testing/scriptedDmk";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "operation-coverage-device",
});
const rawSession: DmkSession = Object.freeze({
  internalSessionId: "operation-coverage-session",
  modelId: "nanoS",
});
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

function queuePreparation(
  fake: ScriptedDmk,
  bitcoinPresent: boolean,
): ScriptedDmk {
  return fake
    .queueDiscovery([{ type: "next", value: device }])
    .queueConnect({ type: "resolve", value: rawSession })
    .queueSessionLifecycle([{ type: "never" }])
    .queueAction("genuine", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { isGenuine: true },
        },
      },
    ])
    .queueAction("list-bitcoin", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { bitcoinPresent },
        },
      },
    ]);
}

interface HarnessOptions {
  readonly acquireLease?: () => RuntimeLease;
  readonly clock?: Clock;
  readonly createHidPort?: () => HidPort;
  readonly createPort?: () => DmkPort;
  readonly getSupport?: () => { readonly supported: boolean };
  readonly onEvent?: (event: BitcoinInstallerEvent) => void;
  readonly planStore?: PlanStore;
  readonly planTtlMs?: number;
}

function createHarness(
  fake: ScriptedDmk,
  options: HarnessOptions = {},
): {
  readonly events: BitcoinInstallerEvent[];
  readonly onTerminal: ReturnType<typeof vi.fn>;
  readonly operation: ReadOnlyPrepareOperation;
} {
  const clock = options.clock ?? systemClock;
  const events: BitcoinInstallerEvent[] = [];
  const onTerminal =
    vi.fn<
      (
        operation: ReadOnlyPrepareOperation,
        phase: OperationTerminalPhase,
      ) => void
    >();
  const operation = new ReadOnlyPrepareOperation({
    acquireLease: options.acquireLease ?? acquireRuntimeLease,
    clock,
    createHidPort:
      options.createHidPort ??
      (() => {
        throw new Error("HID unavailable in coverage harness");
      }),
    createPort: options.createPort ?? (() => fake),
    getSupport: options.getSupport ?? (() => ({ supported: true })),
    instanceGeneration: 801,
    modelPolicy: candidatePolicy,
    onEvent: (event) => {
      events.push(event);
      options.onEvent?.(event);
    },
    onTerminal,
    planStore: options.planStore ?? new PlanStore(clock),
    planTtlMs: options.planTtlMs ?? 1_000,
  });
  return { events, onTerminal, operation };
}

function actionKinds(fake: ScriptedDmk): string[] {
  return fake.calls
    .filter((call) => call.type === "run-action")
    .map((call) => call.action?.kind ?? "missing");
}

interface LifecycleControl {
  complete(): void;
}

function interceptLifecycle(fake: ScriptedDmk): LifecycleControl {
  let observer: DmkObserver<never> | undefined;
  vi.spyOn(fake, "observeSessionLifecycle").mockImplementation(() => ({
    subscribe(nextObserver): DmkSubscription {
      observer = nextObserver;
      let closed = false;
      return {
        get closed() {
          return closed;
        },
        unsubscribe: () => {
          closed = true;
        },
      };
    },
  }));
  return {
    complete: () => observer?.complete(),
  };
}

function inertHidPort(onRead: () => void = () => undefined): HidPort {
  return {
    getGrantedDevices: () => {
      onRead();
      return Promise.resolve(Object.freeze([]));
    },
    subscribeToDeviceChanges: () => () => undefined,
  };
}

interface ControlledInstallOptions {
  readonly dispatchStarted: () => unknown;
  readonly state?: DmkActionState<"install-bitcoin">;
  readonly cancel?: () => void;
}

function controlledInstallOperation(
  options: ControlledInstallOptions,
): DmkActionOperation<"install-bitcoin"> {
  return {
    stream: {
      subscribe(observer): DmkSubscription {
        if (options.state) observer.next(options.state);
        return {
          closed: options.state !== undefined,
          unsubscribe: () => undefined,
        };
      },
    },
    cancel: options.cancel ?? (() => undefined),
    dispatchStarted: options.dispatchStarted as () => boolean,
    mutationAttempted: () => false,
  };
}

function overrideInstallAction(
  fake: ScriptedDmk,
  createOperation: () => DmkActionOperation<"install-bitcoin">,
): void {
  const delegated = fake.runAction.bind(fake) as DmkPort["runAction"];
  vi.spyOn(fake, "runAction").mockImplementation(((session, action) =>
    action.kind === "install-bitcoin"
      ? createOperation()
      : delegated(session, action)) as DmkPort["runAction"]);
}

describe("operation public and host-boundary coverage", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
  });

  it("keeps cancel inert after success and makes completed disposal idempotent", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      true,
    ).queueAction("open-bitcoin", [
      {
        type: "next",
        value: { status: "completed", output: { appOpened: true } },
      },
    ]);
    const { operation, onTerminal } = createHarness(fake);
    const plan = await operation.begin();

    await expect(operation.install(plan)).resolves.toMatchObject({
      status: "already-installed",
      appOpen: true,
    });
    await operation.cancel();
    await operation.dispose();
    await operation.dispose();

    expect(operation.phase).toBe("disposed");
    expect(onTerminal).toHaveBeenLastCalledWith(operation, "disposed");
  });

  it("stops after createPort reentrantly cancels the operation", async () => {
    const fake = new ScriptedDmk(systemClock);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createHarness(fake, {
      createPort: () => {
        void operationRef.current?.cancel();
        return fake;
      },
    });
    operationRef.current = harness.operation;

    await expect(harness.operation.begin()).rejects.toMatchObject({
      code: "cancelled",
      phase: "idle",
    });
    expect(fake.calls).toEqual([]);
  });

  it("contains cancellation reentered by the port capability probe", async () => {
    const fake = new ScriptedDmk(systemClock);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    vi.spyOn(fake, "isEnvironmentSupported").mockImplementation(() => {
      void operationRef.current?.cancel();
      return true;
    });
    const harness = createHarness(fake);
    operationRef.current = harness.operation;

    await expect(harness.operation.begin()).rejects.toMatchObject({
      code: "cancelled",
      phase: "idle",
    });
  });

  it("rejects a runtime port that reports unsupported before discovery", async () => {
    const fake = new ScriptedDmk(systemClock, false);
    const { operation } = createHarness(fake);

    await expect(operation.begin()).rejects.toMatchObject({
      code: "unsupported-environment",
      phase: "idle",
    });
    expect(fake.calls.map(({ type }) => type)).toEqual(["environment-support"]);
  });

  it("contains cancellation reentered while the HID port is being created", async () => {
    const fake = new ScriptedDmk(systemClock);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createHarness(fake, {
      createHidPort: () => {
        void operationRef.current?.cancel();
        return inertHidPort();
      },
    });
    operationRef.current = harness.operation;

    await expect(harness.operation.begin()).rejects.toMatchObject({
      code: "cancelled",
      phase: "idle",
    });
  });

  it("cancels a pre-connect HID capture whose synchronous read retires the operation", async () => {
    const fake = new ScriptedDmk(systemClock);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createHarness(fake, {
      createHidPort: () =>
        inertHidPort(() => {
          void operationRef.current?.cancel();
        }),
    });
    operationRef.current = harness.operation;

    await expect(harness.operation.begin()).rejects.toMatchObject({
      code: "cancelled",
      phase: "idle",
    });
  });

  it("maps discovery completion without selection to its closed public error", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "complete" },
    ]);
    const { operation } = createHarness(fake);

    await expect(operation.begin()).rejects.toMatchObject({
      code: "no-device-selected",
      phase: "selecting-device",
    });
  });

  it("maps a discovery-boundary cancellation thrown during setup", async () => {
    const fake = new ScriptedDmk(systemClock);
    vi.spyOn(fake, "startDiscovery").mockImplementation(() => {
      throw new DiscoveryBoundaryError("cancelled");
    });
    const { operation } = createHarness(fake);

    await expect(operation.begin()).rejects.toMatchObject({
      code: "cancelled",
      phase: "selecting-device",
    });
    expect(operation.phase).toBe("failed");
  });

  it("ignores a selected discovery result after immediate caller cancellation", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "next", value: device },
    ]);
    const { operation } = createHarness(fake);

    const preparation = operation.begin();
    await operation.cancel();

    await expect(preparation).rejects.toMatchObject({
      code: "cancelled",
      phase: "selecting-device",
    });
    expect(fake.resources().connectCount).toBe(0);
  });

  it("contains an ordinary plan-store failure at the install boundary", async () => {
    const store = new PlanStore(systemClock);
    const fake = queuePreparation(new ScriptedDmk(systemClock), false);
    const { operation } = createHarness(fake, { planStore: store });
    const plan = await operation.begin();
    vi.spyOn(store, "consume").mockImplementation(() => {
      throw new Error("store-canary");
    });

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "ready-to-install",
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
  });

  it("does not continue after plan consumption reentrantly cancels", async () => {
    const store = new PlanStore(systemClock);
    const fake = queuePreparation(new ScriptedDmk(systemClock), false);
    const { operation } = createHarness(fake, { planStore: store });
    const plan = await operation.begin();
    vi.spyOn(store, "consume").mockImplementation(() => {
      void operation.cancel();
      return { valid: true, status: "installation-required" };
    });

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "cancelled",
      phase: "ready-to-install",
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
  });

  it("checks a ready plan before rejecting the unavailable continuation", async () => {
    const store = new PlanStore(systemClock);
    const fake = queuePreparation(new ScriptedDmk(systemClock), true);
    const { operation } = createHarness(fake, { planStore: store });
    const plan = await operation.begin();
    const check = vi.spyOn(store, "check");

    await expect(operation.rejectInstall(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "ready-to-install",
    });
    expect(check).toHaveBeenCalledOnce();
  });

  it("rejects an unavailable continuation before preparation without reading a plan", async () => {
    const store = new PlanStore(systemClock);
    const fake = new ScriptedDmk(systemClock);
    const { operation } = createHarness(fake, { planStore: store });
    const check = vi.spyOn(store, "check");

    await expect(
      operation.rejectInstall(Object.freeze({})),
    ).rejects.toMatchObject({ code: "internal", phase: "idle" });
    expect(check).not.toHaveBeenCalled();
  });

  it("ignores a retained plan-expiry callback after completed installation", async () => {
    let expiryCallback: (() => void) | undefined;
    const clock: Clock = {
      now: () => 1_000,
      monotonicNow: () => 1_000,
      setTimeout: (callback, delayMs) => {
        if (delayMs === 137) expiryCallback = callback;
        return Object.freeze({}) as ClockTimer;
      },
      clearTimeout: () => undefined,
    };
    const fake = queuePreparation(new ScriptedDmk(clock), true).queueAction(
      "open-bitcoin",
      [
        {
          type: "next",
          value: { status: "completed", output: { appOpened: true } },
        },
      ],
    );
    const { operation } = createHarness(fake, {
      clock,
      planTtlMs: 137,
    });
    const plan = await operation.begin();
    await operation.install(plan);

    expect(expiryCallback).toBeTypeOf("function");
    expiryCallback?.();

    expect(operation.phase).toBe("ready-for-webusb");
  });
});

describe("operation session-loss coverage", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
  });

  it("fails safely when the session ends at the installing transition before dispatch", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false);
    const lifecycle = interceptLifecycle(fake);
    const harness = createHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "installing") lifecycle.complete();
      },
    });
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).rejects.toMatchObject({
      code: "device-disconnected",
      phase: "installing",
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
    expect(harness.operation.phase).toBe("failed");
  });

  it("requires recovery when the session ends after install dispatch", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      false,
    ).queueAction("install-bitcoin", [
      { type: "attempt-install-mutation" },
      { type: "never" },
    ]);
    const lifecycle = interceptLifecycle(fake);
    const { operation } = createHarness(fake);
    const plan = await operation.begin();
    const installation = operation.install(plan);
    await Promise.resolve();

    lifecycle.complete();

    await expect(installation).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
    });
    expect(operation.phase).toBe("needs-recovery");
  });

  it("requires recovery when the session ends during fresh verification", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false)
      .queueAction("install-bitcoin", [
        { type: "attempt-install-mutation" },
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ])
      .queueAction("list-bitcoin", [{ type: "never" }]);
    const lifecycle = interceptLifecycle(fake);
    const harness = createHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "verifying") lifecycle.complete();
      },
    });
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
    });
    expect(harness.operation.phase).toBe("needs-recovery");
  });

  it("reduces session loss during opening to appOpen false", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), true);
    const lifecycle = interceptLifecycle(fake);
    const harness = createHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "opening-bitcoin") lifecycle.complete();
      },
    });
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).resolves.toMatchObject({
      status: "already-installed",
      appOpen: false,
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
  });

  it("does not overwrite proven success when the session ends during release", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      true,
    ).queueAction("open-bitcoin", [
      {
        type: "next",
        value: { status: "completed", output: { appOpened: true } },
      },
    ]);
    const lifecycle = interceptLifecycle(fake);
    const harness = createHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "releasing-device") lifecycle.complete();
      },
    });
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).resolves.toMatchObject({
      status: "already-installed",
      appOpen: true,
    });
    expect(harness.operation.phase).toBe("ready-for-webusb");
  });
});

describe("operation dispatch and watchdog coverage", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
  });

  it.each([
    [
      "inactive session",
      new InactiveLedgerSessionError(),
      "device-disconnected",
    ],
    [
      "missing genuine authority",
      new GenuineLedgerSessionRequiredError(),
      "internal",
    ],
  ] as const)(
    "maps an %s setup failure without leaking it",
    async (_label, error, code) => {
      const fake = new ScriptedDmk(systemClock);
      const { operation } = createHarness(fake, {
        createPort: () => {
          throw error;
        },
      });

      await expect(operation.begin()).rejects.toMatchObject({
        code,
        phase: "idle",
      });
    },
  );

  it.each(["cancel", "dispose"] as const)(
    "%s wins while native install dispatch still reports exact false",
    async (method) => {
      const fake = queuePreparation(new ScriptedDmk(systemClock), false);
      const operationRef: { current?: ReadOnlyPrepareOperation } = {};
      const nativeCancel = vi.fn();
      overrideInstallAction(fake, () => {
        void operationRef.current?.[method]();
        return controlledInstallOperation({
          dispatchStarted: () => false,
          cancel: nativeCancel,
        });
      });
      const { operation } = createHarness(fake);
      operationRef.current = operation;
      const plan = await operation.begin();

      await expect(operation.install(plan)).rejects.toMatchObject({
        code: "cancelled",
        phase: "installing",
      });
      expect(operation.phase).toBe(
        method === "dispose" ? "disposed" : "cancelled",
      );
      expect(nativeCancel).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["unknown", () => undefined],
    [
      "throwing",
      () => {
        throw new Error("dispatch-evidence-canary");
      },
    ],
  ] as const)(
    "treats %s dispatch evidence as mutation-ambiguous",
    async (_label, evidence) => {
      const fake = queuePreparation(new ScriptedDmk(systemClock), false);
      overrideInstallAction(fake, () =>
        controlledInstallOperation({ dispatchStarted: evidence }),
      );
      const { operation } = createHarness(fake);
      const plan = await operation.begin();
      const installation = operation.install(plan);
      await Promise.resolve();

      await operation.cancel();

      await expect(installation).rejects.toMatchObject({
        code: "state-unknown",
        phase: "installing",
      });
      expect(operation.phase).toBe("needs-recovery");
    },
  );

  it("reconciles contradictory negative dispatch evidence with fresh presence proof", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false)
      .queueAction("list-bitcoin", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
        },
      ])
      .queueAction("open-bitcoin", [
        {
          type: "next",
          value: { status: "completed", output: { appOpened: true } },
        },
      ]);
    overrideInstallAction(fake, () =>
      controlledInstallOperation({
        dispatchStarted: () => false,
        state: {
          status: "completed",
          output: { actionCompleted: true },
        },
      }),
    );
    const { operation } = createHarness(fake);
    const plan = await operation.begin();

    await expect(operation.install(plan)).resolves.toMatchObject({
      status: "already-installed",
      appOpen: true,
    });
    expect(operation.phase).toBe("ready-for-webusb");
  });

  it("makes disposal from verification absorbing", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false)
      .queueAction("install-bitcoin", [
        { type: "attempt-install-mutation" },
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ])
      .queueAction("list-bitcoin", [{ type: "never" }]);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "verifying") {
          void operationRef.current?.dispose();
        }
      },
    });
    operationRef.current = harness.operation;
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
    });
    expect(harness.operation.phase).toBe("disposed");
  });

  it("preserves disposition when open setup fails before native work exists", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), true);
    const { operation } = createHarness(fake);
    const plan = await operation.begin();

    await expect(operation.install(plan)).resolves.toMatchObject({
      status: "already-installed",
      appOpen: false,
    });
    expect(operation.phase).toBe("ready-for-webusb");
  });

  it("cancels an open handle created after synchronous disposal", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      true,
    ).queueAction("open-bitcoin", [
      {
        type: "next",
        value: {
          status: "pending",
          interaction: "confirm-open-app",
        } as never,
      },
      { type: "never" },
    ]);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createHarness(fake, {
      onEvent: (event) => {
        if (event.interaction === "confirm-open-bitcoin") {
          void operationRef.current?.dispose();
        }
      },
    });
    operationRef.current = harness.operation;
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).rejects.toMatchObject({
      code: "cancelled",
      phase: "opening-bitcoin",
    });
    expect(harness.operation.phase).toBe("disposed");
  });

  it("does not dispatch open after disposal reenters its transition", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), true);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "opening-bitcoin") {
          void operationRef.current?.dispose();
        }
      },
    });
    operationRef.current = harness.operation;
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).rejects.toMatchObject({
      code: "cancelled",
      phase: "opening-bitcoin",
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
  });

  it("does not open after verified installation when disposal reenters the transition", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false)
      .queueAction("install-bitcoin", [
        { type: "attempt-install-mutation" },
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ])
      .queueAction("list-bitcoin", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
        },
      ]);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "opening-bitcoin") {
          void operationRef.current?.dispose();
        }
      },
    });
    operationRef.current = harness.operation;
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).rejects.toMatchObject({
      code: "cancelled",
      phase: "opening-bitcoin",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
      "list-bitcoin",
    ]);
  });

  it("fails closed when a widened plan-store status reaches dispatch", async () => {
    const store = new PlanStore(systemClock);
    const fake = queuePreparation(new ScriptedDmk(systemClock), false);
    const { operation } = createHarness(fake, { planStore: store });
    const plan = await operation.begin();
    vi.spyOn(store, "consume").mockImplementation(
      () => ({ valid: true, status: "future-status" }) as never,
    );

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "ready-to-install",
    });
    expect(operation.phase).toBe("failed");
  });

  it("contains lost runtime authority between plan consumption and open", async () => {
    const store = new PlanStore(systemClock);
    const fake = queuePreparation(new ScriptedDmk(systemClock), true);
    const { operation } = createHarness(fake, { planStore: store });
    const plan = await operation.begin();
    vi.spyOn(store, "consume").mockImplementation(() => {
      resetRuntimeLeaseForTesting();
      return { valid: true, status: "already-installed" };
    });

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "device-disconnected",
      phase: "ready-to-install",
    });
    expect(operation.phase).toBe("failed");
  });

  it("contains a synchronously firing discovery watchdog", async () => {
    const timer = Object.freeze({}) as ClockTimer;
    const clock: Clock = {
      now: () => 0,
      monotonicNow: () => 0,
      setTimeout: (callback) => {
        callback();
        return timer;
      },
      clearTimeout: () => undefined,
    };
    const fake = new ScriptedDmk(clock);
    const { operation } = createHarness(fake, { clock });

    await expect(operation.begin()).rejects.toMatchObject({
      code: "operation-timeout",
      phase: "selecting-device",
    });
    expect(operation.phase).toBe("failed");
  });

  it("ignores a retained watchdog callback after the stage advances", async () => {
    const callbacks: Array<() => void> = [];
    const clock: Clock = {
      now: () => 0,
      monotonicNow: () => 0,
      setTimeout: (callback) => {
        callbacks.push(callback);
        return Object.freeze({}) as ClockTimer;
      },
      clearTimeout: () => undefined,
    };
    const fake = queuePreparation(new ScriptedDmk(clock), false);
    const { operation } = createHarness(fake, { clock });

    await operation.begin();
    const firstWatchdog = callbacks[0];
    expect(firstWatchdog).toBeTypeOf("function");
    firstWatchdog?.();

    expect(operation.phase).toBe("ready-to-install");
  });
});
