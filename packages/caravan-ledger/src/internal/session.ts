import {
  runDmkAction,
  type DmkActionRun,
  type DmkActionRunOptions,
  type DmkActionRunResult,
} from "./actionRunner";
import { systemClock, type Clock } from "./clock";
import type {
  DmkActionOperation,
  DmkActionKind,
  DmkActionRequest,
  DmkActionState,
  DmkDiscoveredDevice,
  DmkInstallOperation,
  DmkOperation,
  DmkPort,
  DmkSession,
  DmkStream,
  DmkSubscription,
} from "./dmkPort";
import {
  createSessionFinalizer,
  type SessionFinalizationEvidence,
  type SessionFinalizer,
} from "./finalizeSession";
import { acquireRuntimeLease, type RuntimeLease } from "./runtimeLease";
import {
  productionSupportedModelPolicy,
  type SupportedModelPolicy,
} from "./supportedModels";
import type { HidReleaseBarrier } from "./waitForHidRelease";

export class UnsupportedLedgerModelError extends Error {
  readonly name = "UnsupportedLedgerModelError" as const;

  constructor() {
    super("The connected Ledger model is not supported.");
  }
}

export class InactiveLedgerSessionError extends Error {
  readonly name = "InactiveLedgerSessionError" as const;

  constructor() {
    super("The Ledger session is no longer active.");
  }
}

export class LedgerSessionEndedDuringSetupError extends Error {
  readonly name = "LedgerSessionEndedDuringSetupError" as const;

  constructor() {
    super("The Ledger session ended during setup.");
  }
}

export class GenuineLedgerSessionRequiredError extends Error {
  readonly name = "GenuineLedgerSessionRequiredError" as const;

  constructor() {
    super("The Ledger session has not passed its current genuine check.");
  }
}

export class LedgerSessionActionBusyError extends Error {
  readonly name = "LedgerSessionActionBusyError" as const;

  constructor() {
    super("The Ledger session already has an active device action.");
  }
}

export type GenuineCheckSettlement =
  | "passed"
  | "not-genuine"
  | "invalid-output"
  | "stale"
  | "failed";

export interface SessionGenuineCheckResult {
  readonly terminal: DmkActionRunResult<"genuine">;
  readonly settlement: GenuineCheckSettlement;
}

export interface SessionGenuineCheckRun {
  readonly result: Promise<SessionGenuineCheckResult>;
  cancel(): void;
}

export interface SessionBitcoinInstallationRun
  extends DmkActionRun<"install-bitcoin"> {
  dispatchStarted(): boolean;
  mutationAttempted(): boolean;
}

export interface OpenOwnedSessionOptions {
  readonly modelPolicy?: SupportedModelPolicy;
  readonly acquireLease?: () => RuntimeLease;
  readonly clock?: Clock;
}

export interface FinalizeOwnedDmkSessionOptions {
  readonly clock: Clock;
  readonly hidBarrier: HidReleaseBarrier;
  readonly invalidatePlans: () => void;
  readonly clearPrivateReferences: () => void;
}

const immediateUnavailableBarrier: HidReleaseBarrier = Object.freeze({
  arm: () => Promise.resolve(),
  wait: () => Promise.resolve("unavailable" as const),
  cancel: () => undefined,
});

function readStrictGenuineResult(output: unknown): boolean | undefined {
  if (typeof output !== "object" || output === null) return undefined;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(output, "isGenuine");
    if (!descriptor || !("value" in descriptor)) return undefined;
    return typeof descriptor.value === "boolean" ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

interface ActiveSessionAction {
  invalidated: boolean;
  cancel(): void;
}

function cancelOperationSafely(operation: DmkOperation<unknown>): void {
  try {
    operation.cancel();
  } catch {
    // Native cancellation is best effort and never escapes the package seam.
  }
}

function makeCancelOnceOperation<T>(
  operation: DmkOperation<T>,
): DmkOperation<T> {
  let cancelled = false;
  return {
    stream: operation.stream,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      cancelOperationSafely(operation);
    },
  };
}

