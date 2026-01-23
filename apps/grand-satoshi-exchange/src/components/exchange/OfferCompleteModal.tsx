/**
 * Grand Satoshi Exchange - Offer Complete Modal
 *
 * Celebration modal shown when a transaction is successfully broadcast.
 */

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { GoldAmount } from "../ui/Display/GoldAmount";
import { getExplorerUrl } from "@/utils/broadcast";

export interface OfferCompleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  txid: string;
  amount: bigint;
  destination: string;
  fee: bigint;
  network: string;
}

export function OfferCompleteModal({
  isOpen,
  onClose,
  txid,
  amount,
  destination,
  fee,
  network,
}: OfferCompleteModalProps) {
  const explorerUrl = getExplorerUrl(txid, network);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="">
      <div style={{ textAlign: "center", padding: "20px 0" }}>
        {/* Celebration Banner */}
        <div
          style={{
            fontSize: "24px",
            color: "var(--osrs-text-yellow)",
            fontWeight: "bold",
            marginBottom: "24px",
            animation: "celebrate 0.5s ease-in-out",
          }}
        >
          ✨ OFFER COMPLETE! ✨
        </div>

        {/* Transaction Summary */}
        <div
          style={{
            padding: "16px",
            backgroundColor: "var(--osrs-brown-dark)",
            borderRadius: "4px",
            marginBottom: "20px",
          }}
        >
          <div style={{ marginBottom: "12px" }}>
            <div
              style={{
                color: "var(--osrs-text-gray)",
                fontSize: "12px",
                marginBottom: "4px",
              }}
            >
              Sent
            </div>
            <GoldAmount sats={Number(amount)} showBtc size="large" />
          </div>

          <div style={{ marginBottom: "12px" }}>
            <div
              style={{
                color: "var(--osrs-text-gray)",
                fontSize: "12px",
                marginBottom: "4px",
              }}
            >
              To
            </div>
            <div
              style={{
                color: "var(--osrs-text-white)",
                fontSize: "11px",
                fontFamily: "monospace",
                wordBreak: "break-all",
              }}
            >
              {destination}
            </div>
          </div>

          <div style={{ marginBottom: "12px" }}>
            <div
              style={{
                color: "var(--osrs-text-gray)",
                fontSize: "12px",
                marginBottom: "4px",
              }}
            >
              Fee
            </div>
            <div style={{ color: "var(--osrs-text-white)", fontSize: "12px" }}>
              {Number(fee).toLocaleString()} sats
            </div>
          </div>

          <div>
            <div
              style={{
                color: "var(--osrs-text-gray)",
                fontSize: "12px",
                marginBottom: "4px",
              }}
            >
              Transaction ID
            </div>
            <div
              style={{
                color: "var(--osrs-text-cyan)",
                fontSize: "10px",
                fontFamily: "monospace",
                wordBreak: "break-all",
              }}
            >
              {txid}
            </div>
          </div>
        </div>

        {/* Explorer Link */}
        <div style={{ marginBottom: "20px" }}>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--osrs-text-cyan)",
              fontSize: "14px",
              textDecoration: "underline",
            }}
          >
            View on Block Explorer →
          </a>
        </div>

        {/* Success Message */}
        <div
          style={{
            padding: "12px",
            backgroundColor: "var(--osrs-brown-medium)",
            borderRadius: "4px",
            marginBottom: "20px",
          }}
        >
          <p
            style={{
              color: "var(--osrs-text-white)",
              fontSize: "12px",
              lineHeight: "1.6",
            }}
          >
            Your transaction has been broadcast to the network! It may take a
            few minutes to appear in the mempool and get confirmed in a block.
          </p>
        </div>

        {/* Close Button */}
        <Button variant="primary" onClick={onClose}>
          Collect Coins
        </Button>
      </div>
    </Modal>
  );
}
