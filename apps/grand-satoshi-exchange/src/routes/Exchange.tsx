/**
 * Grand Satoshi Exchange - Exchange View
 *
 * Displays pending transaction offers in OSRS Grand Exchange style.
 */

import { useState } from "react";
import { OfferSlot } from "../components/exchange/OfferSlot";
import { CreateOfferModal } from "../components/exchange/CreateOfferModal";
import { SigningModal } from "../components/hardware/SigningModal";
import { OfferCompleteModal } from "../components/exchange/OfferCompleteModal";
import { ConfirmDialog } from "../components/ui/Modal";
import {
  usePendingOffers,
  useTransactionStore,
} from "@/stores/transactionStore";
import { useHasWallet } from "@/stores/walletStore";
import { useClient, useClientStore } from "@/stores/clientStore";
import { broadcastTransaction } from "@/utils/broadcast";
import type { SignatureSet, CompletedTransaction } from "@/types/transaction";

export function Exchange() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSigningModal, setShowSigningModal] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [offerToCancel, setOfferToCancel] = useState<string | null>(null);
  const [completedTx, setCompletedTx] = useState<CompletedTransaction | null>(
    null,
  );

  // Get pending offers from store
  const pendingOffers = usePendingOffers();
  const hasWallet = useHasWallet();
  const client = useClient();

  // Get selected offer - must use the store directly to avoid conditional hook call
  const selectedOffer = useTransactionStore((state) =>
    selectedOfferId
      ? state.pendingOffers.find((o) => o.id === selectedOfferId)
      : null,
  );
  const network = useClientStore((state) => state.network);
  const { removeOffer, updateOfferStatus, addSignature, addToHistory } =
    useTransactionStore();

  // Create 8 slots
  const slots = Array.from({ length: 8 }, (_, index) => {
    const offer = pendingOffers[index] ?? null;
    return {
      slotNumber: index + 1,
      offer,
    };
  });

  // Handlers
  const handleCreateNew = () => {
    console.log("[Exchange] Create new offer clicked");
    setShowCreateModal(true);
    // TODO: Open CreateOfferModal
  };

  const handleSign = (offerId: string) => {
    console.log("[Exchange] handleSign called");
    console.log("[Exchange] Sign offer:", offerId);
    console.log("[Exchange] Current showSigningModal:", showSigningModal);
    setSelectedOfferId(offerId);
    setShowSigningModal(true);
    console.log("[Exchange] After setState - showSigningModal should be true");
  };

  const handleSignatureCollected = (signature: SignatureSet) => {
    if (selectedOfferId) {
      console.log("[Exchange] Signature collected for:", selectedOfferId);
      addSignature(selectedOfferId, signature);
    }
  };

  const handleBroadcast = async (offerId: string) => {
    console.log("[Exchange] Broadcast offer:", offerId);

    if (!client) {
      console.error("[Exchange] No client available");
      return;
    }

    const offer = pendingOffers.find((o) => o.id === offerId);
    if (!offer) {
      console.error("[Exchange] Offer not found");
      return;
    }

    updateOfferStatus(offerId, "broadcasting");

    try {
      // Broadcast the transaction
      const txid = await broadcastTransaction(
        offer.unsignedPsbt,
        offer.signatures,
        client,
      );

      console.log("[Exchange] ✓ Broadcast successful:", txid);

      // Create completed transaction record
      const completedTx: CompletedTransaction = {
        txid,
        completedAt: new Date(),
        amount: offer.amount,
        destination: offer.destination,
        fee: offer.fee,
        feeRate: offer.feeRate,
      };

      // Add to history
      addToHistory(completedTx);

      // Remove from pending offers
      removeOffer(offerId);

      // Show completion modal
      setCompletedTx(completedTx);
      setShowCompleteModal(true);

      // TODO: Trigger UTXO refresh (will implement when we add the method to wallet store)
    } catch (error) {
      console.error("[Exchange] Broadcast failed:", error);
      updateOfferStatus(offerId, "pending");

      // Show error to user
      alert(
        `Broadcast failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const handleCancel = (offerId: string) => {
    console.log("[Exchange] Cancel offer:", offerId);
    setOfferToCancel(offerId);
    setCancelDialogOpen(true);
  };

  const confirmCancel = () => {
    if (offerToCancel) {
      removeOffer(offerToCancel);
      setOfferToCancel(null);
    }
  };

  // No wallet loaded
  if (!hasWallet) {
    return (
      <div style={{ padding: "20px" }}>
        <div
          style={{
            padding: "40px",
            textAlign: "center",
            backgroundColor: "var(--osrs-brown-dark)",
            borderRadius: "4px",
            border: "2px solid var(--inv-slot-border)",
          }}
        >
          <h2
            style={{
              color: "var(--osrs-text-yellow)",
              marginBottom: "16px",
              fontSize: "24px",
            }}
          >
            No Wallet Loaded
          </h2>
          <p
            style={{
              color: "var(--osrs-text-white)",
              marginBottom: "24px",
              fontSize: "14px",
            }}
          >
            Please import a wallet from the Bank view to create offers.
          </p>
        </div>
      </div>
    );
  }

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
        Grand Exchange (Pending Transactions)
      </h3>

      {/* 8 Offer Slots in 2x4 grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        {slots.map(({ slotNumber, offer }) => (
          <OfferSlot
            key={slotNumber}
            slotNumber={slotNumber}
            offer={offer}
            onCreateNew={handleCreateNew}
            onSign={handleSign}
            onBroadcast={handleBroadcast}
            onCancel={handleCancel}
          />
        ))}
      </div>

      {/* Collection Box (for completed transactions) */}
      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-medium)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
        }}
      >
        <h4
          style={{
            color: "var(--osrs-text-yellow)",
            marginBottom: "8px",
            fontSize: "16px",
          }}
        >
          Collection Box
        </h4>
        <p
          style={{
            color: "var(--osrs-text-gray)",
            fontSize: "12px",
            fontStyle: "italic",
          }}
        >
          Completed transactions will appear here
        </p>
      </div>

      {/* Instructions */}
      <div
        style={{
          marginTop: "16px",
          padding: "12px",
          backgroundColor: "var(--osrs-brown-dark)",
          borderRadius: "4px",
          border: "2px solid var(--inv-slot-border)",
        }}
      >
        <p
          style={{
            color: "var(--osrs-text-white)",
            fontSize: "12px",
            lineHeight: "1.5",
          }}
        >
          💡 <strong>How it works:</strong> Create an offer to send bitcoin.
          Sign with your hardware wallet(s). Once enough signatures are
          collected, broadcast the transaction to the network!
        </p>
      </div>

      {/* Create Offer Modal */}
      <CreateOfferModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />

      {/* Signing Modal */}
      <SigningModal
        isOpen={showSigningModal}
        onClose={() => {
          setShowSigningModal(false);
          setSelectedOfferId(null);
        }}
        offer={selectedOffer ?? null}
        onSignatureCollected={handleSignatureCollected}
      />

      {/* Offer Complete Modal */}
      {completedTx && (
        <OfferCompleteModal
          isOpen={showCompleteModal}
          onClose={() => {
            setShowCompleteModal(false);
            setCompletedTx(null);
          }}
          txid={completedTx.txid}
          amount={completedTx.amount}
          destination={completedTx.destination}
          fee={completedTx.fee}
          network={network}
        />
      )}

      {/* Cancel Confirmation Dialog */}
      <ConfirmDialog
        isOpen={cancelDialogOpen}
        onClose={() => setCancelDialogOpen(false)}
        onConfirm={confirmCancel}
        title="Cancel Offer"
        message="Are you sure you want to cancel this offer? This action cannot be undone."
        confirmText="Yes, Cancel Offer"
        cancelText="No, Keep It"
        confirmVariant="danger"
      />
    </div>
  );
}
