import { systemClock, type Clock, type ClockTimer } from "./clock";
import {
  LEDGER_HID_VENDOR_ID,
  type HidReleaseCandidate,
} from "./hidCandidate";
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
      this.listeners.delete(listener);
    };
  }

  emit(change: HidDeviceChange): void {
    for (const listener of [...this.listeners]) listener(change);
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
    return [...this.timers.values()].some(
      (timer) => timer.delayMs === delayMs,
    );
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

describe("HID release barrier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("times out exactly at 10 seconds with only one hanging poll", async () => {
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

    await vi.advanceTimersByTimeAsync(9_999);
    expect(await isPending(result)).toBe(true);
    expect(port.calls).toBe(2);
    expect(port.maxInFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBe("timed-out");
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
        get(target, property, receiver) {
          if (property === "opened") clock.monotonicTime = 10_000;
          return Reflect.get(target, property, receiver);
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

  it.each([
    [{ kind: "none" } as const, "unavailable"],
    [{ kind: "unavailable" } as const, "unavailable"],
    [{ kind: "ambiguous" } as const, "ambiguous"],
  ])("settles non-unique candidate %j without observing devices", async (candidate, outcome) => {
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
  });
});
