/**
 * Grand Satoshi Exchange - PSBT Utilities
 *
 * Functions for creating and manipulating PSBTs for multisig transactions.
 */

import { getUnsignedMultisigPsbtV0 } from "@caravan/psbt";
import type { PsbtInput, PsbtOutput } from "@caravan/psbt";
import type { MultisigWalletConfig } from "@caravan/multisig";
import {
  Network,
  estimateMultisigTransactionFee,
  deriveChildPublicKey,
  generateMultisigFromPublicKeys,
  multisigRedeemScript,
  multisigWitnessScript,
  P2SH,
  P2WSH,
  P2SH_P2WSH,
} from "@caravan/bitcoin";
import type { UTXO, AddressSlice } from "@/types/wallet";
import type { TransactionDraft } from "@/types/transaction";

/**
 * Fetch full transaction hex for a given txid
 * Required for PSBT inputs
 */
async function fetchTransactionHex(client: any, txid: string): Promise<string> {
  try {
    console.log(`[PSBT] Fetching transaction hex for ${txid}`);
    const txHex = await client.getTransactionHex(txid);
    console.log(`[PSBT] Got transaction hex (${txHex.length} chars)`);
    return txHex;
  } catch (error) {
    console.error(`[PSBT] Failed to fetch transaction ${txid}:`, error);
    throw new Error(
      `Failed to fetch transaction: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Find the address slice for a given address
 * Needed to get derivation path and multisig details
 */
function findAddressSlice(
  address: string,
  addresses: AddressSlice[],
): AddressSlice | undefined {
  return addresses.find((slice) => slice.address === address);
}

/**
 * Derive public key at a specific path from an extended public key
 */
function derivePublicKey(
  xpub: string,
  network: Network,
  change: number,
  index: number,
): string {
  // Derive change/index path relative to the xpub
  const bip32Path = `${change}/${index}`;
  return deriveChildPublicKey(xpub, bip32Path, network);
}

/**
 * Generate BIP32 derivation paths for all signers
 */
function generateBip32Derivations(
  walletConfig: MultisigWalletConfig,
  addressSlice: AddressSlice,
  network: Network,
): Array<{
  masterFingerprint: Buffer;
  path: string;
  pubkey: Buffer;
}> {
  const derivations: Array<{
    masterFingerprint: Buffer;
    path: string;
    pubkey: Buffer;
  }> = [];

  const [change, addressIndex] = addressSlice.bip32Path;

  for (const key of walletConfig.extendedPublicKeys) {
    // Derive the public key for this signer at this address
    const pubkeyHex = derivePublicKey(key.xpub, network, change, addressIndex);

    // Full derivation path
    const fullPath = `${key.bip32Path}/${change}/${addressIndex}`;

    derivations.push({
      masterFingerprint: Buffer.from(key.xfp, "hex"),
      path: fullPath,
      pubkey: Buffer.from(pubkeyHex, "hex"),
    });
  }

  return derivations;
}

/**
 * Generate redeem and witness scripts for the input
 */
function generateScripts(
  walletConfig: MultisigWalletConfig,
  addressSlice: AddressSlice,
  network: Network,
): { redeemScript?: Buffer; witnessScript?: Buffer } {
  const [change, addressIndex] = addressSlice.bip32Path;

  // Derive all public keys for this address
  const publicKeys = walletConfig.extendedPublicKeys.map((key) =>
    derivePublicKey(key.xpub, network, change, addressIndex),
  );

  const m = walletConfig.quorum.requiredSigners;
  const addressType = walletConfig.addressType;

  // Generate the multisig object which contains the scripts
  const multisig = generateMultisigFromPublicKeys(
    network,
    addressType,
    m,
    ...publicKeys,
  );

  const redeemScriptRaw = multisigRedeemScript(multisig);
  const witnessScriptRaw = multisigWitnessScript(multisig);

  // Extract the actual Buffer from the payment object
  // The functions return payment objects, not raw buffers
  const redeemScript = redeemScriptRaw?.output || redeemScriptRaw;
  const witnessScript = witnessScriptRaw?.output || witnessScriptRaw;

  if (addressType === P2SH) {
    return {
      redeemScript: redeemScript || undefined,
    };
  } else if (addressType === P2WSH) {
    return {
      witnessScript: witnessScript || undefined,
    };
  } else if (addressType === P2SH_P2WSH) {
    return {
      redeemScript: redeemScript || undefined,
      witnessScript: witnessScript || undefined,
    };
  }

  return {};
}

/**
 * Convert UTXO to PSBT input format
 */
async function utxoToPsbtInput(
  utxo: UTXO,
  walletConfig: MultisigWalletConfig,
  addresses: AddressSlice[],
  client: any,
  network: Network,
): Promise<PsbtInput> {
  // Find address slice to get derivation path
  const addressSlice = findAddressSlice(utxo.address, addresses);
  if (!addressSlice) {
    throw new Error(`Address ${utxo.address} not found in wallet addresses`);
  }

  // Fetch full transaction hex
  const transactionHex = await fetchTransactionHex(client, utxo.txid);

  // Convert txid to hash (reversed Buffer)
  const hash = Buffer.from(utxo.txid, "hex").reverse();

  // Generate BIP32 derivation paths for all signers
  const bip32Derivation = generateBip32Derivations(
    walletConfig,
    addressSlice,
    network,
  );

  // Generate redeem/witness scripts
  const scripts = generateScripts(walletConfig, addressSlice, network);

  // Create input
  const input: PsbtInput = {
    hash,
    index: utxo.vout,
    transactionHex,
    bip32Derivation,
    spendingWallet: walletConfig,
    ...scripts,
  };

  console.log(`[PSBT] Created input for ${utxo.txid}:${utxo.vout}`);
  return input;
}

/**
 * Create PSBT output for destination
 */
function createDestinationOutput(address: string, amount: bigint): PsbtOutput {
  return {
    address,
    value: Number(amount),
  };
}

/**
 * Create PSBT output for change
 */
function createChangeOutput(
  address: string,
  amount: bigint,
  _addressSlice: AddressSlice,
  _walletConfig: MultisigWalletConfig,
): PsbtOutput {
  const output: PsbtOutput = {
    address,
    value: Number(amount),
  };

  // TODO: Add bip32Derivation and scripts for change output
  // This requires deriving the public keys and creating the appropriate scripts
  // For now, we'll create a basic output without derivation info
  // Will enhance this when implementing hardware wallet signing

  return output;
}

/**
 * Estimate transaction fee
 */
function estimateFee(
  inputCount: number,
  outputCount: number,
  feeRate: number,
  walletConfig: MultisigWalletConfig,
): bigint {
  try {
    const fee = estimateMultisigTransactionFee({
      addressType: walletConfig.addressType,
      numInputs: inputCount,
      numOutputs: outputCount,
      m: walletConfig.quorum.requiredSigners,
      n:
        walletConfig.quorum.totalSigners ??
        walletConfig.extendedPublicKeys.length,
      feesPerByteInSatoshis: feeRate,
    });

    if (fee === null || fee === undefined) {
      throw new Error("Fee estimation returned null");
    }

    return BigInt(fee);
  } catch (error) {
    console.error("[PSBT] Fee estimation failed:", error);
    // Fallback: rough estimate
    const vsize = inputCount * 150 + outputCount * 50 + 50;
    return BigInt(Math.ceil(vsize * feeRate));
  }
}

/**
 * Create an unsigned multisig PSBT from a transaction draft
 */
export async function createUnsignedPsbt(
  draft: TransactionDraft,
  walletConfig: MultisigWalletConfig,
  network: Network,
  addresses: AddressSlice[],
  client: any,
): Promise<string> {
  console.log("[PSBT] Creating unsigned PSBT...");
  console.log("[PSBT] Draft:", {
    utxoCount: draft.selectedUtxos.length,
    destination: draft.destination,
    amount: draft.amount.toString(),
    feeRate: draft.feeRate,
  });

  // Validate inputs
  if (draft.selectedUtxos.length === 0) {
    throw new Error("No UTXOs selected");
  }
  if (!draft.destination) {
    throw new Error("No destination address");
  }
  if (draft.amount <= 0n) {
    throw new Error("Invalid amount");
  }
  if (draft.feeRate <= 0) {
    throw new Error("Invalid fee rate");
  }

  // Convert UTXOs to PSBT inputs
  console.log("[PSBT] Converting UTXOs to inputs...");
  const inputs = await Promise.all(
    draft.selectedUtxos.map((utxo) =>
      utxoToPsbtInput(utxo, walletConfig, addresses, client, network),
    ),
  );

  // Create destination output
  console.log("[PSBT] Creating destination output...");
  const outputs: PsbtOutput[] = [
    createDestinationOutput(draft.destination, draft.amount),
  ];

  // Add change output if needed
  if (draft.changeAmount > 0n) {
    console.log(
      `[PSBT] Creating change output: ${draft.changeAmount} sats to ${draft.changeAddress}`,
    );

    const changeSlice = findAddressSlice(draft.changeAddress, addresses);
    if (!changeSlice) {
      throw new Error(
        `Change address ${draft.changeAddress} not found in wallet`,
      );
    }

    outputs.push(
      createChangeOutput(
        draft.changeAddress,
        draft.changeAmount,
        changeSlice,
        walletConfig,
      ),
    );
  }

  // Create PSBT
  console.log("[PSBT] Generating PSBT...");
  console.log("[PSBT] Inputs:", inputs.length);
  console.log("[PSBT] Outputs:", outputs.length);

  const psbt = getUnsignedMultisigPsbtV0({
    network,
    inputs,
    outputs,
    includeGlobalXpubs: true,
  });

  // Convert to base64
  const psbtBase64 = psbt.toBase64();
  console.log("[PSBT] ✓ PSBT created successfully");
  console.log("[PSBT] PSBT length:", psbtBase64.length, "chars");

  return psbtBase64;
}

/**
 * Calculate fee and change for a transaction
 */
export function calculateFeeAndChange(
  selectedUtxos: UTXO[],
  sendAmount: bigint,
  feeRate: number,
  walletConfig: MultisigWalletConfig,
): { fee: bigint; change: bigint; totalInput: bigint } {
  // Calculate total input
  const totalInput = selectedUtxos.reduce(
    (sum, utxo) => sum + BigInt(utxo.value),
    0n,
  );

  // Estimate fee
  const outputCount = 2; // destination + change (we'll adjust if no change)
  const fee = estimateFee(
    selectedUtxos.length,
    outputCount,
    feeRate,
    walletConfig,
  );

  // Calculate change
  const change = totalInput - sendAmount - fee;

  return {
    fee,
    change,
    totalInput,
  };
}

/**
 * Validate that we have enough funds
 */
export function validateSufficientFunds(
  selectedUtxos: UTXO[],
  sendAmount: bigint,
  fee: bigint,
): boolean {
  const totalInput = selectedUtxos.reduce(
    (sum, utxo) => sum + BigInt(utxo.value),
    0n,
  );

  return totalInput >= sendAmount + fee;
}

/**
 * Check if change amount is dust
 * Dust threshold is typically 546 sats for P2WPKH/P2WSH
 */
export function isDust(amount: bigint): boolean {
  return amount < 546n;
}
