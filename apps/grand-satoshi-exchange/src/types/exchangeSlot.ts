/**
 * Grand Satoshi Exchange - Exchange Slot Types
 *
 * Unified type system for exchange slots that can hold either
 * outgoing (pending offers) or incoming (monitored) transactions
 */

import type { PendingOffer } from "./transaction";
import type { MonitoredTransaction } from "./transaction";

/**
 * Unified exchange slot that can contain either an outgoing or incoming transaction
 */
export type ExchangeSlotData =
  | {
      type: "outgoing";
      data: PendingOffer;
    }
  | {
      type: "incoming";
      data: MonitoredTransaction;
    }
  | {
      type: "empty";
      data: null;
    };

/**
 * Progress information for a slot
 */
export interface SlotProgress {
  /** Current progress value */
  current: number;
  /** Maximum value */
  max: number;
  /** Progress type */
  type: "signatures" | "confirmations";
  /** Color variant */
  variant: "gold" | "green";
  /** Label text */
  label: string;
}

/**
 * Calculate progress for an outgoing transaction (pending offer)
 */
export function getOutgoingProgress(offer: PendingOffer): SlotProgress {
  const requiredSignatures = offer.requiredSignatures || 2;
  const currentSignatures = offer.signatures.length;
  const isSigned = currentSignatures >= requiredSignatures;

  // If not yet signed, show signature collection progress
  if (!isSigned) {
    return {
      current: currentSignatures,
      max: requiredSignatures,
      type: "signatures",
      variant: "gold",
      label: `Signatures: ${currentSignatures}/${requiredSignatures}`,
    };
  }

  // If signed but not broadcast, ready to broadcast
  if (offer.status === "ready") {
    return {
      current: requiredSignatures,
      max: requiredSignatures,
      type: "signatures",
      variant: "green",
      label: "Ready to broadcast",
    };
  }

  // If broadcasting, show as in progress
  if (offer.status === "broadcasting") {
    return {
      current: 0,
      max: 10,
      type: "confirmations",
      variant: "gold",
      label: "Broadcasting...",
    };
  }

  // Default
  return {
    current: 0,
    max: requiredSignatures,
    type: "signatures",
    variant: "gold",
    label: "Pending",
  };
}

/**
 * Calculate progress for an incoming transaction
 */
export function getIncomingProgress(tx: MonitoredTransaction): SlotProgress {
  const confirmations = tx.confirmations || 0;
  const maxConfirmations = 10; // Stay in slot until 10 confirmations

  // 0-5 confirmations: gold progress bar
  if (confirmations < 6) {
    return {
      current: confirmations,
      max: maxConfirmations,
      type: "confirmations",
      variant: "gold",
      label: `Confirmations: ${confirmations}/10`,
    };
  }

  // 6-10 confirmations: green progress bar
  return {
    current: confirmations,
    max: maxConfirmations,
    type: "confirmations",
    variant: "green",
    label: `Confirmations: ${confirmations}/10`,
  };
}

/**
 * Get progress for any slot type
 */
export function getSlotProgress(slot: ExchangeSlotData): SlotProgress | null {
  if (slot.type === "empty") {
    return null;
  }

  if (slot.type === "outgoing") {
    return getOutgoingProgress(slot.data);
  }

  if (slot.type === "incoming") {
    return getIncomingProgress(slot.data);
  }

  return null;
}
