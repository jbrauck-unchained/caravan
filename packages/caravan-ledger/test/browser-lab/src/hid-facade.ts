export {};

type HidFixture =
  | "chooser-cancelled"
  | "malformed"
  | "no-hid"
  | "supported"
  | "throwing";

interface HidFacadeState {
  readonly fixture: HidFixture;
  getDevicesCalls: number;
  requestDeviceCalls: number;
  readonly requestDeviceActivation: boolean[];
}

declare global {
  interface Window {
    __CARAVAN_LEDGER_HID_FACADE__: HidFacadeState;
  }
}

const fixtureValue = new URLSearchParams(window.location.search).get("fixture");
const fixtures: readonly HidFixture[] = Object.freeze([
  "chooser-cancelled",
  "malformed",
  "no-hid",
  "supported",
  "throwing",
]);
if (fixtureValue !== null && !fixtures.includes(fixtureValue as HidFixture)) {
  throw new Error("Unknown private browser-lab HID fixture.");
}
const fixture = (fixtureValue ?? "supported") as HidFixture;

const state: HidFacadeState = {
  fixture,
  getDevicesCalls: 0,
  requestDeviceCalls: 0,
  requestDeviceActivation: [],
};
window.__CARAVAN_LEDGER_HID_FACADE__ = state;

function installHid(value: unknown): void {
  Object.defineProperty(navigator, "hid", {
    configurable: true,
    enumerable: true,
    value,
  });
}

if (fixture === "no-hid") {
  // Chromium itself exposes WebHID on supported platforms. Shadow it so this
  // fixture models an actually absent API instead of inheriting the browser's
  // native implementation.
  installHid(undefined);
} else if (fixture === "malformed") {
  installHid({ getDevices: true, requestDevice: true });
} else if (fixture === "throwing") {
  Object.defineProperty(navigator, "hid", {
    configurable: true,
    get() {
      throw new Error("private HID getter failure");
    },
  });
} else if (fixture === "supported" || fixture === "chooser-cancelled") {
  const target = new EventTarget();
  installHid({
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    getDevices(): Promise<readonly unknown[]> {
      state.getDevicesCalls += 1;
      return Promise.resolve(Object.freeze([]));
    },
    requestDevice(): Promise<readonly unknown[]> {
      state.requestDeviceCalls += 1;
      state.requestDeviceActivation.push(
        navigator.userActivation?.isActive === true,
      );
      if (fixture === "chooser-cancelled" && state.requestDeviceCalls === 1) {
        // The pinned WebHID transport treats an empty chooser result as
        // NoAccessibleDeviceError. The public workflow then fails closed and
        // consumers must dispose it before preparing a fresh workflow.
        return Promise.resolve(Object.freeze([]));
      }
      return new Promise(() => undefined);
    },
  });
}