class RejectedStartedInstallOperation {
  constructor(
    readonly operation: DmkInstallOperation<
      DmkActionState<"install-bitcoin">
    >,
  ) {}
}

function conservativeInstallEvidence(query: () => boolean): boolean {
  try {
    return query() === false ? false : true;
  } catch {
    return true;
  }
}

function rejectedStartedInstallRun(
  operation: DmkInstallOperation<DmkActionState<"install-bitcoin">>,
): SessionBitcoinInstallationRun {
  const result = Promise.resolve<DmkActionRunResult<"install-bitcoin">>(
    Object.freeze({ status: "cancelled" }),
  );
  return Object.freeze({
    result,
    cancel: () => undefined,
    dispatchStarted: () =>
      conservativeInstallEvidence(() => operation.dispatchStarted()),
    mutationAttempted: () =>
      conservativeInstallEvidence(() => operation.mutationAttempted()),
  });
}

/** A private, generation-bound capability for later closed action adapters. */
export class OwnedDmkSession {
  readonly #modelIdSnapshot: string | undefined;

  #port: DmkPort | undefined;

  #session: DmkSession | undefined;

  readonly #lease: RuntimeLease;

  readonly #clock: Clock;

  #newWorkBlocked = false;

  #sessionAuthorityInvalidated = false;

  #lifecycleSubscription: DmkSubscription | undefined;

  #lifecycleUnsubscribePending = false;

  #lifecycleUnsubscribed = false;

  #sessionFinalizer: SessionFinalizer | undefined;

  #finalizationPromise: Promise<SessionFinalizationEvidence> | undefined;

  #rawDisconnectPromise: Promise<void> | undefined;

  #disconnectPromise: Promise<void> | undefined;

  #genuineGeneration: number | undefined;

  #currentGenuineAttempt: object | undefined;

  readonly #activeActions = new Set<ActiveSessionAction>();

  readonly #invalidationListeners = new Set<() => void>();

  #invalidationNotified = false;

  constructor(
    port: DmkPort,
    session: DmkSession,
    lease: RuntimeLease,
    clock: Clock,
    modelIdSnapshot: string | undefined,
  ) {
    this.#modelIdSnapshot = modelIdSnapshot;
    this.#port = port;
    this.#session = session;
    this.#lease = lease;
    this.#clock = clock;
  }

  get generation(): number {
    return this.#lease.generation;
  }

  /** The exact connected model value accepted by this session's model gate. */
  get modelId(): string {
    const modelId = this.#modelIdSnapshot;
    if (modelId === undefined) throw new UnsupportedLedgerModelError();
    return modelId;
  }

  isCurrent(): boolean {
    return (
      !this.#newWorkBlocked &&
      this.#lease.isCurrent() &&
      this.#port !== undefined &&
      this.#session !== undefined
    );
  }

  /** Observe only the loss of this private generation, without native data. */
  onInvalidated(listener: () => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("The session invalidation listener must be callable.");
    }
    if (this.#invalidationNotified || !this.#lease.isCurrent()) {
      try {
        listener();
      } catch {
        // Internal observers cannot alter session invalidation.
      }
      return () => undefined;
    }

