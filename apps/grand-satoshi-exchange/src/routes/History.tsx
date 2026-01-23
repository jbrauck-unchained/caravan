/**
 * Grand Satoshi Exchange - History View
 *
 * Displays completed transaction history.
 */

import { useTransactionHistory } from "@/stores/transactionStore";
import { useClientStore } from "@/stores/clientStore";
import { GoldAmount } from "../components/ui/Display/GoldAmount";
import { getExplorerUrl } from "@/utils/broadcast";

export function History() {
  const history = useTransactionHistory();
  const network = useClientStore((state) => state.network);

  // Sort by most recent first
  const sortedHistory = [...history].sort(
    (a, b) => b.completedAt.getTime() - a.completedAt.getTime(),
  );

  return (
    <div style={{ padding: "20px" }}>
      <h3
        style={{
          color: "var(--osrs-text-yellow)",
          marginBottom: "16px",
          textAlign: "center",
          fontSize: "20px",
        }}
      >
        Transaction History
      </h3>

      {sortedHistory.length === 0 ? (
        // Empty state
        <div
          style={{
            padding: "40px 24px",
            textAlign: "center",
            backgroundColor: "var(--osrs-brown-dark)",
            border: "2px solid var(--inv-slot-border)",
            borderRadius: "4px",
          }}
        >
          <p style={{ color: "var(--osrs-text-gray)", fontSize: "14px" }}>
            No transactions yet
          </p>
          <p
            style={{
              color: "var(--osrs-text-gray)",
              fontSize: "12px",
              marginTop: "8px",
            }}
          >
            Completed transactions will appear here
          </p>
        </div>
      ) : (
        // Transaction list
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {sortedHistory.map((tx) => {
            const explorerUrl = getExplorerUrl(tx.txid, network);
            const dateStr = tx.completedAt.toLocaleString();

            return (
              <div
                key={tx.txid}
                style={{
                  padding: "16px",
                  backgroundColor: "var(--osrs-brown-dark)",
                  border: "2px solid var(--inv-slot-border)",
                  borderRadius: "4px",
                }}
              >
                {/* Date */}
                <div
                  style={{
                    color: "var(--osrs-text-gray)",
                    fontSize: "11px",
                    marginBottom: "8px",
                  }}
                >
                  {dateStr}
                </div>

                {/* Amount */}
                <div style={{ marginBottom: "8px" }}>
                  <div
                    style={{
                      color: "var(--osrs-text-yellow)",
                      fontSize: "12px",
                      marginBottom: "4px",
                    }}
                  >
                    Sent
                  </div>
                  <GoldAmount sats={Number(tx.amount)} showBtc size="normal" />
                </div>

                {/* Destination */}
                <div style={{ marginBottom: "8px" }}>
                  <div
                    style={{
                      color: "var(--osrs-text-yellow)",
                      fontSize: "12px",
                      marginBottom: "4px",
                    }}
                  >
                    To
                  </div>
                  <div
                    style={{
                      color: "var(--osrs-text-white)",
                      fontSize: "11px",
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                    }}
                  >
                    {tx.destination}
                  </div>
                </div>

                {/* Fee */}
                <div style={{ marginBottom: "12px" }}>
                  <div
                    style={{
                      color: "var(--osrs-text-yellow)",
                      fontSize: "12px",
                      marginBottom: "4px",
                    }}
                  >
                    Fee
                  </div>
                  <div
                    style={{
                      color: "var(--osrs-text-white)",
                      fontSize: "12px",
                    }}
                  >
                    {Number(tx.fee).toLocaleString()} sats ({tx.feeRate} sat/vB)
                  </div>
                </div>

                {/* Transaction ID with Explorer Link */}
                <div>
                  <div
                    style={{
                      color: "var(--osrs-text-yellow)",
                      fontSize: "12px",
                      marginBottom: "4px",
                    }}
                  >
                    Transaction ID
                  </div>
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--osrs-text-cyan)",
                      fontSize: "10px",
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                      textDecoration: "underline",
                    }}
                  >
                    {tx.txid}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
