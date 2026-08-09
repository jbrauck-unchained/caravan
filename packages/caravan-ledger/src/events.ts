/** Public lifecycle phases for one Bitcoin app installer instance. */
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

/** Finite, package-owned user interactions. Vendor text never crosses here. */
export type BitcoinInstallerInteraction =
  | "select-device"
  | "unlock-device"
  | "allow-secure-connection"
  | "confirm-install"
  | "confirm-open-bitcoin";

/** A redacted lifecycle update emitted by the installer. */
export interface BitcoinInstallerEvent {
  readonly phase: BitcoinInstallerPhase;
  readonly interaction?: BitcoinInstallerInteraction;
  /** An integer from 0 through 100, present only when meaningful. */
  readonly progress?: number;
}