    this.#invalidationListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#invalidationListeners.delete(listener);
    };
  }

  /** Begin the only action that may run before genuine proof exists. */
  dispatchGenuineCheck(
    options: DmkActionRunOptions = {},
  ): SessionGenuineCheckRun {
    this.#assertCurrent();
    if (this.#currentGenuineAttempt !== undefined) {
      throw new LedgerSessionActionBusyError();
    }
    this.#genuineGeneration = undefined;

    const generation = this.#lease.generation;
    const attempt = Object.freeze({});
    this.#currentGenuineAttempt = attempt;

    let run: DmkActionRun<"genuine">;
    try {
      run = this.#runCurrentAction({ kind: "genuine" }, options);
    } catch (error) {
      if (this.#currentGenuineAttempt === attempt) {
        this.#currentGenuineAttempt = undefined;
      }
      throw error;
    }

    const result = run.result.then((terminal) =>
      Object.freeze({
        terminal,
        settlement: this.#settleGenuineAttempt(attempt, generation, terminal),
      }),
    );

    return Object.freeze({
      result,
      cancel: () => run.cancel(),
    });
  }

  dispatchBitcoinInspection(
    options: DmkActionRunOptions = {},
  ): DmkActionRun<"list-bitcoin"> {
    return this.#dispatchProtectedAction({ kind: "list-bitcoin" }, options);
  }

  dispatchBitcoinInstallation(
    options: DmkActionRunOptions = {},
  ): SessionBitcoinInstallationRun {
    let operation: DmkInstallOperation<DmkActionState<"install-bitcoin">>;
    try {
      operation = this.#createProtectedOperation({
        kind: "install-bitcoin",
      });
    } catch (error) {
      if (error instanceof RejectedStartedInstallOperation) {
        return rejectedStartedInstallRun(error.operation);
      }
      throw error;
    }
    const run = this.#startTrackedAction(operation, options);
    return Object.freeze({
      result: run.result,
      cancel: () => run.cancel(),
      dispatchStarted: () =>
        conservativeInstallEvidence(() => operation.dispatchStarted()),
      mutationAttempted: () =>
        conservativeInstallEvidence(() => operation.mutationAttempted()),
    });
  }

  dispatchBitcoinOpen(
    options: DmkActionRunOptions = {},
  ): DmkActionRun<"open-bitcoin"> {
    return this.#dispatchProtectedAction({ kind: "open-bitcoin" }, options);
  }

  attachLifecycle(stream: DmkStream<never>): void {
    if (this.#newWorkBlocked || this.#lifecycleUnsubscribed) {
      throw new InactiveLedgerSessionError();
    }
    if (this.#lifecycleSubscription || this.#lifecycleUnsubscribePending) {
      throw new Error("The Ledger session lifecycle is already attached.");
    }

    const invalidate = (): void => this.#invalidateFromLifecycle();

    let subscription: DmkSubscription;
    try {
      subscription = stream.subscribe({
        next: () => undefined,
        error: invalidate,
        complete: invalidate,
      });
    } catch (error) {
      this.#invalidateFromLifecycle();
      throw error;
    }
    this.#lifecycleSubscription = subscription;
    if (this.#lifecycleUnsubscribePending) this.#unsubscribeLifecycle();
  }

  /**
   * Retire this generation through the ordered HID-aware finalizer.
   *
   * The first options object wins. Production operation code must call this
   * method with its real HID barrier before any compatibility `disconnect()`.
   */
  finalize(
    options: FinalizeOwnedDmkSessionOptions,
  ): Promise<SessionFinalizationEvidence> {
    if (this.#finalizationPromise) return this.#finalizationPromise;

    let resolveFinalization!: (evidence: SessionFinalizationEvidence) => void;
    const ownedFinalizationPromise = new Promise<SessionFinalizationEvidence>(
      (resolve) => {
        resolveFinalization = resolve;
      },
    );
    // Latch before reading options or invoking any finalizer hook. Hostile
    // getters and every later invalidation callback therefore observe the
    // first caller's exact promise.
    this.#finalizationPromise = ownedFinalizationPromise;

    let finalizer: SessionFinalizer;
    try {
      // Snapshot every first-caller field before finalization begins. Later
      // mutation (or a hostile getter) must not redirect individual hooks.
      const clock = options.clock;
      const hidBarrier = options.hidBarrier;
      const invalidatePlans = options.invalidatePlans;
      const clearPrivateReferences = options.clearPrivateReferences;
      finalizer = createSessionFinalizer({
        clock,
        hidBarrier,
        blockNewWork: () => this.#blockNewWork(),
        cancelActiveActions: () => this.#cancelActiveActions(),
        unsubscribeLifecycle: () => this.#unsubscribeLifecycle(),
        invalidatePlansAndSession: () =>
          this.#invalidatePlansAndSession(invalidatePlans),
        disconnect: () => this.#disconnectRawOnce(),
        clearPrivateReferences: () =>
          this.#clearPrivateReferences(clearPrivateReferences),
        releaseLease: () => this.#lease.release(),
      });
    } catch {
      finalizer = createSessionFinalizer({
        clock: this.#clock,
        hidBarrier: immediateUnavailableBarrier,
        blockNewWork: () => this.#blockNewWork(),
        cancelActiveActions: () => this.#cancelActiveActions(),
        unsubscribeLifecycle: () => this.#unsubscribeLifecycle(),
        invalidatePlansAndSession: () =>
          this.#invalidatePlansAndSession(() => undefined),
        disconnect: () => this.#disconnectRawOnce(),
        clearPrivateReferences: () =>
          this.#clearPrivateReferences(() => undefined),
        releaseLease: () => this.#lease.release(),
      });
    }
    this.#sessionFinalizer = finalizer;
    const finalization = finalizer.finalize();
    void finalization.then(
      (evidence) => {
        this.#sessionFinalizer = undefined;
        resolveFinalization(evidence);
      },
      () => {
        this.#sessionFinalizer = undefined;
        resolveFinalization(
          Object.freeze({
            hidRelease: "unavailable",
            handoff: "reconnect-required",
          }),
        );
      },
    );
    return ownedFinalizationPromise;
  }

  /**
   * Compatibility teardown without OS-level release proof.
   *
   * Production handoff must invoke `finalize(realOptions)` first; otherwise
   * this fallback wins and conservatively reports unavailable HID release.
   */
  disconnect(): Promise<void> {
    if (this.#disconnectPromise) return this.#disconnectPromise;

    let resolveDisconnect!: () => void;
    const disconnectPromise = new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    });
    // Latch before finalizer invalidation observers can reenter disconnect().
    this.#disconnectPromise = disconnectPromise;
    const finalization = this.finalize({
      clock: this.#clock,
      hidBarrier: immediateUnavailableBarrier,
      invalidatePlans: () => undefined,
      clearPrivateReferences: () => undefined,
    });
    void finalization.then(resolveDisconnect, resolveDisconnect);
    return disconnectPromise;
  }

  #disconnectRawOnce(): Promise<void> {
    if (this.#rawDisconnectPromise) return this.#rawDisconnectPromise;

    let resolveDisconnect!: () => void;
    let rejectDisconnect!: (error: unknown) => void;
    const disconnectPromise = new Promise<void>((resolve, reject) => {
      resolveDisconnect = resolve;
      rejectDisconnect = reject;
    });
    // The package-owned ordinary Promise is latched before vendor code can
    // reenter. It is the only value exposed to the ordered finalizer.
    this.#rawDisconnectPromise = disconnectPromise;

    const port = this.#port;
    const session = this.#session;
    if (!port || !session) {
      resolveDisconnect();
      return disconnectPromise;
    }

    let rawDisconnect: Promise<void>;
    try {
      rawDisconnect = port.disconnect(session);
    } catch (error) {
      rejectDisconnect(error);
      return disconnectPromise;
    }
    if (rawDisconnect === disconnectPromise) {
      rejectDisconnect(new TypeError("The raw disconnect promise is recursive."));
      return disconnectPromise;
    }
    try {
      void Promise.resolve(rawDisconnect).then(
        resolveDisconnect,
        rejectDisconnect,
      );
    } catch (error) {
      rejectDisconnect(error);
    }
    return disconnectPromise;
  }

  #assertCurrent(): void {
    if (this.#newWorkBlocked) throw new InactiveLedgerSessionError();
    if (this.#lease.isCurrent() && this.#port && this.#session) return;
    this.#blockNewWork();
    try {
      this.#invalidateSessionAuthority();
    } catch {
      // The public boundary remains inactive even with a hostile lease.
    }
    this.#cancelActiveActions();
    this.#notifyInvalidated();
    throw new InactiveLedgerSessionError();
  }

  #dispatchProtectedAction<K extends Exclude<DmkActionKind, "genuine">>(
    action: Extract<DmkActionRequest, { readonly kind: K }>,
    options: DmkActionRunOptions,
  ): DmkActionRun<K> {
    return this.#startTrackedAction<K>(
      this.#createProtectedOperation(action) as DmkOperation<
        DmkActionState<K>
      >,
      options,
    );
  }

  #createProtectedOperation<K extends Exclude<DmkActionKind, "genuine">>(
    action: Extract<DmkActionRequest, { readonly kind: K }>,
  ): DmkActionOperation<K> {
    this.#assertCurrent();
    const generation = this.#lease.generation;
    if (this.#genuineGeneration !== generation) {
      this.#genuineGeneration = undefined;
      throw new GenuineLedgerSessionRequiredError();
    }

    const port = this.#port;
    const session = this.#session;
    if (!port || !session) throw new InactiveLedgerSessionError();
    const operation = port.runAction(session, action);
    if (!this.#lease.isCurrent() || this.#lease.generation !== generation) {
      cancelOperationSafely(operation);
      this.#notifyInvalidated();
      if (action.kind === "install-bitcoin") {
        throw new RejectedStartedInstallOperation(
          operation as DmkInstallOperation<
            DmkActionState<"install-bitcoin">
          >,
        );
      }
      throw new InactiveLedgerSessionError();
    }
    if (this.#genuineGeneration !== generation) {
      cancelOperationSafely(operation);
      if (action.kind === "install-bitcoin") {
        throw new RejectedStartedInstallOperation(
          operation as DmkInstallOperation<
            DmkActionState<"install-bitcoin">
          >,
        );
      }
      throw new GenuineLedgerSessionRequiredError();
    }
    return operation;
  }

  #runCurrentAction<K extends DmkActionKind>(
    action: Extract<DmkActionRequest, { readonly kind: K }>,
    options: DmkActionRunOptions,
  ): DmkActionRun<K> {
    const generation = this.#lease.generation;
    const port = this.#port;
    const session = this.#session;
    if (!port || !session) throw new InactiveLedgerSessionError();
    const operation = port.runAction(session, action);
    if (!this.#lease.isCurrent() || this.#lease.generation !== generation) {
      cancelOperationSafely(operation);
      this.#notifyInvalidated();
      throw new InactiveLedgerSessionError();
    }
    return this.#startTrackedAction<K>(
      operation as DmkOperation<DmkActionState<K>>,
      options,
    );
  }

  #startTrackedAction<K extends DmkActionKind>(
    operation: DmkOperation<DmkActionState<K>>,
    options: DmkActionRunOptions,
  ): DmkActionRun<K> {
    const cancelOnceOperation = makeCancelOnceOperation(operation);
    const registration: ActiveSessionAction = {
      invalidated: false,
      cancel: () => cancelOnceOperation.cancel(),
    };
    this.#activeActions.add(registration);

    const run = runDmkAction(cancelOnceOperation, options);
    registration.cancel = () => run.cancel();
    if (registration.invalidated) run.cancel();

    const result = run.result.then((terminal) => {
      this.#activeActions.delete(registration);
      return terminal;
    });
    return Object.freeze({
      result,
      cancel: () => run.cancel(),
    });
  }

  #settleGenuineAttempt(
    attempt: object,
    generation: number,
    result: DmkActionRunResult<"genuine">,
  ): GenuineCheckSettlement {
    const isCurrentAttempt = !(
      this.#currentGenuineAttempt !== attempt ||
      !this.#lease.isCurrent() ||
      this.#lease.generation !== generation
    );

    if (isCurrentAttempt) {
      this.#currentGenuineAttempt = undefined;
      this.#genuineGeneration = undefined;
    }
    if (result.status !== "completed") {
      if (result.status === "cancelled" && !isCurrentAttempt) return "stale";
      return "failed";
    }

    const isGenuine = readStrictGenuineResult(result.output);
    if (isGenuine === undefined) return "invalid-output";
    if (!isGenuine) return "not-genuine";
    if (!isCurrentAttempt) return "stale";

    this.#genuineGeneration = generation;
    return "passed";
  }

  #revokeGenuineProof(): void {
    this.#genuineGeneration = undefined;
    this.#currentGenuineAttempt = undefined;
  }

  #blockNewWork(): void {
    this.#newWorkBlocked = true;
  }

  #invalidateFromLifecycle(): void {
    this.#blockNewWork();
    this.#cancelActiveActions();
    this.#unsubscribeLifecycle();
    try {
      this.#invalidateSessionAuthority();
    } catch {
      // Lifecycle loss remains authoritative over a hostile lease adapter.
    }
    this.#notifyInvalidated();
  }

  #invalidatePlansAndSession(invalidatePlans: () => void): void {
    let failed = false;
    let failure: unknown;
    try {
      this.#invalidateSessionAuthority();
    } catch (error) {
      failed = true;
      failure = error;
    }
    try {
      invalidatePlans();
    } catch (error) {
      if (!failed) failure = error;
      failed = true;
    }
    this.#notifyInvalidated();
    if (failed) throw failure;
  }

  #invalidateSessionAuthority(): void {
    if (this.#sessionAuthorityInvalidated) return;
    this.#sessionAuthorityInvalidated = true;
    this.#revokeGenuineProof();
    this.#lease.invalidate();
  }

  #clearPrivateReferences(clearPrivateReferences: () => void): void {
    this.#port = undefined;
    this.#session = undefined;
    this.#rawDisconnectPromise = undefined;
    this.#activeActions.clear();
    this.#invalidationListeners.clear();
    this.#lifecycleSubscription = undefined;
    // Compatibility/finalization promises intentionally remain retained so
    // every later caller receives the original settlement.
    clearPrivateReferences();
  }

  #cancelActiveActions(): void {
    for (const action of this.#activeActions) {
      if (action.invalidated) continue;
      action.invalidated = true;
      try {
        action.cancel();
      } catch {
        // Action invalidation remains best effort and never exposes native data.
      }
    }
  }

  #notifyInvalidated(): void {
    if (this.#invalidationNotified) return;
    this.#invalidationNotified = true;
    const listeners = [...this.#invalidationListeners];
    this.#invalidationListeners.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // Internal observers cannot alter session invalidation.
      }
    }
  }

  #unsubscribeLifecycle(): void {
    if (this.#lifecycleUnsubscribed) return;
    if (!this.#lifecycleSubscription) {
      this.#lifecycleUnsubscribePending = true;
      return;
    }
    this.#lifecycleUnsubscribed = true;
    this.#lifecycleUnsubscribePending = false;
    const subscription = this.#lifecycleSubscription;
    this.#lifecycleSubscription = undefined;
    try {
      subscription.unsubscribe();
    } catch {
      // Session invalidation is primary; native state must not escape here.
    }
  }
}

