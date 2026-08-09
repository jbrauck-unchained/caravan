import type {
  BitcoinAppInstaller,
  BitcoinInstallerEvent,
  BitcoinInstallPlan,
} from "@caravan/ledger";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSimulatedBitcoinInstaller,
  SIMULATED_BITCOIN_INSTALLER_SCENARIOS,
  type SimulatedBitcoinInstallerScenario,
} from "./simulatedBitcoinInstaller";

function create(
  scenario: SimulatedBitcoinInstallerScenario,
): BitcoinAppInstaller {
  return createSimulatedBitcoinInstaller({ scenario, stepDelayMs: 0 });
}

function collectEvents(
  installer: BitcoinAppInstaller,
): BitcoinInstallerEvent[] {
  const events: BitcoinInstallerEvent[] = [];
  installer.subscribe((event) => events.push(event));
  return events;
}

describe("simulated Bitcoin installer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("runs the install-success scenario with deterministic phases and progress", async () => {
    const installer = create("install-success");
    const events = collectEvents(installer);

    const plan = await installer.prepare();
    expect(plan).toEqual({ status: "installation-required" });
    expect(Object.isFrozen(plan)).toBe(true);

    const result = await installer.install(plan);
    expect(result).toEqual({
      status: "installed",
      appOpen: true,
      handoff: "ready",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(events.map(({ phase }) => phase)).toEqual([
      "selecting-device",
      "connecting",
      "checking-genuine",
      "checking-bitcoin-app",
      "ready-to-install",
      "installing",
      "installing",
      "installing",
      "installing",
      "verifying",
      "opening-bitcoin",
      "releasing-device",
      "ready-for-webusb",
    ]);
    expect(
      events
        .filter(({ phase }) => phase === "installing")
        .map(({ progress }) => progress),
    ).toEqual([0, 35, 70, 100]);
    expect(events.every(Object.isFrozen)).toBe(true);
  });

  it("models an already-installed result without simulated mutation phases", async () => {
    const installer = create("already-installed");
    const events = collectEvents(installer);
    const plan = await installer.prepare();

    expect(plan.status).toBe("already-installed");
    await expect(installer.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "ready",
    });
    expect(events.some(({ phase }) => phase === "installing")).toBe(false);
    expect(events.some(({ phase }) => phase === "verifying")).toBe(false);
  });

  it("reports a safely shaped user-refused failure", async () => {
    const installer = create("user-refused");
    const events = collectEvents(installer);

    await expect(installer.prepare()).rejects.toMatchObject({
      name: "BitcoinInstallerError",
      message: "The operation was refused on the device.",
      code: "user-refused",
      phase: "checking-bitcoin-app",
      recoverable: true,
    });
    expect(events.at(-1)).toEqual({ phase: "failed" });
    await expect(installer.recover()).rejects.toMatchObject({
      code: "internal",
      recoverable: false,
    });
  });

  it("requires recovery after an unknown state and mints a fresh plan", async () => {
    const installer = create("state-unknown-then-recovery");
    const events = collectEvents(installer);
    const firstPlan = await installer.prepare();

    await expect(installer.install(firstPlan)).rejects.toMatchObject({
      name: "BitcoinInstallerError",
      code: "state-unknown",
      phase: "verifying",
      recoverable: true,
    });
    expect(events.at(-1)).toEqual({ phase: "needs-recovery" });

    const recoveredPlan = await installer.recover();
    expect(recoveredPlan).not.toBe(firstPlan);
    expect(recoveredPlan.status).toBe("already-installed");
    await expect(installer.install(recoveredPlan)).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "ready",
    });
  });

  it("keeps reconnect-required separate from installation success", async () => {
    const installer = create("reconnect-required");
    const plan = await installer.prepare();

    await expect(installer.install(plan)).resolves.toEqual({
      status: "installed",
      appOpen: true,
      handoff: "reconnect-required",
    });
  });

  it("invalidates authority after forged or cross-instance plans and rejects replay", async () => {
    const first = create("install-success");
    const second = create("install-success");
    const third = create("install-success");
    const firstPlan = await first.prepare();
    const secondPlan = await second.prepare();
    const thirdPlan = await third.prepare();
    const forgedPlan = {
      status: "installation-required",
    } as unknown as BitcoinInstallPlan;

    await expect(first.install(forgedPlan)).rejects.toMatchObject({
      code: "internal",
    });
    await expect(first.install(firstPlan)).rejects.toMatchObject({
      code: "internal",
    });

    await expect(second.install(firstPlan)).rejects.toMatchObject({
      code: "internal",
    });
    await expect(second.install(secondPlan)).rejects.toMatchObject({
      code: "internal",
    });

    await expect(third.install(thirdPlan)).resolves.toMatchObject({
      status: "installed",
    });
    await expect(third.install(thirdPlan)).rejects.toMatchObject({
      code: "internal",
    });
  });

  it("makes cancellation and disposal idempotent", async () => {
    const installer = create("install-success");
    const events = collectEvents(installer);
    const preparation = installer.prepare();

    installer.cancel();
    installer.cancel();
    await expect(preparation).rejects.toMatchObject({
      code: "cancelled",
      phase: "selecting-device",
      recoverable: true,
    });
    expect(events.map(({ phase }) => phase)).toEqual([
      "selecting-device",
      "cancelled",
    ]);

    await expect(installer.prepare()).resolves.toMatchObject({
      status: "installation-required",
    });
    const firstDisposal = installer.dispose();
    const secondDisposal = installer.dispose();
    expect(secondDisposal).toBe(firstDisposal);
    await firstDisposal;
    expect(events.at(-1)).toEqual({ phase: "disposed" });
    await expect(installer.prepare()).rejects.toMatchObject({
      code: "internal",
      phase: "disposed",
    });
  });

  it("publishes the disposal latch before notifying listeners", async () => {
    const installer = create("install-success");
    let reentrantDisposal: Promise<void> | undefined;
    const disposedListener = vi.fn((event: BitcoinInstallerEvent) => {
      if (event.phase === "disposed") {
        reentrantDisposal = installer.dispose();
      }
    });
    installer.subscribe(disposedListener);

    const disposal = installer.dispose();
    await disposal;

    expect(reentrantDisposal).toBe(disposal);
    expect(disposedListener).toHaveBeenCalledTimes(1);
  });

  it("requires explicit recovery when cancelled after install dispatch", async () => {
    const installer = create("install-success");
    const events = collectEvents(installer);
    const plan = await installer.prepare();
    const installation = installer.install(plan);

    installer.cancel();
    installer.cancel();
    await expect(installation).rejects.toMatchObject({
      name: "BitcoinInstallerError",
      code: "state-unknown",
      phase: "installing",
      recoverable: true,
    });
    expect(events.at(-1)).toEqual({ phase: "needs-recovery" });

    const recoveredPlan = await installer.recover();
    expect(recoveredPlan.status).toBe("already-installed");
    await expect(installer.install(recoveredPlan)).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "ready",
    });
  });

  it.each(["install-success", "already-installed"] as const)(
    "preserves a proven %s disposition when opening is cancelled",
    async (scenario) => {
      const installer = create(scenario);
      const events = collectEvents(installer);
      installer.subscribe((event) => {
        if (event.phase === "opening-bitcoin") {
          installer.cancel();
          installer.cancel();
        }
      });
      const plan = await installer.prepare();

      await expect(installer.install(plan)).resolves.toEqual({
        status:
          scenario === "already-installed" ? "already-installed" : "installed",
        appOpen: false,
        handoff: "ready",
      });
      expect(events.at(-1)).toEqual({ phase: "ready-for-webusb" });
      expect(events.some(({ phase }) => phase === "needs-recovery")).toBe(
        false,
      );
      expect(events.some(({ phase }) => phase === "cancelled")).toBe(false);
    },
  );

  it("does not interrupt release after disposition is proven", async () => {
    const installer = create("already-installed");
    const events = collectEvents(installer);
    installer.subscribe((event) => {
      if (event.phase === "releasing-device") {
        installer.cancel();
        installer.cancel();
      }
    });
    const plan = await installer.prepare();

    await expect(installer.install(plan)).resolves.toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "ready",
    });
    expect(events.at(-1)).toEqual({ phase: "ready-for-webusb" });
  });

  it("never calls verification cancellation safely cancelled", async () => {
    const installer = create("install-success");
    const events = collectEvents(installer);
    const cancelAtVerification = installer.subscribe((event) => {
      if (event.phase === "verifying") installer.cancel();
    });
    const plan = await installer.prepare();

    await expect(installer.install(plan)).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
      recoverable: true,
    });
    expect(events.at(-1)).toEqual({ phase: "needs-recovery" });
    expect(events.some(({ phase }) => phase === "cancelled")).toBe(false);
    cancelAtVerification();
  });

  it("contains listener failures and supports idempotent unsubscribe", async () => {
    const installer = create("already-installed");
    const healthyListener = vi.fn();
    const unsubscribeFailing = installer.subscribe(() => {
      throw new Error("view failure");
    });
    const unsubscribeHealthy = installer.subscribe(healthyListener);

    await expect(installer.prepare()).resolves.toMatchObject({
      status: "already-installed",
    });
    expect(healthyListener).toHaveBeenCalledTimes(5);
    unsubscribeFailing();
    unsubscribeFailing();
    unsubscribeHealthy();
    unsubscribeHealthy();
  });

  it("does not touch hardware, network, storage, console, or signing APIs", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const consoleSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
    ];
    const localStorageGet = vi.spyOn(Storage.prototype, "getItem");
    const localStorageSet = vi.spyOn(Storage.prototype, "setItem");
    const previousHidDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "hid",
    );
    const hidRead = vi.fn();
    Object.defineProperty(navigator, "hid", {
      configurable: true,
      get: hidRead,
    });

    try {
      const installer = create("install-success");
      const plan = await installer.prepare();
      const result = await installer.install(plan);

      expect(result).toEqual({
        status: "installed",
        appOpen: true,
        handoff: "ready",
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(hidRead).not.toHaveBeenCalled();
      expect(localStorageGet).not.toHaveBeenCalled();
      expect(localStorageSet).not.toHaveBeenCalled();
      for (const consoleSpy of consoleSpies) {
        expect(consoleSpy).not.toHaveBeenCalled();
      }
    } finally {
      if (previousHidDescriptor) {
        Object.defineProperty(navigator, "hid", previousHidDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "hid");
      }
    }
  });

  it("keeps the scenario vocabulary finite and rejects invalid timing", () => {
    expect(SIMULATED_BITCOIN_INSTALLER_SCENARIOS).toEqual([
      "install-success",
      "already-installed",
      "user-refused",
      "state-unknown-then-recovery",
      "reconnect-required",
    ]);
    expect(() =>
      createSimulatedBitcoinInstaller({
        scenario: "install-success",
        stepDelayMs: -1,
      }),
    ).toThrow(TypeError);
  });
});
