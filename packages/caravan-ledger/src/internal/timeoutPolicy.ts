import {
  BitcoinInstallerError,
  type BitcoinInstallerErrorCode,
} from "../errors";
import type {
  BitcoinInstallerPhase,
  BitcoinInstallerPhase as PublicPhase,
} from "../events";

import { readReviewedErrorTag } from "./sanitize";

export const INSTALL_FAILURE_STAGES = [
  "discovery",
  "connect",
  "genuine",
  "inspect",
  "install-dispatched",
  "verify",
  "open",
  "release",
] as const;

export type InstallFailureStage = (typeof INSTALL_FAILURE_STAGES)[number];

type MutationMarker = "not-attempted" | "attempted";

export type InstallFailureBoundary =
  | "safe-pre-mutation"
  | "native-install-started"
  | "mutation-state-unknown"
  | "verification-unproven"
  | "open-non-authoritative"
  | "release-unproven";

/**
 * The complete stage x mutation-marker policy. Impossible combinations are
 * intentionally conservative instead of being omitted from the table.
 */
export const INSTALL_FAILURE_BOUNDARY_TABLE = Object.freeze({
  discovery: Object.freeze({
    "not-attempted": "safe-pre-mutation",
    attempted: "mutation-state-unknown",
  }),
  connect: Object.freeze({
    "not-attempted": "safe-pre-mutation",
    attempted: "mutation-state-unknown",
  }),
  genuine: Object.freeze({
    "not-attempted": "safe-pre-mutation",
    attempted: "mutation-state-unknown",
  }),
  inspect: Object.freeze({
    "not-attempted": "safe-pre-mutation",
    attempted: "mutation-state-unknown",
  }),
  "install-dispatched": Object.freeze({
    "not-attempted": "native-install-started",
    attempted: "mutation-state-unknown",
  }),
  verify: Object.freeze({
    "not-attempted": "verification-unproven",
    attempted: "mutation-state-unknown",
  }),
  open: Object.freeze({
    "not-attempted": "open-non-authoritative",
    attempted: "open-non-authoritative",
  }),
  release: Object.freeze({
    "not-attempted": "release-unproven",
    attempted: "release-unproven",
  }),
}) satisfies Readonly<
  Record<
    InstallFailureStage,
    Readonly<Record<MutationMarker, InstallFailureBoundary>>
  >
>;

export type InstallFailureTrigger =
  | { readonly kind: "cancelled" }
  | { readonly kind: "timeout" }
  | { readonly kind: "vendor-error"; readonly error: unknown };

export interface InstallFailureInput {
  readonly stage: InstallFailureStage;
  /** The synchronous package-owned marker, never progress or phase alone. */
  readonly mutationAttempted: boolean;
  readonly trigger: InstallFailureTrigger;
}

type FailureTerminalPhase = Extract<
  PublicPhase,
  "cancelled" | "failed" | "needs-recovery"
>;

export type InstallRecoveryGuidance = "insufficient-space";

export type InstallFailureDecision =
  | {
      readonly kind: "reject";
      readonly terminalPhase: FailureTerminalPhase;
      readonly error: BitcoinInstallerError;
      /** Guidance only; it is not evidence of the final device state. */
      readonly recoveryGuidance?: InstallRecoveryGuidance;
    }
  | { readonly kind: "fresh-inspection-required" }
  | { readonly kind: "continue-to-release"; readonly appOpen: false }
  | { readonly kind: "handoff-reconnect-required" };

interface SafeErrorDescription {
  readonly code: BitcoinInstallerErrorCode;
  readonly recoverable: boolean;
}

const PRE_MUTATION_VENDOR_ERRORS = Object.freeze({
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
  ConnectionOpeningError: { code: "device-busy", recoverable: true },
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
  SecureChannelError: { code: "secure-channel-failed", recoverable: true },
  SendApduTimeoutError: { code: "operation-timeout", recoverable: true },
  SendCommandTimeoutError: {
    code: "operation-timeout",
    recoverable: true,
  },
  // The pinned install action uses this for several unreviewed failures,
  // including missing catalog evidence. Its message is never inspected.
  UnknownDAError: { code: "internal", recoverable: false },
}) satisfies Readonly<Record<string, SafeErrorDescription>>;

