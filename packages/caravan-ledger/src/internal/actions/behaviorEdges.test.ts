import type { BitcoinInstallerEvent } from "../../events";
import type { OwnedDmkSession } from "../session";

import { checkGenuine } from "./checkGenuine";
import { inspectBitcoin } from "./inspectBitcoin";
import { installAndVerifyBitcoin } from "./installAndVerifyBitcoin";
import { installBitcoin } from "./installBitcoin";
import { openBitcoin } from "./openBitcoin";

function asSession(value: object): OwnedDmkSession {
  return value as unknown as OwnedDmkSession;
}

describe("action boundary edge behavior", () => {
  it("suppresses duplicate genuine guidance and keeps cancellation stale when the session is not current", async () => {
    const cancel = vi.fn();
    const session = asSession({
      isCurrent: () => false,
      dispatchGenuineCheck: ({ onPending }: { onPending?: (value: never) => void }) => {
        const pending = {
          status: "pending",
          interaction: undefined,
          progress: undefined,
        } as never;
        onPending?.(pending);
        onPending?.(pending);
        return {
          result: Promise.resolve({
            terminal: { status: "completed", output: {} },
            settlement: "passed",
          }),
          cancel,
        };
      },
    });
    const events: BitcoinInstallerEvent[] = [];
    const handle = checkGenuine(session, {
      onEvent: (event) => events.push(event),
    });

    handle.cancel();

    await expect(handle.result).resolves.toEqual({ status: "genuine-passed" });
    expect(events).toEqual([{ phase: "checking-genuine" }]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("fails closed for a stale genuine settlement without a cancellation terminal", async () => {
    const session = asSession({
      dispatchGenuineCheck: () => ({
        result: Promise.resolve({
          terminal: { status: "stopped" },
          settlement: "stale",
        }),
        cancel: vi.fn(),
      }),
    });

    await expect(checkGenuine(session).result).rejects.toMatchObject({
      code: "internal",
      phase: "checking-genuine",
    });
  });

  it("suppresses duplicate inspection guidance and rejects primitive completion evidence", async () => {
    const cancel = vi.fn();
    const session = asSession({
      isCurrent: () => false,
      dispatchBitcoinInspection: ({
        onPending,
      }: {
        onPending?: (value: never) => void;
      }) => {
        const pending = {
          status: "pending",
          interaction: undefined,
          progress: undefined,
        } as never;
        onPending?.(pending);
        onPending?.(pending);
        return {
          result: Promise.resolve({ status: "completed", output: null }),
          cancel,
        };
      },
    });
    const events: BitcoinInstallerEvent[] = [];
    const handle = inspectBitcoin(session, {
      onEvent: (event) => events.push(event),
    });

    handle.cancel();

    await expect(handle.result).rejects.toMatchObject({
      code: "internal",
      phase: "checking-bitcoin-app",
    });
    expect(events).toEqual([{ phase: "checking-bitcoin-app" }]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: "a pre-dispatch terminal",
      terminal: { status: "stopped" },
      dispatchStarted: false,
      mutationAttempted: false,
      code: "internal",
    },
    {
      label: "a mutation marker without dispatch evidence",
      terminal: { status: "stopped" },
      dispatchStarted: false,
      mutationAttempted: true,
      code: "state-unknown",
    },
    {
      label: "a primitive completion before dispatch",
      terminal: { status: "completed", output: null },
      dispatchStarted: false,
      mutationAttempted: false,
      code: "internal",
    },
    {
      label: "a malformed completion after only a mutation marker",
      terminal: { status: "completed", output: {} },
      dispatchStarted: false,
      mutationAttempted: true,
      code: "state-unknown",
    },
    {
      label: "a repeat blocker without a mutation marker",
      terminal: { status: "verification-required" },
      dispatchStarted: true,
      mutationAttempted: false,
      code: "state-unknown",
    },
  ])("classifies $label conservatively", async (scenario) => {
    const events: BitcoinInstallerEvent[] = [];
    const session = asSession({
      dispatchBitcoinInstallation: ({
        onPending,
      }: {
        onPending?: (value: never) => void;
      }) => {
        const pending = {
          status: "pending",
          interaction: undefined,
          progress: undefined,
        } as never;
        onPending?.(pending);
        onPending?.(pending);
        return {
          result: Promise.resolve(scenario.terminal),
          dispatchStarted: () => scenario.dispatchStarted,
          mutationAttempted: () => scenario.mutationAttempted,
          cancel: vi.fn(),
        };
      },
    });

    await expect(
      installBitcoin(session, {
        onEvent: (event) => events.push(event),
      }).result,
    ).rejects.toMatchObject({
      code: scenario.code,
      phase: "installing",
    });
    expect(events).toEqual([{ phase: "installing" }]);
  });

  it("reduces primitive and missing-output open terminals to non-authoritative false", async () => {
    for (const terminal of [null, { status: "completed" }]) {
      const session = asSession({
        dispatchBitcoinOpen: () => ({
          result: Promise.resolve(terminal),
          cancel: vi.fn(),
        }),
      });

      await expect(openBitcoin(session).result).resolves.toEqual({
        appOpened: false,
      });
    }
  });

  it("remaps metadata-free verification guidance without inventing interaction or progress", async () => {
    const session = asSession({
      generation: 7,
      isCurrent: () => true,
      dispatchBitcoinInstallation: () => ({
        result: Promise.resolve({
          status: "completed",
          output: { actionCompleted: true },
        }),
        dispatchStarted: () => true,
        mutationAttempted: () => false,
        cancel: vi.fn(),
      }),
      dispatchBitcoinInspection: ({
        onPending,
      }: {
        onPending?: (value: never) => void;
      }) => {
        onPending?.({
          status: "pending",
          interaction: undefined,
          progress: undefined,
        } as never);
        return {
          result: Promise.resolve({
            status: "completed",
            output: { bitcoinPresent: true },
          }),
          cancel: vi.fn(),
        };
      },
    });
    const events: BitcoinInstallerEvent[] = [];

    await expect(
      installAndVerifyBitcoin(session, {
        onEvent: (event) => events.push(event),
      }).result,
    ).resolves.toEqual({
      status: "already-installed",
      sessionGeneration: 7,
    });
    expect(events).toEqual([{ phase: "verifying" }]);
  });

});
