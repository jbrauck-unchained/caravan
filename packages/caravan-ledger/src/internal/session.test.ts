import { systemClock } from "./clock";
import type {
  DmkDiscoveredDevice,
  DmkSession,
  DmkStream,
  DmkSubscription,
} from "./dmkPort";
import { PROVISIONAL_HID_RELEASE_POLICY } from "./hidReleasePolicy";
import {
  acquireRuntimeLease,
  currentRuntimeGenerationForTesting,
  resetRuntimeLeaseForTesting,
  RuntimeLeaseBusyError,
} from "./runtimeLease";
import {
  GenuineLedgerSessionRequiredError,
  InactiveLedgerSessionError,
  LedgerSessionActionBusyError,
  LedgerSessionEndedDuringSetupError,
  openOwnedDmkSession,
  type FinalizeOwnedDmkSessionOptions,
  type OwnedDmkSession,
  UnsupportedLedgerModelError,
} from "./session";
import { createCandidateModelPolicyForTesting } from "./supportedModels";
import { ScriptedDmk } from "./testing/scriptedDmk";
import type {
  HidReleaseBarrier,
  HidReleaseOutcome,
} from "./waitForHidRelease";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "opaque-device",
});

const allowedSession: DmkSession = Object.freeze({
  internalSessionId: "opaque-session",
  modelId: "nanoS",
});

const missingModelSession: DmkSession = Object.freeze({
  internalSessionId: "opaque-session-without-model",
});

const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function testBarrier(
  outcome: HidReleaseOutcome | Promise<HidReleaseOutcome> = "released",
  calls?: string[],
): {
  readonly barrier: HidReleaseBarrier;
  readonly arm: ReturnType<typeof vi.fn>;
  readonly wait: ReturnType<typeof vi.fn>;
  readonly cancel: ReturnType<typeof vi.fn>;
} {
  const arm = vi.fn(() => {
    calls?.push("arm-barrier");
    return Promise.resolve();
  });
  const wait = vi.fn(() => {
    calls?.push("wait-barrier");
    return Promise.resolve(outcome);
  });
  const cancel = vi.fn();
  return {
    barrier: Object.freeze({ arm, wait, cancel }),
    arm,
    wait,
    cancel,
  };
}

function finalizationOptions(
  barrier: HidReleaseBarrier,
  overrides: Partial<FinalizeOwnedDmkSessionOptions> = {},
): FinalizeOwnedDmkSessionOptions {
  return {
    clock: systemClock,
    hidBarrier: barrier,
    invalidatePlans: () => undefined,
    clearPrivateReferences: () => undefined,
    ...overrides,
  };
}

