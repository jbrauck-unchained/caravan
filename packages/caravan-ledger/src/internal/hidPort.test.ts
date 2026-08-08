import {
  createBrowserHidPort,
  HidPortUnavailableError,
  type HidDeviceChange,
} from "./hidPort";

type BrowserChangeListener = (event: { readonly device: unknown }) => void;

interface FakeBrowserHidManager {
  readonly getDevices: ReturnType<typeof vi.fn>;
  readonly requestDevice: ReturnType<typeof vi.fn>;
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly removeEventListener: ReturnType<typeof vi.fn>;
  emit(type: "connect" | "disconnect", device: unknown): void;
  listenerCount(): number;
}

function makeManager(readDevices: () => unknown): FakeBrowserHidManager {
  const listeners = new Map<
    "connect" | "disconnect",
    Set<BrowserChangeListener>
  >([
    ["connect", new Set()],
    ["disconnect", new Set()],
  ]);
  return {
    getDevices: vi.fn(async () => readDevices()),
    requestDevice: vi.fn(),
    addEventListener: vi.fn(
      (type: "connect" | "disconnect", listener: BrowserChangeListener) => {
        listeners.get(type)?.add(listener);
      },
    ),
    removeEventListener: vi.fn(
      (type: "connect" | "disconnect", listener: BrowserChangeListener) => {
        listeners.get(type)?.delete(listener);
      },
    ),
    emit(type, device) {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener({ device });
      }
    },
    listenerCount() {
      return [...listeners.values()].reduce((sum, group) => sum + group.size, 0);
    },
  };
}

function installNavigator(manager: FakeBrowserHidManager): ReturnType<typeof vi.fn> {
  const hidGetter = vi.fn(() => manager);
  const navigatorValue = Object.create(null) as object;
  Object.defineProperty(navigatorValue, "hid", {
    configurable: true,
    get: hidGetter,
  });
  vi.stubGlobal("navigator", navigatorValue);
  return hidGetter;
}

