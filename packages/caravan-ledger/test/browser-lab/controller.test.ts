import type {
  BitcoinAppInstaller,
  BitcoinInstallerEvent,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "@caravan/ledger";

import {
  BrowserLabController,
  type BrowserLabSnapshot,
  intentionallyLateDynamicImport,
} from "./src/controller";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

class Activations {
  active = false;

  run<T>(action: () => T): T {
    if (this.active) throw new Error("Nested synthetic activation.");
    this.active = true;
    try {
      return action();
    } finally {
      this.active = false;
    }
  }
}

const plan = Object.freeze({
  status: "already-installed",
}) as BitcoinInstallPlan;

const readyResult: BitcoinInstallResult = Object.freeze({
  status: "already-installed",
  appOpen: true,
  handoff: "ready",
});

const reconnectResult: BitcoinInstallResult = Object.freeze({
  status: "installed",
  appOpen: true,
  handoff: "reconnect-required",
});

function createView() {
  const snapshots: BrowserLabSnapshot[] = [];
  const events: BitcoinInstallerEvent[] = [];
  return {
    events,
    snapshots,
    view: {
      render(snapshot: BrowserLabSnapshot) {
        snapshots.push(snapshot);
      },
      renderEvent(event: BitcoinInstallerEvent) {
        events.push(event);
      },
    },
  };
}

function createInstaller(overrides: Partial<BitcoinAppInstaller>) {
  const listeners = new Set<(event: BitcoinInstallerEvent) => void>();
  const installer: BitcoinAppInstaller = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prepare: () => Promise.resolve(plan),
    install: () => Promise.resolve(readyResult),
    recover: () => Promise.resolve(plan),
    cancel: () => undefined,
    dispose: () => Promise.resolve(),
    ...overrides,
  };
  return {
    emit(event: BitcoinInstallerEvent) {
      for (const listener of listeners) listener(event);
    },
    installer,
    listeners,
  };
}

