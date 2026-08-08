import type { BitcoinInstallerSupport } from "../capabilities";
import { BitcoinInstallerError } from "../errors";
import type {
  BitcoinInstallerEvent,
  BitcoinInstallerPhase,
} from "../events";
import type { BitcoinInstallPlan } from "../types";

import { checkGenuine } from "./actions/checkGenuine";
import { inspectBitcoin } from "./actions/inspectBitcoin";
import type { Clock, ClockTimer } from "./clock";
import {
  discoverOneDevice,
  DiscoveryBoundaryError,
  type DiscoveryAttempt,
} from "./discovery";
import type { DmkPort } from "./dmkPort";
import { mapPreMutationError, type PreMutationPhase } from "./errorMap";
import { PlanStore, type PlanContext } from "./planStore";
import {
  type RuntimeLease,
  RuntimeLeaseBusyError,
} from "./runtimeLease";
import {
  GenuineLedgerSessionRequiredError,
  InactiveLedgerSessionError,
  LedgerSessionActionBusyError,
  LedgerSessionEndedDuringSetupError,
  openOwnedDmkSession,
  type OwnedDmkSession,
  UnsupportedLedgerModelError,
} from "./session";
import type { SupportedModelPolicy } from "./supportedModels";

type ReadOnlyOperationPhase = Extract<
  BitcoinInstallerPhase,
  | "idle"
  | "selecting-device"
  | "connecting"
  | "checking-genuine"
  | "checking-bitcoin-app"
  | "ready-to-install"
  | "cancelled"
  | "failed"
  | "disposed"
>;

type ReadOnlyTerminalPhase = Extract<
  ReadOnlyOperationPhase,
  "cancelled" | "failed" | "disposed"
>;

const READ_ONLY_TRANSITIONS = {
  idle: ["selecting-device", "cancelled", "failed", "disposed"],
  "selecting-device": [
    "connecting",
    "cancelled",
    "failed",
    "disposed",
  ],
  connecting: [
    "checking-genuine",
    "cancelled",
    "failed",
    "disposed",
  ],
  "checking-genuine": [
    "checking-bitcoin-app",
    "cancelled",
    "failed",
    "disposed",
  ],
  "checking-bitcoin-app": [
    "ready-to-install",
    "cancelled",
    "failed",
    "disposed",
  ],
  "ready-to-install": ["cancelled", "failed", "disposed"],
  cancelled: ["disposed"],
  failed: ["disposed"],
  disposed: [],
} as const satisfies Readonly<
  Record<ReadOnlyOperationPhase, readonly ReadOnlyOperationPhase[]>
>;

interface CancelHandle {
  cancel(): void;
}

export interface ReadOnlyOperationDependencies {
  readonly acquireLease: () => RuntimeLease;
  readonly clock: Clock;
  readonly createPort: () => DmkPort;
  readonly getSupport: () => BitcoinInstallerSupport;
  readonly instanceGeneration: number;
  readonly modelPolicy: SupportedModelPolicy;
  readonly onEvent: (event: BitcoinInstallerEvent) => void;
  readonly onTerminal: (
    operation: ReadOnlyPrepareOperation,
    phase: ReadOnlyTerminalPhase,
  ) => void;
  readonly planStore: PlanStore;
  readonly planTtlMs: number;
}

function isTerminalPhase(
  phase: ReadOnlyOperationPhase,
): phase is ReadOnlyTerminalPhase {
  return phase === "cancelled" || phase === "failed" || phase === "disposed";
}

function internalError(phase: BitcoinInstallerPhase): BitcoinInstallerError {
  return new BitcoinInstallerError("internal", phase, false);
}

function normalizeOperationError(
  error: unknown,
  phase: PreMutationPhase,
): BitcoinInstallerError {
  if (error instanceof BitcoinInstallerError) return error;
  if (error instanceof RuntimeLeaseBusyError) {
    return new BitcoinInstallerError("device-busy", phase, true);
  }
  if (error instanceof DiscoveryBoundaryError) {
    return new BitcoinInstallerError(
      error.kind === "cancelled" ? "cancelled" : "no-device-selected",
      phase,
      true,
    );
  }
  if (error instanceof UnsupportedLedgerModelError) {
    return new BitcoinInstallerError("unsupported-device", phase, false);
  }
  if (
    error instanceof InactiveLedgerSessionError ||
    error instanceof LedgerSessionEndedDuringSetupError
  ) {
    return new BitcoinInstallerError("device-disconnected", phase, true);
  }
  if (
    error instanceof GenuineLedgerSessionRequiredError ||
    error instanceof LedgerSessionActionBusyError
  ) {
    return internalError(phase);
  }
  return mapPreMutationError(error, phase);
}

