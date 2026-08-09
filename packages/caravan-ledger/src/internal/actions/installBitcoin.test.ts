import { systemClock } from "../clock";
import type { DmkDiscoveredDevice, DmkSession } from "../dmkPort";
import { resetRuntimeLeaseForTesting } from "../runtimeLease";
import { type OwnedDmkSession, openOwnedDmkSession } from "../session";
import { createCandidateModelPolicyForTesting } from "../supportedModels";
import {
  ScriptedDmk,
  type ScriptedActionStep,
} from "../testing/scriptedDmk";

import { checkGenuine } from "./checkGenuine";
import { installBitcoin } from "./installBitcoin";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "opaque-device",
});
const connectedSession: DmkSession = Object.freeze({
  internalSessionId: "opaque-session",
  modelId: "nanoS",
});
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

function fakeWithInstall(
  steps: readonly ScriptedActionStep<"install-bitcoin">[],
): ScriptedDmk {
  return new ScriptedDmk(systemClock)
    .queueConnect({ type: "resolve", value: connectedSession })
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
    .queueAction("install-bitcoin", steps);
}

async function openGenuine(fake: ScriptedDmk): Promise<OwnedDmkSession> {
  const owned = await openOwnedDmkSession(fake, device, {
    modelPolicy: candidatePolicy,
  });
  await checkGenuine(owned).result;
  return owned;
}

