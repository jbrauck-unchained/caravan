import type { BitcoinInstallerEvent } from "../events";
import { createBitcoinAppInstallerCore } from "../installer";
import type { BitcoinInstallPlan } from "../types";

import { systemClock, type Clock, type ClockTimer } from "./clock";
import type { DmkDiscoveredDevice, DmkSession } from "./dmkPort";
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
import { createCandidateModelPolicyForTesting } from "./supportedModels";
import { ScriptedDmk } from "./testing/scriptedDmk";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "operation-race-device",
});
const session: DmkSession = Object.freeze({
  internalSessionId: "operation-race-session",
  modelId: "nanoS",
});
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

function queuePreparation(
  fake: ScriptedDmk,
  bitcoinPresent: boolean,
): ScriptedDmk {
  return fake
    .queueDiscovery([{ type: "next", value: device }])
    .queueConnect({ type: "resolve", value: session })
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

interface OperationHarness {
  readonly events: BitcoinInstallerEvent[];
  readonly onTerminal: ReturnType<typeof vi.fn>;
  readonly operation: ReadOnlyPrepareOperation;
}

function createOperationHarness(
  fake: ScriptedDmk,
  options: {
    readonly clock?: Clock;
    readonly instanceGeneration?: number;
    readonly onEvent?: (event: BitcoinInstallerEvent) => void;
    readonly planStore?: PlanStore;
    readonly planTtlMs?: number;
  } = {},
): OperationHarness {
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
    acquireLease: acquireRuntimeLease,
    clock,
    createPort: () => fake,
    getSupport: () => ({ supported: true }),
    instanceGeneration: options.instanceGeneration ?? 41,
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

describe("read-only operation races", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
  });

  afterEach(() => {
    resetRuntimeLeaseForTesting();
  });

  it("stops before genuine dispatch when the reserved lease dies just before invalidation registration", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session })
      .queueSessionLifecycle([{ type: "never" }]);
    let currentChecks = 0;
    const lease: RuntimeLease = {
      generation: 7,
      isCurrent: () => {
        currentChecks += 1;
        return currentChecks === 1;
      },
      invalidate: vi.fn(),
      release: vi.fn(),
    };
    const installer = createBitcoinAppInstallerCore({
      acquireLease: () => lease,
      clock: systemClock,
      createPort: () => fake,
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });
    const phases: string[] = [];
    installer.subscribe((event) => phases.push(event.phase));

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "device-disconnected",
      phase: "connecting",
    });
    expect(phases).toEqual(["selecting-device", "connecting", "failed"]);
    expect(fake.resources()).toMatchObject({
      actionCount: 0,
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it("does not let a reentrant selecting listener open a chooser after cancellation", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "never" },
    ]);
    const installer = createBitcoinAppInstallerCore({
      clock: systemClock,
      createPort: () => fake,
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });
    installer.subscribe((event) => {
      if (event.phase === "selecting-device") installer.cancel();
    });

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "cancelled",
      phase: "selecting-device",
    });
    expect(fake.resources()).toMatchObject({
      discoveryCount: 0,
      connectCount: 0,
      actionCount: 0,
    });
  });

  it("cancels discovery that reentrantly finalizes before its handle returns", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "never" },
    ]);
    const originalStartDiscovery = fake.startDiscovery.bind(fake);
    let competingLeaseBlocked = false;
    const installer = createBitcoinAppInstallerCore({
      clock: systemClock,
      createPort: () => fake,
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });
    vi.spyOn(fake, "startDiscovery").mockImplementation(() => {
      installer.cancel();
      try {
        const competingLease = acquireRuntimeLease();
        competingLease.release();
      } catch {
        competingLeaseBlocked = true;
      }
      return originalStartDiscovery();
    });

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "cancelled",
      phase: "selecting-device",
    });
    expect(fake.resources()).toMatchObject({
      discoveryCount: 1,
      connectCount: 0,
      cancelCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
    });
    expect(competingLeaseBlocked).toBe(true);
    const nextLease = acquireRuntimeLease();
    nextLease.release();
  });

  it("does not acquire a lease after a capability probe reentrantly cancels", async () => {
    const acquireLease = vi.fn(() => {
      throw new Error("lease acquisition must remain untouched");
    });
    const createPort = vi.fn(() => new ScriptedDmk(systemClock));
    const installer = createBitcoinAppInstallerCore({
      acquireLease,
      clock: systemClock,
      createPort,
      getSupport: () => {
        installer.cancel();
        return { supported: true };
      },
      modelPolicy: candidatePolicy,
    });
    const phases: string[] = [];
    installer.subscribe((event) => phases.push(event.phase));

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "cancelled",
      phase: "idle",
    });
    expect(phases).toEqual(["cancelled"]);
    expect(acquireLease).not.toHaveBeenCalled();
    expect(createPort).not.toHaveBeenCalled();
  });

  it("retires a lease returned after its acquisition reentrantly cancels", async () => {
    const lease: RuntimeLease = {
      generation: 7,
      isCurrent: vi.fn(() => true),
      invalidate: vi.fn(),
      release: vi.fn(),
    };
    const createPort = vi.fn(() => new ScriptedDmk(systemClock));
    const installer = createBitcoinAppInstallerCore({
      acquireLease: () => {
        installer.cancel();
        return lease;
      },
      clock: systemClock,
      createPort,
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "cancelled",
      phase: "idle",
    });
    expect(lease.invalidate).toHaveBeenCalledTimes(1);
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(createPort).not.toHaveBeenCalled();
  });

  it("latches connection setup before vendor code can reentrantly cancel", async () => {
    vi.useFakeTimers();
    try {
      const fake = new ScriptedDmk(systemClock)
        .queueDiscovery([{ type: "next", value: device }])
        .queueConnect({ type: "resolve", value: session, afterMs: 20 })
        .queueSessionLifecycle([{ type: "never" }]);
      const originalConnect = fake.connect.bind(fake);
      const installer = createBitcoinAppInstallerCore({
        clock: systemClock,
        createPort: () => fake,
        getSupport: () => ({ supported: true }),
        modelPolicy: candidatePolicy,
      });
      vi.spyOn(fake, "connect").mockImplementation((candidate) => {
        installer.cancel();
        return originalConnect(candidate);
      });

      const preparation = installer.prepare();
      await Promise.resolve();
      await Promise.resolve();
      let settled = false;
      void preparation.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await Promise.resolve();

      expect(settled).toBe(false);
      expect(() => acquireRuntimeLease()).toThrowError("already in use");

      await vi.advanceTimersByTimeAsync(20);
      await expect(preparation).rejects.toMatchObject({
        code: "cancelled",
        phase: "connecting",
      });
      expect(fake.resources()).toMatchObject({
        connectCount: 1,
        disconnectCount: 1,
        activeSubscriptions: 0,
      });
      const nextLease = acquireRuntimeLease();
      nextLease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not disconnect inside a synchronous pending-action listener", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "pending",
            interaction: "unlock-device",
          },
        },
        { type: "never" },
      ]);
    const originalDisconnect = fake.disconnect.bind(fake);
    let insidePendingListener = false;
    let disconnectedInsidePendingListener = false;
    vi.spyOn(fake, "disconnect").mockImplementation((candidate) => {
      if (insidePendingListener) disconnectedInsidePendingListener = true;
      return originalDisconnect(candidate);
    });
    const installer = createBitcoinAppInstallerCore({
      clock: systemClock,
      createPort: () => fake,
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });
    installer.subscribe((event) => {
      if (event.interaction !== "unlock-device") return;
      insidePendingListener = true;
      installer.cancel();
      insidePendingListener = false;
    });

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "cancelled",
      phase: "checking-genuine",
    });
    expect(disconnectedInsidePendingListener).toBe(false);
    expect(fake.resources()).toMatchObject({
      actionCount: 1,
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
    expect(
      fake.calls.filter(
        (call) => call.type === "cancel" && call.source === "action",
      ),
    ).toHaveLength(1);
  });

  it("settles a source-internal idle cancellation without touching runtime dependencies", async () => {
    const acquireLease = vi.fn(() => {
      throw new Error("lease must remain untouched");
    });
    const createPort = vi.fn(() => new ScriptedDmk(systemClock));
    const phases: string[] = [];
    const operation = new ReadOnlyPrepareOperation({
      acquireLease,
      clock: systemClock,
      createPort,
      getSupport: () => ({ supported: true }),
      instanceGeneration: 1,
      modelPolicy: candidatePolicy,
      onEvent: (event) => phases.push(event.phase),
      onTerminal: vi.fn(),
      planStore: new PlanStore(systemClock),
      planTtlMs: 100,
    });

    await operation.cancel();
    await expect(operation.begin()).rejects.toMatchObject({
      code: "cancelled",
      phase: "idle",
    });
    expect(phases).toEqual(["cancelled"]);
    expect(acquireLease).not.toHaveBeenCalled();
    expect(createPort).not.toHaveBeenCalled();
  });
});

