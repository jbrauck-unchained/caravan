import {
  getBitcoinInstallerSupport,
  type BitcoinInstallerSupport,
} from "./capabilities";
import { BitcoinInstallerError } from "./errors";
import type { BitcoinInstallerEvent, BitcoinInstallerPhase } from "./events";
import { systemClock, type Clock } from "./internal/clock";
import type { DmkPort } from "./internal/dmkPort";
import {
  ReadOnlyPrepareOperation,
  type ReadOnlyOperationDependencies,
} from "./internal/operation";
import { PlanStore } from "./internal/planStore";
import {
  acquireRuntimeLease,
  type RuntimeLease,
} from "./internal/runtimeLease";
import {
  productionSupportedModelPolicy,
  type SupportedModelPolicy,
} from "./internal/supportedModels";
import type {
  BitcoinAppInstaller,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "./types";

const BITCOIN_INSTALL_PLAN_TTL_MS = 5 * 60 * 1_000;
const MAX_PLATFORM_TIMER_DELAY_MS = 2_147_483_647;

let lastInstanceGeneration = 0;

export interface InstallerCoreDependencies {
  readonly acquireLease?: () => RuntimeLease;
  readonly clock?: Clock;
  readonly createPort: () => DmkPort;
  readonly getSupport?: () => BitcoinInstallerSupport;
  readonly modelPolicy?: SupportedModelPolicy;
  readonly planTtlMs?: number;
}

function nextInstanceGeneration(): number {
  if (lastInstanceGeneration === Number.MAX_SAFE_INTEGER) {
    throw new Error("The installer instance generation is exhausted.");
  }
  lastInstanceGeneration += 1;
  return lastInstanceGeneration;
}

function rejected<T>(error: BitcoinInstallerError): Promise<T> {
  const result = Promise.reject<T>(error);
  void result.catch(() => undefined);
  return result;
}

class BitcoinAppInstallerFacade implements BitcoinAppInstaller {
  readonly #listeners = new Set<
    (event: BitcoinInstallerEvent) => void
  >();

  readonly #operationDependencies: Omit<
    ReadOnlyOperationDependencies,
    "onEvent" | "onTerminal"
  >;

  #phase: BitcoinInstallerPhase = "idle";

  #operation: ReadOnlyPrepareOperation | undefined;

  #disposeRequested = false;

  #disposePromise: Promise<void> | undefined;

  constructor(dependencies: InstallerCoreDependencies) {
    const clock = dependencies.clock ?? systemClock;
    const planTtlMs =
      dependencies.planTtlMs ?? BITCOIN_INSTALL_PLAN_TTL_MS;
    if (
      !Number.isSafeInteger(planTtlMs) ||
      planTtlMs <= 0 ||
      planTtlMs > MAX_PLATFORM_TIMER_DELAY_MS
    ) {
      throw new TypeError(
        "The installer plan lifetime must fit the platform timer range.",
      );
    }
    this.#operationDependencies = {
      acquireLease: dependencies.acquireLease ?? acquireRuntimeLease,
      clock,
      createPort: dependencies.createPort,
      getSupport: dependencies.getSupport ?? getBitcoinInstallerSupport,
      instanceGeneration: nextInstanceGeneration(),
      modelPolicy:
        dependencies.modelPolicy ?? productionSupportedModelPolicy,
      planStore: new PlanStore(clock),
      planTtlMs,
    };
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

  /** Keep the click-bound path synchronous through discovery subscription. */
  prepare(): Promise<BitcoinInstallPlan> {
    if (this.#disposeRequested) return rejected(this.#disposedError());
    if (this.#operation) {
      return rejected(
        new BitcoinInstallerError("device-busy", this.#phase, true),
      );
    }
    if (this.#phase !== "idle" && this.#phase !== "cancelled") {
      return rejected(new BitcoinInstallerError("internal", this.#phase, false));
    }

    const operation = new ReadOnlyPrepareOperation({
      ...this.#operationDependencies,
      onEvent: (event) => this.#emit(event),
      onTerminal: (settledOperation, phase) => {
        if (this.#operation === settledOperation) {
          this.#operation = undefined;
        }
        if (phase === "disposed") this.#listeners.clear();
      },
    });
    this.#operation = operation;
    return operation.begin();
  }

  install(plan: BitcoinInstallPlan): Promise<BitcoinInstallResult> {
    if (this.#disposeRequested) return rejected(this.#disposedError());
    if (!this.#operation) {
      return rejected(new BitcoinInstallerError("internal", this.#phase, false));
    }
    return this.#operation.rejectInstall(plan);
  }

  recover(): Promise<BitcoinInstallPlan> {
    if (this.#disposeRequested) return rejected(this.#disposedError());
    if (!this.#operation) {
      return rejected(new BitcoinInstallerError("internal", this.#phase, false));
    }
    return this.#operation.rejectRecover();
  }

  cancel(): void {
    if (this.#disposeRequested) return;
    void this.#operation?.cancel();
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposeRequested = true;

    let resolveDispose!: () => void;
    let rejectDispose!: (error: unknown) => void;
    const disposePromise = new Promise<void>((resolve, reject) => {
      resolveDispose = resolve;
      rejectDispose = reject;
    });
    // Latch before operation or listener callbacks can reenter dispose().
    this.#disposePromise = disposePromise;

    const operation = this.#operation;
    if (operation) {
      void operation.dispose().then(resolveDispose, rejectDispose);
    } else {
      this.#emit({ phase: "disposed" });
      this.#listeners.clear();
      resolveDispose();
    }
    return disposePromise;
  }

  #emit(event: BitcoinInstallerEvent): void {
    this.#phase = event.phase;
    const safeEvent = Object.freeze({ ...event });
    const listeners = [...this.#listeners];
    for (const listener of listeners) {
      try {
        listener(safeEvent);
      } catch {
        // Consumer listener failures cannot alter management state.
      }
    }
  }

  #disposedError(): BitcoinInstallerError {
    return new BitcoinInstallerError("internal", "disposed", false);
  }
}

/** Source-internal injection seam; the package root remains parameterless. */
export function createBitcoinAppInstallerCore(
  dependencies: InstallerCoreDependencies,
): BitcoinAppInstaller {
  return new BitcoinAppInstallerFacade(dependencies);
}

/** Node/SSR factory: usable as a facade but permanently management-inert. */
export function createNeutralBitcoinAppInstaller(): BitcoinAppInstaller {
  return createBitcoinAppInstallerCore({
    createPort: () => {
      throw new Error("The browser Ledger runtime is unavailable.");
    },
    getSupport: () => ({ supported: false, reason: "not-browser" }),
  });
}
