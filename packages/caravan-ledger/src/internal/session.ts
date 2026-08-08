import {
  runDmkAction,
  type DmkActionRun,
  type DmkActionRunOptions,
  type DmkActionRunResult,
} from "./actionRunner";
import type {
  DmkActionKind,
  DmkActionRequest,
  DmkActionState,
  DmkDiscoveredDevice,
  DmkOperation,
  DmkPort,
  DmkSession,
  DmkStream,
  DmkSubscription,
} from "./dmkPort";
import { acquireRuntimeLease, type RuntimeLease } from "./runtimeLease";
import {
  productionSupportedModelPolicy,
  type SupportedModelPolicy,
} from "./supportedModels";

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

export interface OpenOwnedSessionOptions {
  readonly modelPolicy?: SupportedModelPolicy;
  readonly acquireLease?: () => RuntimeLease;
}

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

/** A private, generation-bound capability for later closed action adapters. */
export class OwnedDmkSession {
  readonly #port: DmkPort;

  readonly #session: DmkSession;

  readonly #lease: RuntimeLease;

  #lifecycleSubscription: DmkSubscription | undefined;

  #lifecycleUnsubscribePending = false;

  #lifecycleUnsubscribed = false;

  #disconnectPromise: Promise<void> | undefined;

  #genuineGeneration: number | undefined;

  #currentGenuineAttempt: object | undefined;

  readonly #activeActions = new Set<ActiveSessionAction>();

  constructor(port: DmkPort, session: DmkSession, lease: RuntimeLease) {
    this.#port = port;
    this.#session = session;
    this.#lease = lease;
  }

  get generation(): number {
    return this.#lease.generation;
  }

  isCurrent(): boolean {
    return this.#lease.isCurrent();
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
  ): DmkActionRun<"install-bitcoin"> {
    return this.#dispatchProtectedAction({ kind: "install-bitcoin" }, options);
  }

  dispatchBitcoinOpen(
    options: DmkActionRunOptions = {},
  ): DmkActionRun<"open-bitcoin"> {
    return this.#dispatchProtectedAction({ kind: "open-bitcoin" }, options);
  }

  attachLifecycle(stream: DmkStream<never>): void {
    if (this.#lifecycleSubscription || this.#lifecycleUnsubscribePending) {
      throw new Error("The Ledger session lifecycle is already attached.");
    }

    const invalidate = (): void => {
      this.#revokeGenuineProof();
      this.#lease.invalidate();
      this.#cancelActiveActions();
      this.#unsubscribeLifecycle();
    };

    let subscription: DmkSubscription;
    try {
      subscription = stream.subscribe({
        next: () => undefined,
        error: invalidate,
        complete: invalidate,
      });
    } catch (error) {
      this.#revokeGenuineProof();
      this.#lease.invalidate();
      this.#cancelActiveActions();
      throw error;
    }
    this.#lifecycleSubscription = subscription;
    if (this.#lifecycleUnsubscribePending) this.#unsubscribeLifecycle();
  }

  disconnect(): Promise<void> {
    if (this.#disconnectPromise) return this.#disconnectPromise;

    this.#disconnectPromise = (async () => {
      this.#revokeGenuineProof();
      this.#lease.invalidate();
      this.#cancelActiveActions();
      this.#unsubscribeLifecycle();
      try {
        await this.#port.disconnect(this.#session);
      } finally {
        this.#lease.release();
      }
    })();
    return this.#disconnectPromise;
  }

  #assertCurrent(): void {
    if (this.#lease.isCurrent()) return;
    this.#revokeGenuineProof();
    this.#cancelActiveActions();
    throw new InactiveLedgerSessionError();
  }

  #dispatchProtectedAction<K extends Exclude<DmkActionKind, "genuine">>(
    action: Extract<DmkActionRequest, { readonly kind: K }>,
    options: DmkActionRunOptions,
  ): DmkActionRun<K> {
    this.#assertCurrent();
    const generation = this.#lease.generation;
    if (this.#genuineGeneration !== generation) {
      this.#genuineGeneration = undefined;
      throw new GenuineLedgerSessionRequiredError();
    }

    const operation = this.#port.runAction(this.#session, action);
    if (!this.#lease.isCurrent() || this.#lease.generation !== generation) {
      cancelOperationSafely(operation);
      throw new InactiveLedgerSessionError();
    }
    if (this.#genuineGeneration !== generation) {
      cancelOperationSafely(operation);
      throw new GenuineLedgerSessionRequiredError();
    }
    return this.#startTrackedAction(operation, options);
  }

  #runCurrentAction<K extends DmkActionKind>(
    action: Extract<DmkActionRequest, { readonly kind: K }>,
    options: DmkActionRunOptions,
  ): DmkActionRun<K> {
    const generation = this.#lease.generation;
    const operation = this.#port.runAction(this.#session, action);
    if (!this.#lease.isCurrent() || this.#lease.generation !== generation) {
      cancelOperationSafely(operation);
      throw new InactiveLedgerSessionError();
    }
    return this.#startTrackedAction(operation, options);
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

  #unsubscribeLifecycle(): void {
    if (this.#lifecycleUnsubscribed) return;
    if (!this.#lifecycleSubscription) {
      this.#lifecycleUnsubscribePending = true;
      return;
    }
    this.#lifecycleUnsubscribed = true;
    this.#lifecycleUnsubscribePending = false;
    try {
      this.#lifecycleSubscription.unsubscribe();
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
  const lease = (options.acquireLease ?? acquireRuntimeLease)();

  let session: DmkSession;
  try {
    session = await port.connect(device);
  } catch (error) {
    lease.release();
    throw error;
  }

  const ownedSession = new OwnedDmkSession(port, session, lease);
  try {
    if (!modelPolicy.allows(session.modelId)) {
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
