import { systemClock } from "../clock";
import type {
  DmkActionState,
  DmkDiscoveredDevice,
  DmkSession,
} from "../dmkPort";
import { resetRuntimeLeaseForTesting } from "../runtimeLease";
import { type OwnedDmkSession, openOwnedDmkSession } from "../session";
import { createCandidateModelPolicyForTesting } from "../supportedModels";
import {
  ScriptedDmk,
  type ScriptedActionStep,
  type ScriptedStreamStep,
} from "../testing/scriptedDmk";

import { checkGenuine } from "./checkGenuine";
import { installAndVerifyBitcoin } from "./installAndVerifyBitcoin";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "opaque-device",
});
const connectedSession: DmkSession = Object.freeze({
  internalSessionId: "opaque-session",
  modelId: "nanoS",
});
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

type InstallStep = ScriptedActionStep<"install-bitcoin">;
type InspectionStep = ScriptedStreamStep<
  DmkActionState<"list-bitcoin">
>;

function fakeWithFlow(
  installSteps: readonly InstallStep[],
  inspectionSteps?: readonly InspectionStep[],
): ScriptedDmk {
  const fake = new ScriptedDmk(systemClock)
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
    .queueAction("install-bitcoin", installSteps);
  if (inspectionSteps) {
    fake.queueAction("list-bitcoin", inspectionSteps);
  }
  return fake;
}

async function openGenuine(fake: ScriptedDmk): Promise<OwnedDmkSession> {
  const owned = await openOwnedDmkSession(fake, device, {
    modelPolicy: candidatePolicy,
  });
  await checkGenuine(owned).result;
  return owned;
}

function actionCalls(fake: ScriptedDmk) {
  return fake.calls.filter((call) => call.type === "run-action");
}

