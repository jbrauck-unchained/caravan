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

type ReadOnlyActionKind = Extract<DmkActionKind, "genuine" | "list-bitcoin">;

interface ReducedNativeState {
  readonly state: DmkActionState<ReadOnlyActionKind>;
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

function reducePendingState(value: unknown): ReducedNativeState {
  const intermediateValue = readOwnData(value, "intermediateValue");
  if (intermediateValue === missingOwnData) return invalidNativeState();

  const interaction = readOwnData(intermediateValue, "requiredUserInteraction");
  switch (interaction) {
    case UserInteractionRequired.None:
      return {
        state: Object.freeze({ status: "pending" }),
        terminal: false,
        cancelNative: false,
      };
    case UserInteractionRequired.UnlockDevice:
      return {
        state: Object.freeze({
          status: "pending",
          interaction: "unlock-device",
        }),
        terminal: false,
        cancelNative: false,
      };
    case UserInteractionRequired.AllowSecureConnection:
      return {
        state: Object.freeze({
          status: "pending",
          interaction: "allow-secure-connection",
        }),
        terminal: false,
        cancelNative: false,
      };
    default:
      return invalidNativeState();
  }
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

function reduceNativeActionState(
  kind: ReadOnlyActionKind,
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
        return reducePendingState(value);
      case DeviceActionStatus.Stopped:
        return {
          state: Object.freeze({ status: "stopped" }),
          terminal: true,
          cancelNative: false,
        };
      case DeviceActionStatus.Error: {
        const rawError = readOwnData(value, "error");
        return rawError === missingOwnData
          ? invalidNativeState()
          : {
              state: Object.freeze({ status: "error", rawError }),
              terminal: true,
              cancelNative: false,
            };
      }
      case DeviceActionStatus.Completed: {
        const output = readOwnData(value, "output");
        if (output === missingOwnData) return invalidNativeState();
        return kind === "genuine"
          ? reduceGenuineOutput(output)
          : reduceInstalledAppsOutput(output);
      }
      default:
        return invalidNativeState();
    }
  } catch {
    return invalidNativeState();
  }
}

function adaptNativeActionOperation<K extends ReadOnlyActionKind>(
  kind: K,
  nativeOperation: NativeActionOperation,
): DmkOperation<DmkActionState<K>> {
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
              cancelNativeOnce();
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
              // Consumer callbacks must never throw into the native stream.
              cancelNativeOnce();
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

  return {
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
  ): DmkOperation<DmkActionState<K>> {
    if (action.kind === "install-bitcoin" || action.kind === "open-bitcoin") {
      throw new Error("This Ledger device action is not available yet.");
    }

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
        ) as DmkOperation<DmkActionState<K>>;
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
        ) as DmkOperation<DmkActionState<K>>;
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