describe("mutation operation orchestration", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetRuntimeLeaseForTesting();
  });

  it("consumes an installation-required plan before one install, fresh verification, open, and release", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false)
      .queueAction("install-bitcoin", [
        { type: "attempt-install-mutation" },
        {
          type: "next",
          value: { status: "pending", progress: 1 },
        },
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
      ])
      .queueAction("open-bitcoin", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { appOpened: true },
          },
        },
      ]);
    const harness = createOperationHarness(fake);
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).resolves.toEqual({
      status: "installed",
      appOpen: true,
      handoff: "reconnect-required",
    });

    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
      "list-bitcoin",
      "open-bitcoin",
    ]);
    expect(harness.events.map(({ phase }) => phase)).toEqual([
      "selecting-device",
      "connecting",
      "checking-genuine",
      "checking-bitcoin-app",
      "ready-to-install",
      "installing",
      "installing",
      "verifying",
      "opening-bitcoin",
      "releasing-device",
      "ready-for-webusb",
    ]);
    expect(harness.events[6]).toEqual({
      phase: "installing",
      progress: 100,
    });
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
    expect(harness.onTerminal).toHaveBeenCalledWith(
      harness.operation,
      "ready-for-webusb",
    );
  });

  it("uses the stored already-installed branch without installing or relisting", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      true,
    ).queueAction("open-bitcoin", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { appOpened: true },
        },
      },
    ]);
    const harness = createOperationHarness(fake);
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "reconnect-required",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "open-bitcoin",
    ]);
    expect(harness.events.map(({ phase }) => phase).slice(-3)).toEqual([
      "opening-bitcoin",
      "releasing-device",
      "ready-for-webusb",
    ]);
  });

  it("requires fresh presence after the reviewed already-installed race and preserves an open refusal", async () => {
    const canary = "private-raced-app-error";
    const fake = queuePreparation(new ScriptedDmk(systemClock), false)
      .queueAction("install-bitcoin", [
        {
          type: "next",
          value: {
            status: "error",
            rawError: {
              _tag: "AppAlreadyInstalledDAError",
              message: canary,
            },
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
      ])
      .queueAction("open-bitcoin", [
        {
          type: "next",
          value: {
            status: "error",
            rawError: { _tag: "ActionRefusedError", message: canary },
          },
        },
      ]);
    const harness = createOperationHarness(fake);
    const plan = await harness.operation.begin();
    const result = await harness.operation.install(plan);

    expect(result).toEqual({
      status: "already-installed",
      appOpen: false,
      handoff: "reconnect-required",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
      "list-bitcoin",
      "open-bitcoin",
    ]);
    expect(JSON.stringify({ result, events: harness.events })).not.toContain(
      canary,
    );
  });

  it("retains reviewed insufficient-space while requiring recovery and redacts vendor data", async () => {
    const canary = "private-out-of-memory-catalog";
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      false,
    ).queueAction("install-bitcoin", [
      {
        type: "next",
        value: {
          status: "error",
          rawError: {
            _tag: "OutOfMemoryDAError",
            message: canary,
            catalog: canary,
          },
        },
      },
    ]);
    const harness = createOperationHarness(fake);
    const plan = await harness.operation.begin();

    const error = await harness.operation.install(plan).catch((value) => value);
    expect(error).toMatchObject({
      code: "insufficient-space",
      phase: "installing",
      recoverable: true,
    });
    expect(harness.operation.phase).toBe("needs-recovery");
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
    ]);
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(error.stack ?? "").not.toContain(canary);
    await harness.operation.cancel();
    expect(harness.operation.phase).toBe("needs-recovery");
    expect(harness.onTerminal).toHaveBeenCalledWith(
      harness.operation,
      "needs-recovery",
    );
  });

  it.each(["absent", "error"] as const)(
    "requires recovery when fresh verification is %s",
    async (terminal) => {
      const canary = "private-verification-inventory";
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
          terminal === "absent"
            ? {
                type: "next",
                value: {
                  status: "completed",
                  output: { bitcoinPresent: false },
                },
              }
            : {
                type: "next",
                value: {
                  status: "error",
                  rawError: { message: canary, inventory: canary },
                },
              },
        ]);
      const harness = createOperationHarness(fake);
      const plan = await harness.operation.begin();

      const error = await harness.operation
        .install(plan)
        .catch((value) => value);
      expect(error).toMatchObject({
        code: "state-unknown",
        phase: "verifying",
      });
      expect(harness.operation.phase).toBe("needs-recovery");
      expect(actionKinds(fake)).toEqual([
        "genuine",
        "list-bitcoin",
        "install-bitcoin",
        "list-bitcoin",
      ]);
      expect(JSON.stringify(error)).not.toContain(canary);
    },
  );

  it.each([
    ["forged", { status: "installation-required" }],
    ["serialized", JSON.parse('{"status":"installation-required"}')],
  ] as const)(
    "rejects a %s plan before any continuation action",
    async (_name, candidate) => {
      const fake = queuePreparation(new ScriptedDmk(systemClock), false);
      const harness = createOperationHarness(fake);
      await harness.operation.begin();

      await expect(
        harness.operation.install(candidate as BitcoinInstallPlan),
      ).rejects.toMatchObject({
        code: "internal",
        phase: "ready-to-install",
        recoverable: false,
      });
      expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
      expect(harness.operation.phase).toBe("failed");
      expect(fake.resources().disconnectCount).toBe(1);
    },
  );

  it("rejects a foreign store plan and revokes the local plan without dispatch", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false);
    const harness = createOperationHarness(fake);
    await harness.operation.begin();
    const foreignStore = new PlanStore(systemClock);
    const foreign = foreignStore.mint({
      instanceGeneration: 41,
      sessionGeneration: 1,
      status: "installation-required",
      ttlMs: 1_000,
    });

    await expect(harness.operation.install(foreign)).rejects.toMatchObject({
      code: "internal",
      phase: "ready-to-install",
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
  });

  it("latches the first install before a transition listener can replay it", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      false,
    ).queueAction("install-bitcoin", [{ type: "never" }]);
    const reentry: {
      plan?: BitcoinInstallPlan;
      nested?: Promise<unknown>;
      operation?: ReadOnlyPrepareOperation;
    } = {};
    const harness = createOperationHarness(fake, {
      onEvent: (event) => {
        if (
          event.phase === "installing" &&
          reentry.plan &&
          reentry.operation &&
          !reentry.nested
        ) {
          reentry.nested = reentry.operation.install(reentry.plan);
          void reentry.nested.catch(() => undefined);
        }
      },
    });
    const operation = harness.operation;
    reentry.operation = operation;
    const plan = await operation.begin();
    reentry.plan = plan;
    const primary = operation.install(plan);

    await expect(reentry.nested).rejects.toMatchObject({
      code: "internal",
      phase: "installing",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
    ]);
    await operation.cancel();
    await expect(primary).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
    });
    expect(
      fake.calls.filter(
        (call) => call.type === "cancel" && call.source === "action",
      ),
    ).toHaveLength(1);
  });

  it("cancels safely from the installing transition before native dispatch", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createOperationHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "installing") {
          void operationRef.current?.cancel();
        }
      },
    });
    const operation = harness.operation;
    operationRef.current = operation;
    const plan = await operation.begin();

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "cancelled",
      phase: "installing",
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
    expect(operation.phase).toBe("cancelled");
    expect(fake.resources().disconnectCount).toBe(1);
  });

  it("disposes safely from the installing transition before native dispatch", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createOperationHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "installing") {
          void operationRef.current?.dispose();
        }
      },
    });
    const operation = harness.operation;
    operationRef.current = operation;
    const plan = await operation.begin();

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "cancelled",
      phase: "installing",
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
    expect(operation.phase).toBe("disposed");
    expect(fake.resources().disconnectCount).toBe(1);
  });

  it("fails safely when native install setup throws before dispatch", async () => {
    const canary = "private-install-setup-failure";
    const fake = queuePreparation(new ScriptedDmk(systemClock), false);
    const originalRunAction = fake.runAction.bind(fake);
    vi.spyOn(fake, "runAction").mockImplementation(((ownedSession, action) => {
      if (action.kind === "install-bitcoin") {
        throw new Error(canary);
      }
      return originalRunAction(ownedSession, action as never);
    }) as typeof fake.runAction);
    const harness = createOperationHarness(fake);
    const plan = await harness.operation.begin();

    const error = await harness.operation.install(plan).catch((value) => value);

    expect(error).toMatchObject({
      code: "internal",
      phase: "installing",
      recoverable: false,
    });
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(error.stack ?? "").not.toContain(canary);
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
    expect(harness.operation.phase).toBe("failed");
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("contains cancellation that reenters from native install dispatch setup", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      false,
    ).queueAction("install-bitcoin", [{ type: "never" }]);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const originalRunAction = fake.runAction.bind(fake);
    vi.spyOn(fake, "runAction").mockImplementation(((ownedSession, action) => {
      if (action.kind === "install-bitcoin") {
        void operationRef.current?.cancel();
      }
      return originalRunAction(ownedSession, action as never);
    }) as typeof fake.runAction);
    const harness = createOperationHarness(fake);
    const operation = harness.operation;
    operationRef.current = operation;
    const plan = await operation.begin();

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
    ]);
    expect(
      fake.calls.filter(
        (call) => call.type === "cancel" && call.source === "action",
      ),
    ).toHaveLength(1);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
    expect(operation.phase).toBe("needs-recovery");
  });

  it("rejects an expired plan without reviving its completed operation", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), false);
    const harness = createOperationHarness(fake, { planTtlMs: 10 });
    const plan = await harness.operation.begin();

    await vi.advanceTimersByTimeAsync(10);
    expect(harness.operation.phase).toBe("failed");
    await expect(harness.operation.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "failed",
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("does not infer success from progress 100 and ignores late completion after cancellation", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      false,
    ).queueAction("install-bitcoin", [
      { type: "attempt-install-mutation" },
      {
        type: "next",
        value: { status: "pending", progress: 1 },
      },
      {
        type: "next",
        value: {
          status: "completed",
          output: { actionCompleted: true },
        },
        atMs: 20,
        afterCancel: true,
      },
    ]);
    const harness = createOperationHarness(fake);
    const plan = await harness.operation.begin();
    const installation = harness.operation.install(plan);
    let settled = false;
    void installation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(harness.events).toContainEqual({
      phase: "installing",
      progress: 100,
    });
    await harness.operation.cancel();
    await expect(installation).rejects.toMatchObject({
      code: "state-unknown",
    });
    await vi.advanceTimersByTimeAsync(20);

    expect(harness.operation.phase).toBe("needs-recovery");
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
    ]);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("lets cancellation win between install completion and verification dispatch", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      false,
    ).queueAction("install-bitcoin", [
      { type: "attempt-install-mutation" },
      {
        type: "next",
        value: {
          status: "completed",
          output: { actionCompleted: true },
        },
      },
    ]);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createOperationHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "verifying") {
          void operationRef.current?.cancel();
        }
      },
    });
    const operation = harness.operation;
    operationRef.current = operation;
    const plan = await operation.begin();

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
    ]);
    expect(operation.phase).toBe("needs-recovery");
  });

  it("cancels fresh verification once and never opens from a late presence result", async () => {
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
          value: { status: "pending", interaction: "unlock-device" },
        },
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
          atMs: 20,
          afterCancel: true,
        },
      ]);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createOperationHarness(fake, {
      onEvent: (event) => {
        if (
          event.phase === "verifying" &&
          event.interaction === "unlock-device"
        ) {
          void operationRef.current?.cancel();
        }
      },
    });
    const operation = harness.operation;
    operationRef.current = operation;
    const plan = await operation.begin();
    const installation = operation.install(plan);

    await expect(installation).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
      "list-bitcoin",
    ]);
    expect(
      fake.calls.filter(
        (call) => call.type === "cancel" && call.source === "action",
      ),
    ).toHaveLength(1);
    expect(operation.phase).toBe("needs-recovery");
  });

  it("cancellation from the opening transition preserves disposition without dispatching open", async () => {
    const fake = queuePreparation(new ScriptedDmk(systemClock), true);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createOperationHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "opening-bitcoin") {
          void operationRef.current?.cancel();
        }
      },
    });
    const operation = harness.operation;
    operationRef.current = operation;
    const plan = await operation.begin();

    await expect(operation.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: false,
      handoff: "reconnect-required",
    });
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
    expect(operation.phase).toBe("ready-for-webusb");
  });

  it("cancels an active open once, preserves disposition, and ignores late success", async () => {
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
      {
        type: "next",
        value: {
          status: "completed",
          output: { appOpened: true },
        },
        atMs: 20,
        afterCancel: true,
      },
    ]);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createOperationHarness(fake, {
      onEvent: (event) => {
        if (event.interaction === "confirm-open-bitcoin") {
          void operationRef.current?.cancel();
          void operationRef.current?.cancel();
        }
      },
    });
    const operation = harness.operation;
    operationRef.current = operation;
    const plan = await operation.begin();

    await expect(operation.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: false,
      handoff: "reconnect-required",
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(
      fake.calls.filter(
        (call) => call.type === "cancel" && call.source === "action",
      ),
    ).toHaveLength(1);
    expect(operation.phase).toBe("ready-for-webusb");
  });

  it("does not interrupt release when cancellation reenters its transition", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      true,
    ).queueAction("open-bitcoin", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { appOpened: true },
        },
      },
    ]);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createOperationHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "releasing-device") {
          void operationRef.current?.cancel();
        }
      },
    });
    const operation = harness.operation;
    operationRef.current = operation;
    const plan = await operation.begin();

    await expect(operation.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "reconnect-required",
    });
    expect(fake.resources().disconnectCount).toBe(1);
    expect(operation.phase).toBe("ready-for-webusb");
  });

  it("keeps proven install success when disposal reenters the ready transition", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      true,
    ).queueAction("open-bitcoin", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { appOpened: true },
        },
      },
    ]);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const harness = createOperationHarness(fake, {
      onEvent: (event) => {
        if (event.phase === "ready-for-webusb") {
          void operationRef.current?.dispose();
        }
      },
    });
    const operation = harness.operation;
    operationRef.current = operation;
    const plan = await operation.begin();

    await expect(operation.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "reconnect-required",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "open-bitcoin",
    ]);
    expect(fake.resources().disconnectCount).toBe(1);
    expect(operation.phase).toBe("disposed");
    expect(harness.onTerminal).toHaveBeenCalledTimes(1);
    expect(harness.onTerminal).toHaveBeenCalledWith(operation, "disposed");
  });

  it("rejects a completed-plan replay without another action or cleanup", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      true,
    ).queueAction("open-bitcoin", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { appOpened: true },
        },
      },
    ]);
    const harness = createOperationHarness(fake);
    const plan = await harness.operation.begin();
    await harness.operation.install(plan);
    const callsBeforeReplay = fake.calls.length;

    await expect(harness.operation.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "ready-for-webusb",
    });
    expect(fake.calls).toHaveLength(callsBeforeReplay);
    expect(fake.resources().disconnectCount).toBe(1);
  });

  it("clears a plan timer whose valid opaque handle is zero", async () => {
    const zeroTimer = 0 as unknown as ClockTimer;
    const clearTimeout = vi.fn<(timer: ClockTimer) => void>();
    const zeroClock: Clock = {
      now: () => 1_000,
      monotonicNow: () => 1_000,
      setTimeout: () => zeroTimer,
      clearTimeout,
    };
    const fake = queuePreparation(new ScriptedDmk(zeroClock), true).queueAction(
      "open-bitcoin",
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { appOpened: true },
          },
        },
      ],
    );
    const harness = createOperationHarness(fake, { clock: zeroClock });
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).resolves.toMatchObject({
      status: "already-installed",
    });
    expect(clearTimeout).toHaveBeenCalledTimes(1);
    expect(clearTimeout).toHaveBeenCalledWith(zeroTimer);
  });

  it("clears a synchronously expired late timer and never publishes a plan", async () => {
    const zeroTimer = 0 as unknown as ClockTimer;
    const clearTimeout = vi.fn<(timer: ClockTimer) => void>();
    const synchronousExpiryClock: Clock = {
      now: () => 1_000,
      monotonicNow: () => 1_000,
      setTimeout: (callback) => {
        callback();
        return zeroTimer;
      },
      clearTimeout,
    };
    const fake = queuePreparation(
      new ScriptedDmk(synchronousExpiryClock),
      false,
    );
    const harness = createOperationHarness(fake, {
      clock: synchronousExpiryClock,
    });

    await expect(harness.operation.begin()).rejects.toMatchObject({
      code: "internal",
      phase: "ready-to-install",
    });
    expect(harness.events.map(({ phase }) => phase)).not.toContain(
      "ready-to-install",
    );
    expect(harness.operation.phase).toBe("failed");
    expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
    expect(clearTimeout).toHaveBeenCalledTimes(1);
    expect(clearTimeout).toHaveBeenCalledWith(zeroTimer);
    expect(fake.resources().disconnectCount).toBe(1);
  });

  it.each([
    ["cancel", "cancelled"],
    ["dispose", "disposed"],
  ] as const)(
    "clears a late zero timer when timer setup reenters %s",
    async (method, terminal) => {
      const zeroTimer = 0 as unknown as ClockTimer;
      const clearTimeout = vi.fn<(timer: ClockTimer) => void>();
      const operationRef: { current?: ReadOnlyPrepareOperation } = {};
      const reentrantClock: Clock = {
        now: () => 1_000,
        monotonicNow: () => 1_000,
        setTimeout: () => {
          void operationRef.current?.[method]();
          return zeroTimer;
        },
        clearTimeout,
      };
      const fake = queuePreparation(new ScriptedDmk(reentrantClock), false);
      const harness = createOperationHarness(fake, { clock: reentrantClock });
      const operation = harness.operation;
      operationRef.current = operation;

      await expect(operation.begin()).rejects.toMatchObject({
        code: "cancelled",
        phase: "checking-bitcoin-app",
      });
      expect(harness.events.map(({ phase }) => phase)).not.toContain(
        "ready-to-install",
      );
      expect(operation.phase).toBe(terminal);
      expect(actionKinds(fake)).toEqual(["genuine", "list-bitcoin"]);
      expect(clearTimeout).toHaveBeenCalledTimes(1);
      expect(clearTimeout).toHaveBeenCalledWith(zeroTimer);
      expect(fake.resources().disconnectCount).toBe(1);
    },
  );

  it("makes disposal during mutation absorbing, idempotent, and late-terminal safe", async () => {
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      false,
    ).queueAction("install-bitcoin", [
      { type: "attempt-install-mutation" },
      { type: "never" },
      {
        type: "next",
        value: {
          status: "completed",
          output: { actionCompleted: true },
        },
        atMs: 20,
        afterCancel: true,
      },
    ]);
    const harness = createOperationHarness(fake);
    const plan = await harness.operation.begin();
    const installation = harness.operation.install(plan);
    const firstDispose = harness.operation.dispose();
    const secondDispose = harness.operation.dispose();

    expect(secondDispose).toBe(firstDispose);
    await firstDispose;
    await expect(installation).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(harness.operation.phase).toBe("disposed");
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
    ]);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
    expect(harness.onTerminal).toHaveBeenCalledTimes(1);
    expect(harness.onTerminal).toHaveBeenCalledWith(
      harness.operation,
      "disposed",
    );
  });
});
