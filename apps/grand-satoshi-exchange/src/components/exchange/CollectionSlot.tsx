/**
 * Grand Satoshi Exchange - Collection Slot Component
 *
 * Unified slot component that can display either:
 * - Empty slot (click to choose send/receive)
 * - Outgoing transaction (pending offer)
 * - Incoming transaction (monitored)
 */

import type { ExchangeSlotData } from "@/types/exchangeSlot";
import { getSlotProgress } from "@/types/exchangeSlot";
import { Button } from "../ui/Button";
import { ThickProgressBar } from "../ui/ProgressBar/ThickProgressBar";
import { GoldAmount } from "../ui/Display/GoldAmount";

export interface CollectionSlotProps {
  /** Slot number (1-8) */
  slotNumber: number;
  /** Slot data */
  slot: ExchangeSlotData;
  /** Callback when empty slot is clicked */
  onClickEmpty?: () => void;
  /** Callback when user clicks to sign */
  onSign?: (offerId: string) => void;
  /** Callback when user clicks to broadcast */
  onBroadcast?: (offerId: string) => void;
  /** Callback when user clicks to cancel offer */
  onCancelOffer?: (offerId: string) => void;
  /** Callback when user clicks to view incoming transaction */
  onViewIncoming?: (txid: string) => void;
}

/**
 * Truncate address for display
 */
function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Truncate txid for display
 */
function truncateTxid(txid: string): string {
  return `${txid.slice(0, 8)}...`;
}

/**
 * Render CollectionSlot component
 */
export function CollectionSlot({
  slotNumber,
  slot,
  onClickEmpty,
  onSign,
  onBroadcast,
  onCancelOffer,
  onViewIncoming,
}: CollectionSlotProps) {
  // Empty slot - show click to choose send/receive
  if (slot.type === "empty") {
    return (
      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
          minHeight: "180px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
        onClick={onClickEmpty}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--osrs-brown-medium)";
          e.currentTarget.style.borderColor = "var(--osrs-gold)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "var(--osrs-brown-dark)";
          e.currentTarget.style.borderColor = "var(--inv-slot-border)";
        }}
      >
        <div
          style={{
            color: "var(--osrs-text-gray)",
            fontSize: "12px",
            marginBottom: "8px",
          }}
        >
          Slot {slotNumber}
        </div>
        <div
          style={{
            color: "var(--osrs-text-yellow)",
            fontSize: "14px",
            textAlign: "center",
          }}
        >
          Click to use
        </div>
      </div>
    );
  }

  // Get progress information
  const progress = getSlotProgress(slot);

  // Outgoing transaction (pending offer)
  if (slot.type === "outgoing") {
    const offer = slot.data;
    const isReady = offer.status === "ready";
    const isBroadcasting = offer.status === "broadcasting";

    return (
      <div
        style={{
          padding: "12px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
          minHeight: "180px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header with icon */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          <img
            src="/assets/exchange/gse_out.svg"
            alt="Outgoing"
            width="24"
            height="24"
          />
          <div style={{ flex: 1 }}>
            <div style={{ color: "var(--osrs-text-yellow)", fontSize: "12px" }}>
              Sending
            </div>
            <div style={{ color: "var(--osrs-text-gray)", fontSize: "10px" }}>
              Slot {slotNumber}
            </div>
          </div>
          <div
            style={{
              color: "var(--osrs-text-orange)",
              fontSize: "10px",
              textTransform: "uppercase",
            }}
          >
            {offer.status}
          </div>
        </div>

        {/* Amount */}
        <div style={{ marginBottom: "8px" }}>
          <GoldAmount
            sats={Number(offer.amount)}
            showBtc={false}
            size="normal"
          />
        </div>

        {/* Destination */}
        <div style={{ marginBottom: "8px" }}>
          <div
            style={{
              color: "var(--osrs-text-white)",
              fontSize: "10px",
              fontFamily: "monospace",
            }}
          >
            → {truncateAddress(offer.destination)}
          </div>
        </div>

        {/* Progress bar */}
        {progress && (
          <div style={{ marginBottom: "12px" }}>
            <ThickProgressBar
              current={progress.current}
              max={progress.max}
              height={16}
              variant={progress.variant}
              label={progress.label}
            />
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            marginTop: "auto",
            flexWrap: "wrap",
          }}
        >
          {!isReady && !isBroadcasting && (
            <Button
              variant="primary"
              onClick={() => onSign?.(offer.id)}
              disabled={isBroadcasting}
              style={{ fontSize: "11px", padding: "4px 8px" }}
            >
              Sign
            </Button>
          )}

          {isReady && !isBroadcasting && (
            <Button
              variant="primary"
              onClick={() => onBroadcast?.(offer.id)}
              style={{ fontSize: "11px", padding: "4px 8px" }}
            >
              Broadcast
            </Button>
          )}

          {isBroadcasting && (
            <Button
              variant="primary"
              disabled
              style={{ fontSize: "11px", padding: "4px 8px" }}
            >
              Broadcasting...
            </Button>
          )}

          <Button
            variant="danger"
            onClick={() => onCancelOffer?.(offer.id)}
            disabled={isBroadcasting}
            style={{ fontSize: "11px", padding: "4px 8px" }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // Incoming transaction
  if (slot.type === "incoming") {
    const tx = slot.data;
    const confirmations = tx.confirmations || 0;

    return (
      <div
        style={{
          padding: "12px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
          minHeight: "180px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header with icon */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "8px",
          }}
        >
          <img
            src="/assets/exchange/gse_in.svg"
            alt="Incoming"
            width="24"
            height="24"
          />
          <div style={{ flex: 1 }}>
            <div style={{ color: "var(--osrs-text-yellow)", fontSize: "12px" }}>
              Receiving
            </div>
            <div style={{ color: "var(--osrs-text-gray)", fontSize: "10px" }}>
              Slot {slotNumber}
            </div>
          </div>
          <div
            style={{
              color:
                confirmations === 0
                  ? "var(--osrs-text-orange)"
                  : confirmations < 6
                    ? "var(--osrs-text-yellow)"
                    : "var(--osrs-green)",
              fontSize: "10px",
              textTransform: "uppercase",
            }}
          >
            {confirmations === 0
              ? "Mempool"
              : confirmations < 6
                ? "Confirming"
                : "Confirmed"}
          </div>
        </div>

        {/* Amount */}
        <div style={{ marginBottom: "8px" }}>
          <GoldAmount sats={Number(tx.amount)} showBtc={false} size="normal" />
        </div>

        {/* Transaction ID */}
        <div style={{ marginBottom: "8px" }}>
          <div
            style={{
              color: "var(--osrs-text-white)",
              fontSize: "10px",
              fontFamily: "monospace",
            }}
          >
            ← {truncateTxid(tx.txid)}
          </div>
        </div>

        {/* Progress bar */}
        {progress && (
          <div style={{ marginBottom: "12px" }}>
            <ThickProgressBar
              current={progress.current}
              max={progress.max}
              height={16}
              variant={progress.variant}
              label={progress.label}
            />
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: "auto" }}>
          <Button
            variant="secondary"
            onClick={() => onViewIncoming?.(tx.txid)}
            style={{ fontSize: "11px", padding: "4px 8px", width: "100%" }}
          >
            View Details
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
