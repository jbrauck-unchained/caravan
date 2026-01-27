/**
 * Grand Satoshi Exchange - Transaction Monitoring Hook
 *
 * React hook for monitoring transactions and updating their confirmation status.
 * Polls mempool.space API at regular intervals and auto-archives confirmed transactions.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  useTransactionStore,
  useMonitoredTransactions,
} from "@/stores/transactionStore";
import { useClient, useClientStore } from "@/stores/clientStore";
import type { TransactionUpdate } from "@/types/transaction";

/**
 * Configuration options for transaction monitoring
 */
export interface UseTransactionMonitoringOptions {
  /** Polling interval in milliseconds (default: 30000 = 30 seconds) */
  pollInterval?: number;
  /** Whether monitoring is enabled (default: true) */
  enabled?: boolean;
  /** Minimum confirmations before auto-archiving (default: 6) */
  confirmationsForArchive?: number;
}

/**
 * Return value from useTransactionMonitoring hook
 */
export interface UseTransactionMonitoringReturn {
  /** Whether the monitoring is currently active */
  isMonitoring: boolean;
  /** Number of transactions being monitored */
  monitoredCount: number;
  /** Last successful update timestamp */
  lastUpdate: Date | null;
  /** Error message if monitoring failed */
  error: string | null;
  /** Manually trigger a refresh */
  refresh: () => void;
}

