import type { Clock, ClockTimer } from "./clock";
import type { HidDeviceSnapshot, HidPort } from "./hidPort";

const intrinsicPromise = Promise;
const intrinsicPromiseThen = Promise.prototype.then;

/** Far above a plausible browser grant set, but finite against hostile arrays. */
const MAX_HID_SNAPSHOT_DEVICES = 64;

const SNAPSHOT_FIELDS = [
  "identity",
  "vendorId",
  "productId",
  "opened",
] as const;

export interface CaptureHidSnapshotOptions {
  readonly clock: Clock;
  readonly hidPort: HidPort;
  readonly snapshotTimeoutMs: number;
}

export interface HidSnapshotCaptureHandle {
  readonly result: Promise<readonly HidDeviceSnapshot[] | undefined>;
  cancel(): void;
}

function isObjectLike(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
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

function readOwnDataValues(
  value: object,
  shouldStop: () => boolean,
): readonly unknown[] | undefined {
  const values: unknown[] = [];
  for (const field of SNAPSHOT_FIELDS) {
    if (shouldStop()) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (shouldStop()) return undefined;
    if (!descriptor || !("value" in descriptor)) return undefined;
    values.push(descriptor.value);
  }
  return values;
}

/** Copy a bounded dense container into package-owned immutable records. */
function copySnapshotContainer(
  value: unknown,
  shouldStop: () => boolean,
): readonly HidDeviceSnapshot[] | undefined {
  try {
    if (shouldStop()) return undefined;
    if (!Array.isArray(value)) return undefined;
    if (shouldStop()) return undefined;

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (shouldStop()) return undefined;
    if (
      !lengthDescriptor ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > MAX_HID_SNAPSHOT_DEVICES
    ) {
      return undefined;
    }

    const snapshots: HidDeviceSnapshot[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      if (shouldStop()) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (shouldStop()) return undefined;
      if (
        !descriptor ||
        !("value" in descriptor) ||
        !isObjectLike(descriptor.value)
      ) {
        return undefined;
      }

      const fields = readOwnDataValues(descriptor.value, shouldStop);
      if (!fields || shouldStop()) return undefined;
      const [identity, vendorId, productId, opened] = fields;
      if (
        !isObjectLike(identity) ||
        !isUsbIdentifier(vendorId) ||
        !isUsbIdentifier(productId) ||
        typeof opened !== "boolean"
      ) {
        return undefined;
      }
      snapshots.push(
        Object.freeze({
          identity: identity as HidDeviceSnapshot["identity"],
          vendorId,
          productId,
          opened,
        }),
      );
    }
    if (shouldStop()) return undefined;
    return Object.freeze(snapshots);
  } catch {
    return undefined;
  }
}

function isReviewedDuration(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Start one immediate, read-only HID snapshot and bound only its observation.
 * The browser operation itself is not assumed to be abortable.
 */
export function captureHidSnapshot({
  clock,
  hidPort,
  snapshotTimeoutMs,
}: CaptureHidSnapshotOptions): HidSnapshotCaptureHandle {
  let settled = false;
  let timerAssigned = false;
  let timerClearRequested = false;
  let timerCleared = false;
  let timer: ClockTimer | undefined;
  let resolveResult!: (
    snapshots: readonly HidDeviceSnapshot[] | undefined,
  ) => void;

  const result = new Promise<readonly HidDeviceSnapshot[] | undefined>(
    (resolve) => {
      resolveResult = resolve;
    },
  );

  const clearTimerOnce = (): void => {
    if (timerCleared) return;
    if (!timerAssigned) {
      timerClearRequested = true;
      return;
    }

    timerCleared = true;
    timerClearRequested = false;
    const ownedTimer = timer as ClockTimer;
    timer = undefined;
    try {
      clock.clearTimeout(ownedTimer);
    } catch {
      // Timer cleanup is best effort and cannot expose host details.
    }
  };

  const finish = (
    snapshots: readonly HidDeviceSnapshot[] | undefined,
  ): void => {
    if (settled) return;
    settled = true;
    clearTimerOnce();
    resolveResult(snapshots);
  };

  const handle: HidSnapshotCaptureHandle = Object.freeze({
    result,
    cancel: () => finish(undefined),
  });

  if (isReviewedDuration(snapshotTimeoutMs)) {
    try {
      const scheduledTimer = clock.setTimeout(
        () => finish(undefined),
        snapshotTimeoutMs,
      );
      timer = scheduledTimer;
      timerAssigned = true;
      if (timerClearRequested || settled) clearTimerOnce();
    } catch {
      finish(undefined);
    }
  } else {
    finish(undefined);
  }

  // This invocation deliberately remains in the caller's stack even when a
  // synchronous fake timer or hostile clock has already failed the capture.
  let source: unknown;
  try {
    source = hidPort.getGrantedDevices();
  } catch {
    finish(undefined);
    return handle;
  }

  // The read itself is mandatory and synchronous. Once an earlier timer,
  // cancellation, or setup failure has settled the capture, do not reflect on
  // the returned value merely to observe work that this capture no longer owns.
  if (settled) return handle;

  if (!isObjectLike(source)) {
    finish(undefined);
    return handle;
  }

  let ownConstructor: PropertyDescriptor | undefined;
  let ownThen: PropertyDescriptor | undefined;
  let sourcePrototype: object | null;
  try {
    ownConstructor = Object.getOwnPropertyDescriptor(source, "constructor");
    if (settled) return handle;
    ownThen = Object.getOwnPropertyDescriptor(source, "then");
    if (settled) return handle;
    sourcePrototype = Object.getPrototypeOf(source);
    if (settled) return handle;
  } catch {
    finish(undefined);
    return handle;
  }

  // Only an unmodified base Promise may contribute snapshot evidence. The
  // intrinsic call below remains the actual internal-slot brand check.
  const evidenceEligible =
    sourcePrototype === intrinsicPromise.prototype &&
    ownConstructor === undefined &&
    ownThen === undefined;

  let constructorReady = false;
  let constructorAdded = false;
  let constructorToRestore: PropertyDescriptor | undefined;
  let constructorRestored = true;

  if (ownConstructor === undefined) {
    // A clean same-realm base Promise (including one with an invalid own
    // `then`) safely inherits the captured intrinsic constructor. Do not add
    // and delete an observable own property on this ordinary path.
    if (sourcePrototype === intrinsicPromise.prototype) {
      constructorReady = true;
    } else {
      try {
        Object.defineProperty(source, "constructor", {
          configurable: true,
          enumerable: false,
          value: intrinsicPromise,
          writable: true,
        });
        constructorReady = true;
        constructorAdded = true;
      } catch {
        // A non-extensible foreign Promise shape remains fail-closed. There is
        // no safe way to attach without potentially executing foreign species.
      }
    }
  } else if (
    "value" in ownConstructor &&
    ownConstructor.value === intrinsicPromise
  ) {
    constructorReady = true;
  } else if (ownConstructor.configurable === true) {
    try {
      Object.defineProperty(source, "constructor", {
        configurable: true,
        enumerable: ownConstructor?.enumerable ?? false,
        value: intrinsicPromise,
        writable: true,
      });
      constructorReady = true;
      constructorToRestore = ownConstructor;
    } catch {
      // Do not invoke a hostile constructor/species when it cannot be safely
      // shadowed for the single intrinsic observation.
    }
  }

  let attached = false;

  try {
    if (constructorReady) {
      Reflect.apply(intrinsicPromiseThen, source, [
        (value: unknown) => {
          if (settled) return;
          if (!(attached && evidenceEligible && constructorRestored)) {
            finish(undefined);
            return;
          }
          const snapshots = copySnapshotContainer(value, () => settled);
          if (settled) return;
          finish(snapshots);
        },
        () => finish(undefined),
      ]);
      attached = true;
    }
  } catch {
    // An unbranded value or unsafe Promise shape cannot provide evidence.
  } finally {
    if (constructorAdded) {
      try {
        const deleted = Reflect.deleteProperty(source, "constructor");
        const absent =
          Object.getOwnPropertyDescriptor(source, "constructor") === undefined;
        constructorRestored = deleted && absent;
      } catch {
        constructorRestored = false;
      }
    } else if (constructorToRestore) {
      try {
        Object.defineProperty(source, "constructor", constructorToRestore);
        constructorRestored = true;
      } catch {
        constructorRestored = false;
      }
    }
  }

  if (!(attached && evidenceEligible && constructorRestored)) finish(undefined);

  return handle;
}
