/**
 * Grand Satoshi Exchange - Import Wallet Modal
 *
 * Modal for importing MultisigWalletConfig JSON files.
 */

import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { LoadingOverlay } from "../ui/LoadingSpinner";
import { useWalletStore } from "@/stores/walletStore";
import { useClientStore } from "@/stores/clientStore";
import {
  validateWalletConfig,
  validateWalletConfigDetails,
  type ValidatedWalletConfig,
} from "@/utils/walletValidation";
import styles from "./ImportWalletModal.module.css";

interface ImportWalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ImportWalletModal({ isOpen, onClose }: ImportWalletModalProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [validatedConfig, setValidatedConfig] =
    useState<ValidatedWalletConfig | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const { loadWallet } = useWalletStore();
  const network = useClientStore((state) => state.network);

  // Reset state when modal opens/closes
  const handleClose = () => {
    setJsonInput("");
    setValidationError(null);
    setWarnings([]);
    setValidatedConfig(null);
    setIsImporting(false);
    onClose();
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setJsonInput(content);
      validateInput(content);
    };
    reader.readAsText(file);
  };

  // Validate JSON input
  const validateInput = (input: string) => {
    setValidationError(null);
    setWarnings([]);
    setValidatedConfig(null);

    if (!input.trim()) {
      return;
    }

    // Validate JSON structure
    const result = validateWalletConfig(input);

    if (!result.success) {
      setValidationError(result.error || "Invalid wallet configuration");
      return;
    }

    // Check detailed validation
    const detailResult = validateWalletConfigDetails(result.data!);

    if (!detailResult.success) {
      setValidationError(detailResult.errors.join(", "));
      return;
    }

    // Check network mismatch
    if (result.data!.network !== network) {
      setValidationError(
        `Wallet network (${result.data!.network}) does not match selected network (${network})`,
      );
      return;
    }

    // Set warnings if any
    if (detailResult.warnings.length > 0) {
      setWarnings(detailResult.warnings);
    }

    setValidatedConfig(result.data!);
  };

  // Import wallet
  const handleImport = async () => {
    if (!validatedConfig) return;

    setIsImporting(true);
    try {
      await loadWallet(validatedConfig, network);
      handleClose();
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : "Failed to load wallet",
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import Wallet">
      {isImporting && (
        <LoadingOverlay message="Importing wallet and deriving addresses" />
      )}
      <div className={styles.content}>
        {/* File upload */}
        <div className={styles.section}>
          <label className={styles.label}>Upload Wallet JSON:</label>
          <input
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className={styles.fileInput}
          />
        </div>

        {/* Or manual input */}
        <div className={styles.section}>
          <label className={styles.label}>Or paste JSON directly:</label>
          <textarea
            value={jsonInput}
            onChange={(e) => {
              setJsonInput(e.target.value);
              validateInput(e.target.value);
            }}
            placeholder='{"name": "My Wallet", "addressType": "P2WSH", ...}'
            className={styles.textarea}
            rows={10}
          />
        </div>

        {/* Validation error */}
        {validationError && (
          <div className={styles.error}>
            ⚠️ <strong>Error:</strong> {validationError}
          </div>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className={styles.warning}>
            ⚡ <strong>Warning:</strong>
            <ul className={styles.warningList}>
              {warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Success preview */}
        {validatedConfig && !validationError && (
          <div className={styles.success}>
            ✓ <strong>Valid wallet configuration:</strong>
            <div className={styles.preview}>
              <div>
                <strong>Name:</strong> {validatedConfig.name}
              </div>
              <div>
                <strong>Type:</strong> {validatedConfig.addressType}
              </div>
              <div>
                <strong>Network:</strong> {validatedConfig.network}
              </div>
              <div>
                <strong>Quorum:</strong>{" "}
                {validatedConfig.quorum.requiredSigners}-of-
                {validatedConfig.quorum.totalSigners ||
                  validatedConfig.extendedPublicKeys.length}
              </div>
              <div>
                <strong>Signers:</strong>{" "}
                {validatedConfig.extendedPublicKeys.length} key
                {validatedConfig.extendedPublicKeys.length !== 1 ? "s" : ""}
              </div>
              <div>
                <strong>Fingerprints:</strong>{" "}
                {validatedConfig.extendedPublicKeys
                  .map((k) => k.xfp)
                  .join(", ")}
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className={styles.actions}>
          <Button onClick={handleClose} variant="secondary">
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            variant="primary"
            disabled={!validatedConfig || isImporting}
          >
            {isImporting ? "Importing..." : "Import Wallet"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
