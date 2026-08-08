import { systemClock } from "./clock";
import type {
  DmkActionKind,
  DmkActionOperation,
  DmkActionRequest,
  DmkActionState,
  DmkDiscoveredDevice,
  DmkObserver,
  DmkOperation,
  DmkPort,
  DmkSession,
  DmkStream,
  DmkSubscription,
} from "./dmkPort";
import type { RuntimeLease } from "./runtimeLease";
import {
  GenuineLedgerSessionRequiredError,
  InactiveLedgerSessionError,
  OwnedDmkSession,
} from "./session";

const rawSession: DmkSession = Object.freeze({
  internalSessionId: "coverage-session",
  modelId: "nanoS",
});

function subscription(unsubscribe = vi.fn()): DmkSubscription {
  return {
    closed: false,
    unsubscribe,
  };
}

function neverStream<T>(
  onSubscribe: (observer: DmkObserver<T>) => void = () => undefined,
): DmkStream<T> {
  return {
    subscribe(observer) {
      onSubscribe(observer);
      return subscription();
    },
  };
}

function operationFor<K extends DmkActionKind>(
  onSubscribe: (observer: DmkObserver<DmkActionState<K>>) => void = () =>
    undefined,
  cancel = vi.fn(),
): DmkActionOperation<K> {
  const operation: DmkOperation<DmkActionState<K>> = {
    stream: neverStream(onSubscribe),
    cancel,
  };
  if ((undefined as unknown as K) === "install-bitcoin") {
    return {
      ...operation,
      dispatchStarted: () => false,
      mutationAttempted: () => false,
    } as DmkActionOperation<K>;
  }
  return operation as DmkActionOperation<K>;
}

function completedOperation<K extends DmkActionKind>(
  output: unknown,
  cancel = vi.fn(),
): DmkActionOperation<K> {
  return operationFor<K>((observer) => {
    observer.next({ status: "completed", output } as DmkActionState<K>);
  }, cancel);
}

function leaseHarness(
  options: {
    readonly invalidateError?: Error;
    readonly initiallyCurrent?: boolean;
  } = {},
): {
  readonly lease: RuntimeLease;
  readonly invalidate: ReturnType<typeof vi.fn>;
  readonly release: ReturnType<typeof vi.fn>;
  setCurrent(value: boolean): void;
} {
  let current = options.initiallyCurrent ?? true;
  const invalidate = vi.fn(() => {
    current = false;
    if (options.invalidateError) throw options.invalidateError;
  });
  const release = vi.fn(() => {
    current = false;
  });
  return {
    lease: {
      generation: 17,
      isCurrent: () => current,
      invalidate,
      release,
    },
    invalidate,
    release,
    setCurrent: (value) => {
      current = value;
    },
  };
}

function portHarness(
  runAction: DmkPort["runAction"],
  options: {
    readonly disconnect?: () => Promise<void>;
    readonly lifecycle?: DmkStream<never>;
  } = {},
): DmkPort {
  return {
    isEnvironmentSupported: () => true,
    startDiscovery: () => ({
      stream: neverStream<DmkDiscoveredDevice>(),
      cancel: () => undefined,
    }),
    connect: () => Promise.resolve(rawSession),
    observeSessionLifecycle: () => options.lifecycle ?? neverStream<never>(),
    runAction,
    disconnect: options.disconnect ?? (() => Promise.resolve()),
    close: () => Promise.resolve(),
  };
}

function ownedSession(
  port: DmkPort,
  lease: RuntimeLease = leaseHarness().lease,
): OwnedDmkSession {
  return new OwnedDmkSession(port, rawSession, lease, systemClock, "nanoS");
}

function defaultAction<K extends DmkActionKind>(
  _session: DmkSession,
  action: Extract<DmkActionRequest, { readonly kind: K }>,
): DmkActionOperation<K> {
  if (action.kind === "install-bitcoin") {
    return {
      ...operationFor<K>(),
      dispatchStarted: () => false,
      mutationAttempted: () => false,
    } as DmkActionOperation<K>;
  }
  return operationFor<K>();
}

