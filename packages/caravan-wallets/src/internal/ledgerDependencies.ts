import LedgerBtc from "@ledgerhq/hw-app-btc";
import { getAppAndVersion } from "@ledgerhq/hw-app-btc/lib/getAppAndVersion.js";
import TransportU2F from "@ledgerhq/hw-transport-u2f";
import TransportWebUSB from "@ledgerhq/hw-transport-webusb";
import { AppClient } from "ledger-bitcoin";

export type LedgerTransport =
  | Awaited<ReturnType<typeof TransportU2F.create>>
  | Awaited<ReturnType<typeof TransportWebUSB.create>>;

export interface LedgerAppConfiguration {
  name: string;
  version: string;
  flags: number | Buffer;
}

interface LedgerDependencies {
  createU2FTransport(): Promise<LedgerTransport>;
  createWebUSBTransport(): Promise<LedgerTransport>;
  getAppConfiguration(
    transport: LedgerTransport
  ): Promise<LedgerAppConfiguration>;
  createLegacyApp(transport: LedgerTransport): LedgerBtc;
  createModernApp(transport: LedgerTransport): AppClient;
}

const defaultLedgerDependencies: LedgerDependencies = {
  createU2FTransport: () => TransportU2F.create(),
  createWebUSBTransport: () => TransportWebUSB.create(),
  getAppConfiguration: (transport) => getAppAndVersion(transport),
  createLegacyApp: (transport) => new LedgerBtc(transport),
  createModernApp: (transport) => new AppClient(transport),
};

let ledgerDependencies = defaultLedgerDependencies;

export function getLedgerDependencies(): LedgerDependencies {
  return ledgerDependencies;
}

/**
 * Source-only dependency seam for lifecycle tests. This module is not exported
 * from the package entry point and cannot configure production consumers.
 */
export function setLedgerDependenciesForTesting(
  overrides: Partial<LedgerDependencies>
): void {
  ledgerDependencies = {
    ...defaultLedgerDependencies,
    ...overrides,
  };
}

export function resetLedgerDependenciesForTesting(): void {
  ledgerDependencies = defaultLedgerDependencies;
}
