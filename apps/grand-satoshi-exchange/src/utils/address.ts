/**
 * Grand Satoshi Exchange - Address Derivation Utilities
 *
 * Utilities for deriving multisig addresses from wallet configuration.
 * Uses Caravan's braid model for proper multisig address derivation.
 */

import {
  Network,
  ExtendedPublicKey,
  generateBraid,
  deriveMultisigByIndex,
} from "@caravan/bitcoin";
import type { MultisigWalletConfig } from "@caravan/multisig";
import type { AddressSlice, AddressDerivationParams } from "@/types/wallet";

/**
 * Convert wallet config xpubs to rich ExtendedPublicKey objects
 * This is required for the braid model to work correctly
 */
function createRichExtendedPublicKeys(
  config: MultisigWalletConfig,
): ExtendedPublicKey[] {
  return config.extendedPublicKeys.map((xpubConfig) => {
    const extendedPublicKey = ExtendedPublicKey.fromBase58(xpubConfig.xpub);

    // Set root fingerprint
    if (xpubConfig.xfp && !xpubConfig.xfp.toLowerCase().includes("unknown")) {
      extendedPublicKey.setRootFingerprint(xpubConfig.xfp);
    } else {
      extendedPublicKey.setRootFingerprint("00000000");
    }

    // Set BIP32 path - this is critical for braid derivation!
    if (
      xpubConfig.bip32Path &&
      !xpubConfig.bip32Path.toLowerCase().includes("unknown")
    ) {
      extendedPublicKey.setBip32Path(xpubConfig.bip32Path);
    } else {
      // Fallback to depth-based path
      const depth = extendedPublicKey.depth ?? 0;
      extendedPublicKey.setBip32Path(`m${"/0".repeat(depth)}`);
    }

    extendedPublicKey.addBase58String();
    return extendedPublicKey;
  });
}

/**
 * Derive a single multisig address from wallet config using braid model
 *
 * @param params - Address derivation parameters
 * @returns Derived address slice
 */
export function deriveAddress(params: AddressDerivationParams): AddressSlice {
  const { config, network, change, index } = params;

  // Create rich ExtendedPublicKey objects with path metadata
  const richXpubs = createRichExtendedPublicKeys(config);

  // Create a braid for this branch (0 = receiving, 1 = change)
  const braid = generateBraid(
    network,
    config.addressType,
    richXpubs,
    config.quorum.requiredSigners,
    change.toString(), // "0" or "1"
  );

  // Derive multisig at this index using braid
  const multisig = deriveMultisigByIndex(braid, index);

  if (!multisig || !multisig.address) {
    throw new Error(`Failed to derive address at ${change}/${index}`);
  }

  // Build full derivation path from first xpub's base path
  const basePath = config.extendedPublicKeys[0].bip32Path;
  const fullPath = basePath
    ? `${basePath}/${change}/${index}`
    : `${change}/${index}`;

  return {
    address: multisig.address,
    path: fullPath,
    bip32Path: [change, index],
    change,
    index,
    balance: 0,
    utxoCount: 0,
    used: false,
    totalReceived: 0,
  };
}

/**
 * Derive multiple addresses in a range
 *
 * @param config - Wallet configuration
 * @param network - Bitcoin network
 * @param change - Change index (0 = receiving, 1 = change)
 * @param startIndex - Starting address index
 * @param count - Number of addresses to derive
 * @returns Array of address slices
 */
export function deriveAddressRange(
  config: MultisigWalletConfig,
  network: Network,
  change: 0 | 1,
  startIndex: number,
  count: number,
): AddressSlice[] {
  const addresses: AddressSlice[] = [];

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const address = deriveAddress({
      config,
      network,
      change,
      index,
    });
    addresses.push(address);
  }

  return addresses;
}

/**
 * Derive initial address set for wallet
 * Derives addresses for both receiving and change branches
 * Uses a larger initial set to catch wallets with many used addresses
 *
 * @param config - Wallet configuration
 * @param network - Bitcoin network
 * @returns Array of address slices
 */