describe("browser HID port", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is lazy and maps stable native objects to opaque stable identities", async () => {
    const close = vi.fn();
    const device = {
      vendorId: 0x2c97,
      productId: 0x4000,
      opened: true,
      close,
    };
    const manager = makeManager(() => [device]);
    const hidGetter = installNavigator(manager);

    const port = createBrowserHidPort();
    expect(hidGetter).not.toHaveBeenCalled();
    expect(manager.getDevices).not.toHaveBeenCalled();

    const first = await port.getGrantedDevices();
    device.opened = false;
    const second = await port.getGrantedDevices();

    expect(first).toEqual([
      expect.objectContaining({
        vendorId: 0x2c97,
        productId: 0x4000,
        opened: true,
      }),
    ]);
    expect(second[0].identity).toBe(first[0].identity);
    expect(second[0].opened).toBe(false);
    expect(first[0]).not.toBe(device);
    expect(Object.keys(first[0]).sort()).toEqual([
      "identity",
      "opened",
      "productId",
      "vendorId",
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(manager.requestDevice).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("filters non-Ledger devices before reading any other native metadata", async () => {
    let productIdReads = 0;
    let openedReads = 0;
    const nonLedger = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(nonLedger, {
      vendorId: { value: 0x1234 },
      productId: {
        get() {
          productIdReads += 1;
          throw new Error("must remain private");
        },
      },
      opened: {
        get() {
          openedReads += 1;
          throw new Error("must remain private");
        },
      },
    });
    const ledger = { vendorId: 0x2c97, productId: 0x4000, opened: true };
    const manager = makeManager(() => [nonLedger, ledger]);
    installNavigator(manager);
    const port = createBrowserHidPort();

    const snapshots = await port.getGrantedDevices();
    const changes: HidDeviceChange[] = [];
    const unsubscribe = port.subscribeToDeviceChanges((change) =>
      changes.push(change),
    );
    manager.emit("connect", nonLedger);
    manager.emit("disconnect", nonLedger);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ vendorId: 0x2c97 });
    expect(changes).toEqual([]);
    expect(productIdReads).toBe(0);
    expect(openedReads).toBe(0);
    unsubscribe();
  });

  it("fails closed when one native object changes vendor classification", async () => {
    let vendorId = 0x1234;
    let productIdReads = 0;
    let openedReads = 0;
    const device = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(device, {
      vendorId: { get: () => vendorId },
      productId: {
        get() {
          productIdReads += 1;
          throw new Error("must remain private");
        },
      },
      opened: {
        get() {
          openedReads += 1;
          throw new Error("must remain private");
        },
      },
    });
    const manager = makeManager(() => [device]);
    installNavigator(manager);
    const port = createBrowserHidPort();

    await expect(port.getGrantedDevices()).resolves.toEqual([]);
    vendorId = 0x2c97;
    await expect(port.getGrantedDevices()).rejects.toBeInstanceOf(
      HidPortUnavailableError,
    );

    const changes: HidDeviceChange[] = [];
    const unsubscribe = port.subscribeToDeviceChanges((change) =>
      changes.push(change),
    );
    manager.emit("connect", device);
    expect(changes).toEqual([{ type: "unavailable" }]);
    expect(productIdReads).toBe(0);
    expect(openedReads).toBe(0);
    unsubscribe();
  });

  it("maps browser change events, isolates callbacks, and cleans up once", async () => {
    const device = { vendorId: 0x2c97, productId: 0x5000, opened: true };
    const manager = makeManager(() => [device]);
    installNavigator(manager);
    const port = createBrowserHidPort();
    const changes: HidDeviceChange[] = [];

    const unsubscribe = port.subscribeToDeviceChanges((change) => {
      changes.push(change);
      if (change.type === "connect") throw new Error("consumer callback");
    });
    manager.emit("connect", device);
    manager.emit("disconnect", device);
    const snapshots = await port.getGrantedDevices();

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ type: "connect" });
    expect(changes[1]).toMatchObject({ type: "disconnect" });
    if (changes[0].type === "connect") {
      expect(changes[0].device.identity).toBe(snapshots[0].identity);
    }
    expect(manager.listenerCount()).toBe(2);

    unsubscribe();
    unsubscribe();
    expect(manager.listenerCount()).toBe(0);
    expect(manager.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it("fails the whole observation on missing, rejected, or malformed browser data", async () => {
    vi.stubGlobal("navigator", Object.create(null));
    await expect(createBrowserHidPort().getGrantedDevices()).rejects.toBeInstanceOf(
      HidPortUnavailableError,
    );

    const rejected = makeManager(() => {
      throw new Error("denied");
    });
    installNavigator(rejected);
    await expect(createBrowserHidPort().getGrantedDevices()).rejects.toBeInstanceOf(
      HidPortUnavailableError,
    );

    const malformed = makeManager(() => [
      { vendorId: 0x2c97, productId: 0x4000, opened: "yes" },
    ]);
    installNavigator(malformed);
    await expect(createBrowserHidPort().getGrantedDevices()).rejects.toBeInstanceOf(
      HidPortUnavailableError,
    );
  });

  it("reports malformed change events as unavailable without native metadata", () => {
    const manager = makeManager(() => []);
    installNavigator(manager);
    const port = createBrowserHidPort();
    const changes: HidDeviceChange[] = [];
    const unsubscribe = port.subscribeToDeviceChanges((change) =>
      changes.push(change),
    );

    manager.emit("connect", { vendorId: 0x2c97 });
    expect(changes).toEqual([{ type: "unavailable" }]);
    unsubscribe();
  });

  it("rolls back a partial browser event subscription", () => {
    const manager = makeManager(() => []);
    manager.addEventListener.mockImplementation(
      (type: "connect" | "disconnect") => {
        if (type === "disconnect") throw new Error("partial subscription");
      },
    );
    installNavigator(manager);
    const port = createBrowserHidPort();

    expect(() => port.subscribeToDeviceChanges(() => undefined)).toThrow(
      HidPortUnavailableError,
    );
    expect(manager.removeEventListener).toHaveBeenCalledTimes(2);
    expect(manager.removeEventListener).toHaveBeenCalledWith(
      "connect",
      expect.any(Function),
    );
    expect(manager.removeEventListener).toHaveBeenCalledWith(
      "disconnect",
      expect.any(Function),
    );
  });
});
