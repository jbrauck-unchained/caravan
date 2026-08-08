import { runInNewContext } from "node:vm";

import { systemClock, type Clock, type ClockTimer } from "./clock";
import { LEDGER_HID_VENDOR_ID, type HidReleaseCandidate } from "./hidCandidate";
import type {
  HidDeviceChange,
  HidDeviceIdentity,
  HidDeviceSnapshot,
  HidPort,
} from "./hidPort";
import { PROVISIONAL_HID_RELEASE_POLICY } from "./hidReleasePolicy";
import { createHidReleaseBarrier } from "./waitForHidRelease";

type SnapshotSource =
  | readonly HidDeviceSnapshot[]
  | Promise<readonly HidDeviceSnapshot[]>
  | Error;

class FakeHidPort implements HidPort {
  source: () => SnapshotSource;

  calls = 0;

  inFlight = 0;

  maxInFlight = 0;

  unsubscribeCalls = 0;

  onRead: (() => void) | undefined;

  onSubscribe: (() => void) | undefined;

  subscribeError: Error | undefined;

  readonly listeners = new Set<(change: HidDeviceChange) => void>();

  constructor(source: () => SnapshotSource) {
    this.source = source;
  }

  getGrantedDevices(): Promise<readonly HidDeviceSnapshot[]> {
    this.calls += 1;
    this.onRead?.();
    let value: SnapshotSource;
    try {
      value = this.source();
    } catch (error) {
      return Promise.reject(error);
    }
    if (value instanceof Error) return Promise.reject(value);

    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    return Promise.resolve(value).then(
      (snapshots) => {
        this.inFlight -= 1;
        return snapshots;
      },
      (error: unknown) => {
        this.inFlight -= 1;
        throw error;
      },
    );
  }

  subscribeToDeviceChanges(
    listener: (change: HidDeviceChange) => void,
  ): () => void {
    if (this.subscribeError) throw this.subscribeError;
    this.listeners.add(listener);
    this.onSubscribe?.();
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.unsubscribeCalls += 1;
      this.listeners.delete(listener);
    };
  }

  emit(change: HidDeviceChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

class RawHidPort implements HidPort {
  calls = 0;

  unsubscribeCalls = 0;

  readonly listeners = new Set<(change: HidDeviceChange) => void>();

  constructor(readonly source: () => unknown) {}

  getGrantedDevices(): Promise<readonly HidDeviceSnapshot[]> {
    this.calls += 1;
    return this.source() as Promise<readonly HidDeviceSnapshot[]>;
  }

  subscribeToDeviceChanges(
    listener: (change: HidDeviceChange) => void,
  ): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.unsubscribeCalls += 1;
      this.listeners.delete(listener);
    };
  }
}

function identity(): HidDeviceIdentity {
  return Object.freeze({}) as HidDeviceIdentity;
}

function snapshot(
  deviceIdentity: HidDeviceIdentity,
  opened: boolean,
  productId = 0x4000,
  vendorId = LEDGER_HID_VENDOR_ID,
): HidDeviceSnapshot {
  return Object.freeze({
    identity: deviceIdentity,
    vendorId,
    productId,
    opened,
  });
}

function uniqueCandidate(
  selected: HidDeviceIdentity,
  peers: readonly HidDeviceIdentity[] = [],
  openPeers: readonly HidDeviceIdentity[] = [],
): HidReleaseCandidate {
  return Object.freeze({
    kind: "unique",
    identity: selected,
    modelId: "nanoX",
    productId: 0x4000,
    knownPeerIdentities: Object.freeze([...peers]),
    knownOpenPeerIdentities: Object.freeze([...openPeers]),
  });
}

async function isPending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  return !settled;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

class ManualClock implements Clock {
  monotonicTime = 0;

  private nextHandle = 0;

  private readonly timers = new Map<
    number,
    { readonly callback: () => void; readonly delayMs: number }
  >();

  now(): number {
    return 0;
  }

  monotonicNow(): number {
    return this.monotonicTime;
  }

  setTimeout(callback: () => void, delayMs: number): ClockTimer {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.set(handle, { callback, delayMs });
    return handle as unknown as ClockTimer;
  }

  clearTimeout(timer: ClockTimer): void {
    this.timers.delete(timer as unknown as number);
  }

  hasDelay(delayMs: number): boolean {
    return [...this.timers.values()].some((timer) => timer.delayMs === delayMs);
  }

  fireByDelay(delayMs: number): void {
    const entry = [...this.timers.entries()].find(
      ([, timer]) => timer.delayMs === delayMs,
    );
    if (!entry) throw new Error(`No timer has delay ${delayMs}.`);
    this.timers.delete(entry[0]);
    entry[1].callback();
  }
}

const EDGE_POLICY = Object.freeze({
  snapshotTimeoutMs: 11,
  disconnectTimeoutMs: 12,
  pollIntervalMs: 13,
  reconnectQuietPeriodMs: 17,
  releaseDeadlineMs: 101,
});

class ProgrammableClock implements Clock {
  readonly monotonicValues: Array<number | Error>;

  readonly timers: Array<{
    readonly callback: () => void;
    cleared: boolean;
    readonly delayMs: number;
    readonly handle: object;
  }> = [];

  readonly synchronousDelays = new Set<number>();

  onSchedule: ((delayMs: number) => void) | undefined;

  onClear: ((delayMs: number) => void) | undefined;

  constructor(values: Array<number | Error> = [0]) {
    this.monotonicValues = values;
  }

  now(): number {
    return 0;
  }

  monotonicNow(): number {
    const value =
      this.monotonicValues.length > 1
        ? this.monotonicValues.shift()
        : this.monotonicValues[0];
    if (value instanceof Error) throw value;
    return value ?? 0;
  }

