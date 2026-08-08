import type { BitcoinInstallerEvent } from "../../events";
import { createPendingEventMapper } from "../eventMap";
import type { OwnedDmkSession } from "../session";

const PHASE = "opening-bitcoin" as const;
const missingOwnData = Symbol("missing-own-data");

export interface BitcoinOpenResult {
  readonly appOpened: boolean;
}

export interface OpenBitcoinOptions {
  readonly onEvent?: (event: BitcoinInstallerEvent) => void;
}

export interface BitcoinOpenHandle {
  readonly result: Promise<BitcoinOpenResult>;
  cancel(): void;
}

const BITCOIN_OPENED: BitcoinOpenResult = Object.freeze({ appOpened: true });
const BITCOIN_NOT_OPENED: BitcoinOpenResult = Object.freeze({
  appOpened: false,
});

function readOwnData(
  value: unknown,
  key: PropertyKey,
): unknown | typeof missingOwnData {
  if (typeof value !== "object" || value === null) return missingOwnData;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor
      ? descriptor.value
      : missingOwnData;
  } catch {
    return missingOwnData;
  }
}

function reduceOpenTerminal(value: unknown): BitcoinOpenResult {
  if (readOwnData(value, "status") !== "completed") {
    return BITCOIN_NOT_OPENED;
  }
  const output = readOwnData(value, "output");
  if (output === missingOwnData) return BITCOIN_NOT_OPENED;
  return readOwnData(output, "appOpened") === true
    ? BITCOIN_OPENED
    : BITCOIN_NOT_OPENED;
}

function failedOpenHandle(): BitcoinOpenHandle {
  return Object.freeze({
    result: Promise.resolve(BITCOIN_NOT_OPENED),
    cancel: () => undefined,
  });
}

/**
 * Make one best-effort fixed Bitcoin open attempt.
 *
 * Open evidence is deliberately non-authoritative: every unreviewed terminal
 * becomes `appOpened: false` so later orchestration preserves the separately
 * proven installation disposition and continues to release/handoff.
 */
export function openBitcoin(
  session: OwnedDmkSession,
  options: OpenBitcoinOptions = {},
): BitcoinOpenHandle {
  const eventMapper = createPendingEventMapper(PHASE, "open-bitcoin");
  let run: ReturnType<OwnedDmkSession["dispatchBitcoinOpen"]>;
  try {
    run = session.dispatchBitcoinOpen({
      onPending: (pending) => {
        const event = eventMapper.map({
          interaction: pending.interaction,
          unitProgress: pending.progress,
        });
        if (event) options.onEvent?.(event);
      },
    });
  } catch {
    return failedOpenHandle();
  }

  let resolveResult!: (value: BitcoinOpenResult) => void;
  let settled = false;
  let cancelRequested = false;
  const result = new Promise<BitcoinOpenResult>((resolve) => {
    resolveResult = resolve;
  });
  const settle = (value: BitcoinOpenResult): void => {
    if (settled) return;
    settled = true;
    resolveResult(value);
  };
  try {
    void Promise.resolve(run.result).then(
      (terminal) => settle(reduceOpenTerminal(terminal)),
      () => settle(BITCOIN_NOT_OPENED),
    );
  } catch {
    settle(BITCOIN_NOT_OPENED);
  }

  return Object.freeze({
    result,
    cancel: () => {
      if (cancelRequested) return;
      cancelRequested = true;
      settle(BITCOIN_NOT_OPENED);
      try {
        run.cancel();
      } catch {
        // Open cancellation cannot rewrite proven installation truth.
      }
    },
  });
}
