import type {
  BitcoinInstallerEvent,
  BitcoinInstallerInteraction,
  BitcoinInstallerPhase,
} from "../events";

import type { DmkActionKind } from "./dmkPort";

export interface PendingEventInput {
  readonly interaction?: unknown;
  /** Secure-channel progress expressed in the reviewed unit interval. */
  readonly unitProgress?: unknown;
}

export interface PendingEventMapper {
  map(input: PendingEventInput): BitcoinInstallerEvent | undefined;
}

/** Map only reviewed interactions valid for the closed action kind. */
export function mapDmkInteraction(
  actionKind: DmkActionKind,
  interaction: unknown,
): BitcoinInstallerInteraction | undefined {
  if (interaction === "none" || interaction === undefined) return undefined;
  if (interaction === "unlock-device") return "unlock-device";
  if (
    actionKind !== "open-bitcoin" &&
    interaction === "allow-secure-connection"
  ) {
    return "allow-secure-connection";
  }
  if (actionKind === "open-bitcoin" && interaction === "confirm-open-app") {
    return "confirm-open-bitcoin";
  }
  return undefined;
}

/** Convert reviewed 0..1 progress to a clamped integer percentage. */
export function normalizeUnitProgress(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/**
 * Keep emitted progress monotonic within one action and suppress equivalent
 * events. A value of 100 remains informational and never changes phase.
 */
export function createPendingEventMapper(
  phase: BitcoinInstallerPhase,
  actionKind: DmkActionKind,
): PendingEventMapper {
  let highestProgress: number | undefined;
  let lastInteraction: BitcoinInstallerInteraction | undefined;
  let lastProgress: number | undefined;
  let emitted = false;

  return {
    map: (input) => {
      const interaction = mapDmkInteraction(actionKind, input.interaction);
      const normalized =
        actionKind === "install-bitcoin"
          ? normalizeUnitProgress(input.unitProgress)
          : undefined;
      const progress =
        normalized === undefined
          ? undefined
          : Math.max(highestProgress ?? normalized, normalized);
      if (progress !== undefined) highestProgress = progress;

      if (
        emitted &&
        interaction === lastInteraction &&
        progress === lastProgress
      ) {
        return undefined;
      }
      emitted = true;
      lastInteraction = interaction;
      lastProgress = progress;

      const event: {
        phase: BitcoinInstallerPhase;
        interaction?: BitcoinInstallerInteraction;
        progress?: number;
      } = { phase };
      if (interaction !== undefined) event.interaction = interaction;
      if (progress !== undefined) event.progress = progress;
      return event;
    },
  };
}
