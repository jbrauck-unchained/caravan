import type { BitcoinInstallerEvent } from "./events";
import {
  createBitcoinAppInstallerCore,
  createNeutralBitcoinAppInstaller,
  type InstallerCoreDependencies,
} from "./installer";
import { systemClock } from "./internal/clock";
import type { Clock, ClockTimer } from "./internal/clock";
import type { DmkDiscoveredDevice, DmkSession } from "./internal/dmkPort";
import {
  LEDGER_HID_VENDOR_ID,
  type HidDeviceIdentity,
  type HidDeviceSnapshot,
  type HidPort,
} from "./internal/hidPort";
import { PROVISIONAL_HID_RELEASE_POLICY } from "./internal/hidReleasePolicy";
import {
  acquireRuntimeLease,
  resetRuntimeLeaseForTesting,
} from "./internal/runtimeLease";
import { createCandidateModelPolicyForTesting } from "./internal/supportedModels";
import { ScriptedDmk } from "./internal/testing/scriptedDmk";
import { PROVISIONAL_OPERATION_WATCHDOG_POLICY } from "./internal/timeoutPolicy";
import type { BitcoinAppInstaller, BitcoinInstallPlan } from "./types";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "installer-test-device",
});

const session: DmkSession = Object.freeze({
  internalSessionId: "installer-test-session",
  modelId: "nanoS",
});

const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

