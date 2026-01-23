/**
 * Grand Satoshi Exchange - Signing Modal
 *
 * Modal for signing transactions with hardware wallets (Ledger/Trezor).
 */

import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { GoldAmount } from "../ui/Display/GoldAmount";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { useHardwareWallet } from "@/hooks/useHardwareWallet";
import { useWalletConfig } from "@/stores/walletStore";
import type { PendingOffer, SignatureSet } from "@/types/transaction";

export interface SigningModalProps {
  isOpen: boolean;
  onClose: () => void;
  offer: PendingOffer | null;
  onSignatureCollected: (signature: SignatureSet) => void;
}

type DeviceType = "ledger" | "trezor" | null;

export function SigningModal({
  isOpen,
  onClose,
  offer,
  onSignatureCollected,
}: SigningModalProps) {
  console.log("[SigningModal] Render - isOpen:", isOpen, "offer:", offer?.id);

  const [selectedDevice, setSelectedDevice] = useState<DeviceType>(null);
  const [selectedSigner, setSelectedSigner] = useState<string | null>(null);

  const walletConfig = useWalletConfig();
  const { status, error, progress, signWithLedger, signWithTrezor, reset } =
    useHardwareWallet();

  // Get available signers (those who haven't signed yet)
  const signedXfps = offer?.signatures.map((sig) => sig.xfp) ?? [];
  const availableSigners =
    walletConfig && walletConfig.extendedPublicKeys
      ? walletConfig.extendedPublicKeys.filter(
          (key) => !signedXfps.includes(key.xfp),
        )
      : [];

  console.log("[SigningModal] walletConfig:", walletConfig ? "exists" : "null");
  console.log(
    "[SigningModal] extendedPublicKeys:",
    walletConfig?.extendedPublicKeys
      ? `${walletConfig.extendedPublicKeys.length} keys`
      : "undefined",
  );
  console.log("[SigningModal] availableSigners:", availableSigners.length);

  // Handle device selection
  const handleDeviceSelect = (device: DeviceType) => {
    setSelectedDevice(device);
    reset();
  };

  // Handle signer selection
  const handleSignerSelect = (xfp: string) => {
    setSelectedSigner(xfp);
  };

  // Handle signing
  const handleSign = async () => {
    if (!selectedDevice || !selectedSigner || !offer || !walletConfig) {
      console.error("[SigningModal] Missing required data:", {
        selectedDevice,
        selectedSigner,
        hasOffer: !!offer,
        hasWalletConfig: !!walletConfig,
      });
      return;
    }

    console.log("[SigningModal] Starting sign with:", {
      device: selectedDevice,
      signer: selectedSigner,
      offerId: offer.id,
      walletConfig: {
        network: walletConfig.network,
        addressType: walletConfig.addressType,
        extendedPublicKeysCount: walletConfig.extendedPublicKeys?.length ?? 0,
      },
    });

    try {
      let signature: SignatureSet;

      if (selectedDevice === "ledger") {
        signature = await signWithLedger(
          offer.unsignedPsbt,
          walletConfig,
          selectedSigner,
        );
      } else {
        signature = await signWithTrezor(
          offer.unsignedPsbt,
          walletConfig,
          selectedSigner,
        );
      }

      // Success!
      onSignatureCollected(signature);
      setTimeout(() => {
        onClose();
        reset();
        setSelectedDevice(null);
        setSelectedSigner(null);
      }, 1500);
    } catch (err) {
      // Error is already set in the hook
      console.error("[SigningModal] Signing failed:", err);
      console.error(
        "[SigningModal] Stack trace:",
        err instanceof Error ? err.stack : "No stack",
      );
    }
  };

  // Render device selection screen
  const renderDeviceSelection = () => (
    <>
      <div style={{ marginBottom: "16px" }}>
        <p
          style={{
            color: "var(--osrs-text-white)",
            fontSize: "14px",
            marginBottom: "16px",
          }}
        >
          Select your hardware wallet to sign this transaction:
        </p>
      </div>

      <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
        <Button
          variant={selectedDevice === "ledger" ? "primary" : "secondary"}
          onClick={() => handleDeviceSelect("ledger")}
          style={{ flex: 1, padding: "24px" }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "16px", marginBottom: "4px" }}>Ledger</div>
            <div style={{ fontSize: "11px", opacity: 0.7 }}>
              Nano S/X/S Plus
            </div>
          </div>
        </Button>

        <Button
          variant={selectedDevice === "trezor" ? "primary" : "secondary"}
          onClick={() => handleDeviceSelect("trezor")}
          style={{ flex: 1, padding: "24px" }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "16px", marginBottom: "4px" }}>Trezor</div>
            <div style={{ fontSize: "11px", opacity: 0.7 }}>One / Model T</div>
          </div>
        </Button>
      </div>

      {selectedDevice && availableSigners.length > 0 && (
        <>
          <div style={{ marginBottom: "12px" }}>
            <p
              style={{
                color: "var(--osrs-text-yellow)",
                fontSize: "14px",
                marginBottom: "8px",
              }}
            >
              Select which key to sign with:
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              marginBottom: "24px",
            }}
          >
            {availableSigners.map((key) => (
              <Button
                key={key.xfp}
                variant={selectedSigner === key.xfp ? "primary" : "secondary"}
                onClick={() => handleSignerSelect(key.xfp)}
                style={{ padding: "12px", textAlign: "left" }}
              >
                <div style={{ fontSize: "12px" }}>
                  <div style={{ marginBottom: "4px" }}>Signer {key.xfp}</div>
                  <div
                    style={{
                      fontSize: "10px",
                      opacity: 0.7,
                      fontFamily: "monospace",
                    }}
                  >
                    {key.xfp} • {key.bip32Path}
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </>
      )}

      {availableSigners.length === 0 && (
        <div
          style={{
            padding: "16px",
            backgroundColor: "var(--osrs-brown-dark)",
            borderRadius: "4px",
            marginBottom: "16px",
          }}
        >
          <p style={{ color: "var(--osrs-text-yellow)", fontSize: "14px" }}>
            ⚠️ All available signers have already signed this transaction.
          </p>
        </div>
      )}
    </>
  );

  // Render signing progress
  const renderSigningProgress = () => (
    <>
      <div
        style={{
          padding: "24px",
          textAlign: "center",
          backgroundColor: "var(--osrs-brown-dark)",
          borderRadius: "4px",
          marginBottom: "16px",
        }}
      >
        <LoadingSpinner />

        <div
          style={{
            color: "var(--osrs-text-yellow)",
            fontSize: "14px",
            marginTop: "16px",
          }}
        >
          {progress || "Signing..."}
        </div>
      </div>

      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-medium)",
          borderRadius: "4px",
        }}
      >
        <h4
          style={{
            color: "var(--osrs-text-yellow)",
            fontSize: "14px",
            marginBottom: "12px",
          }}
        >
          Instructions:
        </h4>
        <ol
          style={{
            color: "var(--osrs-text-white)",
            fontSize: "12px",
            paddingLeft: "20px",
            lineHeight: "1.8",
          }}
        >
          <li>
            Connect and unlock your{" "}
            {selectedDevice === "ledger" ? "Ledger" : "Trezor"}
          </li>
          <li>Open the Bitcoin app on your device</li>
          <li>Review the transaction details carefully</li>
          <li>Confirm if everything looks correct</li>
        </ol>
      </div>
    </>
  );

  // Render success message
  const renderSuccess = () => (
    <div
      style={{
        padding: "24px",
        textAlign: "center",
        backgroundColor: "var(--osrs-brown-dark)",
        borderRadius: "4px",
      }}
    >
      <div
        style={{
          color: "var(--osrs-text-yellow)",
          fontSize: "20px",
          marginBottom: "16px",
        }}
      >
        ✓ Signature Collected!
      </div>
      <p style={{ color: "var(--osrs-text-white)", fontSize: "14px" }}>
        Your signature has been added to the transaction.
      </p>
    </div>
  );

  // Render error message
  const renderError = () => (
    <>
      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--osrs-text-red)",
          borderRadius: "4px",
          marginBottom: "16px",
        }}
      >
        <div
          style={{
            color: "var(--osrs-text-red)",
            fontSize: "14px",
            marginBottom: "8px",
            fontWeight: "bold",
          }}
        >
          ❌ Signing Failed
        </div>
        <p style={{ color: "var(--osrs-text-white)", fontSize: "12px" }}>
          {error}
        </p>
      </div>

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <Button variant="secondary" onClick={() => reset()}>
          Try Again
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onClose();
            reset();
            setSelectedDevice(null);
            setSelectedSigner(null);
          }}
        >
          Close
        </Button>
      </div>
    </>
  );

  // Determine what to render based on status
  const renderContent = () => {
    if (status === "success") {
      return renderSuccess();
    }

    if (status === "error") {
      return renderError();
    }

    if (status === "connecting" || status === "signing") {
      return renderSigningProgress();
    }

    return renderDeviceSelection();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sign Transaction">
      <div style={{ minHeight: "300px" }}>
        {/* Error state if no offer or wallet */}
        {!offer || !walletConfig ? (
          <div
            style={{
              padding: "24px",
              textAlign: "center",
              backgroundColor: "var(--osrs-brown-dark)",
              borderRadius: "4px",
            }}
          >
            <div
              style={{
                color: "var(--osrs-text-red)",
                fontSize: "14px",
                marginBottom: "12px",
              }}
            >
              ❌ Error
            </div>
            <p
              style={{
                color: "var(--osrs-text-white)",
                fontSize: "12px",
                marginBottom: "16px",
              }}
            >
              {!offer ? "No transaction selected" : "No wallet loaded"}
            </p>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <>
            {/* Transaction Summary */}
            <div
              style={{
                padding: "12px",
                backgroundColor: "var(--osrs-brown-dark)",
                borderRadius: "4px",
                marginBottom: "16px",
              }}
            >
              <div style={{ marginBottom: "8px" }}>
                <div
                  style={{ color: "var(--osrs-text-gray)", fontSize: "11px" }}
                >
                  Sending
                </div>
                <GoldAmount sats={Number(offer.amount)} showBtc size="normal" />
              </div>

              <div style={{ marginBottom: "8px" }}>
                <div
                  style={{ color: "var(--osrs-text-gray)", fontSize: "11px" }}
                >
                  To
                </div>
                <div
                  style={{
                    color: "var(--osrs-text-white)",
                    fontSize: "10px",
                    fontFamily: "monospace",
                    wordBreak: "break-all",
                  }}
                >
                  {offer.destination}
                </div>
              </div>

              <div>
                <div
                  style={{ color: "var(--osrs-text-gray)", fontSize: "11px" }}
                >
                  Fee
                </div>
                <div
                  style={{ color: "var(--osrs-text-white)", fontSize: "12px" }}
                >
                  {Number(offer.fee).toLocaleString()} sats ({offer.feeRate}{" "}
                  sat/vB)
                </div>
              </div>
            </div>

            {/* Main Content */}
            {renderContent()}

            {/* Action Buttons (only show in device selection state) */}
            {status === "idle" && (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  justifyContent: "flex-end",
                  marginTop: "16px",
                }}
              >
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSign}
                  disabled={!selectedDevice || !selectedSigner}
                >
                  Sign with{" "}
                  {selectedDevice === "ledger"
                    ? "Ledger"
                    : selectedDevice === "trezor"
                      ? "Trezor"
                      : "Device"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
