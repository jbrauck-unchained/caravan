import { BitcoinInstallerError } from "../../errors";
import type { BitcoinInstallerEvent } from "../../events";
import type { OwnedDmkSession } from "../session";

import {
  inspectBitcoin,
  type BitcoinInspectionHandle,
} from "./inspectBitcoin";
import {
  installBitcoin,
  type BitcoinInstallationDisposition,
  type BitcoinInstallationHandle,
} from "./installBitcoin";

const VERIFY_PHASE = "verifying" as const;

export interface VerifiedBitcoinInstallation {
  /** Disposition is accepted only after the fresh inspection proves presence. */
  readonly status: BitcoinInstallationDisposition;
  /** Internal binding for later orchestration; this is not app-version proof. */
  readonly sessionGeneration: number;
}

export interface InstallAndVerifyBitcoinOptions {
  readonly onEvent?: (event: BitcoinInstallerEvent) => void;
  /** Internal phase hook; listener failure cannot alter device orchestration. */
  readonly onVerificationStart?: () => void;
}

export interface InstallAndVerifyBitcoinHandle {
  readonly result: Promise<VerifiedBitcoinInstallation>;
  dispatchStarted(): boolean;
  mutationAttempted(): boolean;
  cancel(): void;
}

type CompositionStage = "installing" | "between" | "verifying" | "settled";

function unknownVerificationState(): BitcoinInstallerError {
  return new BitcoinInstallerError("state-unknown", VERIFY_PHASE, true);
}

function conservativeEvidence(query: () => boolean): boolean {
  try {
    return query() === false ? false : true;
  } catch {
    return true;
  }
}

function remapVerificationEvent(
  event: BitcoinInstallerEvent,
): BitcoinInstallerEvent {
  const remapped: {
    phase: typeof VERIFY_PHASE;
    interaction?: BitcoinInstallerEvent["interaction"];
    progress?: number;
  } = { phase: VERIFY_PHASE };
  if (event.interaction !== undefined) {
    remapped.interaction = event.interaction;
  }
  if (event.progress !== undefined) {
    remapped.progress = event.progress;
  }
  return Object.freeze(remapped);
}

/**
 * Run one fixed install and then one distinct inspection in the same current
 * session generation. Neither action is retried, and only the inspection may
 * prove the returned Bitcoin-presence postcondition.
 */
export function installAndVerifyBitcoin(
  session: OwnedDmkSession,
  options: InstallAndVerifyBitcoinOptions = {},
): InstallAndVerifyBitcoinHandle {
  const sessionGeneration = session.generation;
  let stage: CompositionStage = "installing";
  let cancelled = false;
  let settled = false;
  let installCancelIssued = false;
  let verificationCancelIssued = false;
  let verificationStartNotified = false;
  let verification: BitcoinInspectionHandle | undefined;

  const installation: BitcoinInstallationHandle = installBitcoin(session, {
    onEvent: (event) => options.onEvent?.(event),
  });

  const cancelInstallOnce = (): void => {
    if (installCancelIssued) return;
    installCancelIssued = true;
    installation.cancel();
  };

  const cancelVerificationOnce = (): void => {
    if (verificationCancelIssued || !verification) return;
    verificationCancelIssued = true;
    verification.cancel();
  };

  const result = installation.result
    .then((installSettlement) => {
      stage = "between";
      if (!verificationStartNotified) {
        verificationStartNotified = true;
        stage = "verifying";
        try {
          options.onVerificationStart?.();
        } catch {
          // Internal observers cannot alter verification or retain native data.
        }
      }
      if (
        cancelled ||
        !session.isCurrent() ||
        session.generation !== sessionGeneration
      ) {
        throw unknownVerificationState();
      }

      try {
        verification = inspectBitcoin(session, {
          onEvent: (event) =>
            options.onEvent?.(remapVerificationEvent(event)),
        });
      } catch {
        throw unknownVerificationState();
      }

      // A synchronous verification event may reenter cancel() before the
      // inspection handle has been assigned above.
      if (cancelled) cancelVerificationOnce();

      return verification.result.then(
        (inspection) => {
          if (
            cancelled ||
            !session.isCurrent() ||
            session.generation !== sessionGeneration ||
            inspection.status !== "bitcoin-present"
          ) {
            throw unknownVerificationState();
          }
          return Object.freeze({
            status: installSettlement.disposition,
            sessionGeneration,
          });
        },
        () => {
          throw unknownVerificationState();
        },
      );
    })
    .finally(() => {
      settled = true;
      stage = "settled";
    });
  void result.catch(() => undefined);

  return Object.freeze({
    result,
    dispatchStarted: () =>
      conservativeEvidence(() => installation.dispatchStarted()),
    mutationAttempted: () =>
      conservativeEvidence(() => installation.mutationAttempted()),
    cancel: () => {
      if (cancelled || settled) return;
      cancelled = true;
      if (stage === "installing") {
        cancelInstallOnce();
      } else if (stage === "verifying") {
        cancelVerificationOnce();
      }
    },
  });
}