describe("owned session adversarial edge invariants", () => {
  it("rejects non-callable invalidation listeners and makes unsubscribe idempotent", () => {
    const owned = ownedSession(portHarness(defaultAction));

    expect(() => owned.onInvalidated(undefined as never)).toThrow(TypeError);
    const listener = vi.fn();
    const unsubscribe = owned.onInvalidated(listener);
    unsubscribe();
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });

  it("classifies primitive genuine completion as invalid evidence", async () => {
    const owned = ownedSession(
      portHarness(((unusedSession, action) =>
        action.kind === "genuine"
          ? completedOperation<"genuine">(null)
          : defaultAction(unusedSession, action)) as DmkPort["runAction"]),
    );

    await expect(owned.dispatchGenuineCheck().result).resolves.toMatchObject({
      settlement: "invalid-output",
    });
    await owned.disconnect();
  });

  it("contains a genuine setup throw after reentrant session retirement", async () => {
    const port = portHarness((() => {
      void owned.disconnect();
      throw new Error("setup-canary");
    }) as DmkPort["runAction"]);
    const owned = ownedSession(port);

    expect(() => owned.dispatchGenuineCheck()).toThrow("setup-canary");
    await owned.disconnect();
  });

  it("rejects duplicate lifecycle attachment without replacing the first observer", async () => {
    const firstUnsubscribe = vi.fn();
    const first: DmkStream<never> = {
      subscribe: () => subscription(firstUnsubscribe),
    };
    const owned = ownedSession(portHarness(defaultAction));
    owned.attachLifecycle(first);

    expect(() => owned.attachLifecycle(neverStream())).toThrow(
      "already attached",
    );
    await owned.disconnect();
    expect(firstUnsubscribe).toHaveBeenCalledOnce();
  });

  it("fails closed when a lease is already stale before action dispatch", () => {
    const lease = leaseHarness({ initiallyCurrent: false });
    const owned = ownedSession(portHarness(defaultAction), lease.lease);

    expect(() => owned.dispatchGenuineCheck()).toThrow(
      InactiveLedgerSessionError,
    );
    expect(lease.invalidate).toHaveBeenCalledOnce();
  });

  it.each(["genuine", "list-bitcoin"] as const)(
    "cancels a %s action whose lease changes during native dispatch",
    async (kind) => {
      const lease = leaseHarness();
      const cancelled = vi.fn();
      let genuineCalls = 0;
      const port = portHarness(((unusedSession, action) => {
        if (action.kind === "genuine" && kind === "list-bitcoin") {
          genuineCalls += 1;
          if (genuineCalls === 1) {
            return completedOperation<"genuine">({ isGenuine: true });
          }
        }
        lease.setCurrent(false);
        return operationFor(() => undefined, cancelled);
      }) as DmkPort["runAction"]);
      const owned = ownedSession(port, lease.lease);

      if (kind === "list-bitcoin") {
        await expect(
          owned.dispatchGenuineCheck().result,
        ).resolves.toMatchObject({
          settlement: "passed",
        });
        expect(() => owned.dispatchBitcoinInspection()).toThrow(
          InactiveLedgerSessionError,
        );
      } else {
        expect(() => owned.dispatchGenuineCheck()).toThrow(
          InactiveLedgerSessionError,
        );
      }
      expect(cancelled).toHaveBeenCalledOnce();
    },
  );

  it.each(["list-bitcoin", "install-bitcoin"] as const)(
    "revokes prior genuine proof when a %s dispatch reentrantly starts a recheck",
    async (kind) => {
      let firstGenuine = true;
      const cancelled = vi.fn();
      const port = portHarness(((unusedSession, action) => {
        if (action.kind === "genuine") {
          if (firstGenuine) {
            firstGenuine = false;
            return completedOperation<"genuine">({ isGenuine: true });
          }
          return operationFor<"genuine">();
        }
        void owned.dispatchGenuineCheck();
        if (action.kind === "install-bitcoin") {
          return {
            ...operationFor<"install-bitcoin">(() => undefined, cancelled),
            dispatchStarted: () => false,
            mutationAttempted: () => false,
          };
        }
        return operationFor(() => undefined, cancelled);
      }) as DmkPort["runAction"]);
      const owned = ownedSession(port);
      await expect(owned.dispatchGenuineCheck().result).resolves.toMatchObject({
        settlement: "passed",
      });

      if (kind === "install-bitcoin") {
        const rejected = owned.dispatchBitcoinInstallation();
        await expect(rejected.result).resolves.toEqual({ status: "cancelled" });
      } else {
        expect(() => owned.dispatchBitcoinInspection()).toThrow(
          GenuineLedgerSessionRequiredError,
        );
      }
      expect(cancelled).toHaveBeenCalledOnce();
      await owned.disconnect();
    },
  );

  it("cancels an action invalidated synchronously while its subscription is being installed", async () => {
    let lifecycleObserver!: DmkObserver<never>;
    const lifecycle = neverStream<never>((observer) => {
      lifecycleObserver = observer;
    });
    const cancel = vi.fn();
    const port = portHarness(((unusedSession, action) =>
      action.kind === "genuine"
        ? operationFor<"genuine">(() => lifecycleObserver.complete(), cancel)
        : defaultAction(unusedSession, action)) as DmkPort["runAction"]);
    const owned = ownedSession(port);
    owned.attachLifecycle(lifecycle);

    await expect(owned.dispatchGenuineCheck().result).resolves.toMatchObject({
      settlement: "stale",
    });
    expect(cancel).toHaveBeenCalledOnce();
    await owned.disconnect();
  });

  it("treats a completed genuine result as stale when authority changes before settlement", async () => {
    const lease = leaseHarness();
    const owned = ownedSession(
      portHarness(((unusedSession, action) =>
        action.kind === "genuine"
          ? completedOperation<"genuine">({ isGenuine: true })
          : defaultAction(unusedSession, action)) as DmkPort["runAction"]),
      lease.lease,
    );

    const run = owned.dispatchGenuineCheck();
    lease.setCurrent(false);

    await expect(run.result).resolves.toMatchObject({ settlement: "stale" });
  });

  it.each([false, true])(
    "contains plan invalidation failure when lease invalidation failed first: %s",
    async (leaseFails) => {
      const lease = leaseHarness({
        invalidateError: leaseFails ? new Error("lease-canary") : undefined,
      });
      const owned = ownedSession(portHarness(defaultAction), lease.lease);
      const invalidatePlans = vi.fn(() => {
        throw new Error("plan-canary");
      });

      await expect(
        owned.finalize({
          clock: systemClock,
          hidBarrier: {
            arm: () => Promise.resolve(),
            wait: () => Promise.resolve("released"),
            cancel: () => undefined,
          },
          invalidatePlans,
          clearPrivateReferences: () => undefined,
        }),
      ).resolves.toMatchObject({ handoff: "reconnect-required" });
      expect(invalidatePlans).toHaveBeenCalledOnce();
    },
  );

  it("deduplicates nested invalidation while cancelling the same active action", async () => {
    let lifecycleObserver!: DmkObserver<never>;
    const lifecycle = neverStream<never>((observer) => {
      lifecycleObserver = observer;
    });
    const cancel = vi.fn(() => lifecycleObserver.complete());
    const owned = ownedSession(
      portHarness(((unusedSession, action) =>
        action.kind === "genuine"
          ? operationFor<"genuine">(() => undefined, cancel)
          : defaultAction(unusedSession, action)) as DmkPort["runAction"]),
    );
    owned.attachLifecycle(lifecycle);
    const run = owned.dispatchGenuineCheck();

    await owned.disconnect();
    await expect(run.result).resolves.toMatchObject({ settlement: "stale" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
