/**
 * Grand Satoshi Exchange - Offer Slot Component
 *
 * Display a single pending transaction slot in the Grand Exchange view.
 */

import type { PendingOffer } from "@/types/transaction";
import { Button } from "../ui/Button";
import { ProgressBar } from "../ui/Display/ProgressBar";
import { GoldAmount } from "../ui/Display/GoldAmount";

export interface OfferSlotProps {
  /** Slot number (1-8) */
  slotNumber: number;
  /** Pending offer (null if slot is empty) */
  offer: PendingOffer | null;
  /** Callback when user clicks to create new offer */
  onCreateNew?: () => void;
  /** Callback when user clicks to sign */
  onSign?: (offerId: string) => void;
  /** Callback when user clicks to broadcast */
  onBroadcast?: (offerId: string) => void;
  /** Callback when user clicks to cancel */
  onCancel?: (offerId: string) => void;
}

/**
 * Truncate address for display
 */
function truncateAddress(address: string, chars = 8): string {
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Render OfferSlot component
 */
export function OfferSlot({
  slotNumber,
  offer,
  onCreateNew,
  onSign,
  onBroadcast,
  onCancel,
}: OfferSlotProps) {
  // Empty slot
  if (!offer) {
    return (
      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
          minHeight: "200px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            color: "var(--osrs-text-gray)",
            fontSize: "14px",
            marginBottom: "16px",
          }}
        >
          Slot {slotNumber}
        </div>
        <Button variant="primary" onClick={onCreateNew}>
          + Create Offer
        </Button>
      </div>
    );
  }

  // Offer exists
  const signatureProgress = offer.signatures.length;
  const signatureTotal = offer.requiredSignatures;
  const isReady = offer.status === "ready";
  const isBroadcasting = offer.status === "broadcasting";

  return (
    <div
      style={{
        padding: "16px",
        backgroundColor: "var(--osrs-brown-dark)",
        border: "2px solid var(--inv-slot-border)",
        borderRadius: "4px",
        minHeight: "200px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Slot Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <div style={{ color: "var(--osrs-text-gray)", fontSize: "12px" }}>
          Slot {slotNumber}
        </div>
        <div
          style={{
            color: "var(--osrs-text-orange)",
            fontSize: "12px",
            textTransform: "uppercase",
          }}
        >
          {offer.status}
        </div>
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
          Sending
        </div>
        <GoldAmount sats={Number(offer.amount)} showBtc={false} size="normal" />
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
          }}
        >
          {truncateAddress(offer.destination)}
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
        <div style={{ color: "var(--osrs-text-white)", fontSize: "12px" }}>
          {Number(offer.fee).toLocaleString()} sats ({offer.feeRate} sat/vB)
        </div>
      </div>

      {/* Signature Progress */}
      <div style={{ marginBottom: "16px", flex: 1 }}>
        <div
          style={{
            color: "var(--osrs-text-yellow)",
            fontSize: "12px",
            marginBottom: "4px",
          }}
        >
          Signatures
        </div>
        <ProgressBar
          current={signatureProgress}
          total={signatureTotal}
          label={`${signatureProgress}/${signatureTotal}`}
        />
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "8px", marginTop: "auto" }}>
        {!isReady && !isBroadcasting && (
          <Button
            variant="primary"
            onClick={() => {
              console.log(
                "[OfferSlot] Sign button clicked, offerId:",
                offer.id,
              );
              console.log("[OfferSlot] onSign callback:", typeof onSign);
              onSign?.(offer.id);
            }}
            disabled={isBroadcasting}
          >
            Sign
          </Button>
        )}

        {isReady && !isBroadcasting && (
          <Button variant="primary" onClick={() => onBroadcast?.(offer.id)}>
            Broadcast
          </Button>
        )}

        {isBroadcasting && (
          <Button variant="primary" disabled>
            Broadcasting...
          </Button>
        )}

        <Button
          variant="danger"
          onClick={() => onCancel?.(offer.id)}
          disabled={isBroadcasting}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
