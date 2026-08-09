import type {
  BitcoinAppInstaller,
  BitcoinInstallerErrorCode,
  BitcoinInstallerEvent,
  BitcoinInstallerPhase,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "@caravan/ledger";

export const SIMULATED_BITCOIN_INSTALLER_SCENARIOS = [
  "install-success",
  "already-installed",
  "user-refused",
  "state-unknown-then-recovery",
  "reconnect-required",
] as const;

export type SimulatedBitcoinInstallerScenario =
  (typeof SIMULATED_BITCOIN_INSTALLER_SCENARIOS)[number];

export const SIMULATED_BITCOIN_INSTALLER_SCENARIO_LABELS: Readonly<
  Record<SimulatedBitcoinInstallerScenario, string>
> = Object.freeze({
  "install-success": "Install Bitcoin successfully",
  "already-installed": "Bitcoin is already installed",
  "user-refused": "User refuses on the device",
  "state-unknown-then-recovery": "State unknown, then recover",
  "reconnect-required": "Reconnect required after installation",
});

interface SimulatedBitcoinInstallerOptions {
  readonly scenario: SimulatedBitcoinInstallerScenario;
  /** A zero delay is useful for deterministic unit tests. */
  readonly stepDelayMs?: number;
}

const ERROR_MESSAGES: Readonly<
  Record<
    Extract<
      BitcoinInstallerErrorCode,
      | "cancelled"
      | "device-busy"
      | "internal"
      | "state-unknown"
      | "user-refused"
    >,
    string
  >
> = Object.freeze({
  cancelled: "The operation was cancelled.",
  "device-busy": "The device is currently unavailable.",
  internal: "The operation could not be completed.",
  "state-unknown": "The Bitcoin app state could not be verified.",
  "user-refused": "The operation was refused on the device.",
});

type SimulatedErrorCode = keyof typeof ERROR_MESSAGES;

/**
 * A safe simulation of the public error shape. It deliberately does not import
 * or instantiate the production package's runtime error implementation.
 */
class SimulatedBitcoinInstallerError extends Error {
  readonly name = "BitcoinInstallerError" as const;

  constructor(
    readonly code: SimulatedErrorCode,
    readonly phase: BitcoinInstallerPhase,
    readonly recoverable: boolean,
  ) {
    super(ERROR_MESSAGES[code]);
  }
}

class InterruptedSimulation extends Error {
  constructor(readonly reason: "cancelled" | "disposed") {
    super("The simulated operation was interrupted.");
  }
}

function rejected<T>(error: SimulatedBitcoinInstallerError): Promise<T> {
  const result = Promise.reject<T>(error);
  void result.catch(() => undefined);
  return result;
}

function frozenResult(
  status: BitcoinInstallResult["status"],
  appOpen: boolean,
  handoff: BitcoinInstallResult["handoff"],
): BitcoinInstallResult {
  return Object.freeze({ status, appOpen, handoff });
}

class SimulatedBitcoinAppInstaller implements BitcoinAppInstaller {
  readonly #listeners = new Set<(event: BitcoinInstallerEvent) => void>();

  readonly #ownedPlans = new WeakSet<object>();

  readonly #consumedPlans = new WeakSet<object>();

  readonly #scenario: SimulatedBitcoinInstallerScenario;

  readonly #stepDelayMs: number;

  #phase: BitcoinInstallerPhase = "idle";

  #currentPlan: BitcoinInstallPlan | undefined;

  #activeOperation: Promise<unknown> | undefined;

  #cancelRequested = false;

  #disposeRequested = false;

  #disposePromise: Promise<void> | undefined;

  #recoveryCompleted = false;

  #mutationMayHaveStarted = false;

  constructor({
    scenario,
    stepDelayMs = 120,
  }: SimulatedBitcoinInstallerOptions) {
    if (!SIMULATED_BITCOIN_INSTALLER_SCENARIOS.includes(scenario)) {
      throw new TypeError("Unknown simulated Ledger scenario.");
    }
    if (
      !Number.isSafeInteger(stepDelayMs) ||
      stepDelayMs < 0 ||
      stepDelayMs > 1_000
    ) {
      throw new TypeError(
        "The simulated Ledger step delay must be an integer from 0 through 1000.",
      );
    }
    this.#scenario = scenario;
    this.#stepDelayMs = stepDelayMs;
  }

  subscribe(listener: (event: BitcoinInstallerEvent) => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("The installer listener must be callable.");
    }
    if (this.#disposeRequested) throw this.#disposedError();

    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  prepare(): Promise<BitcoinInstallPlan> {
    if (this.#disposeRequested) return rejected(this.#disposedError());
    if (this.#activeOperation) return rejected(this.#busyError());
    if (this.#phase !== "idle" && this.#phase !== "cancelled") {
      return rejected(this.#internalError());
    }

    return this.#startOperation(() => this.#runPreparation(false));
  }

  install(plan: BitcoinInstallPlan): Promise<BitcoinInstallResult> {
    if (this.#disposeRequested) return rejected(this.#disposedError());
    if (this.#activeOperation) return rejected(this.#busyError());
    if (!this.#consumePlan(plan)) {
      const error = this.#internalError();
      this.#currentPlan = undefined;
      if (this.#phase === "ready-to-install") {
        this.#emit({ phase: "failed" });
      }
      return rejected(error);
    }

    return this.#startOperation(() => this.#runInstallation(plan.status));
  }

  recover(): Promise<BitcoinInstallPlan> {
    if (this.#disposeRequested) return rejected(this.#disposedError());
    if (this.#activeOperation) return rejected(this.#busyError());
    if (this.#phase !== "needs-recovery") {
      return rejected(this.#internalError());
    }

    return this.#startOperation(() => this.#runPreparation(true));
  }

  cancel(): void {
    if (this.#disposeRequested || this.#phase === "disposed") return;
    if (this.#cancelRequested) return;

    if (
      this.#phase === "releasing-device" ||
      this.#phase === "ready-for-webusb" ||
      this.#phase === "needs-recovery" ||
      this.#phase === "cancelled" ||
      this.#phase === "failed"
    ) {
      return;
    }

    if (this.#activeOperation) {
      this.#cancelRequested = true;
      return;
    }

    if (this.#phase === "ready-to-install") {
      this.#cancelRequested = true;
      this.#currentPlan = undefined;
      this.#emit({ phase: "cancelled" });
    }
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposeRequested = true;
    this.#currentPlan = undefined;

    const activeOperation = this.#activeOperation;
    // Defer the runner so the idempotency latch is visible before a disposed
    // listener can synchronously reenter dispose().
    const disposal = Promise.resolve().then(async (): Promise<void> => {
      if (activeOperation) {
        try {
          await activeOperation;
        } catch {
          // The active public promise owns its safe rejection. Disposal only
          // waits until it can publish one terminal simulated phase.
        }
      }
      this.#emit({ phase: "disposed" });
      this.#listeners.clear();
    });
    this.#disposePromise = disposal;
    return disposal;
  }

  #startOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.#cancelRequested = false;
    let resolveStarting!: (value: T | PromiseLike<T>) => void;
    const starting = new Promise<T>((resolve) => {
      resolveStarting = resolve;
    });
    // Publish an active-operation latch before invoking the runner because its
    // first lifecycle event can synchronously reenter cancel() or dispose().
    this.#activeOperation = starting;
    void starting.catch(() => undefined);

    let operationResult: Promise<T>;
    try {
      operationResult = operation();
    } catch (error) {
      operationResult = Promise.reject(error);
    }
    const active = operationResult.finally(() => {
      if (this.#activeOperation === active) this.#activeOperation = undefined;
    });
    this.#activeOperation = active;
    resolveStarting(active);
    return active;
  }

  async #runPreparation(recovery: boolean): Promise<BitcoinInstallPlan> {
    try {
      this.#mutationMayHaveStarted = false;
      this.#emit({
        phase: "selecting-device",
        interaction: "select-device",
      });
      await this.#pause();
      this.#emit({ phase: "connecting" });
      await this.#pause();
      this.#emit({
        phase: "checking-genuine",
        interaction: "unlock-device",
      });
      await this.#pause();
      this.#emit({
        phase: "checking-bitcoin-app",
        interaction: "allow-secure-connection",
      });
      await this.#pause();

      if (this.#scenario === "user-refused") {
        const error = new SimulatedBitcoinInstallerError(
          "user-refused",
          "checking-bitcoin-app",
          true,
        );
        this.#emit({ phase: "failed" });
        throw error;
      }

      this.#emit({ phase: "ready-to-install" });

      if (recovery) this.#recoveryCompleted = true;
      const status: BitcoinInstallPlan["status"] =
        recovery || this.#scenario === "already-installed"
          ? "already-installed"
          : "installation-required";
      return this.#mintPlan(status);
    } catch (error) {
      if (error instanceof SimulatedBitcoinInstallerError) throw error;
      throw this.#settleInterruption(error);
    }
  }

  async #runInstallation(
    planStatus: BitcoinInstallPlan["status"],
  ): Promise<BitcoinInstallResult> {
    try {
      if (planStatus === "installation-required") {
        // From this point onward, cancellation cannot prove that simulated
        // mutation did not reach the device. This mirrors the production
        // package's fail-closed install-dispatch boundary.
        this.#mutationMayHaveStarted = true;
        this.#emit({
          phase: "installing",
          interaction: "confirm-install",
          progress: 0,
        });
        await this.#pause();

        for (const progress of [35, 70, 100] as const) {
          this.#emit({ phase: "installing", progress });
          await this.#pause();
        }
        this.#emit({ phase: "verifying" });
        await this.#pause();

        if (
          this.#scenario === "state-unknown-then-recovery" &&
          !this.#recoveryCompleted
        ) {
          const error = new SimulatedBitcoinInstallerError(
            "state-unknown",
            "verifying",
            true,
          );
          this.#emit({ phase: "needs-recovery" });
          throw error;
        }
      }

      const status =
        planStatus === "already-installed" ? "already-installed" : "installed";
      const handoff =
        this.#scenario === "reconnect-required"
          ? "reconnect-required"
          : "ready";

      this.#emit({
        phase: "opening-bitcoin",
        interaction: "confirm-open-bitcoin",
      });
      let appOpen = true;
      try {
        await this.#pause();
      } catch (error) {
        if (
          error instanceof InterruptedSimulation &&
          error.reason === "cancelled"
        ) {
          // Once disposition is proven, cancellation can stop only the open
          // attempt. It cannot erase the verified install result or require
          // mutation recovery.
          this.#cancelRequested = false;
          appOpen = false;
        } else {
          throw error;
        }
      }
      this.#emit({ phase: "releasing-device" });
      await this.#pause();
      this.#emit({ phase: "ready-for-webusb" });

      return frozenResult(status, appOpen, handoff);
    } catch (error) {
      if (error instanceof SimulatedBitcoinInstallerError) throw error;
      throw this.#settleInterruption(error);
    }
  }

  #mintPlan(status: BitcoinInstallPlan["status"]): BitcoinInstallPlan {
    const visiblePlan = Object.freeze({ status });
    const plan = visiblePlan as unknown as BitcoinInstallPlan;
    this.#ownedPlans.add(plan);
    this.#currentPlan = plan;
    return plan;
  }

  #consumePlan(plan: BitcoinInstallPlan): boolean {
    if (
      this.#phase !== "ready-to-install" ||
      typeof plan !== "object" ||
      plan === null ||
      this.#currentPlan !== plan ||
      !this.#ownedPlans.has(plan) ||
      this.#consumedPlans.has(plan)
    ) {
      return false;
    }
    this.#consumedPlans.add(plan);
    this.#currentPlan = undefined;
    return true;
  }

  async #pause(): Promise<void> {
    if (this.#stepDelayMs === 0) {
      await Promise.resolve();
    } else {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.#stepDelayMs);
      });
    }
    if (this.#disposeRequested) throw new InterruptedSimulation("disposed");
    if (this.#cancelRequested) throw new InterruptedSimulation("cancelled");
  }

  #settleInterruption(error: unknown): SimulatedBitcoinInstallerError {
    if (error instanceof InterruptedSimulation) {
      if (error.reason === "disposed") return this.#disposedError();
      const phase = this.#phase;
      this.#currentPlan = undefined;
      if (this.#mutationMayHaveStarted) {
        this.#emit({ phase: "needs-recovery" });
        return new SimulatedBitcoinInstallerError("state-unknown", phase, true);
      }
      this.#emit({ phase: "cancelled" });
      return new SimulatedBitcoinInstallerError("cancelled", phase, true);
    }
    this.#emit({ phase: "failed" });
    return this.#internalError();
  }

  #emit(event: BitcoinInstallerEvent): void {
    this.#phase = event.phase;
    const safeEvent = Object.freeze({ ...event });
    for (const listener of [...this.#listeners]) {
      try {
        listener(safeEvent);
      } catch {
        // A view listener cannot alter simulation state or settlement.
      }
    }
  }

  #busyError(): SimulatedBitcoinInstallerError {
    return new SimulatedBitcoinInstallerError("device-busy", this.#phase, true);
  }

  #internalError(): SimulatedBitcoinInstallerError {
    return new SimulatedBitcoinInstallerError("internal", this.#phase, false);
  }

  #disposedError(): SimulatedBitcoinInstallerError {
    return new SimulatedBitcoinInstallerError("internal", "disposed", false);
  }
}

/**
 * Build an in-memory acceptance double. This factory has no hardware, network,
 * signing, browser-storage, logging, or production-configuration authority.
 */
export function createSimulatedBitcoinInstaller(
  options: SimulatedBitcoinInstallerOptions,
): BitcoinAppInstaller {
  return new SimulatedBitcoinAppInstaller(options);
}
