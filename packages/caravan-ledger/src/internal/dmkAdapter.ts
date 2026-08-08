import {
  DeviceActionStatus,
  GenuineCheckDeviceAction,
  ListInstalledAppsDeviceAction,
  UserInteractionRequired,
  type DeviceManagementKit,
  type DeviceSessionId,
  type DiscoveredDevice,
} from "@ledgerhq/device-management-kit";
import { webHidIdentifier } from "@ledgerhq/device-transport-kit-web-hid";

import {
  DISABLED_SESSION_REFRESHER_OPTIONS,
  REVIEWED_READ_ONLY_UNLOCK_TIMEOUT_MS,
} from "./constants";
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
} from "./dmkPort";
import { acquireDmkRuntime } from "./dmkRuntime";
import {
  BitcoinOnlyInstallAppDeviceAction,
  isBitcoinInstallVerificationRequiredError,
} from "./installAppDeviceAction";
import {
  BitcoinOnlyOpenAppDeviceAction,
  isExactBitcoinOpenOutput,
} from "./openAppDeviceAction";

class UnknownDmkCapabilityError extends Error {
  constructor(kind: "device" | "session") {
    super(`The Ledger ${kind} capability is not owned by this adapter.`);
  }
}

interface NativeSubscription {
  readonly closed: boolean;
  unsubscribe(): void;
}

interface NativeStream<T> {
  subscribe(observer: DmkObserver<T>): NativeSubscription;
}

interface NativeActionOperation {
  readonly observable: NativeStream<unknown>;
  cancel(): void;
}

interface InstallEvidenceQuery {
  dispatchStarted(): boolean;
  mutationAttempted(): boolean;
}

type ImplementedActionKind = Extract<
  DmkActionKind,
  "genuine" | "list-bitcoin" | "install-bitcoin" | "open-bitcoin"
>;

interface ReducedNativeState {
  readonly state: DmkActionState<ImplementedActionKind>;
  readonly terminal: boolean;
  readonly cancelNative: boolean;
}

const missingOwnData = Symbol("missing-own-data");

class InvalidDmkActionStateError extends Error {
  readonly name = "InvalidDmkActionStateError" as const;

  readonly _tag = "InvalidDmkActionStateError" as const;

  constructor() {
    super("The Ledger action returned invalid state evidence.");
  }
}

class IndeterminateInstalledAppsError extends Error {
  readonly name = "IndeterminateInstalledAppsError" as const;

  readonly _tag = "IndeterminateInstalledAppsError" as const;

  constructor() {
    super("The Ledger app inspection evidence is indeterminate.");
  }
}

function readOwnData(
  value: unknown,
  key: PropertyKey,
): unknown | typeof missingOwnData {
  if (typeof value !== "object" || value === null) {
    return missingOwnData;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor
      ? descriptor.value
      : missingOwnData;
  } catch {
    return missingOwnData;
  }
}

function invalidNativeState(
  error: Error = new InvalidDmkActionStateError(),
): ReducedNativeState {
  return {
    state: Object.freeze({ status: "error", rawError: error }),
    terminal: true,
    cancelNative: true,
  };
}

function reducePendingState(
  kind: ImplementedActionKind,
  value: unknown,
): ReducedNativeState {
  const intermediateValue = readOwnData(value, "intermediateValue");
  if (intermediateValue === missingOwnData) return invalidNativeState();

  const interaction = readOwnData(intermediateValue, "requiredUserInteraction");
  let mappedInteraction:
    | "unlock-device"
    | "allow-secure-connection"
    | "confirm-open-app"
    | undefined;
  switch (interaction) {
    case UserInteractionRequired.None:
      mappedInteraction = undefined;
      break;
    case UserInteractionRequired.UnlockDevice:
      mappedInteraction = "unlock-device";
      break;
    case UserInteractionRequired.AllowSecureConnection:
      if (kind === "open-bitcoin") return invalidNativeState();
      mappedInteraction = "allow-secure-connection";
      break;
    case UserInteractionRequired.ConfirmOpenApp:
      if (kind !== "open-bitcoin") return invalidNativeState();
      mappedInteraction = "confirm-open-app";
      break;
    default:
      return invalidNativeState();
  }

  const pending: {
    status: "pending";
    interaction?:
      | "unlock-device"
      | "allow-secure-connection"
      | "confirm-open-app";
    progress?: number;
  } = { status: "pending" };
  if (mappedInteraction !== undefined) pending.interaction = mappedInteraction;

  if (kind === "install-bitcoin") {
    const progress = readOwnData(intermediateValue, "progress");
    if (
      typeof progress !== "number" ||
      !Number.isFinite(progress) ||
      progress < 0 ||
      progress > 1
    ) {
      return invalidNativeState();
    }
    pending.progress = progress;
  }

  return {
    // `confirm-open-app` is an internal native token normalized to the public
    // `confirm-open-bitcoin` interaction by the open action helper. It never
    // crosses the package boundary in this form.
    state: Object.freeze(
      pending,
    ) as unknown as DmkActionState<ImplementedActionKind>,
    terminal: false,
    cancelNative: false,
  };
}