function queueSuccessfulPreparation(
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

function createInstaller(
  fake: ScriptedDmk,
  overrides: Partial<InstallerCoreDependencies> = {},
): BitcoinAppInstaller {
  return createBitcoinAppInstallerCore({
    clock: systemClock,
    createPort: () => fake,
    getSupport: () => ({ supported: true }),
    modelPolicy: candidatePolicy,
    ...overrides,
  });
}

function actionKinds(fake: ScriptedDmk): string[] {
  return fake.calls
    .filter((call) => call.type === "run-action")
    .map((call) => call.action?.kind ?? "missing");
}

function queueUncertainInstallation(fake: ScriptedDmk): ScriptedDmk {
  return fake.queueAction("install-bitcoin", [
    { type: "attempt-install-mutation" },
    { type: "never" },
  ]);
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("The scripted installer did not reach the expected state.");
}

async function enterNeedsRecovery(
  installer: BitcoinAppInstaller,
): Promise<BitcoinInstallPlan> {
  const plan = await installer.prepare();
  const installation = installer.install(plan);
  installer.cancel();
  await expect(installation).rejects.toMatchObject({
    code: "state-unknown",
    phase: "installing",
  });
  return plan;
}

describe("Bitcoin app installer facade", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    [false, "installation-required"],
    [true, "already-installed"],
  ] as const)(
    "prepares the exact read-only flow for Bitcoin present=%s",
    async (bitcoinPresent, expectedStatus) => {
      const fake = queueSuccessfulPreparation(
        new ScriptedDmk(systemClock),
        bitcoinPresent,
      );
      const installer = createInstaller(fake);
      const events: BitcoinInstallerEvent[] = [];
      installer.subscribe((event) => events.push(event));

      const preparation = installer.prepare();

      expect(fake.calls.map((call) => call.type)).toEqual([
        "environment-support",
        "start-discovery",
        "subscribe",
        "next",
        "cancel",
        "unsubscribe",
      ]);
      const plan = await preparation;

      expect(plan).toEqual({ status: expectedStatus });
      expect(Object.isFrozen(plan)).toBe(true);
      expect(JSON.parse(JSON.stringify(plan))).toEqual({
        status: expectedStatus,
      });
      expect(events).toEqual([
        {
          phase: "selecting-device",
          interaction: "select-device",
        },
        { phase: "connecting" },
        { phase: "checking-genuine" },
        { phase: "checking-bitcoin-app" },
        { phase: "ready-to-install" },
      ]);
      expect(
        fake.calls
          .filter((call) => call.type === "run-action")
          .map((call) => call.action?.kind),
      ).toEqual(["genuine", "list-bitcoin"]);
      expect(fake.resources()).toMatchObject({
        discoveryCount: 1,
        connectCount: 1,
        sessionLifecycleCount: 1,
        actionCount: 2,
        disconnectCount: 0,
        activeSubscriptions: 1,
      });

      await installer.dispose();
      expect(events.at(-1)).toEqual({ phase: "disposed" });
      expect(fake.resources()).toMatchObject({
        disconnectCount: 1,
        activeSubscriptions: 0,
        scheduledTimers: 0,
      });
    },
  );

  it("installs, independently verifies, opens, releases, and returns the public result", async () => {
    const fake = queueSuccessfulPreparation(new ScriptedDmk(systemClock), false)
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
    const installer = createInstaller(fake);
    const events: BitcoinInstallerEvent[] = [];
    installer.subscribe((event) => events.push(event));
    const plan = await installer.prepare();

    const result = await installer.install(plan);

    expect(result).toEqual({
      status: "installed",
      appOpen: true,
      handoff: "reconnect-required",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
      "list-bitcoin",
      "open-bitcoin",
    ]);
    expect(events.map(({ phase }) => phase)).toEqual([
      "selecting-device",
      "connecting",
      "checking-genuine",
      "checking-bitcoin-app",
      "ready-to-install",
      "installing",
      "verifying",
      "opening-bitcoin",
      "releasing-device",
      "ready-for-webusb",
    ]);
    expect(fake.resources()).toMatchObject({
      discoveryCount: 1,
      connectCount: 1,
      actionCount: 5,
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
    await expect(installer.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "ready-for-webusb",
    });
    await expect(installer.prepare()).rejects.toMatchObject({
      code: "internal",
      phase: "ready-for-webusb",
    });
    await expect(installer.recover()).rejects.toMatchObject({
      code: "internal",
      phase: "ready-for-webusb",
    });
    expect(fake.resources().discoveryCount).toBe(1);
    await installer.dispose();
  });

  it("lazily composes observed HID release into a ready handoff", async () => {
    const identity = Object.freeze({}) as HidDeviceIdentity;
    const snapshot = (opened: boolean): HidDeviceSnapshot =>
      Object.freeze({
        identity,
        vendorId: LEDGER_HID_VENDOR_ID,
        productId: 0x1000,
        opened,
      });
    const snapshots: readonly (readonly HidDeviceSnapshot[])[] = [
      Object.freeze([snapshot(false)]),
      Object.freeze([snapshot(true)]),
      Object.freeze([snapshot(true)]),
      Object.freeze([snapshot(false)]),
    ];
    let reads = 0;
    const listeners = new Set<
      Parameters<HidPort["subscribeToDeviceChanges"]>[0]
    >();
    const hidPort: HidPort = {
      getGrantedDevices: () => {
        const value = snapshots[reads] ?? snapshots.at(-1) ?? [];
        reads += 1;
        return Promise.resolve(value);
      },
      subscribeToDeviceChanges: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const createHidPort = vi.fn(() => hidPort);
    const fake = queueSuccessfulPreparation(
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
    const installer = createInstaller(fake, { createHidPort });
    const phases: string[] = [];
    installer.subscribe((event) => phases.push(event.phase));

    expect(createHidPort).not.toHaveBeenCalled();
    const plan = await installer.prepare();
    expect(createHidPort).toHaveBeenCalledTimes(1);
    await expect(installer.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "ready",
    });
    expect(phases.slice(-3)).toEqual([
      "opening-bitcoin",
      "releasing-device",
      "ready-for-webusb",
    ]);
    expect(reads).toBe(4);
    expect(listeners.size).toBe(0);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("uses an already-installed plan as a no-op and preserves open refusal", async () => {
    const canary = "private-open-refusal";
    const fake = queueSuccessfulPreparation(
      new ScriptedDmk(systemClock),
      true,
    ).queueAction("open-bitcoin", [
      {
        type: "next",
        value: {
          status: "error",
          rawError: { _tag: "ActionRefusedError", message: canary },
        },
      },
    ]);
    const installer = createInstaller(fake);
    const plan = await installer.prepare();

    const result = await installer.install(plan);

    expect(result).toEqual({
      status: "already-installed",
      appOpen: false,
      handoff: "reconnect-required",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "open-bitcoin",
    ]);
    expect(fake.resources()).toMatchObject({
      actionCount: 3,
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
    expect(JSON.stringify(result)).not.toContain(canary);
    await installer.dispose();
  });

  it("blocks unsupported environments before constructing a runtime or chooser", async () => {
    const createPort = vi.fn(() => new ScriptedDmk(systemClock));
    const installer = createBitcoinAppInstallerCore({
      createPort,
      getSupport: () => ({ supported: false, reason: "not-browser" }),
    });
    const events: BitcoinInstallerEvent[] = [];
    installer.subscribe((event) => events.push(event));

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "unsupported-environment",
      phase: "idle",
      recoverable: false,
    });
    expect(createPort).not.toHaveBeenCalled();
    expect(events).toEqual([{ phase: "failed" }]);
  });

  it("keeps the neutral Node factory inert even when browser-like globals exist", async () => {
    const installer = createNeutralBitcoinAppInstaller();

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "unsupported-environment",
      phase: "idle",
    });
    await installer.dispose();
  });

  it("keeps the production model allowlist empty before any action", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session });
    const installer = createBitcoinAppInstallerCore({
      clock: systemClock,
      createPort: () => fake,
      getSupport: () => ({ supported: true }),
    });

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "unsupported-device",
      phase: "connecting",
    });
    expect(fake.resources()).toMatchObject({
      actionCount: 0,
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("blocks a non-genuine result and never inspects applications", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: false },
          },
        },
      ]);
    const installer = createInstaller(fake);

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "device-not-genuine",
      phase: "checking-genuine",
    });
    expect(
      fake.calls
        .filter((call) => call.type === "run-action")
        .map((call) => call.action?.kind),
    ).toEqual(["genuine"]);
    expect(fake.resources().disconnectCount).toBe(1);
  });

  it("preserves a list failure when disconnect cleanup also rejects", async () => {
    const listFailure = Object.freeze({ _tag: "NetworkDAError" });
    const fake = new ScriptedDmk(systemClock)
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
          value: { status: "error", rawError: listFailure },
        },
      ])
      .queueDisconnect({
        type: "reject",
        error: new Error("private cleanup failure"),
      });
    const installer = createInstaller(fake);

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "network-unavailable",
      phase: "checking-bitcoin-app",
    });
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
    const nextLease = acquireRuntimeLease();
    nextLease.release();
  });

  it("rejects same-instance and cross-instance contention before another chooser", async () => {
    const firstFake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "never" },
    ]);
    const secondCreatePort = vi.fn(() => new ScriptedDmk(systemClock));
    const first = createInstaller(firstFake);
    const second = createBitcoinAppInstallerCore({
      createPort: secondCreatePort,
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });

    const active = first.prepare();
    await expect(first.prepare()).rejects.toMatchObject({
      code: "device-busy",
    });
    await expect(second.prepare()).rejects.toMatchObject({
      code: "device-busy",
      phase: "idle",
    });
    expect(firstFake.resources().discoveryCount).toBe(1);
    expect(secondCreatePort).not.toHaveBeenCalled();

    first.cancel();
    await expect(active).rejects.toMatchObject({ code: "cancelled" });
    await first.dispose();
    await second.dispose();
  });

  it("rejects invalid install and recovery calls without starting device work", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "never" },
    ]);
    const installer = createInstaller(fake);
    const forgedPlan = {
      status: "installation-required",
    } as BitcoinInstallPlan;

    await expect(installer.install(forgedPlan)).rejects.toMatchObject({
      code: "internal",
      phase: "idle",
    });
    await expect(installer.recover()).rejects.toMatchObject({
      code: "internal",
      phase: "idle",
    });
    expect(fake.calls).toHaveLength(0);

    const preparation = installer.prepare();
    await expect(installer.install(forgedPlan)).rejects.toMatchObject({
      code: "internal",
      phase: "selecting-device",
    });
    await expect(installer.recover()).rejects.toMatchObject({
      code: "device-busy",
      phase: "selecting-device",
    });
    expect(fake.resources()).toMatchObject({
      discoveryCount: 1,
      connectCount: 0,
      actionCount: 0,
    });

    installer.cancel();
    await expect(preparation).rejects.toMatchObject({ code: "cancelled" });
    await installer.dispose();
  });

  it("allows a fresh preparation after cancellation cleanup", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "never" },
    ]);
    const installer = createInstaller(fake);
    const first = installer.prepare();

    installer.cancel();
    await expect(first).rejects.toMatchObject({ code: "cancelled" });

    queueSuccessfulPreparation(fake, true);
    await expect(installer.prepare()).resolves.toMatchObject({
      status: "already-installed",
    });
    expect(fake.resources().discoveryCount).toBe(2);
    await installer.dispose();
  });

  it("keeps a failed read-only instance non-retryable", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session });
    const installer = createBitcoinAppInstallerCore({
      clock: systemClock,
      createPort: () => fake,
      getSupport: () => ({ supported: true }),
    });

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "unsupported-device",
    });
    await expect(installer.prepare()).rejects.toMatchObject({
      code: "internal",
      phase: "failed",
      recoverable: false,
    });
    expect(fake.resources().discoveryCount).toBe(1);
    await installer.dispose();
  });

  it("rejects serialized and forged plans without mutation or leaks", async () => {
    for (const candidateKind of ["serialized", "forged"] as const) {
      resetRuntimeLeaseForTesting();
      const fake = queueSuccessfulPreparation(
        new ScriptedDmk(systemClock),
        false,
      );
      const installer = createInstaller(fake);
      const plan = await installer.prepare();
      const candidate: BitcoinInstallPlan =
        candidateKind === "serialized"
          ? (JSON.parse(JSON.stringify(plan)) as BitcoinInstallPlan)
          : ({ status: "installation-required" } as BitcoinInstallPlan);

      await expect(installer.install(candidate)).rejects.toMatchObject({
        code: "internal",
        phase: "ready-to-install",
      });
      expect(
        fake.calls
          .filter((call) => call.type === "run-action")
          .map((call) => call.action?.kind),
      ).toEqual(["genuine", "list-bitcoin"]);
      expect(fake.resources()).toMatchObject({
        disconnectCount: 1,
        activeSubscriptions: 0,
      });
      await installer.dispose();
    }
  });

  it("rejects a reentrant duplicate install without dispatching a second action", async () => {
    const fake = queueSuccessfulPreparation(new ScriptedDmk(systemClock), false)
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
    const installer = createInstaller(fake);
    const plan = await installer.prepare();
    let duplicate: Promise<unknown> | undefined;
    installer.subscribe((event) => {
      if (event.phase === "installing" && !duplicate) {
        duplicate = installer.install(plan);
        void duplicate.catch(() => undefined);
      }
    });

    const installation = installer.install(plan);

    await expect(duplicate).rejects.toMatchObject({
      code: "internal",
      phase: "installing",
    });
    await expect(installation).resolves.toMatchObject({ status: "installed" });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
      "list-bitcoin",
      "open-bitcoin",
    ]);
    expect(
      fake.calls.filter(
        (call) =>
          call.type === "run-action" && call.action?.kind === "install-bitcoin",
      ),
    ).toHaveLength(1);
    await installer.dispose();
  });

  it.each([
    [true, "already-installed"],
    [false, "installation-required"],
  ] as const)(
    "recovers uncertain state by freshly reinspecting Bitcoin present=%s",
    async (bitcoinPresent, expectedStatus) => {
      const fake = queueUncertainInstallation(
        queueSuccessfulPreparation(new ScriptedDmk(systemClock), false),
      );
      const leaseGenerations: number[] = [];
      const installer = createInstaller(fake, {
        acquireLease: () => {
          const lease = acquireRuntimeLease();
          leaseGenerations.push(lease.generation);
          return lease;
        },
      });
      const oldPlan = await enterNeedsRecovery(installer);

      queueSuccessfulPreparation(fake, bitcoinPresent);
      const callsBeforeRecovery = fake.calls.length;
      const recovery = installer.recover();
      expect(
        fake.calls.slice(callsBeforeRecovery).map((call) => call.type),
      ).toEqual([
        "environment-support",
        "start-discovery",
        "subscribe",
        "next",
        "cancel",
        "unsubscribe",
      ]);
      const duplicateRecovery = installer.recover();

      await expect(duplicateRecovery).rejects.toMatchObject({
        code: "device-busy",
        phase: "selecting-device",
      });
      const recoveredPlan = await recovery;
      expect(recoveredPlan).toEqual({ status: expectedStatus });
      expect(recoveredPlan).not.toBe(oldPlan);
      expect(leaseGenerations).toHaveLength(2);
      expect(leaseGenerations[1]).toBeGreaterThan(leaseGenerations[0] ?? -1);
      expect(actionKinds(fake)).toEqual([
        "genuine",
        "list-bitcoin",
        "install-bitcoin",
        "genuine",
        "list-bitcoin",
      ]);
      expect(
        fake.calls.filter(
          (call) =>
            call.type === "run-action" &&
            call.action?.kind === "install-bitcoin",
        ),
      ).toHaveLength(1);
      expect(fake.resources()).toMatchObject({
        discoveryCount: 2,
        connectCount: 2,
        sessionLifecycleCount: 2,
        actionCount: 5,
        disconnectCount: 1,
        activeSubscriptions: 1,
      });

      await installer.dispose();
      expect(fake.resources()).toMatchObject({
        disconnectCount: 2,
        activeSubscriptions: 0,
      });
    },
  );

  it("blocks recovery reentrancy from the needs-recovery event until prior cleanup finishes", async () => {
    const fake = queueUncertainInstallation(
      queueSuccessfulPreparation(new ScriptedDmk(systemClock), false),
    );
    const installer = createInstaller(fake);
    let reentrantRecovery: Promise<BitcoinInstallPlan> | undefined;
    installer.subscribe((event) => {
      if (event.phase === "needs-recovery" && !reentrantRecovery) {
        reentrantRecovery = installer.recover();
        void reentrantRecovery.catch(() => undefined);
      }
    });

    await enterNeedsRecovery(installer);

    await expect(reentrantRecovery).rejects.toMatchObject({
      code: "device-busy",
      phase: "needs-recovery",
    });
    expect(fake.resources()).toMatchObject({
      discoveryCount: 1,
      connectCount: 1,
      disconnectCount: 1,
      activeSubscriptions: 0,
    });

    queueSuccessfulPreparation(fake, true);
    await expect(installer.recover()).resolves.toMatchObject({
      status: "already-installed",
    });
    expect(fake.resources().discoveryCount).toBe(2);
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
      "genuine",
      "list-bitcoin",
    ]);
    await installer.dispose();
  });

  it("contains recovery failure and does not permit another recovery or prepare", async () => {
    const fake = queueUncertainInstallation(
      queueSuccessfulPreparation(new ScriptedDmk(systemClock), false),
    );
    const installer = createInstaller(fake);
    await enterNeedsRecovery(installer);
    fake
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: false },
          },
        },
      ]);

    await expect(installer.recover()).rejects.toMatchObject({
      code: "device-not-genuine",
      phase: "checking-genuine",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
      "genuine",
    ]);
    expect(fake.resources()).toMatchObject({
      discoveryCount: 2,
      connectCount: 2,
      disconnectCount: 2,
      activeSubscriptions: 0,
    });
    await expect(installer.recover()).rejects.toMatchObject({
      code: "internal",
      phase: "failed",
    });
    await expect(installer.prepare()).rejects.toMatchObject({
      code: "internal",
      phase: "failed",
    });
    expect(fake.resources().discoveryCount).toBe(2);
    await installer.dispose();
  });

  it("cancels recovery once and permits a later fresh preparation", async () => {
    const fake = queueUncertainInstallation(
      queueSuccessfulPreparation(new ScriptedDmk(systemClock), false),
    );
    const installer = createInstaller(fake);
    await enterNeedsRecovery(installer);
    fake.queueDiscovery([{ type: "never" }]);

    const recovery = installer.recover();
    expect(fake.resources().discoveryCount).toBe(2);
    installer.cancel();
    installer.cancel();
    await expect(recovery).rejects.toMatchObject({
      code: "cancelled",
      phase: "selecting-device",
    });

    queueSuccessfulPreparation(fake, false);
    await expect(installer.prepare()).resolves.toMatchObject({
      status: "installation-required",
    });
    expect(fake.resources()).toMatchObject({
      discoveryCount: 3,
      connectCount: 2,
      disconnectCount: 1,
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
      "genuine",
      "list-bitcoin",
    ]);
    await installer.dispose();
    expect(fake.resources().disconnectCount).toBe(2);
  });

  it("rejects a foreign plan without disturbing its owning installer", async () => {
    const ownerFake = queueSuccessfulPreparation(
      new ScriptedDmk(systemClock),
      true,
    );
    const owner = createInstaller(ownerFake);
    const foreign = createInstaller(new ScriptedDmk(systemClock));
    const plan = await owner.prepare();

    await expect(foreign.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "idle",
    });
    expect(ownerFake.resources().disconnectCount).toBe(0);

    await owner.dispose();
    await foreign.dispose();
  });

  it("expires a plan at the owned deadline and releases its session", async () => {
    const fake = queueSuccessfulPreparation(
      new ScriptedDmk(systemClock),
      false,
    );
    const installer = createInstaller(fake, { planTtlMs: 100 });
    const events: BitcoinInstallerEvent[] = [];
    installer.subscribe((event) => events.push(event));
    const plan = await installer.prepare();

    await vi.advanceTimersByTimeAsync(99);
    expect(fake.resources().disconnectCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await flushUntil(() => fake.resources().disconnectCount === 1);

    expect(events.at(-1)).toEqual({ phase: "failed" });
    await expect(installer.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "failed",
    });
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("fails plan authority closed when the injected clock rolls backward at timer delivery", async () => {
    let now = 1_000;
    let expiryCallback: (() => void) | undefined;
    const scheduledDurations: number[] = [];
    const timer = Object.freeze({}) as ClockTimer;
    const hostileClock: Clock = {
      now: () => now,
      monotonicNow: () => now,
      setTimeout: (callback, delayMs) => {
        scheduledDurations.push(delayMs);
        expiryCallback = callback;
        return timer;
      },
      clearTimeout: vi.fn(() => {
        throw new Error("hostile timer cleanup");
      }),
    };
    const fake = queueSuccessfulPreparation(
      new ScriptedDmk(hostileClock),
      true,
    );
    const installer = createInstaller(fake, {
      clock: hostileClock,
      planTtlMs: 100,
    });
    const events: BitcoinInstallerEvent[] = [];
    installer.subscribe((event) => events.push(event));
    const plan = await installer.prepare();

    now = 999;
    expiryCallback?.();
    await flushUntil(() => events.at(-1)?.phase === "failed");

    await expect(installer.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "failed",
    });
    expect(hostileClock.clearTimeout).toHaveBeenCalledTimes(6);
    expect(scheduledDurations).toEqual([
      PROVISIONAL_OPERATION_WATCHDOG_POLICY.discovery,
      PROVISIONAL_OPERATION_WATCHDOG_POLICY.connect,
      PROVISIONAL_OPERATION_WATCHDOG_POLICY.genuine,
      PROVISIONAL_OPERATION_WATCHDOG_POLICY.inspect,
      100,
      PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
    ]);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("invalidates a ready plan immediately when the session lifecycle ends", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "resolve", value: session })
      .queueSessionLifecycle([
        {
          type: "error",
          error: new Error("private lifecycle failure"),
          atMs: 10,
          afterCancel: true,
        },
      ])
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
            output: { bitcoinPresent: true },
          },
        },
      ]);
    const installer = createInstaller(fake);
    const events: BitcoinInstallerEvent[] = [];
    installer.subscribe((event) => events.push(event));
    const plan = await installer.prepare();

    await vi.advanceTimersByTimeAsync(10);
    await flushUntil(() => fake.resources().disconnectCount === 1);

    expect(events.at(-1)).toEqual({ phase: "failed" });
    await expect(installer.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "failed",
    });
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("snapshot-isolates listeners and permanently absorbs disposal", async () => {
    const fake = queueSuccessfulPreparation(new ScriptedDmk(systemClock), true);
    const installer = createInstaller(fake);
    const observed: BitcoinInstallerEvent[] = [];
    const first = vi.fn(() => {
      throw new Error("consumer listener failure");
    });
    const unsubscribe = installer.subscribe(first);
    installer.subscribe((event) => observed.push(event));

    await installer.prepare();
    unsubscribe();
    unsubscribe();
    const firstDispose = installer.dispose();
    const secondDispose = installer.dispose();

    expect(secondDispose).toBe(firstDispose);
    await firstDispose;
    expect(observed.at(-1)).toEqual({ phase: "disposed" });
    expect(() => installer.subscribe(vi.fn())).toThrowError(
      expect.objectContaining({ code: "internal", phase: "disposed" }),
    );
    await expect(installer.prepare()).rejects.toMatchObject({
      code: "internal",
      phase: "disposed",
    });
    expect(() => installer.cancel()).not.toThrow();
    expect(first).toHaveBeenCalled();
  });

  it("keeps public success when disposal reenters the ready terminal event", async () => {
    const fake = queueSuccessfulPreparation(
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
    const installer = createInstaller(fake);
    const events: BitcoinInstallerEvent[] = [];
    let disposal: Promise<void> | undefined;
    installer.subscribe((event) => {
      events.push(event);
      if (event.phase === "ready-for-webusb") {
        disposal = installer.dispose();
      }
    });
    const plan = await installer.prepare();

    await expect(installer.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "reconnect-required",
    });
    await disposal;

    expect(events.slice(-2)).toEqual([
      { phase: "ready-for-webusb" },
      { phase: "disposed" },
    ]);
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "open-bitcoin",
    ]);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
    expect(installer.dispose()).toBe(disposal);
    expect(() => installer.subscribe(vi.fn())).toThrowError(
      expect.objectContaining({ code: "internal", phase: "disposed" }),
    );
    await expect(installer.recover()).rejects.toMatchObject({
      code: "internal",
      phase: "disposed",
    });
  });

  it("makes disposal during an uncertain mutation permanently absorbing", async () => {
    const fake = queueUncertainInstallation(
      queueSuccessfulPreparation(new ScriptedDmk(systemClock), false),
    );
    const installer = createInstaller(fake);
    const plan = await installer.prepare();
    const installation = installer.install(plan);

    const firstDispose = installer.dispose();
    const secondDispose = installer.dispose();

    expect(secondDispose).toBe(firstDispose);
    await firstDispose;
    await expect(installation).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
    });
    expect(actionKinds(fake)).toEqual([
      "genuine",
      "list-bitcoin",
      "install-bitcoin",
    ]);
    expect(fake.resources()).toMatchObject({
      discoveryCount: 1,
      actionCount: 3,
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
    await expect(installer.prepare()).rejects.toMatchObject({
      code: "internal",
      phase: "disposed",
    });
    await expect(installer.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "disposed",
    });
    await expect(installer.recover()).rejects.toMatchObject({
      code: "internal",
      phase: "disposed",
    });
    expect(fake.resources().discoveryCount).toBe(1);
  });

  it("latches idle disposal before a disposed listener can reenter it", async () => {
    const installer = createInstaller(new ScriptedDmk(systemClock));
    const events: BitcoinInstallerEvent[] = [];
    let nestedDispose: Promise<void> | undefined;
    installer.subscribe((event) => {
      events.push(event);
      if (event.phase === "disposed") nestedDispose = installer.dispose();
    });

    const firstDispose = installer.dispose();
    expect(nestedDispose).toBe(firstDispose);
    expect(installer.dispose()).toBe(firstDispose);
    await firstDispose;
    expect(events).toEqual([{ phase: "disposed" }]);
  });

  it("latches failed cleanup before terminal listeners can request disposal", async () => {
    const invalidate = vi.fn();
    const release = vi.fn();
    const installer = createBitcoinAppInstallerCore({
      acquireLease: () => ({
        generation: 1,
        invalidate,
        isCurrent: () => true,
        release,
      }),
      createPort: () => {
        throw new Error("symbolic port construction failure");
      },
      getSupport: () => ({ supported: true }),
    });
    const events: BitcoinInstallerEvent[] = [];
    let disposal: Promise<void> | undefined;
    installer.subscribe((event) => {
      events.push(event);
      if (event.phase === "failed") disposal = installer.dispose();
    });

    await expect(installer.prepare()).rejects.toMatchObject({
      code: "internal",
      phase: "idle",
    });
    await disposal;

    expect(events).toEqual([{ phase: "failed" }, { phase: "disposed" }]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  describe.each(["cancel", "dispose"] as const)(
    "reentrant %s",
    (terminalAction) => {
      it.each([
        "selecting-device",
        "connecting",
        "checking-genuine",
        "checking-bitcoin-app",
        "ready-to-install",
      ] as const)(
        "wins from the %s transition listener",
        async (targetPhase) => {
          const fake = queueSuccessfulPreparation(
            new ScriptedDmk(systemClock),
            true,
          );
          const installer = createInstaller(fake);
          const events: BitcoinInstallerEvent[] = [];
          let disposal: Promise<void> | undefined;
          installer.subscribe((event) => {
            events.push(event);
            if (event.phase !== targetPhase) return;
            if (terminalAction === "cancel") {
              installer.cancel();
            } else {
              disposal = installer.dispose();
            }
          });

          await expect(installer.prepare()).rejects.toMatchObject({
            code: "cancelled",
            phase: targetPhase,
          });
          await disposal;

          expect(events.at(-1)).toEqual({
            phase: terminalAction === "cancel" ? "cancelled" : "disposed",
          });
          expect(fake.resources()).toMatchObject({
            connectCount:
              targetPhase === "selecting-device" || targetPhase === "connecting"
                ? 0
                : 1,
            disconnectCount:
              targetPhase === "checking-genuine" ||
              targetPhase === "checking-bitcoin-app" ||
              targetPhase === "ready-to-install"
                ? 1
                : 0,
            closeCount: 0,
            activeSubscriptions: 0,
            scheduledTimers: 0,
          });
          expect(fake.resources().actionCount).toBe(
            targetPhase === "checking-bitcoin-app"
              ? 1
              : targetPhase === "ready-to-install"
                ? 2
                : 0,
          );
          if (terminalAction === "cancel") await installer.dispose();
        },
      );
    },
  );

  it.each([
    "selecting-device",
    "connecting",
    "checking-genuine",
    "checking-bitcoin-app",
    "ready-to-install",
  ] as const)(
    "cancels once from %s and ignores late work",
    async (targetPhase) => {
      const fake = new ScriptedDmk(systemClock);
      if (targetPhase === "selecting-device") {
        fake.queueDiscovery([
          { type: "next", value: device, atMs: 20, afterCancel: true },
        ]);
      } else {
        fake.queueDiscovery([{ type: "next", value: device }]);
        fake.queueConnect(
          targetPhase === "connecting"
            ? { type: "resolve", value: session, afterMs: 20 }
            : { type: "resolve", value: session },
        );
        fake.queueSessionLifecycle([{ type: "never" }]);
        if (targetPhase !== "connecting") {
          fake.queueAction(
            "genuine",
            targetPhase === "checking-genuine"
              ? [
                  { type: "never" },
                  {
                    type: "next",
                    value: {
                      status: "completed",
                      output: { isGenuine: true },
                    },
                    atMs: 20,
                    afterCancel: true,
                  },
                ]
              : [
                  {
                    type: "next",
                    value: {
                      status: "completed",
                      output: { isGenuine: true },
                    },
                  },
                ],
          );
        }
        if (
          targetPhase === "checking-bitcoin-app" ||
          targetPhase === "ready-to-install"
        ) {
          fake.queueAction(
            "list-bitcoin",
            targetPhase === "checking-bitcoin-app"
              ? [
                  { type: "never" },
                  {
                    type: "next",
                    value: {
                      status: "completed",
                      output: { bitcoinPresent: true },
                    },
                    atMs: 20,
                    afterCancel: true,
                  },
                ]
              : [
                  {
                    type: "next",
                    value: {
                      status: "completed",
                      output: { bitcoinPresent: true },
                    },
                  },
                ],
          );
        }
      }

      const installer = createInstaller(fake);
      const events: BitcoinInstallerEvent[] = [];
      installer.subscribe((event) => events.push(event));
      const preparation = installer.prepare();
      await flushUntil(() =>
        events.some((event) => event.phase === targetPhase),
      );

      installer.cancel();
      installer.cancel();
      await vi.advanceTimersByTimeAsync(20);
      if (targetPhase === "ready-to-install") {
        await expect(preparation).resolves.toMatchObject({
          status: "already-installed",
        });
      } else {
        await expect(preparation).rejects.toMatchObject({ code: "cancelled" });
      }
      expect(events.at(-1)).toEqual({ phase: "cancelled" });
      expect(fake.resources()).toMatchObject({
        disconnectCount: targetPhase === "selecting-device" ? 0 : 1,
        activeSubscriptions: 0,
        scheduledTimers: 0,
      });
      expect(
        fake.calls.filter((call) => call.type === "disconnect"),
      ).toHaveLength(targetPhase === "selecting-device" ? 0 : 1);
      await installer.dispose();
    },
  );

  it("settles publicly but quarantines a non-abortable never-settling connect", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: device }])
      .queueConnect({ type: "never" });
    const installer = createInstaller(fake);
    const preparation = installer.prepare();
    await flushUntil(() => fake.resources().connectCount === 1);

    installer.cancel();
    const disposal = installer.dispose();
    let preparationSettled = false;
    let disposalSettled = false;
    void preparation.then(
      () => {
        preparationSettled = true;
      },
      () => {
        preparationSettled = true;
      },
    );
    void disposal.then(() => {
      disposalSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    await expect(disposal).resolves.toBeUndefined();
    await expect(preparation).rejects.toMatchObject({
      code: "cancelled",
      phase: "connecting",
    });
    expect(preparationSettled).toBe(true);
    expect(disposalSettled).toBe(true);
    expect(fake.resources()).toMatchObject({
      connectCount: 1,
      disconnectCount: 0,
      closeCount: 0,
    });
    expect(() => acquireRuntimeLease()).toThrowError("already in use");
  });

  it("rejects plan lifetimes outside the safe platform timer range", () => {
    const fake = new ScriptedDmk(systemClock);

    for (const planTtlMs of [0, -1, 1.5, Number.NaN, 2_147_483_648]) {
      expect(() => createInstaller(fake, { planTtlMs })).toThrow(
        "must fit the platform timer range",
      );
    }
  });
});
