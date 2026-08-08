import type { Clock, ClockTimer } from "../clock";
import type {
  DmkActionOperation,
  DmkActionKind,
  DmkActionRequest,
  DmkActionState,
  DmkDiscoveredDevice,
  DmkObserver,
  DmkOperation,
  DmkPort,
  DmkSession,
  DmkStream,
  DmkSubscription,
} from "../dmkPort";

export type ScriptedStreamStep<T> =
  | {
      readonly type: "next";
      readonly value: T;
      /** Omit for synchronous delivery; any number uses the injected timer. */
      readonly atMs?: number;
      /** Deliberately violate cancellation/unsubscription for race tests. */
      readonly afterCancel?: boolean;
    }
  | {
      readonly type: "error";
      readonly error: unknown;
      readonly atMs?: number;
      readonly afterCancel?: boolean;
    }
  | {
      readonly type: "complete";
      readonly atMs?: number;
      readonly afterCancel?: boolean;
    }
  | { readonly type: "throw-on-subscribe"; readonly error: unknown }
  | { readonly type: "never" };

export interface ScriptedInstallMutationStep {
  readonly type: "attempt-install-mutation";
  readonly atMs?: number;
  readonly afterCancel?: boolean;
}

export type ScriptedActionStep<K extends DmkActionKind> =
  | ScriptedStreamStep<DmkActionState<K>>
  | (K extends "install-bitcoin" ? ScriptedInstallMutationStep : never);

export type ScriptedPromise<T> =
  | { readonly type: "resolve"; readonly value: T; readonly afterMs?: number }
  | {
      readonly type: "reject";
      readonly error: unknown;
      readonly afterMs?: number;
    }
  | { readonly type: "throw"; readonly error: unknown }
  | { readonly type: "never" };

type ScriptedDmkStreamSource = "discovery" | "action" | "session-lifecycle";

export interface ScriptedDmkCall {
  readonly order: number;
  readonly type:
    | "environment-support"
    | "start-discovery"
    | "connect"
    | "observe-session"
    | "run-action"
    | "disconnect"
    | "close"
    | "subscribe"
    | "subscription-throw"
    | "next"
    | "stream-error"
    | "complete"
    | "attempt-install-mutation"
    | "cancel"
    | "unsubscribe";
  readonly operationId?: number;
  readonly source?: ScriptedDmkStreamSource;
  readonly device?: DmkDiscoveredDevice;
  readonly session?: DmkSession;
  readonly action?: DmkActionRequest;
  readonly value?: unknown;
  readonly error?: unknown;
}

export interface ScriptedDmkResources {
  readonly discoveryCount: number;
  readonly sessionLifecycleCount: number;
  readonly actionCount: number;
  readonly connectCount: number;
  readonly disconnectCount: number;
  readonly closeCount: number;
  readonly cancelCount: number;
  readonly unsubscribeCount: number;
  readonly activeSubscriptions: number;
  readonly scheduledTimers: number;
}

interface QueuedAction {
  readonly kind: DmkActionKind;
  readonly steps: readonly (
    | ScriptedStreamStep<DmkActionState>
    | ScriptedInstallMutationStep
  )[];
}

interface OperationResource {
  subscribed: boolean;
  closed: boolean;
  cancelled: boolean;
  terminal: boolean;
  installMutationBoundary: boolean;
  installDispatchStarted: boolean;
  mutationAttempted: boolean;
  readonly timers: Map<ClockTimer, boolean>;
}

/** Deterministic, package-internal DMK replacement for lifecycle tests. */
export class ScriptedDmk implements DmkPort {
  private readonly discoveryScripts: Array<
    readonly ScriptedStreamStep<DmkDiscoveredDevice>[]
  > = [];

  private readonly actionScripts: QueuedAction[] = [];

  private readonly sessionLifecycleScripts: Array<
    readonly ScriptedStreamStep<never>[]
  > = [];

  private readonly connectScripts: ScriptedPromise<DmkSession>[] = [];

  private readonly disconnectScripts: ScriptedPromise<void>[] = [];

  private readonly closeScripts: ScriptedPromise<void>[] = [];

  private readonly operationResources = new Map<number, OperationResource>();

  private readonly promiseTimers = new Set<ClockTimer>();

  private readonly recordedCalls: ScriptedDmkCall[] = [];

  private order = 0;

  private operationId = 0;

  constructor(
    private readonly clock: Clock,
    private environmentSupported = true,
  ) {}

  get calls(): readonly ScriptedDmkCall[] {
    return this.recordedCalls;
  }

  setEnvironmentSupported(supported: boolean): void {
    this.environmentSupported = supported;
  }

  queueDiscovery(
    steps: readonly ScriptedStreamStep<DmkDiscoveredDevice>[],
  ): this {
    this.discoveryScripts.push(steps);
    return this;
  }

