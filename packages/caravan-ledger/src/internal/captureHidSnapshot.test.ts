import { runInNewContext } from "node:vm";

import {
  captureHidSnapshot,
  type HidSnapshotCaptureHandle,
} from "./captureHidSnapshot";
import type { Clock, ClockTimer } from "./clock";
import type { HidDeviceIdentity, HidDeviceSnapshot, HidPort } from "./hidPort";

class ManualClock implements Clock {
  readonly clearCalls: number[] = [];

  readonly setCalls: number[] = [];

  fireSynchronously = false;

  throwOnClear = false;

  throwOnSet = false;

  onClear: (() => void) | undefined;

  private nextHandle = 0;

  private readonly timers = new Map<number, () => void>();

  now(): number {
    return 0;
  }

  monotonicNow(): number {
    return 0;
  }

  setTimeout(callback: () => void, delayMs: number): ClockTimer {
    this.setCalls.push(delayMs);
    if (this.throwOnSet) throw new Error("private-clock-set-canary");
    const handle = this.nextHandle;
    this.nextHandle += 1;
    if (this.fireSynchronously) {
      callback();
    } else {
      this.timers.set(handle, callback);
    }
    return handle as unknown as ClockTimer;
  }

  clearTimeout(timer: ClockTimer): void {
    const handle = timer as unknown as number;
    this.clearCalls.push(handle);
    this.timers.delete(handle);
    this.onClear?.();
    if (this.throwOnClear) throw new Error("private-clock-clear-canary");
  }

  fire(handle = 0): void {
    const callback = this.timers.get(handle);
    if (!callback) throw new Error(`No timer ${handle}.`);
    this.timers.delete(handle);
    callback();
  }