describe("owned DMK session", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
  });

  it("gates the model immediately after connect and owns exact cleanup", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }]);
    const modelPolicy = {
      allows: vi.fn((modelId: string | undefined) => {
        expect(fake.calls.at(-1)?.type).toBe("connect");
        return modelId === "nanoS";
      }),
    };

    const owned = await openOwnedDmkSession(fake, device, { modelPolicy });

    expect(modelPolicy.allows).toHaveBeenCalledWith("nanoS");
    expect(fake.calls.map((call) => call.type)).toEqual([
      "connect",
      "observe-session",
      "subscribe",
    ]);
    expect(fake.resources()).toMatchObject({
      connectCount: 1,
      sessionLifecycleCount: 1,
      actionCount: 0,
      activeSubscriptions: 1,
    });
    expect(Object.keys(owned)).toEqual([]);
    expect(JSON.stringify(owned)).toBe("{}");
    expect(() => owned.dispatchBitcoinInspection()).toThrow(
      GenuineLedgerSessionRequiredError,
    );
    expect(() => owned.dispatchBitcoinInstallation()).toThrow(
      GenuineLedgerSessionRequiredError,
    );
    expect(() => owned.dispatchBitcoinOpen()).toThrow(
      GenuineLedgerSessionRequiredError,
    );
    expect(fake.resources().actionCount).toBe(0);

    const firstDisconnect = owned.disconnect();
    const secondDisconnect = owned.disconnect();
    expect(secondDisconnect).toBe(firstDisconnect);
    await firstDisconnect;
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
    });
    expect(owned.isCurrent()).toBe(false);
  });

  it("exposes only the exact connected model snapshot accepted by the gate", async () => {
    let currentModelId = "nanoS";
    const modelIdReads = vi.fn(() => currentModelId);
    const volatileSession: DmkSession = {
      internalSessionId: "opaque-volatile-session",
      get modelId() {
        return modelIdReads();
      },
    };
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: volatileSession })
      .queueSessionLifecycle([{ type: "never" }]);
    const modelPolicy = {
      allows: vi.fn((modelId: string | undefined) => {
        currentModelId = "nanoX";
        return modelId === "nanoS";
      }),
    };

    const owned = await openOwnedDmkSession(fake, device, { modelPolicy });

    currentModelId = "flex";
    expect(modelPolicy.allows).toHaveBeenCalledOnce();
    expect(modelPolicy.allows).toHaveBeenCalledWith("nanoS");
    expect(modelIdReads).toHaveBeenCalledOnce();
    expect(owned.modelId).toBe("nanoS");
    expect(modelIdReads).toHaveBeenCalledOnce();
    expect(Object.keys(owned)).toEqual([]);
    expect(JSON.stringify(owned)).toBe("{}");

    await owned.disconnect();
  });

  it("keeps the production allowlist empty and blocks before observation", async () => {
    const fake = new ScriptedDmk(systemClock).queueConnect({
      type: "resolve",
      value: allowedSession,
    });

    await expect(openOwnedDmkSession(fake, device)).rejects.toBeInstanceOf(
      UnsupportedLedgerModelError,
    );
    expect(fake.calls.map((call) => call.type)).toEqual([
      "connect",
      "disconnect",
    ]);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      sessionLifecycleCount: 0,
      actionCount: 0,
    });
  });

  it("fails closed when connected model evidence is absent", async () => {
    const fake = new ScriptedDmk(systemClock).queueConnect({
      type: "resolve",
      value: missingModelSession,
    });

    await expect(
      openOwnedDmkSession(fake, device, { modelPolicy: candidatePolicy }),
    ).rejects.toBeInstanceOf(UnsupportedLedgerModelError);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      sessionLifecycleCount: 0,
      actionCount: 0,
    });
  });

  it("preserves a model-gate failure over disconnect failure", async () => {
    const primaryError = new Error("symbolic policy failure");
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueDisconnect({
        type: "reject",
        error: new Error("symbolic disconnect failure"),
      });

    await expect(
      openOwnedDmkSession(fake, device, {
        modelPolicy: {
          allows: () => {
            throw primaryError;
          },
        },
      }),
    ).rejects.toBe(primaryError);
    expect(fake.resources().disconnectCount).toBe(1);

    const nextLease = acquireRuntimeLease();
    expect(nextLease.isCurrent()).toBe(true);
    nextLease.release();
  });

  it("cleans up once when lifecycle subscription fails during setup", async () => {
    const subscriptionError = new Error("symbolic lifecycle setup failure");
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([
        { type: "throw-on-subscribe", error: subscriptionError },
      ]);

    await expect(
      openOwnedDmkSession(fake, device, { modelPolicy: candidatePolicy }),
    ).rejects.toBe(subscriptionError);
    expect(fake.resources()).toMatchObject({
      sessionLifecycleCount: 1,
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("rejects a session that completes synchronously during setup", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "complete" }]);

    await expect(
      openOwnedDmkSession(fake, device, { modelPolicy: candidatePolicy }),
    ).rejects.toBeInstanceOf(LedgerSessionEndedDuringSetupError);
    expect(fake.resources()).toMatchObject({
      sessionLifecycleCount: 1,
      disconnectCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("invalidates the generation on an asynchronous lifecycle error", async () => {
    const lifecycleError = new Error("symbolic physical disconnect");
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([
        {
          type: "error",
          error: lifecycleError,
          atMs: 5,
          afterCancel: true,
        },
      ])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    const generation = owned.generation;
    const genuine = owned.dispatchGenuineCheck();
    expect((await genuine.result).settlement).toBe("passed");

    await vi.advanceTimersByTimeAsync(5);

    expect(owned.isCurrent()).toBe(false);
    expect(currentRuntimeGenerationForTesting()).toBe(generation + 1);
    expect(() => owned.dispatchBitcoinInspection()).toThrow(
      InactiveLedgerSessionError,
    );
    expect(fake.resources().unsubscribeCount).toBe(2);
    await owned.disconnect();
    expect(fake.resources().disconnectCount).toBe(1);
  });

  it("rejects concurrent sessions before a second connect", async () => {
    const firstFake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }]);
    const secondFake = new ScriptedDmk(systemClock).queueConnect({
      type: "resolve",
      value: allowedSession,
    });
    const first = await openOwnedDmkSession(firstFake, device, {
      modelPolicy: candidatePolicy,
    });

    await expect(
      openOwnedDmkSession(secondFake, device, {
        modelPolicy: candidatePolicy,
      }),
    ).rejects.toBeInstanceOf(RuntimeLeaseBusyError);
    expect(secondFake.resources().connectCount).toBe(0);

    await first.disconnect();
  });

  it("releases the lease after connect failure without disconnecting", async () => {
    const connectionError = new Error("symbolic connection failure");
    const fake = new ScriptedDmk(systemClock).queueConnect({
      type: "reject",
      error: connectionError,
    });

    await expect(
      openOwnedDmkSession(fake, device, { modelPolicy: candidatePolicy }),
    ).rejects.toBe(connectionError);
    expect(fake.resources().disconnectCount).toBe(0);

    const nextLease = acquireRuntimeLease();
    expect(nextLease.isCurrent()).toBe(true);
    nextLease.release();
  });

  it("authorizes only the three fixed protected actions after strict genuine proof", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ])
      .queueAction("list-bitcoin", [{ type: "never" }])
      .queueAction("install-bitcoin", [{ type: "never" }])
      .queueAction("open-bitcoin", [{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });

    const genuine = owned.dispatchGenuineCheck();
    expect((await genuine.result).settlement).toBe("passed");

    owned.dispatchBitcoinInspection();
    const installation = owned.dispatchBitcoinInstallation();
    owned.dispatchBitcoinOpen();

    expect(Object.keys(installation)).toEqual([
      "result",
      "cancel",
      "dispatchStarted",
      "mutationAttempted",
    ]);
    expect(installation.dispatchStarted()).toBe(true);
    expect(installation.mutationAttempted()).toBe(false);

    expect(
      fake.calls
        .filter((call) => call.type === "run-action")
        .map((call) => call.action?.kind),
    ).toEqual(["genuine", "list-bitcoin", "install-bitcoin", "open-bitcoin"]);
    await owned.disconnect();
  });

  it("preserves live install-attempt evidence through session-owned cancellation", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ])
      .queueAction("install-bitcoin", [
        {
          type: "attempt-install-mutation",
          atMs: 5,
          afterCancel: true,
        },
      ]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    expect((await owned.dispatchGenuineCheck().result).settlement).toBe(
      "passed",
    );
    const installation = owned.dispatchBitcoinInstallation();

    expect(installation.mutationAttempted()).toBe(false);
    expect(installation.dispatchStarted()).toBe(true);
    installation.cancel();
    await expect(installation.result).resolves.toEqual({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(5);
    expect(installation.mutationAttempted()).toBe(true);

    await owned.disconnect();
  });

  it("preserves install dispatch evidence across synchronous revalidation and throwing cancellation", async () => {
    let current = true;
    const lease = {
      generation: 7,
      isCurrent: () => current,
      invalidate: () => {
        current = false;
      },
      release: vi.fn(() => {
        current = false;
      }),
    };
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ])
      .queueAction("install-bitcoin", [{ type: "never" }]);
    const originalRunAction = fake.runAction.bind(fake);
    vi.spyOn(fake, "runAction").mockImplementation(((session, action) => {
      const operation = originalRunAction(session, action as never);
      if (action.kind !== "install-bitcoin") return operation as never;
      current = false;
      return {
        ...operation,
        cancel: () => {
          operation.cancel();
          throw new Error("private-cancel-canary");
        },
      } as never;
    }) as typeof fake.runAction);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
      acquireLease: () => lease,
    });
    expect((await owned.dispatchGenuineCheck().result).settlement).toBe(
      "passed",
    );

    const installation = owned.dispatchBitcoinInstallation();

    expect(installation.dispatchStarted()).toBe(true);
    expect(installation.mutationAttempted()).toBe(false);
    await expect(installation.result).resolves.toEqual({
      status: "cancelled",
    });
    expect(fake.resources().cancelCount).toBe(1);
    await owned.disconnect();
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it("exposes no settlement hook that can forge strict-true genuine evidence", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    const run = owned.dispatchGenuineCheck();
    const forgedTerminal = {
      status: "completed",
      output: { isGenuine: true },
    };

    expect(Object.keys(run)).toEqual(["result", "cancel"]);
    expect(() =>
      (run as unknown as { settle(result: unknown): unknown }).settle(
        forgedTerminal,
      ),
    ).toThrow(TypeError);
    expect(() => owned.dispatchBitcoinInspection()).toThrow(
      GenuineLedgerSessionRequiredError,
    );
    expect(fake.resources().actionCount).toBe(1);

    run.cancel();
    await expect(run.result).resolves.toEqual({
      terminal: { status: "cancelled" },
      settlement: "failed",
    });
    await owned.disconnect();
  });

  it("rejects inherited or accessor-based genuine claims", async () => {
    const inherited = Object.create({ isGenuine: true });
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: inherited,
          } as never,
        },
      ]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    const run = owned.dispatchGenuineCheck();

    expect((await run.result).settlement).toBe("invalid-output");
    expect(() => owned.dispatchBitcoinInspection()).toThrow(
      GenuineLedgerSessionRequiredError,
    );
    expect(fake.resources().actionCount).toBe(1);
    await owned.disconnect();
  });

  it("revokes prior proof as soon as a recheck starts and keeps stale attempts closed", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ])
      .queueAction("list-bitcoin", [{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: false },
          },
        },
      ]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    const first = owned.dispatchGenuineCheck();
    expect((await first.result).settlement).toBe("passed");
    owned.dispatchBitcoinInspection();

    const recheck = owned.dispatchGenuineCheck();
    expect(() => owned.dispatchBitcoinOpen()).toThrow(
      GenuineLedgerSessionRequiredError,
    );
    expect((await recheck.result).settlement).toBe("not-genuine");
    expect(() => owned.dispatchBitcoinOpen()).toThrow(
      GenuineLedgerSessionRequiredError,
    );

    expect(fake.resources().actionCount).toBe(3);
    await owned.disconnect();
  });

  it("rejects an overlapping genuine action before dispatch and allows a settled retry", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ])
      .queueAction("list-bitcoin", [{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    const active = owned.dispatchGenuineCheck();

    expect(() => owned.dispatchGenuineCheck()).toThrow(
      LedgerSessionActionBusyError,
    );
    expect(fake.resources().actionCount).toBe(1);

    active.cancel();
    expect((await active.result).settlement).toBe("failed");
    const retry = owned.dispatchGenuineCheck();
    expect((await retry.result).settlement).toBe("passed");
    owned.dispatchBitcoinInspection();
    expect(fake.resources().actionCount).toBe(3);
    await owned.disconnect();
  });

  it("cancels and settles an in-flight genuine run when lifecycle invalidates", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([
        {
          type: "error",
          error: new Error("symbolic lifecycle failure"),
          atMs: 5,
        },
      ])
      .queueAction("genuine", [{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    const run = owned.dispatchGenuineCheck();

    await vi.advanceTimersByTimeAsync(5);

    await expect(run.result).resolves.toEqual({
      terminal: { status: "cancelled" },
      settlement: "stale",
    });
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
    });
    await owned.disconnect();
    expect(fake.resources().cancelCount).toBe(1);
  });

  it("notifies invalidation observers once and immediately catches up late observers", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([
        {
          type: "error",
          error: new Error("symbolic lifecycle failure"),
          atMs: 5,
        },
      ]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    const throwingObserver = vi.fn(() => {
      throw new Error("observer failure");
    });
    const observer = vi.fn();
    owned.onInvalidated(throwingObserver);
    owned.onInvalidated(observer);

    await vi.advanceTimersByTimeAsync(5);
    const lateObserver = vi.fn();
    owned.onInvalidated(lateObserver);
    await owned.disconnect();

    expect(throwingObserver).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledTimes(1);
    expect(lateObserver).toHaveBeenCalledTimes(1);
  });

  it("latches disconnect before an invalidation observer can reenter it", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    let nestedDisconnect: Promise<void> | undefined;
    owned.onInvalidated(() => {
      nestedDisconnect = owned.disconnect();
    });

    const firstDisconnect = owned.disconnect();
    expect(nestedDisconnect).toBe(firstDisconnect);
    expect(owned.disconnect()).toBe(firstDisconnect);
    await firstDisconnect;
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("disconnect cancels each protected run once and leaves no subscription orphan", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ])
      .queueAction("list-bitcoin", [{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    expect((await owned.dispatchGenuineCheck().result).settlement).toBe(
      "passed",
    );
    const inspection = owned.dispatchBitcoinInspection();

    const firstDisconnect = owned.disconnect();
    expect(owned.disconnect()).toBe(firstDisconnect);
    await firstDisconnect;

    await expect(inspection.result).resolves.toEqual({ status: "cancelled" });
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      unsubscribeCount: 3,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("finalizes session ownership in the exact reviewed order", async () => {
    const calls: string[] = [];
    let leaseCurrent = true;
    const lease = {
      generation: 41,
      isCurrent: () => leaseCurrent,
      invalidate: vi.fn(() => {
        calls.push("invalidate-lease");
        leaseCurrent = false;
      }),
      release: vi.fn(() => {
        calls.push("release-lease");
        leaseCurrent = false;
      }),
    };
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ])
      .queueAction("list-bitcoin", [{ type: "never" }]);

    const originalLifecycle = fake.observeSessionLifecycle.bind(fake);
    vi.spyOn(fake, "observeSessionLifecycle").mockImplementation(
      (session): DmkStream<never> => {
        const stream = originalLifecycle(session);
        return {
          subscribe: (observer): DmkSubscription => {
            const subscription = stream.subscribe(observer);
            return {
              get closed() {
                return subscription.closed;
              },
              unsubscribe: () => {
                calls.push("unsubscribe-lifecycle");
                subscription.unsubscribe();
              },
            };
          },
        };
      },
    );

    const ownedHolder: { current?: OwnedDmkSession } = {};
    const originalRunAction = fake.runAction.bind(fake);
    vi.spyOn(fake, "runAction").mockImplementation(((session, action) => {
      const operation = originalRunAction(session, action as never);
      if (action.kind !== "list-bitcoin") return operation as never;
      return {
        ...operation,
        cancel: () => {
          calls.push("cancel-action");
          const currentOwned = ownedHolder.current;
          if (!currentOwned) throw new Error("Missing owned test session.");
          expect(currentOwned.isCurrent()).toBe(false);
          expect(() => currentOwned.dispatchGenuineCheck()).toThrow(
            InactiveLedgerSessionError,
          );
          operation.cancel();
        },
      } as never;
    }) as typeof fake.runAction);

    const originalDisconnect = fake.disconnect.bind(fake);
    vi.spyOn(fake, "disconnect").mockImplementation((session) => {
      calls.push("disconnect");
      return originalDisconnect(session);
    });

    const owned = await openOwnedDmkSession(fake, device, {
      acquireLease: () => lease,
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });
    ownedHolder.current = owned;
    expect((await owned.dispatchGenuineCheck().result).settlement).toBe(
      "passed",
    );
    const inspection = owned.dispatchBitcoinInspection();
    owned.onInvalidated(() => calls.push("notify-invalidated"));
    const barrier = testBarrier("released", calls);

    const evidence = await owned.finalize(
      finalizationOptions(barrier.barrier, {
        invalidatePlans: () => calls.push("invalidate-plans"),
        clearPrivateReferences: () => calls.push("clear-private-references"),
      }),
    );

    await expect(inspection.result).resolves.toEqual({ status: "cancelled" });
    expect(evidence).toEqual({ hidRelease: "released", handoff: "ready" });
    expect(calls).toEqual([
      "cancel-action",
      "unsubscribe-lifecycle",
      "invalidate-lease",
      "invalidate-plans",
      "notify-invalidated",
      "arm-barrier",
      "disconnect",
      "wait-barrier",
      "clear-private-references",
      "release-lease",
    ]);
    expect(lease.invalidate).toHaveBeenCalledTimes(1);
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      cancelCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("retains the runtime lease through disconnect timeout and HID observation", async () => {
    const release = deferred<HidReleaseOutcome>();
    const barrier = testBarrier(release.promise);
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueDisconnect({ type: "never" });
    const owned = await openOwnedDmkSession(fake, device, {
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });

    const finalization = owned.finalize(finalizationOptions(barrier.barrier));
    await flushMicrotasks();

    expect(owned.isCurrent()).toBe(false);
    expect(fake.resources().disconnectCount).toBe(1);
    expect(barrier.wait).not.toHaveBeenCalled();
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);

    await vi.advanceTimersByTimeAsync(
      PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs,
    );
    expect(barrier.wait).toHaveBeenCalledTimes(1);
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);

    release.resolve("released");
    await expect(finalization).resolves.toEqual({
      hidRelease: "released",
      handoff: "ready",
    });
    const nextLease = acquireRuntimeLease();
    expect(nextLease.isCurrent()).toBe(true);
    nextLease.release();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("holds the lease across delayed disconnect and clears its watchdog", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueDisconnect({ type: "resolve", value: undefined, afterMs: 500 });
    const owned = await openOwnedDmkSession(fake, device, {
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });
    const barrier = testBarrier();
    const finalization = owned.finalize(finalizationOptions(barrier.barrier));
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(499);
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);
    expect(barrier.wait).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(finalization).resolves.toMatchObject({ handoff: "ready" });
    expect(barrier.wait).toHaveBeenCalledTimes(1);
    const nextLease = acquireRuntimeLease();
    nextLease.release();
    expect(vi.getTimerCount()).toBe(0);
    expect(fake.resources().scheduledTimers).toBe(0);
  });

  it("keeps disconnect rejection secondary and still proves HID release", async () => {
    const rawError = new Error("private-raw-disconnect-canary");
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueDisconnect({ type: "reject", error: rawError, afterMs: 5 });
    const owned = await openOwnedDmkSession(fake, device, {
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });
    const barrier = testBarrier();
    const finalization = owned.finalize(finalizationOptions(barrier.barrier));

    await vi.advanceTimersByTimeAsync(5);
    const evidence = await finalization;

    expect(evidence).toEqual({ hidRelease: "released", handoff: "ready" });
    expect(JSON.stringify(evidence)).not.toContain(rawError.message);
    expect(barrier.wait).toHaveBeenCalledTimes(1);
    expect(fake.resources().disconnectCount).toBe(1);
    const nextLease = acquireRuntimeLease();
    nextLease.release();
  });

  it("lets first finalization options win across reentrant finalize and disconnect", async () => {
    const firstCalls: string[] = [];
    const secondCalls: string[] = [];
    const firstBarrier = testBarrier("released", firstCalls);
    const secondBarrier = testBarrier("timed-out", secondCalls);
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });
    const secondOptions = finalizationOptions(secondBarrier.barrier, {
      invalidatePlans: () => secondCalls.push("invalidate-plans"),
      clearPrivateReferences: () => secondCalls.push("clear-private-references"),
    });
    let nestedFinalization: Promise<unknown> | undefined;
    let nestedDisconnect: Promise<void> | undefined;
    owned.onInvalidated(() => {
      nestedFinalization = owned.finalize(secondOptions);
      nestedDisconnect = owned.disconnect();
    });
    const firstOptions = finalizationOptions(firstBarrier.barrier, {
      invalidatePlans: () => firstCalls.push("invalidate-plans"),
      clearPrivateReferences: () => firstCalls.push("clear-private-references"),
    });

    const first = owned.finalize(firstOptions);
    const repeated = owned.finalize(secondOptions);

    expect(repeated).toBe(first);
    expect(nestedFinalization).toBe(first);
    expect(owned.disconnect()).toBe(nestedDisconnect);
    await expect(first).resolves.toEqual({
      hidRelease: "released",
      handoff: "ready",
    });
    await nestedDisconnect;
    expect(firstCalls).toEqual([
      "invalidate-plans",
      "arm-barrier",
      "wait-barrier",
      "clear-private-references",
    ]);
    expect(secondCalls).toEqual([]);
    expect(fake.resources().disconnectCount).toBe(1);
  });

  it("snapshots first-caller cleanup hooks before asynchronous finalization", async () => {
    const release = deferred<HidReleaseOutcome>();
    const barrier = testBarrier(release.promise);
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });
    const acceptedClear = vi.fn();
    const replacementClear = vi.fn();
    const options = {
      clock: systemClock,
      hidBarrier: barrier.barrier,
      invalidatePlans: vi.fn(),
      clearPrivateReferences: acceptedClear,
    };

    const finalization = owned.finalize(options);
    options.clearPrivateReferences = replacementClear;
    await flushMicrotasks();
    release.resolve("released");

    await expect(finalization).resolves.toEqual({
      hidRelease: "released",
      handoff: "ready",
    });
    expect(acceptedClear).toHaveBeenCalledOnce();
    expect(replacementClear).not.toHaveBeenCalled();
  });

  it("falls back safely when reading first-caller hooks is hostile", async () => {
    let leaseCurrent = true;
    const lease = {
      generation: 73,
      isCurrent: () => leaseCurrent,
      invalidate: vi.fn(() => {
        leaseCurrent = false;
      }),
      release: vi.fn(() => {
        leaseCurrent = false;
      }),
    };
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      acquireLease: () => lease,
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });
    const invalidated = vi.fn();
    owned.onInvalidated(invalidated);
    const getterFailure = new Error("private-options-getter-canary");
    const invalidatePlansGetter = vi.fn(() => {
      throw getterFailure;
    });
    const externalClear = vi.fn();
    const options = Object.create(null) as FinalizeOwnedDmkSessionOptions;
    Object.defineProperties(options, {
      clock: { value: systemClock },
      hidBarrier: { value: testBarrier().barrier },
      invalidatePlans: { get: invalidatePlansGetter },
      clearPrivateReferences: { value: externalClear },
    });

    const evidence = await owned.finalize(options);

    expect(evidence).toEqual({
      hidRelease: "unavailable",
      handoff: "reconnect-required",
    });
    expect(invalidatePlansGetter).toHaveBeenCalledOnce();
    expect(lease.invalidate).toHaveBeenCalledOnce();
    expect(invalidated).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
    expect(externalClear).not.toHaveBeenCalled();
    expect(owned.isCurrent()).toBe(false);
  });

  it("blocks lifecycle reattachment from a hostile unsubscribe callback", async () => {
    const fake = new ScriptedDmk(systemClock).queueConnect({
      type: "resolve",
      value: allowedSession,
    });
    let reattachFailure: unknown;
    const replacementSubscribe = vi.fn();
    const replacementStream: DmkStream<never> = {
      subscribe: () => {
        replacementSubscribe();
        return { closed: false, unsubscribe: vi.fn() };
      },
    };
    const initialUnsubscribe = vi.fn(() => {
      try {
        owned.attachLifecycle(replacementStream);
      } catch (error) {
        reattachFailure = error;
      }
    });
    vi.spyOn(fake, "observeSessionLifecycle").mockReturnValue({
      subscribe: () => ({
        closed: false,
        unsubscribe: initialUnsubscribe,
      }),
    });
    const owned: OwnedDmkSession = await openOwnedDmkSession(fake, device, {
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });

    await owned.finalize(finalizationOptions(testBarrier().barrier));

    expect(initialUnsubscribe).toHaveBeenCalledOnce();
    expect(reattachFailure).toBeInstanceOf(InactiveLedgerSessionError);
    expect(replacementSubscribe).not.toHaveBeenCalled();
  });

  it("contains synchronous and hostile-thenable raw disconnects", async () => {
    const rawCanary = new Error("private-hostile-disconnect-canary");
    const cases: readonly (() => Promise<void>)[] = [
      () => {
        throw rawCanary;
      },
      () =>
        Object.defineProperty({}, "then", {
          get: () => {
            throw rawCanary;
          },
        }) as Promise<void>,
    ];

    for (const disconnect of cases) {
      const fake = new ScriptedDmk(systemClock)
        .queueConnect({ type: "resolve", value: allowedSession })
        .queueSessionLifecycle([{ type: "never" }]);
      const disconnectSpy = vi
        .spyOn(fake, "disconnect")
        .mockImplementation(disconnect);
      const owned = await openOwnedDmkSession(fake, device, {
        clock: systemClock,
        modelPolicy: candidatePolicy,
      });

      await expect(
        owned.finalize(finalizationOptions(testBarrier().barrier)),
      ).resolves.toEqual({ hidRelease: "released", handoff: "ready" });
      expect(disconnectSpy).toHaveBeenCalledOnce();
      const nextLease = acquireRuntimeLease();
      nextLease.release();
    }
  });

  it("keeps a lifecycle-invalidated lease owned until eventual finalization", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([
        {
          type: "error",
          error: new Error("private-lifecycle-canary"),
          atMs: 5,
        },
      ]);
    const owned = await openOwnedDmkSession(fake, device, {
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });

    await vi.advanceTimersByTimeAsync(5);

    expect(owned.isCurrent()).toBe(false);
    expect(fake.resources().disconnectCount).toBe(0);
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);

    await owned.finalize(finalizationOptions(testBarrier().barrier));
    const nextLease = acquireRuntimeLease();
    nextLease.release();
    expect(fake.resources().disconnectCount).toBe(1);
  });

  it("makes compatibility disconnect the conservative first-options winner", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });
    const realBarrier = testBarrier("released");

    const firstDisconnect = owned.disconnect();
    const secondDisconnect = owned.disconnect();
    const evidence = owned.finalize(finalizationOptions(realBarrier.barrier));

    expect(secondDisconnect).toBe(firstDisconnect);
    await expect(evidence).resolves.toEqual({
      hidRelease: "unavailable",
      handoff: "reconnect-required",
    });
    await firstDisconnect;
    expect(realBarrier.arm).not.toHaveBeenCalled();
    expect(realBarrier.wait).not.toHaveBeenCalled();
    expect(fake.resources().disconnectCount).toBe(1);
    expect(() => owned.dispatchGenuineCheck()).toThrow(
      InactiveLedgerSessionError,
    );
    expect(fake.resources().actionCount).toBe(0);
  });

  it("deduplicates repeated action cancellation and ignores late terminals", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: allowedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { isGenuine: true },
          },
        },
      ])
      .queueAction("list-bitcoin", [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
          atMs: 5,
          afterCancel: true,
        },
      ]);
    const owned = await openOwnedDmkSession(fake, device, {
      clock: systemClock,
      modelPolicy: candidatePolicy,
    });
    expect((await owned.dispatchGenuineCheck().result).settlement).toBe(
      "passed",
    );
    const inspection = owned.dispatchBitcoinInspection();
    inspection.cancel();
    inspection.cancel();
    const clearPrivateReferences = vi.fn();
    const options = finalizationOptions(testBarrier().barrier, {
      clearPrivateReferences,
    });

    const first = owned.finalize(options);
    expect(owned.finalize(options)).toBe(first);
    await expect(inspection.result).resolves.toEqual({ status: "cancelled" });
    await expect(first).resolves.toMatchObject({ handoff: "ready" });
    await vi.advanceTimersByTimeAsync(5);

    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
    expect(clearPrivateReferences).toHaveBeenCalledTimes(1);
    await owned.disconnect();
    expect(fake.resources().disconnectCount).toBe(1);
  });
});
