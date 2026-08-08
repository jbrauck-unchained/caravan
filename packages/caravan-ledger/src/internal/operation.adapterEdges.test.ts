import type { BitcoinInstallerEvent } from "../events";

import { systemClock } from "./clock";
import type { DmkDiscoveredDevice, DmkSession } from "./dmkPort";
import type { HidPort } from "./hidPort";
import {
  ReadOnlyPrepareOperation,
  type OperationTerminalPhase,
} from "./operation";
import { PlanStore } from "./planStore";
import {
  acquireRuntimeLease,
  resetRuntimeLeaseForTesting,
} from "./runtimeLease";
import { createCandidateModelPolicyForTesting } from "./supportedModels";
import { ScriptedDmk } from "./testing/scriptedDmk";

type InstallAdapter =
  typeof import("./actions/installAndVerifyBitcoin").installAndVerifyBitcoin;
type OpenAdapter = typeof import("./actions/openBitcoin").openBitcoin;

const adapterControls = vi.hoisted(() => ({
  install: undefined as InstallAdapter | undefined,
  open: undefined as OpenAdapter | undefined,
}));

vi.mock("./actions/installAndVerifyBitcoin", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./actions/installAndVerifyBitcoin")>();
  return {
    ...actual,
    installAndVerifyBitcoin: ((...args: Parameters<InstallAdapter>) =>
      adapterControls.install
        ? adapterControls.install(...args)
        : actual.installAndVerifyBitcoin(...args)) as InstallAdapter,
  };
});

vi.mock("./actions/openBitcoin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./actions/openBitcoin")>();
  return {
    ...actual,
    openBitcoin: ((...args: Parameters<OpenAdapter>) =>
      adapterControls.open
        ? adapterControls.open(...args)
        : actual.openBitcoin(...args)) as OpenAdapter,
  };
});

const device: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "adapter-edge-device",
});
const rawSession: DmkSession = Object.freeze({
  internalSessionId: "adapter-edge-session",
  modelId: "nanoS",
});
const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

function preparedFake(bitcoinPresent: boolean): ScriptedDmk {
  return new ScriptedDmk(systemClock)
    .queueDiscovery([{ type: "next", value: device }])
    .queueConnect({ type: "resolve", value: rawSession })
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
          output: { bitcoinPresent },
        },
      },
    ]);
}

function createOperation(
  fake: ScriptedDmk,
  onEvent: (event: BitcoinInstallerEvent) => void = () => undefined,
): ReadOnlyPrepareOperation {
  const unavailableHid = (): HidPort => {
    throw new Error("HID unavailable in adapter-edge harness");
  };
  return new ReadOnlyPrepareOperation({
    acquireLease: acquireRuntimeLease,
    clock: systemClock,
    createHidPort: unavailableHid,
    createPort: () => fake,
    getSupport: () => ({ supported: true }),
    instanceGeneration: 901,
    modelPolicy: candidatePolicy,
    onEvent,
    onTerminal:
      vi.fn<
        (
          operation: ReadOnlyPrepareOperation,
          phase: OperationTerminalPhase,
        ) => void
      >(),
    planStore: new PlanStore(systemClock),
    planTtlMs: 1_000,
  });
}

function installHandle(
  result: Promise<{
    readonly status: "installed" | "already-installed";
    readonly sessionGeneration: number;
  }>,
  dispatchStarted = true,
) {
  return {
    result,
    dispatchStarted: () => dispatchStarted,
    mutationAttempted: () => dispatchStarted,
    cancel: vi.fn(),
  };
}