  activeCount(): number {
    return this.timers.size;
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function snapshot(opened = true): HidDeviceSnapshot {
  return Object.freeze({
    identity: Object.freeze({}) as HidDeviceIdentity,
    vendorId: 0x2c97,
    productId: 0x1011,
    opened,
  });
}

function hidHarness(read: () => unknown): {
  readonly getGrantedDevices: ReturnType<typeof vi.fn>;
  readonly port: HidPort;
  readonly subscribeToDeviceChanges: ReturnType<typeof vi.fn>;
} {
  const getGrantedDevices = vi.fn(read);
  const subscribeToDeviceChanges = vi.fn(() => {
    throw new Error("The capture must not subscribe.");
  });
  return {
    getGrantedDevices,
    subscribeToDeviceChanges,
    port: {
      getGrantedDevices:
        getGrantedDevices as unknown as HidPort["getGrantedDevices"],
      subscribeToDeviceChanges,
    },
  };
}

function directHidPort(read: () => unknown): HidPort {
  return {
    getGrantedDevices: read as HidPort["getGrantedDevices"],
    subscribeToDeviceChanges: () => {
      throw new Error("The capture must not subscribe.");
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const SNAPSHOT_TIMEOUT_MS = 1_000;

describe("bounded private HID snapshot capture", () => {
  it("invokes the read synchronously and returns frozen package-owned records", async () => {
    const clock = new ManualClock();
    const device = snapshot();
    const source = Object.freeze([device]);
    let stillInCallerStack = true;
    const hid = hidHarness(() => {
      expect(stillInCallerStack).toBe(true);
      return Promise.resolve(source);
    });

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });
    stillInCallerStack = false;

    expect(hid.getGrantedDevices).toHaveBeenCalledOnce();
    expect(hid.subscribeToDeviceChanges).not.toHaveBeenCalled();
    expect(clock.setCalls).toEqual([SNAPSHOT_TIMEOUT_MS]);
    const captured = await handle.result;
    expect(captured).toEqual([device]);
    expect(captured).not.toBe(source);
    expect(captured?.[0]).not.toBe(device);
    expect(captured?.[0]?.identity).toBe(device.identity);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured?.[0])).toBe(true);
    expect(Object.getPrototypeOf(captured?.[0])).toBe(Object.prototype);
    expect(Object.keys(captured?.[0] ?? {}).sort()).toEqual([
      "identity",
      "opened",
      "productId",
      "vendorId",
    ]);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(Object.keys(handle).sort()).toEqual(["cancel", "result"]);
    expect(clock.clearCalls).toEqual([0]);
    expect(clock.activeCount()).toBe(0);

    handle.cancel();
    handle.cancel();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("retains no mutable source record and never inspects extra fields", async () => {
    const clock = new ManualClock();
    const identity = Object.freeze({}) as HidDeviceIdentity;
    const extraGetter = vi.fn(() => {
      throw new Error("private-extra-field-canary");
    });
    const mutableRecord: {
      identity: HidDeviceIdentity;
      opened: boolean;
      productId: number;
      vendorId: number;
    } = { identity, vendorId: 0x2c97, productId: 0x1011, opened: true };
    Object.defineProperty(mutableRecord, "privateExtra", {
      configurable: true,
      get: extraGetter,
    });
    const source = [mutableRecord];
    const hid = hidHarness(() => Promise.resolve(source));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });
    const captured = await handle.result;

    mutableRecord.vendorId = 0;
    mutableRecord.productId = 0;
    mutableRecord.opened = false;
    source[0] = snapshot(false) as typeof mutableRecord;

    expect(captured).toEqual([
      { identity, vendorId: 0x2c97, productId: 0x1011, opened: true },
    ]);
    expect(captured?.[0]).not.toBe(mutableRecord);
    expect(extraGetter).not.toHaveBeenCalled();
  });

  it("contains a synchronous port failure and clears timer handle zero once", async () => {
    const clock = new ManualClock();
    const canary = "private-sync-hid-error-canary";
    const hid = hidHarness(() => {
      throw new Error(canary);
    });

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(clock.clearCalls).toEqual([0]);
    expect(JSON.stringify(handle)).not.toContain(canary);
  });

  it("observes and ignores a late rejection after timeout", async () => {
    const clock = new ManualClock();
    const pending = deferred<readonly HidDeviceSnapshot[]>();
    const hid = hidHarness(() => pending.promise);
    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    clock.fire();
    await expect(handle.result).resolves.toBeUndefined();
    pending.reject(new Error("private-late-hid-rejection-canary"));
    await flushMicrotasks();

    expect(clock.clearCalls).toEqual([0]);
    expect(clock.activeCount()).toBe(0);
  });

  it("cancels idempotently and does not inspect a late fulfillment", async () => {
    const clock = new ManualClock();
    const pending = deferred<readonly HidDeviceSnapshot[]>();
    const descriptorTrap = vi.fn(() => {
      throw new Error("private-late-array-trap-canary");
    });
    const lateValue = new Proxy([snapshot()], {
      getOwnPropertyDescriptor: descriptorTrap,
    });
    const hid = hidHarness(() => pending.promise);
    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    handle.cancel();
    handle.cancel();
    await expect(handle.result).resolves.toBeUndefined();
    pending.resolve(lateValue);
    await flushMicrotasks();

    expect(descriptorTrap).not.toHaveBeenCalled();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("still invokes the port but performs zero Promise reflection after synchronous settlement", async () => {
    const clock = new ManualClock();
    clock.fireSynchronously = true;
    const descriptorTrap = vi.fn(() => {
      throw new Error("private-post-settlement-descriptor-canary");
    });
    const prototypeTrap = vi.fn(() => {
      throw new Error("private-post-settlement-prototype-canary");
    });
    const source = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: descriptorTrap,
        getPrototypeOf: prototypeTrap,
      },
    );
    let readCalled = false;
    const port = directHidPort(() => {
      readCalled = true;
      return source;
    });

    const handle = captureHidSnapshot({
      clock,
      hidPort: port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    expect(readCalled).toBe(true);
    await expect(handle.result).resolves.toBeUndefined();
    expect(clock.clearCalls).toEqual([0]);
    expect(descriptorTrap).not.toHaveBeenCalled();
    expect(prototypeTrap).not.toHaveBeenCalled();
  });

  it("fails closed on timer setup failure but still invokes the immediate read", async () => {
    const clock = new ManualClock();
    clock.throwOnSet = true;
    const hid = hidHarness(() => Promise.resolve([snapshot()]));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    expect(hid.getGrantedDevices).toHaveBeenCalledOnce();
    await expect(handle.result).resolves.toBeUndefined();
    expect(clock.clearCalls).toEqual([]);
  });

  it("contains timer cleanup failure without replacing valid evidence", async () => {
    const clock = new ManualClock();
    clock.throwOnClear = true;
    const device = snapshot();
    const hid = hidHarness(() => Promise.resolve([device]));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toEqual([device]);
    expect(clock.clearCalls).toEqual([0]);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["plain object", {}],
    ["string", "not-an-array"],
    ["primitive entry", [null]],
    ["sparse array", Object.assign([], { length: 1 })],
  ])("rejects a malformed %s result", async (_label, value) => {
    const clock = new ManualClock();
    const hid = hidHarness(() => Promise.resolve(value));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("rejects sparse/accessor containers without executing element accessors", async () => {
    const clock = new ManualClock();
    const elementGetter = vi.fn(() => snapshot());
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, "0", {
      configurable: true,
      enumerable: true,
      get: elementGetter,
    });
    accessorArray.length = 1;
    const hid = hidHarness(() => Promise.resolve(accessorArray));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(elementGetter).not.toHaveBeenCalled();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("rejects an oversized collection before inspecting any index", async () => {
    const clock = new ManualClock();
    const descriptorKeys: PropertyKey[] = [];
    const huge: unknown[] = [];
    huge.length = 0xffff_ffff;
    const source = new Proxy(huge, {
      getOwnPropertyDescriptor: (target, key) => {
        descriptorKeys.push(key);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const hid = hidHarness(() => Promise.resolve(source));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(descriptorKeys).toEqual(["length"]);
  });

  it("accepts the reviewed maximum collection size", async () => {
    const clock = new ManualClock();
    const source = Array.from({ length: 64 }, () => snapshot());
    const hid = hidHarness(() => Promise.resolve(source));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    const captured = await handle.result;
    expect(captured).toHaveLength(64);
    expect(captured?.every((entry) => Object.isFrozen(entry))).toBe(true);
  });

  it("contains revoked and trapping array proxies", async () => {
    const revoked = Proxy.revocable([snapshot()], {});
    revoked.revoke();
    const trap = vi.fn(() => {
      throw new Error("private-array-descriptor-canary");
    });
    const trapping = new Proxy([snapshot()], {
      getOwnPropertyDescriptor: trap,
    });

    for (const value of [revoked.proxy, trapping]) {
      const clock = new ManualClock();
      const hid = hidHarness(() => Promise.resolve(value));
      const handle = captureHidSnapshot({
        clock,
        hidPort: hid.port,
        snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
      });

      await expect(handle.result).resolves.toBeUndefined();
      expect(clock.clearCalls).toEqual([0]);
    }
    expect(trap).toHaveBeenCalled();
  });

  it("rejects snapshot accessors without executing them", async () => {
    const clock = new ManualClock();
    const identity = Object.freeze({}) as HidDeviceIdentity;
    const vendorGetter = vi.fn(() => {
      throw new Error("private-vendor-accessor-canary");
    });
    const accessorRecord = Object.defineProperties(
      {},
      {
        identity: { enumerable: true, value: identity },
        vendorId: { enumerable: true, get: vendorGetter },
        productId: { enumerable: true, value: 0x1011 },
        opened: { enumerable: true, value: true },
      },
    );
    const hid = hidHarness(() => Promise.resolve([accessorRecord]));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(vendorGetter).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing field",
      {
        identity: Object.freeze({}) as HidDeviceIdentity,
        vendorId: 0x2c97,
        productId: 0x1011,
      },
    ],
    [
      "inherited fields",
      Object.create({
        identity: Object.freeze({}) as HidDeviceIdentity,
        vendorId: 0x2c97,
        productId: 0x1011,
        opened: true,
      }),
    ],
    [
      "invalid identity",
      { identity: null, vendorId: 0x2c97, productId: 0x1011, opened: true },
    ],
    [
      "invalid vendor",
      {
        identity: Object.freeze({}) as HidDeviceIdentity,
        vendorId: -1,
        productId: 0x1011,
        opened: true,
      },
    ],
    [
      "invalid product",
      {
        identity: Object.freeze({}) as HidDeviceIdentity,
        vendorId: 0x2c97,
        productId: 0x1_0000,
        opened: true,
      },
    ],
    [
      "invalid opened",
      {
        identity: Object.freeze({}) as HidDeviceIdentity,
        vendorId: 0x2c97,
        productId: 0x1011,
        opened: 1,
      },
    ],
  ])("rejects records with %s", async (_label, record) => {
    const clock = new ManualClock();
    const hid = hidHarness(() => Promise.resolve([record]));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
  });

  it("rejects non-native thenables without invoking their getter or body", async () => {
    const clock = new ManualClock();
    const thenBody = vi.fn();
    const thenGetter = vi.fn(() => thenBody);
    const thenable = Object.defineProperty({}, "then", {
      configurable: true,
      get: thenGetter,
    });
    const port = directHidPort(() => thenable);

    const handle = captureHidSnapshot({
      clock,
      hidPort: port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(thenGetter).not.toHaveBeenCalled();
    expect(thenBody).not.toHaveBeenCalled();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("observes a clean base Promise without adding or deleting an own constructor", async () => {
    const clock = new ManualClock();
    const device = snapshot();
    const source = Promise.resolve<readonly HidDeviceSnapshot[]>([device]);
    expect(
      Object.getOwnPropertyDescriptor(source, "constructor"),
    ).toBeUndefined();
    const defineProperty = vi.spyOn(Object, "defineProperty");
    const deleteProperty = vi.spyOn(Reflect, "deleteProperty");

    try {
      const handle = captureHidSnapshot({
        clock,
        hidPort: directHidPort(() => source),
        snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
      });

      await expect(handle.result).resolves.toEqual([device]);
      expect(
        defineProperty.mock.calls.filter(
          ([target, key]) => target === source && key === "constructor",
        ),
      ).toEqual([]);
      expect(
        deleteProperty.mock.calls.filter(
          ([target, key]) => target === source && key === "constructor",
        ),
      ).toEqual([]);
      expect(
        Object.getOwnPropertyDescriptor(source, "constructor"),
      ).toBeUndefined();
    } finally {
      defineProperty.mockRestore();
      deleteProperty.mockRestore();
    }
  });

  it("rejects an own Promise constructor accessor without invoking it and observes a late rejection", async () => {
    const clock = new ManualClock();
    const pending = deferred<readonly HidDeviceSnapshot[]>();
    const source = pending.promise;
    const constructorGetter = vi.fn(() => {
      throw new Error("private-promise-constructor-canary");
    });
    Object.defineProperty(source, "constructor", {
      configurable: true,
      get: constructorGetter,
    });
    const port = directHidPort(() => source);

    const handle = captureHidSnapshot({
      clock,
      hidPort: port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    pending.reject(new Error("private-own-constructor-late-rejection-canary"));
    await flushMicrotasks();
    expect(constructorGetter).not.toHaveBeenCalled();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("rejects an own Promise then accessor without invoking it and observes a late rejection", async () => {
    const clock = new ManualClock();
    const pending = deferred<readonly HidDeviceSnapshot[]>();
    const thenGetter = vi.fn(() => {
      throw new Error("private-promise-then-canary");
    });
    Object.defineProperty(pending.promise, "then", {
      configurable: true,
      get: thenGetter,
    });
    const port = directHidPort(() => pending.promise);

    const handle = captureHidSnapshot({
      clock,
      hidPort: port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    pending.reject(new Error("private-own-then-late-rejection-canary"));
    await flushMicrotasks();
    expect(thenGetter).not.toHaveBeenCalled();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("observes an ordinary Promise subclass rejection and exactly removes its temporary constructor", async () => {
    const clock = new ManualClock();
    class OrdinaryPromise<T> extends Promise<T> {}
    let rejectSource!: (error: unknown) => void;
    const source = new OrdinaryPromise<readonly HidDeviceSnapshot[]>(
      (_resolve, reject) => {
        rejectSource = reject;
      },
    );
    const originalPrototype = Object.getPrototypeOf(source);
    expect(
      Object.getOwnPropertyDescriptor(source, "constructor"),
    ).toBeUndefined();

    const handle = captureHidSnapshot({
      clock,
      hidPort: directHidPort(() => source),
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(source, "constructor"),
    ).toBeUndefined();
    expect(Object.getPrototypeOf(source)).toBe(originalPrototype);
    rejectSource(new Error("private-ordinary-subclass-late-rejection-canary"));
    await flushMicrotasks();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("observes a cross-realm Promise rejection and exactly removes its temporary constructor", async () => {
    const clock = new ManualClock();
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
    expect(originalPrototype).not.toBe(Promise.prototype);
    expect(
      Object.getOwnPropertyDescriptor(foreign.promise, "constructor"),
    ).toBeUndefined();

    const handle = captureHidSnapshot({
      clock,
      hidPort: directHidPort(() => foreign.promise),
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(foreign.promise, "constructor"),
    ).toBeUndefined();
    expect(Object.getPrototypeOf(foreign.promise)).toBe(originalPrototype);
    foreign.reject(new Error("private-cross-realm-late-rejection-canary"));
    await flushMicrotasks();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("rejects Promise-subclass fabrication while observing its late rejection", async () => {
    const clock = new ManualClock();
    const fabricatedThen = vi.fn(() => Promise.resolve([snapshot(false)]));
    const thenGetter = vi.fn(() => fabricatedThen);
    const speciesGetter = vi.fn(() => {
      throw new Error("private-promise-species-canary");
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
    expect(
      Object.getOwnPropertyDescriptor(source, "constructor"),
    ).toBeUndefined();
    const port = directHidPort(() => source);

    const handle = captureHidSnapshot({
      clock,
      hidPort: port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(source, "constructor"),
    ).toBeUndefined();
    rejectSource(new Error("private-subclass-late-rejection-canary"));
    await flushMicrotasks();
    expect(thenGetter).not.toHaveBeenCalled();
    expect(fabricatedThen).not.toHaveBeenCalled();
    expect(speciesGetter).not.toHaveBeenCalled();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("stops container reflection when its length descriptor cancels", async () => {
    const clock = new ManualClock();
    const pending = deferred<readonly HidDeviceSnapshot[]>();
    const handleHolder: { current?: HidSnapshotCaptureHandle } = {};
    const descriptorKeys: PropertyKey[] = [];
    const value = new Proxy([snapshot()], {
      getOwnPropertyDescriptor: (target, key) => {
        descriptorKeys.push(key);
        if (key === "length") handleHolder.current?.cancel();
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const hid = hidHarness(() => pending.promise);
    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });
    handleHolder.current = handle;

    pending.resolve(value);

    await expect(handle.result).resolves.toBeUndefined();
    expect(descriptorKeys).toEqual(["length"]);
    expect(clock.clearCalls).toEqual([0]);
  });

  it("stops record reflection when its identity descriptor cancels", async () => {
    const clock = new ManualClock();
    const pending = deferred<readonly HidDeviceSnapshot[]>();
    const handleHolder: { current?: HidSnapshotCaptureHandle } = {};
    const descriptorKeys: PropertyKey[] = [];
    const value = [
      new Proxy(snapshot(), {
        getOwnPropertyDescriptor: (target, key) => {
          descriptorKeys.push(key);
          if (key === "identity") handleHolder.current?.cancel();
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      }),
    ];
    const hid = hidHarness(() => pending.promise);
    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });
    handleHolder.current = handle;

    pending.resolve(value);

    await expect(handle.result).resolves.toBeUndefined();
    expect(descriptorKeys).toEqual(["identity"]);
    expect(clock.clearCalls).toEqual([0]);
  });

  it("keeps the first settlement when timer cleanup reenters cancel", async () => {
    const clock = new ManualClock();
    const device = snapshot();
    const hid = hidHarness(() => Promise.resolve([device]));
    const handleHolder: { current?: HidSnapshotCaptureHandle } = {};
    clock.onClear = () => handleHolder.current?.cancel();
    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });
    handleHolder.current = handle;

    await expect(handle.result).resolves.toEqual([device]);
    expect(clock.clearCalls).toEqual([0]);
  });

  it("fails closed for an invalid duration while still making the immediate read", async () => {
    const clock = new ManualClock();
    const hid = hidHarness(() => Promise.resolve([snapshot()]));

    const handle = captureHidSnapshot({
      clock,
      hidPort: hid.port,
      snapshotTimeoutMs: 0,
    });

    expect(hid.getGrantedDevices).toHaveBeenCalledOnce();
    await expect(handle.result).resolves.toBeUndefined();
    expect(clock.setCalls).toEqual([]);
    expect(clock.clearCalls).toEqual([]);
  });

  it("rejects a primitive returned directly by a malformed HID port", async () => {
    const clock = new ManualClock();
    const handle = captureHidSnapshot({
      clock,
      hidPort: directHidPort(() => null),
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(clock.clearCalls).toEqual([0]);
  });

  it.each(["constructor", "then", "prototype"] as const)(
    "stops Promise reflection when the watchdog fires during %s inspection",
    async (boundary) => {
      const clock = new ManualClock();
      const descriptorKeys: PropertyKey[] = [];
      const source = new Proxy(
        {},
        {
          getOwnPropertyDescriptor(target, property) {
            descriptorKeys.push(property);
            if (property === boundary) clock.fire();
            return Reflect.getOwnPropertyDescriptor(target, property);
          },
          getPrototypeOf(target) {
            if (boundary === "prototype") clock.fire();
            return Reflect.getPrototypeOf(target);
          },
        },
      );

      const handle = captureHidSnapshot({
        clock,
        hidPort: directHidPort(() => source),
        snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
      });

      await expect(handle.result).resolves.toBeUndefined();
      expect(clock.clearCalls).toEqual([0]);
      if (boundary === "constructor") {
        expect(descriptorKeys).toEqual(["constructor"]);
      } else if (boundary === "then") {
        expect(descriptorKeys).toEqual(["constructor", "then"]);
      } else {
        expect(descriptorKeys).toEqual(["constructor", "then"]);
      }
    },
  );

  it("observes a base Promise with an exact own intrinsic constructor but rejects it as modified evidence", async () => {
    const clock = new ManualClock();
    const source = Promise.resolve<readonly HidDeviceSnapshot[]>([snapshot()]);
    Object.defineProperty(source, "constructor", {
      configurable: true,
      value: Promise,
    });

    const handle = captureHidSnapshot({
      clock,
      hidPort: directHidPort(() => source),
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(source, "constructor")?.value).toBe(
      Promise,
    );
  });

  it("rejects a Promise whose hostile constructor cannot be safely shadowed", async () => {
    const clock = new ManualClock();
    const pending = deferred<readonly HidDeviceSnapshot[]>();
    Object.defineProperty(pending.promise, "constructor", {
      configurable: false,
      value: function HostileConstructor() {},
    });

    const handle = captureHidSnapshot({
      clock,
      hidPort: directHidPort(() => pending.promise),
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(clock.clearCalls).toEqual([0]);
  });

  it("rejects evidence when a temporarily shadowed constructor cannot be restored", async () => {
    const clock = new ManualClock();
    const source = Promise.resolve<readonly HidDeviceSnapshot[]>([snapshot()]);
    const hostileConstructor = function HostileConstructor() {};
    Object.defineProperty(source, "constructor", {
      configurable: true,
      value: hostileConstructor,
    });
    const intrinsicDefineProperty = Object.defineProperty;
    let constructorWrites = 0;
    const defineProperty = vi
      .spyOn(Object, "defineProperty")
      .mockImplementation(((
        target: object,
        key: PropertyKey,
        descriptor: PropertyDescriptor,
      ) => {
        if (target === source && key === "constructor") {
          constructorWrites += 1;
          if (constructorWrites === 2) throw new Error("restore-canary");
        }
        return intrinsicDefineProperty(target, key, descriptor);
      }) as typeof Object.defineProperty);

    try {
      const handle = captureHidSnapshot({
        clock,
        hidPort: directHidPort(() => source),
        snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
      });

      await expect(handle.result).resolves.toBeUndefined();
      expect(constructorWrites).toBe(2);
    } finally {
      defineProperty.mockRestore();
    }
  });

  it("observes a Promise subclass fulfillment but never accepts it as snapshot evidence", async () => {
    const clock = new ManualClock();
    class ForeignShapePromise<T> extends Promise<T> {}
    const source = new ForeignShapePromise<readonly HidDeviceSnapshot[]>(
      (resolve) => resolve([snapshot()]),
    );

    const handle = captureHidSnapshot({
      clock,
      hidPort: directHidPort(() => source),
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(
      Object.getOwnPropertyDescriptor(source, "constructor"),
    ).toBeUndefined();
  });

  it("stops after array-index reflection when the watchdog settles reentrantly", async () => {
    const clock = new ManualClock();
    const source = new Proxy([snapshot()], {
      getOwnPropertyDescriptor(target, property) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (property === "0") clock.fire();
        return descriptor;
      },
    });
    const handle = captureHidSnapshot({
      clock,
      hidPort: directHidPort(() => Promise.resolve(source)),
      snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
    });

    await expect(handle.result).resolves.toBeUndefined();
    expect(clock.clearCalls).toEqual([0]);
  });

  it.each([1, 2])(
    "stops after freezing package-owned records when a hostile intrinsic settles a %i-item copy",
    async (length) => {
      const clock = new ManualClock();
      const source = Array.from({ length }, () => snapshot());
      const intrinsicFreeze = Object.freeze;
      let settledFromRecord = false;
      const freeze = vi.spyOn(Object, "freeze").mockImplementation(((
        value: object,
      ) => {
        const frozen = intrinsicFreeze(value);
        if (
          !settledFromRecord &&
          Object.prototype.hasOwnProperty.call(value, "vendorId")
        ) {
          settledFromRecord = true;
          clock.fire();
        }
        return frozen;
      }) as typeof Object.freeze);

      try {
        const handle = captureHidSnapshot({
          clock,
          hidPort: directHidPort(() => Promise.resolve(source)),
          snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
        });

        await expect(handle.result).resolves.toBeUndefined();
        expect(settledFromRecord).toBe(true);
      } finally {
        freeze.mockRestore();
      }
    },
  );
});