  queueAction<K extends DmkActionKind>(
    kind: K,
    steps: readonly ScriptedActionStep<K>[],
  ): this {
    this.actionScripts.push({
      kind,
      steps: steps as readonly (
        | ScriptedStreamStep<DmkActionState>
        | ScriptedInstallMutationStep
      )[],
    });
    return this;
  }

  queueConnect(script: ScriptedPromise<DmkSession>): this {
    this.connectScripts.push(script);
    return this;
  }

  queueSessionLifecycle(steps: readonly ScriptedStreamStep<never>[]): this {
    this.sessionLifecycleScripts.push(steps);
    return this;
  }

  queueDisconnect(script: ScriptedPromise<void>): this {
    this.disconnectScripts.push(script);
    return this;
  }

  queueClose(script: ScriptedPromise<void>): this {
    this.closeScripts.push(script);
    return this;
  }

  isEnvironmentSupported(): boolean {
    this.record({ type: "environment-support" });
    return this.environmentSupported;
  }

  startDiscovery(): DmkOperation<DmkDiscoveredDevice> {
    const steps = this.discoveryScripts.shift();
    if (!steps) {
      throw new Error("No discovery script is queued.");
    }
    return this.createOperation("discovery", steps);
  }

  connect(device: DmkDiscoveredDevice): Promise<DmkSession> {
    this.record({ type: "connect", device });
    const script = this.connectScripts.shift();
    if (!script) {
      throw new Error("No connection script is queued.");
    }
    return this.runPromise(script);
  }

  observeSessionLifecycle(session: DmkSession): DmkStream<never> {
    const steps = this.sessionLifecycleScripts.shift();
    if (!steps) {
      throw new Error("No session lifecycle script is queued.");
    }
    return this.createOperation("session-lifecycle", steps, { session }).stream;
  }

  runAction<K extends DmkActionKind>(
    session: DmkSession,
    action: Extract<DmkActionRequest, { readonly kind: K }>,
  ): DmkActionOperation<K> {
    const queued = this.actionScripts[0];
    if (!queued) {
      throw new Error("No action script is queued.");
    }
    if (queued.kind !== action.kind) {
      throw new Error(
        `Expected scripted action ${queued.kind}, received ${action.kind}.`,
      );
    }
    this.actionScripts.shift();
    return this.createOperation("action", queued.steps, {
      session,
      action,
    }, action.kind === "install-bitcoin") as DmkActionOperation<K>;
  }

  disconnect(session: DmkSession): Promise<void> {
    this.record({ type: "disconnect", session });
    return this.runPromise(
      this.disconnectScripts.shift() ?? { type: "resolve", value: undefined },
    );
  }

  close(): Promise<void> {
    this.record({ type: "close" });
    return this.runPromise(
      this.closeScripts.shift() ?? { type: "resolve", value: undefined },
    );
  }

  resources(): ScriptedDmkResources {
    const count = (type: ScriptedDmkCall["type"]) =>
      this.recordedCalls.filter((call) => call.type === type).length;
    let activeSubscriptions = 0;
    let operationTimers = 0;
    for (const resource of this.operationResources.values()) {
      if (resource.subscribed && !resource.closed) {
        activeSubscriptions += 1;
      }
      operationTimers += resource.timers.size;
    }

    return {
      discoveryCount: count("start-discovery"),
      sessionLifecycleCount: count("observe-session"),
      actionCount: count("run-action"),
      connectCount: count("connect"),
      disconnectCount: count("disconnect"),
      closeCount: count("close"),
      cancelCount: count("cancel"),
      unsubscribeCount: count("unsubscribe"),
      activeSubscriptions,
      scheduledTimers: operationTimers + this.promiseTimers.size,
    };
  }

  private createOperation<T>(
    source: ScriptedDmkStreamSource,
    steps: readonly (ScriptedStreamStep<T> | ScriptedInstallMutationStep)[],
    details: Pick<ScriptedDmkCall, "session" | "action"> = {},
    installMutationBoundary = false,
  ): DmkOperation<T> {
    const operationId = ++this.operationId;
    const resource: OperationResource = {
      subscribed: false,
      closed: false,
      cancelled: false,
      terminal: false,
      installMutationBoundary,
      installDispatchStarted: installMutationBoundary,
      mutationAttempted: false,
      timers: new Map(),
    };
    this.operationResources.set(operationId, resource);
    const callType =
      source === "discovery"
        ? "start-discovery"
        : source === "action"
          ? "run-action"
          : "observe-session";
    this.record({
      type: callType,
      operationId,
      source,
      ...details,
    });

    const stream: DmkStream<T> = {
      subscribe: (observer) =>
        this.subscribe(operationId, source, resource, steps, observer),
    };

    const operation: DmkOperation<T> = {
      stream,
      cancel: () => {
        if (resource.cancelled) {
          return;
        }
        resource.cancelled = true;
        this.record({ type: "cancel", operationId, source });
        this.clearNormalTimers(resource);
      },
    };

    if (installMutationBoundary) {
      return {
        ...operation,
        dispatchStarted: () => resource.installDispatchStarted,
        mutationAttempted: () => resource.mutationAttempted,
      } as DmkOperation<T>;
    }
    return operation;
  }

