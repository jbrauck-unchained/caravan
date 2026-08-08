import type { BitcoinAppInstaller } from "@caravan/ledger";

interface LatePrepareObservation {
  readonly active: boolean;
  readonly invokedPrepare: boolean;
}

/**
 * This fixture refuses to call prepare after activation is already lost. It
 * exists to make the first-import-after-click anti-pattern visible and safe.
 */
export function observeLatePrepare(
  installer: Pick<BitcoinAppInstaller, "prepare">,
  synchronousClickTaskActive: boolean,
): LatePrepareObservation {
  const active = synchronousClickTaskActive;
  if (!active) return Object.freeze({ active, invokedPrepare: false });

  void installer.prepare().catch(() => undefined);
  return Object.freeze({ active, invokedPrepare: true });
}
