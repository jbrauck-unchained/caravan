import type { BitcoinInstallerEvent } from "./events";

declare const bitcoinInstallPlanBrand: unique symbol;

/**
 * An in-memory capability minted by one live installer.
 *
 * The visible status is informational. Runtime validity additionally requires
 * exact object identity and private generation metadata.
 */
export interface BitcoinInstallPlan {
  readonly status: "installation-required" | "already-installed";
  readonly [bitcoinInstallPlanBrand]: never;
}

/** The independently verified Bitcoin disposition and management handoff. */
export interface BitcoinInstallResult {
  readonly status: "installed" | "already-installed";
  readonly appOpen: boolean;
  readonly handoff: "ready" | "reconnect-required";
}

/** The complete public instance contract for the v0.1 installer. */
export interface BitcoinAppInstaller {
  subscribe(listener: (event: BitcoinInstallerEvent) => void): () => void;
  prepare(): Promise<BitcoinInstallPlan>;
  install(plan: BitcoinInstallPlan): Promise<BitcoinInstallResult>;
  recover(): Promise<BitcoinInstallPlan>;
  cancel(): void;
  dispose(): Promise<void>;
}
