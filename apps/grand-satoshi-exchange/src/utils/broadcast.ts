/**
 * Grand Satoshi Exchange - Broadcast Utilities
 *
 * Functions for finalizing PSBTs and broadcasting transactions.
 */

import { Psbt } from "bitcoinjs-lib";
import type { BlockchainClient } from "@caravan/clients";
import type { SignatureSet } from "@/types/transaction";

/**
 * Combine multiple signed PSBTs into one fully signed PSBT
 * Each signer returns a PSBT with their signatures added
 */
function combinePSBTs(unsignedPsbt: string, signatures: SignatureSet[]): Psbt {
  console.log("[Broadcast] Combining PSBTs...");
  console.log("[Broadcast] Base PSBT:", unsignedPsbt.substring(0, 50) + "...");
  console.log("[Broadcast] Signatures:", signatures.length);

  // Start with the unsigned PSBT
  const psbt = Psbt.fromBase64(unsignedPsbt);

  // Combine each signed PSBT
  for (const signatureSet of signatures) {
    console.log(`[Broadcast] Combining signature from ${signatureSet.xfp}`);

    // Each signature set contains the signed PSBT as a base64 string
    // The signature is stored in signatures[0] from our hardware wallet hook
    const signedPsbtBase64 = signatureSet.signatures[0];

    if (typeof signedPsbtBase64 === "string") {
      const signedPsbt = Psbt.fromBase64(signedPsbtBase64);

      // Combine the signatures from the signed PSBT into our main PSBT
      psbt.combine(signedPsbt);

      console.log(`[Broadcast] ✓ Combined signature from ${signatureSet.xfp}`);
    } else {
      console.warn(
        `[Broadcast] Unexpected signature format for ${signatureSet.xfp}`,
      );
    }
  }

  return psbt;
}

/**
 * Finalize a PSBT (add final scripts and extract transaction)
 */
function finalizePsbt(psbt: Psbt): string {
  console.log("[Broadcast] Finalizing PSBT...");

  try {
    // Finalize all inputs
    psbt.finalizeAllInputs();

    // Extract the raw transaction
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();

    console.log("[Broadcast] ✓ PSBT finalized");
    console.log("[Broadcast] Transaction hex length:", txHex.length);

    return txHex;
  } catch (error) {
    console.error("[Broadcast] Finalization failed:", error);
    throw new Error(
      `Failed to finalize PSBT: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Broadcast a transaction to the network
 */
export async function broadcastTransaction(
  unsignedPsbt: string,
  signatures: SignatureSet[],
  client: BlockchainClient,
): Promise<string> {
  console.log("[Broadcast] 🚀 Starting broadcast process...");

  try {
    // Step 1: Combine all signed PSBTs
    const combinedPsbt = combinePSBTs(unsignedPsbt, signatures);

    // Step 2: Finalize the PSBT
    const txHex = finalizePsbt(combinedPsbt);

    // Step 3: Broadcast to network
    console.log("[Broadcast] Broadcasting transaction...");
    const txid = await client.broadcastTransaction(txHex);

    console.log("[Broadcast] ✓ Transaction broadcast successful!");
    console.log("[Broadcast] TXID:", txid);

    return txid;
  } catch (error) {
    console.error("[Broadcast] ❌ Broadcast failed:", error);

    // Parse common errors
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("dust")) {
      throw new Error(
        "Transaction rejected: Output amount too small (dust threshold)",
      );
    } else if (errorMessage.includes("fee")) {
      throw new Error(
        "Transaction rejected: Insufficient fee for network conditions",
      );
    } else if (errorMessage.includes("already in block chain")) {
      throw new Error("Transaction already broadcast");
    } else if (errorMessage.includes("non-final")) {
      throw new Error("Transaction not finalized properly");
    } else if (errorMessage.includes("bad-txns-inputs-missingorspent")) {
      throw new Error("Transaction inputs already spent");
    } else {
      throw new Error(`Broadcast failed: ${errorMessage}`);
    }
  }
}

/**
 * Get block explorer URL for a transaction
 */
export function getExplorerUrl(txid: string, network: string): string {
  const baseUrl = "https://mempool.space";

  switch (network.toLowerCase()) {
    case "mainnet":
      return `${baseUrl}/tx/${txid}`;
    case "testnet":
      return `${baseUrl}/testnet/tx/${txid}`;
    case "signet":
      return `${baseUrl}/signet/tx/${txid}`;
    default:
      return `${baseUrl}/tx/${txid}`;
  }
}
