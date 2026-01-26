/**
 * Grand Satoshi Exchange - Monitored Transactions Panel
 *
 * Main panel for displaying all transactions being monitored for confirmations.
 * Shows pending, confirming, and confirmed transactions with filtering.
 */

import { useState, useMemo } from "react";
import { TransactionListItem } from "./TransactionListItem";
import {
  useMonitoredTransactions,
  useTransactionStore,
} from "@/stores/transactionStore";
import { useMonitoringStats } from "@/hooks/useTransactionMonitoring";

type FilterTab = "all" | "incoming" | "outgoing";

/**
 * Monitored Transactions Panel Component
 *
 * Displays all transactions being monitored with:
 * - Header with count badge
 * - Filter tabs (All / Incoming / Outgoing)
 * - Grouped sections by status (Mempool → Confirming → Confirmed)
 * - Auto-refresh indicator
 * - Empty state
 *
 * @example
 * ```tsx
 * <MonitoredTransactionsPanel />
 * ```
 */
export function MonitoredTransactionsPanel() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const monitoredTransactions = useMonitoredTransactions();
  const { archiveTransaction } = useTransactionStore();
  const stats = useMonitoringStats();

  console.log(
    "[MonitoredTxPanel] Rendering with",
    monitoredTransactions.length,
    "transactions",
  );
  console.log("[MonitoredTxPanel] Stats:", stats);
  console.log("[MonitoredTxPanel] Active filter:", activeFilter);

  // Filter transactions based on active tab
  const filteredTransactions = useMemo(() => {
    if (activeFilter === "all") {
      return monitoredTransactions;
    }
    return monitoredTransactions.filter((tx) => tx.direction === activeFilter);
  }, [monitoredTransactions, activeFilter]);

  // Group transactions by status
  const groupedTransactions = useMemo(() => {
    const groups = {
      mempool: filteredTransactions.filter((tx) => tx.status === "mempool"),
      confirming: filteredTransactions.filter(
        (tx) => tx.status === "confirming",
      ),
      confirmed: filteredTransactions.filter((tx) => tx.status === "confirmed"),
    };

    // Sort each group by firstSeen (newest first)
    groups.mempool.sort(
      (a, b) => b.firstSeen.getTime() - a.firstSeen.getTime(),
    );
    groups.confirming.sort(
      (a, b) => b.firstSeen.getTime() - a.firstSeen.getTime(),
    );
    groups.confirmed.sort(
      (a, b) => b.firstSeen.getTime() - a.firstSeen.getTime(),
    );

    return groups;
  }, [filteredTransactions]);

  const hasTransactions = monitoredTransactions.length > 0;

  // Render empty state
  const renderEmptyState = () => (
    <div
      style={{
        padding: "32px",
        textAlign: "center",
        color: "var(--osrs-text-gray)",
      }}
    >
      <div style={{ fontSize: "32px", marginBottom: "12px" }}>📭</div>
      <div style={{ fontSize: "14px", marginBottom: "4px" }}>
        No transactions to monitor
      </div>
      <div style={{ fontSize: "11px", opacity: 0.7 }}>
        {activeFilter === "incoming"
          ? "Incoming transactions will appear here"
          : activeFilter === "outgoing"
            ? "Outgoing transactions will appear here"
            : "Transactions will appear here as they are detected"}
      </div>
    </div>
  );

  // Render transaction section
  const renderSection = (
    title: string,
    count: number,
    transactions: typeof filteredTransactions,
    color: string,
  ) => {
    if (count === 0) return null;

    return (
      <div style={{ marginBottom: "16px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "8px",
            paddingBottom: "6px",
            borderBottom: `2px solid ${color}`,
          }}
        >
          <span
            style={{
              fontSize: "12px",
              fontWeight: "bold",
              color: "var(--osrs-text-yellow)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: "10px",
              padding: "2px 6px",
              backgroundColor: color,
              color: "white",
              borderRadius: "10px",
              fontWeight: "bold",
            }}
          >
            {count}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {transactions.map((tx) => (
            <TransactionListItem
              key={tx.txid}
              transaction={tx}
              onArchive={(txid) => archiveTransaction(txid)}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        backgroundColor: "var(--osrs-brown-dark)",
        border: "2px solid var(--osrs-border)",
        borderRadius: "4px",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          backgroundColor: "var(--osrs-brown-medium)",
          borderBottom: "2px solid var(--osrs-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontSize: "14px",
              fontWeight: "bold",
              color: "var(--osrs-text-yellow)",
            }}
          >
            Transactions
          </span>
          {hasTransactions && (
            <span
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                backgroundColor: "var(--osrs-orange)",
                color: "white",
                borderRadius: "10px",
                fontWeight: "bold",
              }}
            >
              {monitoredTransactions.length}
            </span>
          )}
        </div>

        {/* Stats */}
        {hasTransactions && (
          <div
            style={{
              fontSize: "10px",
              color: "var(--osrs-text-gray)",
              display: "flex",
              gap: "12px",
            }}
          >
            {stats.mempool > 0 && (
              <span>
                <span style={{ color: "var(--osrs-yellow)" }}>⏳</span>{" "}
                {stats.mempool}
              </span>
            )}
            {stats.confirming > 0 && (
              <span>
                <span style={{ color: "var(--osrs-orange)" }}>🔄</span>{" "}
                {stats.confirming}
              </span>
            )}
            {stats.confirmed > 0 && (
              <span>
                <span style={{ color: "var(--osrs-green)" }}>✓</span>{" "}
                {stats.confirmed}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div
        style={{
          padding: "8px",
          backgroundColor: "var(--osrs-brown-medium)",
          borderBottom: "2px solid var(--osrs-border)",
          display: "flex",
          gap: "4px",
        }}
      >
        {(["all", "incoming", "outgoing"] as const).map((filter) => {
          const isActive = activeFilter === filter;
          const count =
            filter === "all"
              ? stats.total
              : filter === "incoming"
                ? stats.incoming
                : stats.outgoing;

          return (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              style={{
                flex: 1,
                padding: "6px 12px",
                fontSize: "11px",
                fontWeight: "bold",
                textTransform: "capitalize",
                backgroundColor: isActive
                  ? "var(--osrs-brown-dark)"
                  : "transparent",
                color: isActive
                  ? "var(--osrs-text-yellow)"
                  : "var(--osrs-text-white)",
                border: isActive
                  ? "2px solid var(--osrs-yellow)"
                  : "2px solid transparent",
                borderRadius: "3px",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor =
                    "var(--osrs-brown-light)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.backgroundColor = "transparent";
                }
              }}
            >
              {filter} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{ padding: "16px" }}>
        {!hasTransactions || filteredTransactions.length === 0 ? (
          renderEmptyState()
        ) : (
          <>
            {/* Pending (Mempool) Section */}
            {renderSection(
              "Pending",
              groupedTransactions.mempool.length,
              groupedTransactions.mempool,
              "var(--osrs-yellow)",
            )}

            {/* Confirming Section */}
            {renderSection(
              "Confirming",
              groupedTransactions.confirming.length,
              groupedTransactions.confirming,
              "var(--osrs-orange)",
            )}

            {/* Confirmed Section */}
            {renderSection(
              "Confirmed",
              groupedTransactions.confirmed.length,
              groupedTransactions.confirmed,
              "var(--osrs-green)",
            )}
          </>
        )}
      </div>
    </div>
  );
}
