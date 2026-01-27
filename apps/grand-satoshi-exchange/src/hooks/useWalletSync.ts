/**
 * Grand Satoshi Exchange - Wallet Sync Hook
 *
 * React Query hook for fetching UTXOs from blockchain.
 * Matches Coordinator's approach of fetching full address data.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { BlockchainClient } from "@caravan/clients";
import type { UTXO, AddressSlice } from "@/types/wallet";
import { useClientStore } from "@/stores/clientStore";
import {
  useWalletStore,
  useAddresses,
  useHasWallet,
} from "@/stores/walletStore";

/**
 * Delay between batch requests (milliseconds)
 */
const BATCH_DELAY = 100;

/**
 * Batch size for address requests
 */
const BATCH_SIZE = 10;

/**
 * Fetch full address data including UTXOs
 * This calls /api/address/{address} which returns comprehensive address info
 */
async function fetchAddressData(
  client: BlockchainClient,
  address: string,
): Promise<UTXO[]> {
  try {
    console.log(`[Sync] Fetching address data for: ${address}`);

    // This calls /api/address/{address} endpoint
    // Returns: { chain_stats: {...}, mempool_stats: {...}, ... }
    const addressData: any = await (client as any).Get(`/address/${address}`);
    console.log(`[Sync] Address data for ${address}:`, addressData);

    // Now fetch UTXOs specifically
    const utxos = await client.getAddressUtxos(address);
    console.log(`[Sync] UTXOs for ${address}:`, utxos);

    if (!Array.isArray(utxos)) {
      console.error(`[Sync] Expected array, got:`, typeof utxos, utxos);
      return [];
    }

    // Map UTXOs to our format
    // Note: Bitcoin Core returns 'index' instead of 'vout', and 'amountSats' instead of 'value'
    // Public explorers use 'vout' and 'value'
    const mapped = utxos.map((utxo: any) => {
      console.log(`[Sync] Processing UTXO:`, utxo);
      return {
        txid: utxo.txid,
        vout: utxo.vout ?? utxo.index, // Bitcoin Core uses 'index'
        value:
          utxo.value ?? (utxo.amountSats ? parseInt(utxo.amountSats, 10) : 0), // Bitcoin Core uses 'amountSats' as string
        address,
        confirmed: utxo.confirmed ?? utxo.status?.confirmed ?? false,
        blockHeight: utxo.status?.block_height,
      };
    });

    console.log(`[Sync] ✓ Found ${mapped.length} UTXOs for ${address}`);
    return mapped;
  } catch (error) {
    console.error(`[Sync] ❌ Failed to fetch data for ${address}:`, error);
    return [];
  }
}

/**
 * Fetch UTXOs for multiple addresses in batches
 */
async function fetchAllUTXOs(
  client: BlockchainClient,
  addresses: AddressSlice[],
): Promise<UTXO[]> {
  console.log(
    `[Sync] 🚀 Starting UTXO fetch for ${addresses.length} addresses`,
  );
  console.log(
    `[Sync] First 3 addresses:`,
    addresses.slice(0, 3).map((a) => a.address),
  );
  const allUTXOs: UTXO[] = [];

  // Process addresses in batches
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(addresses.length / BATCH_SIZE);

    console.log(
      `[Sync] 📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} addresses)`,
    );

    // Fetch data for batch in parallel
    const batchUTXOs = await Promise.all(
      batch.map((addr) => fetchAddressData(client, addr.address)),
    );

    // Flatten results
    const flattened = batchUTXOs.flat();
    console.log(
      `[Sync] ✓ Batch ${batchNum} returned ${flattened.length} UTXOs`,
    );
    allUTXOs.push(...flattened);

    // Delay before next batch
    if (i + BATCH_SIZE < addresses.length) {
      console.log(`[Sync] ⏳ Waiting ${BATCH_DELAY}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
    }
  }

  console.log(`[Sync] 🎉 COMPLETED! Total UTXOs found: ${allUTXOs.length}`);
  if (allUTXOs.length > 0) {
    console.log(`[Sync] Sample UTXO:`, allUTXOs[0]);
    console.log(
      `[Sync] Total value:`,
      allUTXOs.reduce((sum, u) => sum + u.value, 0),
      "sats",
    );
  } else {
    console.warn(
      `[Sync] ⚠️ No UTXOs found across ${addresses.length} addresses`,
    );
  }

  return allUTXOs;
}

/**
 * Hook to sync wallet UTXOs
 */
export function useWalletSync() {
  const queryClient = useQueryClient();
  const hasWallet = useHasWallet();
  const addresses = useAddresses();
  const client = useClientStore((state) => state.client);
  const network = useClientStore((state) => state.network);
  const clientType = useClientStore((state) => state.clientType);
  const { setUTXOs, setSyncing } = useWalletStore();

  // Query for fetching UTXOs
  const {
    data: utxos,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      "wallet-utxos",
      network,
      addresses
        .map((a) => a.address)
        .sort()
        .join(","),
    ],
    queryFn: async () => {
      console.log(`[Sync] 🔄 QUERY STARTED`);
      console.log(`[Sync] Network: ${network}`);
      console.log(`[Sync] Client type: ${clientType}`);
      console.log(`[Sync] Client available:`, !!client);
      console.log(`[Sync] Address count:`, addresses.length);

      if (!client) {
        console.error("[Sync] ❌ No client available!");
        throw new Error("Blockchain client not initialized");
      }

      return fetchAllUTXOs(client, addresses);
    },
    enabled: hasWallet && !!client && addresses.length > 0,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  console.log(`[Sync] 📊 Hook state:`, {
    hasWallet,
    hasClient: !!client,
    network,
    clientType,
    addressCount: addresses.length,
    isLoading,
    utxoCount: utxos?.length ?? 0,
    error: error?.message,
  });

  // Update wallet store when UTXOs change
  useEffect(() => {
    if (utxos !== undefined) {
      console.log(`[Sync] 💾 Updating wallet store with ${utxos.length} UTXOs`);
      setUTXOs(utxos);
      setSyncing(false);
    }
  }, [utxos, setUTXOs, setSyncing]);

  // Update syncing state
  useEffect(() => {
    setSyncing(isLoading);
  }, [isLoading, setSyncing]);

  return {
    isSyncing: isLoading,
    error: error instanceof Error ? error.message : null,
    sync: () => {
      console.log("[Sync] 🔄 Manual sync triggered by user");
      setSyncing(true);
      refetch();
    },
    clearCache: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-utxos"] });
    },
  };
}

/**
 * Hook to manually sync wallet
 */
export function useManualSync() {
  const { sync, isSyncing } = useWalletSync();
  return { sync, isSyncing };
}

/**
 * Hook to get sync status
 */
export function useSyncStatus() {
  const wallet = useWalletStore((state) => state.wallet);

  return {
    isSyncing: wallet?.isSyncing ?? false,
    lastSynced: wallet?.lastSynced,
    lastSyncedAgo: wallet?.lastSynced ? Date.now() - wallet.lastSynced : null,
  };
}
