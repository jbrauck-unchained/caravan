/**
 * Grand Satoshi Exchange - Wallet Types
 *
 * TypeScript types for wallet state, UTXOs, and address management.
 */

import type { Network } from "@caravan/bitcoin";
import type { MultisigWalletConfig } from "@caravan/multisig";

/**
 * UTXO (Unspent Transaction Output)
 * Represents a spendable output in the wallet
 */
export interface UTXO {
  /** Transaction ID */
  txid: string;
  /** Output index */
  vout: number;
  /** Amount in satoshis */
  value: number;
  /** Bitcoin address */
  address: string;
  /** Confirmation count */
  confirmed: boolean;
  /** Block height (undefined if unconfirmed) */
  blockHeight?: number;
  /** Derivation path (e.g., "m/48'/0'/0'/2'/0/0") */
  path?: string;
  /** BIP32 path as array (e.g., [0, 0] for m/.../0/0) */
  bip32Derivation?: number[];
}

/**
 * Address Slice
 * Represents a derived address with metadata
 */
export interface AddressSlice {
  /** Bitcoin address */
  address: string;
  /** Derivation path (e.g., "m/48'/0'/0'/2'/0/0") */
  path: string;
  /** BIP32 path indices (e.g., [0, 0] for change=0, index=0) */
  bip32Path: [number, number];
  /** Whether this is a change address (1) or receiving address (0) */
  change: 0 | 1;
  /** Address index within the change/receiving branch */
  index: number;
  /** Balance in satoshis */
  balance: number;
  /** Number of UTXOs at this address */
  utxoCount: number;
  /** Whether this address has been used (has transactions) */
  used: boolean;
  /** Total received (for address reuse detection) */
  totalReceived: number;
}

/**
 * Wallet State
 * Complete state of a loaded multisig wallet
 */
export interface WalletState {
  /** Wallet configuration (xpubs, network, policy) */
  config: MultisigWalletConfig;
  /** Network (mainnet, testnet, signet) */
  network: Network;
  /** All fetched UTXOs */
  utxos: UTXO[];
  /** Derived addresses with balances */
  addresses: AddressSlice[];
  /** Total balance in satoshis */
  totalBalance: number;
  /** Number of confirmed UTXOs */
  confirmedUTXOCount: number;
  /** Number of unconfirmed UTXOs */
  unconfirmedUTXOCount: number;
  /** Last sync timestamp */
  lastSynced?: number;
  /** Whether wallet is currently syncing */
  isSyncing: boolean;
  /** Address generation indices */
  addressIndices: {
    /** Next unused receiving address index */
    receiving: number;
    /** Next unused change address index */
    change: number;
  };
}

/**
 * Wallet Import Error
 */
export interface WalletImportError {
  field?: string;
  message: string;
}

/**
 * Transaction Input
 * For spend transaction construction
 */
export interface TransactionInput {
  utxo: UTXO;
  /** Whether this input is selected for spending */
  selected: boolean;
}

/**
 * Transaction Output
 * Recipient for spend transaction
 */
export interface TransactionOutput {
  /** Recipient address */
  address: string;
  /** Amount in satoshis */
  value: number;
  /** Optional label */
  label?: string;
}

/**
 * Fee Rate Option
 * For transaction fee estimation
 */
export interface FeeRateOption {
  /** Label (e.g., "Low", "Medium", "High") */
  label: string;
  /** Fee rate in sat/vB */
  rate: number;
  /** Estimated confirmation time */
  eta?: string;
}

/**
 * Transaction Summary
 * Preview before signing
 */
export interface TransactionSummary {
  /** Selected inputs */
  inputs: UTXO[];
  /** Outputs (recipients + change) */
  outputs: TransactionOutput[];
  /** Total input value */
  inputTotal: number;
  /** Total output value (excluding fee) */
  outputTotal: number;
  /** Transaction fee */
  fee: number;
  /** Fee rate in sat/vB */
  feeRate: number;
  /** Virtual size in vB */
  vsize: number;
  /** Change output (if any) */
  changeOutput?: TransactionOutput;
}

/**
 * Signing Progress
 * Track multisig signing status
 */
export interface SigningProgress {
  /** Required signatures (M from M-of-N) */
  required: number;
  /** Total possible signers (N from M-of-N) */
  total: number;
  /** Current signature count */
  current: number;
  /** Whether transaction is fully signed */
  complete: boolean;
  /** Signer fingerprints that have signed */
  signed: string[];
}

/**
 * Broadcast Result
 */
export interface BroadcastResult {
  /** Transaction ID */
  txid: string;
  /** Whether broadcast succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Address Derivation Params
 * Parameters for deriving a specific address
 */
export interface AddressDerivationParams {
  /** Wallet config */
  config: MultisigWalletConfig;
  /** Network */
  network: Network;
  /** Change (0 = receiving, 1 = change) */
  change: 0 | 1;
  /** Address index */
  index: number;
}
