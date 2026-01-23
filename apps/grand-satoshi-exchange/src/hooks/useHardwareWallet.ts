/**
 * Grand Satoshi Exchange - Hardware Wallet Hook
 *
 * React hook for signing PSBTs with Ledger and Trezor hardware wallets.
 */

import { useState, useCallback } from "react";
import { SignMultisigTransaction, LEDGER, TREZOR } from "@caravan/wallets";
import type { MultisigWalletConfig } from "@caravan/multisig";
import type { SignatureSet } from "@/types/transaction";

export type SigningStatus =
  | "idle"
  | "connecting"
  | "signing"
  | "success"
  | "error";

export interface UseHardwareWalletReturn {
  status: SigningStatus;
  error: string | null;
  progress: string | null;
  signWithLedger: (
    psbt: string,
    config: MultisigWalletConfig,
    signerXfp: string,
  ) => Promise<SignatureSet>;
  signWithTrezor: (
    psbt: string,
    config: MultisigWalletConfig,
    signerXfp: string,
  ) => Promise<SignatureSet>;
  reset: () => void;
}

/**
 * Hook for hardware wallet interactions
 */
export function useHardwareWallet(): UseHardwareWalletReturn {
  const [status, setStatus] = useState<SigningStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  /**
   * Reset hook state
   */
  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setProgress(null);
  }, []);

  /**
   * Sign with Ledger hardware wallet
   */
  const signWithLedger = useCallback(
    async (
      psbt: string,
      config: MultisigWalletConfig,
      signerXfp: string,
    ): Promise<SignatureSet> => {
      console.log("[HW] Starting Ledger signing...");
      console.log("[HW] Signer XFP:", signerXfp);

      setStatus("connecting");
      setError(null);
      setProgress("Connecting to Ledger...");

      try {
        // Validate wallet config structure
        if (
          !config.extendedPublicKeys ||
          !Array.isArray(config.extendedPublicKeys)
        ) {
          console.error(
            "[HW] Invalid wallet config - extendedPublicKeys:",
            config.extendedPublicKeys,
          );
          throw new Error(
            "Wallet configuration is invalid. Please re-import your wallet.",
          );
        }

        console.log(
          "[HW] Config has",
          config.extendedPublicKeys.length,
          "extended public keys",
        );

        // Find the signer's key details
        const signerKey = config.extendedPublicKeys.find(
          (key) => key.xfp === signerXfp,
        );

        if (!signerKey) {
          throw new Error(`Signer ${signerXfp} not found in wallet config`);
        }

        console.log("[HW] Signer key found:", signerKey.bip32Path);

        // Find policy HMAC if available (for Ledger v2+)
        const policyHmac = config.ledgerPolicyHmacs?.find(
          (h) => h.xfp === signerXfp,
        )?.policyHmac;

        if (policyHmac) {
          console.log("[HW] Using Ledger policy HMAC");
        } else {
          console.warn("[HW] No policy HMAC found - may need registration");
        }

        setStatus("signing");
        setProgress("Review transaction on your Ledger...");

        // Create signing interaction
        const interaction = SignMultisigTransaction({
          keystore: LEDGER,
          network: config.network,
          psbt,
          keyDetails: {
            xfp: signerKey.xfp,
            path: signerKey.bip32Path,
          },
          walletConfig: config,
          policyHmac,
          progressCallback: () => {
            setProgress("Signing inputs... This may take a moment");
          },
          returnSignatureArray: false, // We want the signed PSBT back
        });

        console.log("[HW] Running Ledger interaction...");
        const signedPsbt = await interaction.run();

        console.log("[HW] ✓ Ledger signing complete");
        setStatus("success");
        setProgress("Signature collected!");

        // Return signature set
        const signatureSet: SignatureSet = {
          xfp: signerXfp,
          signatures: [signedPsbt], // Store the signed PSBT
          signedAt: new Date(),
        };

        return signatureSet;
      } catch (err) {
        console.error("[HW] Ledger signing error:", err);

        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        let friendlyError = errorMessage;

        // Map common errors to user-friendly messages
        if (errorMessage.includes("No device selected")) {
          friendlyError =
            "Ledger not detected. Please connect and unlock your device.";
        } else if (errorMessage.includes("Rejected by user")) {
          friendlyError = "Transaction was rejected on your Ledger.";
        } else if (errorMessage.includes("app")) {
          friendlyError =
            "Please open the Bitcoin app on your Ledger and try again.";
        } else if (errorMessage.includes("policy")) {
          friendlyError =
            "Wallet policy not registered. Please register your wallet on the Ledger.";
        }

        setStatus("error");
        setError(friendlyError);
        throw new Error(friendlyError);
      }
    },
    [],
  );

  /**
   * Sign with Trezor hardware wallet
   */
  const signWithTrezor = useCallback(
    async (
      psbt: string,
      config: MultisigWalletConfig,
      signerXfp: string,
    ): Promise<SignatureSet> => {
      console.log("[HW] Starting Trezor signing...");
      console.log("[HW] Signer XFP:", signerXfp);

      setStatus("connecting");
      setError(null);
      setProgress("Connecting to Trezor...");

      try {
        // Validate wallet config structure
        if (
          !config.extendedPublicKeys ||
          !Array.isArray(config.extendedPublicKeys)
        ) {
          console.error(
            "[HW] Invalid wallet config - extendedPublicKeys:",
            config.extendedPublicKeys,
          );
          throw new Error(
            "Wallet configuration is invalid. Please re-import your wallet.",
          );
        }

        console.log(
          "[HW] Config has",
          config.extendedPublicKeys.length,
          "extended public keys",
        );

        // Find the signer's key details
        const signerKey = config.extendedPublicKeys.find(
          (key) => key.xfp === signerXfp,
        );

        if (!signerKey) {
          throw new Error(`Signer ${signerXfp} not found in wallet config`);
        }

        console.log("[HW] Signer key found:", signerKey.bip32Path);
        console.log("[HW] Wallet config details:", {
          network: config.network,
          addressType: config.addressType,
          quorum: config.quorum,
          extendedPublicKeys: config.extendedPublicKeys,
          extendedPublicKeysLength:
            config.extendedPublicKeys?.length ?? "undefined",
        });

        setStatus("signing");
        setProgress("Review transaction on your Trezor...");

        // Create signing interaction
        const interaction = SignMultisigTransaction({
          keystore: TREZOR,
          network: config.network,
          psbt,
          keyDetails: {
            xfp: signerKey.xfp,
            path: signerKey.bip32Path,
          },
          walletConfig: config,
          returnSignatureArray: false, // We want the signed PSBT back
        });

        console.log("[HW] Running Trezor interaction...");
        const signedPsbt = await interaction.run();

        console.log("[HW] ✓ Trezor signing complete");
        setStatus("success");
        setProgress("Signature collected!");

        // Return signature set
        const signatureSet: SignatureSet = {
          xfp: signerXfp,
          signatures: [signedPsbt], // Store the signed PSBT
          signedAt: new Date(),
        };

        return signatureSet;
      } catch (err) {
        console.error("[HW] Trezor signing error:", err);

        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        let friendlyError = errorMessage;

        // Map common errors to user-friendly messages
        if (errorMessage.includes("device")) {
          friendlyError =
            "Trezor not detected. Please connect and unlock your device.";
        } else if (errorMessage.includes("Cancelled")) {
          friendlyError = "Transaction was rejected on your Trezor.";
        } else if (errorMessage.includes("PIN")) {
          friendlyError = "Incorrect PIN. Please try again.";
        }

        setStatus("error");
        setError(friendlyError);
        throw new Error(friendlyError);
      }
    },
    [],
  );

  return {
    status,
    error,
    progress,
    signWithLedger,
    signWithTrezor,
    reset,
  };
}
