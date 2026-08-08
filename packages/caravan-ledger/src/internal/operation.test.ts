import { createBitcoinAppInstallerCore } from "../installer";

import { systemClock } from "./clock";
import type { DmkDiscoveredDevice, DmkSession } from "./dmkPort";
import { ReadOnlyPrepareOperation } from "./operation";
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
