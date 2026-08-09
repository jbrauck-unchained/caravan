declare const clockTimerBrand: unique symbol;

/** Opaque timer ownership token. */
export interface ClockTimer {
  readonly [clockTimerBrand]: never;
}

export interface Clock {
  /** Civil time used for persisted/user-facing expiry semantics. */
  now(): number;
  /** Monotonic elapsed time used for safety deadlines and durations. */
  monotonicNow(): number;
  setTimeout(callback: () => void, delayMs: number): ClockTimer;
  clearTimeout(timer: ClockTimer): void;
}

function readMonotonicNow(): number {
  try {
    const performanceValue: unknown = Reflect.get(globalThis, "performance");
    if (
      (typeof performanceValue !== "object" || performanceValue === null) &&
      typeof performanceValue !== "function"
    ) {
      throw new TypeError();
    }
    const nowMethod: unknown = Reflect.get(performanceValue, "now");
    if (typeof nowMethod !== "function") throw new TypeError();
    const value: unknown = Reflect.apply(nowMethod, performanceValue, []);
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      throw new TypeError();
    }
    return value;
  } catch {
    throw new TypeError("A monotonic runtime clock is unavailable.");
  }
}

/** Production dual clock; tests should inject a fake or fake timers. */
export const systemClock: Clock = {
  now: () => Date.now(),
  monotonicNow: readMonotonicNow,
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs) as unknown as ClockTimer,
  clearTimeout: (timer) => {
    globalThis.clearTimeout(
      timer as unknown as ReturnType<typeof globalThis.setTimeout>,
    );
  },
};