/** One read-only management lifecycle retained through the prepared plan. */
export class ReadOnlyPrepareOperation {
  readonly #result: Promise<BitcoinInstallPlan>;

  readonly #resolveResult: (plan: BitcoinInstallPlan) => void;

  readonly #rejectResult: (error: BitcoinInstallerError) => void;

  #phase: ReadOnlyOperationPhase = "idle";

  #epoch = 0;

  #started = false;

  #synchronousBeginInProgress = false;

  #synchronousBeginCompletion: Promise<void> | undefined;

  #synchronousActionSetupInProgress = false;

  #synchronousActionSetupCompletion: Promise<void> | undefined;

  #resultSettled = false;

  #lease: RuntimeLease | undefined;

  #port: DmkPort | undefined;

  #session: OwnedDmkSession | undefined;

  #sessionSetup: Promise<OwnedDmkSession> | undefined;

  #leaseTransferredToSessionSetup = false;

  #unsubscribeSessionInvalidation: (() => void) | undefined;

  #activeHandle: CancelHandle | undefined;

  #plan: BitcoinInstallPlan | undefined;

  #planContext: PlanContext | undefined;

  #planExpiryTimer: ClockTimer | undefined;

  #terminalIntent: ReadOnlyTerminalPhase | undefined;

  #primaryError: BitcoinInstallerError | undefined;

  #cleanupPromise: Promise<void> | undefined;

  constructor(private readonly dependencies: ReadOnlyOperationDependencies) {
    let resolveResult!: (plan: BitcoinInstallPlan) => void;
    let rejectResult!: (error: BitcoinInstallerError) => void;
    this.#result = new Promise<BitcoinInstallPlan>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.#resolveResult = resolveResult;
    this.#rejectResult = rejectResult;
    void this.#result.catch(() => undefined);
  }

  get phase(): ReadOnlyOperationPhase {
    return this.#phase;
  }

  /**
   * Start support, lease reservation, transition, discovery, and subscription
   * in this invocation stack. This method must remain non-async.
   */
  begin(): Promise<BitcoinInstallPlan> {
    if (this.#started || isTerminalPhase(this.#phase)) return this.#result;
    this.#started = true;
    const epoch = this.#epoch;
    let resolveSynchronousBegin!: () => void;
    this.#synchronousBeginCompletion = new Promise<void>((resolve) => {
      resolveSynchronousBegin = resolve;
    });
    this.#synchronousBeginInProgress = true;

    try {
      const support = this.dependencies.getSupport();
      const environmentSupported = support.supported === true;
      // Capability probes read caller-controlled browser globals. A hostile
      // getter can synchronously reenter cancel()/dispose(), so do not acquire
      // authority after the operation has already finalized.
      if (!this.#isLive(epoch)) return this.#result;
      if (!environmentSupported) {
        void this.#finalize(
          "failed",
          new BitcoinInstallerError("unsupported-environment", "idle", false),
        );
        return this.#result;
      }

      const lease = this.dependencies.acquireLease();
      this.#lease = lease;
      if (!this.#isLive(epoch)) {
        // A source-internal acquisition seam may also reenter before returning.
        // Invalidate authority here; the synchronous-entry barrier keeps the
        // finalizer from releasing it until this acquisition stack unwinds.
        lease.invalidate();
        return this.#result;
      }

      const port = this.dependencies.createPort();
      this.#port = port;
      if (!this.#isLive(epoch)) return this.#result;

      const portEnvironmentSupported = port.isEnvironmentSupported() === true;
      if (!this.#isLive(epoch)) return this.#result;
      if (!portEnvironmentSupported) {
        void this.#finalize(
          "failed",
          new BitcoinInstallerError("unsupported-environment", "idle", false),
        );
        return this.#result;
      }

      this.#transition({
        phase: "selecting-device",
        interaction: "select-device",
      });
      if (!this.#isLive(epoch)) return this.#result;

      const discoveryState: {
        attempt?: DiscoveryAttempt;
        cancellationRequested: boolean;
      } = { cancellationRequested: false };
      const pendingDiscovery: CancelHandle = {
        cancel: () => {
          discoveryState.cancellationRequested = true;
          discoveryState.attempt?.cancel();
        },
      };
      // Discovery must enter the WebHID chooser synchronously, so it cannot be
      // deferred like connection setup. Install a cancellation latch first so
      // synchronous browser/vendor reentrancy cannot orphan its subscription.
      this.#activeHandle = pendingDiscovery;
      const discovery = discoverOneDevice(port);
      discoveryState.attempt = discovery;
      if (discoveryState.cancellationRequested || !this.#isLive(epoch)) {
        void discovery.result.catch(() => undefined);
        discovery.cancel();
        this.#clearHandle(pendingDiscovery);
        return this.#result;
      }
      this.#activeHandle = discovery;
      void this.#continuePreparation(discovery, epoch);
    } catch (error) {
      void this.#finalize(
        "failed",
        normalizeOperationError(error, this.#preMutationPhase()),
      );
    } finally {
      this.#synchronousBeginInProgress = false;
      resolveSynchronousBegin();
    }

