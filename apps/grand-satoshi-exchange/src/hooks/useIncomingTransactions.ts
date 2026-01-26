/**
 * Grand Satoshi Exchange - Incoming Transaction Detector
 *
 * React hook for detecting new incoming transactions by monitoring UTXO changes.
 * Compares current UTXOs with previous UTXOs to identify new transactions.
 */

import { useEffect, useRef, useState } from "react";
import { MempoolApiClient } from "@/services/mempoolApi";
import { useTransactionStore } from "@/stores/transactionStore";
import { useWalletStore } from "@/stores/walletStore";
import { useClientStore } from "@/stores/clientStore";
import type { UTXO } from "@/types/wallet";
import type { MonitoredTransaction } from "@/types/transaction";

/**
 * Return value from useIncomingTransactions hook
 */
export interface UseIncomingTransactionsReturn {
  /** Newly detected transactions (since last check) */
  newTransactions: MonitoredTransaction[];
  /** Whether currently checking for new transactions */
  isChecking: boolean;
  /** Error message if detection failed */
  error: string | null;
}

/**
 * Create a unique key for a UTXO
 */
function getUtxoKey(utxo: UTXO): string {
  return `${utxo.txid}:${utxo.vout}`;
}

/**
 * Group UTXOs by transaction ID
 */
function groupUtxosByTxid(utxos: UTXO[]): Map<string, UTXO[]> {
  const grouped = new Map<string, UTXO[]>();

  for (const utxo of utxos) {
    const existing = grouped.get(utxo.txid) || [];
    existing.push(utxo);
    grouped.set(utxo.txid, existing);
  }

  return grouped;
}

/**
 * Hook for detecting incoming transactions
 *
 * This hook:
 * - Monitors UTXO changes from wallet syncs
 * - Detects new UTXOs that weren't in the previous set
 * - Groups new UTXOs by transaction ID
 * - Fetches transaction details from mempool API
 * - Automatically adds new transactions to monitoring
 *
 * @returns Detection state and new transactions
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { newTransactions, isChecking } = useIncomingTransactions();
 *
 *   useEffect(() => {
 *     if (newTransactions.length > 0) {
 *       console.log(`Received ${newTransactions.length} new transactions!`);
 *     }
 *   }, [newTransactions]);
 *
 *   return <div>{isChecking && "Checking for new transactions..."}</div>;
 * }
 * ```
 */
