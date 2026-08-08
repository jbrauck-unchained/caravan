import type { BitcoinInstallerEvent } from "../events";
import { createBitcoinAppInstallerCore } from "../installer";
import type { BitcoinInstallPlan } from "../types";

import { systemClock, type Clock, type ClockTimer } from "./clock";
import type { DmkDiscoveredDevice, DmkSession } from "./dmkPort";
import {
  LEDGER_HID_VENDOR_ID,
  type HidDeviceIdentity,
  type HidDeviceSnapshot,
  type HidPort,
} from "./hidPort";
import { PROVISIONAL_HID_RELEASE_POLICY } from "./hidReleasePolicy";
import {
  ReadOnlyPrepareOperation,
  type OperationTerminalPhase,
} from "./operation";
import { PlanStore } from "./planStore";
import {
  acquireRuntimeLease,
  resetRuntimeLeaseForTesting,
  RuntimeLeaseBusyError,
  type RuntimeLease,
} from "./runtimeLease";
import { OwnedDmkSession } from "./session";
import {
  createCandidateModelPolicyForTesting,
  type SupportedModelPolicy,
} from "./supportedModels";
import { ScriptedDmk } from "./testing/scriptedDmk";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "operation-race-device",
});
const session: DmkSession = Object.freeze({
  internalSessionId: "operation-race-session",
  modelId: "nanoS",
});
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);
const unavailableHidPortFactory = (): HidPort => {
  throw new Error("HID observation is unavailable in this test.");
};

function hidSnapshot(
  identity: HidDeviceIdentity,
  opened: boolean,
): HidDeviceSnapshot {
  return Object.freeze({
    identity,
    vendorId: LEDGER_HID_VENDOR_ID,
    productId: 0x1000,
    opened,
  });
}

class SequencedHidPort implements HidPort {
  readonly #snapshots: readonly (readonly HidDeviceSnapshot[])[];

  readonly #onRead: (readNumber: number) => void;

  #readCount = 0;

  #listeners = new Set<Parameters<HidPort["subscribeToDeviceChanges"]>[0]>();

  constructor(
    snapshots: readonly (readonly HidDeviceSnapshot[])[],
    onRead: (readNumber: number) => void = () => undefined,
  ) {
    this.#snapshots = snapshots;
    this.#onRead = onRead;
  }

  get readCount(): number {
    return this.#readCount;
  }

  get activeListeners(): number {
    return this.#listeners.size;
  }

  getGrantedDevices(): Promise<readonly HidDeviceSnapshot[]> {
    this.#readCount += 1;
    this.#onRead(this.#readCount);
    const snapshots =
      this.#snapshots[this.#readCount - 1] ??
      this.#snapshots.at(-1) ??
      Object.freeze([]);
    return Promise.resolve(snapshots);
  }

