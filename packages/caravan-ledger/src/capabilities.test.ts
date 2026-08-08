import { getBitcoinInstallerSupport } from "./capabilities";

describe("getBitcoinInstallerSupport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is SSR safe", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("navigator", undefined);

    expect(getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "not-browser",
    });
  });

  it("rejects an insecure browser context", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", {});

    expect(getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "insecure-context",
    });
  });

  it("rejects missing or malformed WebHID without throwing", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { hid: { requestDevice: true } });

    expect(getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "webhid-unavailable",
    });
  });

  it("survives getters that throw", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      get hid() {
        throw new Error("sensitive getter detail");
      },
    });

    expect(getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "webhid-unavailable",
    });
  });

  it("reports capability without calling permission or enumeration APIs", () => {
    const requestDevice = vi.fn();
    const getDevices = vi.fn();
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { hid: { requestDevice, getDevices } });

    expect(getBitcoinInstallerSupport()).toEqual({ supported: true });
    expect(requestDevice).not.toHaveBeenCalled();
    expect(getDevices).not.toHaveBeenCalled();
  });
});
