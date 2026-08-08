import { getBitcoinInstallerSupport } from "./capabilities";
import { createBitcoinAppInstallerCore } from "./installer";
import { createProductionDmkPort } from "./internal/dmkAdapter";
import type { BitcoinAppInstaller } from "./types";

export { getBitcoinInstallerSupport } from "./capabilities";
export type { BitcoinInstallerSupport } from "./capabilities";

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

/** Construct a lazy browser facade without touching DMK or browser APIs. */
export function createBitcoinAppInstaller(): BitcoinAppInstaller {
  return createBitcoinAppInstallerCore({
    createPort: createProductionDmkPort,
    getSupport: getBitcoinInstallerSupport,
  });
}
