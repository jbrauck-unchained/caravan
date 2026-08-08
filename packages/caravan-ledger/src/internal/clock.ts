declare const clockTimerBrand: unique symbol;

/** Opaque timer ownership token. */
export interface ClockTimer {
  readonly [clockTimerBrand]: never;
}

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ClockTimer;
  clearTimeout(timer: ClockTimer): void;
}

/** Production wall-clock adapter; tests should inject a fake or fake timers. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs) as unknown as ClockTimer,
  clearTimeout: (timer) => {
    globalThis.clearTimeout(
      timer as unknown as ReturnType<typeof globalThis.setTimeout>,
    );
  },
};
