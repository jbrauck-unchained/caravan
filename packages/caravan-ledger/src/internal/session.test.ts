import { systemClock } from "./clock";
import type { DmkDiscoveredDevice, DmkSession } from "./dmkPort";
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
  UnsupportedLedgerModelError,
} from "./session";
import { createCandidateModelPolicyForTesting } from "./supportedModels";
import { ScriptedDmk } from "./testing/scriptedDmk";

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
    owned.dispatchBitcoinInstallation();
    owned.dispatchBitcoinOpen();

    expect(
      fake.calls
        .filter((call) => call.type === "run-action")
        .map((call) => call.action?.kind),
    ).toEqual(["genuine", "list-bitcoin", "install-bitcoin", "open-bitcoin"]);
    await owned.disconnect();
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
});
