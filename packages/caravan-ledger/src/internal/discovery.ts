import type {
  DmkDiscoveredDevice,
  DmkOperation,
  DmkPort,
  DmkSubscription,
} from "./dmkPort";

export type DiscoveryBoundaryErrorKind = "cancelled" | "no-device-selected";

export class DiscoveryBoundaryError extends Error {
  readonly name = "DiscoveryBoundaryError" as const;

  constructor(readonly kind: DiscoveryBoundaryErrorKind) {
    super(
      kind === "cancelled"
        ? "Ledger discovery was cancelled."
        : "Ledger discovery completed without a device.",
    );
  }
}

export interface DiscoveryAttempt {
  readonly result: Promise<DmkDiscoveredDevice>;
  cancel(): void;
  dispose(): void;
}

type DiscoveryTerminal =
  | { readonly type: "selected"; readonly device: DmkDiscoveredDevice }
  | { readonly type: "error"; readonly error: unknown };

/**
 * Enter the click-bound discovery path and subscribe without any asynchronous
 * yield between the two calls.
 */
export function discoverOneDevice(port: DmkPort): DiscoveryAttempt {
  let operation: DmkOperation<DmkDiscoveredDevice> | undefined;
  let subscription: DmkSubscription | undefined;
  let resolveResult!: (device: DmkDiscoveredDevice) => void;
  let rejectResult!: (error: unknown) => void;
  let terminal: DiscoveryTerminal | undefined;
  let settled = false;
  let subscribing = false;
  let cleanupStarted = false;
  let unsubscribePending = false;
  let cleanupError: unknown;

  const result = new Promise<DmkDiscoveredDevice>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const rememberCleanupError = (error: unknown): void => {
    if (cleanupError === undefined) cleanupError = error;
  };

  const unsubscribe = (): void => {
    if (!subscription) {
      unsubscribePending = true;
      return;
    }
    if (!unsubscribePending && subscription.closed) return;
    unsubscribePending = false;
    try {
      subscription.unsubscribe();
    } catch (error) {
      rememberCleanupError(error);
    }
  };

  const cleanup = (): void => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    try {
      operation?.cancel();
    } catch (error) {
      rememberCleanupError(error);
    }
    unsubscribePending = true;
    unsubscribe();
  };

  const settle = (): void => {
    if (settled || !terminal || subscribing) return;
    settled = true;
    if (terminal.type === "selected" && cleanupError === undefined) {
      resolveResult(terminal.device);
      return;
    }
    rejectResult(terminal.type === "error" ? terminal.error : cleanupError);
  };

  const finish = (nextTerminal: DiscoveryTerminal): void => {
    if (terminal || settled) return;
    terminal = nextTerminal;
    cleanup();
    settle();
  };

  try {
    operation = port.startDiscovery();
    subscribing = true;
    try {
      const createdSubscription = operation.stream.subscribe({
        next: (device) => finish({ type: "selected", device }),
        error: (error) => finish({ type: "error", error }),
        complete: () =>
          finish({
            type: "error",
            error: new DiscoveryBoundaryError("no-device-selected"),
          }),
      });
      subscription = createdSubscription;
      if (unsubscribePending) unsubscribe();
    } catch (error) {
      terminal = { type: "error", error };
      cleanup();
    } finally {
      subscribing = false;
    }
  } catch (error) {
    terminal = { type: "error", error };
    cleanup();
  }
  settle();

  const cancel = (): void => {
    finish({
      type: "error",
      error: new DiscoveryBoundaryError("cancelled"),
    });
  };

  return Object.freeze({
    result,
    cancel,
    dispose: cancel,
  });
}
