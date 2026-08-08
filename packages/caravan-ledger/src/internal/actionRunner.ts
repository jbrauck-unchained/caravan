import type {
  DmkActionKind,
  DmkActionOutputByKind,
  DmkActionState,
  DmkOperation,
  DmkSubscription,
} from "./dmkPort";

export type DmkPendingState = Extract<
  DmkActionState,
  { readonly status: "pending" }
>;

/**
 * Internal terminal evidence. Raw failures stay below the package boundary and
 * must be passed through the stage-appropriate safe error mapper.
 */
export type DmkActionRunResult<K extends DmkActionKind> =
  | {
      readonly status: "completed";
      readonly output: DmkActionOutputByKind[K];
    }
  | (K extends "install-bitcoin"
      ? { readonly status: "verification-required" }
      : never)
  | { readonly status: "action-error"; readonly rawError: unknown }
  | { readonly status: "stopped" }
  | { readonly status: "stream-error"; readonly rawError: unknown }
  | { readonly status: "subscription-error"; readonly rawError: unknown }
  | { readonly status: "stream-completed" }
  | { readonly status: "invalid-state" }
  | { readonly status: "cancelled" };

export interface DmkActionRunOptions {
  readonly onPending?: (state: DmkPendingState) => void;
}

export interface DmkActionRun<K extends DmkActionKind> {
  readonly result: Promise<DmkActionRunResult<K>>;
  cancel(): void;
}

function samePendingState(
  left: DmkPendingState,
  right: DmkPendingState,
): boolean {
  return (
    left.interaction === right.interaction &&
    Object.is(left.progress, right.progress)
  );
}

function copyPendingState(state: DmkPendingState): DmkPendingState {
  const pending: {
    status: "pending";
    interaction?: DmkPendingState["interaction"];
    progress?: number;
  } = { status: "pending" };
  if (state.interaction !== undefined) {
    pending.interaction = state.interaction;
  }
  if (state.progress !== undefined) {
    pending.progress = state.progress;
  }
  return Object.freeze(pending);
}

/**
 * Subscribe once to one closed-authority DMK operation and reduce it to one
 * settle-once result. This function deliberately owns no timeout policy.
 */
export function runDmkAction<K extends DmkActionKind>(
  operation: DmkOperation<DmkActionState<K>>,
  options: DmkActionRunOptions = {},
): DmkActionRun<K> {
  let settled = false;
  let vendorCancelled = false;
  let cleanupRequested = false;
  let unsubscribed = false;
  let subscription: DmkSubscription | undefined;
  let lastPending: DmkPendingState | undefined;
  let resolveResult!: (result: DmkActionRunResult<K>) => void;

  const result = new Promise<DmkActionRunResult<K>>((resolve) => {
    resolveResult = resolve;
  });

  const cancelVendorOnce = (): void => {
    if (vendorCancelled) return;
    vendorCancelled = true;
    try {
      operation.cancel();
    } catch {
      // Vendor cancellation is best effort and never replaces the terminal.
    }
  };

  const cleanupSubscription = (): void => {
    if (!cleanupRequested || !subscription || unsubscribed) return;
    unsubscribed = true;
    try {
      subscription.unsubscribe();
    } catch {
      // Cleanup failure cannot replace already classified operation evidence.
    }
  };

  const settle = (
    terminal: DmkActionRunResult<K>,
    cancelVendor = false,
  ): void => {
    if (settled) return;
    settled = true;
    if (cancelVendor) cancelVendorOnce();
    cleanupRequested = true;
    cleanupSubscription();
    resolveResult(terminal);
  };

  try {
    subscription = operation.stream.subscribe({
      next: (state) => {
        if (settled) return;

        switch (state.status) {
          case "not-started":
            return;
          case "pending": {
            const pending = copyPendingState(state);
            if (lastPending && samePendingState(lastPending, pending)) return;
            lastPending = pending;
            try {
              options.onPending?.(pending);
            } catch {
              // Listener failures are isolated and never enter SDK state.
            }
            return;
          }
          case "completed":
            settle({ status: "completed", output: state.output });
            return;
          case "verification-required":
            settle({ status: "verification-required" } as DmkActionRunResult<K>);
            return;
          case "error":
            settle({ status: "action-error", rawError: state.rawError });
            return;
          case "stopped":
            settle({ status: "stopped" });
            return;
          default:
            // A future/invalid status is not terminal evidence. Stop the
            // vendor actor as well as dropping the subscription so it cannot
            // continue device work behind Caravan's failed-closed result.
            settle({ status: "invalid-state" }, true);
        }
      },
      error: (rawError) => {
        settle({ status: "stream-error", rawError });
      },
      complete: () => {
        settle({ status: "stream-completed" });
      },
    });
    cleanupSubscription();
  } catch (rawError) {
    settle({ status: "subscription-error", rawError }, true);
  }

  return {
    result,
    cancel: () => {
      settle({ status: "cancelled" }, true);
    },
  };
}