/**
 * Hook for monitoring transactions and tracking confirmations
 *
 * This hook:
 * - Polls mempool.space API at regular intervals
 * - Updates confirmation counts for all monitored transactions
 * - Auto-archives transactions when they reach sufficient confirmations
 * - Handles errors gracefully with exponential backoff
 *
 * @param options - Configuration options
 * @returns Monitoring state and controls
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { isMonitoring, monitoredCount, error } = useTransactionMonitoring({
 *     pollInterval: 30000, // 30 seconds
 *     confirmationsForArchive: 6,
 *   });
 *
 *   return (
 *     <div>
 *       {isMonitoring && <span>Monitoring {monitoredCount} transactions</span>}
 *       {error && <span>Error: {error}</span>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTransactionMonitoring(
  options: UseTransactionMonitoringOptions = {},
): UseTransactionMonitoringReturn {
  const {
    pollInterval = 30000,
    enabled = true,
    confirmationsForArchive = 6,
  } = options;

  // Get state
  const network = useClientStore((state) => state.network);
  const client = useClient();
  const monitoredTransactions = useMonitoredTransactions();
  const { updateTransactionStatus, archiveOldTransactions } =
    useTransactionStore();

  // Check if we have transactions to monitor
  const hasTransactions = monitoredTransactions.length > 0;
  const hasClient = client !== null;
  const shouldPoll = enabled && hasTransactions && hasClient;

  // Query for updating transaction statuses
  const {
    data: lastUpdate,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: [
      "transaction-monitoring",
      network,
      hasClient, // Include client availability in query key
      monitoredTransactions
        .map((tx) => tx.txid)
        .sort()
        .join(","),
    ],
    queryFn: async (): Promise<Date> => {
      if (!client) {
        throw new Error("No blockchain client available");
      }

      const startTime = Date.now();
      console.log(
        `[TxMonitor] 🔄 Starting update cycle for ${monitoredTransactions.length} transactions...`,
      );
      console.log(
        `[TxMonitor] Transactions:`,
        monitoredTransactions.map(
          (tx) =>
            `${tx.txid.substring(0, 8)}... (${tx.confirmations} conf, ${tx.status})`,
        ),
      );

      try {
        // Fetch current block height once for all confirmations calculations
        console.log(`[TxMonitor] Step 1: Fetching current block height...`);
        let currentHeight: number;

        // Get block height from appropriate source
        try {
          // Try public explorer endpoint first
          const heightData = await client.Get("/blocks/tip/height");
          currentHeight =
            typeof heightData === "number"
              ? heightData
              : parseInt(String(heightData), 10);
        } catch (e) {
          // Fallback: For private nodes, we'll estimate from transaction data
          // Bitcoin Core doesn't have a simple "get current height" RPC we can easily call
          console.log(
            `[TxMonitor] Using transaction-based block height (private node)`,
          );
          currentHeight = 0; // Will be set from first confirmed transaction
        }

        if (currentHeight > 0) {
          console.log(`[TxMonitor] ✓ Current block height: ${currentHeight}`);
        }

        // Process updates
        console.log(`[TxMonitor] Step 2: Fetching transaction details...`);
        const updates: TransactionUpdate[] = [];

        for (const monitoredTx of monitoredTransactions) {
          const oldConfirmations = monitoredTx.confirmations || 0;

          try {
            // Fetch transaction details
            // @ts-expect-error - getTransaction exists but types may not be up to date
            const txDetails = await client.getTransaction(monitoredTx.txid);

            // Calculate confirmations
            let confirmations = 0;
            let blockHeight: number | undefined = undefined;
            let blockTime: number | undefined = undefined;

            const txBlockHeight = txDetails.status?.blockHeight;
            if (txBlockHeight && txBlockHeight > 0) {
              blockHeight = txBlockHeight;
              // Update currentHeight if we didn't get it earlier (private node case)
              if (currentHeight === 0) {
                currentHeight = txBlockHeight; // Approximate - use the highest block we see
              } else if (txBlockHeight > currentHeight) {
                currentHeight = txBlockHeight; // Update to highest seen block
              }
              confirmations = currentHeight - txBlockHeight + 1;
              blockTime = txDetails.status?.blockTime;
            }

            const update: TransactionUpdate = {
              txid: monitoredTx.txid,
              confirmations,
              blockHeight,
              blockTime,
            };

            updates.push(update);

            // Log if confirmations changed
            if (confirmations !== oldConfirmations) {
              console.log(
                `[TxMonitor] 🔔 ${monitoredTx.txid.substring(0, 8)}... confirmations: ${oldConfirmations} → ${confirmations}`,
              );
            }
          } catch (txError) {
            console.warn(
              `[TxMonitor] ⚠️ Failed to fetch ${monitoredTx.txid.substring(0, 8)}...:`,
              txError instanceof Error ? txError.message : txError,
            );
            // Skip this transaction but continue with others
          }
        }

        // Apply all updates to store
        console.log(
          `[TxMonitor] Step 4: Applying ${updates.length} updates to store...`,
        );
        for (const update of updates) {
          updateTransactionStatus(update);
        }
        console.log(`[TxMonitor] ✓ Store updated`);

        // Auto-archive transactions with sufficient confirmations
        console.log(
          `[TxMonitor] Step 5: Auto-archiving transactions with ${confirmationsForArchive}+ confirmations...`,
        );
        const toArchive = monitoredTransactions.filter(
          (tx) => tx.confirmations >= confirmationsForArchive,
        );
        if (toArchive.length > 0) {
          console.log(
            `[TxMonitor] 📦 Archiving ${toArchive.length} transactions:`,
            toArchive.map((tx) => tx.txid.substring(0, 8) + "..."),
          );
          archiveOldTransactions(confirmationsForArchive);
        } else {
          console.log(`[TxMonitor] No transactions ready for archiving`);
        }

        const duration = Date.now() - startTime;
        console.log(
          `[TxMonitor] 🎉 Update complete in ${duration}ms at ${new Date().toLocaleTimeString()}`,
        );
        return new Date();
      } catch (error) {
        const duration = Date.now() - startTime;
        console.error(
          `[TxMonitor] ❌ Update failed after ${duration}ms:`,
          error,
        );
        console.error(`[TxMonitor] Error details:`, {
          name: error instanceof Error ? error.name : "Unknown",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    },
    enabled: shouldPoll,
    refetchInterval: pollInterval,
    // Keep previous data while fetching
    placeholderData: (prev) => prev,
    // Retry with exponential backoff
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Log state changes
  useEffect(() => {
    console.log(`[TxMonitor] State check:`, {
      hasClient,
      hasTransactions,
      enabled,
      shouldPoll,
      transactionCount: monitoredTransactions.length,
      network,
    });

    if (!hasClient) {
      console.warn(
        `[TxMonitor] ⚠️ Monitoring disabled: No blockchain client available`,
      );
    } else if (shouldPoll) {
      console.log(
        `[TxMonitor] 📡 Monitoring ${monitoredTransactions.length} transactions (poll every ${pollInterval}ms)`,
      );
    } else if (enabled && !hasTransactions) {
      console.log("[TxMonitor] 💤 No transactions to monitor");
    } else if (!enabled) {
      console.log("[TxMonitor] ⏸️  Monitoring disabled");
    }
  }, [
    shouldPoll,
    monitoredTransactions.length,
    pollInterval,
    enabled,
    hasTransactions,
    hasClient,
    network,
  ]);

  return {
    isMonitoring: isFetching,
    monitoredCount: monitoredTransactions.length,
    lastUpdate: lastUpdate || null,
    error: queryError ? String(queryError) : null,
    refresh: refetch,
  };
}

/**
 * Hook to check if a specific transaction is being monitored
 *
 * @param txid - Transaction ID to check
 * @returns Whether the transaction is currently being monitored
 */
export function useIsTransactionMonitored(txid: string): boolean {
  const monitoredTransactions = useMonitoredTransactions();
  return monitoredTransactions.some((tx) => tx.txid === txid);
}

/**
 * Hook to get monitoring statistics
 *
 * @returns Stats about monitored transactions
 */
export function useMonitoringStats() {
  const monitoredTransactions = useMonitoredTransactions();

  return useMemo(() => {
    const stats = {
      total: monitoredTransactions.length,
      mempool: 0,
      confirming: 0,
      confirmed: 0,
      incoming: 0,
      outgoing: 0,
    };

    for (const tx of monitoredTransactions) {
      // Count by status
      if (tx.status === "mempool") stats.mempool++;
      else if (tx.status === "confirming") stats.confirming++;
      else if (tx.status === "confirmed") stats.confirmed++;

      // Count by direction
      if (tx.direction === "incoming") stats.incoming++;
      else if (tx.direction === "outgoing") stats.outgoing++;
    }

    return stats;
  }, [monitoredTransactions]);
}