describe("private browser-lab controller", () => {
  it("invokes the preloaded prepare path in the click task and coalesces duplicate clicks", async () => {
    const activations = new Activations();
    let preparation = deferred<BitcoinInstallPlan>();
    const requestDeviceActivation: boolean[] = [];
    const prepare = vi.fn(() => {
      requestDeviceActivation.push(activations.active);
      return preparation.promise;
    });
    const fake = createInstaller({ prepare });
    const rendered = createView();
    const controller = new BrowserLabController(
      fake.installer,
      vi.fn(),
      rendered.view,
    );
    controller.start();

    const first = activations.run(() => controller.prepareFromClick());
    const duplicate = activations.run(() => controller.prepareFromClick());

    expect(duplicate).toBe(first);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(requestDeviceActivation).toEqual([true]);
    expect(controller.snapshot).toMatchObject({
      phase: "preparing",
      prepareEnabled: false,
      cancelEnabled: true,
    });

    preparation.reject({ code: "cancelled" });
    await first;
    expect(controller.snapshot).toMatchObject({
      phase: "cancelled",
      prepareEnabled: true,
      cancelEnabled: false,
    });
    expect(prepare).toHaveBeenCalledTimes(1);

    preparation = deferred<BitcoinInstallPlan>();
    const retry = activations.run(() => controller.prepareFromClick());
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(requestDeviceActivation).toEqual([true, true]);
    preparation.resolve(plan);
    await retry;
    expect(controller.snapshot).toMatchObject({
      phase: "prepared",
      installEnabled: true,
    });
  });

  it("settles explicit cancellation and renders only package-owned events", async () => {
    const preparation = deferred<BitcoinInstallPlan>();
    const cancel = vi.fn(() => preparation.reject({ code: "cancelled" }));
    const fake = createInstaller({
      cancel,
      prepare: () => preparation.promise,
    });
    const rendered = createView();
    const controller = new BrowserLabController(
      fake.installer,
      vi.fn(),
      rendered.view,
    );
    controller.start();

    const active = controller.prepareFromClick();
    fake.emit({ phase: "selecting-device", interaction: "select-device" });
    controller.cancelFromClick();
    await active;

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(rendered.events).toEqual([
      { phase: "selecting-device", interaction: "select-device" },
    ]);
    expect(controller.snapshot.phase).toBe("cancelled");
  });

  it("never starts WebUSB from a result and requires a separate ready click", async () => {
    const activations = new Activations();
    const continuationActivations: boolean[] = [];
    const openWebUsb = vi.fn(() => {
      continuationActivations.push(activations.active);
    });
    const fake = createInstaller({});
    const rendered = createView();
    const controller = new BrowserLabController(
      fake.installer,
      openWebUsb,
      rendered.view,
    );
    controller.start();

    controller.acceptResult(readyResult);
    await Promise.resolve();
    expect(openWebUsb).not.toHaveBeenCalled();
    expect(controller.snapshot).toMatchObject({
      phase: "ready",
      continuationEnabled: true,
    });

    const continued = activations.run(() => controller.continueFromClick());
    expect(openWebUsb).toHaveBeenCalledTimes(1);
    expect(continuationActivations).toEqual([true]);
    await expect(continued).resolves.toBe(true);
  });

  it("keeps reconnect-required disabled even if continuation is called", async () => {
    const openWebUsb = vi.fn();
    const fake = createInstaller({});
    const rendered = createView();
    const controller = new BrowserLabController(
      fake.installer,
      openWebUsb,
      rendered.view,
    );
    controller.start();

    controller.acceptResult(reconnectResult);

    expect(controller.snapshot).toMatchObject({
      phase: "reconnect-required",
      continuationEnabled: false,
    });
    await expect(controller.continueFromClick()).resolves.toBe(false);
    expect(openWebUsb).not.toHaveBeenCalled();
  });

  it("contains asynchronous WebUSB continuation failures", async () => {
    const openWebUsb = vi.fn(() =>
      Promise.reject(new Error("private failure")),
    );
    const fake = createInstaller({});
    const rendered = createView();
    const controller = new BrowserLabController(
      fake.installer,
      openWebUsb,
      rendered.view,
    );
    controller.start();
    controller.acceptResult(readyResult);

    await expect(controller.continueFromClick()).resolves.toBe(false);

    expect(openWebUsb).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.continuationEnabled).toBe(false);
  });

  it("models chooser dismissal retry with a disposed, freshly created workflow", async () => {
    const activations = new Activations();
    const firstPreparation = deferred<BitcoinInstallPlan>();
    const firstDispose = vi.fn(() => Promise.resolve());
    const first = createInstaller({
      dispose: firstDispose,
      prepare: () => firstPreparation.promise,
    });
    const firstView = createView();
    const firstController = new BrowserLabController(
      first.installer,
      vi.fn(),
      firstView.view,
    );
    firstController.start();

    const dismissed = activations.run(() => firstController.prepareFromClick());
    firstPreparation.reject({ code: "no-device-selected" });
    await dismissed;
    expect(firstController.snapshot).toMatchObject({
      phase: "failed",
      prepareEnabled: false,
    });

    await firstController.dispose();
    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(firstController.snapshot.phase).toBe("disposed");

    const secondPreparation = deferred<BitcoinInstallPlan>();
    const secondActivation: boolean[] = [];
    const second = createInstaller({
      prepare: () => {
        secondActivation.push(activations.active);
        return secondPreparation.promise;
      },
    });
    const secondView = createView();
    const secondController = new BrowserLabController(
      second.installer,
      vi.fn(),
      secondView.view,
    );
    secondController.start();

    const retry = activations.run(() => secondController.prepareFromClick());
    expect(secondActivation).toEqual([true]);
    secondPreparation.resolve(plan);
    await retry;
    expect(secondController.snapshot.phase).toBe("prepared");
    await secondController.dispose();
  });

  it("documents first dynamic import after click as an invalid activation path", async () => {
    const activations = new Activations();
    let observedActivation: boolean | undefined;

    const operation = activations.run(() =>
      intentionallyLateDynamicImport(
        () => Promise.resolve({ loaded: true }),
        () => {
          observedActivation = activations.active;
        },
      ),
    );
    await operation;

    expect(observedActivation).toBe(false);
  });

  it("unsubscribes and disposes without exposing a public test seam", async () => {
    const dispose = vi.fn(() => Promise.resolve());
    const fake = createInstaller({ dispose });
    const rendered = createView();
    const controller = new BrowserLabController(
      fake.installer,
      vi.fn(),
      rendered.view,
    );
    controller.start();
    expect(fake.listeners.size).toBe(1);

    await controller.dispose();

    expect(fake.listeners.size).toBe(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe("disposed");
  });
});
