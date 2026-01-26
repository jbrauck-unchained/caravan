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
  MonitoredTransaction,
  TransactionUpdate,
  TransactionStatus,
} from "@/types/transaction";
import type { UTXO } from "@/types/wallet";

export interface TransactionState {
  /** Current draft transaction (work in progress) */
  currentDraft: TransactionDraft | null;
  /** Pending offers awaiting signatures/broadcast */
  pendingOffers: PendingOffer[];
  /** Completed transaction history */
  history: CompletedTransaction[];
  /** Transactions being monitored for confirmations */
  monitoredTransactions: MonitoredTransaction[];
  /** Archive of fully confirmed transactions */
  archivedTransactions: MonitoredTransaction[];
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

  // Transaction monitoring actions
  startMonitoring: (tx: MonitoredTransaction) => void;
  updateTransactionStatus: (update: TransactionUpdate) => void;
  archiveTransaction: (txid: string) => void;
  stopMonitoring: (txid: string) => void;
  getMonitoredTransaction: (txid: string) => MonitoredTransaction | undefined;
  archiveOldTransactions: (minConfirmations?: number) => void;
  cleanupArchive: (daysOld: number) => void;

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
      monitoredTransactions: [],
      archivedTransactions: [],
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

      // Start monitoring a transaction
      startMonitoring: (tx: MonitoredTransaction) => {
        const { monitoredTransactions } = get();

        // Check if already monitoring
        const exists = monitoredTransactions.some((t) => t.txid === tx.txid);
        if (exists) {
          console.warn(
            `[Store] Transaction ${tx.txid} is already being monitored`,
          );
          return;
        }

        console.log(`[Store] Started monitoring transaction: ${tx.txid}`);
        set({
          monitoredTransactions: [...monitoredTransactions, tx],
        });
      },

      // Update transaction status
      updateTransactionStatus: (update: TransactionUpdate) => {
        const { monitoredTransactions } = get();

        const updated = monitoredTransactions.map((tx) => {
          if (tx.txid !== update.txid) return tx;

          // Calculate new status based on confirmations
          let status: TransactionStatus;
          if (update.confirmations === 0) {
            status = "mempool";
          } else if (update.confirmations < 6) {
            status = "confirming";
          } else {
            status = "confirmed";
          }

          return {
            ...tx,
            confirmations: update.confirmations,
            status,
            blockHeight: update.blockHeight,
            blockTime: update.blockTime
              ? new Date(update.blockTime * 1000)
              : tx.blockTime,
            lastChecked: new Date(),
          };
        });

        console.log(
          `[Store] Updated transaction ${update.txid}: ${update.confirmations} confirmations`,
        );
        set({ monitoredTransactions: updated });
      },

      // Archive a transaction (move to archive)
      archiveTransaction: (txid: string) => {
        const { monitoredTransactions, archivedTransactions } = get();

        const tx = monitoredTransactions.find((t) => t.txid === txid);
        if (!tx) {
          console.warn(`[Store] Transaction ${txid} not found for archiving`);
          return;
        }

        console.log(`[Store] Archived transaction: ${txid}`);
        set({
          monitoredTransactions: monitoredTransactions.filter(
            (t) => t.txid !== txid,
          ),
          archivedTransactions: [
            { ...tx, status: "archived" },
            ...archivedTransactions,
          ],
        });
      },

      // Stop monitoring a transaction (remove completely)
      stopMonitoring: (txid: string) => {
        const { monitoredTransactions } = get();
        console.log(`[Store] Stopped monitoring transaction: ${txid}`);
        set({
          monitoredTransactions: monitoredTransactions.filter(
            (t) => t.txid !== txid,
          ),
        });
      },

      // Get a monitored transaction by txid
      getMonitoredTransaction: (txid: string) => {
        const { monitoredTransactions } = get();
        return monitoredTransactions.find((t) => t.txid === txid);
      },

      // Archive all transactions with >= minConfirmations
      archiveOldTransactions: (minConfirmations = 6) => {
        const { monitoredTransactions, archivedTransactions } = get();

        const toArchive = monitoredTransactions.filter(
          (tx) => tx.confirmations >= minConfirmations,
        );

        if (toArchive.length === 0) return;

        const remaining = monitoredTransactions.filter(
          (tx) => tx.confirmations < minConfirmations,
        );

        console.log(`[Store] Auto-archived ${toArchive.length} transactions`);
        set({
          monitoredTransactions: remaining,
          archivedTransactions: [
            ...toArchive.map((tx) => ({
              ...tx,
              status: "archived" as TransactionStatus,
            })),
            ...archivedTransactions,
          ],
        });
      },

      // Clean up old archived transactions
      cleanupArchive: (daysOld: number) => {
        const { archivedTransactions } = get();
        const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

        const filtered = archivedTransactions.filter(
          (tx) => new Date(tx.firstSeen) > cutoffDate,
        );

        const removed = archivedTransactions.length - filtered.length;
        if (removed > 0) {
          console.log(
            `[Store] Cleaned up ${removed} old archived transactions`,
          );
          set({ archivedTransactions: filtered });
        }
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
      // Persist pending offers, history, and monitored transactions
      partialize: (state) => ({
        pendingOffers: state.pendingOffers,
        history: state.history,
        monitoredTransactions: state.monitoredTransactions,
        archivedTransactions: state.archivedTransactions,
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

          if (state.monitoredTransactions) {
            state.monitoredTransactions = state.monitoredTransactions.map(
              (tx: any) => ({
                ...tx,
                amount: BigInt(tx.amount),
                fee: tx.fee ? BigInt(tx.fee) : undefined,
                firstSeen: new Date(tx.firstSeen),
                lastChecked: new Date(tx.lastChecked),
                blockTime: tx.blockTime ? new Date(tx.blockTime) : undefined,
              }),
            );
          }

          if (state.archivedTransactions) {
            state.archivedTransactions = state.archivedTransactions.map(
              (tx: any) => ({
                ...tx,
                amount: BigInt(tx.amount),
                fee: tx.fee ? BigInt(tx.fee) : undefined,
                firstSeen: new Date(tx.firstSeen),
                lastChecked: new Date(tx.lastChecked),
                blockTime: tx.blockTime ? new Date(tx.blockTime) : undefined,
              }),
            );
          }

          return { state, version: 0 };
        },
        setItem: (name, value) => {
          const { state } = value;

          // Convert BigInt to string for serialization
          const serializable = {
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
            monitoredTransactions: state.monitoredTransactions?.map(
              (tx: MonitoredTransaction) => ({
                ...tx,
                amount: tx.amount.toString(),
                fee: tx.fee?.toString(),
              }),
            ),
            archivedTransactions: state.archivedTransactions?.map(
              (tx: MonitoredTransaction) => ({
                ...tx,
                amount: tx.amount.toString(),
                fee: tx.fee?.toString(),
              }),
            ),
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

/**
 * Hook to get monitored transactions
 */
export const useMonitoredTransactions = (): MonitoredTransaction[] => {
  return useTransactionStore((state) => state.monitoredTransactions);
};

/**
 * Hook to get archived transactions
 */
export const useArchivedTransactions = (): MonitoredTransaction[] => {
  return useTransactionStore((state) => state.archivedTransactions);
};

/**
 * Hook to get a specific monitored transaction
 */
export const useMonitoredTransaction = (
  txid: string,
): MonitoredTransaction | undefined => {
  return useTransactionStore((state) =>
    state.monitoredTransactions.find((tx) => tx.txid === txid),
  );
};