const APP_ALREADY_INSTALLED_TAG = "AppAlreadyInstalledDAError" as const;
const OUT_OF_MEMORY_TAG = "OutOfMemoryDAError" as const;

type ReviewedInstallVendorTag =
  | keyof typeof PRE_MUTATION_VENDOR_ERRORS
  | typeof APP_ALREADY_INSTALLED_TAG
  | typeof OUT_OF_MEMORY_TAG;

export interface InstallFailureDiagnostic {
  readonly stage: InstallFailureStage;
  readonly mutationAttempted: boolean;
  readonly boundary: InstallFailureBoundary;
  readonly trigger: InstallFailureTrigger["kind"];
  /** Only a finite reviewed tag is retained; arbitrary vendor text is not. */
  readonly reviewedVendorTag?: ReviewedInstallVendorTag;
}

const failureDiagnostics = new WeakMap<
  InstallFailureDecision,
  InstallFailureDiagnostic
>();

const PHASE_BY_STAGE = Object.freeze({
  discovery: "selecting-device",
  connect: "connecting",
  genuine: "checking-genuine",
  inspect: "checking-bitcoin-app",
  "install-dispatched": "installing",
  verify: "verifying",
  open: "opening-bitcoin",
  release: "releasing-device",
}) satisfies Readonly<Record<InstallFailureStage, BitcoinInstallerPhase>>;

function markerKey(mutationAttempted: boolean): MutationMarker {
  return mutationAttempted ? "attempted" : "not-attempted";
}

function readReviewedInstallVendorTag(
  trigger: InstallFailureTrigger,
): ReviewedInstallVendorTag | undefined {
  if (trigger.kind !== "vendor-error") return undefined;
  const tag = readReviewedErrorTag(trigger.error);
  if (tag === APP_ALREADY_INSTALLED_TAG || tag === OUT_OF_MEMORY_TAG) {
    return tag;
  }
  return tag && Object.prototype.hasOwnProperty.call(PRE_MUTATION_VENDOR_ERRORS, tag)
    ? (tag as keyof typeof PRE_MUTATION_VENDOR_ERRORS)
    : undefined;
}

function reject(
  terminalPhase: FailureTerminalPhase,
  stage: InstallFailureStage,
  description: SafeErrorDescription,
  recoveryGuidance?: InstallRecoveryGuidance,
): InstallFailureDecision {
  const decision: {
    kind: "reject";
    terminalPhase: FailureTerminalPhase;
    error: BitcoinInstallerError;
    recoveryGuidance?: InstallRecoveryGuidance;
  } = {
    kind: "reject",
    terminalPhase,
    error: new BitcoinInstallerError(
      description.code,
      PHASE_BY_STAGE[stage],
      description.recoverable,
    ),
  };
  if (recoveryGuidance !== undefined) {
    decision.recoveryGuidance = recoveryGuidance;
  }
  return Object.freeze(decision);
}

function rememberDiagnostic(
  decision: InstallFailureDecision,
  input: InstallFailureInput,
  boundary: InstallFailureBoundary,
  reviewedVendorTag: ReviewedInstallVendorTag | undefined,
): InstallFailureDecision {
  const diagnostic: {
    stage: InstallFailureStage;
    mutationAttempted: boolean;
    boundary: InstallFailureBoundary;
    trigger: InstallFailureTrigger["kind"];
    reviewedVendorTag?: ReviewedInstallVendorTag;
  } = {
    stage: input.stage,
    mutationAttempted: input.mutationAttempted,
    boundary,
    trigger: input.trigger.kind,
  };
  if (reviewedVendorTag !== undefined) {
    diagnostic.reviewedVendorTag = reviewedVendorTag;
  }
  failureDiagnostics.set(decision, Object.freeze(diagnostic));
  return decision;
}

