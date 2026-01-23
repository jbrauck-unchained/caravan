/**
 * Grand Satoshi Exchange - Coin Selection
 *
 * Algorithms for selecting UTXOs to spend in a transaction.
 */

import type { UTXO } from "@/types/wallet";
import type { MultisigWalletConfig } from "@caravan/multisig";
import type { CoinSelectionResult } from "@/types/transaction";
import { calculateFeeAndChange, isDust } from "./psbt";

/**
 * Largest-first coin selection algorithm
 * Selects the largest UTXOs first until target amount + fee is met
 */
export function selectCoinsLargestFirst(
  utxos: UTXO[],
  targetAmount: bigint,
  feeRate: number,
  walletConfig: MultisigWalletConfig,
): CoinSelectionResult {
  console.log("[CoinSelect] Largest-first selection");
  console.log("[CoinSelect] Target:", targetAmount, "sats");
  console.log("[CoinSelect] Fee rate:", feeRate, "sat/vB");

  // Sort UTXOs by value (largest first)
  const sortedUtxos = [...utxos].sort((a, b) => b.value - a.value);

  const selected: UTXO[] = [];
  let inputTotal = 0n;

  // Keep selecting until we have enough
  for (const utxo of sortedUtxos) {
    selected.push(utxo);
    inputTotal += BigInt(utxo.value);

    // Calculate fee with current selection
    const { fee, change } = calculateFeeAndChange(
      selected,
      targetAmount,
      feeRate,
      walletConfig,
    );

    // Check if we have enough
    if (inputTotal >= targetAmount + fee) {
      // Check if change is dust
      if (change > 0n && isDust(change)) {
        console.log("[CoinSelect] Change is dust, adding to fee");
        // Continue to next UTXO to avoid dust
        continue;
      }

      console.log("[CoinSelect] ✓ Selection successful");
      console.log("[CoinSelect] Selected:", selected.length, "UTXOs");
      console.log("[CoinSelect] Input total:", inputTotal.toString());
      console.log("[CoinSelect] Fee:", fee.toString());
      console.log("[CoinSelect] Change:", change.toString());

      return {
        selected,
        inputTotal,
        fee,
        change,
        success: true,
      };
    }
  }

  // Not enough funds
  console.error("[CoinSelect] ❌ Insufficient funds");
  console.error("[CoinSelect] Total available:", inputTotal.toString());
  console.error("[CoinSelect] Required:", targetAmount.toString());

  return {
    selected: [],
    inputTotal: 0n,
    fee: 0n,
    change: 0n,
    success: false,
    error: "Insufficient funds",
  };
}

/**
 * Smallest-first coin selection algorithm (for privacy)
 * Selects the smallest UTXOs first to consolidate small amounts
 */
export function selectCoinsSmallestFirst(
  utxos: UTXO[],
  targetAmount: bigint,
  feeRate: number,
  walletConfig: MultisigWalletConfig,
): CoinSelectionResult {
  console.log("[CoinSelect] Smallest-first selection");

  // Sort UTXOs by value (smallest first)
  const sortedUtxos = [...utxos].sort((a, b) => a.value - b.value);

  const selected: UTXO[] = [];
  let inputTotal = 0n;

  // Keep selecting until we have enough
  for (const utxo of sortedUtxos) {
    selected.push(utxo);
    inputTotal += BigInt(utxo.value);

    // Calculate fee with current selection
    const { fee, change } = calculateFeeAndChange(
      selected,
      targetAmount,
      feeRate,
      walletConfig,
    );

    // Check if we have enough
    if (inputTotal >= targetAmount + fee) {
      // Check if change is dust
      if (change > 0n && isDust(change)) {
        console.log("[CoinSelect] Change is dust, adding to fee");
        continue;
      }

      console.log("[CoinSelect] ✓ Selection successful");
      return {
        selected,
        inputTotal,
        fee,
        change,
        success: true,
      };
    }
  }

  return {
    selected: [],
    inputTotal: 0n,
    fee: 0n,
    change: 0n,
    success: false,
    error: "Insufficient funds",
  };
}

/**
 * Branch and bound coin selection (optimal)
 * Tries to find an exact match with no change output
 * Falls back to largest-first if no exact match found
 */
export function selectCoinsBranchAndBound(
  utxos: UTXO[],
  targetAmount: bigint,
  feeRate: number,
  walletConfig: MultisigWalletConfig,
): CoinSelectionResult {
  console.log("[CoinSelect] Branch-and-bound selection");

  // For simplicity, we'll use a greedy approximation
  // True branch-and-bound is complex and may be overkill for initial implementation

  // Try to find exact match first (no change)
  const exactMatch = findExactMatch(utxos, targetAmount, feeRate, walletConfig);

  if (exactMatch.success) {
    console.log("[CoinSelect] ✓ Found exact match (no change)");
    return exactMatch;
  }

  // Fall back to largest-first
  console.log("[CoinSelect] No exact match, using largest-first");
  return selectCoinsLargestFirst(utxos, targetAmount, feeRate, walletConfig);
}

/**
 * Try to find an exact match with no change output
 */
function findExactMatch(
  utxos: UTXO[],
  targetAmount: bigint,
  feeRate: number,
  walletConfig: MultisigWalletConfig,
): CoinSelectionResult {
  // Try single UTXOs first
  for (const utxo of utxos) {
    const selected = [utxo];
    const { fee, change } = calculateFeeAndChange(
      selected,
      targetAmount,
      feeRate,
      walletConfig,
    );

    // Check for exact match (change < dust threshold)
    if (change >= 0n && change < 546n) {
      return {
        selected,
        inputTotal: BigInt(utxo.value),
        fee: fee + change, // Add dust to fee
        change: 0n,
        success: true,
      };
    }
  }

  // Try pairs (limited search for performance)
  const maxPairs = Math.min(utxos.length, 50);
  for (let i = 0; i < maxPairs; i++) {
    for (let j = i + 1; j < maxPairs; j++) {
      const selected = [utxos[i], utxos[j]];
      const inputTotal = BigInt(utxos[i].value + utxos[j].value);
      const { fee, change } = calculateFeeAndChange(
        selected,
        targetAmount,
        feeRate,
        walletConfig,
      );

      if (change >= 0n && change < 546n) {
        return {
          selected,
          inputTotal,
          fee: fee + change,
          change: 0n,
          success: true,
        };
      }
    }
  }

  return {
    selected: [],
    inputTotal: 0n,
    fee: 0n,
    change: 0n,
    success: false,
  };
}

/**
 * Default coin selection (uses branch-and-bound)
 */
export function selectCoins(
  utxos: UTXO[],
  targetAmount: bigint,
  feeRate: number,
  walletConfig: MultisigWalletConfig,
): CoinSelectionResult {
  return selectCoinsBranchAndBound(utxos, targetAmount, feeRate, walletConfig);
}