describe("fixed Bitcoin installation action", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
  });

  it("does not dispatch before the current session passes genuine", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: connectedSession })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("install-bitcoin", [{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });

    const handle = installBitcoin(owned);

    await expect(handle.result).rejects.toMatchObject({
      code: "internal",
      phase: "installing",
      recoverable: false,
    });
    expect(handle.dispatchStarted()).toBe(false);
    expect(handle.mutationAttempted()).toBe(false);
    expect(fake.resources().actionCount).toBe(0);
    await owned.disconnect();
  });

  it("emits only monotonic reviewed events and reduces completion to private evidence", async () => {
    const canary = "private-device-id-catalog-hash-and-apdu-canary";
    const fake = fakeWithInstall([
      {
        type: "next",
        value: {
          status: "pending",
          interaction: "unlock-device",
          progress: 0.2,
          deviceId: canary,
        } as never,
      },
      { type: "attempt-install-mutation" },
      {
        type: "next",
        value: {
          status: "pending",
          interaction: "allow-secure-connection",
          progress: 0.1,
        },
      },
      {
        type: "next",
        value: {
          status: "pending",
          interaction: canary,
          progress: 0.255,
        } as never,
      },
      {
        type: "next",
        value: { status: "pending", progress: 1 },
      },
      {
        type: "next",
        value: {
          status: "completed",
          output: { actionCompleted: true, catalog: canary },
        } as never,
      },
    ]);
    const owned = await openGenuine(fake);
    const events: unknown[] = [];
    const onEvent = vi.fn((event) => {
      events.push(event);
      throw new Error("consumer-listener-failure");
    });

    const handle = installBitcoin(owned, { onEvent });
    const result = await handle.result;

    expect(handle.dispatchStarted()).toBe(true);
    expect(handle.mutationAttempted()).toBe(true);
    expect(result).toEqual({
      kind: "verification-required",
      disposition: "installed",
    });
    expect(Object.keys(result)).toEqual(["kind", "disposition"]);
    expect("status" in result).toBe(false);
    expect(events).toEqual([
      { phase: "installing", interaction: "unlock-device", progress: 20 },
      {
        phase: "installing",
        interaction: "allow-secure-connection",
        progress: 20,
      },
      { phase: "installing", progress: 26 },
      { phase: "installing", progress: 100 },
    ]);
    expect(JSON.stringify({ events, result })).not.toContain(canary);
    expect(
      fake.calls
        .filter((call) => call.type === "run-action")
        .map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin"]);
    await owned.disconnect();
  });

  it("routes strict completion without mutation toward already-installed verification", async () => {
    const fake = fakeWithInstall([
      {
        type: "next",
        value: {
          status: "completed",
          output: { actionCompleted: true },
        },
      },
    ]);
    const owned = await openGenuine(fake);
    const handle = installBitcoin(owned);

    await expect(handle.result).resolves.toEqual({
      kind: "verification-required",
      disposition: "already-installed",
    });
    expect(handle.dispatchStarted()).toBe(true);
    expect(handle.mutationAttempted()).toBe(false);
    await owned.disconnect();
  });

  it("routes only native AppAlreadyInstalled action-error to already-installed verification", async () => {
    const canary = "private-app-already-vendor-canary";
    const rawError = {
      _tag: "AppAlreadyInstalledDAError",
      message: canary,
      cause: { endpoint: canary },
    };
    const fake = fakeWithInstall([
      { type: "next", value: { status: "error", rawError } },
    ]);
    const owned = await openGenuine(fake);

    const result = await installBitcoin(owned).result;

    expect(result).toEqual({
      kind: "verification-required",
      disposition: "already-installed",
    });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect("cause" in result).toBe(false);
    await owned.disconnect();
  });

  it("does not infer completion from 100 percent progress", async () => {
    const fake = fakeWithInstall([
      { type: "attempt-install-mutation" },
      { type: "next", value: { status: "pending", progress: 1 } },
      { type: "never" },
    ]);
    const owned = await openGenuine(fake);
    const events: unknown[] = [];
    const handle = installBitcoin(owned, {
      onEvent: (event) => events.push(event),
    });

    expect(handle.mutationAttempted()).toBe(true);
    expect(events).toEqual([{ phase: "installing", progress: 100 }]);
    await expect(
      Promise.race([
        handle.result.then(() => "completed" as const),
        Promise.resolve("pending" as const),
      ]),
    ).resolves.toBe("pending");

    handle.cancel();
    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
    });
    await owned.disconnect();
  });

  it("classifies cancellation after native action start as unknown before the marker", async () => {
    const fake = fakeWithInstall([{ type: "never" }]);
    const owned = await openGenuine(fake);
    const handle = installBitcoin(owned);

    expect(handle.dispatchStarted()).toBe(true);
    handle.cancel();
    handle.cancel();

    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
      recoverable: true,
    });
    expect(handle.mutationAttempted()).toBe(false);
    expect(fake.resources().cancelCount).toBe(1);
    await owned.disconnect();
  });

  it("keeps native out-of-memory actionable without retaining raw vendor data", async () => {
    const canaries = [
      "private-app-hash-canary",
      "wss://private.invalid/secure-channel",
      "e0510000-private-apdu",
    ];
    const rawError = {
      _tag: "OutOfMemoryDAError",
      hash: canaries[0],
      endpoint: canaries[1],
      apdu: canaries[2],
      message: canaries.join("|"),
    };
    const fake = fakeWithInstall([
      { type: "attempt-install-mutation" },
      { type: "next", value: { status: "error", rawError } },
    ]);
    const owned = await openGenuine(fake);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const error = await installBitcoin(owned).result.catch(
      (failure) => failure,
    );

    expect(error).toMatchObject({
      name: "BitcoinInstallerError",
      code: "insufficient-space",
      phase: "installing",
      recoverable: true,
    });
    const exposed = `${error.message}|${JSON.stringify(error)}|${
      error.stack ?? ""
    }`;
    for (const canary of canaries) expect(exposed).not.toContain(canary);
    expect("cause" in error).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    await owned.disconnect();
  });

  it("keeps malformed completion unknown after dispatch even before mutation", async () => {
    for (const attempted of [false, true]) {
      const steps: ScriptedActionStep<"install-bitcoin">[] = [];
      if (attempted) steps.push({ type: "attempt-install-mutation" });
      steps.push({
        type: "next",
        value: { status: "completed", output: { actionCompleted: false } } as never,
      });
      const fake = fakeWithInstall(steps);
      const owned = await openGenuine(fake);

      await expect(installBitcoin(owned).result).rejects.toMatchObject({
        code: "state-unknown",
        phase: "installing",
      });
      await owned.disconnect();
      resetRuntimeLeaseForTesting();
    }
  });

  it("observes a late post-cancel mutation race through the synchronous query", async () => {
    const fake = fakeWithInstall([
      {
        type: "attempt-install-mutation",
        atMs: 5,
        afterCancel: true,
      },
    ]);
    const owned = await openGenuine(fake);
    const handle = installBitcoin(owned);

    expect(handle.dispatchStarted()).toBe(true);
    handle.cancel();
    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
      recoverable: true,
    });
    expect(handle.mutationAttempted()).toBe(false);
    await vi.advanceTimersByTimeAsync(5);
    expect(handle.mutationAttempted()).toBe(true);

    await owned.disconnect();
  });

  it("carries the identity-reviewed repeat blocker as verification required", async () => {
    const fake = fakeWithInstall([
      { type: "attempt-install-mutation" },
      { type: "next", value: { status: "verification-required" } },
    ]);
    const owned = await openGenuine(fake);
    const handle = installBitcoin(owned);

    await expect(handle.result).resolves.toEqual({
      kind: "verification-required",
      disposition: "installed",
    });
    expect(handle.dispatchStarted()).toBe(true);
    expect(handle.mutationAttempted()).toBe(true);
    await owned.disconnect();
  });

  it("retains dispatch proof through synchronous session revalidation and throwing cancel", async () => {
    let current = true;
    const lease = {
      generation: 11,
      isCurrent: () => current,
      invalidate: () => {
        current = false;
      },
      release: vi.fn(() => {
        current = false;
      }),
    };
    const fake = fakeWithInstall([{ type: "never" }]);
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
    await checkGenuine(owned).result;

    const handle = installBitcoin(owned);

    expect(handle.dispatchStarted()).toBe(true);
    expect(handle.mutationAttempted()).toBe(false);
    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
      recoverable: true,
    });
    expect(fake.resources().cancelCount).toBe(1);
    await owned.disconnect();
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "action error",
      [
        {
          type: "next",
          value: {
            status: "error",
            rawError: new Error("private-action-error-canary"),
          },
        },
      ],
      false,
    ],
    ["stopped", [{ type: "next", value: { status: "stopped" } }], false],
    [
      "stream error",
      [
        {
          type: "error",
          error: {
            _tag: "AppAlreadyInstalledDAError",
            message: "private-spoofed-stream-tag-canary",
          },
        },
      ],
      false,
    ],
    ["stream completion", [{ type: "complete" }], false],
    [
      "invalid state",
      [{ type: "next", value: { status: "future-state" } as never }],
      false,
    ],
    [
      "malformed completion",
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: false },
          } as never,
        },
      ],
      false,
    ],
    ["cancellation", [{ type: "never" }], true],
  ] as const)(
    "classifies %s as unknown from dispatch-start evidence before a late mutation marker",
    async (_label, terminalSteps, cancel) => {
      const steps = [
        ...terminalSteps,
        {
          type: "attempt-install-mutation",
          atMs: 5,
          afterCancel: true,
        } as const,
      ] as readonly ScriptedActionStep<"install-bitcoin">[];
      const fake = fakeWithInstall(steps);
      const owned = await openGenuine(fake);
      const handle = installBitcoin(owned);
      if (cancel) handle.cancel();

      const error = await handle.result.catch((failure) => failure);
      expect(error).toMatchObject({
        code: "state-unknown",
        phase: "installing",
        recoverable: true,
      });
      expect(`${error.message}|${JSON.stringify(error)}`).not.toContain(
        "private-",
      );
      expect("cause" in error).toBe(false);
      expect(handle.dispatchStarted()).toBe(true);
      expect(handle.mutationAttempted()).toBe(false);
      await vi.advanceTimersByTimeAsync(5);
      expect(handle.mutationAttempted()).toBe(true);
      await owned.disconnect();
      resetRuntimeLeaseForTesting();
    },
  );

  it("classifies a synchronous subscription failure as unknown after dispatch", async () => {
    const rawError = {
      _tag: "OutOfMemoryDAError",
      message: "private-subscription-error-canary",
    };
    const fake = fakeWithInstall([
      { type: "throw-on-subscribe", error: rawError },
    ]);
    const owned = await openGenuine(fake);
    const handle = installBitcoin(owned);

    const error = await handle.result.catch((failure) => failure);
    expect(error).toMatchObject({
      code: "state-unknown",
      phase: "installing",
      recoverable: true,
    });
    expect(`${error.message}|${JSON.stringify(error)}`).not.toContain(
      "private-subscription-error-canary",
    );
    expect(handle.dispatchStarted()).toBe(true);
    expect(handle.mutationAttempted()).toBe(false);
    await owned.disconnect();
  });
});
