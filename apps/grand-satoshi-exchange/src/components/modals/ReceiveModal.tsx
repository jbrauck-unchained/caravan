/**
 * Grand Satoshi Exchange - Receive Modal
 *
 * Modal for generating receiving addresses with QR codes.
 */

import { useState, useRef, useEffect } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import {
  useNextReceivingAddress,
  useReceivingAddresses,
} from "@/stores/walletStore";
import styles from "./ReceiveModal.module.css";

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ReceiveModal({ isOpen, onClose }: ReceiveModalProps) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Get next unused receiving address
  const nextAddress = useNextReceivingAddress();
  const allAddresses = useReceivingAddresses();

  // Generate QR code on canvas
  useEffect(() => {
    if (!nextAddress || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Simple QR code placeholder (in production, use proper QR library)
    // For now, we'll create a simple pattern
    const size = 200;
    const pixelSize = 4;
    canvas.width = size;
    canvas.height = size;

    // Clear canvas
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, size, size);

    // Create a simple grid pattern representing QR code
    ctx.fillStyle = "#000000";

    // This is a placeholder - in production you'd use a proper QR generator
    const address = nextAddress.address;
    const hashCode = address.split("").reduce((acc, char) => {
      return acc + char.charCodeAt(0);
    }, 0);

    // Create deterministic pattern based on address
    for (let y = 0; y < size / pixelSize; y++) {
      for (let x = 0; x < size / pixelSize; x++) {
        const seed = (x * 31 + y * 17 + hashCode) % 100;
        if (seed < 45) {
          ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
        }
      }
    }

    // Add corner markers (typical QR code feature)
    const markerSize = 28;
    const drawMarker = (x: number, y: number) => {
      ctx.fillStyle = "#000000";
      ctx.fillRect(x, y, markerSize, markerSize);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(x + 4, y + 4, markerSize - 8, markerSize - 8);
      ctx.fillStyle = "#000000";
      ctx.fillRect(x + 8, y + 8, markerSize - 16, markerSize - 16);
    };

    drawMarker(0, 0); // Top-left
    drawMarker(size - markerSize, 0); // Top-right
    drawMarker(0, size - markerSize); // Bottom-left
  }, [nextAddress]);

  // Copy address to clipboard
  const handleCopy = async () => {
    if (!nextAddress) return;

    try {
      await navigator.clipboard.writeText(nextAddress.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy address:", error);
    }
  };

  if (!nextAddress) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Receive Bitcoin">
        <div className={styles.content}>
          <div className={styles.error}>
            No receiving addresses available. Please ensure your wallet is
            loaded.
          </div>
          <div className={styles.actions}>
            <Button onClick={onClose} variant="primary">
              Close
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Count used addresses
  const usedCount = allAddresses.filter((addr) => addr.used).length;
  const totalCount = allAddresses.length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Receive Bitcoin">
      <div className={styles.content}>
        {/* QR Code */}
        <div className={styles.qrSection}>
          <div className={styles.qrContainer}>
            <canvas ref={canvasRef} className={styles.qrCanvas} />
          </div>
          <div className={styles.qrLabel}>Scan with a Bitcoin wallet</div>
        </div>

        {/* Address Info */}
        <div className={styles.addressSection}>
          <label className={styles.label}>Receiving Address:</label>
          <div className={styles.addressBox}>
            <code className={styles.address}>{nextAddress.address}</code>
            <Button
              onClick={handleCopy}
              variant="secondary"
              className={styles.copyButton}
            >
              {copied ? "✓ Copied!" : "Copy"}
            </Button>
          </div>
        </div>

        {/* Address Details */}
        <div className={styles.details}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Path:</span>
            <span className={styles.detailValue}>{nextAddress.path}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Index:</span>
            <span className={styles.detailValue}>
              {nextAddress.change === 0 ? "Receiving" : "Change"} #
              {nextAddress.index}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Status:</span>
            <span className={styles.detailValue}>
              {nextAddress.used ? "Used" : "Unused"}
            </span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>Balance:</span>
            <span className={styles.detailValue}>
              {nextAddress.balance.toLocaleString()} sats
            </span>
          </div>
        </div>

        {/* Address Usage Stats */}
        <div className={styles.stats}>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{usedCount}</span>
            <span className={styles.statLabel}>Used Addresses</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{totalCount - usedCount}</span>
            <span className={styles.statLabel}>Unused Addresses</span>
          </div>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{totalCount}</span>
            <span className={styles.statLabel}>Total Derived</span>
          </div>
        </div>

        {/* Warning */}
        {nextAddress.used && (
          <div className={styles.warning}>
            ⚠️ <strong>Address Reuse Warning:</strong> This address has been
            used before. For better privacy, consider deriving a new address
            after each use.
          </div>
        )}

        {/* Info */}
        <div className={styles.info}>
          💡 <strong>Tip:</strong> This is a multisig address requiring{" "}
          <strong>M-of-N signatures</strong> to spend. Share this address to
          receive bitcoin safely!
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          <Button onClick={onClose} variant="primary">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