export function deriveInitialAddresses(
  config: MultisigWalletConfig,
  network: Network,
): AddressSlice[] {
  // Derive more addresses initially to catch wallets with many transactions
  // Standard BIP44 gap limit is 20, but we use 100 to be safe
  const INITIAL_DERIVATION = 100;

  console.log(
    `[Address] Deriving initial ${INITIAL_DERIVATION} addresses per branch (receiving + change)`,
  );
  console.log(`[Address] 📋 Wallet Config:`, {
    addressType: config.addressType,
    network: network,
    quorum: config.quorum,
    xpubCount: config.extendedPublicKeys.length,
    firstXpubPath: config.extendedPublicKeys[0]?.bip32Path,
  });

  const receivingAddresses = deriveAddressRange(
    config,
    network,
    0, // receiving
    0,
    INITIAL_DERIVATION,
  );

  const changeAddresses = deriveAddressRange(
    config,
    network,
    1, // change
    0,
    INITIAL_DERIVATION,
  );

  console.log(
    `[Address] Derived ${receivingAddresses.length} receiving addresses`,
  );
  console.log(`[Address] 🔍 Sample receiving addresses:`, {
    "0/0": receivingAddresses[0]?.address,
    "0/1": receivingAddresses[1]?.address,
    "0/2": receivingAddresses[2]?.address,
    "0/6": receivingAddresses[6]?.address,
  });

  console.log(`[Address] Derived ${changeAddresses.length} change addresses`);
  console.log(`[Address] 🔍 Sample change addresses:`, {
    "1/0": changeAddresses[0]?.address,
    "1/1": changeAddresses[1]?.address,
    "1/2": changeAddresses[2]?.address,
  });

  console.log(
    `[Address] Total addresses: ${receivingAddresses.length + changeAddresses.length}`,
  );

  return [...receivingAddresses, ...changeAddresses];
}

/**
 * Find the next unused address in a branch
 *
 * @param addresses - Array of address slices
 * @param change - Change index (0 = receiving, 1 = change)
 * @returns Next unused address or undefined
 */
export function findNextUnusedAddress(
  addresses: AddressSlice[],
  change: 0 | 1,
): AddressSlice | undefined {
  return addresses
    .filter((addr) => addr.change === change)
    .sort((a, b) => a.index - b.index)
    .find((addr) => !addr.used);
}

/**
 * Get the highest used address index in a branch
 * Returns -1 if no addresses have been used
 *
 * @param addresses - Array of address slices
 * @param change - Change index (0 = receiving, 1 = change)
 * @returns Highest used index or -1
 */
export function getHighestUsedIndex(
  addresses: AddressSlice[],
  change: 0 | 1,
): number {
  const usedAddresses = addresses
    .filter((addr) => addr.change === change && addr.used)
    .sort((a, b) => b.index - a.index);

  return usedAddresses.length > 0 ? usedAddresses[0].index : -1;
}

/**
 * Check if we need to derive more addresses (gap limit check)
 *
 * @param addresses - Array of address slices
 * @param change - Change index (0 = receiving, 1 = change)
 * @param gapLimit - Gap limit (default: 20)
 * @returns True if more addresses should be derived
 */
export function shouldDeriveMoreAddresses(
  addresses: AddressSlice[],
  change: 0 | 1,
  gapLimit: number = 20,
): boolean {
  const branchAddresses = addresses.filter((addr) => addr.change === change);
  const highestIndex = Math.max(
    ...branchAddresses.map((addr) => addr.index),
    -1,
  );
  const highestUsedIndex = getHighestUsedIndex(addresses, change);

  // If we have fewer than gapLimit unused addresses after the highest used
  const unusedCount = highestIndex - highestUsedIndex;
  return unusedCount < gapLimit;
}

/**
 * Create a lookup map for addresses
 *
 * @param addresses - Array of address slices
 * @returns Map of address string to AddressSlice
 */
export function createAddressMap(
  addresses: AddressSlice[],
): Map<string, AddressSlice> {
  const map = new Map<string, AddressSlice>();
  addresses.forEach((addr) => {
    map.set(addr.address, addr);
  });
  return map;
}