/**
 * Classify one non-success signal without retaining a raw vendor object.
 * Numeric watchdog durations deliberately live elsewhere until physical QA;
 * any timeout supplied here is only evidence that the watchdog fired.
 */
export function classifyInstallFailure(
  input: InstallFailureInput,
): InstallFailureDecision {
  const boundary =
    INSTALL_FAILURE_BOUNDARY_TABLE[input.stage][
      markerKey(input.mutationAttempted)
    ];
  const reviewedVendorTag = readReviewedInstallVendorTag(input.trigger);

  if (boundary === "open-non-authoritative") {
    return rememberDiagnostic(
      Object.freeze({ kind: "continue-to-release", appOpen: false }),
      input,
      boundary,
      reviewedVendorTag,
    );
  }
  if (boundary === "release-unproven") {
    return rememberDiagnostic(
      Object.freeze({ kind: "handoff-reconnect-required" }),
      input,
      boundary,
      reviewedVendorTag,
    );
  }

  if (
    input.stage === "install-dispatched" &&
    reviewedVendorTag === APP_ALREADY_INSTALLED_TAG
  ) {
    return rememberDiagnostic(
      Object.freeze({ kind: "fresh-inspection-required" }),
      input,
      boundary,
      reviewedVendorTag,
    );
  }

  if (
    input.stage === "install-dispatched" &&
    reviewedVendorTag === OUT_OF_MEMORY_TAG
  ) {
    return rememberDiagnostic(
      reject(
        "needs-recovery",
        input.stage,
        { code: "insufficient-space", recoverable: true },
        "insufficient-space",
      ),
      input,
      boundary,
      reviewedVendorTag,
    );
  }

  if (
    boundary === "mutation-state-unknown" ||
    boundary === "verification-unproven" ||
    boundary === "native-install-started"
  ) {
    return rememberDiagnostic(
      reject("needs-recovery", input.stage, {
        code: "state-unknown",
        recoverable: true,
      }),
      input,
      boundary,
      reviewedVendorTag,
    );
  }

  let terminalPhase: FailureTerminalPhase = "failed";
  let description: SafeErrorDescription;
  switch (input.trigger.kind) {
    case "cancelled":
      terminalPhase = "cancelled";
      description = { code: "cancelled", recoverable: true };
      break;
    case "timeout":
      description = { code: "operation-timeout", recoverable: true };
      break;
    case "vendor-error":
      description = reviewedVendorTag
        ? (PRE_MUTATION_VENDOR_ERRORS[
            reviewedVendorTag as keyof typeof PRE_MUTATION_VENDOR_ERRORS
          ] ?? { code: "internal", recoverable: false })
        : { code: "internal", recoverable: false };
      break;
  }

  return rememberDiagnostic(
    reject(terminalPhase, input.stage, description),
    input,
    boundary,
    reviewedVendorTag,
  );
}

/** Internal-only diagnostics; no raw error or arbitrary tag is retained. */
export function readInstallFailureDiagnostic(
  decision: InstallFailureDecision,
): InstallFailureDiagnostic | undefined {
  return failureDiagnostics.get(decision);
}

export type InstallActionEvidence =
  | { readonly kind: "progress"; readonly progress: unknown }
  | { readonly kind: "completed" };

export type InstallActionEvidenceDecision =
  | { readonly kind: "await-terminal" }
  | { readonly kind: "fresh-inspection-required" };

/** Progress, including 100, never proves success; completion still requires list. */
export function classifyInstallActionEvidence(
  evidence: InstallActionEvidence,
): InstallActionEvidenceDecision {
  return evidence.kind === "completed"
    ? Object.freeze({ kind: "fresh-inspection-required" })
    : Object.freeze({ kind: "await-terminal" });
}