/** Connect, gate the model, and attach lifetime invalidation before actions. */
export async function openOwnedDmkSession(
  port: DmkPort,
  device: DmkDiscoveredDevice,
  options: OpenOwnedSessionOptions = {},
): Promise<OwnedDmkSession> {
  const modelPolicy = options.modelPolicy ?? productionSupportedModelPolicy;
  const clock = options.clock ?? systemClock;
  const lease = (options.acquireLease ?? acquireRuntimeLease)();

  let session: DmkSession;
  try {
    session = await port.connect(device);
  } catch (error) {
    lease.release();
    throw error;
  }

  let modelIdSnapshot: string | undefined;
  let modelReadFailed = false;
  let modelReadFailure: unknown;
  try {
    modelIdSnapshot = session.modelId;
  } catch (error) {
    modelReadFailed = true;
    modelReadFailure = error;
  }

  const ownedSession = new OwnedDmkSession(
    port,
    session,
    lease,
    clock,
    modelIdSnapshot,
  );
  try {
    if (modelReadFailed) throw modelReadFailure;
    if (
      typeof modelIdSnapshot !== "string" ||
      !modelPolicy.allows(modelIdSnapshot)
    ) {
      throw new UnsupportedLedgerModelError();
    }

    const lifecycle = port.observeSessionLifecycle(session);
    ownedSession.attachLifecycle(lifecycle);
    if (!ownedSession.isCurrent()) {
      throw new LedgerSessionEndedDuringSetupError();
    }
    return ownedSession;
  } catch (primaryError) {
    try {
      await ownedSession.disconnect();
    } catch {
      // The setup failure remains primary and contains no cleanup metadata.
    }
    throw primaryError;
  }
}
