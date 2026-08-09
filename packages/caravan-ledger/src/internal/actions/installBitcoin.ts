import { BitcoinInstallerError } from "../../errors";
import type { BitcoinInstallerEvent } from "../../events";
import { createPendingEventMapper } from "../eventMap";
import type {
  OwnedDmkSession,
  SessionBitcoinInstallationRun,
} from "../session";
import { classifyInstallFailure } from "../timeoutPolicy";

const PHASE = "installing" as const;

export type BitcoinInstallationDisposition =
  | "installed"
  | "already-installed";

export interface BitcoinInstallationVerificationRequired {
  readonly kind: "verification-required";
  readonly disposition: BitcoinInstallationDisposition;
}

export interface InstallBitcoinOptions {
  readonly onEvent?: (event: BitcoinInstallerEvent) => void;
}

export interface BitcoinInstallationHandle {
  readonly result: Promise<BitcoinInstallationVerificationRequired>;
  dispatchStarted(): boolean;
  mutationAttempted(): boolean;
  cancel(): void;
}

const INSTALLED_VERIFICATION_REQUIRED: BitcoinInstallationVerificationRequired =
  Object.freeze({
    kind: "verification-required",
    disposition: "installed",
  });
const ALREADY_INSTALLED_VERIFICATION_REQUIRED: BitcoinInstallationVerificationRequired =
  Object.freeze({
    kind: "verification-required",
    disposition: "already-installed",
  });

function errorHandle(
  error: BitcoinInstallerError,
): BitcoinInstallationHandle {
  const result = Promise.reject<BitcoinInstallationVerificationRequired>(error);
  void result.catch(() => undefined);
  return Object.freeze({
    result,
    dispatchStarted: () => false,
    mutationAttempted: () => false,
    cancel: () => undefined,
  });
}

function internalError(): BitcoinInstallerError {
  return new BitcoinInstallerError("internal", PHASE, false);
}

function unknownInstallState(): BitcoinInstallerError {
  return new BitcoinInstallerError("state-unknown", PHASE, true);
}

function terminalError(
  dispatchStarted: boolean,
  mutationAttempted: boolean,
): BitcoinInstallerError {
  // Every unproven terminal after native dispatch is ambiguous. The later
  // mutation marker can strengthen this conclusion but can never weaken it.
  if (dispatchStarted || mutationAttempted) return unknownInstallState();
  return internalError();
}

function classifyNativeActionError(
  rawError: unknown,
  mutationAttempted: boolean,
): BitcoinInstallationVerificationRequired {
  const decision = classifyInstallFailure({
    stage: "install-dispatched",
    mutationAttempted,
    trigger: { kind: "vendor-error", error: rawError },
  });
  if (decision.kind === "fresh-inspection-required") {
    return ALREADY_INSTALLED_VERIFICATION_REQUIRED;
  }
  if (
    decision.kind === "reject" &&
    decision.error.code === "insufficient-space"
  ) {
    throw decision.error;
  }
  throw unknownInstallState();
}

function hasStrictCompletion(output: unknown): boolean {
  if (typeof output !== "object" || output === null) return false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      output,
      "actionCompleted",
    );
    return !!descriptor && "value" in descriptor && descriptor.value === true;
  } catch {
    return false;
  }
}

/**
 * Run one fixed Bitcoin installation action. Every accepted terminal asks the
 * outer composer for exactly one independent inspection; it is never public
 * success evidence by itself.
 */
export function installBitcoin(
  session: OwnedDmkSession,
  options: InstallBitcoinOptions = {},
): BitcoinInstallationHandle {
  const eventMapper = createPendingEventMapper(PHASE, "install-bitcoin");
  let run: SessionBitcoinInstallationRun;
  try {
    run = session.dispatchBitcoinInstallation({
      onPending: (pending) => {
        const event = eventMapper.map({
          interaction: pending.interaction,
          unitProgress: pending.progress,
        });
        if (event) options.onEvent?.(event);
      },
    });
  } catch {
    return errorHandle(internalError());
  }

  const result = run.result.then((terminal) => {
    if (terminal.status === "verification-required") {
      if (!run.mutationAttempted()) throw unknownInstallState();
      return INSTALLED_VERIFICATION_REQUIRED;
    }
    if (terminal.status === "action-error") {
      return classifyNativeActionError(
        terminal.rawError,
        run.mutationAttempted(),
      );
    }
    if (terminal.status !== "completed") {
      throw terminalError(
        run.dispatchStarted(),
        run.mutationAttempted(),
      );
    }
    if (!hasStrictCompletion(terminal.output)) {
      if (run.dispatchStarted() || run.mutationAttempted()) {
        throw unknownInstallState();
      }
      throw internalError();
    }
    return run.mutationAttempted()
      ? INSTALLED_VERIFICATION_REQUIRED
      : ALREADY_INSTALLED_VERIFICATION_REQUIRED;
  });
  void result.catch(() => undefined);

  return Object.freeze({
    result,
    dispatchStarted: () => run.dispatchStarted(),
    mutationAttempted: () => run.mutationAttempted(),
    cancel: () => run.cancel(),
  });
}
