/**
 * Grand Satoshi Exchange - Transaction Store
 *
 * Zustand store for managing transaction drafts, pending offers, and history.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  TransactionDraft,
  PendingOffer,
  CompletedTransaction,
  SignatureSet,
} from "@/types/transaction";
import type { UTXO } from "@/types/wallet";

export interface TransactionState {
  /** Current draft transaction (work in progress) */
  currentDraft: TransactionDraft | null;
  /** Pending offers awaiting signatures/broadcast */
  pendingOffers: PendingOffer[];
  /** Completed transaction history */
  history: CompletedTransaction[];
  /** Whether an operation is in progress */
  isProcessing: boolean;
  /** Error message */
  error: string | null;

  // Draft actions
  startDraft: () => void;
  selectUtxo: (utxo: UTXO) => void;
  deselectUtxo: (utxo: UTXO) => void;
  clearSelectedUtxos: () => void;
  setDestination: (address: string) => void;
  setAmount: (sats: bigint) => void;
  setFeeRate: (rate: number) => void;
  setChangeAddress: (address: string) => void;
  setEstimatedFee: (fee: bigint) => void;
  updateDraft: (updates: Partial<TransactionDraft>) => void;
  cancelDraft: () => void;

  // Offer actions
  createOffer: (offer: PendingOffer) => void;
  addSignature: (offerId: string, sig: SignatureSet) => void;
  updateOfferStatus: (offerId: string, status: PendingOffer["status"]) => void;
  removeOffer: (offerId: string) => void;
  cancelOffer: (offerId: string) => void;

  // History actions
  addToHistory: (tx: CompletedTransaction) => void;
  clearHistory: () => void;

  // Error handling
  setError: (error: string | null) => void;
  clearError: () => void;
}

/**
 * Transaction Store
 * Manages transaction creation workflow
 */
