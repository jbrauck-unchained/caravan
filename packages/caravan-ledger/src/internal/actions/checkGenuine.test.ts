import { systemClock } from "../clock";
import type {
  DmkActionState,
  DmkDiscoveredDevice,
  DmkSession,
} from "../dmkPort";
import { resetRuntimeLeaseForTesting } from "../runtimeLease";
import {
  GenuineLedgerSessionRequiredError,
  type OwnedDmkSession,
  openOwnedDmkSession,
} from "../session";
import { createCandidateModelPolicyForTesting } from "../supportedModels";
import { ScriptedDmk, type ScriptedStreamStep } from "../testing/scriptedDmk";

import { checkGenuine } from "./checkGenuine";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "opaque-device",
});
const connectedSession: DmkSession = Object.freeze({
  internalSessionId: "opaque-session",
  modelId: "nanoS",
});
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

function fakeWithGenuine(
  steps: readonly ScriptedStreamStep<DmkActionState<"genuine">>[],
): ScriptedDmk {
  return new ScriptedDmk(systemClock)
    .queueConnect({ type: "resolve", value: connectedSession })
    .queueSessionLifecycle([{ type: "never" }])
    .queueAction("genuine", steps);
}

async function open(fake: ScriptedDmk): Promise<OwnedDmkSession> {
  return openOwnedDmkSession(fake, device, { modelPolicy: candidatePolicy });
}

function expectProtectedGateClosed(
  owned: OwnedDmkSession,
  fake: ScriptedDmk,
): void {
  const actionCount = fake.resources().actionCount;
  expect(() => owned.dispatchBitcoinInspection()).toThrow(
    GenuineLedgerSessionRequiredError,
  );
  expect(fake.resources().actionCount).toBe(actionCount);
}

