import {
  BitcoinInstallerError,
  createBitcoinAppInstaller,
  getBitcoinInstallerSupport,
} from "@caravan/ledger";
import type {
  BitcoinAppInstaller,
  BitcoinInstallPlan,
  BitcoinInstallResult,
  BitcoinInstallerErrorCode,
  BitcoinInstallerEvent,
  BitcoinInstallerInteraction,
  BitcoinInstallerPhase,
  BitcoinInstallerSupport,
} from "@caravan/ledger";

export const supportAtImport: BitcoinInstallerSupport =
  getBitcoinInstallerSupport();

export const installerAtImport: BitcoinAppInstaller =
  createBitcoinAppInstaller();

export function makeInstaller(): BitcoinAppInstaller {
  return createBitcoinAppInstaller();
}

export function readSupport(): BitcoinInstallerSupport {
  return getBitcoinInstallerSupport();
}

export function makeSafeError(): BitcoinInstallerError {
  const code: BitcoinInstallerErrorCode = "unsupported-environment";
  const phase: BitcoinInstallerPhase = "idle";
  return new BitcoinInstallerError(code, phase, false);
}

export function exercisePublicTypes(
  installer: BitcoinAppInstaller,
  plan: BitcoinInstallPlan,
  interaction: BitcoinInstallerInteraction,
): readonly [Promise<BitcoinInstallResult>, BitcoinInstallerEvent] {
  return [installer.install(plan), { phase: "ready-to-install", interaction }];
}
