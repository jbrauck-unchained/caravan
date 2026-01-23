/**
 * Grand Satoshi Exchange - Wallet Validation
 *
 * Zod schemas for validating MultisigWalletConfig JSON imports.
 */

import { z } from "zod";
import { Network } from "@caravan/bitcoin";

/**
 * Extended public key schema (WalletConfigKeyDerivation)
 */
const ExtendedPublicKeySchema = z.object({
  xfp: z.string().min(8).max(8), // Master fingerprint (8 char hex)
  bip32Path: z.string().regex(/^m(\/\d+'?)+$/), // BIP32 path like m/48'/0'/0'/2'
  xpub: z.string().min(100), // xpubs are typically 111 chars
});

/**
 * Quorum configuration schema
 */
const QuorumSchema = z
  .object({
    requiredSigners: z.number().int().positive(),
    totalSigners: z.number().int().positive().optional(),
  })
  .refine(
    (data) => !data.totalSigners || data.requiredSigners <= data.totalSigners,
    {
      message: "Required signers must be less than or equal to total signers",
    },
  );

/**
 * Address type schema
 */
const AddressTypeSchema = z.enum(["P2SH", "P2WSH", "P2SH-P2WSH", "P2TR"]);

/**
 * Network schema
 */
const NetworkSchema = z.nativeEnum(Network);

/**
 * Ledger policy HMAC schema
 */
const LedgerPolicyHmacSchema = z.object({
  xfp: z.string(),
  policyHmac: z.string(),
});

/**
 * MultisigWalletConfig schema
 */
export const WalletConfigSchema = z.object({
  name: z.string().min(1, "Wallet name is required").optional(),
  addressType: AddressTypeSchema,
  network: NetworkSchema,
  quorum: QuorumSchema,
  extendedPublicKeys: z
    .array(ExtendedPublicKeySchema)
    .min(1, "At least one extended public key is required"),
  uuid: z.string().optional(),
  ledgerPolicyHmacs: z.array(LedgerPolicyHmacSchema).optional(),
});

export type ValidatedWalletConfig = z.infer<typeof WalletConfigSchema>;

/**
 * Validate wallet config JSON
 *
 * @param json - JSON string or object to validate
 * @returns Validated config or error
 */
export function validateWalletConfig(json: string | unknown): {
  success: boolean;
  data?: ValidatedWalletConfig;
  error?: string;
} {
  try {
    // Parse JSON if string
    const parsed = typeof json === "string" ? JSON.parse(json) : json;

    // Validate with Zod
    const result = WalletConfigSchema.safeParse(parsed);

    if (result.success) {
      return {
        success: true,
        data: result.data,
      };
    } else {
      // Format Zod errors nicely
      const firstError = result.error.errors[0];
      const errorMessage = `${firstError.path.join(".")}: ${firstError.message}`;

      return {
        success: false,
        error: errorMessage,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invalid JSON format",
    };
  }
}

/**
 * Validate wallet config and check for M-of-N consistency
 *
 * @param config - Wallet config to validate
 * @returns Validation result with detailed errors
 */
export function validateWalletConfigDetails(config: ValidatedWalletConfig): {
  success: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check M-of-N matches number of keys
  const totalSigners =
    config.quorum.totalSigners || config.extendedPublicKeys.length;
  if (config.extendedPublicKeys.length !== totalSigners) {
    errors.push(
      `Quorum specifies ${totalSigners} signers but ${config.extendedPublicKeys.length} keys provided`,
    );
  }

  // Check for duplicate xpubs
  const xpubs = config.extendedPublicKeys.map((k) => k.xpub);
  const uniqueXpubs = new Set(xpubs);
  if (xpubs.length !== uniqueXpubs.size) {
    errors.push("Duplicate extended public keys detected");
  }

  // Check for duplicate xfps (fingerprints)
  const xfps = config.extendedPublicKeys.map((k) => k.xfp);
  const uniqueXfps = new Set(xfps);
  if (xfps.length !== uniqueXfps.size) {
    errors.push("Duplicate master fingerprints (xfp) detected");
  }

  // Warn about mainnet
  if (config.network === Network.MAINNET) {
    warnings.push(
      "Using mainnet - ensure you have verified all xpubs carefully!",
    );
  }

  return {
    success: errors.length === 0,
    errors,
    warnings,
  };
}