  subscribeToDeviceChanges(
    listener: Parameters<HidPort["subscribeToDeviceChanges"]>[0],
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

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
    readonly acquireLease?: () => RuntimeLease;
    readonly clock?: Clock;
    readonly createHidPort?: () => HidPort;
    readonly instanceGeneration?: number;
    readonly modelPolicy?: SupportedModelPolicy;
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
    acquireLease: options.acquireLease ?? acquireRuntimeLease,
    clock,
    createHidPort: options.createHidPort ?? unavailableHidPortFactory,
    createPort: () => fake,
    getSupport: () => ({ supported: true }),
    instanceGeneration: options.instanceGeneration ?? 41,
    modelPolicy: options.modelPolicy ?? candidatePolicy,
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
      createHidPort: unavailableHidPortFactory,
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

  it("settles reentrant early cancellation despite hostile lease cleanup", async () => {
    const leaseFailure = new Error("private-lease-cleanup-canary");
    const lease: RuntimeLease = {
      generation: 7,
      isCurrent: vi.fn(() => true),
      invalidate: vi.fn(() => {
        throw leaseFailure;
      }),
      release: vi.fn(() => {
        throw leaseFailure;
      }),
    };
    const createPort = vi.fn(() => new ScriptedDmk(systemClock));
    const installer = createBitcoinAppInstallerCore({
      acquireLease: () => {
        installer.cancel();
        return lease;
      },
      clock: systemClock,
      createHidPort: unavailableHidPortFactory,
      createPort,
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "cancelled",
      phase: "idle",
    });
    await expect(installer.dispose()).resolves.toBeUndefined();
    expect(lease.invalidate).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
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
      createHidPort: unavailableHidPortFactory,
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
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetRuntimeLeaseForTesting();
  });

  it("captures around connection and releases the lease only after observed HID closure", async () => {
    const trace: string[] = [];
    const identity = Object.freeze({}) as HidDeviceIdentity;
    const closed = hidSnapshot(identity, false);
    const opened = hidSnapshot(identity, true);
    const hidPort = new SequencedHidPort(
      [
        Object.freeze([closed]),
        Object.freeze([opened]),
        Object.freeze([opened]),
        Object.freeze([opened]),
        Object.freeze([closed]),
      ],
      (read) => trace.push(`hid-${read}`),
    );
    let leaseCurrent = true;
    const lease: RuntimeLease = {
      generation: 73,
      isCurrent: () => leaseCurrent,
      invalidate: () => {
        trace.push("lease-invalidate");
        leaseCurrent = false;
      },
      release: () => trace.push("lease-release"),
    };
    const planStore = new PlanStore(systemClock);
    const invalidatePlans = planStore.invalidateAll.bind(planStore);
    vi.spyOn(planStore, "invalidateAll").mockImplementation(() => {
      trace.push("plans-invalidate");
      invalidatePlans();
    });

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
    const startDiscovery = fake.startDiscovery.bind(fake);
    vi.spyOn(fake, "startDiscovery").mockImplementation(() => {
      trace.push("chooser");
      return startDiscovery();
    });
    const disconnect = fake.disconnect.bind(fake);
    vi.spyOn(fake, "disconnect").mockImplementation((ownedSession) => {
      trace.push("disconnect");
      return disconnect(ownedSession);
    });
    const harness = createOperationHarness(fake, {
      acquireLease: () => lease,
      createHidPort: () => hidPort,
      onEvent: (event) => {
        if (event.phase === "ready-for-webusb") trace.push("terminal");
      },
      planStore,
    });

    const preparation = harness.operation.begin();
    expect(trace.slice(0, 2)).toEqual(["hid-1", "chooser"]);
    const plan = await preparation;
    expect(hidPort.readCount).toBe(2);

    const installation = harness.operation.install(plan);
    for (let attempts = 0; attempts < 20; attempts += 1) {
      if (hidPort.readCount === 4) break;
      await Promise.resolve();
    }
    expect(harness.operation.phase).toBe("releasing-device");
    expect(hidPort.readCount).toBe(4);
    expect(trace).not.toContain("lease-release");
    expect(trace).not.toContain("terminal");

    await vi.advanceTimersByTimeAsync(
      PROVISIONAL_HID_RELEASE_POLICY.pollIntervalMs,
    );
    await expect(installation).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "ready",
    });
    expect(trace).toEqual([
      "hid-1",
      "chooser",
      "hid-2",
      "lease-invalidate",
      "plans-invalidate",
      "hid-3",
      "disconnect",
      "hid-4",
      "hid-5",
      "lease-release",
      "terminal",
    ]);
    expect(hidPort.activeListeners).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves proven result fields and emits the same terminal event for ambiguous HID evidence", async () => {
    const firstIdentity = Object.freeze({}) as HidDeviceIdentity;
    const secondIdentity = Object.freeze({}) as HidDeviceIdentity;
    const hidPort = new SequencedHidPort([
      Object.freeze([
        hidSnapshot(firstIdentity, false),
        hidSnapshot(secondIdentity, false),
      ]),
      Object.freeze([
        hidSnapshot(firstIdentity, true),
        hidSnapshot(secondIdentity, true),
      ]),
    ]);
    const fake = queuePreparation(
      new ScriptedDmk(systemClock),
      true,
    ).queueAction("open-bitcoin", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { appOpened: false },
        },
      },
    ]);
    const harness = createOperationHarness(fake, {
      createHidPort: () => hidPort,
    });
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: false,
      handoff: "reconnect-required",
    });
    expect(harness.events.at(-1)).toEqual({ phase: "ready-for-webusb" });
    expect(harness.operation.phase).toBe("ready-for-webusb");
    expect(hidPort.readCount).toBe(2);
    expect(hidPort.activeListeners).toBe(0);
    expect(fake.resources().disconnectCount).toBe(1);
  });

  it("routes connected cancellation through the same HID-aware finalizer", async () => {
    const identity = Object.freeze({}) as HidDeviceIdentity;
    const closed = hidSnapshot(identity, false);
    const opened = hidSnapshot(identity, true);
    const hidPort = new SequencedHidPort([
      Object.freeze([closed]),
      Object.freeze([opened]),
      Object.freeze([opened]),
      Object.freeze([closed]),
    ]);
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [{ type: "never" }]);
    const harness = createOperationHarness(fake, {
      createHidPort: () => hidPort,
    });

    const preparation = harness.operation.begin();
    for (let attempts = 0; attempts < 20; attempts += 1) {
      if (harness.operation.phase === "checking-genuine") break;
      await Promise.resolve();
    }
    expect(harness.operation.phase).toBe("checking-genuine");
    const firstCancel = harness.operation.cancel();
    const secondCancel = harness.operation.cancel();
    await Promise.all([firstCancel, secondCancel]);

    await expect(preparation).rejects.toMatchObject({
      code: "cancelled",
      phase: "checking-genuine",
    });
    expect(harness.operation.phase).toBe("cancelled");
    expect(hidPort.readCount).toBe(4);
    expect(hidPort.activeListeners).toBe(0);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("latches post-connect HID setup before reentrant cancellation", async () => {
    const identity = Object.freeze({}) as HidDeviceIdentity;
    const closed = hidSnapshot(identity, false);
    const opened = hidSnapshot(identity, true);
    const operationRef: { current?: ReadOnlyPrepareOperation } = {};
    const hidPort = new SequencedHidPort(
      [
        Object.freeze([closed]),
        Object.freeze([opened]),
        Object.freeze([opened]),
        Object.freeze([closed]),
      ],
      (read) => {
        if (read === 2) void operationRef.current?.cancel();
      },
    );
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session })
      .queueSessionLifecycle([{ type: "never" }]);
    const harness = createOperationHarness(fake, {
      createHidPort: () => hidPort,
    });
    operationRef.current = harness.operation;

    await expect(harness.operation.begin()).rejects.toMatchObject({
      code: "cancelled",
      phase: "connecting",
    });

    expect(harness.operation.phase).toBe("cancelled");
    expect(hidPort.readCount).toBe(4);
    expect(hidPort.activeListeners).toBe(0);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      actionCount: 0,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("owns every post-connect setup failure through the real session finalizer", async () => {
    const modelGetterFailure = new Error("private-model-getter-canary");
    const setupCases: readonly {
      readonly expectedCode: "internal" | "unsupported-device";
      readonly lifecycleFailure?: Error;
      readonly name: string;
      readonly connectedSession: DmkSession;
    }[] = [
      {
        name: "unsupported model",
        connectedSession: Object.freeze({
          internalSessionId: "unsupported-model-session",
          modelId: "nanoX",
        }),
        expectedCode: "unsupported-device",
      },
      {
        name: "missing model",
        connectedSession: Object.freeze({
          internalSessionId: "missing-model-session",
        }),
        expectedCode: "unsupported-device",
      },
      {
        name: "throwing model getter",
        connectedSession: {
          internalSessionId: "throwing-model-session",
          get modelId(): string {
            throw modelGetterFailure;
          },
        },
        expectedCode: "internal",
      },
      {
        name: "lifecycle attachment failure",
        connectedSession: session,
        lifecycleFailure: new Error("private-lifecycle-setup-canary"),
        expectedCode: "internal",
      },
    ];
    const finalizeSpy = vi.spyOn(OwnedDmkSession.prototype, "finalize");
    const compatibilityDisconnectSpy = vi.spyOn(
      OwnedDmkSession.prototype,
      "disconnect",
    );

    try {
      for (const [index, setupCase] of setupCases.entries()) {
        const fake = new ScriptedDmk(systemClock)
          .queueDiscovery([{ type: "next", value: device }])
          .queueConnect({
            type: "resolve",
            value: setupCase.connectedSession,
          })
          .queueDisconnect({ type: "never" });
        if (setupCase.lifecycleFailure) {
          fake.queueSessionLifecycle([
            {
              type: "throw-on-subscribe",
              error: setupCase.lifecycleFailure,
            },
          ]);
        }
        const harness = createOperationHarness(fake);
        const preparation = harness.operation.begin();
        let settled = false;
        void preparation.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (fake.resources().disconnectCount === 1) break;
          await Promise.resolve();
        }

        expect(fake.resources().disconnectCount, setupCase.name).toBe(1);
        expect(settled, setupCase.name).toBe(false);
        expect(() => acquireRuntimeLease(), setupCase.name).toThrow(
          RuntimeLeaseBusyError,
        );
        expect(finalizeSpy, setupCase.name).toHaveBeenCalledTimes(index + 1);
        expect(compatibilityDisconnectSpy, setupCase.name).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(
          PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
        );
        await expect(preparation, setupCase.name).rejects.toMatchObject({
          code: setupCase.expectedCode,
          phase: "connecting",
        });
        expect(harness.operation.phase, setupCase.name).toBe("failed");
        expect(fake.resources(), setupCase.name).toMatchObject({
          disconnectCount: 1,
          actionCount: 0,
          activeSubscriptions: 0,
          scheduledTimers: 0,
        });
        const nextLease = acquireRuntimeLease();
        nextLease.release();
      }
    } finally {
      finalizeSpy.mockRestore();
      compatibilityDisconnectSpy.mockRestore();
    }
  });

  it("recovers transferred ownership when cancellation precedes a setup rejection", async () => {
    const unsupportedSession: DmkSession = Object.freeze({
      internalSessionId: "late-unsupported-session",
      modelId: "nanoX",
    });
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({
        type: "resolve",
        value: unsupportedSession,
        afterMs: 20,
      })
      .queueDisconnect({ type: "never" });
    const finalizeSpy = vi.spyOn(OwnedDmkSession.prototype, "finalize");
    const compatibilityDisconnectSpy = vi.spyOn(
      OwnedDmkSession.prototype,
      "disconnect",
    );
    const harness = createOperationHarness(fake);
    const preparation = harness.operation.begin();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (fake.resources().connectCount === 1) break;
      await Promise.resolve();
    }
    expect(harness.operation.phase).toBe("connecting");

    const cancellation = harness.operation.cancel();
    let cancellationSettled = false;
    void cancellation.then(() => {
      cancellationSettled = true;
    });
    await vi.advanceTimersByTimeAsync(20);

    expect(fake.resources().disconnectCount).toBe(1);
    expect(cancellationSettled).toBe(false);
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);
    expect(finalizeSpy).toHaveBeenCalledOnce();
    expect(compatibilityDisconnectSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(
      PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
    );
    await expect(cancellation).resolves.toBeUndefined();
    await expect(preparation).rejects.toMatchObject({
      code: "cancelled",
      phase: "connecting",
    });
    expect(harness.operation.phase).toBe("cancelled");
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      actionCount: 0,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
    const nextLease = acquireRuntimeLease();
    nextLease.release();
    finalizeSpy.mockRestore();
    compatibilityDisconnectSpy.mockRestore();
  });

  it("uses captured HID evidence when lifecycle attachment fails after connect", async () => {
    const identity = Object.freeze({}) as HidDeviceIdentity;
    const closed = hidSnapshot(identity, false);
    const opened = hidSnapshot(identity, true);
    const hidPort = new SequencedHidPort([
      Object.freeze([closed]),
      Object.freeze([opened]),
      Object.freeze([opened]),
      Object.freeze([opened]),
      Object.freeze([closed]),
    ]);
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session })
      .queueSessionLifecycle([
        {
          type: "throw-on-subscribe",
          error: new Error("private-lifecycle-setup-canary"),
        },
      ]);
    const finalizeSpy = vi.spyOn(OwnedDmkSession.prototype, "finalize");
    const compatibilityDisconnectSpy = vi.spyOn(
      OwnedDmkSession.prototype,
      "disconnect",
    );
    const harness = createOperationHarness(fake, {
      createHidPort: () => hidPort,
    });
    const preparation = harness.operation.begin();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (hidPort.readCount >= 4) break;
      await Promise.resolve();
    }

    expect(hidPort.readCount).toBe(4);
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);
    await vi.advanceTimersByTimeAsync(
      PROVISIONAL_HID_RELEASE_POLICY.pollIntervalMs,
    );
    await expect(preparation).rejects.toMatchObject({
      code: "internal",
      phase: "connecting",
    });
    expect(finalizeSpy).toHaveBeenCalledOnce();
    expect(compatibilityDisconnectSpy).not.toHaveBeenCalled();
    expect(hidPort.readCount).toBe(5);
    expect(hidPort.activeListeners).toBe(0);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      actionCount: 0,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
    const nextLease = acquireRuntimeLease();
    nextLease.release();
    finalizeSpy.mockRestore();
    compatibilityDisconnectSpy.mockRestore();
  });

  it("keeps the lease through release timeout and preserves proven result truth", async () => {
    const identity = Object.freeze({}) as HidDeviceIdentity;
    const closed = hidSnapshot(identity, false);
    const opened = hidSnapshot(identity, true);
    const hidPort = new SequencedHidPort([
      Object.freeze([closed]),
      Object.freeze([opened]),
      Object.freeze([opened]),
    ]);
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
    const harness = createOperationHarness(fake, {
      createHidPort: () => hidPort,
    });
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
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (harness.operation.phase === "releasing-device") break;
      await Promise.resolve();
    }

    expect(harness.operation.phase).toBe("releasing-device");
    expect(settled).toBe(false);
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);
    await vi.advanceTimersByTimeAsync(
      PROVISIONAL_HID_RELEASE_POLICY.releaseDeadlineMs - 1,
    );
    expect(settled).toBe(false);
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);

    await vi.advanceTimersByTimeAsync(1);
    await expect(installation).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "reconnect-required",
    });
    expect(harness.operation.phase).toBe("ready-for-webusb");
    expect(hidPort.activeListeners).toBe(0);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
    const nextLease = acquireRuntimeLease();
    nextLease.release();
    expect(vi.getTimerCount()).toBe(0);
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
    const scheduledDurations: number[] = [];
    const zeroClock: Clock = {
      now: () => 1_000,
      monotonicNow: () => 1_000,
      setTimeout: (_callback, delayMs) => {
        scheduledDurations.push(delayMs);
        return zeroTimer;
      },
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
    const harness = createOperationHarness(fake, {
      clock: zeroClock,
      planTtlMs: 137,
    });
    const plan = await harness.operation.begin();

    await expect(harness.operation.install(plan)).resolves.toMatchObject({
      status: "already-installed",
    });
    expect(clearTimeout).toHaveBeenCalledTimes(2);
    expect(clearTimeout).toHaveBeenCalledWith(zeroTimer);
    expect(scheduledDurations).toEqual([
      137,
      PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
    ]);
  });

  it("clears a synchronously expired late timer and never publishes a plan", async () => {
    const zeroTimer = 0 as unknown as ClockTimer;
    const clearTimeout = vi.fn<(timer: ClockTimer) => void>();
    const scheduledDurations: number[] = [];
    const synchronousExpiryClock: Clock = {
      now: () => 1_000,
      monotonicNow: () => 1_000,
      setTimeout: (callback, delayMs) => {
        scheduledDurations.push(delayMs);
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
      planTtlMs: 137,
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
    expect(clearTimeout).toHaveBeenCalledTimes(2);
    expect(clearTimeout).toHaveBeenCalledWith(zeroTimer);
    expect(scheduledDurations).toEqual([
      137,
      PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
    ]);
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
      const scheduledDurations: number[] = [];
      const operationRef: { current?: ReadOnlyPrepareOperation } = {};
      const reentrantClock: Clock = {
        now: () => 1_000,
        monotonicNow: () => 1_000,
        setTimeout: (_callback, delayMs) => {
          scheduledDurations.push(delayMs);
          void operationRef.current?.[method]();
          return zeroTimer;
        },
        clearTimeout,
      };
      const fake = queuePreparation(new ScriptedDmk(reentrantClock), false);
      const harness = createOperationHarness(fake, {
        clock: reentrantClock,
        planTtlMs: 137,
      });
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
      expect(clearTimeout).toHaveBeenCalledTimes(2);
      expect(clearTimeout).toHaveBeenCalledWith(zeroTimer);
      expect(scheduledDurations).toEqual([
        137,
        PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
      ]);
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
