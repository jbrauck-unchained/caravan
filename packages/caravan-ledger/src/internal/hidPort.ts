declare const hidDeviceIdentityBrand: unique symbol;

export const LEDGER_HID_VENDOR_ID = 0x2c97;

/** Opaque in-memory identity used only to compare browser snapshots. */
export interface HidDeviceIdentity {
  readonly [hidDeviceIdentityBrand]: never;
}

/** A package-owned reduction of a granted browser HID device. */
export interface HidDeviceSnapshot {
  readonly identity: HidDeviceIdentity;
  readonly vendorId: number;
  readonly productId: number;
  readonly opened: boolean;
}

export type HidDeviceChange =
  | {
      readonly type: "connect" | "disconnect";
      readonly device: HidDeviceSnapshot;
    }
  | { readonly type: "unavailable" };

/** Read-only browser seam used to prove release without force-closing devices. */
export interface HidPort {
  getGrantedDevices(): Promise<readonly HidDeviceSnapshot[]>;
  subscribeToDeviceChanges(
    listener: (change: HidDeviceChange) => void,
  ): () => void;
}

export class HidPortUnavailableError extends Error {
  readonly name = "HidPortUnavailableError" as const;

  constructor() {
    super("The browser HID observation boundary is unavailable.");
  }
}

interface BrowserHidConnectionEvent {
  readonly device: unknown;
}

interface BrowserHidManager {
  getDevices(): Promise<unknown>;
  addEventListener(
    type: "connect" | "disconnect",
    listener: (event: BrowserHidConnectionEvent) => void,
  ): void;
  removeEventListener(
    type: "connect" | "disconnect",
    listener: (event: BrowserHidConnectionEvent) => void,
  ): void;
}

function isObject(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function isUsbIdentifier(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 0xffff
  );
}

function readBrowserHidManager(): BrowserHidManager {
  try {
    const navigatorValue: unknown = globalThis.navigator;
    if (!isObject(navigatorValue) || !("hid" in navigatorValue)) {
      throw new HidPortUnavailableError();
    }

    const hid: unknown = Reflect.get(navigatorValue, "hid");
    if (
      !isObject(hid) ||
      typeof Reflect.get(hid, "getDevices") !== "function" ||
      typeof Reflect.get(hid, "addEventListener") !== "function" ||
      typeof Reflect.get(hid, "removeEventListener") !== "function"
    ) {
      throw new HidPortUnavailableError();
    }
    return hid as unknown as BrowserHidManager;
  } catch (error) {
    if (error instanceof HidPortUnavailableError) throw error;
    throw new HidPortUnavailableError();
  }
}

/**
 * Construct a lazy, observation-only WebHID port.
 *
 * Native HIDDevice references are held only as weak identity keys. They never
 * cross this private boundary and this adapter exposes no request/open/close
 * authority.
 */
export function createBrowserHidPort(): HidPort {
  const identities = new WeakMap<object, HidDeviceIdentity>();
  const ledgerClassifications = new WeakMap<object, boolean>();
  let manager: BrowserHidManager | undefined;

  const getManager = (): BrowserHidManager => {
    manager ??= readBrowserHidManager();
    return manager;
  };

  const snapshotDevice = (value: unknown): HidDeviceSnapshot | undefined => {
    if (!isObject(value)) throw new HidPortUnavailableError();

    let vendorId: unknown;
    try {
      vendorId = Reflect.get(value, "vendorId");
    } catch {
      throw new HidPortUnavailableError();
    }
    if (!isUsbIdentifier(vendorId)) throw new HidPortUnavailableError();
    const isLedger = vendorId === LEDGER_HID_VENDOR_ID;
    const priorClassification = ledgerClassifications.get(value);
    if (
      priorClassification !== undefined &&
      priorClassification !== isLedger
    ) {
      throw new HidPortUnavailableError();
    }
    ledgerClassifications.set(value, isLedger);
    if (!isLedger) return undefined;

    let productId: unknown;
    let opened: unknown;
    try {
      productId = Reflect.get(value, "productId");
      opened = Reflect.get(value, "opened");
    } catch {
      throw new HidPortUnavailableError();
    }
    if (
      !isUsbIdentifier(productId) ||
      typeof opened !== "boolean"
    ) {
      throw new HidPortUnavailableError();
    }

    let identity = identities.get(value);
    if (!identity) {
      identity = Object.freeze({}) as HidDeviceIdentity;
      identities.set(value, identity);
    }
    return Object.freeze({ identity, vendorId, productId, opened });
  };

  const getGrantedDevices = async (): Promise<
    readonly HidDeviceSnapshot[]
  > => {
    let values: unknown;
    try {
      values = await getManager().getDevices();
    } catch (error) {
      if (error instanceof HidPortUnavailableError) throw error;
      throw new HidPortUnavailableError();
    }
    if (!Array.isArray(values)) throw new HidPortUnavailableError();

    try {
      const snapshots: HidDeviceSnapshot[] = [];
      for (let index = 0; index < values.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(values, index)) {
          throw new HidPortUnavailableError();
        }
        const snapshot = snapshotDevice(values[index]);
        if (snapshot) snapshots.push(snapshot);
      }
      return Object.freeze(snapshots);
    } catch (error) {
      if (error instanceof HidPortUnavailableError) throw error;
      throw new HidPortUnavailableError();
    }
  };

  const subscribeToDeviceChanges = (
    listener: (change: HidDeviceChange) => void,
  ): (() => void) => {
    if (typeof listener !== "function") {
      throw new TypeError("The HID change listener must be callable.");
    }
    const hid = getManager();
    let subscribed = true;

    const notify = (change: HidDeviceChange): void => {
      if (!subscribed) return;
      try {
        listener(change);
      } catch {
        // Observation callbacks cannot interfere with browser HID events.
      }
    };
    const onConnect = (event: BrowserHidConnectionEvent): void => {
      try {
        const device = snapshotDevice(event.device);
        if (device) notify({ type: "connect", device });
      } catch {
        notify({ type: "unavailable" });
      }
    };
    const onDisconnect = (event: BrowserHidConnectionEvent): void => {
      try {
        const device = snapshotDevice(event.device);
        if (device) notify({ type: "disconnect", device });
      } catch {
        notify({ type: "unavailable" });
      }
    };

    let connectAttached = false;
    try {
      hid.addEventListener("connect", onConnect);
      connectAttached = true;
      hid.addEventListener("disconnect", onDisconnect);
    } catch {
      subscribed = false;
      if (connectAttached) {
        try {
          hid.removeEventListener("connect", onConnect);
        } catch {
          // A partial browser subscription still fails closed below.
        }
      }
      try {
        hid.removeEventListener("disconnect", onDisconnect);
      } catch {
        // The browser may have attached before reporting its failure.
      }
      throw new HidPortUnavailableError();
    }

    return () => {
      if (!subscribed) return;
      subscribed = false;
      try {
        hid.removeEventListener("connect", onConnect);
      } catch {
        // Listener cleanup is best effort and remains locally contained.
      }
      try {
        hid.removeEventListener("disconnect", onDisconnect);
      } catch {
        // Listener cleanup is best effort and remains locally contained.
      }
    };
  };

  return Object.freeze({ getGrantedDevices, subscribeToDeviceChanges });
}
