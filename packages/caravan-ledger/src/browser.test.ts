import { systemClock } from "./internal/clock";
import type { HidPort } from "./internal/hidPort";
import { resetRuntimeLeaseForTesting } from "./internal/runtimeLease";
import { ScriptedDmk } from "./internal/testing/scriptedDmk";

const browserDependencyMocks = vi.hoisted(() => ({
  createHidPort: vi.fn(),
  createPort: vi.fn(),
}));

vi.mock("./internal/dmkAdapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./internal/dmkAdapter")>()),
  createProductionDmkPort: browserDependencyMocks.createPort,
}));

vi.mock("./internal/hidPort", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./internal/hidPort")>()),
  createBrowserHidPort: browserDependencyMocks.createHidPort,
}));

const RUNTIME_EXPORTS = [
  "BitcoinInstallerError",
  "createBitcoinAppInstaller",
  "getBitcoinInstallerSupport",
] as const;

export {};

describe("@caravan/ledger browser entry", () => {
  beforeEach(() => {
    browserDependencyMocks.createHidPort.mockReset();
    browserDependencyMocks.createPort.mockReset();
    resetRuntimeLeaseForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRuntimeLeaseForTesting();
  });

  it("exports the same reviewed runtime surface without eager runtime work", async () => {
    const browserEntry = await import("./browser");

    expect(Object.keys(browserEntry).sort()).toEqual([...RUNTIME_EXPORTS]);
    expect(browserEntry.getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "not-browser",
    });
    expect(browserEntry.createBitcoinAppInstaller()).toBeDefined();
    expect(browserDependencyMocks.createPort).not.toHaveBeenCalled();
    expect(browserDependencyMocks.createHidPort).not.toHaveBeenCalled();
  });

  it("injects the browser HID factory lazily and snapshots before the chooser", async () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      hid: {
        getDevices: vi.fn(),
        requestDevice: vi.fn(),
      },
    });
    const trace: string[] = [];
    const hidPort: HidPort = {
      getGrantedDevices: () => {
        trace.push("hid-snapshot");
        return Promise.resolve(Object.freeze([]));
      },
      subscribeToDeviceChanges: () => () => undefined,
    };
    browserDependencyMocks.createHidPort.mockImplementation(() => {
      trace.push("hid-factory");
      return hidPort;
    });
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "never" },
    ]);
    const startDiscovery = fake.startDiscovery.bind(fake);
    vi.spyOn(fake, "startDiscovery").mockImplementation(() => {
      trace.push("chooser");
      return startDiscovery();
    });
    browserDependencyMocks.createPort.mockImplementation(() => {
      trace.push("dmk-factory");
      return fake;
    });
    const browserEntry = await import("./browser");
    const installer = browserEntry.createBitcoinAppInstaller();

    expect(trace).toEqual([]);
    const preparation = installer.prepare();
    expect(trace).toEqual([
      "dmk-factory",
      "hid-factory",
      "hid-snapshot",
      "chooser",
    ]);
    installer.cancel();
    await expect(preparation).rejects.toMatchObject({
      code: "cancelled",
      phase: "selecting-device",
    });
  });
});
