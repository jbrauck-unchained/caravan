/**
 * Grand Satoshi Exchange - Transaction Types
 *
 * TypeScript types for transaction creation, signing, and broadcasting.
 */

import type { UTXO } from "./wallet";

/**
 * Transaction Draft
 * User's work-in-progress transaction before PSBT creation
 */
export interface TransactionDraft {
  /** Selected UTXOs to spend */
  selectedUtxos: UTXO[];
  /** Destination address */
  destination: string;
  /** Amount to send in satoshis */
  amount: bigint;
  /** Fee rate in sat/vB */
  feeRate: number;
  /** Change address (auto-generated) */
  changeAddress: string;
  /** Estimated fee in satoshis */
  estimatedFee: bigint;
  /** Change amount in satoshis */
  changeAmount: bigint;
}

/**
 * Signature Set
 * A single signer's signature data
 */
export interface SignatureSet {
  /** Signer's fingerprint (xfp) */
  xfp: string;
  /** Signature data (depends on @caravan/wallets format) */
  signatures: any[];
  /** When signature was created */
  signedAt: Date;
}

/**
 * Pending Offer Status
 */
export type OfferStatus = "pending" | "signing" | "ready" | "broadcasting";

/**
 * Pending Offer
 * A transaction awaiting signatures or broadcast
 */
export interface PendingOffer {
  /** Unique offer ID */
  id: string;
  /** When offer was created */
  createdAt: Date;
  /** Unsigned PSBT (base64) */
  unsignedPsbt: string;
  /** Collected signatures */
  signatures: SignatureSet[];
  /** Required signatures (M from M-of-N) */
  requiredSignatures: number;
  /** Total possible signatures (N from M-of-N) */
  totalSignatures: number;
  /** Current offer status */
  status: OfferStatus;
  /** Destination address */
  destination: string;
  /** Amount being sent (satoshis) */
  amount: bigint;
  /** Transaction fee (satoshis) */
  fee: bigint;
  /** Fee rate (sat/vB) */
  feeRate: number;
  /** Input UTXOs */
  inputs: UTXO[];
  /** Change amount (if any) */
  changeAmount?: bigint;
  /** Change address (if any) */
  changeAddress?: string;
}

/**
 * Completed Transaction
 * A successfully broadcast transaction
 */
export interface CompletedTransaction {
  /** Transaction ID */
  txid: string;
  /** When transaction was broadcast */
  completedAt: Date;
  /** Amount sent (satoshis) */
  amount: bigint;
  /** Destination address */
  destination: string;
  /** Transaction fee (satoshis) */
  fee: bigint;
  /** Fee rate (sat/vB) */
  feeRate: number;
  /** Number of confirmations (if known) */
  confirmations?: number;
}

/**
 * Fee Rate Preset
 */
export interface FeeRatePreset {
  /** Label (e.g., "Slow", "Standard", "Fast") */
  label: string;
  /** Fee rate in sat/vB */
  rate: number;
  /** Estimated time to confirmation */
  eta: string;
  /** Number of blocks target */
  blocks: number;
}

/**
 * Coin Selection Result
 */
export interface CoinSelectionResult {
  /** Selected UTXOs */
  selected: UTXO[];
  /** Total input value */
  inputTotal: bigint;
  /** Estimated fee */
  fee: bigint;
  /** Change amount */
  change: bigint;
  /** Whether selection succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Transaction Summary
 * For review before signing
 */
export interface TransactionSummary {
  /** Input UTXOs */
  inputs: UTXO[];
  /** Total input value */
  inputTotal: bigint;
  /** Amount to send */
  sendAmount: bigint;
  /** Destination address */
  destination: string;
  /** Transaction fee */
  fee: bigint;
  /** Fee rate */
  feeRate: number;
  /** Change amount (if any) */
  change?: bigint;
  /** Change address (if any) */
  changeAddress?: string;
  /** Estimated transaction size (vBytes) */
  vsize: number;
}

/**
 * Broadcast Error
 */
export interface BroadcastError {
  /** Error code (if available) */
  code?: string;
  /** Human-readable error message */
  message: string;
  /** Whether error is recoverable */
  recoverable: boolean;
}

/**
 * Broadcast Result
 */
export interface BroadcastResult {
  /** Whether broadcast succeeded */
  success: boolean;
  /** Transaction ID (if successful) */
  txid?: string;
  /** Error details (if failed) */
  error?: BroadcastError;
}
