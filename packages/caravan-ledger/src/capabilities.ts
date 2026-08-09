export interface BitcoinInstallerSupport {
  readonly supported: boolean;
  readonly reason?: "not-browser" | "insecure-context" | "webhid-unavailable";
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function safelyRead(target: unknown, property: PropertyKey): unknown {
  if (!isObject(target) && typeof target !== "function") {
    return undefined;
  }

  try {
    return Reflect.get(target, property);
  } catch {
    return undefined;
  }
}

/**
 * Check environment capability without requesting permission or performing an
 * external operation.
 */
export function getBitcoinInstallerSupport(): BitcoinInstallerSupport {
  const browserWindow = safelyRead(globalThis, "window");
  const browserNavigator = safelyRead(globalThis, "navigator");

  if (!isObject(browserWindow) || !isObject(browserNavigator)) {
    return { supported: false, reason: "not-browser" };
  }

  if (safelyRead(browserWindow, "isSecureContext") !== true) {
    return { supported: false, reason: "insecure-context" };
  }

  const hid = safelyRead(browserNavigator, "hid");
  if (
    !isObject(hid) ||
    typeof safelyRead(hid, "requestDevice") !== "function" ||
    typeof safelyRead(hid, "getDevices") !== "function"
  ) {
    return { supported: false, reason: "webhid-unavailable" };
  }

  return { supported: true };
}