  private subscribe<T>(
    operationId: number,
    source: ScriptedDmkStreamSource,
    resource: OperationResource,
    steps: readonly (ScriptedStreamStep<T> | ScriptedInstallMutationStep)[],
    observer: DmkObserver<T>,
  ): DmkSubscription {
    if (resource.subscribed) {
      throw new Error("A scripted operation can only be subscribed once.");
    }
    resource.subscribed = true;
    this.record({ type: "subscribe", operationId, source });

    const subscriptionThrow = steps.find(
      (step) => step.type === "throw-on-subscribe",
    );
    if (subscriptionThrow?.type === "throw-on-subscribe") {
      resource.closed = true;
      this.record({
        type: "subscription-throw",
        operationId,
        source,
        error: subscriptionThrow.error,
      });
      throw subscriptionThrow.error;
    }

    for (const step of steps) {
      if (step.type === "throw-on-subscribe" || step.type === "never") {
        continue;
      }
      if (
        step.afterCancel !== true &&
        (resource.cancelled || resource.closed || resource.terminal)
      ) {
        continue;
      }
      if (step.atMs === undefined) {
        this.deliver(operationId, source, resource, observer, step);
      } else {
        if (!Number.isFinite(step.atMs) || step.atMs < 0) {
          throw new TypeError("Script times must be finite and non-negative.");
        }
        const timer = this.clock.setTimeout(() => {
          resource.timers.delete(timer);
          this.deliver(operationId, source, resource, observer, step);
        }, step.atMs);
        resource.timers.set(timer, step.afterCancel === true);
      }
    }

    return {
      get closed() {
        return resource.closed;
      },
      unsubscribe: () => {
        if (resource.closed) {
          return;
        }
        resource.closed = true;
        this.record({ type: "unsubscribe", operationId, source });
        this.clearNormalTimers(resource);
      },
    };
  }

  private deliver<T>(
    operationId: number,
    source: ScriptedDmkStreamSource,
    resource: OperationResource,
    observer: DmkObserver<T>,
    step:
      | Exclude<
          ScriptedStreamStep<T>,
          { readonly type: "throw-on-subscribe" } | { readonly type: "never" }
        >
      | ScriptedInstallMutationStep,
  ): void {
    const adversarialLateDelivery = step.afterCancel === true;
    if (
      !adversarialLateDelivery &&
      (resource.cancelled || resource.closed || resource.terminal)
    ) {
      return;
    }

    switch (step.type) {
      case "attempt-install-mutation":
        if (!resource.installMutationBoundary) return;
        resource.mutationAttempted = true;
        this.record({
          type: "attempt-install-mutation",
          operationId,
          source,
        });
        return;
      case "next":
        this.record({
          type: "next",
          operationId,
          source,
          value: step.value,
        });
        observer.next(step.value);
        return;
      case "error":
        if (!adversarialLateDelivery) {
          resource.terminal = true;
          resource.closed = true;
          this.clearNormalTimers(resource);
        }
        this.record({
          type: "stream-error",
          operationId,
          source,
          error: step.error,
        });
        observer.error(step.error);
        return;
      case "complete":
        if (!adversarialLateDelivery) {
          resource.terminal = true;
          resource.closed = true;
          this.clearNormalTimers(resource);
        }
        this.record({ type: "complete", operationId, source });
        observer.complete();
    }
  }

  private clearNormalTimers(resource: OperationResource): void {
    for (const [timer, deliverAfterCancel] of resource.timers) {
      if (!deliverAfterCancel) {
        this.clock.clearTimeout(timer);
        resource.timers.delete(timer);
      }
    }
  }

  private runPromise<T>(script: ScriptedPromise<T>): Promise<T> {
    if (script.type === "throw") {
      throw script.error;
    }
    if (script.type === "never") {
      return new Promise<T>(() => {
        // Deliberately left pending for deterministic timeout/cleanup tests.
      });
    }
    if (script.afterMs === undefined) {
      return script.type === "resolve"
        ? Promise.resolve(script.value)
        : Promise.reject(script.error);
    }
    if (!Number.isFinite(script.afterMs) || script.afterMs < 0) {
      throw new TypeError("Script times must be finite and non-negative.");
    }

    const delayMs = script.afterMs;
    return new Promise<T>((resolve, reject) => {
      const timer = this.clock.setTimeout(() => {
        this.promiseTimers.delete(timer);
        if (script.type === "resolve") {
          resolve(script.value);
        } else {
          reject(script.error);
        }
      }, delayMs);
      this.promiseTimers.add(timer);
    });
  }

  private record(call: Omit<ScriptedDmkCall, "order">): void {
    this.recordedCalls.push({ ...call, order: ++this.order });
  }
}