describe("genuine-device action gate", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
  });

  it("accepts only explicit true, emits redacted guidance, and isolates listener failure", async () => {
    const rawFingerprint = "fingerprint-canary-92f1";
    const fake = fakeWithGenuine([
      {
        type: "next",
        value: {
          status: "pending",
          interaction: "unlock-device",
          progress: 0.75,
          rawFingerprint,
          sessionId: "native-session-canary",
        } as never,
      },
      {
        type: "next",
        value: {
          status: "completed",
          output: { isGenuine: true },
        },
      },
    ]).queueAction("list-bitcoin", [{ type: "never" }]);
    const owned = await open(fake);
    const events: unknown[] = [];
    const onEvent = vi.fn((event) => {
      events.push(event);
      throw new Error("consumer listener failure");
    });

    const handle = checkGenuine(owned, { onEvent });

    await expect(handle.result).resolves.toEqual({
      status: "genuine-passed",
    });
    expect(events).toEqual([
      { phase: "checking-genuine", interaction: "unlock-device" },
    ]);
    expect(JSON.stringify(events)).not.toContain(rawFingerprint);
    expect(JSON.stringify(events)).not.toContain("native-session-canary");
    owned.dispatchBitcoinInspection();
    expect(
      fake.calls
        .filter((call) => call.type === "run-action")
        .map((call) => call.action?.kind),
    ).toEqual(["genuine", "list-bitcoin"]);
    await owned.disconnect();
  });

  it("maps explicit false to device-not-genuine and leaves all protected dispatch closed", async () => {
    const fake = fakeWithGenuine([
      {
        type: "next",
        value: {
          status: "completed",
          output: { isGenuine: false },
        },
      },
    ]);
    const owned = await open(fake);

    await expect(checkGenuine(owned).result).rejects.toMatchObject({
      name: "BitcoinInstallerError",
      code: "device-not-genuine",
      phase: "checking-genuine",
      recoverable: false,
    });
    expectProtectedGateClosed(owned, fake);
    await owned.disconnect();
  });

  it.each([
    ["missing", {}],
    ["truthy", { isGenuine: 1 }],
    ["string", { isGenuine: "true" }],
  ])("fails malformed %s completion closed", async (_name, output) => {
    const fake = fakeWithGenuine([
      {
        type: "next",
        value: { status: "completed", output } as never,
      },
    ]);
    const owned = await open(fake);

    await expect(checkGenuine(owned).result).rejects.toMatchObject({
      code: "internal",
      phase: "checking-genuine",
      recoverable: false,
    });
    expectProtectedGateClosed(owned, fake);
    await owned.disconnect();
  });

  it("does not invoke an accessor while validating completed output", async () => {
    const getter = vi.fn(() => true);
    const output = Object.defineProperty({}, "isGenuine", { get: getter });
    const fake = fakeWithGenuine([
      {
        type: "next",
        value: { status: "completed", output } as never,
      },
    ]);
    const owned = await open(fake);

    await expect(checkGenuine(owned).result).rejects.toMatchObject({
      code: "internal",
    });
    expect(getter).not.toHaveBeenCalled();
    expectProtectedGateClosed(owned, fake);
    await owned.disconnect();
  });

  it("fails closed when a hostile proxy rejects descriptor inspection", async () => {
    const trap = vi.fn(() => {
      throw new Error("hostile-genuine-proxy-canary");
    });
    const output = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: trap,
      },
    );
    const fake = fakeWithGenuine([
      {
        type: "next",
        value: { status: "completed", output } as never,
      },
    ]);
    const owned = await open(fake);

    const error = await checkGenuine(owned).result.catch((failure) => failure);

    expect(error).toMatchObject({
      code: "internal",
      phase: "checking-genuine",
    });
    expect(JSON.stringify(error)).not.toContain("hostile-genuine-proxy-canary");
    expect(trap).toHaveBeenCalledTimes(1);
    expectProtectedGateClosed(owned, fake);
    await owned.disconnect();
  });

  it.each<{
    name: string;
    steps: readonly ScriptedStreamStep<DmkActionState<"genuine">>[];
    code: string;
  }>([
    {
      name: "action error",
      steps: [
        {
          type: "next",
          value: {
            status: "error",
            rawError: {
              _tag: "RefusedByUserDAError",
              message: "raw-device-id-a1",
            },
          },
        },
      ],
      code: "user-refused",
    },
    {
      name: "stopped state",
      steps: [{ type: "next", value: { status: "stopped" } }],
      code: "internal",
    },
    {
      name: "observable error",
      steps: [
        {
          type: "error",
          error: {
            _tag: "DeviceDisconnectedWhileSendingError",
            apdu: "e0ff-raw-apdu-canary",
          },
        },
      ],
      code: "device-disconnected",
    },
    {
      name: "subscription throw",
      steps: [
        {
          type: "throw-on-subscribe",
          error: {
            _tag: "NetworkDAError",
            url: "wss://private.invalid/?token=canary",
          },
        },
      ],
      code: "network-unavailable",
    },
    {
      name: "completion without terminal state",
      steps: [{ type: "complete" }],
      code: "internal",
    },
    {
      name: "unknown state",
      steps: [
        {
          type: "next",
          value: {
            status: "future-vendor-state",
            inventory: "private-inventory-canary",
          } as never,
        },
      ],
      code: "internal",
    },
  ])("maps $name safely and keeps the gate closed", async ({ steps, code }) => {
    const fake = fakeWithGenuine(steps);
    const owned = await open(fake);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const error = await checkGenuine(owned).result.catch((failure) => failure);

    expect(error).toMatchObject({
      name: "BitcoinInstallerError",
      code,
      phase: "checking-genuine",
    });
    const serialized = JSON.stringify(error);
    for (const canary of [
      "raw-device-id-a1",
      "e0ff-raw-apdu-canary",
      "wss://private.invalid",
      "private-inventory-canary",
    ]) {
      expect(serialized).not.toContain(canary);
      expect(error.message).not.toContain(canary);
    }
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expectProtectedGateClosed(owned, fake);
    await owned.disconnect();
  });

  it("cancels once, ignores a late true completion, and never opens the gate", async () => {
    const fake = fakeWithGenuine([
      {
        type: "next",
        value: { status: "pending", interaction: "unlock-device" },
        atMs: 5,
      },
      {
        type: "next",
        value: {
          status: "completed",
          output: { isGenuine: true },
        },
        atMs: 10,
        afterCancel: true,
      },
    ]);
    const owned = await open(fake);
    const handle = checkGenuine(owned);
    const outcome = expect(handle.result).rejects.toMatchObject({
      code: "cancelled",
      phase: "checking-genuine",
    });

    handle.cancel();
    handle.cancel();
    await vi.advanceTimersByTimeAsync(10);

    await outcome;
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      unsubscribeCount: 1,
      activeSubscriptions: 1,
    });
    expectProtectedGateClosed(owned, fake);
    await owned.disconnect();
  });

  it("returns a safe handle when session-owned dispatch throws synchronously", async () => {
    const fake = new ScriptedDmk(systemClock)
      .queueConnect({ type: "resolve", value: connectedSession })
      .queueSessionLifecycle([{ type: "never" }]);
    const owned = await open(fake);
    const handle = checkGenuine(owned);

    handle.cancel();
    await expect(handle.result).rejects.toMatchObject({
      code: "internal",
      phase: "checking-genuine",
    });
    expect(fake.resources().actionCount).toBe(0);
    expectProtectedGateClosed(owned, fake);
    await owned.disconnect();
  });

  it("maps session-owned cancellation to device-disconnected and ignores late true", async () => {
    const fake = fakeWithGenuine([
      {
        type: "next",
        value: {
          status: "completed",
          output: { isGenuine: true },
        },
        atMs: 10,
        afterCancel: true,
      },
    ]);
    const owned = await open(fake);
    const handle = checkGenuine(owned);
    const outcome = expect(handle.result).rejects.toMatchObject({
      code: "device-disconnected",
      phase: "checking-genuine",
      recoverable: true,
    });

    await owned.disconnect();
    await vi.advanceTimersByTimeAsync(10);

    await outcome;
    expect(() => owned.dispatchBitcoinInspection()).toThrow("no longer active");
    expect(fake.resources().actionCount).toBe(1);
  });

  it.each([
    {
      name: "explicit false",
      step: {
        type: "next" as const,
        value: {
          status: "completed" as const,
          output: { isGenuine: false },
        },
      },
      code: "device-not-genuine",
    },
    {
      name: "raw refusal",
      step: {
        type: "next" as const,
        value: {
          status: "error" as const,
          rawError: { _tag: "RefusedByUserDAError" },
        },
      },
      code: "user-refused",
    },
  ])(
    "preserves $name when its terminal evidence wins before disconnect",
    async ({ step, code }) => {
      const fake = fakeWithGenuine([step]);
      const owned = await open(fake);
      const handle = checkGenuine(owned);

      const disconnect = owned.disconnect();

      await expect(handle.result).rejects.toMatchObject({
        code,
        phase: "checking-genuine",
      });
      await disconnect;
      expect(fake.resources().cancelCount).toBe(0);
    },
  );

  it("preserves caller cancellation when disconnect follows it", async () => {
    const fake = fakeWithGenuine([{ type: "never" }]);
    const owned = await open(fake);
    const handle = checkGenuine(owned);

    handle.cancel();
    const disconnect = owned.disconnect();

    await expect(handle.result).rejects.toMatchObject({
      code: "cancelled",
      phase: "checking-genuine",
    });
    await disconnect;
    expect(fake.resources().cancelCount).toBe(1);
  });

  it("revokes an earlier pass when a later settled recheck fails", async () => {
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
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "error",
            rawError: { _tag: "SecureChannelError" },
          },
        },
      ]);
    const owned = await open(fake);

    await expect(checkGenuine(owned).result).resolves.toEqual({
      status: "genuine-passed",
    });
    await expect(checkGenuine(owned).result).rejects.toMatchObject({
      code: "secure-channel-failed",
    });

    expectProtectedGateClosed(owned, fake);
    expect(fake.resources().actionCount).toBe(2);
    await owned.disconnect();
  });

  it("rejects an overlapping check before dispatch and permits a settled retry", async () => {
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
          atMs: 10,
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
      ])
      .queueAction("list-bitcoin", [{ type: "never" }]);
    const owned = await open(fake);

    const active = checkGenuine(owned);
    const blocked = checkGenuine(owned);
    blocked.cancel();
    await expect(blocked.result).rejects.toMatchObject({
      code: "internal",
      phase: "checking-genuine",
    });
    expect(fake.resources().actionCount).toBe(1);

    const cancelled = expect(active.result).rejects.toMatchObject({
      code: "cancelled",
    });
    active.cancel();
    await vi.advanceTimersByTimeAsync(10);
    await cancelled;

    await expect(checkGenuine(owned).result).resolves.toEqual({
      status: "genuine-passed",
    });
    owned.dispatchBitcoinInspection();
    expect(fake.resources().actionCount).toBe(3);
    await owned.disconnect();
  });
});
