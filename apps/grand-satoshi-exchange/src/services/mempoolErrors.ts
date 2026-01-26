/**
 * Grand Satoshi Exchange - Mempool API Error Handling
 *
 * Custom error types and handlers for the mempool API.
 */

/**
 * Base class for all mempool API errors
 */
export class MempoolApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "MempoolApiError";
  }
}

/**
 * Rate limiting error (429)
 */
export class RateLimitError extends MempoolApiError {
  constructor(public readonly retryAfter?: number) {
    super(
      "Rate limit exceeded. Please try again later.",
      "RATE_LIMIT",
      429,
      true,
    );
    this.name = "RateLimitError";
  }
}

/**
 * Transaction not found error (404)
 */
export class TransactionNotFoundError extends MempoolApiError {
  constructor(public readonly txid: string) {
    super(`Transaction not found: ${txid}`, "TX_NOT_FOUND", 404, false);
    this.name = "TransactionNotFoundError";
  }
}

/**
 * Network error (connection issues)
 */
export class NetworkError extends MempoolApiError {
  constructor(message: string) {
    super(message, "NETWORK_ERROR", undefined, true);
    this.name = "NetworkError";
  }
}

/**
 * Invalid response error (malformed data)
 */
export class InvalidResponseError extends MempoolApiError {
  constructor(message: string) {
    super(message, "INVALID_RESPONSE", undefined, false);
    this.name = "InvalidResponseError";
  }
}

/**
 * Parse a fetch error into a specific error type
 */
export function parseMempoolError(
  error: unknown,
  txid?: string,
): MempoolApiError {
  // Already a MempoolApiError
  if (error instanceof MempoolApiError) {
    return error;
  }

  // Standard Error
  if (error instanceof Error) {
    // Network errors
    if (
      error.message.includes("fetch") ||
      error.message.includes("network") ||
      error.message.includes("offline")
    ) {
      return new NetworkError(error.message);
    }

    // Parse HTTP errors from message
    const httpMatch = error.message.match(/HTTP (\d+):/);
    if (httpMatch) {
      const statusCode = parseInt(httpMatch[1], 10);

      if (statusCode === 429) {
        return new RateLimitError();
      }

      if (statusCode === 404 && txid) {
        return new TransactionNotFoundError(txid);
      }

      return new MempoolApiError(
        error.message,
        `HTTP_${statusCode}`,
        statusCode,
        statusCode >= 500, // 5xx errors are retryable
      );
    }

    return new MempoolApiError(error.message, "UNKNOWN", undefined, false);
  }

  // Unknown error type
  return new MempoolApiError(String(error), "UNKNOWN", undefined, false);
}

/**
 * Log error with appropriate level
 */
export function logMempoolError(error: MempoolApiError, context: string): void {
  const prefix = `[MempoolAPI:${context}]`;

  if (error.retryable) {
    console.warn(
      `${prefix} ⚠️ Retryable error (${error.code}):`,
      error.message,
    );
  } else {
    console.error(`${prefix} ❌ Fatal error (${error.code}):`, error.message);
  }

  // Log additional details for debugging
  if (error.statusCode) {
    console.error(`${prefix} Status code:`, error.statusCode);
  }

  if (error instanceof TransactionNotFoundError) {
    console.error(`${prefix} Transaction ID:`, error.txid);
  }

  if (error instanceof RateLimitError && error.retryAfter) {
    console.error(`${prefix} Retry after:`, error.retryAfter, "seconds");
  }
}

/**
 * Validate transaction data from API
 */
export function validateTransactionData(data: any, txid: string): void {
  if (!data || typeof data !== "object") {
    throw new InvalidResponseError(`Invalid transaction data for ${txid}`);
  }

  if (data.txid !== txid) {
    throw new InvalidResponseError(
      `Transaction ID mismatch: expected ${txid}, got ${data.txid}`,
    );
  }

  if (!data.status || typeof data.status !== "object") {
    throw new InvalidResponseError(
      `Missing or invalid status field for ${txid}`,
    );
  }

  if (typeof data.status.confirmed !== "boolean") {
    throw new InvalidResponseError(
      `Missing or invalid confirmed field for ${txid}`,
    );
  }

  if (!Array.isArray(data.vin) || !Array.isArray(data.vout)) {
    throw new InvalidResponseError(
      `Missing or invalid inputs/outputs for ${txid}`,
    );
  }
}
