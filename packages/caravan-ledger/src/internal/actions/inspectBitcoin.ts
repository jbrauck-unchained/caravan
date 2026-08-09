import { BitcoinInstallerError } from "../../errors";
import type { BitcoinInstallerEvent } from "../../events";
import type { DmkActionRunResult } from "../actionRunner";
import { mapPreMutationError } from "../errorMap";
import { createPendingEventMapper } from "../eventMap";
import type { OwnedDmkSession } from "../session";

const PHASE = "checking-bitcoin-app" as const;

export type BitcoinInspectionResult =
  | { readonly status: "bitcoin-present" }
  | { readonly status: "bitcoin-absent" };

export interface InspectBitcoinOptions {
  readonly onEvent?: (event: BitcoinInstallerEvent) => void;
}

export interface BitcoinInspectionHandle {
  readonly result: Promise<BitcoinInspectionResult>;
  cancel(): void;
}

const BITCOIN_PRESENT: BitcoinInspectionResult = Object.freeze({
  status: "bitcoin-present",
});
const BITCOIN_ABSENT: BitcoinInspectionResult = Object.freeze({
  status: "bitcoin-absent",
});

function safeFailureHandle(error: unknown): BitcoinInspectionHandle {
  const result = Promise.reject<BitcoinInspectionResult>(
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

function terminalError(
  result: Exclude<DmkActionRunResult<"list-bitcoin">, { status: "completed" }>,
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

function reducePresence(output: unknown): BitcoinInspectionResult | undefined {
  if (typeof output !== "object" || output === null) return undefined;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(
      output,
      "bitcoinPresent",
    );
    if (!descriptor || !("value" in descriptor)) return undefined;
    if (descriptor.value === true) return BITCOIN_PRESENT;
    if (descriptor.value === false) return BITCOIN_ABSENT;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Inspect only the exact, already-reduced Bitcoin presence fact. */
export function inspectBitcoin(
  session: OwnedDmkSession,
  options: InspectBitcoinOptions = {},
): BitcoinInspectionHandle {
  const eventMapper = createPendingEventMapper(PHASE, "list-bitcoin");
  let cancelledByCaller = false;
  let run: ReturnType<OwnedDmkSession["dispatchBitcoinInspection"]>;
  try {
    run = session.dispatchBitcoinInspection({
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

  const result = run.result.then((terminal) => {
    if (terminal.status !== "completed") {
      if (
        terminal.status === "cancelled" &&
        !cancelledByCaller &&
        !session.isCurrent()
      ) {
        throw disconnectedError();
      }
      throw terminalError(terminal);
    }
    const presence = reducePresence(terminal.output);
    if (!presence) throw internalError();
    return presence;
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
