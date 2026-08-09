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
import { openBitcoin } from "./openBitcoin";

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "opaque-device",
});
const connectedSession: DmkSession = Object.freeze({
  internalSessionId: "opaque-session",
  modelId: "nanoS",
});
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

type OpenStep = ScriptedStreamStep<DmkActionState<"open-bitcoin">>;

function fakeWithOpen(steps: readonly OpenStep[]): ScriptedDmk {
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
    .queueAction("open-bitcoin", steps);
}

async function openGenuine(fake: ScriptedDmk): Promise<OwnedDmkSession> {
  const owned = await openOwnedDmkSession(fake, device, {
    modelPolicy: candidatePolicy,
  });
  await checkGenuine(owned).result;
  return owned;
}

describe("fixed non-authoritative Bitcoin open action", () => {
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
      .queueAction("open-bitcoin", [{ type: "never" }]);
    const owned = await openOwnedDmkSession(fake, device, {
      modelPolicy: candidatePolicy,
    });

    const handle = openBitcoin(owned);

    await expect(handle.result).resolves.toEqual({ appOpened: false });
    expect(fake.resources().actionCount).toBe(0);
    await owned.disconnect();
  });

  it("accepts only reviewed completion and emits only approved interactions", async () => {
    const canary = "private-open-session-apdu-and-app-canary";
    const fake = fakeWithOpen([
      {
        type: "next",
        value: { status: "pending", interaction: "unlock-device" },
      },
      {
        type: "next",
        value: {
          status: "pending",
          interaction: "confirm-open-app",
          appName: canary,
        } as never,
      },
      {
        type: "next",
        value: {
          status: "pending",
          interaction: "allow-secure-connection",
        },
      },
      {
        type: "next",
        value: { status: "pending", interaction: canary } as never,
      },
      {
        type: "next",
        value: {
          status: "completed",
          output: { appOpened: true, rawAppName: canary },
        } as never,
      },
    ]);
    const owned = await openGenuine(fake);
    const events: unknown[] = [];
    const onEvent = vi.fn((event) => {
      events.push(event);
      throw new Error("consumer-listener-failure");
    });

    const result = await openBitcoin(owned, { onEvent }).result;

    expect(result).toEqual({ appOpened: true });
    expect(Object.keys(result)).toEqual(["appOpened"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(events).toEqual([
      { phase: "opening-bitcoin", interaction: "unlock-device" },
      {
        phase: "opening-bitcoin",
        interaction: "confirm-open-bitcoin",
      },
      { phase: "opening-bitcoin" },
    ]);
    expect(JSON.stringify({ result, events })).not.toContain(canary);
    expect(
      fake.calls
        .filter((call) => call.type === "run-action")
        .map((call) => call.action?.kind),
    ).toEqual(["genuine", "open-bitcoin"]);
    await owned.disconnect();
  });

  it("reduces false, missing, inherited, accessor, and hostile output to false", async () => {
    const getter = vi.fn(() => true);
    const trap = vi.fn(() => {
      throw new Error("private-open-output-proxy-canary");
    });
    const outputs: unknown[] = [
      { appOpened: false },
      {},
      Object.create({ appOpened: true }),
      Object.defineProperty({}, "appOpened", { get: getter }),
      new Proxy({}, { getOwnPropertyDescriptor: trap }),
    ];

    for (const output of outputs) {
      const fake = fakeWithOpen([
        {
          type: "next",
          value: { status: "completed", output } as never,
        },
      ]);
      const owned = await openGenuine(fake);

      await expect(openBitcoin(owned).result).resolves.toEqual({
        appOpened: false,
      });
      await owned.disconnect();
      resetRuntimeLeaseForTesting();
    }

    expect(getter).not.toHaveBeenCalled();
    expect(trap).toHaveBeenCalledOnce();
  });

  it.each<{
    name: string;
    steps: readonly OpenStep[];
  }>([
    {
      name: "action error",
      steps: [
        {
          type: "next",
          value: {
            status: "error",
            rawError: { _tag: "ActionRefusedError", secret: "canary" },
          },
        },
      ],
    },
    {
      name: "stopped",
      steps: [{ type: "next", value: { status: "stopped" } }],
    },
    {
      name: "stream error",
      steps: [{ type: "error", error: new Error("private-error-canary") }],
    },
    {
      name: "subscription error",
      steps: [
        {
          type: "throw-on-subscribe",
          error: new Error("private-subscription-canary"),
        },
      ],
    },
    { name: "stream completion", steps: [{ type: "complete" }] },
    {
      name: "invalid state",
      steps: [
        {
          type: "next",
          value: { status: "future-open-state", secret: "canary" } as never,
        },
      ],
    },
  ])("keeps $name non-authoritative", async ({ steps }) => {
    const fake = fakeWithOpen(steps);
    const owned = await openGenuine(fake);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await openBitcoin(owned).result;

    expect(result).toEqual({ appOpened: false });
    expect(owned.isCurrent()).toBe(true);
    expect(JSON.stringify(result)).not.toContain("canary");
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    await owned.disconnect();
  });

  it("cancels idempotently and ignores a late claimed success", async () => {
    const fake = fakeWithOpen([
      {
        type: "next",
        value: { status: "completed", output: { appOpened: true } },
        atMs: 10,
        afterCancel: true,
      },
    ]);
    const owned = await openGenuine(fake);
    const handle = openBitcoin(owned);

    handle.cancel();
    handle.cancel();
    await vi.advanceTimersByTimeAsync(10);

    await expect(handle.result).resolves.toEqual({ appOpened: false });
    expect(fake.resources().cancelCount).toBe(1);
    await owned.disconnect();
  });

  it("settles false even when a hostile run cancel throws", async () => {
    const cancel = vi.fn(() => {
      throw new Error("private-cancel-canary");
    });
    const session = {
      dispatchBitcoinOpen: () => ({
        result: new Promise(() => undefined),
        cancel,
      }),
    } as unknown as OwnedDmkSession;
    const handle = openBitcoin(session);

    expect(() => handle.cancel()).not.toThrow();
    expect(() => handle.cancel()).not.toThrow();
    await expect(handle.result).resolves.toEqual({ appOpened: false });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("maps session invalidation to false without replacing installation truth", async () => {
    const fake = fakeWithOpen([{ type: "never" }]);
    const owned = await openGenuine(fake);
    const handle = openBitcoin(owned);

    await owned.disconnect();

    await expect(handle.result).resolves.toEqual({ appOpened: false });
    expect(fake.resources()).toMatchObject({
      cancelCount: 1,
      activeSubscriptions: 0,
    });
  });

  it("returns false when protected dispatch throws synchronously", async () => {
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
    const handle = openBitcoin(owned);

    handle.cancel();
    await expect(handle.result).resolves.toEqual({ appOpened: false });
    expect(fake.resources().actionCount).toBe(1);
    await owned.disconnect();
  });
});