  setTimeout(callback: () => void, delayMs: number): ClockTimer {
    const handle = Object.freeze({});
    const timer = { callback, cleared: false, delayMs, handle };
    this.timers.push(timer);
    this.onSchedule?.(delayMs);
    if (this.synchronousDelays.has(delayMs)) callback();
    return handle as ClockTimer;
  }

  clearTimeout(timer: ClockTimer): void {
    const entry = this.timers.find((candidate) => candidate.handle === timer);
    if (entry) {
      entry.cleared = true;
      this.onClear?.(entry.delayMs);
    }
  }

  fireByDelay(delayMs: number, includeCleared = false): void {
    const entry = this.timers.find(
      (candidate) =>
        candidate.delayMs === delayMs && (includeCleared || !candidate.cleared),
    );
    if (!entry) throw new Error(`No timer has delay ${delayMs}.`);
    entry.cleared = true;
    entry.callback();
  }
}

describe("HID release barrier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["snapshotTimeoutMs", 0],
    ["disconnectTimeoutMs", 0],
    ["pollIntervalMs", 0],
    ["reconnectQuietPeriodMs", 0],
    ["releaseDeadlineMs", 0],
    [
      "releaseDeadlineMs",
      PROVISIONAL_HID_RELEASE_POLICY.reconnectQuietPeriodMs,
    ],
  ] as const)(
    "rejects an invalid %s policy before observing HID",
    (key, value) => {
      const port = new FakeHidPort(() => []);

      expect(() =>
        createHidReleaseBarrier({
          candidate: { kind: "none" },
          clock: systemClock,
          hidPort: port,
          policy: {
            ...PROVISIONAL_HID_RELEASE_POLICY,
            [key]: value,
          },
        }),
      ).toThrow("The HID release timing policy is invalid.");
      expect(port.calls).toBe(0);
      expect(port.listeners.size).toBe(0);
    },
  );

  it.each([
    ["non-object", null],
    [
      "missing identity",
      {
        identity: null,
        vendorId: LEDGER_HID_VENDOR_ID,
        productId: 0x4000,
        opened: true,
      },
    ],
    [
      "invalid vendor",
      {
        identity: identity(),
        vendorId: -1,
        productId: 0x4000,
        opened: true,
      },
    ],
    [
      "invalid product",
      {
        identity: identity(),
        vendorId: LEDGER_HID_VENDOR_ID,
        productId: -1,
        opened: true,
      },
    ],
    [
      "invalid opened flag",
      {
        identity: identity(),
        vendorId: LEDGER_HID_VENDOR_ID,
        productId: 0x4000,
        opened: "yes",
      },
    ],
  ] as const)(
    "fails closed for a %s injected HID change record",
    async (_label, record) => {
      const selected = identity();
      const port = new FakeHidPort(() => [snapshot(selected, true)]);
      const barrier = createHidReleaseBarrier({
        candidate: uniqueCandidate(selected),
        clock: systemClock,
        hidPort: port,
      });
      await barrier.arm();

      port.emit({ type: "disconnect", device: record } as never);

      await expect(barrier.wait()).resolves.toBe("unavailable");
      expect(port.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("fails closed when an injected HID change accessor throws", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    const hostileDevice = Object.defineProperty({}, "identity", {
      get: () => {
        throw new Error("private-change-accessor-canary");
      },
    });

    port.emit({ type: "disconnect", device: hostileDevice } as never);

    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("owns synchronous terminal change cleanup before subscription returns", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    port.onSubscribe = () => {
      port.emit({ type: "unavailable" });
    };
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });

    await barrier.arm();

    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(port.unsubscribeCalls).toBe(1);
    expect(port.listeners.size).toBe(0);
    expect(port.calls).toBe(0);
  });

  it("fails closed when one poll repeats an in-memory HID identity", async () => {
    const selected = identity();
    let current: readonly HidDeviceSnapshot[] = [snapshot(selected, true)];
    const port = new FakeHidPort(() => current);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    current = [snapshot(selected, true), snapshot(selected, true)];

    const result = barrier.wait();
    await vi.advanceTimersByTimeAsync(
      PROVISIONAL_HID_RELEASE_POLICY.pollIntervalMs,
    );

    await expect(result).resolves.toBe("unavailable");
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases immediately after an observed logical opened-to-closed change", async () => {
    const selected = identity();
    let opened = true;
    const port = new FakeHidPort(() => [snapshot(selected, opened)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });

    await barrier.arm();
    opened = false;
    await expect(barrier.wait()).resolves.toBe("released");
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("polls one request at a time until delayed logical close", async () => {
    const selected = identity();
    let opened = true;
    const port = new FakeHidPort(() => [snapshot(selected, opened)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();

    const result = barrier.wait();
    await vi.advanceTimersByTimeAsync(100);
    opened = false;
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBe("released");
    expect(port.maxInFlight).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requires the exact 6.5 second quiet window before accepting removal", async () => {
    const selected = identity();
    let present = true;
    const port = new FakeHidPort(() =>
      present ? [snapshot(selected, true)] : [],
    );
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    present = false;

    const result = barrier.wait();
    await vi.advanceTimersByTimeAsync(6_499);
    expect(await isPending(result)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("released");
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts removal quiet time at the first observed absence", async () => {
    const selected = identity();
    let present = true;
    const port = new FakeHidPort(() =>
      present ? [snapshot(selected, true)] : [],
    );
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();

    const result = barrier.wait();
    await vi.advanceTimersByTimeAsync(3_000);
    present = false;
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(6_499);
    expect(await isPending(result)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("released");
  });

  it("cancels removal quiet time on polling-only reappearance and restarts it", async () => {
    const selected = identity();
    let present = false;
    const port = new FakeHidPort(() =>
      present ? [snapshot(selected, true)] : [],
    );
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    present = true;
    await barrier.arm();
    present = false;

    const result = barrier.wait();
    await vi.advanceTimersByTimeAsync(3_000);
    present = true;
    await vi.advanceTimersByTimeAsync(100);
    present = false;
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(3_300);
    expect(await isPending(result)).toBe(true);
    await vi.advanceTimersByTimeAsync(3_199);
    expect(await isPending(result)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("released");
  });

  it("uses timer progression rather than forward or backward wall-clock jumps", async () => {
    const selected = identity();
    let present = true;
    const port = new FakeHidPort(() =>
      present ? [snapshot(selected, true)] : [],
    );
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    present = false;

    const result = barrier.wait();
    vi.setSystemTime(86_400_000);
    expect(await isPending(result)).toBe(true);
    vi.setSystemTime(-86_400_000);
    await vi.advanceTimersByTimeAsync(6_499);
    expect(await isPending(result)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("released");
  });

  it("restarts physical-disconnect quiet evidence and never exceeds the deadline", async () => {
    const selected = identity();
    let present = true;
    const port = new FakeHidPort(() =>
      present ? [snapshot(selected, true)] : [],
    );
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    present = false;
    const result = barrier.wait();

    await vi.advanceTimersByTimeAsync(3_000);
    port.emit({ type: "disconnect", device: snapshot(selected, false) });
    await vi.advanceTimersByTimeAsync(6_499);
    expect(await isPending(result)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe("released");
  });

  it("times out when a late disconnect cannot fit a full quiet window", async () => {
    const selected = identity();
    let present = true;
    const port = new FakeHidPort(() =>
      present ? [snapshot(selected, true)] : [],
    );
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    present = false;
    const result = barrier.wait();

    await vi.advanceTimersByTimeAsync(4_000);
    port.emit({ type: "disconnect", device: snapshot(selected, false) });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(await isPending(result)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("timed-out");
  });

  it("fails ambiguous on any matching-model reconnect or unknown replacement", async () => {
    const selected = identity();
    const replacement = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    const result = barrier.wait();
    port.emit({ type: "connect", device: snapshot(replacement, false) });
    await expect(result).resolves.toBe("ambiguous");

    const pollingPort = new FakeHidPort(() => [snapshot(selected, true)]);
    const pollingBarrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: pollingPort,
    });
    await pollingBarrier.arm();
    pollingPort.source = () => [snapshot(replacement, false)];
    await expect(pollingBarrier.wait()).resolves.toBe("ambiguous");
  });

  it("fails closed when the selected identity changes vendor or product", async () => {
    const selected = identity();
    for (const [vendorId, productId] of [
      [0x1234, 0x4000],
      [LEDGER_HID_VENDOR_ID, 0x4001],
      [LEDGER_HID_VENDOR_ID, 0x6000],
    ] as const) {
      let current = snapshot(selected, true);
      const port = new FakeHidPort(() => [current]);
      const barrier = createHidReleaseBarrier({
        candidate: uniqueCandidate(selected),
        clock: systemClock,
        hidPort: port,
      });
      await barrier.arm();
      current = snapshot(selected, false, productId, vendorId);

      await expect(barrier.wait()).resolves.toBe("unavailable");
    }
  });

  it("ignores other models and known closed peers", async () => {
    const selected = identity();
    const peer = identity();
    const stax = identity();
    let opened = true;
    const port = new FakeHidPort(() => [
      snapshot(selected, opened),
      snapshot(peer, false),
      snapshot(stax, true, 0x6000),
    ]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected, [peer]),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    const result = barrier.wait();
    port.emit({ type: "connect", device: snapshot(stax, true, 0x6000) });
    opened = false;
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe("released");
  });

  it("treats a known closed peer becoming opened as ambiguous", async () => {
    const selected = identity();
    const peer = identity();
    let peerOpened = false;
    const port = new FakeHidPort(() => [
      snapshot(selected, true),
      snapshot(peer, peerOpened),
    ]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected, [peer]),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    const result = barrier.wait();
    peerOpened = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBe("ambiguous");
  });

  it("tolerates a peer that was already open when ownership was selected", async () => {
    const selected = identity();
    const peer = identity();
    let selectedOpened = true;
    const port = new FakeHidPort(() => [
      snapshot(selected, selectedOpened),
      snapshot(peer, true),
    ]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected, [peer], [peer]),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    selectedOpened = false;

    await expect(barrier.wait()).resolves.toBe("released");
  });

  it("rejects a raw non-Promise snapshot result at the hardened boundary", async () => {
    const selected = identity();
    const port = new RawHidPort(() => [snapshot(selected, true)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(port.calls).toBe(1);
    expect(port.unsubscribeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses an immutable capture when the raw record mutates during timer cleanup", async () => {
    const selected = identity();
    const mutable = {
      identity: selected,
      vendorId: LEDGER_HID_VENDOR_ID,
      productId: 0x4000,
      opened: true,
    };
    let mutated = false;
    const reentrantClock: Clock = {
      now: () => systemClock.now(),
      monotonicNow: () => systemClock.monotonicNow(),
      setTimeout: (callback, delayMs) =>
        systemClock.setTimeout(callback, delayMs),
      clearTimeout: (timer) => {
        if (!mutated) {
          mutated = true;
          mutable.vendorId = 0x1234;
          mutable.productId = 0x6000;
          mutable.opened = false;
        }
        systemClock.clearTimeout(timer);
      },
    };
    const port = new RawHidPort(() => Promise.resolve([mutable]));
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: reentrantClock,
      hidPort: port,
    });

    await barrier.arm();
    expect(mutated).toBe(true);
    expect(port.listeners.size).toBe(1);
    barrier.cancel();
    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(port.unsubscribeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects accessor snapshot records without invoking their fields", async () => {
    const selected = identity();
    const vendorGetter = vi.fn(() => LEDGER_HID_VENDOR_ID);
    const record = Object.defineProperties(
      {},
      {
        identity: { value: selected },
        vendorId: { get: vendorGetter },
        productId: { value: 0x4000 },
        opened: { value: true },
      },
    );
    const port = new RawHidPort(() => Promise.resolve([record]));
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(vendorGetter).not.toHaveBeenCalled();
    expect(port.unsubscribeCalls).toBe(1);
  });

  it("rejects sparse and oversized snapshot collections before inspection", async () => {
    const selected = identity();
    const sparse: unknown[] = [];
    sparse.length = 1;
    const oversized: unknown[] = [];
    oversized.length = 0xffff_ffff;
    const descriptorKeys: PropertyKey[] = [];
    const oversizedProxy = new Proxy(oversized, {
      getOwnPropertyDescriptor: (target, key) => {
        descriptorKeys.push(key);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    for (const collection of [sparse, oversizedProxy]) {
      const port = new RawHidPort(() => Promise.resolve(collection));
      const barrier = createHidReleaseBarrier({
        candidate: uniqueCandidate(selected),
        clock: systemClock,
        hidPort: port,
      });
      await barrier.arm();
      await expect(barrier.wait()).resolves.toBe("unavailable");
    }

    expect(descriptorKeys).toEqual(["length"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects Promise-subclass fabrication while observing its late rejection", async () => {
    const selected = identity();
    const thenBody = vi.fn(() => Promise.resolve([snapshot(selected, true)]));
    const thenGetter = vi.fn(() => thenBody);
    const speciesGetter = vi.fn(() => {
      throw new Error("private-release-subclass-species-canary");
    });
    class HostilePromise<T> extends Promise<T> {}
    Object.defineProperty(HostilePromise.prototype, "then", {
      configurable: true,
      get: thenGetter,
    });
    Object.defineProperty(HostilePromise, Symbol.species, {
      configurable: true,
      get: speciesGetter,
    });
    let rejectSource!: (error: unknown) => void;
    const source = new HostilePromise<readonly HidDeviceSnapshot[]>(
      (_resolve, reject) => {
        rejectSource = reject;
      },
    );
    const port = new RawHidPort(() => source);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(
      Object.getOwnPropertyDescriptor(source, "constructor"),
    ).toBeUndefined();
    rejectSource(new Error("private-release-subclass-late-rejection-canary"));
    await flushMicrotasks();
    expect(thenGetter).not.toHaveBeenCalled();
    expect(thenBody).not.toHaveBeenCalled();
    expect(speciesGetter).not.toHaveBeenCalled();
  });

  it("rejects cross-realm Promise evidence while observing its late rejection", async () => {
    const selected = identity();
    const foreignValue: unknown = runInNewContext(`
      (() => {
        let rejectSource;
        const promise = new Promise((_resolve, reject) => {
          rejectSource = reject;
        });
        return { promise, reject: rejectSource };
      })()
    `);
    const foreign = foreignValue as {
      readonly promise: Promise<readonly HidDeviceSnapshot[]>;
      readonly reject: (error: unknown) => void;
    };
    const originalPrototype = Object.getPrototypeOf(foreign.promise);
    const port = new RawHidPort(() => foreign.promise);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(
      Object.getOwnPropertyDescriptor(foreign.promise, "constructor"),
    ).toBeUndefined();
    expect(Object.getPrototypeOf(foreign.promise)).toBe(originalPrototype);
    foreign.reject(
      new Error("private-release-cross-realm-late-rejection-canary"),
    );
    await flushMicrotasks();
  });

  it("cancellation prevents all reflection on a late snapshot fulfillment", async () => {
    const selected = identity();
    let resolveSource!: (snapshots: readonly HidDeviceSnapshot[]) => void;
    const source = new Promise<readonly HidDeviceSnapshot[]>((resolve) => {
      resolveSource = resolve;
    });
    const port = new RawHidPort(() => source);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    const armed = barrier.arm();
    const descriptorTrap = vi.fn(() => {
      throw new Error("private-release-post-cancel-reflection-canary");
    });
    const lateSnapshots = new Proxy([snapshot(selected, false)], {
      getOwnPropertyDescriptor: descriptorTrap,
    });

    barrier.cancel();
    resolveSource(lateSnapshots);
    await armed;
    await expect(barrier.wait()).resolves.toBe("unavailable");
    await flushMicrotasks();
    expect(descriptorTrap).not.toHaveBeenCalled();
    expect(port.calls).toBe(1);
    expect(port.unsubscribeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("contains cancellation that reenters during synchronous capture startup", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    let clearCalls = 0;
    const clock: Clock = {
      now: () => systemClock.now(),
      monotonicNow: () => systemClock.monotonicNow(),
      setTimeout: (callback, delayMs) =>
        systemClock.setTimeout(callback, delayMs),
      clearTimeout: (timer) => {
        clearCalls += 1;
        systemClock.clearTimeout(timer);
      },
    };
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
    });
    port.onRead = () => barrier.cancel();

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(port.calls).toBe(1);
    expect(port.unsubscribeCalls).toBe(1);
    expect(clearCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("maps read rejection and an arm snapshot watchdog to unavailable", async () => {
    const selected = identity();
    const rejectedPort = new FakeHidPort(() => [snapshot(selected, true)]);
    const rejectedBarrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: rejectedPort,
    });
    await rejectedBarrier.arm();
    rejectedPort.source = () => new Error("unavailable");
    await expect(rejectedBarrier.wait()).resolves.toBe("unavailable");

    const never = new Promise<readonly HidDeviceSnapshot[]>(() => undefined);
    const hangingPort = new FakeHidPort(() => never);
    const hangingBarrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: hangingPort,
    });
    const armed = hangingBarrier.arm();
    await vi.advanceTimersByTimeAsync(
      PROVISIONAL_HID_RELEASE_POLICY.snapshotTimeoutMs,
    );
    await armed;
    await expect(hangingBarrier.wait()).resolves.toBe("unavailable");
    expect(hangingPort.calls).toBe(1);
    expect(hangingPort.listeners.size).toBe(0);
  });

  it("maps unavailable change observation to non-ready without polling", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    port.subscribeError = new Error("events unavailable");
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(port.calls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds one hanging poll with the snapshot watchdog", async () => {
    const selected = identity();
    let source: SnapshotSource = [snapshot(selected, true)];
    const port = new FakeHidPort(() => source);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });
    await barrier.arm();
    source = new Promise<readonly HidDeviceSnapshot[]>(() => undefined);
    const result = barrier.wait();

    await vi.advanceTimersByTimeAsync(
      PROVISIONAL_HID_RELEASE_POLICY.snapshotTimeoutMs - 1,
    );
    expect(await isPending(result)).toBe(true);
    expect(port.calls).toBe(2);
    expect(port.maxInFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("unavailable");
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a delayed closed snapshot that resolves exactly at the deadline", async () => {
    const selected = identity();
    let resolvePoll!: (snapshots: readonly HidDeviceSnapshot[]) => void;
    let source: SnapshotSource = [snapshot(selected, true)];
    const port = new FakeHidPort(() => source);
    const clock = new ManualClock();
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
    });
    await barrier.arm();
    source = new Promise((resolve) => {
      resolvePoll = resolve;
    });
    const result = barrier.wait();
    await Promise.resolve();

    clock.monotonicTime = 10_000;
    resolvePoll([snapshot(selected, false)]);

    await expect(result).resolves.toBe("timed-out");
  });

  it("lets the absolute deadline beat an undefined watchdog capture", async () => {
    const selected = identity();
    let source: SnapshotSource = [snapshot(selected, true)];
    const port = new FakeHidPort(() => source);
    const clock = new ManualClock();
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
    });
    await barrier.arm();
    source = new Promise<readonly HidDeviceSnapshot[]>(() => undefined);
    const result = barrier.wait();
    await Promise.resolve();

    clock.monotonicTime = PROVISIONAL_HID_RELEASE_POLICY.releaseDeadlineMs;
    clock.fireByDelay(PROVISIONAL_HID_RELEASE_POLICY.snapshotTimeoutMs);

    await expect(result).resolves.toBe("timed-out");
    expect(port.calls).toBe(2);
  });

  it("rechecks the deadline after inspecting a hostile closed snapshot", async () => {
    const selected = identity();
    let source: SnapshotSource = [snapshot(selected, true)];
    const port = new FakeHidPort(() => source);
    const clock = new ManualClock();
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
    });
    await barrier.arm();
    source = [
      new Proxy(snapshot(selected, false), {
        getOwnPropertyDescriptor(target, property) {
          if (property === "opened") clock.monotonicTime = 10_000;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
      }),
    ];

    await expect(barrier.wait()).resolves.toBe("timed-out");
  });

  it("lets the absolute deadline win when quiet and deadline callbacks are reversed", async () => {
    const selected = identity();
    let present = true;
    const port = new FakeHidPort(() =>
      present ? [snapshot(selected, true)] : [],
    );
    const clock = new ManualClock();
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
    });
    await barrier.arm();
    const result = barrier.wait();
    for (let index = 0; index < 10 && !clock.hasDelay(100); index += 1) {
      await Promise.resolve();
    }
    expect(clock.hasDelay(100)).toBe(true);

    clock.monotonicTime = 3_500;
    present = false;
    clock.fireByDelay(100);
    for (let index = 0; index < 10 && !clock.hasDelay(6_500); index += 1) {
      await Promise.resolve();
    }
    expect(clock.hasDelay(6_500)).toBe(true);

    clock.monotonicTime = 10_000;
    clock.fireByDelay(6_500);

    await expect(result).resolves.toBe("timed-out");
  });

  it("caches reentrant arm/wait calls and ignores late work after cancellation", async () => {
    const selected = identity();
    let resolvePoll!: (snapshots: readonly HidDeviceSnapshot[]) => void;
    let source: SnapshotSource = [snapshot(selected, true)];
    const port = new FakeHidPort(() => source);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: systemClock,
      hidPort: port,
    });

    let reentrantArm: Promise<void> | undefined;
    port.onSubscribe = () => {
      reentrantArm = barrier.arm();
    };
    const firstArm = barrier.arm();
    expect(barrier.arm()).toBe(firstArm);
    await firstArm;
    expect(reentrantArm).toBe(firstArm);

    source = new Promise((resolve) => {
      resolvePoll = resolve;
    });
    let reentrantWait: Promise<unknown> | undefined;
    port.onRead = () => {
      if (port.calls === 2) reentrantWait = barrier.wait();
    };
    const firstWait = barrier.wait();
    expect(barrier.wait()).toBe(firstWait);
    await Promise.resolve();
    expect(reentrantWait).toBe(firstWait);
    barrier.cancel();
    await expect(firstWait).resolves.toBe("unavailable");

    resolvePoll([snapshot(selected, false)]);
    await Promise.resolve();
    await Promise.resolve();
    expect(port.calls).toBe(2);
    expect(port.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels one active capture and clears each timer and listener exactly once", async () => {
    class TrackingClock implements Clock {
      readonly active = new Set<number>();

      readonly cleared: number[] = [];

      private nextHandle = 0;

      now(): number {
        return 0;
      }

      monotonicNow(): number {
        return 0;
      }

      setTimeout(callback: () => void, delayMs: number): ClockTimer {
        void callback;
        void delayMs;
        const handle = this.nextHandle;
        this.nextHandle += 1;
        this.active.add(handle);
        return handle as unknown as ClockTimer;
      }

      clearTimeout(timer: ClockTimer): void {
        const handle = timer as unknown as number;
        this.active.delete(handle);
        this.cleared.push(handle);
      }
    }

    const selected = identity();
    let resolvePoll!: (snapshots: readonly HidDeviceSnapshot[]) => void;
    let source: SnapshotSource = [snapshot(selected, true)];
    const port = new FakeHidPort(() => source);
    const clock = new TrackingClock();
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
    });
    await barrier.arm();
    source = new Promise((resolve) => {
      resolvePoll = resolve;
    });

    const result = barrier.wait();
    await flushMicrotasks();
    expect(port.calls).toBe(2);
    barrier.cancel();
    barrier.cancel();
    await expect(result).resolves.toBe("unavailable");

    expect(port.unsubscribeCalls).toBe(1);
    expect(clock.active.size).toBe(0);
    expect(clock.cleared).toEqual([0, 2, 1]);

    resolvePoll([snapshot(selected, false)]);
    await flushMicrotasks();
    expect(port.calls).toBe(2);
    expect(port.unsubscribeCalls).toBe(1);
    expect(clock.cleared).toEqual([0, 2, 1]);
  });

  it("detaches an owned timer before reentrant cleanup can clear it again", async () => {
    const selected = identity();
    let opened = true;
    const barrierReference: {
      current?: ReturnType<typeof createHidReleaseBarrier>;
    } = {};
    let reentered = false;
    const delays = new Map<ClockTimer, number>();
    const clearCounts = new Map<ClockTimer, number>();
    const clock: Clock = {
      now: () => systemClock.now(),
      monotonicNow: () => systemClock.monotonicNow(),
      setTimeout: (callback, delayMs) => {
        const timer = systemClock.setTimeout(callback, delayMs);
        delays.set(timer, delayMs);
        return timer;
      },
      clearTimeout: (timer) => {
        clearCounts.set(timer, (clearCounts.get(timer) ?? 0) + 1);
        if (
          !reentered &&
          delays.get(timer) === PROVISIONAL_HID_RELEASE_POLICY.releaseDeadlineMs
        ) {
          reentered = true;
          barrierReference.current?.cancel();
        }
        systemClock.clearTimeout(timer);
      },
    };
    const port = new FakeHidPort(() => [snapshot(selected, opened)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
    });
    barrierReference.current = barrier;
    await barrier.arm();
    opened = false;

    await expect(barrier.wait()).resolves.toBe("released");

    const deadlineTimers = [...delays.entries()]
      .filter(
        ([, delayMs]) =>
          delayMs === PROVISIONAL_HID_RELEASE_POLICY.releaseDeadlineMs,
      )
      .map(([timer]) => timer);
    expect(deadlineTimers).toHaveLength(1);
    expect(clearCounts.get(deadlineTimers[0] as ClockTimer)).toBe(1);
    expect(reentered).toBe(true);
    expect(port.unsubscribeCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up an opaque timer whose runtime handle is zero", async () => {
    class ZeroHandleClock implements Clock {
      readonly active = new Set<number>();

      readonly cleared: number[] = [];

      private nextHandle = 0;

      now(): number {
        return 0;
      }

      monotonicNow(): number {
        return 0;
      }

      setTimeout(callback: () => void, delayMs: number): ClockTimer {
        void callback;
        void delayMs;
        const handle = this.nextHandle;
        this.nextHandle += 1;
        this.active.add(handle);
        return handle as unknown as ClockTimer;
      }

      clearTimeout(timer: ClockTimer): void {
        const handle = timer as unknown as number;
        this.active.delete(handle);
        this.cleared.push(handle);
      }
    }

    const selected = identity();
    let opened = true;
    const port = new FakeHidPort(() => [snapshot(selected, opened)]);
    const clock = new ZeroHandleClock();
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
    });

    await barrier.arm();
    opened = false;
    await expect(barrier.wait()).resolves.toBe("released");

    expect(clock.cleared).toContain(0);
    expect(clock.active.size).toBe(0);
  });

  it("ignores non-Ledger snapshots while proving the selected device closed", async () => {
    const selected = identity();
    const unrelated = identity();
    let read = 0;
    const port = new FakeHidPort(() => {
      read += 1;
      return read === 1
        ? [snapshot(selected, true), snapshot(unrelated, true, 0x4000, 0x1234)]
        : [
            snapshot(selected, false),
            snapshot(unrelated, true, 0x4000, 0x1234),
          ];
    });
    const clock = new ProgrammableClock([0, 1, 2, 3]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("released");
  });

  it.each([
    ["a NaN reading", Number.NaN],
    ["a negative reading", -1],
    ["a throwing clock", new Error("monotonic clock failed")],
  ])("fails unavailable before observation for %s", async (_label, reading) => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([reading]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(port.calls).toBe(0);
  });

  it("fails unavailable when the absolute deadline cannot be represented", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([Number.MAX_VALUE]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("unavailable");
    expect(port.calls).toBe(0);
  });

  it("fails unavailable when pre-wait quiet time cannot be represented", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => []);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([Number.MAX_VALUE]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("fails closed when the browser returns a non-callable unsubscribe token", async () => {
    const selected = identity();
    const port: HidPort = {
      getGrantedDevices: () => Promise.resolve([snapshot(selected, true)]),
      subscribeToDeviceChanges: () => null as never,
    };
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock(),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("classifies an unavailable first capture against an already-owned deadline", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => new Error("snapshot read failed"));
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([0, 1]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("fails unavailable when time becomes invalid after an unavailable first capture", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => new Error("snapshot read failed"));
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([0, Number.NaN]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("lets the deadline classify an unavailable first capture", async () => {
    const selected = identity();
    const clock = new ProgrammableClock([0, EDGE_POLICY.releaseDeadlineMs]);
    const port = new FakeHidPort(() => new Error("snapshot read failed"));
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("timed-out");
  });

  it("fails closed when an initial snapshot mutates the selected product", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true, 0x4001)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([0]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("fails unavailable when time becomes invalid after initial absence", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => []);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([0, Number.NaN]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("reschedules a quiet timer that fires before monotonic quiet time elapses", async () => {
    const selected = identity();
    const clock = new ProgrammableClock([0, 1]);
    const port = new FakeHidPort(() => []);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await barrier.arm();
    clock.fireByDelay(EDGE_POLICY.reconnectQuietPeriodMs);
    expect(
      clock.timers.some(
        (timer) =>
          !timer.cleared &&
          timer.delayMs === EDGE_POLICY.reconnectQuietPeriodMs - 1,
      ),
    ).toBe(true);
    barrier.cancel();
    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("fails closed when the quiet timer fires synchronously during scheduling", async () => {
    const selected = identity();
    const clock = new ProgrammableClock([0]);
    clock.synchronousDelays.add(EDGE_POLICY.reconnectQuietPeriodMs);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: new FakeHidPort(() => []),
      policy: EDGE_POLICY,
    });

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("contains cancellation reentered while a quiet timer is being assigned", async () => {
    const selected = identity();
    const clock = new ProgrammableClock([0]);
    clock.onSchedule = (delayMs) => {
      if (delayMs === EDGE_POLICY.reconnectQuietPeriodMs) barrier.cancel();
    };
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: new FakeHidPort(() => []),
      policy: EDGE_POLICY,
    });

    await barrier.arm();
    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("does not schedule replacement quiet work after timer cleanup reenters cancellation", async () => {
    const selected = identity();
    const clock = new ProgrammableClock([0]);
    const port = new FakeHidPort(() => []);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
      policy: EDGE_POLICY,
    });
    await barrier.arm();
    clock.onClear = (delayMs) => {
      if (delayMs === EDGE_POLICY.reconnectQuietPeriodMs) barrier.cancel();
    };

    port.emit({ type: "disconnect", device: snapshot(selected, false) });

    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("ignores a retained stale quiet callback after polling sees the candidate again", async () => {
    const selected = identity();
    let read = 0;
    const port = new FakeHidPort(() => {
      read += 1;
      return read === 1 ? [] : [snapshot(selected, true)];
    });
    const clock = new ProgrammableClock([0, 0, 1, 2]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
      policy: EDGE_POLICY,
    });

    const outcome = barrier.wait();
    for (
      let attempt = 0;
      attempt < 10 &&
      !clock.timers.some(
        (timer) =>
          !timer.cleared && timer.delayMs === EDGE_POLICY.pollIntervalMs,
      );
      attempt += 1
    ) {
      await flushMicrotasks();
    }
    expect(port.calls).toBeGreaterThanOrEqual(2);
    expect(
      clock.timers.some(
        (timer) =>
          !timer.cleared && timer.delayMs === EDGE_POLICY.pollIntervalMs,
      ),
    ).toBe(true);
    clock.fireByDelay(EDGE_POLICY.reconnectQuietPeriodMs, true);
    expect(await isPending(outcome)).toBe(true);
    barrier.cancel();
    await expect(outcome).resolves.toBe("unavailable");
  });

  it("ignores retained browser callbacks after terminal cleanup", async () => {
    const selected = identity();
    let retained: ((change: HidDeviceChange) => void) | undefined;
    const port: HidPort = {
      getGrantedDevices: () => Promise.resolve([snapshot(selected, true)]),
      subscribeToDeviceChanges: (listener) => {
        retained = listener;
        return () => undefined;
      },
    };
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([0]),
      hidPort: port,
      policy: EDGE_POLICY,
    });
    await barrier.arm();
    retained?.({ type: "unavailable" });
    await expect(barrier.wait()).resolves.toBe("unavailable");

    expect(() => retained?.({ type: "unavailable" })).not.toThrow();
  });

  it("ignores a known peer disconnect and fails closed if selected-disconnect time is invalid", async () => {
    const selected = identity();
    const peer = identity();
    const clock = new ProgrammableClock([Number.NaN]);
    const port = new FakeHidPort(() => [
      snapshot(selected, true),
      snapshot(peer, false),
    ]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected, [peer]),
      clock,
      hidPort: port,
      policy: EDGE_POLICY,
    });
    await barrier.arm();

    port.emit({ type: "disconnect", device: snapshot(peer, false) });
    expect(port.listeners.size).toBe(1);
    port.emit({ type: "disconnect", device: snapshot(selected, false) });

    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("fails unavailable when quiet-timer time becomes invalid", async () => {
    const selected = identity();
    const clock = new ProgrammableClock([0]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: new FakeHidPort(() => []),
      policy: EDGE_POLICY,
    });
    await barrier.arm();
    clock.monotonicValues[0] = Number.NaN;

    clock.fireByDelay(EDGE_POLICY.reconnectQuietPeriodMs);

    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it("lets the owned deadline reject an initial absence", async () => {
    const selected = identity();
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([0, EDGE_POLICY.releaseDeadlineMs]),
      hidPort: new FakeHidPort(() => []),
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("timed-out");
  });

  it("treats a connect event for the exact selected handle as ambiguous", async () => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([0]),
      hidPort: port,
      policy: EDGE_POLICY,
    });
    await barrier.arm();

    port.emit({ type: "connect", device: snapshot(selected, true) });

    await expect(barrier.wait()).resolves.toBe("ambiguous");
  });

  it("treats an unknown same-model identity in an initial snapshot as ambiguous", async () => {
    const selected = identity();
    const unknownPeer = identity();
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([0]),
      hidPort: new FakeHidPort(() => [
        snapshot(selected, true),
        snapshot(unknownPeer, false),
      ]),
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("ambiguous");
  });

  it("fails unavailable when deadline-callback time becomes invalid", async () => {
    const selected = identity();
    const clock = new ProgrammableClock([0, 1, 2]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: new FakeHidPort(() => [snapshot(selected, true)]),
      policy: EDGE_POLICY,
    });
    const outcome = barrier.wait();
    await flushMicrotasks();
    clock.monotonicValues.splice(0, clock.monotonicValues.length, Number.NaN);

    clock.fireByDelay(EDGE_POLICY.releaseDeadlineMs);

    await expect(outcome).resolves.toBe("unavailable");
  });

  it("ignores a retained poll callback while the prior poll read is in flight", async () => {
    const selected = identity();
    const pending = deferred<readonly HidDeviceSnapshot[]>();
    let read = 0;
    const port = new FakeHidPort(() => {
      read += 1;
      return read < 3 ? [snapshot(selected, true)] : pending.promise;
    });
    const clock = new ProgrammableClock([0, 1, 2, 3]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
      policy: EDGE_POLICY,
    });
    const outcome = barrier.wait();
    for (
      let attempt = 0;
      attempt < 10 &&
      !clock.timers.some(
        (timer) =>
          !timer.cleared && timer.delayMs === EDGE_POLICY.pollIntervalMs,
      );
      attempt += 1
    ) {
      await flushMicrotasks();
    }

    clock.fireByDelay(EDGE_POLICY.pollIntervalMs);
    await flushMicrotasks();
    expect(port.inFlight).toBe(1);
    clock.fireByDelay(EDGE_POLICY.pollIntervalMs, true);
    expect(port.maxInFlight).toBe(1);

    barrier.cancel();
    pending.resolve([snapshot(selected, true)]);
    await expect(outcome).resolves.toBe("unavailable");
  });

  it("reschedules an early deadline callback and ignores it after release", async () => {
    const selected = identity();
    const clock = new ProgrammableClock([0, 1, 2, 3]);
    const port = new FakeHidPort(() => [snapshot(selected, false)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock,
      hidPort: port,
      policy: EDGE_POLICY,
    });

    const outcome = barrier.wait();
    clock.fireByDelay(EDGE_POLICY.releaseDeadlineMs);
    await expect(outcome).resolves.toBe("released");
    clock.fireByDelay(EDGE_POLICY.releaseDeadlineMs - 1, true);
    await expect(outcome).resolves.toBe("released");
  });

  it.each([
    ["deadline", EDGE_POLICY.releaseDeadlineMs],
    ["poll", EDGE_POLICY.pollIntervalMs],
  ])(
    "fails closed when the %s timer fires synchronously",
    async (_label, delay) => {
      const selected = identity();
      const clock = new ProgrammableClock([0, 1, 2]);
      clock.synchronousDelays.add(delay);
      const barrier = createHidReleaseBarrier({
        candidate: uniqueCandidate(selected),
        clock,
        hidPort: new FakeHidPort(() => [snapshot(selected, true)]),
        policy: EDGE_POLICY,
      });

      await expect(barrier.wait()).resolves.toBe("unavailable");
    },
  );

  it.each([
    ["deadline", EDGE_POLICY.releaseDeadlineMs],
    ["poll", EDGE_POLICY.pollIntervalMs],
  ])(
    "contains cancellation reentered while assigning the %s timer",
    async (_label, delay) => {
      const selected = identity();
      const clock = new ProgrammableClock([0, 1, 2]);
      clock.onSchedule = (scheduledDelay) => {
        if (scheduledDelay === delay) barrier.cancel();
      };
      const barrier = createHidReleaseBarrier({
        candidate: uniqueCandidate(selected),
        clock,
        hidPort: new FakeHidPort(() => [snapshot(selected, true)]),
        policy: EDGE_POLICY,
      });

      await expect(barrier.wait()).resolves.toBe("unavailable");
    },
  );

  it.each([
    {
      label: "before a poll read",
      times: [0, Number.NaN],
      second: [snapshot(identity(), true)],
      expected: "unavailable",
    },
    {
      label: "at the deadline before a poll read",
      times: [0, EDGE_POLICY.releaseDeadlineMs],
      second: [snapshot(identity(), true)],
      expected: "timed-out",
    },
  ])("classifies invalid time $label", async ({ times, expected }) => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([...times]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe(expected);
  });

  it.each([
    {
      label: "immediately after the poll capture",
      times: [0, 1, Number.NaN],
      expected: "unavailable",
    },
    {
      label: "at the deadline after the poll capture",
      times: [0, 1, EDGE_POLICY.releaseDeadlineMs],
      expected: "timed-out",
    },
    {
      label: "while timestamping inspected evidence",
      times: [0, 1, 2, Number.NaN],
      expected: "unavailable",
    },
    {
      label: "at the deadline while timestamping inspected evidence",
      times: [0, 1, 2, EDGE_POLICY.releaseDeadlineMs],
      expected: "timed-out",
    },
  ])("classifies time $label", async ({ times, expected }) => {
    const selected = identity();
    const port = new FakeHidPort(() => [snapshot(selected, true)]);
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([...times]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe(expected);
  });

  it("fails closed when a poll sees the selected identity under a different product", async () => {
    const selected = identity();
    let read = 0;
    const port = new FakeHidPort(() => {
      read += 1;
      return [snapshot(selected, true, read === 1 ? 0x4000 : 0x4001)];
    });
    const barrier = createHidReleaseBarrier({
      candidate: uniqueCandidate(selected),
      clock: new ProgrammableClock([0, 1, 2]),
      hidPort: port,
      policy: EDGE_POLICY,
    });

    await expect(barrier.wait()).resolves.toBe("unavailable");
  });

  it.each([
    [{ kind: "none" } as const, "unavailable"],
    [{ kind: "unavailable" } as const, "unavailable"],
    [{ kind: "ambiguous" } as const, "ambiguous"],
  ])(
    "settles non-unique candidate %j without observing devices",
    async (candidate, outcome) => {
      const port = new FakeHidPort(() => []);
      const barrier = createHidReleaseBarrier({
        candidate,
        clock: systemClock,
        hidPort: port,
      });

      await barrier.arm();
      await expect(barrier.wait()).resolves.toBe(outcome);
      expect(port.calls).toBe(0);
      expect(port.listeners.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
