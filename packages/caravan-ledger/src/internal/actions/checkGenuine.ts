import { BitcoinInstallerError } from "../../errors";
import type { BitcoinInstallerEvent } from "../../events";
import type { DmkActionRunResult } from "../actionRunner";
import { mapPreMutationError } from "../errorMap";
import { createPendingEventMapper } from "../eventMap";
import {
  type GenuineCheckSettlement,
  type OwnedDmkSession,
  type SessionGenuineCheckRun,
} from "../session";

const PHASE = "checking-genuine" as const;

export interface GenuineCheckPassed {
  readonly status: "genuine-passed";
}

export interface CheckGenuineOptions {
  readonly onEvent?: (event: BitcoinInstallerEvent) => void;
}

export interface GenuineCheckHandle {
  readonly result: Promise<GenuineCheckPassed>;
  cancel(): void;
}

const GENUINE_CHECK_PASSED: GenuineCheckPassed = Object.freeze({
  status: "genuine-passed",
});

function safeFailureHandle(error: unknown): GenuineCheckHandle {
  const result = Promise.reject<GenuineCheckPassed>(
    mapPreMutationError(error, PHASE),
  );
  void result.catch(() => undefined);
  return Object.freeze({
    result,
    cancel: () => undefined,
  });
}

function internalError(): BitcoinInstallerError {
  return new BitcoinInstallerError("internal", PHASE, false);
}

function disconnectedError(): BitcoinInstallerError {
  return new BitcoinInstallerError("device-disconnected", PHASE, true);
}

function completedError(
  settlement: GenuineCheckSettlement,
): BitcoinInstallerError {
  if (settlement === "not-genuine") {
    return new BitcoinInstallerError("device-not-genuine", PHASE, false);
  }
  return internalError();
}

function terminalError(
  result: Exclude<DmkActionRunResult<"genuine">, { status: "completed" }>,
): BitcoinInstallerError {
  switch (result.status) {
    case "action-error":
    case "stream-error":
    case "subscription-error":
      return mapPreMutationError(result.rawError, PHASE);
    case "cancelled":
      return new BitcoinInstallerError("cancelled", PHASE, true);
    case "stopped":
    case "stream-completed":
    case "invalid-state":
      return internalError();
  }
}

/** Run one generation-bound genuine check without exposing its boolean. */
export function checkGenuine(
  session: OwnedDmkSession,
  options: CheckGenuineOptions = {},
): GenuineCheckHandle {
  const eventMapper = createPendingEventMapper(PHASE, "genuine");
  let cancelledByCaller = false;
  let run: SessionGenuineCheckRun;
  try {
    run = session.dispatchGenuineCheck({
      onPending: (pending) => {
        const event = eventMapper.map({
          interaction: pending.interaction,
          unitProgress: pending.progress,
        });
        if (event) options.onEvent?.(event);
      },
    });
  } catch (error) {
    return safeFailureHandle(error);
  }

  const result = run.result.then(({ terminal, settlement }) => {
    if (terminal.status === "completed") {
      if (settlement === "passed") return GENUINE_CHECK_PASSED;
      throw completedError(settlement);
    }
    if (terminal.status === "cancelled" && settlement === "stale") {
      if (!cancelledByCaller) throw disconnectedError();
      throw terminalError(terminal);
    }
    if (settlement === "stale") throw internalError();
    throw terminalError(terminal);
  });
  void result.catch(() => undefined);

  return Object.freeze({
    result,
    cancel: () => {
      if (session.isCurrent()) cancelledByCaller = true;
      run.cancel();
    },
  });
}
