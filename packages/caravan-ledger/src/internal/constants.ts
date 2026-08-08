/**
 * Closed Ledger service configuration reviewed from the pinned SDK defaults.
 *
 * This records technical configuration only. It is deliberately marked
 * unapproved until the authorization and physical-evidence release gates are
 * complete. Constructing the runtime does not contact these services.
 */
export interface InternalDmkServiceConfig {
  readonly managerApiUrl: string;
  readonly webSocketUrl: string;
  readonly provider: number;
  readonly authorization: "unapproved";
}

export const UNAPPROVED_PRODUCTION_DMK_CONFIG: InternalDmkServiceConfig =
  Object.freeze({
    managerApiUrl: "https://manager.api.live.ledger.com/api",
    webSocketUrl: "wss://scriptrunner.api.live.ledger.com/update",
    provider: 1,
    authorization: "unapproved",
  });

export const DISABLED_SESSION_REFRESHER_OPTIONS = Object.freeze({
  isRefresherDisabled: true as const,
});

/** Explicitly reviewed against the pinned DMK 1.7.1 read-only actions. */
export const REVIEWED_READ_ONLY_UNLOCK_TIMEOUT_MS = 60_000;

export function assertValidInternalDmkServiceConfig(
  config: InternalDmkServiceConfig,
): void {
  if (!Number.isSafeInteger(config.provider) || config.provider <= 0) {
    throw new TypeError("The Ledger provider must be a positive integer.");
  }
  if (config.authorization !== "unapproved") {
    throw new TypeError("The Ledger service authorization marker is invalid.");
  }
  if (!config.managerApiUrl || !config.webSocketUrl) {
    throw new TypeError("The Ledger service endpoints must be present.");
  }
}

export function sameInternalDmkServiceConfig(
  left: InternalDmkServiceConfig,
  right: InternalDmkServiceConfig,
): boolean {
  return (
    left.managerApiUrl === right.managerApiUrl &&
    left.webSocketUrl === right.webSocketUrl &&
    left.provider === right.provider &&
    left.authorization === right.authorization
  );
}

/** Release tooling must continue to fail until authorization is recorded. */
export function assertProductionDmkConfigurationApproved(): never {
  throw new Error(
    "Ledger DMK production service configuration is not approved for release.",
  );
}
