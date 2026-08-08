import type { Clock, ClockTimer } from "./clock";
import { PROVISIONAL_HID_RELEASE_POLICY } from "./hidReleasePolicy";
import type {
  HidReleaseBarrier,
  HidReleaseOutcome,
} from "./waitForHidRelease";

export type SessionHandoff = "ready" | "reconnect-required";

/** Private release evidence; it deliberately carries no operation disposition. */
export interface SessionFinalizationEvidence {
  readonly hidRelease: HidReleaseOutcome;
  readonly handoff: SessionHandoff;
}

/**
 * The exact ownership hooks required to retire one management session.
 *
 * Every hook except `disconnect` and the barrier methods is synchronous. A
 * caller should combine related local work (for example, all plan and session
 * generation invalidation) behind the corresponding single hook.
 */
export interface SessionFinalizerDependencies {
  readonly clock: Clock;
  readonly hidBarrier: HidReleaseBarrier;
  blockNewWork(): void;
  cancelActiveActions(): void;
  unsubscribeLifecycle(): void;
  invalidatePlansAndSession(): void;
  /**
   * Return an ordinary, same-realm, internally owned native Promise with no
   * own `constructor` or `then` property. Other shapes are contained but can
   * never establish a ready handoff.
   */
  disconnect(): Promise<void>;
  clearPrivateReferences(): void;
  releaseLease(): void;
}

export interface SessionFinalizer {
  finalize(): Promise<SessionFinalizationEvidence>;
}

type DisconnectSettlement = "settled" | "timed-out" | "unavailable";

interface NativePromiseObserverAttachment {
  readonly attached: boolean;
  readonly contractHealthy: boolean;
}

const intrinsicPromiseThen = Promise.prototype.then;

function isHidReleaseOutcome(value: unknown): value is HidReleaseOutcome {
  return (
    value === "released" ||
    value === "ambiguous" ||
    value === "unavailable" ||
    value === "timed-out"
  );
}

function containUnexpectedHookResult(value: unknown): void {
  try {
    void Promise.resolve(value).catch(() => undefined);
  } catch {
    // A synchronous ownership hook has already been invoked. Its unsupported
    // return value cannot be allowed to escape or reorder finalization.
  }
}

