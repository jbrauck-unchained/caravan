import { systemClock } from "../clock";
import type {
  DmkActionState,
  DmkDiscoveredDevice,
  DmkSession,
} from "../dmkPort";
import { resetRuntimeLeaseForTesting } from "../runtimeLease";
import { type OwnedDmkSession, openOwnedDmkSession } from "../session";
import { createCandidateModelPolicyForTesting } from "../supportedModels";
import { ScriptedDmk, type ScriptedStreamStep } from "../testing/scriptedDmk";

import { checkGenuine } from "./checkGenuine";
import { inspectBitcoin } from "./inspectBitcoin";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "opaque-device",
});
const connectedSession: DmkSession = Object.freeze({
  internalSessionId: "opaque-session",
  modelId: "nanoS",
});
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

function fakeWithInspection(
  steps: readonly ScriptedStreamStep<DmkActionState<"list-bitcoin">>[],
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
    .queueAction("list-bitcoin", steps);
}

async function openGenuine(fake: ScriptedDmk): Promise<OwnedDmkSession> {
  const owned = await openOwnedDmkSession(fake, device, {
    modelPolicy: candidatePolicy,
  });
  await checkGenuine(owned).result;
  return owned;
}

describe("Bitcoin inspection action", () => {
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
      .queueAction("list-bitcoin", [{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });
    const handle = inspectBitcoin(owned);

    handle.cancel();
    await expect(handle.result).rejects.toMatchObject({
      code: "internal",
      phase: "checking-bitcoin-app",
    });
    expect(fake.resources().actionCount).toBe(0);
    await owned.disconnect();
  });

  it("returns only exact presence after genuine and discards planted inventory", async () => {
    const canaries = [
      "private-altcoin-app",
      "private-hash-4ad5",
      "native-session-9aa1",
    ];
    const fake = fakeWithInspection([
      {
        type: "next",
        value: {
          status: "pending",
          interaction: "allow-secure-connection",
          progress: 0.91,
          deviceId: canaries[2],
          inventory: canaries,
        } as never,
      },
      {
        type: "next",
        value: {
          status: "completed",
          output: {
            bitcoinPresent: true,
            installedApps: [
              { name: canaries[0], hash: canaries[1], flags: 255 },
            ],
          },
        } as never,
      },
    ]);
    const owned = await openGenuine(fake);
    const events: unknown[] = [];
    const onEvent = vi.fn((event) => {
      events.push(event);
      throw new Error("consumer listener failure");
    });

    const result = await inspectBitcoin(owned, { onEvent }).result;

    expect(result).toEqual({ status: "bitcoin-present" });
    expect(events).toEqual([
      {
        phase: "checking-bitcoin-app",
        interaction: "allow-secure-connection",
      },
    ]);
    const publicValues = JSON.stringify({ result, events });
    for (const canary of canaries) expect(publicValues).not.toContain(canary);
    expect(
      fake.calls
        .filter((call) => call.type === "run-action")
        .map((call) => call.action?.kind),
    ).toEqual(["genuine", "list-bitcoin"]);
    await owned.disconnect();
  });

  it("returns exact absence rather than exposing a boolean or inventory", async () => {
    const fake = fakeWithInspection([
      {
        type: "next",
        value: {
          status: "completed",
          output: { bitcoinPresent: false },
        },
      },
    ]);
    const owned = await openGenuine(fake);

    await expect(inspectBitcoin(owned).result).resolves.toEqual({
      status: "bitcoin-absent",
    });
    await owned.disconnect();
  });

  it.each([
    ["missing", {}],
    ["truthy", { bitcoinPresent: 1 }],
    ["string", { bitcoinPresent: "false" }],
  ])("rejects malformed %s presence evidence", async (_name, output) => {
    const fake = fakeWithInspection([
      {
        type: "next",
        value: { status: "completed", output } as never,
      },
    ]);
    const owned = await openGenuine(fake);

    await expect(inspectBitcoin(owned).result).rejects.toMatchObject({
      code: "internal",
      phase: "checking-bitcoin-app",
      recoverable: false,
    });
    expect(fake.resources().actionCount).toBe(2);
    await owned.disconnect();
  });

  it("does not invoke an accessor while reducing presence", async () => {
    const getter = vi.fn(() => true);
    const output = Object.defineProperty({}, "bitcoinPresent", { get: getter });
    const fake = fakeWithInspection([
      {
        type: "next",
        value: { status: "completed", output } as never,
      },
    ]);
    const owned = await openGenuine(fake);

    await expect(inspectBitcoin(owned).result).rejects.toMatchObject({
      code: "internal",
    });
    expect(getter).not.toHaveBeenCalled();
    await owned.disconnect();
  });

  it("fails closed when a hostile proxy rejects descriptor inspection", async () => {
    const trap = vi.fn(() => {
      throw new Error("hostile-inventory-proxy-canary");
    });
    const output = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: trap,
      },
    );
    const fake = fakeWithInspection([
      {
        type: "next",
        value: { status: "completed", output } as never,
      },
    ]);
    const owned = await openGenuine(fake);

    const error = await inspectBitcoin(owned).result.catch(
      (failure) => failure,
    );

    expect(error).toMatchObject({
      code: "internal",
      phase: "checking-bitcoin-app",
    });
    expect(JSON.stringify(error)).not.toContain(
      "hostile-inventory-proxy-canary",
    );
    expect(trap).toHaveBeenCalledTimes(1);
    await owned.disconnect();
  });

  it.each<{
    name: string;
    steps: readonly ScriptedStreamStep<DmkActionState<"list-bitcoin">>[];
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
              _tag: "SecureChannelError",
              inventory: "private-app-list-canary",
            },
          },
        },
      ],
      code: "secure-channel-failed",
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
            _tag: "WebSocketConnectionError",
            url: "wss://private.invalid/?inventory=canary",
          },
        },
      ],
      code: "ledger-service-unavailable",
    },
    {
      name: "subscription throw",
      steps: [
        {
          type: "throw-on-subscribe",
          error: {
            _tag: "DeviceLockedError",
            sessionId: "raw-session-canary",
          },
        },
      ],
      code: "device-locked",
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
            appHash: "raw-app-hash-canary",
          } as never,
        },
      ],
      code: "internal",
    },
  ])("maps $name safely without inventory leakage", async ({ steps, code }) => {
    const fake = fakeWithInspection(steps);
    const owned = await openGenuine(fake);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const error = await inspectBitcoin(owned).result.catch(
      (failure) => failure,
    );

    expect(error).toMatchObject({
      name: "BitcoinInstallerError",
      code,
      phase: "checking-bitcoin-app",
    });
    const serialized = JSON.stringify(error);
    for (const canary of [
      "private-app-list-canary",
      "wss://private.invalid",
      "raw-session-canary",
      "raw-app-hash-canary",
    ]) {
      expect(serialized).not.toContain(canary);
      expect(error.message).not.toContain(canary);
    }
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(fake.resources().actionCount).toBe(2);
    await owned.disconnect();
  });

  it("cancels once and ignores late presence", async () => {
    const fake = fakeWithInspection([
      {
        type: "next",
        value: {
          status: "completed",
          output: { bitcoinPresent: true },
        },
        atMs: 10,
        afterCancel: true,
      },
    ]);
    const owned = await openGenuine(fake);
    const handle = inspectBitcoin(owned);
    const outcome = expect(handle.result).rejects.toMatchObject({
      code: "cancelled",
      phase: "checking-bitcoin-app",
    });

    handle.cancel();
    handle.cancel();
    await vi.advanceTimersByTimeAsync(10);

    await outcome;
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      unsubscribeCount: 2,
      activeSubscriptions: 1,
    });
    await owned.disconnect();
  });

  it("maps disconnect-owned cancellation and leaves no action orphan", async () => {
    const fake = fakeWithInspection([
      {
        type: "next",
        value: {
          status: "completed",
          output: { bitcoinPresent: true },
        },
        atMs: 10,
        afterCancel: true,
      },
    ]);
    const owned = await openGenuine(fake);
    const handle = inspectBitcoin(owned);
    const outcome = expect(handle.result).rejects.toMatchObject({
      code: "device-disconnected",
      phase: "checking-bitcoin-app",
      recoverable: true,
    });

    await owned.disconnect();
    await vi.advanceTimersByTimeAsync(10);

    await outcome;
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      unsubscribeCount: 3,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
  });

  it("preserves caller cancellation when disconnect follows it", async () => {
    const fake = fakeWithInspection([{ type: "never" }]);
    const owned = await openGenuine(fake);
    const handle = inspectBitcoin(owned);

    handle.cancel();
    const disconnect = owned.disconnect();

    await expect(handle.result).rejects.toMatchObject({
      code: "cancelled",
      phase: "checking-bitcoin-app",
    });
    await disconnect;
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("preserves completed absence when it wins before disconnect", async () => {
    const fake = fakeWithInspection([
      {
        type: "next",
        value: {
          status: "completed",
          output: { bitcoinPresent: false },
        },
      },
    ]);
    const owned = await openGenuine(fake);
    const handle = inspectBitcoin(owned);

    const disconnect = owned.disconnect();

    await expect(handle.result).resolves.toEqual({ status: "bitcoin-absent" });
    await disconnect;
    expect(fake.resources().cancelCount).toBe(0);
  });

  it("returns a safe handle when protected dispatch throws synchronously", async () => {
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
      ]);
    const owned = await openGenuine(fake);
    const handle = inspectBitcoin(owned);

    handle.cancel();
    await expect(handle.result).rejects.toMatchObject({
      code: "internal",
      phase: "checking-bitcoin-app",
    });
    expect(fake.resources().actionCount).toBe(1);
    await owned.disconnect();
  });
});