function reduceGenuineOutput(value: unknown): ReducedNativeState {
  const isGenuine = readOwnData(value, "isGenuine");
  if (typeof isGenuine !== "boolean") return invalidNativeState();

  return {
    state: Object.freeze({
      status: "completed",
      output: Object.freeze({ isGenuine }),
    }),
    terminal: true,
    cancelNative: false,
  };
}

function reduceInstalledAppsOutput(value: unknown): ReducedNativeState {
  const installedApps = readOwnData(value, "installedApps");
  if (!Array.isArray(installedApps)) return invalidNativeState();

  const length = readOwnData(installedApps, "length");
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    return invalidNativeState();
  }
  if (length === 0) {
    // DMK 1.7.1 uses [] both for a legitimate empty inventory and when its
    // secure-channel stream completes without a Result. The reviewed policy
    // therefore treats both as indeterminate rather than authorizing install.
    return invalidNativeState(new IndeterminateInstalledAppsError());
  }

  let bitcoinPresent = false;
  for (let index = 0; index < length; index += 1) {
    const app = readOwnData(installedApps, String(index));
    if (app === missingOwnData) return invalidNativeState();

    const flags = readOwnData(app, "flags");
    const hash = readOwnData(app, "hash");
    const hashCodeData = readOwnData(app, "hash_code_data");
    const name = readOwnData(app, "name");
    if (
      typeof flags !== "number" ||
      !Number.isFinite(flags) ||
      typeof hash !== "string" ||
      typeof hashCodeData !== "string" ||
      typeof name !== "string"
    ) {
      return invalidNativeState();
    }
    if (name === "Bitcoin") bitcoinPresent = true;
  }

  return {
    state: Object.freeze({
      status: "completed",
      output: Object.freeze({ bitcoinPresent }),
    }),
    terminal: true,
    cancelNative: false,
  };
}

function reduceInstallOutput(value: unknown): ReducedNativeState {
  if (value !== undefined) return invalidNativeState();

  return {
    state: Object.freeze({
      status: "completed",
      output: Object.freeze({ actionCompleted: true as const }),
    }),
    terminal: true,
    cancelNative: false,
  };
}

function reduceOpenOutput(value: unknown): ReducedNativeState {
  if (!isExactBitcoinOpenOutput(value)) return invalidNativeState();

  return {
    state: Object.freeze({
      status: "completed",
      output: Object.freeze({ appOpened: true as const }),
    }),
    terminal: true,
    cancelNative: false,
  };
}

function reduceNativeActionState(
  kind: ImplementedActionKind,
  value: unknown,
): ReducedNativeState {
  try {
    const status = readOwnData(value, "status");
    switch (status) {
      case DeviceActionStatus.NotStarted:
        return {
          state: Object.freeze({ status: "not-started" }),
          terminal: false,
          cancelNative: false,
        };
      case DeviceActionStatus.Pending:
        return reducePendingState(kind, value);
      case DeviceActionStatus.Stopped:
        return {
          state: Object.freeze({ status: "stopped" }),
          terminal: true,
          cancelNative: false,
        };
      case DeviceActionStatus.Error: {
        const rawError = readOwnData(value, "error");
        if (rawError === missingOwnData) return invalidNativeState();
        if (
          kind === "install-bitcoin" &&
          isBitcoinInstallVerificationRequiredError(rawError)
        ) {
          return {
            state: Object.freeze({ status: "verification-required" }),
            terminal: true,
            cancelNative: false,
          };
        }
        return {
          state: Object.freeze({ status: "error", rawError }),
          terminal: true,
          cancelNative: false,
        };
      }
      case DeviceActionStatus.Completed: {
        const output = readOwnData(value, "output");
        if (output === missingOwnData) return invalidNativeState();
        if (kind === "genuine") return reduceGenuineOutput(output);
        if (kind === "list-bitcoin") return reduceInstalledAppsOutput(output);
        if (kind === "install-bitcoin") return reduceInstallOutput(output);
        return reduceOpenOutput(output);
      }
      default:
        return invalidNativeState();
    }
  } catch {
    return invalidNativeState();
  }
}

