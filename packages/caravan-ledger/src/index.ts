import { createNeutralBitcoinAppInstaller } from "./installer";
import type { BitcoinAppInstaller } from "./types";

export { getBitcoinInstallerSupport } from "./capabilities";
export type { BitcoinInstallerSupport } from "./capabilities";

/** Construct the SDK-free Node/SSR facade exposed by this export condition. */
export function createBitcoinAppInstaller(): BitcoinAppInstaller {
  return createNeutralBitcoinAppInstaller();
}

export { BitcoinInstallerError } from "./errors";
export type { BitcoinInstallerErrorCode } from "./errors";

export type {
  BitcoinInstallerEvent,
  BitcoinInstallerInteraction,
  BitcoinInstallerPhase,
} from "./events";

export type {
  BitcoinAppInstaller,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "./types";
