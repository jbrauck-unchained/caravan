import {
  BitcoinInstallerError,
  type BitcoinInstallerErrorCode,
} from "../errors";
import type { BitcoinInstallerPhase } from "../events";

import { readReviewedErrorTag } from "./sanitize";

export type PreMutationPhase = Extract<
  BitcoinInstallerPhase,
  | "idle"
  | "selecting-device"
  | "connecting"
  | "checking-genuine"
  | "checking-bitcoin-app"
>;

interface SafeErrorDescription {
  readonly code: BitcoinInstallerErrorCode;
  readonly recoverable: boolean;
}

const PRE_MUTATION_ERRORS = {
  WebHidTransportNotSupportedError: {
    code: "unsupported-environment",
    recoverable: false,
  },
  TransportNotSupportedError: {
    code: "unsupported-environment",
    recoverable: false,
  },
  NoTransportsProvidedError: {
    code: "unsupported-environment",
    recoverable: false,
  },
  NoTransportProvidedError: {
    code: "unsupported-environment",
    recoverable: false,
  },
  NoAccessibleDeviceError: {
    code: "no-device-selected",
    recoverable: true,
  },
  DeviceAlreadyDiscoveredError: {
    code: "device-busy",
    recoverable: true,
  },
  ConnectionOpeningError: {
    code: "device-busy",
    recoverable: true,
  },
  DeviceBusyError: { code: "device-busy", recoverable: true },
  SendApduConcurrencyError: { code: "device-busy", recoverable: true },
  AlreadySendingApduError: { code: "device-busy", recoverable: true },
  DeviceDisconnectedWhileSendingError: {
    code: "device-disconnected",
    recoverable: true,
  },
  DeviceDisconnectedBeforeSendingApdu: {
    code: "device-disconnected",
    recoverable: true,
  },
  DisconnectError: { code: "device-disconnected", recoverable: true },
  ReconnectionFailedError: {
    code: "device-disconnected",
    recoverable: true,
  },
  DeviceSessionNotFound: {
    code: "device-disconnected",
    recoverable: true,
  },
  DeviceLockedError: { code: "device-locked", recoverable: true },
  DeviceNotOnboardedError: {
    code: "device-not-onboarded",
    recoverable: false,
  },
  DeviceNotRecognizedError: {
    code: "unsupported-device",
    recoverable: false,
  },
  UnsupportedFirmwareDAError: {
    code: "unsupported-firmware",
    recoverable: false,
  },
  ActionRefusedError: { code: "user-refused", recoverable: true },
  RefusedByUserDAError: { code: "user-refused", recoverable: true },
  NetworkDAError: { code: "network-unavailable", recoverable: true },
  FetchError: { code: "network-unavailable", recoverable: true },
  WebSocketConnectionError: {
    code: "ledger-service-unavailable",
    recoverable: true,
  },
  SecureChannelError: {
    code: "secure-channel-failed",
    recoverable: true,
  },
  SendApduTimeoutError: { code: "operation-timeout", recoverable: true },
  SendCommandTimeoutError: {
    code: "operation-timeout",
    recoverable: true,
  },
} as const;

function describePreMutationError(error: unknown): SafeErrorDescription {
  const tag = readReviewedErrorTag(error);
  if (!tag || !Object.prototype.hasOwnProperty.call(PRE_MUTATION_ERRORS, tag)) {
    return { code: "internal", recoverable: false };
  }
  return PRE_MUTATION_ERRORS[
    tag as keyof typeof PRE_MUTATION_ERRORS
  ] as SafeErrorDescription;
}

/**
 * Normalize only failures known to occur before mutation dispatch. Phase 4
 * owns install-stage ambiguity and must not call this mapper after dispatch.
 */
export function mapPreMutationError(
  error: unknown,
  phase: PreMutationPhase,
): BitcoinInstallerError {
  const description = describePreMutationError(error);
  return new BitcoinInstallerError(
    description.code,
    phase,
    description.recoverable,
  );
}
