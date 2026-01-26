/**
 * Grand Satoshi Exchange - Mempool.space API Client
 *
 * API client for fetching transaction data and confirmations from mempool.space.
 * Supports mainnet and testnet with rate limiting and retry logic.
 */

import type { Network } from "@caravan/bitcoin";
import {
  parseMempoolError,
  logMempoolError,
  validateTransactionData,
  RateLimitError,
} from "./mempoolErrors";

/**
 * Transaction status from mempool.space
 */
export interface MempoolTransactionStatus {
  /** Whether transaction is confirmed in a block */
  confirmed: boolean;
  /** Block height (if confirmed) */
  block_height?: number;
  /** Block hash (if confirmed) */
  block_hash?: string;
  /** Block timestamp in Unix epoch seconds (if confirmed) */
  block_time?: number;
}

/**
 * Transaction input from mempool.space
 */
export interface MempoolTransactionInput {
  /** Previous transaction ID */
  txid: string;
  /** Output index being spent */
  vout: number;
  /** Prevout (previous output) */
  prevout?: {
    /** Script public key hex */
    scriptpubkey: string;
    /** Script public key address */
    scriptpubkey_address?: string;
    /** Script public key type */
    scriptpubkey_type: string;
    /** Value in satoshis */
    value: number;
  };
  /** Script signature hex */
  scriptsig: string;
  /** Script signature ASM */
  scriptsig_asm: string;
  /** Witness data */
  witness?: string[];
  /** Is coinbase */
  is_coinbase: boolean;
  /** Sequence number */
  sequence: number;
}

/**
 * Transaction output from mempool.space
 */
export interface MempoolTransactionOutput {
  /** Script public key hex */
  scriptpubkey: string;
  /** Script public key address */
  scriptpubkey_address?: string;
  /** Script public key type */
  scriptpubkey_type: string;
  /** Value in satoshis */
  value: number;
}

/**
 * Full transaction data from mempool.space
 */
export interface MempoolTransaction {
  /** Transaction ID */
  txid: string;
  /** Transaction version */
  version: number;
  /** Lock time */
  locktime: number;
  /** Inputs */
  vin: MempoolTransactionInput[];
  /** Outputs */
  vout: MempoolTransactionOutput[];
  /** Transaction size in bytes */
  size: number;
  /** Transaction weight */
  weight: number;
  /** Fee in satoshis */
  fee: number;
  /** Transaction status */
  status: MempoolTransactionStatus;
}

/**
 * Address transaction from mempool.space API
 * Simpler format returned from /address/{address}/txs endpoint
 */
export interface AddressTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout?: {
      scriptpubkey_address?: string;
      value: number;
    };
  }>;
  vout: Array<{
    scriptpubkey_address?: string;
    value: number;
  }>;
  status: MempoolTransactionStatus;
  fee: number;
}

/**
 * Error response from API
 */
export interface MempoolApiError {
  error: string;
  status?: number;
}

/**
 * Rate limiting configuration
 */
interface RateLimiter {
  lastRequest: number;
  minInterval: number;
}

/**
 * Mempool.space API Client
 * Handles rate limiting, retries, and network selection
 */
export class MempoolApiClient {
  private network: Network;
  private baseUrl: string;
  private rateLimiter: RateLimiter;

  constructor(network: Network) {
    this.network = network;
    this.baseUrl =
      network === "mainnet"
        ? "https://mempool.space/api"
        : "https://mempool.space/testnet/api";

    // Rate limit: max 10 req/sec = 100ms between requests
    this.rateLimiter = {
      lastRequest: 0,
      minInterval: 100,
    };
  }