    return this.#result;
  }

  cancel(): Promise<void> {
    if (isTerminalPhase(this.#phase)) return Promise.resolve();
    return this.#finalize(
      "cancelled",
      new BitcoinInstallerError("cancelled", this.#phase, true),
    );
  }

  dispose(): Promise<void> {
    if (this.#phase === "disposed") return Promise.resolve();
    return this.#finalize(
      "disposed",
      new BitcoinInstallerError("cancelled", this.#phase, true),
    );
  }

  /** Phase 4 will replace this fail-closed validation boundary with mutation. */
  rejectInstall(candidate: unknown): Promise<never> {
    if (this.#phase === "ready-to-install" && this.#planContext) {
      this.dependencies.planStore.check(candidate, this.#planContext);
    }
    return this.#rejectUnavailableContinuation();
  }

  /** Phase 4 will replace this fail-closed recovery placeholder. */
  rejectRecover(): Promise<never> {
    return this.#rejectUnavailableContinuation();
  }

  async #rejectUnavailableContinuation(): Promise<never> {
    const error = internalError(this.#phase);
    await this.#finalize("failed", error);
    throw error;
  }

  async #continuePreparation(
    discovery: DiscoveryAttempt,
    epoch: number,
  ): Promise<void> {
    try {
      const device = await discovery.result;
      this.#clearHandle(discovery);
      if (!this.#isLive(epoch)) return;

      this.#transition({ phase: "connecting" });
      if (!this.#isLive(epoch)) return;

      const port = this.#port;
      const lease = this.#lease;
      if (!port || !lease) throw internalError("connecting");
      // Latch setup ownership before entering vendor connection code. The
      // connection call itself can synchronously reenter through browser/SDK
      // hooks; finalization must already know which promise owns the lease.
      this.#leaseTransferredToSessionSetup = true;
      const sessionSetup = Promise.resolve().then(() =>
        openOwnedDmkSession(port, device, {
          acquireLease: () => lease,
          modelPolicy: this.dependencies.modelPolicy,
        }),
      );
      this.#sessionSetup = sessionSetup;
      const session = await sessionSetup;
      this.#session = session;
      if (!this.#isLive(epoch)) {
        await this.#disconnectSession(session);
        return;
      }

      this.#unsubscribeSessionInvalidation = session.onInvalidated(() => {
        if (!this.#isLive(epoch)) return;
        this.dependencies.planStore.invalidateAll();
        void this.#finalize(
          "failed",
          new BitcoinInstallerError(
            "device-disconnected",
            this.#phase,
            true,
          ),
        );
      });
      if (!this.#isLive(epoch)) return;

      this.#transition({ phase: "checking-genuine" });
      if (!this.#isLive(epoch)) return;
      const genuine = this.#runSynchronousActionSetup(() =>
        checkGenuine(session, {
          onEvent: (event) => this.#forwardActionEvent(event, epoch),
        }),
      );
      if (!this.#isLive(epoch)) {
        genuine.cancel();
        return;
      }
      this.#activeHandle = genuine;
      await genuine.result;
      this.#clearHandle(genuine);
      this.#assertCurrentSession(session, epoch);

      this.#transition({ phase: "checking-bitcoin-app" });
      if (!this.#isLive(epoch)) return;
      const inspection = this.#runSynchronousActionSetup(() =>
        inspectBitcoin(session, {
          onEvent: (event) => this.#forwardActionEvent(event, epoch),
        }),
      );
      if (!this.#isLive(epoch)) {
        inspection.cancel();
        return;
      }
      this.#activeHandle = inspection;
      const inspectionResult = await inspection.result;
      this.#clearHandle(inspection);
      this.#assertCurrentSession(session, epoch);

      const planContext: PlanContext = {
        instanceGeneration: this.dependencies.instanceGeneration,
        sessionGeneration: session.generation,
      };
      let planStatus: BitcoinInstallPlan["status"];
      switch (inspectionResult.status) {
        case "bitcoin-present":
          planStatus = "already-installed";
          break;
        case "bitcoin-absent":
          planStatus = "installation-required";
          break;
        default:
          // A widened or malformed adapter result must never become install
          // authority by falling through to the absence branch.
          throw internalError("checking-bitcoin-app");
      }
      const plan = this.dependencies.planStore.mint({
        ...planContext,
        status: planStatus,
        ttlMs: this.dependencies.planTtlMs,
      });
      this.#plan = plan;
      this.#planContext = planContext;
      this.#planExpiryTimer = this.dependencies.clock.setTimeout(() => {
        this.#expirePlan(plan, epoch);
      }, this.dependencies.planTtlMs);

      this.#transition({ phase: "ready-to-install" });
      if (!this.#isLive(epoch)) return;
      this.#settleSuccess(plan);
    } catch (error) {
      if (!this.#isLive(epoch)) return;
      await this.#finalize(
        "failed",
        normalizeOperationError(error, this.#preMutationPhase()),
      );
    }
  }

  #assertCurrentSession(session: OwnedDmkSession, epoch: number): void {
    if (!this.#isLive(epoch)) throw internalError(this.#phase);
    if (!session.isCurrent()) {
      throw new BitcoinInstallerError(
        "device-disconnected",
        this.#phase,
        true,
      );
    }
  }

  #forwardActionEvent(event: BitcoinInstallerEvent, epoch: number): void {
    if (!this.#isLive(epoch) || event.phase !== this.#phase) return;
    this.dependencies.onEvent(event);
  }

  #expirePlan(plan: BitcoinInstallPlan, epoch: number): void {
    if (
      !this.#isLive(epoch) ||
      this.#phase !== "ready-to-install" ||
      this.#plan !== plan ||
      !this.#planContext
    ) {
      return;
    }
    try {
      this.dependencies.planStore.check(plan, this.#planContext);
    } catch {
      // Timer/clock failures expire authority fail closed.
    }
    void this.#finalize("failed", internalError("ready-to-install"));
  }

  #isLive(epoch: number): boolean {
    return (
      this.#epoch === epoch &&
      this.#terminalIntent === undefined &&
      !isTerminalPhase(this.#phase)
    );
  }

  #clearHandle(handle: CancelHandle): void {
    if (this.#activeHandle === handle) this.#activeHandle = undefined;
  }

  #runSynchronousActionSetup<T extends CancelHandle>(start: () => T): T {
    let resolveSetup!: () => void;
    this.#synchronousActionSetupCompletion = new Promise<void>((resolve) => {
      resolveSetup = resolve;
    });
    this.#synchronousActionSetupInProgress = true;
    try {
      return start();
    } finally {
      this.#synchronousActionSetupInProgress = false;
      resolveSetup();
    }
  }

  #preMutationPhase(): PreMutationPhase {
    switch (this.#phase) {
      case "idle":
      case "selecting-device":
      case "connecting":
      case "checking-genuine":
      case "checking-bitcoin-app":
        return this.#phase;
      case "ready-to-install":
      case "cancelled":
      case "failed":
      case "disposed":
        return "checking-bitcoin-app";
    }
  }

  #transition(event: BitcoinInstallerEvent): void {
    const nextPhase = event.phase as ReadOnlyOperationPhase;
    const allowed = READ_ONLY_TRANSITIONS[this.#phase] as readonly ReadOnlyOperationPhase[];
    if (!allowed.includes(nextPhase)) {
      throw new Error("Invalid read-only installer state transition.");
    }
    this.#phase = nextPhase;
    this.dependencies.onEvent(Object.freeze({ ...event }));
  }

  #settleSuccess(plan: BitcoinInstallPlan): void {
    if (this.#resultSettled) return;
    this.#resultSettled = true;
    this.#resolveResult(plan);
  }

  #settleFailure(error: BitcoinInstallerError): void {
    if (this.#resultSettled) return;
    this.#resultSettled = true;
    this.#rejectResult(error);
  }

  #finalize(
    terminal: ReadOnlyTerminalPhase,
    primaryError?: BitcoinInstallerError,
  ): Promise<void> {
    if (terminal === "disposed" || this.#terminalIntent === undefined) {
      this.#terminalIntent = terminal;
    }
    this.#primaryError ??= primaryError;
    if (this.#cleanupPromise) return this.#cleanupPromise;

    let resolveCleanup!: () => void;
    let rejectCleanup!: (error: unknown) => void;
    const cleanupPromise = new Promise<void>((resolve, reject) => {
      resolveCleanup = resolve;
      rejectCleanup = reject;
    });
    // Latch before cancellation, timer cleanup, or terminal event callbacks can
    // reenter cancel()/dispose().
    this.#cleanupPromise = cleanupPromise;

    this.#epoch += 1;
    const handle = this.#activeHandle;
    this.#activeHandle = undefined;
    try {
      handle?.cancel();
    } catch {
      // Local cleanup remains authoritative over a faulty adapter handle.
    }

    this.dependencies.planStore.invalidateAll();
    this.#lease?.invalidate();
    this.#plan = undefined;
    this.#planContext = undefined;
    if (this.#planExpiryTimer) {
      try {
        this.dependencies.clock.clearTimeout(this.#planExpiryTimer);
      } catch {
        // A hostile timer adapter cannot retain public plan authority.
      }
      this.#planExpiryTimer = undefined;
    }
    this.#unsubscribeSessionInvalidation?.();
    this.#unsubscribeSessionInvalidation = undefined;

    void this.#completeFinalization().then(resolveCleanup, rejectCleanup);
    return cleanupPromise;
  }

  async #completeFinalization(): Promise<void> {
    if (
      this.#synchronousBeginInProgress &&
      this.#synchronousBeginCompletion
    ) {
      // A terminal callback can reenter while a permission/runtime call is
      // still on the stack. Do not release exclusivity until that call has
      // returned and any newly acquired handle has been cancelled.
      await this.#synchronousBeginCompletion;
    }
    if (
      this.#synchronousActionSetupInProgress &&
      this.#synchronousActionSetupCompletion
    ) {
      // Pending action states may be emitted while the vendor Observable is
      // still subscribing. Let that stack unwind before entering disconnect.
      await this.#synchronousActionSetupCompletion;
    }

    let session = this.#session;
    if (!session && this.#sessionSetup) {
      try {
        session = await this.#sessionSetup;
        this.#session = session;
      } catch {
        // Session setup owns its failed-connect lease rollback.
      }
    }

    if (session) {
      await this.#disconnectSession(session);
    } else if (!this.#leaseTransferredToSessionSetup) {
      this.#lease?.release();
    }

    let terminal = this.#terminalIntent ?? "failed";
    if (!isTerminalPhase(this.#phase)) {
      this.#transition({ phase: terminal });
    }
    if (this.#terminalIntent === "disposed" && this.#phase !== "disposed") {
      terminal = "disposed";
      this.#transition({ phase: terminal });
    }
    this.#settleFailure(
      this.#primaryError ??
        (terminal === "cancelled" || terminal === "disposed"
          ? new BitcoinInstallerError("cancelled", this.#phase, true)
          : internalError(this.#phase)),
    );
    this.dependencies.onTerminal(this, terminal);
  }

  async #disconnectSession(session: OwnedDmkSession): Promise<void> {
    try {
      await session.disconnect();
    } catch {
      // The primary public result remains stable and the session releases its
      // lease in its own finally path.
    }
  }
}