export function useIncomingTransactions(): UseIncomingTransactionsReturn {
  const network = useClientStore((state) => state.network);
  const wallet = useWalletStore((state) => state.wallet);
  const { startMonitoring } = useTransactionStore();

  // Track previous UTXOs to detect changes
  const previousUtxosRef = useRef<Map<string, UTXO>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);

  // State for newly detected transactions
  const [newTransactions, setNewTransactions] = useState<
    MonitoredTransaction[]
  >([]);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create API client
  const apiClient = useRef(new MempoolApiClient(network));

  // Update API client when network changes
  useEffect(() => {
    apiClient.current.setNetwork(network);
  }, [network]);

  // Monitor UTXO changes
  useEffect(() => {
    if (!wallet || !wallet.utxos) {
      return;
    }

    const currentUtxos = wallet.utxos;

    // On first load, just store the UTXOs without triggering detection
    if (!isInitialized) {
      console.log(
        "[IncomingTx] 📥 Initializing with",
        currentUtxos.length,
        "UTXOs",
      );
      console.log(
        "[IncomingTx] UTXO keys:",
        currentUtxos.map((u) => getUtxoKey(u)),
      );
      const utxoMap = new Map<string, UTXO>();
      for (const utxo of currentUtxos) {
        utxoMap.set(getUtxoKey(utxo), utxo);
      }
      previousUtxosRef.current = utxoMap;
      setIsInitialized(true);
      console.log("[IncomingTx] ✓ Initialization complete");
      return;
    }

    // Detect new UTXOs
    const newUtxos: UTXO[] = [];
    for (const utxo of currentUtxos) {
      const key = getUtxoKey(utxo);
      if (!previousUtxosRef.current.has(key)) {
        newUtxos.push(utxo);
      }
    }

    if (newUtxos.length === 0) {
      // Update previous UTXOs reference
      const utxoMap = new Map<string, UTXO>();
      for (const utxo of currentUtxos) {
        utxoMap.set(getUtxoKey(utxo), utxo);
      }
      previousUtxosRef.current = utxoMap;
      return;
    }

    // We found new UTXOs! Process them
    console.log(`[IncomingTx] 🎉 Found ${newUtxos.length} new UTXOs!`);
    console.log(
      "[IncomingTx] New UTXOs:",
      newUtxos.map((u) => `${u.txid}:${u.vout}`),
    );

    // Process new UTXOs asynchronously
    const processNewUtxos = async () => {
      setIsChecking(true);
      setError(null);

      try {
        // Group UTXOs by transaction ID
        const groupedByTx = groupUtxosByTxid(newUtxos);
        console.log(
          `[IncomingTx] Grouped into ${groupedByTx.size} unique transactions`,
        );

        // Fetch transaction details for each unique txid
        const txids = Array.from(groupedByTx.keys());
        const transactions = await apiClient.current.getTransactionBatch(txids);

        // Create MonitoredTransaction objects
        const monitoredTxs: MonitoredTransaction[] = [];
        for (const tx of transactions) {
          const relatedUtxos = groupedByTx.get(tx.txid) || [];

          // Calculate total amount received
          const totalAmount = relatedUtxos.reduce(
            (sum, utxo) => sum + BigInt(utxo.value),
            0n,
          );

          // Get all wallet addresses involved
          const addresses = relatedUtxos.map((utxo) => utxo.address);

          // Calculate confirmations
          const confirmations = await apiClient.current.getConfirmations(tx);

          // Determine status
          let status: "mempool" | "confirming" | "confirmed";
          if (confirmations === 0) {
            status = "mempool";
          } else if (confirmations < 6) {
            status = "confirming";
          } else {
            status = "confirmed";
          }

          const monitoredTx: MonitoredTransaction = {
            txid: tx.txid,
            direction: "incoming",
            confirmations,
            status,
            firstSeen: new Date(),
            lastChecked: new Date(),
            blockHeight: tx.status.block_height,
            blockTime: tx.status.block_time
              ? new Date(tx.status.block_time * 1000)
              : undefined,
            amount: totalAmount,
            addresses,
          };

          monitoredTxs.push(monitoredTx);

          // Add to monitoring
          startMonitoring(monitoredTx);
          console.log(
            `[IncomingTx] ✓ Added ${tx.txid} to monitoring (${totalAmount} sats, ${confirmations} conf)`,
          );
        }

        // Update state with new transactions
        setNewTransactions(monitoredTxs);

        // Clear new transactions after 5 seconds
        setTimeout(() => {
          setNewTransactions([]);
        }, 5000);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        console.error("[IncomingTx] ❌ Failed to process new UTXOs:", err);
        setError(errorMessage);
      } finally {
        setIsChecking(false);
      }
    };

    processNewUtxos();

    // Update previous UTXOs reference
    const utxoMap = new Map<string, UTXO>();
    for (const utxo of currentUtxos) {
      utxoMap.set(getUtxoKey(utxo), utxo);
    }
    previousUtxosRef.current = utxoMap;
  }, [wallet, network, isInitialized, startMonitoring]);

  return {
    newTransactions,
    isChecking,
    error,
  };
}

/**
 * Hook to get total count of incoming transactions detected during this session
 */
export function useIncomingTransactionCount(): number {
  const [count, setCount] = useState(0);
  const { newTransactions } = useIncomingTransactions();

  useEffect(() => {
    if (newTransactions.length > 0) {
      setCount((prev) => prev + newTransactions.length);
    }
  }, [newTransactions]);

  return count;
}
