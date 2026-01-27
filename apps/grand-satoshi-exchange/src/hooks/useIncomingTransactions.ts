/**
 * Grand Satoshi Exchange - Incoming Transaction Detector
 *
 * React hook for detecting new incoming transactions by monitoring UTXO changes.
 * Compares current UTXOs with previous UTXOs to identify new transactions.
 */

import { useEffect, useRef, useState } from "react";
import { useTransactionStore } from "@/stores/transactionStore";
import { useWalletStore } from "@/stores/walletStore";
import { useClient, useClientStore } from "@/stores/clientStore";
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
  const client = useClient();
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

  // Monitor UTXO changes
  useEffect(() => {
    if (!wallet || !wallet.utxos) {
      return;
    }

    const currentUtxos = wallet.utxos;

    // On first load, backfill unconfirmed/recently confirmed transactions
    if (!isInitialized) {
      console.log(
        "[IncomingTx] 📥 Initializing with",
        currentUtxos.length,
        "UTXOs",
      );

      // Find UTXOs that are unconfirmed or have < 6 confirmations
      // These are "recent" and should be monitored
      const recentUtxos = currentUtxos.filter((utxo) => {
        // If we don't have confirmation data, skip it (it's old)
        if (utxo.confirmed === undefined) return false;

        // Unconfirmed transactions
        if (!utxo.confirmed) return true;

        // For confirmed UTXOs, we need to check confirmations
        // Note: We don't have confirmation count in UTXO type, only confirmed boolean
        // So we'll treat all unconfirmed as "recent" and process them
        return false; // Only unconfirmed for now
      });

      if (recentUtxos.length > 0) {
        console.log(
          `[IncomingTx] 🔍 Found ${recentUtxos.length} unconfirmed UTXOs to backfill:`,
          recentUtxos.map((u) => getUtxoKey(u)),
        );
        // Process these as "new" transactions
        // Fall through to the processing logic below
      } else {
        console.log("[IncomingTx] No unconfirmed UTXOs to backfill");
      }

      const utxoMap = new Map<string, UTXO>();
      for (const utxo of currentUtxos) {
        utxoMap.set(getUtxoKey(utxo), utxo);
      }
      previousUtxosRef.current = utxoMap;
      setIsInitialized(true);

      // If we have recent UTXOs to backfill, treat them as "new"
      if (recentUtxos.length === 0) {
        console.log("[IncomingTx] ✓ Initialization complete");
        return;
      }

      // Continue to process recentUtxos as newUtxos
      console.log(
        "[IncomingTx] ✓ Initialization complete, processing recent UTXOs...",
      );
      // Set currentUtxos to recentUtxos for processing
      const newUtxos = recentUtxos;

      // Process immediately (same logic as below)
      const processBackfill = async () => {
        if (!client) {
          console.warn(
            "[IncomingTx] ⚠️ No blockchain client available, skipping backfill",
          );
          return;
        }

        setIsChecking(true);
        setError(null);

        try {
          const groupedByTx = groupUtxosByTxid(newUtxos);
          console.log(
            `[IncomingTx] Grouped backfill into ${groupedByTx.size} unique transactions`,
          );

          let currentHeight = 0;
          try {
            const heightData = await client.Get("/blocks/tip/height");
            currentHeight =
              typeof heightData === "number"
                ? heightData
                : parseInt(String(heightData), 10);
          } catch (e) {
            console.log("[IncomingTx] Using transaction-based block height");
          }

          const txids = Array.from(groupedByTx.keys());
          console.log(
            `[IncomingTx] Backfilling ${txids.length} transactions...`,
          );

          const monitoredTxs: MonitoredTransaction[] = [];

          for (const txid of txids) {
            try {
              // @ts-expect-error - getTransaction exists but types may not be up to date
              const txDetails = await client.getTransaction(txid);
              const relatedUtxos = groupedByTx.get(txid) || [];

              const totalAmount = relatedUtxos.reduce(
                (sum, utxo) => sum + BigInt(utxo.value),
                0n,
              );

              const addresses = relatedUtxos.map((utxo) => utxo.address);

              let confirmations = 0;
              let blockHeight: number | undefined = undefined;
              let blockTime: Date | undefined = undefined;

              const txBlockHeight = txDetails.status?.blockHeight;
              if (txBlockHeight && txBlockHeight > 0) {
                blockHeight = txBlockHeight;
                if (currentHeight === 0) {
                  currentHeight = txBlockHeight;
                } else if (txBlockHeight > currentHeight) {
                  currentHeight = txBlockHeight;
                }
                confirmations = currentHeight - txBlockHeight + 1;
                if (txDetails.status?.blockTime) {
                  blockTime = new Date(txDetails.status.blockTime * 1000);
                }
              }

              let status: "mempool" | "confirming" | "confirmed";
              if (confirmations === 0) {
                status = "mempool";
              } else if (confirmations < 6) {
                status = "confirming";
              } else {
                status = "confirmed";
              }

              const monitoredTx: MonitoredTransaction = {
                txid,
                direction: "incoming",
                confirmations,
                status,
                firstSeen: new Date(),
                lastChecked: new Date(),
                blockHeight,
                blockTime,
                amount: totalAmount,
                addresses,
              };

              monitoredTxs.push(monitoredTx);
              startMonitoring(monitoredTx);
              console.log(
                `[IncomingTx] ✓ Backfilled ${txid.substring(0, 8)}... (${totalAmount} sats, ${confirmations} conf)`,
              );
            } catch (txErr) {
              console.error(
                `[IncomingTx] ❌ Failed to backfill transaction ${txid}:`,
                txErr,
              );
            }
          }

          setNewTransactions(monitoredTxs);
          setTimeout(() => setNewTransactions([]), 5000);
        } catch (err) {
          const errorMessage =
            err instanceof Error ? err.message : "Unknown error";
          console.error("[IncomingTx] ❌ Failed to backfill:", err);
          setError(errorMessage);
        } finally {
          setIsChecking(false);
        }
      };

      processBackfill();
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
      if (!client) {
        console.warn(
          "[IncomingTx] ⚠️ No blockchain client available, skipping incoming tx detection",
        );
        return;
      }

      setIsChecking(true);
      setError(null);

      try {
        // Group UTXOs by transaction ID
        const groupedByTx = groupUtxosByTxid(newUtxos);
        console.log(
          `[IncomingTx] Grouped into ${groupedByTx.size} unique transactions`,
        );

        // Get current block height for confirmation calculations
        let currentHeight = 0;
        try {
          const heightData = await client.Get("/blocks/tip/height");
          currentHeight =
            typeof heightData === "number"
              ? heightData
              : parseInt(String(heightData), 10);
        } catch (e) {
          // For private nodes, we'll get height from transaction data
          console.log("[IncomingTx] Using transaction-based block height");
        }

        // Fetch transaction details for each unique txid
        const txids = Array.from(groupedByTx.keys());
        console.log(
          `[IncomingTx] Fetching details for ${txids.length} transactions...`,
        );

        // Create MonitoredTransaction objects
        const monitoredTxs: MonitoredTransaction[] = [];

        for (const txid of txids) {
          try {
            // @ts-expect-error - getTransaction exists but types may not be up to date
            const txDetails = await client.getTransaction(txid);
            const relatedUtxos = groupedByTx.get(txid) || [];

            // Calculate total amount received
            const totalAmount = relatedUtxos.reduce(
              (sum, utxo) => sum + BigInt(utxo.value),
              0n,
            );

            // Get all wallet addresses involved
            const addresses = relatedUtxos.map((utxo) => utxo.address);

            // Calculate confirmations
            let confirmations = 0;
            let blockHeight: number | undefined = undefined;
            let blockTime: Date | undefined = undefined;

            const txBlockHeight = txDetails.status?.blockHeight;
            if (txBlockHeight && txBlockHeight > 0) {
              blockHeight = txBlockHeight;
              if (currentHeight === 0) {
                currentHeight = txBlockHeight;
              } else if (txBlockHeight > currentHeight) {
                currentHeight = txBlockHeight;
              }
              confirmations = currentHeight - txBlockHeight + 1;
              if (txDetails.status?.blockTime) {
                blockTime = new Date(txDetails.status.blockTime * 1000);
              }
            }

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
              txid,
              direction: "incoming",
              confirmations,
              status,
              firstSeen: new Date(),
              lastChecked: new Date(),
              blockHeight,
              blockTime,
              amount: totalAmount,
              addresses,
            };

            monitoredTxs.push(monitoredTx);

            // Add to monitoring
            startMonitoring(monitoredTx);
            console.log(
              `[IncomingTx] ✓ Added ${txid} to monitoring (${totalAmount} sats, ${confirmations} conf)`,
            );
          } catch (txErr) {
            console.error(
              `[IncomingTx] ❌ Failed to fetch transaction ${txid}:`,
              txErr,
            );
            // Continue with other transactions
          }
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
  }, [wallet, network, client, isInitialized, startMonitoring]);

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
