import { systemClock } from "./clock";
import { discoverOneDevice, DiscoveryBoundaryError } from "./discovery";
import type { DmkDiscoveredDevice } from "./dmkPort";
import { ScriptedDmk } from "./testing/scriptedDmk";

const firstDevice: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "first-internal-device",
});

const secondDevice: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "second-internal-device",
});

describe("single-device discovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts and subscribes in the invocation stack before returning", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "never" },
    ]);

    const attempt = discoverOneDevice(fake);
    expect(fake.calls.map((call) => call.type)).toEqual([
      "start-discovery",
      "subscribe",
    ]);

    attempt.cancel();
    await expect(attempt.result).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("accepts exactly the first synchronous device and ignores duplicates", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "next", value: firstDevice },
      { type: "next", value: secondDevice, afterCancel: true },
      { type: "complete", afterCancel: true },
    ]);

    await expect(discoverOneDevice(fake).result).resolves.toBe(firstDevice);
    expect(fake.resources()).toMatchObject({
      discoveryCount: 1,
      cancelCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("normalizes a zero-emission completion and cleans up", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "complete" },
    ]);

    await expect(discoverOneDevice(fake).result).rejects.toEqual(
      new DiscoveryBoundaryError("no-device-selected"),
    );
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("preserves the observable error over cleanup", async () => {
    const operationError = new Error("symbolic chooser failure");
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "error", error: operationError },
    ]);

    await expect(discoverOneDevice(fake).result).rejects.toBe(operationError);
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("settles cancellation once and ignores a late chooser result", async () => {
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "next", value: firstDevice, atMs: 10, afterCancel: true },
      { type: "complete", atMs: 20, afterCancel: true },
    ]);
    const attempt = discoverOneDevice(fake);
    const cancellation = expect(attempt.result).rejects.toMatchObject({
      kind: "cancelled",
    });

    attempt.cancel();
    attempt.cancel();
    attempt.dispose();
    await vi.advanceTimersByTimeAsync(20);

    await cancellation;
    expect(fake.calls.filter((call) => call.type === "next")).toHaveLength(1);
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("cleans up and rejects when subscription throws synchronously", async () => {
    const subscriptionError = new Error("symbolic subscription failure");
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "throw-on-subscribe", error: subscriptionError },
    ]);

    await expect(discoverOneDevice(fake).result).rejects.toBe(
      subscriptionError,
    );
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("rejects a synchronous start failure without retrying", async () => {
    const fake = new ScriptedDmk(systemClock);

    await expect(discoverOneDevice(fake).result).rejects.toThrow(
      "No discovery script is queued",
    );
    expect(fake.resources()).toMatchObject({
      discoveryCount: 0,
      cancelCount: 0,
    });
  });
});
