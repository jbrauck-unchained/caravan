/**
 * Grand Satoshi Exchange - Transaction List Item
 *
 * Individual list item for displaying a monitored transaction.
 * Shows amount, status, direction, and action buttons.
 */

import { TransactionStatus } from "../ui/TransactionStatus";
import { GoldAmount } from "../ui/Display/GoldAmount";
import { Button } from "../ui/Button";
import type { MonitoredTransaction } from "@/types/transaction";
import { useClientStore } from "@/stores/clientStore";

export interface TransactionListItemProps {
  /** Transaction to display */
  transaction: MonitoredTransaction;
  /** Callback when user clicks to view details */
  onViewDetails?: (txid: string) => void;
  /** Callback when user clicks to archive */
  onArchive?: (txid: string) => void;
  /** Whether to show compact view */
  compact?: boolean;
}

/**
 * Format elapsed time since a date
 */
function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const then = date.getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Truncate address or txid for display
 */
function truncateHash(hash: string, start = 6, end = 4): string {
  if (hash.length <= start + end) return hash;
  return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}

/**
 * Transaction List Item Component
 *
 * Displays a single monitored transaction with:
 * - Direction indicator (incoming/outgoing arrow)
 * - Amount in gold coins
 * - Transaction status badge
 * - Address preview
 * - Time since first seen
 * - Action buttons (view/archive)
 *
 * @example
 * ```tsx
 * <TransactionListItem
 *   transaction={tx}
 *   onViewDetails={(txid) => window.open(`https://mempool.space/tx/${txid}`)}
 *   onArchive={(txid) => archiveTransaction(txid)}
 * />
 * ```
 */
export function TransactionListItem({
  transaction,
  onViewDetails,
  onArchive,
  compact = false,
}: TransactionListItemProps) {
  const network = useClientStore((state) => state.network);

  console.log("[TxListItem] Rendering transaction:", {
    txid: transaction.txid.substring(0, 8) + "...",
    direction: transaction.direction,
    confirmations: transaction.confirmations,
    status: transaction.status,
    amount: transaction.amount.toString(),
  });

  // Validate transaction data
  if (!transaction.txid) {
    console.error("[TxListItem] Invalid transaction: missing txid");
    return null;
  }

  if (transaction.amount === undefined || transaction.amount < 0n) {
    console.error(
      "[TxListItem] Invalid transaction: invalid amount",
      transaction.amount,
    );
    return null;
  }

  // Get block explorer URL
  const getExplorerUrl = () => {
    const baseUrl =
      network === "mainnet"
        ? "https://mempool.space"
        : "https://mempool.space/testnet";
    return `${baseUrl}/tx/${transaction.txid}`;
  };

  // Direction icon and color
  const directionConfig =
    transaction.direction === "incoming"
      ? { icon: "↓", color: "var(--osrs-green)", label: "Received" }
      : { icon: "↑", color: "var(--osrs-orange)", label: "Sent" };

  // Show archive button for confirmed transactions
  const showArchiveButton = transaction.confirmations >= 6 && onArchive;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        padding: compact ? "8px" : "12px",
        backgroundColor: "var(--osrs-brown-medium)",
        border: "2px solid var(--osrs-border)",
        borderRadius: "4px",
        transition: "all 0.2s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--osrs-brown-light)";
        e.currentTarget.style.borderColor = "var(--osrs-yellow)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "var(--osrs-brown-medium)";
        e.currentTarget.style.borderColor = "var(--osrs-border)";
      }}
    >
      {/* Top row: Direction, Amount, Status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        {/* Direction indicator */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              backgroundColor: directionConfig.color,
              color: "white",
              fontSize: "16px",
              fontWeight: "bold",
              border: "2px solid rgba(0, 0, 0, 0.3)",
            }}
            title={directionConfig.label}
          >
            {directionConfig.icon}
          </div>

          {/* Amount */}
          <div style={{ flex: 1 }}>
            <GoldAmount
              sats={Number(transaction.amount)}
              showBtc={!compact}
              size="normal"
            />
          </div>
        </div>

        {/* Status badge */}
        <TransactionStatus
          status={transaction.status}
          confirmations={transaction.confirmations}
          size={compact ? "small" : "normal"}
        />
      </div>

      {/* Middle row: Transaction ID and addresses */}
      {!compact && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            fontSize: "10px",
            color: "var(--osrs-text-gray)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontWeight: "bold" }}>TX:</span>
            <code
              style={{
                fontFamily: "monospace",
                backgroundColor: "var(--osrs-brown-dark)",
                padding: "2px 4px",
                borderRadius: "2px",
                fontSize: "9px",
              }}
            >
              {truncateHash(transaction.txid, 8, 8)}
            </code>
          </div>

          {transaction.destination && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontWeight: "bold" }}>To:</span>
              <code
                style={{
                  fontFamily: "monospace",
                  backgroundColor: "var(--osrs-brown-dark)",
                  padding: "2px 4px",
                  borderRadius: "2px",
                  fontSize: "9px",
                }}
              >
                {truncateHash(transaction.destination, 8, 8)}
              </code>
            </div>
          )}

          {transaction.direction === "incoming" &&
            transaction.addresses.length > 0 && (
              <div
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                <span style={{ fontWeight: "bold" }}>Address:</span>
                <code
                  style={{
                    fontFamily: "monospace",
                    backgroundColor: "var(--osrs-brown-dark)",
                    padding: "2px 4px",
                    borderRadius: "2px",
                    fontSize: "9px",
                  }}
                >
                  {truncateHash(transaction.addresses[0], 8, 8)}
                </code>
                {transaction.addresses.length > 1 && (
                  <span style={{ opacity: 0.7 }}>
                    +{transaction.addresses.length - 1} more
                  </span>
                )}
              </div>
            )}
        </div>
      )}

      {/* Bottom row: Time and actions */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        {/* Time */}
        <div
          style={{
            fontSize: "10px",
            color: "var(--osrs-text-gray)",
          }}
        >
          {formatTimeAgo(transaction.firstSeen)}
          {transaction.blockTime && transaction.confirmations > 0 && (
            <span style={{ marginLeft: "8px", opacity: 0.7 }}>
              • Block {transaction.blockHeight}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "6px" }}>
          {/* View on explorer */}
          <Button
            variant="secondary"
            onClick={() => {
              if (onViewDetails) {
                onViewDetails(transaction.txid);
              } else {
                window.open(getExplorerUrl(), "_blank", "noopener,noreferrer");
              }
            }}
            style={{
              padding: "4px 8px",
              fontSize: "10px",
            }}
          >
            View 🔗
          </Button>

          {/* Archive button (only for confirmed) */}
          {showArchiveButton && (
            <Button
              variant="secondary"
              onClick={() => onArchive!(transaction.txid)}
              style={{
                padding: "4px 8px",
                fontSize: "10px",
              }}
            >
              Archive 📦
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact version for dense lists
 */
export function TransactionListItemCompact({
  transaction,
  onViewDetails,
}: Pick<TransactionListItemProps, "transaction" | "onViewDetails">) {
  return (
    <TransactionListItem
      transaction={transaction}
      onViewDetails={onViewDetails}
      compact
    />
  );
}