describe("operation action-adapter contract edges", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    vi.useFakeTimers();
    adapterControls.install = undefined;
    adapterControls.open = undefined;
  });

  afterEach(() => {
    adapterControls.install = undefined;
    adapterControls.open = undefined;
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
  });

  it("contains a synchronous install-adapter construction failure before dispatch", async () => {
    adapterControls.install = (() => {
      throw new Error("install-construction-canary");
    }) as InstallAdapter;
    const operation = createOperation(preparedFake(false));
    const plan = await operation.begin();

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "installing",
    });
    expect(operation.phase).toBe("failed");
  });

  it("rejects a completed install handle that contradicts its dispatch evidence", async () => {
    adapterControls.install = ((session) =>
      installHandle(
        Promise.resolve({
          status: "already-installed",
          sessionGeneration: session.generation,
        }),
        false,
      )) as InstallAdapter;
    const operation = createOperation(preparedFake(false));
    const plan = await operation.begin();

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "internal",
      phase: "installing",
    });
    expect(operation.phase).toBe("failed");
  });

  it("requires the verification transition before accepting a composed result", async () => {
    adapterControls.install = ((session) =>
      installHandle(
        Promise.resolve({
          status: "installed",
          sessionGeneration: session.generation,
        }),
      )) as InstallAdapter;
    const operation = createOperation(preparedFake(false));
    const plan = await operation.begin();

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
    });
    expect(operation.phase).toBe("needs-recovery");
  });

  it("rejects verification bound to a different session generation", async () => {
    adapterControls.install = ((session, options) => {
      options?.onVerificationStart?.();
      return installHandle(
        Promise.resolve({
          status: "installed",
          sessionGeneration: session.generation + 1,
        }),
      );
    }) as InstallAdapter;
    const operation = createOperation(preparedFake(false));
    const plan = await operation.begin();

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
    });
  });

  it("rejects a widened verification disposition", async () => {
    adapterControls.install = ((session, options) => {
      options?.onVerificationStart?.();
      return installHandle(
        Promise.resolve({
          status: "future-disposition",
          sessionGeneration: session.generation,
        }) as never,
      );
    }) as InstallAdapter;
    const operation = createOperation(preparedFake(false));
    const plan = await operation.begin();

    await expect(operation.install(plan)).rejects.toMatchObject({
      code: "state-unknown",
      phase: "verifying",
    });
  });

  it.each([false, true])(
    "maps a generic composed rejection to the active mutation phase: verifying=%s",
    async (verifying) => {
      adapterControls.install = ((_session, options) => {
        if (verifying) options?.onVerificationStart?.();
        return installHandle(Promise.reject(new Error("adapter-canary")));
      }) as InstallAdapter;
      const operation = createOperation(preparedFake(false));
      const plan = await operation.begin();

      await expect(operation.install(plan)).rejects.toMatchObject({
        code: "state-unknown",
        phase: verifying ? "verifying" : "installing",
      });
      expect(operation.phase).toBe("needs-recovery");
    },
  );

  it("contains a synchronous open-adapter failure and preserves disposition", async () => {
    adapterControls.open = (() => {
      throw new Error("open-construction-canary");
    }) as OpenAdapter;
    const operation = createOperation(preparedFake(true));
    const plan = await operation.begin();

    await expect(operation.install(plan)).resolves.toMatchObject({
      status: "already-installed",
      appOpen: false,
    });
  });

  it("contains a rejecting open handle and preserves disposition", async () => {
    adapterControls.open = (() => ({
      result: Promise.reject(new Error("open-result-canary")),
      cancel: vi.fn(),
    })) as OpenAdapter;
    const operation = createOperation(preparedFake(true));
    const plan = await operation.begin();

    await expect(operation.install(plan)).resolves.toMatchObject({
      status: "already-installed",
      appOpen: false,
    });
  });

  it("ignores a late rejecting open handle after disposal", async () => {
    let rejectOpen!: (error: unknown) => void;
    const openResult = new Promise<never>((_resolve, reject) => {
      rejectOpen = reject;
    });
    adapterControls.open = (() => ({
      result: openResult,
      cancel: vi.fn(),
    })) as OpenAdapter;
    const operation = createOperation(preparedFake(true));
    const plan = await operation.begin();
    const installation = operation.install(plan);
    await Promise.resolve();

    await operation.dispose();
    rejectOpen(new Error("late-open-canary"));

    await expect(installation).rejects.toMatchObject({
      code: "cancelled",
      phase: "opening-bitcoin",
    });
    expect(operation.phase).toBe("disposed");
  });
});
