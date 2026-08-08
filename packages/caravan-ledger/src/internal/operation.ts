import type { BitcoinInstallerSupport } from "../capabilities";
import { BitcoinInstallerError } from "../errors";
import type { BitcoinInstallerEvent, BitcoinInstallerPhase } from "../events";
import type { BitcoinInstallPlan, BitcoinInstallResult } from "../types";

import { checkGenuine } from "./actions/checkGenuine";
import { inspectBitcoin } from "./actions/inspectBitcoin";
import {
  installAndVerifyBitcoin,
  type VerifiedBitcoinInstallation,
} from "./actions/installAndVerifyBitcoin";
import { openBitcoin } from "./actions/openBitcoin";
import type { Clock, ClockTimer } from "./clock";
import {
  discoverOneDevice,
  DiscoveryBoundaryError,
  type DiscoveryAttempt,
} from "./discovery";
import type { DmkPort } from "./dmkPort";
import { mapPreMutationError, type PreMutationPhase } from "./errorMap";
import {
  consumeInstallPlan,
  PlanStore,
  type PlanContext,
  type PlanStatus,
} from "./planStore";
import { type RuntimeLease, RuntimeLeaseBusyError } from "./runtimeLease";
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

type OperationPhase = Extract<
  BitcoinInstallerPhase,
  | "idle"
  | "selecting-device"
  | "connecting"
  | "checking-genuine"
  | "checking-bitcoin-app"
  | "ready-to-install"
  | "installing"
  | "verifying"
  | "opening-bitcoin"
  | "releasing-device"
  | "ready-for-webusb"
  | "needs-recovery"
  | "cancelled"
  | "failed"
  | "disposed"
>;

export type OperationTerminalPhase = Extract<
  OperationPhase,
  "ready-for-webusb" | "needs-recovery" | "cancelled" | "failed" | "disposed"
>;

const OPERATION_TRANSITIONS = {
  idle: ["selecting-device", "cancelled", "failed", "disposed"],
  "selecting-device": ["connecting", "cancelled", "failed", "disposed"],
  connecting: ["checking-genuine", "cancelled", "failed", "disposed"],
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
  "ready-to-install": [
    "installing",
    "opening-bitcoin",
    "cancelled",
    "failed",
    "disposed",
  ],
  installing: [
    "verifying",
    "needs-recovery",
    "cancelled",
    "failed",
    "disposed",
  ],
  verifying: ["opening-bitcoin", "needs-recovery", "disposed"],
  "opening-bitcoin": ["releasing-device", "disposed"],
  "releasing-device": ["ready-for-webusb", "disposed"],
  "ready-for-webusb": ["disposed"],
  "needs-recovery": ["disposed"],
  cancelled: ["disposed"],
  failed: ["disposed"],
  disposed: [],
} as const satisfies Readonly<
  Record<OperationPhase, readonly OperationPhase[]>
>;

interface CancelHandle {
  cancel(): void;
}

type InstallDispatchEvidence =
  | "not-dispatched"
  | "checking"
  | "dispatched"
  | "unknown";

type PendingMutationTerminal = "cancelled" | "disposed";

interface InstallCancellationReservation {
  readonly handle: CancelHandle;
  bind(handle: CancelHandle): void;
}

function createInstallCancellationReservation(): InstallCancellationReservation {
  let cancellationRequested = false;
  let delegated = false;
  let boundHandle: CancelHandle | undefined;

  const delegateOnce = (): void => {
    if (!cancellationRequested || delegated || !boundHandle) return;
    delegated = true;
    try {
      boundHandle.cancel();
    } catch {
      // Setup cancellation remains best effort and locally contained.
    }
  };

  return {
    handle: {
      cancel: () => {
        cancellationRequested = true;
        delegateOnce();
      },
    },
    bind: (handle) => {
      boundHandle = handle;
      delegateOnce();
    },
  };
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
    phase: OperationTerminalPhase,
  ) => void;
  readonly planStore: PlanStore;
  readonly planTtlMs: number;
}