function clearTimerSafely(clock: Clock, timer: ClockTimer): boolean {
  try {
    clock.clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Observe a branded Promise without consulting a hostile own `then` property.
 *
 * Native `Promise.prototype.then` still performs species construction through
 * `constructor`, so an existing configurable hostile descriptor is temporarily
 * shadowed by the intrinsic constructor and restored before this function
 * returns. An ordinary Promise is never modified.
 */
function attachNativePromiseObserver(
  promise: Promise<unknown>,
  onSettled: () => void,
): NativePromiseObserverAttachment {
  let constructorDescriptor: PropertyDescriptor | undefined;
  let thenDescriptor: PropertyDescriptor | undefined;
  let hasOrdinaryPrototype = false;
  try {
    constructorDescriptor = Object.getOwnPropertyDescriptor(
      promise,
      "constructor",
    );
    thenDescriptor = Object.getOwnPropertyDescriptor(promise, "then");
    hasOrdinaryPrototype = Object.getPrototypeOf(promise) === Promise.prototype;
  } catch {
    return { attached: false, contractHealthy: false };
  }

  const contractHealthy =
    hasOrdinaryPrototype &&
    constructorDescriptor === undefined &&
    thenDescriptor === undefined;
  let constructorShadowed = false;
  let restorationHealthy = true;
  const hostileConfigurableConstructor =
    constructorDescriptor !== undefined &&
    constructorDescriptor.configurable &&
    !("value" in constructorDescriptor && constructorDescriptor.value === Promise)
      ? constructorDescriptor
      : undefined;

  try {
    if (hostileConfigurableConstructor) {
      Object.defineProperty(promise, "constructor", {
        configurable: true,
        enumerable: hostileConfigurableConstructor.enumerable ?? false,
        value: Promise,
        writable: true,
      });
      constructorShadowed = true;
    }
  } catch {
    return { attached: false, contractHealthy: false };
  }

  let attached = false;
  try {
    try {
      Reflect.apply(intrinsicPromiseThen, promise, [onSettled, onSettled]);
      attached = true;
    } catch {
      // No standard observer could be attached.
    }
  } finally {
    if (constructorShadowed && hostileConfigurableConstructor) {
      try {
        Object.defineProperty(
          promise,
          "constructor",
          hostileConfigurableConstructor,
        );
      } catch {
        restorationHealthy = false;
      }
    }
  }

  return {
    attached,
    contractHealthy: contractHealthy && restorationHealthy,
  };
}

/**
 * Wait for the one disconnect attempt without assuming that it is abortable.
 * A late rejection remains observed after this boundary has timed out.
 */
function awaitBoundedDisconnect(
  dependencies: SessionFinalizerDependencies,
): Promise<DisconnectSettlement> {
  let rawDisconnect: unknown;
  try {
    rawDisconnect = dependencies.disconnect();
  } catch {
    return Promise.resolve("settled");
  }

  let nativePromise: Promise<unknown> | undefined;
  try {
    if (rawDisconnect instanceof Promise) {
      nativePromise = rawDisconnect;
    }
  } catch {
    // A non-standard thenable can still be observed, but it cannot establish a
    // healthy disconnect boundary.
  }

  let clock: Clock;
  try {
    clock = dependencies.clock;
  } catch {
    if (nativePromise) {
      attachNativePromiseObserver(nativePromise, () => undefined);
    } else {
      try {
        const normalizedDisconnect = Promise.resolve(rawDisconnect);
        void normalizedDisconnect.then(
          () => undefined,
          () => undefined,
        );
      } catch {
        // The disconnect attempt has still happened exactly once.
      }
    }
    return Promise.resolve("unavailable");
  }

  return new Promise<DisconnectSettlement>((resolve) => {
    let settled = false;
    let timer: ClockTimer | undefined;

    const finish = (settlement: DisconnectSettlement): void => {
      if (settled) return;
      settled = true;
      const ownedTimer = timer;
      timer = undefined;
      if (
        ownedTimer !== undefined &&
        !clearTimerSafely(clock, ownedTimer)
      ) {
        resolve("unavailable");
        return;
      }
      resolve(settlement);
    };

    let disconnectContractHealthy = false;
    if (nativePromise) {
      const attachment = attachNativePromiseObserver(
        nativePromise,
        () => finish(disconnectContractHealthy ? "settled" : "unavailable"),
      );
      disconnectContractHealthy = attachment.contractHealthy;
      if (!attachment.attached) {
        finish("unavailable");
        return;
      }
    } else {
      // Non-native thenables are outside the dependency contract. Observe them
      // when possible, but never let them establish a ready handoff.
      try {
        const normalizedDisconnect = Promise.resolve(rawDisconnect);
        void normalizedDisconnect.then(
          () => finish("unavailable"),
          () => finish("unavailable"),
        );
      } catch {
        finish("unavailable");
        return;
      }
    }

    try {
      let scheduling = true;
      let firedSynchronously = false;
      const scheduledTimer = clock.setTimeout(() => {
        if (scheduling) {
          firedSynchronously = true;
          return;
        }
        finish(disconnectContractHealthy ? "timed-out" : "unavailable");
      }, PROVISIONAL_HID_RELEASE_POLICY.disconnectTimeoutMs);
      scheduling = false;

      if (firedSynchronously) {
        clearTimerSafely(clock, scheduledTimer);
        finish("unavailable");
      } else if (settled) {
        clearTimerSafely(clock, scheduledTimer);
      } else {
        // `undefined` is the only empty sentinel: browser/fake timer handle 0
        // is valid ownership and must be cleared on early settlement.
        timer = scheduledTimer;
      }
    } catch {
      finish("unavailable");
    }
  });
}

/**
 * Create the single finalization gate for one management-session generation.
 *
 * The promise is latched before any hook executes, so cancel, dispose, error,
 * and recovery reentrancy all share the exact same work and settlement.
 */
export function createSessionFinalizer(
  dependencies: SessionFinalizerDependencies,
): SessionFinalizer {
  let finalizationPromise: Promise<SessionFinalizationEvidence> | undefined;
  let privateReferencesCleared = false;
  let leaseReleased = false;

  const clearPrivateReferencesOnce = (): void => {
    if (privateReferencesCleared) return;
    privateReferencesCleared = true;
    dependencies.clearPrivateReferences();
  };

  const releaseLeaseOnce = (): void => {
    if (leaseReleased) return;
    leaseReleased = true;
    dependencies.releaseLease();
  };

  const finalize = (): Promise<SessionFinalizationEvidence> => {
    if (finalizationPromise) return finalizationPromise;

    let resolveFinalization!: (evidence: SessionFinalizationEvidence) => void;
    const promise = new Promise<SessionFinalizationEvidence>((resolve) => {
      resolveFinalization = resolve;
    });
    // Latch before blockNewWork(), which is the first reentrant boundary.
    finalizationPromise = promise;

    void (async () => {
      let cleanupHealthy = true;

      const invokeSynchronousHook = (hook: () => void): void => {
        try {
          const unexpectedResult: unknown = hook();
          if (unexpectedResult !== undefined) cleanupHealthy = false;
          containUnexpectedHookResult(unexpectedResult);
        } catch {
          cleanupHealthy = false;
        }
      };

      invokeSynchronousHook(() => dependencies.blockNewWork());
      invokeSynchronousHook(() => dependencies.cancelActiveActions());
      invokeSynchronousHook(() => dependencies.unsubscribeLifecycle());
      invokeSynchronousHook(() => dependencies.invalidatePlansAndSession());

      try {
        await dependencies.hidBarrier.arm();
      } catch {
        cleanupHealthy = false;
      }

      const disconnectSettlement = await awaitBoundedDisconnect(dependencies);
      if (disconnectSettlement === "unavailable") {
        cleanupHealthy = false;
      }

      let hidRelease: HidReleaseOutcome = "unavailable";
      try {
        const candidate: unknown = await dependencies.hidBarrier.wait();
        if (isHidReleaseOutcome(candidate)) {
          hidRelease = candidate;
        } else {
          cleanupHealthy = false;
        }
      } catch {
        cleanupHealthy = false;
      }

      invokeSynchronousHook(clearPrivateReferencesOnce);
      invokeSynchronousHook(releaseLeaseOnce);

      resolveFinalization(
        Object.freeze({
          hidRelease,
          handoff:
            hidRelease === "released" && cleanupHealthy
              ? "ready"
              : "reconnect-required",
        }),
      );
    })().catch(() => {
      // Every production dependency is contained above. This final guard keeps
      // the shared finalization promise total under adversarial JavaScript.
      try {
        clearPrivateReferencesOnce();
      } catch {
        // Best effort; evidence below remains conservative.
      }
      try {
        releaseLeaseOnce();
      } catch {
        // Best effort; evidence below remains conservative.
      }
      resolveFinalization(
        Object.freeze({
          hidRelease: "unavailable",
          handoff: "reconnect-required",
        }),
      );
    });

    return promise;
  };

  return Object.freeze({ finalize });
}
