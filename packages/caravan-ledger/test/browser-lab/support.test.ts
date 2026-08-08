async function importBrowserEntry() {
  return import("../../src/browser");
}

describe("private browser-lab environment matrix", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("imports the browser entry safely without window or navigator", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", undefined);

    const ledger = await importBrowserEntry();

    expect(ledger.getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "not-browser",
    });
  });

  it("reports no navigator as not-browser", async () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", undefined);
    const ledger = await importBrowserEntry();

    expect(ledger.getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "not-browser",
    });
  });

  it("reports an insecure context before inspecting HID", async () => {
    const hidGetter = vi.fn();
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", {
      get hid() {
        hidGetter();
        return undefined;
      },
    });
    const ledger = await importBrowserEntry();

    expect(ledger.getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "insecure-context",
    });
    expect(hidGetter).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["malformed methods", { hid: { getDevices: true, requestDevice: true } }],
  ])("reports %s HID as unavailable", async (_name, navigatorValue) => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", navigatorValue);
    const ledger = await importBrowserEntry();

    expect(ledger.getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "webhid-unavailable",
    });
  });

  it("contains a throwing HID getter and reports it as unavailable", async () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      get hid() {
        throw new Error("private browser detail");
      },
    });
    const ledger = await importBrowserEntry();

    expect(ledger.getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "webhid-unavailable",
    });
  });

  it("probes a rejecting facade without enumeration or a chooser", async () => {
    const getDevices = vi.fn(() => Promise.reject(new Error("not called")));
    const requestDevice = vi.fn(() => Promise.reject(new Error("not called")));
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { hid: { getDevices, requestDevice } });
    const ledger = await importBrowserEntry();

    expect(ledger.getBitcoinInstallerSupport()).toEqual({ supported: true });
    expect(getDevices).not.toHaveBeenCalled();
    expect(requestDevice).not.toHaveBeenCalled();

    ledger.createBitcoinAppInstaller();
    expect(getDevices).not.toHaveBeenCalled();
    expect(requestDevice).not.toHaveBeenCalled();
  });
});
