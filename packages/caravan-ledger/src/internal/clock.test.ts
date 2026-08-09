import { systemClock } from "./clock";

describe("systemClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("provides injectable time and cancellable timers", () => {
    const callback = vi.fn();
    const monotonicStartedAt = systemClock.monotonicNow();
    const timer = systemClock.setTimeout(callback, 25);

    expect(systemClock.now()).toBe(Date.parse("2026-08-07T00:00:00.000Z"));
    vi.setSystemTime(new Date("2036-08-07T00:00:00.000Z"));
    expect(systemClock.monotonicNow()).toBe(monotonicStartedAt);
    systemClock.clearTimeout(timer);
    vi.advanceTimersByTime(25);
    expect(systemClock.monotonicNow()).toBe(monotonicStartedAt + 25);
    expect(callback).not.toHaveBeenCalled();
  });
});