  /**
   * Wait for rate limit if needed
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.rateLimiter.lastRequest;

    if (timeSinceLastRequest < this.rateLimiter.minInterval) {
      const waitTime = this.rateLimiter.minInterval - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.rateLimiter.lastRequest = Date.now();
  }

  /**
   * Make HTTP GET request with retry logic
   */
  private async fetchWithRetry<T>(url: string, maxRetries = 3): Promise<T> {
    let lastError: Error | null = null;

    console.log(
      `[MempoolAPI:fetchWithRetry] Attempting request (max ${maxRetries} retries)...`,
    );

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.waitForRateLimit();

        console.log(
          `[MempoolAPI:fetchWithRetry] Attempt ${attempt + 1}/${maxRetries}`,
        );
        const response = await fetch(url);

        if (!response.ok) {
          console.warn(
            `[MempoolAPI:fetchWithRetry] HTTP ${response.status}: ${response.statusText}`,
          );

          if (response.status === 429) {
            // Rate limited - exponential backoff
            const backoffMs = Math.pow(2, attempt) * 1000;
            console.warn(
              `[MempoolAPI:fetchWithRetry] ⏳ Rate limited (429), backing off ${backoffMs}ms...`,
            );
            throw new RateLimitError();
          }

          if (response.status === 404) {
            console.error(
              `[MempoolAPI:fetchWithRetry] ❌ Resource not found (404)`,
            );
            throw new Error(`HTTP 404: ${response.statusText}`);
          }

          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        console.log(
          `[MempoolAPI:fetchWithRetry] ✓ Response received, parsing JSON...`,
        );
        const data = await response.json();
        console.log(`[MempoolAPI:fetchWithRetry] ✓ JSON parsed successfully`);
        return data as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        console.warn(
          `[MempoolAPI:fetchWithRetry] ⚠️ Attempt ${attempt + 1} failed:`,
          lastError.message,
        );

        if (attempt < maxRetries - 1) {
          // Exponential backoff for network errors
          const backoffMs = Math.pow(2, attempt) * 500;
          console.warn(
            `[MempoolAPI:fetchWithRetry] ⏳ Retrying in ${backoffMs}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    console.error(
      `[MempoolAPI:fetchWithRetry] ❌ Failed after ${maxRetries} attempts:`,
      lastError?.message || "Unknown error",
    );
    throw new Error(
      `Failed after ${maxRetries} attempts: ${lastError?.message || "Unknown error"}`,
    );
  }

  /**
   * Get full transaction data by txid
   * @param txid - Transaction ID
   * @returns Full transaction data
   */
  async getTransaction(txid: string): Promise<MempoolTransaction> {
    const url = `${this.baseUrl}/tx/${txid}`;
    console.log(`[MempoolAPI:getTransaction] 🔍 Fetching: ${txid}`);
    console.log(`[MempoolAPI:getTransaction] URL: ${url}`);

    try {
      const data = await this.fetchWithRetry<MempoolTransaction>(url);

      // Validate response
      validateTransactionData(data, txid);

      // Log success with details
      const confirmStatus = data.status.confirmed
        ? `block ${data.status.block_height}`
        : "mempool";
      console.log(
        "[MempoolAPI:getTransaction] ✓",
        txid + ":",
        confirmStatus + ",",
        data.fee,
        "sats fee,",
        data.vin.length,
        "in,",
        data.vout.length,
        "out",
      );

      return data;
    } catch (error) {
      const mempoolError = parseMempoolError(error, txid);
      logMempoolError(mempoolError, "getTransaction");
      throw mempoolError;
    }
  }

  /**
   * Get transactions for a specific address
   * @param address - Bitcoin address
   * @returns Array of transactions involving this address
   */
  async getAddressTransactions(address: string): Promise<AddressTransaction[]> {
    const url = `${this.baseUrl}/address/${address}/txs`;
    console.log(`[MempoolAPI] Fetching transactions for address: ${address}`);

    try {
      const data = await this.fetchWithRetry<AddressTransaction[]>(url);
      console.log(
        `[MempoolAPI] ✓ Found ${data.length} transactions for ${address}`,
      );
      return data;
    } catch (error) {
      console.error(
        `[MempoolAPI] ❌ Failed to fetch transactions for ${address}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get current block height (tip of chain)
   * @returns Current block height
   */
  async getCurrentBlockHeight(): Promise<number> {
    const url = `${this.baseUrl}/blocks/tip/height`;
    console.log(`[MempoolAPI] Fetching current block height...`);

    try {
      const height = await this.fetchWithRetry<number>(url);
      console.log(`[MempoolAPI] ✓ Current block height: ${height}`);
      return height;
    } catch (error) {
      console.error(`[MempoolAPI] ❌ Failed to fetch block height:`, error);
      throw error;
    }
  }

  /**
   * Batch get multiple transactions
   * More efficient than calling getTransaction multiple times
   * @param txids - Array of transaction IDs
   * @returns Array of transactions (in same order as input)
   */
  async getTransactionBatch(txids: string[]): Promise<MempoolTransaction[]> {
    console.log(`[MempoolAPI] Batch fetching ${txids.length} transactions...`);

    // Fetch all in parallel, but rate limiting will still apply
    const promises = txids.map((txid) => this.getTransaction(txid));

    try {
      const results = await Promise.all(promises);
      console.log(
        `[MempoolAPI] ✓ Batch fetch complete: ${results.length} transactions`,
      );
      return results;
    } catch (error) {
      console.error(`[MempoolAPI] ❌ Batch fetch failed:`, error);
      throw error;
    }
  }

  /**
   * Calculate confirmations for a transaction
   * @param tx - Transaction data
   * @param currentHeight - Current block height (optional, will fetch if not provided)
   * @returns Number of confirmations (0 if unconfirmed)
   */
  async getConfirmations(
    tx: MempoolTransaction,
    currentHeight?: number,
  ): Promise<number> {
    if (!tx.status.confirmed || !tx.status.block_height) {
      return 0;
    }

    const tipHeight = currentHeight ?? (await this.getCurrentBlockHeight());
    return tipHeight - tx.status.block_height + 1;
  }

  /**
   * Update network (switches between mainnet/testnet)
   * @param network - New network to use
   */
  setNetwork(network: Network): void {
    this.network = network;
    this.baseUrl =
      network === "mainnet"
        ? "https://mempool.space/api"
        : "https://mempool.space/testnet/api";
    console.log(`[MempoolAPI] Network changed to: ${network}`);
  }

  /**
   * Get current network
   * @returns Current network
   */
  getNetwork(): Network {
    return this.network;
  }
}
