import type { BitcoinInstallerPhase } from "./events";

/** Finite, stable, redacted error codes from the reviewed v0.1 contract. */
export type BitcoinInstallerErrorCode =
  | "unsupported-environment"
  | "permission-denied"
  | "no-device-selected"
  | "device-busy"
  | "device-disconnected"
  | "device-locked"
  | "device-not-onboarded"
  | "device-not-genuine"
  | "unsupported-device"
  | "unsupported-firmware"
  | "user-refused"
  | "bitcoin-app-unsupported"
  | "insufficient-space"
  | "network-unavailable"
  | "ledger-service-unavailable"
  | "secure-channel-failed"
  | "operation-timeout"
  | "cancelled"
  | "state-unknown"
  | "internal";

const ERROR_MESSAGES: Readonly<Record<BitcoinInstallerErrorCode, string>> = {
  "unsupported-environment": "This environment is not supported.",
  "permission-denied": "Device permission was denied.",
  "no-device-selected": "No usable device was selected.",
  "device-busy": "The device is currently unavailable.",
  "device-disconnected": "The device was disconnected.",
  "device-locked": "The device must be unlocked.",
  "device-not-onboarded": "The device is not ready for this operation.",
  "device-not-genuine": "The device did not pass the genuine check.",
  "unsupported-device": "This device is not supported.",
  "unsupported-firmware": "This device firmware is not supported.",
  "user-refused": "The operation was refused on the device.",
  "bitcoin-app-unsupported": "The Bitcoin app is not supported.",
  "insufficient-space": "The device does not have enough available space.",
  "network-unavailable": "The network is unavailable.",
  "ledger-service-unavailable": "The Ledger service is unavailable.",
  "secure-channel-failed": "The secure connection could not be completed.",
  "operation-timeout": "The operation timed out.",
  cancelled: "The operation was cancelled.",
  "state-unknown": "The Bitcoin app state could not be verified.",
  internal: "The operation could not be completed.",
};

/**
 * A package-owned error that cannot accept or retain a vendor message/cause.
 */
export class BitcoinInstallerError extends Error {
  readonly name = "BitcoinInstallerError" as const;

  readonly code: BitcoinInstallerErrorCode;

  readonly phase: BitcoinInstallerPhase;

  readonly recoverable: boolean;

  constructor(
    code: BitcoinInstallerErrorCode,
    phase: BitcoinInstallerPhase,
    recoverable: boolean,
  ) {
    super(ERROR_MESSAGES[code]);
    this.code = code;
    this.phase = phase;
    this.recoverable = recoverable;
  }
}