describe("install and independently verify Bitcoin", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
  });

  it("succeeds only after one distinct fresh inspection proves exact presence", async () => {
    const canary = "private-inventory-hash-and-session-canary";
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "pending",
            interaction: "allow-secure-connection",
            progress: 0.25,
          },
        },
        { type: "attempt-install-mutation" },
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ],
      [
        {
          type: "next",
          value: {
            status: "pending",
            interaction: "unlock-device",
            progress: 0.99,
          },
        },
        {
          type: "next",
          value: {
            status: "completed",
            output: {
              bitcoinPresent: true,
              installedApps: [{ name: canary, hash: canary }],
            },
          } as never,
        },
      ],
    );
    const owned = await openGenuine(fake);
    const events: unknown[] = [];
    const onVerificationStart = vi.fn(() => {
      expect(
        actionCalls(fake).map((call) => call.action?.kind),
      ).toEqual(["genuine", "install-bitcoin"]);
    });
    const handle = installAndVerifyBitcoin(owned, {
      onEvent: (event) => events.push(event),
      onVerificationStart,
    });

    expect(handle.dispatchStarted()).toBe(true);
    expect(handle.mutationAttempted()).toBe(true);
    const result = await handle.result;

    expect(result).toEqual({
      status: "installed",
      sessionGeneration: owned.generation,
    });
    expect(onVerificationStart).toHaveBeenCalledOnce();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.keys(result)).toEqual(["status", "sessionGeneration"]);
    expect(events).toEqual([
      {
        phase: "installing",
        interaction: "allow-secure-connection",
        progress: 25,
      },
      { phase: "verifying", interaction: "unlock-device" },
    ]);
    expect(JSON.stringify({ events, result })).not.toContain(canary);

    const calls = actionCalls(fake);
    expect(calls.map((call) => call.action?.kind)).toEqual([
      "genuine",
      "install-bitcoin",
      "list-bitcoin",
    ]);
    expect(calls[1]?.operationId).not.toBe(calls[2]?.operationId);
    expect(new Set(calls.map((call) => call.operationId)).size).toBe(3);
    await owned.disconnect();
  });

  it("verifies after the identity-reviewed repeated-attempt settlement", async () => {
    const fake = fakeWithFlow(
      [
        { type: "attempt-install-mutation" },
        { type: "next", value: { status: "verification-required" } },
      ],
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
        },
      ],
    );
    const owned = await openGenuine(fake);

    await expect(installAndVerifyBitcoin(owned).result).resolves.toEqual({
      status: "installed",
      sessionGeneration: owned.generation,
    });
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin", "list-bitcoin"]);
    await owned.disconnect();
  });

  it("carries no-mutation completion through fresh proof as already-installed", async () => {
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ],
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
        },
      ],
    );
    const owned = await openGenuine(fake);

    await expect(installAndVerifyBitcoin(owned).result).resolves.toEqual({
      status: "already-installed",
      sessionGeneration: owned.generation,
    });
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin", "list-bitcoin"]);
    await owned.disconnect();
  });

  it("carries native AppAlreadyInstalled through fresh proof as already-installed", async () => {
    const canary = "private-app-already-composition-canary";
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "error",
            rawError: {
              _tag: "AppAlreadyInstalledDAError",
              message: canary,
            },
          },
        },
      ],
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
        },
      ],
    );
    const owned = await openGenuine(fake);

    const result = await installAndVerifyBitcoin(owned).result;

    expect(result).toEqual({
      status: "already-installed",
      sessionGeneration: owned.generation,
    });
    expect(JSON.stringify(result)).not.toContain(canary);
    await owned.disconnect();
  });

  it("does not inspect after native out-of-memory requires recovery", async () => {
    const canary = "private-oom-composition-canary";
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "error",
            rawError: { _tag: "OutOfMemoryDAError", message: canary },
          },
        },
      ],
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
        },
      ],
    );
    const owned = await openGenuine(fake);

    const error = await installAndVerifyBitcoin(owned).result.catch(
      (failure) => failure,
    );

    expect(error).toMatchObject({
      code: "insufficient-space",
      phase: "installing",
      recoverable: true,
    });
    expect(`${error.message}|${JSON.stringify(error)}`).not.toContain(canary);
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin"]);
    await owned.disconnect();
  });

  it("treats independently observed absence as unknown and never retries", async () => {
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ],
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: false },
          },
        },
      ],
    );
    const owned = await openGenuine(fake);

    await expect(installAndVerifyBitcoin(owned).result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
      recoverable: true,
    });
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin", "list-bitcoin"]);
    await owned.disconnect();
  });

  it.each<{
    name: string;
    steps: readonly InspectionStep[];
  }>([
    {
      name: "raw action error",
      steps: [
        {
          type: "next",
          value: {
            status: "error",
            rawError: {
              _tag: "SecureChannelError",
              inventory: "private-verification-action-canary",
            },
          },
        },
      ],
    },
    {
      name: "stopped state",
      steps: [{ type: "next", value: { status: "stopped" } }],
    },
    {
      name: "raw stream error",
      steps: [
        {
          type: "error",
          error: {
            _tag: "WebSocketConnectionError",
            endpoint: "private-verification-stream-canary",
          },
        },
      ],
    },
    { name: "stream completion", steps: [{ type: "complete" }] },
    {
      name: "invalid state",
      steps: [
        {
          type: "next",
          value: { status: "future-state" } as never,
        },
      ],
    },
    {
      name: "subscription failure",
      steps: [
        {
          type: "throw-on-subscribe",
          error: {
            _tag: "DeviceLockedError",
            session: "private-verification-subscribe-canary",
          },
        },
      ],
    },
    {
      name: "malformed presence",
      steps: [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: "true" },
          } as never,
        },
      ],
    },
  ])("redacts $name as verification state unknown", async ({ steps }) => {
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ],
      steps,
    );
    const owned = await openGenuine(fake);

    const error = await installAndVerifyBitcoin(owned).result.catch(
      (failure) => failure,
    );

    expect(error).toMatchObject({
      name: "BitcoinInstallerError",
      code: "state-unknown",
      phase: "verifying",
      recoverable: true,
    });
    const exposed = `${error.message}|${JSON.stringify(error)}|${
      error.stack ?? ""
    }`;
    for (const canary of [
      "private-verification-action-canary",
      "private-verification-stream-canary",
      "private-verification-subscribe-canary",
    ]) {
      expect(exposed).not.toContain(canary);
    }
    expect("cause" in error).toBe(false);
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin", "list-bitcoin"]);
    await owned.disconnect();
  });

  it("lets cancellation win between install settlement and inspection dispatch", async () => {
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ],
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
        },
      ],
    );
    const owned = await openGenuine(fake);
    const handle = installAndVerifyBitcoin(owned);

    handle.cancel();
    handle.cancel();

    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
      recoverable: true,
    });
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin"]);
    expect(fake.resources().cancelCount).toBe(0);
    await owned.disconnect();
  });

  it("invokes verification-start once and lets reentrant cancellation prevent inspection", async () => {
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ],
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
        },
      ],
    );
    const owned = await openGenuine(fake);
    const onVerificationStart = vi.fn(() => {
      handle.cancel();
      handle.cancel();
    });
    const handle = installAndVerifyBitcoin(owned, { onVerificationStart });

    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
      recoverable: true,
    });
    expect(onVerificationStart).toHaveBeenCalledOnce();
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin"]);
    expect(fake.resources().cancelCount).toBe(0);
    await owned.disconnect();
  });

  it("cancels an active install exactly once and never starts inspection", async () => {
    const fake = fakeWithFlow([{ type: "never" }], [
      {
        type: "next",
        value: {
          status: "completed",
          output: { bitcoinPresent: true },
        },
      },
    ]);
    const owned = await openGenuine(fake);
    const handle = installAndVerifyBitcoin(owned);

    handle.cancel();
    handle.cancel();

    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "installing",
      recoverable: true,
    });
    expect(fake.resources().cancelCount).toBe(1);
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin"]);
    await owned.disconnect();
  });

  it("catches reentrant verification cancellation and suppresses late presence", async () => {
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ],
      [
        {
          type: "next",
          value: { status: "pending", interaction: "unlock-device" },
        },
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
          atMs: 5,
          afterCancel: true,
        },
      ],
    );
    const owned = await openGenuine(fake);
    const events: unknown[] = [];
    const handle = installAndVerifyBitcoin(owned, {
      onEvent: (event) => {
        events.push(event);
        if (event.phase === "verifying") {
          handle.cancel();
          handle.cancel();
        }
      },
    });

    await vi.advanceTimersByTimeAsync(5);

    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
      recoverable: true,
    });
    expect(events).toEqual([
      { phase: "verifying", interaction: "unlock-device" },
    ]);
    expect(fake.resources().cancelCount).toBe(1);
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin", "list-bitcoin"]);
    await owned.disconnect();
  });

  it("treats disconnect between actions as unknown without dispatching inspection", async () => {
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ],
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { bitcoinPresent: true },
          },
        },
      ],
    );
    const owned = await openGenuine(fake);
    const handle = installAndVerifyBitcoin(owned);

    const disconnect = owned.disconnect();

    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
      recoverable: true,
    });
    await disconnect;
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin"]);
  });

  it("maps disconnect during fresh inspection to verification state unknown", async () => {
    const fake = fakeWithFlow(
      [
        {
          type: "next",
          value: {
            status: "completed",
            output: { actionCompleted: true },
          },
        },
      ],
      [{ type: "never" }],
    );
    const owned = await openGenuine(fake);
    const handle = installAndVerifyBitcoin(owned);
    for (let index = 0; index < 5; index += 1) {
      await Promise.resolve();
    }
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin", "list-bitcoin"]);

    await owned.disconnect();

    await expect(handle.result).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
      recoverable: true,
    });
    expect(fake.resources().cancelCount).toBe(1);
  });

  it("keeps live dispatch and late mutation evidence after install failure", async () => {
    const fake = fakeWithFlow([
      {
        type: "next",
        value: {
          status: "error",
          rawError: new Error("private-install-terminal-canary"),
        },
      },
      {
        type: "attempt-install-mutation",
        atMs: 5,
        afterCancel: true,
      },
    ]);
    const owned = await openGenuine(fake);
    const handle = installAndVerifyBitcoin(owned);

    expect(handle.dispatchStarted()).toBe(true);
    expect(handle.mutationAttempted()).toBe(false);
    const error = await handle.result.catch((failure) => failure);
    expect(error).toMatchObject({
      code: "state-unknown",
      phase: "installing",
      recoverable: true,
    });
    expect(JSON.stringify(error)).not.toContain(
      "private-install-terminal-canary",
    );
    await vi.advanceTimersByTimeAsync(5);
    expect(handle.mutationAttempted()).toBe(true);
    expect(
      actionCalls(fake).map((call) => call.action?.kind),
    ).toEqual(["genuine", "install-bitcoin"]);
    await owned.disconnect();
  });
});