function adaptNativeActionOperation<K extends ImplementedActionKind>(
  kind: K,
  nativeOperation: NativeActionOperation,
  installEvidence?: InstallEvidenceQuery,
): DmkActionOperation<K> {
  let subscribed = false;
  let terminal = false;
  let cancelled = false;
  let nativeCancelled = false;
  let unsubscribeRequested = false;
  let unsubscribed = false;
  let nativeSubscription: NativeSubscription | undefined;

  const cancelNativeOnce = (): void => {
    if (nativeCancelled) return;
    nativeCancelled = true;
    try {
      nativeOperation.cancel();
    } catch {
      // Native cancellation is best effort and may not abort in-flight work.
    }
  };

  const unsubscribeNativeOnce = (): void => {
    if (!nativeSubscription) {
      unsubscribeRequested = true;
      return;
    }
    if (unsubscribed) return;
    unsubscribed = true;
    unsubscribeRequested = false;
    try {
      nativeSubscription.unsubscribe();
    } catch {
      // If subscription teardown itself is hostile, the action cancellation
      // path is the remaining best-effort way to stop native work.
      cancelNativeOnce();
    }
  };

  const finishNativeSubscription = (): void => {
    unsubscribeRequested = true;
    unsubscribeNativeOnce();
  };

  const stream: DmkStream<DmkActionState<K>> = {
    subscribe: (observer) => {
      if (subscribed) {
        throw new Error("A Ledger device action may only be subscribed once.");
      }
      subscribed = true;
      if (cancelled) {
        return {
          closed: true,
          unsubscribe: () => undefined,
        };
      }

      try {
        const candidateSubscription = nativeOperation.observable.subscribe({
          next: (nativeState) => {
            if (terminal || cancelled) return;
            const reduced = reduceNativeActionState(kind, nativeState);
            if (reduced.terminal) {
              terminal = true;
              if (reduced.cancelNative) cancelNativeOnce();
              try {
                observer.next(reduced.state as DmkActionState<K>);
              } catch {
                // Consumer callbacks must never throw into the native stream.
                cancelNativeOnce();
              } finally {
                finishNativeSubscription();
              }
              return;
            }
            try {
              observer.next(reduced.state as DmkActionState<K>);
            } catch {
              // A failed listener can no longer safely drive orchestration.
              // Stop the native action and contain the callback exception.
              terminal = true;
              cancelNativeOnce();
              finishNativeSubscription();
            }
          },
          error: (error) => {
            if (terminal || cancelled) return;
            terminal = true;
            try {
              observer.error(error);
            } catch {
              // Consumer callbacks must never throw into the native stream.
              // Do not call the native cancel path from this synchronous raw
              // terminal: the pinned intent queue will finish and shift the
              // same item after this callback returns.
            } finally {
              finishNativeSubscription();
            }
          },
          complete: () => {
            if (terminal || cancelled) return;
            terminal = true;
            try {
              observer.complete();
            } catch {
              // As above, native cancellation here can reentrantly shift the
              // pinned intent queue before its own completion handler runs.
            } finally {
              finishNativeSubscription();
            }
          },
        });
        if (
          typeof candidateSubscription !== "object" ||
          candidateSubscription === null
        ) {
          throw new TypeError(
            "The Ledger action returned an invalid subscription.",
          );
        }
        nativeSubscription = candidateSubscription;
        if (unsubscribeRequested) unsubscribeNativeOnce();
      } catch (error) {
        terminal = true;
        cancelNativeOnce();
        unsubscribeRequested = true;
        unsubscribeNativeOnce();
        throw error;
      }

      return {
        get closed(): boolean {
          if (terminal || cancelled || unsubscribed) return true;
          try {
            const nativeClosed = nativeSubscription?.closed;
            if (typeof nativeClosed === "boolean") return nativeClosed;
            terminal = true;
            cancelNativeOnce();
            finishNativeSubscription();
            return true;
          } catch {
            // A hostile native getter cannot be allowed across the private
            // port. Fail closed and attempt both native cleanup paths.
            terminal = true;
            cancelNativeOnce();
            finishNativeSubscription();
            return true;
          }
        },
        unsubscribe: () => {
          if (unsubscribed) return;
          terminal = true;
          unsubscribeRequested = true;
          unsubscribeNativeOnce();
        },
      };
    },
  };

  const operation: DmkOperation<DmkActionState<K>> = {
    stream,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      terminal = true;
      cancelNativeOnce();
      unsubscribeRequested = true;
      unsubscribeNativeOnce();
    },
  };

  if (kind === "install-bitcoin") {
    if (!installEvidence) {
      throw new Error("The Ledger install evidence boundary is unavailable.");
    }
    return {
      ...operation,
      dispatchStarted: () => {
        try {
          return installEvidence.dispatchStarted() === false ? false : true;
        } catch {
          // Unknown dispatch evidence is conservatively treated as started.
          return true;
        }
      },
      mutationAttempted: () => {
        try {
          return installEvidence.mutationAttempted() === false ? false : true;
        } catch {
          // Unknown marker evidence is conservatively treated as attempted.
          return true;
        }
      },
    } as DmkActionOperation<K>;
  }

  return operation as DmkActionOperation<K>;
}