function isTerminalPhase(
  phase: OperationPhase,
): phase is OperationTerminalPhase {
  return (
    phase === "ready-for-webusb" ||
    phase === "needs-recovery" ||
    phase === "cancelled" ||
    phase === "failed" ||
    phase === "disposed"
  );
}

function internalError(phase: BitcoinInstallerPhase): BitcoinInstallerError {
  return new BitcoinInstallerError("internal", phase, false);
}

function unknownMutationState(
  phase: Extract<OperationPhase, "installing" | "verifying">,
): BitcoinInstallerError {
  return new BitcoinInstallerError("state-unknown", phase, true);
}

function rejectedInstallResult(
  error: BitcoinInstallerError,
): Promise<BitcoinInstallResult> {
  const result = Promise.reject<BitcoinInstallResult>(error);
  void result.catch(() => undefined);
  return result;
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

/** One management lifecycle retained from preparation through release. */
export class ReadOnlyPrepareOperation {
  readonly #result: Promise<BitcoinInstallPlan>;

  readonly #resolveResult: (plan: BitcoinInstallPlan) => void;

  readonly #rejectResult: (error: BitcoinInstallerError) => void;

  readonly #installResult: Promise<BitcoinInstallResult>;

  readonly #resolveInstallResult: (result: BitcoinInstallResult) => void;

  readonly #rejectInstallResult: (error: BitcoinInstallerError) => void;

  #phase: OperationPhase = "idle";

  #epoch = 0;

  #started = false;

  #synchronousBeginInProgress = false;

  #synchronousBeginCompletion: Promise<void> | undefined;

  #synchronousActionSetupInProgress = false;

  #synchronousActionSetupCompletion: Promise<void> | undefined;

  #resultSettled = false;

  #installInvocationLatched = false;

  #installResultSettled = false;

  #installDispatchEvidence: InstallDispatchEvidence = "not-dispatched";

  #pendingMutationTerminal: PendingMutationTerminal | undefined;

  #pendingMutationTerminalPromise: Promise<void> | undefined;

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

  #planExpiryTimerSetupStarted = false;

  #planExpiryTimerAssigned = false;

  #planExpiryTimerClearRequested = false;

  #planExpiryTimerCleared = false;

  #terminalIntent: OperationTerminalPhase | undefined;

  #primaryError: BitcoinInstallerError | undefined;

  #provenInstallResult: Omit<BitcoinInstallResult, "handoff"> | undefined;

  #openCancellationRequested = false;

  #cleanupPromise: Promise<void> | undefined;

  #finalizationCompleted = false;

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

    let resolveInstallResult!: (result: BitcoinInstallResult) => void;
    let rejectInstallResult!: (error: BitcoinInstallerError) => void;
    this.#installResult = new Promise<BitcoinInstallResult>(
      (resolve, reject) => {
        resolveInstallResult = resolve;
        rejectInstallResult = reject;
      },
    );
    this.#resolveInstallResult = resolveInstallResult;
    this.#rejectInstallResult = rejectInstallResult;
    void this.#installResult.catch(() => undefined);
  }

  get phase(): OperationPhase {
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
    switch (this.#phase) {
      case "installing": {
        switch (this.#installDispatchEvidence) {
          case "not-dispatched":
            return this.#finalize(
              "cancelled",
              new BitcoinInstallerError("cancelled", "installing", true),
            );
          case "checking":
            return this.#requestPendingMutationTerminal("cancelled");
          case "dispatched":
          case "unknown":
            return this.#finalize(
              "needs-recovery",
              this.#primaryError?.code === "insufficient-space"
                ? this.#primaryError
                : unknownMutationState("installing"),
            );
          default: {
            const impossible: never = this.#installDispatchEvidence;
            throw impossible;
          }
        }
      }
      case "verifying":
        return this.#finalize(
          "needs-recovery",
          this.#primaryError?.code === "insufficient-space"
            ? this.#primaryError
            : unknownMutationState(this.#phase),
        );
      case "opening-bitcoin":
        this.#requestOpenCancellation();
        return this.#installResult.then(
          () => undefined,
          () => undefined,
        );
      case "releasing-device":
        return (
          this.#cleanupPromise ??
          this.#installResult.then(
            () => undefined,
            () => undefined,
          )
        );
      case "ready-for-webusb":
      case "needs-recovery":
      case "cancelled":
      case "failed":
      case "disposed":
        return Promise.resolve();
      case "idle":
      case "selecting-device":
      case "connecting":
      case "checking-genuine":
      case "checking-bitcoin-app":
      case "ready-to-install":
        return this.#finalize(
          "cancelled",
          new BitcoinInstallerError("cancelled", this.#phase, true),
        );
    }
  }

  dispose(): Promise<void> {
    if (this.#phase === "disposed") return Promise.resolve();
    if (isTerminalPhase(this.#phase) && this.#finalizationCompleted) {
      this.#terminalIntent = "disposed";
      this.#transition({ phase: "disposed" });
      try {
        this.dependencies.onTerminal(this, "disposed");
      } catch {
        // Internal lifecycle observers cannot corrupt completed cleanup.
      }
      return Promise.resolve();
    }
    if (this.#phase === "installing") {
      switch (this.#installDispatchEvidence) {
        case "not-dispatched":
          return this.#finalize(
            "disposed",
            new BitcoinInstallerError("cancelled", "installing", true),
          );
        case "checking":
          return this.#requestPendingMutationTerminal("disposed");
        case "dispatched":
        case "unknown":
          return this.#finalize(
            "disposed",
            this.#primaryError?.code === "insufficient-space"
              ? this.#primaryError
              : unknownMutationState("installing"),
          );
      }
    }
    const primaryError =
      this.#phase === "verifying"
        ? unknownMutationState("verifying")
        : new BitcoinInstallerError("cancelled", this.#phase, true);
    return this.#finalize("disposed", primaryError);
  }

  /**
   * Cross the explicit confirmation boundary and retain this operation through
   * fixed install/no-op, open, and coarse Phase-4 release handling.
   */
  install(candidate: unknown): Promise<BitcoinInstallResult> {
    // Ownership is latched before inspecting caller-controlled plan identity,
    // context, time, or emitting an event. Reentrant/replayed invocations can
    // never consume authority or dispatch another action.
    if (this.#installInvocationLatched) {
      return rejectedInstallResult(internalError(this.#phase));
    }
    this.#installInvocationLatched = true;

    const context = this.#planContext;
    const session = this.#session;
    if (
      this.#phase !== "ready-to-install" ||
      !context ||
      !session ||
      this.#terminalIntent !== undefined
    ) {
      const error = internalError(this.#phase);
      if (this.#finalizationCompleted) {
        this.#settleInstallFailure(error);
        return this.#installResult;
      }
      void this.#finalize("failed", error);
      return this.#installResult;
    }

    let status: PlanStatus;
    try {
      // This atomic consume is deliberately the first authority-crossing call.
      // Its returned private status, not the caller-visible field, selects the
      // closed continuation below.
      status = consumeInstallPlan(
        this.dependencies.planStore,
        candidate,
        context,
      );
    } catch (error) {
      const safeError =
        error instanceof BitcoinInstallerError
          ? error
          : internalError("ready-to-install");
      void this.#finalize("failed", safeError);
      return this.#installResult;
    }

    this.#plan = undefined;
    this.#clearPlanExpiryTimer();
    const epoch = this.#epoch;
    if (!this.#isLive(epoch) || this.#phase !== "ready-to-install") {
      return this.#installResult;
    }

    try {
      switch (status) {
        case "installation-required": {
          const reservation = createInstallCancellationReservation();
          this.#installDispatchEvidence = "not-dispatched";
          this.#activeHandle = reservation.handle;
          this.#transition({ phase: "installing" });
          if (this.#isLive(epoch)) {
            void this.#continueRequiredInstallation(
              session,
              context,
              reservation,
              epoch,
            );
          }
          break;
        }
        case "already-installed":
          // The consumed plan binds the immediately preceding proof to this
          // exact generation. Revalidate it once more before the open action.
          this.#assertCurrentSession(session, epoch);
          this.#transition({ phase: "opening-bitcoin" });
          if (this.#isLive(epoch)) {
            void this.#continueOpening(session, "already-installed", epoch);
          }
          break;
        default: {
          const impossible: never = status;
          throw impossible;
        }
      }
    } catch (error) {
      if (this.#isLive(epoch)) {
        const safeError =
          error instanceof BitcoinInstallerError
            ? error
            : internalError(this.#phase);
        void this.#finalize("failed", safeError);
      }
    }

    return this.#installResult;
  }

  /** Retained until the facade integration switches to install(). */
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

  #requestPendingMutationTerminal(
    terminal: PendingMutationTerminal,
  ): Promise<void> {
    if (
      terminal === "disposed" ||
      this.#pendingMutationTerminal === undefined
    ) {
      this.#pendingMutationTerminal = terminal;
    }
    try {
      this.#activeHandle?.cancel();
    } catch {
      // The pre-assigned reservation contains setup-time cancellation.
    }
    this.#pendingMutationTerminalPromise ??= this.#installResult.then(
      () => undefined,
      () => undefined,
    );
    return this.#pendingMutationTerminalPromise;
  }

  async #settlePendingMutationTerminal(): Promise<boolean> {
    const pending = this.#pendingMutationTerminal;
    if (!pending) return false;

    const mutationMayHaveStarted =
      this.#installDispatchEvidence !== "not-dispatched";
    const error = mutationMayHaveStarted
      ? unknownMutationState("installing")
      : new BitcoinInstallerError("cancelled", "installing", true);
    const terminal: OperationTerminalPhase =
      pending === "disposed"
        ? "disposed"
        : mutationMayHaveStarted
          ? "needs-recovery"
          : "cancelled";
    await this.#finalize(terminal, error);
    return true;
  }

  #readInstallDispatchEvidence(
    installation: ReturnType<typeof installAndVerifyBitcoin>,
  ): InstallDispatchEvidence {
    try {
      const evidence: unknown = installation.dispatchStarted();
      if (evidence === true) return "dispatched";
      if (evidence === false) return "not-dispatched";
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  async #continueRequiredInstallation(
    session: OwnedDmkSession,
    context: PlanContext,
    reservation: InstallCancellationReservation,
    epoch: number,
  ): Promise<void> {
    let installation: ReturnType<typeof installAndVerifyBitcoin> | undefined;
    try {
      this.#installDispatchEvidence = "checking";
      installation = this.#runSynchronousActionSetup(() =>
        installAndVerifyBitcoin(session, {
          onEvent: (event) => this.#forwardActionEvent(event, epoch),
          onVerificationStart: () => {
            if (!this.#isLive(epoch) || this.#phase !== "installing") {
              return;
            }
            if (this.#installDispatchEvidence === "not-dispatched") {
              // Verification after contradictory negative evidence is
              // conservatively ambiguous rather than trusted.
              this.#installDispatchEvidence = "unknown";
            }
            this.#transition({ phase: "verifying" });
          },
        }),
      );
      this.#installDispatchEvidence =
        this.#readInstallDispatchEvidence(installation);
      if (this.#activeHandle === reservation.handle) {
        this.#activeHandle = installation;
      }
      reservation.bind(installation);
      if (await this.#settlePendingMutationTerminal()) return;
      if (!this.#isLive(epoch)) {
        installation.cancel();
        return;
      }
      this.#activeHandle = installation;

      const verification = await installation.result;
      this.#clearHandle(installation);
      if (!this.#isLive(epoch)) return;
      if (this.#installDispatchEvidence === "not-dispatched") {
        throw internalError("installing");
      }
      if (this.#phase !== "verifying") {
        throw unknownMutationState("verifying");
      }

      const disposition = this.#acceptVerifiedInstallation(
        verification,
        session,
        context,
        epoch,
      );
      this.#transition({ phase: "opening-bitcoin" });
      if (!this.#isLive(epoch)) return;
      void this.#continueOpening(session, disposition, epoch);
    } catch (error) {
      if (installation) this.#clearHandle(installation);
      if (!this.#isLive(epoch)) return;
      if (this.#installDispatchEvidence === "checking") {
        // installAndVerifyBitcoin can throw here only before returning a
        // dispatch-evidence handle.
        this.#installDispatchEvidence = "not-dispatched";
      }
      if (await this.#settlePendingMutationTerminal()) return;
      if (this.#installDispatchEvidence === "not-dispatched") {
        const safeError = internalError("installing");
        this.#primaryError ??= safeError;
        await this.#finalize("failed", safeError);
        return;
      }
      const safeError = this.#normalizeMutationError(error);
      this.#primaryError ??= safeError;
      await this.#finalize("needs-recovery", safeError);
    }
  }

  #acceptVerifiedInstallation(
    verification: VerifiedBitcoinInstallation,
    session: OwnedDmkSession,
    context: PlanContext,
    epoch: number,
  ): BitcoinInstallResult["status"] {
    this.#assertCurrentSession(session, epoch);
    if (
      verification.sessionGeneration !== context.sessionGeneration ||
      verification.sessionGeneration !== session.generation
    ) {
      throw unknownMutationState("verifying");
    }
    switch (verification.status) {
      case "installed":
      case "already-installed":
        return verification.status;
      default: {
        const impossible: never = verification.status;
        throw impossible;
      }
    }
  }

  async #continueOpening(
    session: OwnedDmkSession,
    disposition: BitcoinInstallResult["status"],
    epoch: number,
  ): Promise<void> {
    if (!this.#isLive(epoch) || this.#phase !== "opening-bitcoin") return;

    // A cancellation from the opening transition listener wins before action
    // construction, while preserving the independently proven disposition.
    if (this.#openCancellationRequested) {
      await this.#releaseProvenDisposition(disposition, false, epoch);
      return;
    }

    let opening: ReturnType<typeof openBitcoin> | undefined;
    try {
      opening = this.#runSynchronousActionSetup(() =>
        openBitcoin(session, {
          onEvent: (event) => this.#forwardActionEvent(event, epoch),
        }),
      );
      if (!this.#isLive(epoch)) {
        opening.cancel();
        return;
      }
      this.#activeHandle = opening;
      if (this.#openCancellationRequested) opening.cancel();

      const opened = await opening.result;
      this.#clearHandle(opening);
      if (!this.#isLive(epoch)) return;
      await this.#releaseProvenDisposition(
        disposition,
        opened.appOpened === true,
        epoch,
      );
    } catch {
      if (opening) this.#clearHandle(opening);
      if (!this.#isLive(epoch)) return;
      // Open is explicitly non-authoritative. Any adapter/setup failure keeps
      // the proven installation fact and continues to release.
      await this.#releaseProvenDisposition(disposition, false, epoch);
    }
  }

  async #releaseProvenDisposition(
    status: BitcoinInstallResult["status"],
    appOpen: boolean,
    epoch: number,
  ): Promise<void> {
    if (!this.#isLive(epoch) || this.#phase !== "opening-bitcoin") return;
    this.#provenInstallResult = Object.freeze({ status, appOpen });
    this.#transition({ phase: "releasing-device" });
    await this.#finalize("ready-for-webusb");
  }

  #normalizeMutationError(error: unknown): BitcoinInstallerError {
    if (
      error instanceof BitcoinInstallerError &&
      (error.code === "insufficient-space" || error.code === "state-unknown")
    ) {
      return error;
    }
    return unknownMutationState(
      this.#phase === "verifying" ? "verifying" : "installing",
    );
  }

  #requestOpenCancellation(): void {
    if (this.#openCancellationRequested) return;
    this.#openCancellationRequested = true;
    try {
      this.#activeHandle?.cancel();
    } catch {
      // Open cancellation cannot erase the proven Bitcoin disposition.
    }
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
        this.#handleSessionInvalidation(epoch);
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
      this.#planExpiryTimerSetupStarted = true;
      this.#planExpiryTimerAssigned = false;
      this.#planExpiryTimerClearRequested = false;
      this.#planExpiryTimerCleared = false;
      let expiryCallbackFired = false;
      let scheduledTimer: ClockTimer;
      try {
        scheduledTimer = this.dependencies.clock.setTimeout(() => {
          expiryCallbackFired = true;
          this.#expirePlan(plan, epoch);
        }, this.dependencies.planTtlMs);
      } catch {
        if (this.#isLive(epoch)) {
          await this.#finalize(
            "failed",
            internalError("ready-to-install"),
          );
        }
        return;
      }
      this.#planExpiryTimer = scheduledTimer;
      this.#planExpiryTimerAssigned = true;
      if (
        this.#planExpiryTimerClearRequested ||
        expiryCallbackFired ||
        !this.#isLive(epoch)
      ) {
        this.#clearPlanExpiryTimer();
      }
      if (!this.#isLive(epoch) || expiryCallbackFired) return;

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
    let current = false;
    try {
      current = session.isCurrent() === true;
    } catch {
      current = false;
    }
    if (!this.#isLive(epoch)) throw internalError(this.#phase);
    if (!current) {
      throw new BitcoinInstallerError("device-disconnected", this.#phase, true);
    }
  }

  #handleSessionInvalidation(epoch: number): void {
    if (!this.#isLive(epoch)) return;
    this.dependencies.planStore.invalidateAll();
    switch (this.#phase) {
      case "installing":
        if (this.#installDispatchEvidence === "not-dispatched") {
          void this.#finalize(
            "failed",
            new BitcoinInstallerError(
              "device-disconnected",
              "installing",
              true,
            ),
          );
          return;
        }
        // Evidence currently being queried is itself ambiguous; only an exact
        // false result can later classify caller cancellation as safe.
        void this.#finalize(
          "needs-recovery",
          this.#primaryError?.code === "insufficient-space"
            ? this.#primaryError
            : unknownMutationState("installing"),
        );
        return;
      case "verifying":
        void this.#finalize(
          "needs-recovery",
          this.#primaryError?.code === "insufficient-space"
            ? this.#primaryError
            : unknownMutationState(this.#phase),
        );
        return;
      case "opening-bitcoin":
        this.#requestOpenCancellation();
        return;
      case "releasing-device":
      case "ready-for-webusb":
      case "needs-recovery":
      case "cancelled":
      case "failed":
      case "disposed":
        return;
      case "idle":
      case "selecting-device":
      case "connecting":
      case "checking-genuine":
      case "checking-bitcoin-app":
      case "ready-to-install":
        void this.#finalize(
          "failed",
          new BitcoinInstallerError("device-disconnected", this.#phase, true),
        );
    }
  }

  #forwardActionEvent(event: BitcoinInstallerEvent, epoch: number): void {
    if (!this.#isLive(epoch) || event.phase !== this.#phase) return;
    try {
      this.dependencies.onEvent(event);
    } catch {
      // The operation remains authoritative over consumer event failures.
    }
  }

  #expirePlan(plan: BitcoinInstallPlan, epoch: number): void {
    if (
      !this.#isLive(epoch) ||
      (this.#phase !== "checking-bitcoin-app" &&
        this.#phase !== "ready-to-install") ||
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
      case "installing":
      case "verifying":
      case "opening-bitcoin":
      case "releasing-device":
      case "ready-for-webusb":
      case "needs-recovery":
      case "cancelled":
      case "failed":
      case "disposed":
        return "checking-bitcoin-app";
    }
  }

  #transition(event: BitcoinInstallerEvent, onEntered?: () => void): void {
    const nextPhase = event.phase as OperationPhase;
    const allowed = OPERATION_TRANSITIONS[
      this.#phase
    ] as readonly OperationPhase[];
    if (!allowed.includes(nextPhase)) {
      throw new Error("Invalid installer state transition.");
    }
    this.#phase = nextPhase;
    onEntered?.();
    try {
      this.dependencies.onEvent(Object.freeze({ ...event }));
    } catch {
      // Consumer listeners cannot alter state-machine settlement.
    }
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

  #settleInstallSuccess(result: BitcoinInstallResult): void {
    if (this.#installResultSettled) return;
    this.#installResultSettled = true;
    this.#resolveInstallResult(result);
  }

  #settleInstallFailure(error: BitcoinInstallerError): void {
    if (this.#installResultSettled) return;
    this.#installResultSettled = true;
    this.#rejectInstallResult(error);
  }

  #settleProvenInstallSuccess(): void {
    if (!this.#installInvocationLatched || !this.#provenInstallResult) return;
    this.#settleInstallSuccess(
      Object.freeze({
        ...this.#provenInstallResult,
        handoff: "reconnect-required",
      }),
    );
  }

  #clearPlanExpiryTimer(): void {
    if (!this.#planExpiryTimerSetupStarted || this.#planExpiryTimerCleared) {
      return;
    }
    if (!this.#planExpiryTimerAssigned) {
      this.#planExpiryTimerClearRequested = true;
      return;
    }

    this.#planExpiryTimerCleared = true;
    this.#planExpiryTimerClearRequested = false;
    const timer = this.#planExpiryTimer as ClockTimer;
    this.#planExpiryTimer = undefined;
    try {
      this.dependencies.clock.clearTimeout(timer);
    } catch {
      // A hostile timer adapter cannot retain public plan authority.
    }
  }

  #finalize(
    terminal: OperationTerminalPhase,
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
    this.#clearPlanExpiryTimer();
    this.#unsubscribeSessionInvalidation?.();
    this.#unsubscribeSessionInvalidation = undefined;

    void this.#completeFinalization().then(resolveCleanup, rejectCleanup);
    return cleanupPromise;
  }

  async #completeFinalization(): Promise<void> {
    if (this.#synchronousBeginInProgress && this.#synchronousBeginCompletion) {
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
      this.#transition(
        { phase: terminal },
        terminal === "ready-for-webusb"
          ? () => this.#settleProvenInstallSuccess()
          : undefined,
      );
    }
    if (this.#terminalIntent === "disposed" && this.#phase !== "disposed") {
      terminal = "disposed";
      this.#transition({ phase: terminal });
    }
    const terminalError =
      this.#primaryError ??
      (terminal === "cancelled" || terminal === "disposed"
        ? new BitcoinInstallerError("cancelled", this.#phase, true)
        : terminal === "needs-recovery"
          ? new BitcoinInstallerError("state-unknown", this.#phase, true)
          : internalError(this.#phase));
    this.#settleFailure(terminalError);

    if (this.#installInvocationLatched) {
      if (terminal === "ready-for-webusb" && this.#provenInstallResult) {
        this.#settleProvenInstallSuccess();
      } else {
        this.#settleInstallFailure(terminalError);
      }
    }

    this.#planContext = undefined;
    this.#finalizationCompleted = true;
    try {
      this.dependencies.onTerminal(this, terminal);
    } catch {
      // Internal lifecycle observers cannot corrupt completed cleanup.
    }
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
