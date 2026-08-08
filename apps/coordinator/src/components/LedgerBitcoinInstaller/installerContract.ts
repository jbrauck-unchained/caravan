/**
 * Coordinator-local contract for the inert Ledger installer preview.
 *
 * This describes the UI boundary only. It contains no device transport,
 * Ledger SDK, network client, or production authority.
 */

export type BitcoinInstallerPhase =
  | "idle"
  | "selecting-device"
  | "connecting"
  | "checking-genuine"
  | "checking-bitcoin-app"
  | "ready-to-install"
  | "installing"
  | "verifying"
  | "opening-bitcoin"
  | "releasing-device"
  | "ready-for-webusb"
  | "needs-recovery"
  | "cancelled"
  | "failed"
  | "disposed";

export type BitcoinInstallerInteraction =
  | "select-device"
  | "unlock-device"
  | "allow-secure-connection"
  | "confirm-install"
  | "confirm-open-bitcoin";

export interface BitcoinInstallerEvent {
  readonly phase: BitcoinInstallerPhase;
  readonly interaction?: BitcoinInstallerInteraction;
  readonly progress?: number;
}

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

declare const bitcoinInstallPlanBrand: unique symbol;

export interface BitcoinInstallPlan {
  readonly status: "installation-required" | "already-installed";
  readonly [bitcoinInstallPlanBrand]: never;
}

export interface BitcoinInstallResult {
  readonly status: "installed" | "already-installed";
  readonly appOpen: boolean;
  readonly handoff: "ready" | "reconnect-required";
}

export interface BitcoinAppInstaller {
  subscribe(listener: (event: BitcoinInstallerEvent) => void): () => void;
  prepare(): Promise<BitcoinInstallPlan>;
  install(plan: BitcoinInstallPlan): Promise<BitcoinInstallResult>;
  recover(): Promise<BitcoinInstallPlan>;
  cancel(): void;
  dispose(): Promise<void>;
}