function wrapSubscription(
  nativeSubscription: NativeSubscription,
): DmkSubscription {
  let unsubscribed = false;
  const unsubscribeOnce = (): void => {
    if (unsubscribed) return;
    unsubscribed = true;
    try {
      nativeSubscription.unsubscribe();
    } catch {
      // Native cleanup remains best effort at the private boundary.
    }
  };

  return {
    get closed(): boolean {
      if (unsubscribed) return true;
      try {
        return nativeSubscription.closed === true;
      } catch {
        unsubscribeOnce();
        return true;
      }
    },
    unsubscribe: unsubscribeOnce,
  };
}

/** Production reduction of the official DMK into Caravan's private port. */
export class DmkAdapter implements DmkPort {
  readonly #nativeDevices = new WeakMap<
    DmkDiscoveredDevice,
    DiscoveredDevice
  >();

  readonly #nativeSessions = new WeakMap<DmkSession, DeviceSessionId>();

  readonly #disconnectedSessions = new WeakSet<DmkSession>();

  #deviceSequence = 0;

  #sessionSequence = 0;

  constructor(private readonly runtime: DeviceManagementKit) {}

  isEnvironmentSupported(): boolean {
    return this.runtime.isEnvironmentSupported();
  }

  startDiscovery(): DmkOperation<DmkDiscoveredDevice> {
    // This call must remain synchronous: WebHID requests browser permission
    // while startDiscovering is entered from the caller's click stack.
    const nativeStream = this.runtime.startDiscovering({
      transport: webHidIdentifier,
    }) as NativeStream<DiscoveredDevice>;
    let cancelled = false;
    let subscribed = false;

    const stream: DmkStream<DmkDiscoveredDevice> = {
      subscribe: (observer) => {
        if (subscribed) {
          throw new Error("Ledger discovery may only be subscribed once.");
        }
        subscribed = true;
        if (cancelled) {
          return {
            closed: true,
            unsubscribe: () => undefined,
          };
        }

        const nativeSubscription = nativeStream.subscribe({
          next: (nativeDevice) => {
            if (cancelled) return;
            const device: DmkDiscoveredDevice = Object.freeze({
              internalDeviceId: `caravan-device-${++this.#deviceSequence}`,
            });
            this.#nativeDevices.set(device, nativeDevice);
            observer.next(device);
          },
          error: (error) => {
            if (!cancelled) observer.error(error);
          },
          complete: () => {
            if (!cancelled) observer.complete();
          },
        });
        return wrapSubscription(nativeSubscription);
      },
    };

    return {
      stream,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        // The private operation contract exposes synchronous cancellation,
        // while the pinned DMK resolves stopDiscovering asynchronously. WebHID
        // currently has no abort primitive, so this is best effort: invoke it
        // exactly once and contain any later vendor rejection.
        void this.runtime.stopDiscovering().catch(() => undefined);
      },
    };
  }

  async connect(device: DmkDiscoveredDevice): Promise<DmkSession> {
    const nativeDevice = this.#nativeDevices.get(device);
    if (!nativeDevice) throw new UnknownDmkCapabilityError("device");

    let nativeSessionId: DeviceSessionId | undefined;
    try {
      nativeSessionId = await this.runtime.connect({
        device: nativeDevice,
        sessionRefresherOptions: DISABLED_SESSION_REFRESHER_OPTIONS,
      });
      const connectedDevice = this.runtime.getConnectedDevice({
        sessionId: nativeSessionId,
      });
      const session: DmkSession = Object.freeze({
        internalSessionId: `caravan-session-${++this.#sessionSequence}`,
        modelId:
          typeof connectedDevice.modelId === "string"
            ? connectedDevice.modelId
            : undefined,
      });
      this.#nativeSessions.set(session, nativeSessionId);
      return session;
    } catch (primaryError) {
      if (nativeSessionId !== undefined) {
        try {
          await this.runtime.disconnect({ sessionId: nativeSessionId });
        } catch {
          // Preserve the setup failure; cleanup details must not escape.
        }
      }
      throw primaryError;
    }
  }

  observeSessionLifecycle(session: DmkSession): DmkStream<never> {
    const nativeSessionId = this.#nativeSession(session);
    const nativeStream = this.runtime.getDeviceSessionState({
      sessionId: nativeSessionId,
    }) as NativeStream<unknown>;
    let subscribed = false;

    return {
      subscribe: (observer) => {
        if (subscribed) {
          throw new Error(
            "A Ledger session lifecycle may only be subscribed once.",
          );
        }
        subscribed = true;
        const nativeSubscription = nativeStream.subscribe({
          next: () => {
            // Native session state is intentionally discarded.
          },
          error: (error) => observer.error(error),
          complete: () => observer.complete(),
        });
        return wrapSubscription(nativeSubscription);
      },
    };
  }

  runAction<K extends DmkActionKind>(
    session: DmkSession,
    action: Extract<DmkActionRequest, { readonly kind: K }>,
  ): DmkActionOperation<K> {
    const nativeSessionId = this.#nativeSession(session);
    switch (action.kind) {
      case "genuine": {
        const deviceAction = new GenuineCheckDeviceAction({
          input: { unlockTimeout: REVIEWED_READ_ONLY_UNLOCK_TIMEOUT_MS },
        });
        const nativeOperation = this.runtime.executeDeviceAction({
          sessionId: nativeSessionId,
          deviceAction,
        }) as NativeActionOperation;
        return adaptNativeActionOperation(
          "genuine",
          nativeOperation,
        ) as DmkActionOperation<K>;
      }
      case "list-bitcoin": {
        const deviceAction = new ListInstalledAppsDeviceAction({
          input: { unlockTimeout: REVIEWED_READ_ONLY_UNLOCK_TIMEOUT_MS },
        });
        const nativeOperation = this.runtime.executeDeviceAction({
          sessionId: nativeSessionId,
          deviceAction,
        }) as NativeActionOperation;
        return adaptNativeActionOperation(
          "list-bitcoin",
          nativeOperation,
        ) as DmkActionOperation<K>;
      }
      case "install-bitcoin": {
        const deviceAction = new BitcoinOnlyInstallAppDeviceAction();
        let dispatchStarted = false;
        let nativeOperation: NativeActionOperation;
        try {
          // This assignment is the final package-owned operation before the
          // pinned runtime receives native installation authority.
          dispatchStarted = true;
          nativeOperation = this.runtime.executeDeviceAction({
            sessionId: nativeSessionId,
            deviceAction,
          }) as NativeActionOperation;
        } catch (rawError) {
          // Once the invocation begins, even a synchronous runtime failure is
          // ambiguous. Preserve the raw value only inside the private stream
          // so the common runner can settle it without losing dispatch proof.
          nativeOperation = {
            observable: {
              subscribe: () => {
                throw rawError;
              },
            },
            cancel: () => undefined,
          };
        }
        return adaptNativeActionOperation("install-bitcoin", nativeOperation, {
          dispatchStarted: () => dispatchStarted,
          mutationAttempted: () => deviceAction.mutationAttempted(),
        }) as DmkActionOperation<K>;
      }
      case "open-bitcoin": {
        const deviceAction = new BitcoinOnlyOpenAppDeviceAction();
        const nativeOperation = this.runtime.executeDeviceAction({
          sessionId: nativeSessionId,
          deviceAction,
        }) as NativeActionOperation;
        return adaptNativeActionOperation(
          "open-bitcoin",
          nativeOperation,
        ) as DmkActionOperation<K>;
      }
      default:
        throw new Error("This Ledger device action is not available yet.");
    }
  }

  async disconnect(session: DmkSession): Promise<void> {
    if (this.#disconnectedSessions.has(session)) return;
    const nativeSessionId = this.#nativeSession(session);
    this.#disconnectedSessions.add(session);
    try {
      await this.runtime.disconnect({ sessionId: nativeSessionId });
    } finally {
      this.#nativeSessions.delete(session);
    }
  }

  async close(): Promise<void> {
    await this.runtime.close();
  }

  #nativeSession(session: DmkSession): DeviceSessionId {
    if (this.#disconnectedSessions.has(session)) {
      throw new UnknownDmkCapabilityError("session");
    }
    const nativeSessionId = this.#nativeSessions.get(session);
    if (nativeSessionId === undefined) {
      throw new UnknownDmkCapabilityError("session");
    }
    return nativeSessionId;
  }
}

export function createProductionDmkPort(): DmkPort {
  return new DmkAdapter(acquireDmkRuntime());
}
