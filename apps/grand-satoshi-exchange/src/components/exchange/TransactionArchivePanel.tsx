/**
 * Grand Satoshi Exchange - Transaction Archive Panel
 *
 * Collapsible panel for viewing archived (6+ confirmations) transactions.
 * Provides search, filtering, and cleanup functionality.
 */

import { useState } from "react";
import { TransactionListItem } from "./TransactionListItem";
import {
  useArchivedTransactions,
  useTransactionStore,
} from "@/stores/transactionStore";
import { Button } from "../ui/Button";

/**
 * Transaction Archive Panel Component
 *
 * Collapsible archive for old transactions with:
 * - Collapsed by default
 * - Shows count of archived transactions
 * - Search/filter functionality
 * - Pagination for large lists
 * - Cleanup button for old transactions
 *
 * @example
 * ```tsx
 * <TransactionArchivePanel />
 * ```
 */
export function TransactionArchivePanel() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);

  const archivedTransactions = useArchivedTransactions();
  const { cleanupArchive } = useTransactionStore();

  // Filter transactions by search query
  const filteredTransactions = archivedTransactions.filter((tx) => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      tx.txid.toLowerCase().includes(query) ||
      tx.destination?.toLowerCase().includes(query) ||
      tx.addresses.some((addr) => addr.toLowerCase().includes(query))
    );
  });

  // Handle cleanup (remove transactions older than 30 days)
  const handleCleanup = () => {
    cleanupArchive(30);
    setShowCleanupConfirm(false);
  };

  const count = archivedTransactions.length;

  return (
    <div
      style={{
        backgroundColor: "var(--osrs-brown-dark)",
        border: "2px solid var(--osrs-border)",
        borderRadius: "4px",
        overflow: "hidden",
      }}
    >
      {/* Header (always visible) */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: "100%",
          padding: "12px 16px",
          backgroundColor: "var(--osrs-brown-medium)",
          border: "none",
          borderBottom: isExpanded ? "2px solid var(--osrs-border)" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          transition: "background-color 0.2s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--osrs-brown-light)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "var(--osrs-brown-medium)";
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontSize: "14px",
              fontWeight: "bold",
              color: "var(--osrs-text-gray)",
            }}
          >
            📦 Archive
          </span>
          {count > 0 && (
            <span
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                backgroundColor: "var(--osrs-brown-medium)",
                color: "var(--osrs-text-gray)",
                borderRadius: "10px",
                fontWeight: "bold",
                border: "1px solid rgba(0, 0, 0, 0.3)",
              }}
            >
              {count}
            </span>
          )}
        </div>

        <span
          style={{
            fontSize: "16px",
            color: "var(--osrs-text-gray)",
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        >
          ▼
        </span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ padding: "16px" }}>
          {count === 0 ? (
            // Empty state
            <div
              style={{
                padding: "32px",
                textAlign: "center",
                color: "var(--osrs-text-gray)",
              }}
            >
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>📦</div>
              <div style={{ fontSize: "14px", marginBottom: "4px" }}>
                No archived transactions
              </div>
              <div style={{ fontSize: "11px", opacity: 0.7 }}>
                Confirmed transactions (6+ confirmations) will be archived here
              </div>
            </div>
          ) : (
            <>
              {/* Search and actions bar */}
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginBottom: "16px",
                  alignItems: "center",
                }}
              >
                {/* Search input */}
                <input
                  type="text"
                  placeholder="Search by txid or address..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    fontSize: "12px",
                    backgroundColor: "var(--osrs-brown-dark)",
                    color: "var(--osrs-text-white)",
                    border: "2px solid var(--osrs-border)",
                    borderRadius: "3px",
                    outline: "none",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--osrs-yellow)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--osrs-border)";
                  }}
                />

                {/* Cleanup button */}
                {!showCleanupConfirm ? (
                  <Button
                    variant="secondary"
                    onClick={() => setShowCleanupConfirm(true)}
                    style={{
                      padding: "8px 12px",
                      fontSize: "11px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Clear Old
                  </Button>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      gap: "4px",
                    }}
                  >
                    <Button
                      variant="primary"
                      onClick={handleCleanup}
                      style={{
                        padding: "8px 12px",
                        fontSize: "11px",
                      }}
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setShowCleanupConfirm(false)}
                      style={{
                        padding: "8px 12px",
                        fontSize: "11px",
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>

              {/* Results info */}
              {searchQuery && (
                <div
                  style={{
                    marginBottom: "12px",
                    fontSize: "11px",
                    color: "var(--osrs-text-gray)",
                  }}
                >
                  {filteredTransactions.length === 0
                    ? "No results found"
                    : `Showing ${filteredTransactions.length} of ${count} transactions`}
                </div>
              )}

              {/* Transaction list */}
              {filteredTransactions.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    maxHeight: "400px",
                    overflowY: "auto",
                    padding: "4px",
                  }}
                >
                  {filteredTransactions.map((tx) => (
                    <TransactionListItem key={tx.txid} transaction={tx} />
                  ))}
                </div>
              )}

              {/* Info text */}
              {!searchQuery && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "12px",
                    backgroundColor: "var(--osrs-brown-medium)",
                    borderRadius: "3px",
                    fontSize: "11px",
                    color: "var(--osrs-text-gray)",
                  }}
                >
                  💡 <strong>Tip:</strong> Use "Clear Old" to remove
                  transactions older than 30 days
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
