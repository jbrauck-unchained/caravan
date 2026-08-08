import {
  BitcoinInstallerError,
  createBitcoinAppInstaller,
  getBitcoinInstallerSupport,
} from "@caravan/ledger";

export const supportAtImport = getBitcoinInstallerSupport();
export const installerAtImport = createBitcoinAppInstaller();

export function makeInstaller() {
  return createBitcoinAppInstaller();
}

export function readSupport() {
  return getBitcoinInstallerSupport();
}

export function makeSafeError() {
  return new BitcoinInstallerError("unsupported-environment", "idle", false);
}