export const useTransactionStore = create<TransactionState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentDraft: null,
      pendingOffers: [],
      history: [],
      isProcessing: false,
      error: null,

      // Start a new draft
      startDraft: () => {
        set({
          currentDraft: {
            selectedUtxos: [],
            destination: "",
            amount: 0n,
            feeRate: 0,
            changeAddress: "",
            estimatedFee: 0n,
            changeAmount: 0n,
          },
          error: null,
        });
      },

      // Select UTXO for spending
      selectUtxo: (utxo: UTXO) => {
        const { currentDraft } = get();
        if (!currentDraft) return;

        // Check if already selected
        const alreadySelected = currentDraft.selectedUtxos.some(
          (u) => u.txid === utxo.txid && u.vout === utxo.vout,
        );

        if (!alreadySelected) {
          set({
            currentDraft: {
              ...currentDraft,
              selectedUtxos: [...currentDraft.selectedUtxos, utxo],
            },
          });
        }
      },

      // Deselect UTXO
      deselectUtxo: (utxo: UTXO) => {
        const { currentDraft } = get();
        if (!currentDraft) return;

        set({
          currentDraft: {
            ...currentDraft,
            selectedUtxos: currentDraft.selectedUtxos.filter(
              (u) => !(u.txid === utxo.txid && u.vout === utxo.vout),
            ),
          },
        });
      },

      // Clear all selected UTXOs
      clearSelectedUtxos: () => {
        const { currentDraft } = get();
        if (!currentDraft) return;

        set({
          currentDraft: {
            ...currentDraft,
            selectedUtxos: [],
          },
        });
      },

      // Set destination address
      setDestination: (address: string) => {
        const { currentDraft } = get();
        if (!currentDraft) return;

        set({
          currentDraft: {
            ...currentDraft,
            destination: address,
          },
        });
      },

      // Set send amount
      setAmount: (sats: bigint) => {
        const { currentDraft } = get();
        if (!currentDraft) return;

        set({
          currentDraft: {
            ...currentDraft,
            amount: sats,
          },
        });
      },

      // Set fee rate
      setFeeRate: (rate: number) => {
        const { currentDraft } = get();
        if (!currentDraft) return;

        set({
          currentDraft: {
            ...currentDraft,
            feeRate: rate,
          },
        });
      },

      // Set change address
      setChangeAddress: (address: string) => {
        const { currentDraft } = get();
        if (!currentDraft) return;

        set({
          currentDraft: {
            ...currentDraft,
            changeAddress: address,
          },
        });
      },

      // Set estimated fee
      setEstimatedFee: (fee: bigint) => {
        const { currentDraft } = get();
        if (!currentDraft) return;

        // Recalculate change amount
        const totalInput = currentDraft.selectedUtxos.reduce(
          (sum, utxo) => sum + BigInt(utxo.value),
          0n,
        );
        const changeAmount = totalInput - currentDraft.amount - fee;

        set({
          currentDraft: {
            ...currentDraft,
            estimatedFee: fee,
            changeAmount,
          },
        });
      },

      // Update draft with partial updates
      updateDraft: (updates: Partial<TransactionDraft>) => {
        const { currentDraft } = get();
        if (!currentDraft) return;

        set({
          currentDraft: {
            ...currentDraft,
            ...updates,
          },
        });
      },

      // Cancel draft
      cancelDraft: () => {
        set({ currentDraft: null, error: null });
      },

      // Create new pending offer
      createOffer: (offer: PendingOffer) => {
        const { pendingOffers } = get();

        set({
          pendingOffers: [...pendingOffers, offer],
          currentDraft: null,
          error: null,
        });
      },

      // Add signature to offer
      addSignature: (offerId: string, sig: SignatureSet) => {
        const { pendingOffers } = get();

        const updatedOffers = pendingOffers.map((offer) => {
          if (offer.id !== offerId) return offer;

          // Check if this signer already signed
          const alreadySigned = offer.signatures.some((s) => s.xfp === sig.xfp);
          if (alreadySigned) {
            console.warn(`Signer ${sig.xfp} already signed offer ${offerId}`);
            return offer;
          }

          // Add signature
          const newSignatures = [...offer.signatures, sig];
          const signatureCount = newSignatures.length;

          // Update status if quorum reached
          const newStatus: PendingOffer["status"] =
            signatureCount >= offer.requiredSignatures ? "ready" : "pending";

          return {
            ...offer,
            signatures: newSignatures,
            status: newStatus,
          };
        });

        set({ pendingOffers: updatedOffers });
      },

      // Update offer status
      updateOfferStatus: (offerId: string, status: PendingOffer["status"]) => {
        const { pendingOffers } = get();

        const updatedOffers = pendingOffers.map((offer) => {
          if (offer.id !== offerId) return offer;
          return { ...offer, status };
        });

        set({ pendingOffers: updatedOffers });
      },

      // Remove offer from pending list
      removeOffer: (offerId: string) => {
        const { pendingOffers } = get();
        set({
          pendingOffers: pendingOffers.filter((offer) => offer.id !== offerId),
        });
      },

      // Cancel offer
      cancelOffer: (offerId: string) => {
        get().removeOffer(offerId);
      },

      // Add to history
      addToHistory: (tx: CompletedTransaction) => {
        const { history } = get();
        set({
          history: [tx, ...history], // Most recent first
        });
      },

      // Clear history
      clearHistory: () => {
        set({ history: [] });
      },

      // Set error
      setError: (error: string | null) => {
        set({ error });
      },

      // Clear error
      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: "gse-transaction-storage",
      // Persist pending offers and history, but not current draft
      partialize: (state) => ({
        pendingOffers: state.pendingOffers,
        history: state.history,
      }),
      // Custom storage to handle BigInt serialization
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const { state } = JSON.parse(str);

          // Convert string amounts back to BigInt
          if (state.pendingOffers) {
            state.pendingOffers = state.pendingOffers.map((offer: any) => ({
              ...offer,
              amount: BigInt(offer.amount),
              fee: BigInt(offer.fee),
              changeAmount: offer.changeAmount
                ? BigInt(offer.changeAmount)
                : undefined,
            }));
          }

          if (state.history) {
            state.history = state.history.map((tx: any) => ({
              ...tx,
              amount: BigInt(tx.amount),
              fee: BigInt(tx.fee),
            }));
          }

          return { state, version: 0 };
        },
        setItem: (name, value) => {
          const { state } = value;

          // Convert BigInt to string for serialization
          const serializable = {
            ...state,
            pendingOffers: state.pendingOffers?.map((offer: PendingOffer) => ({
              ...offer,
              amount: offer.amount.toString(),
              fee: offer.fee.toString(),
              changeAmount: offer.changeAmount?.toString(),
            })),
            history: state.history?.map((tx: CompletedTransaction) => ({
              ...tx,
              amount: tx.amount.toString(),
              fee: tx.fee.toString(),
            })),
          };

          localStorage.setItem(
            name,
            JSON.stringify({ state: serializable, version: 0 }),
          );
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    },
  ),
);

/**
 * Hook to get current draft
 */
export const useDraft = (): TransactionDraft | null => {
  return useTransactionStore((state) => state.currentDraft);
};

/**
 * Hook to check if draft exists
 */
export const useHasDraft = (): boolean => {
  return useTransactionStore((state) => state.currentDraft !== null);
};

/**
 * Hook to get pending offers
 */
export const usePendingOffers = (): PendingOffer[] => {
  return useTransactionStore((state) => state.pendingOffers);
};

/**
 * Hook to get transaction history
 */
export const useTransactionHistory = (): CompletedTransaction[] => {
  return useTransactionStore((state) => state.history);
};

/**
 * Hook to get specific offer by ID
 */
export const useOffer = (offerId: string): PendingOffer | undefined => {
  return useTransactionStore((state) =>
    state.pendingOffers.find((offer) => offer.id === offerId),
  );
};
