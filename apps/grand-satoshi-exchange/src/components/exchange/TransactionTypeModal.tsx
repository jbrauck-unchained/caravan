/**
 * Grand Satoshi Exchange - Transaction Type Modal
 *
 * Modal for choosing between sending or receiving Bitcoin
 */

import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

export interface TransactionTypeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSend: () => void;
  onSelectReceive: () => void;
}

export function TransactionTypeModal({
  isOpen,
  onClose,
  onSelectSend,
  onSelectReceive,
}: TransactionTypeModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Choose Transaction Type">
      <div style={{ padding: "20px" }}>
        <p
          style={{
            color: "var(--osrs-text-white)",
            marginBottom: "24px",
            textAlign: "center",
            fontSize: "14px",
          }}
        >
          What would you like to do with this slot?
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {/* Send Bitcoin */}
          <div
            style={{
              padding: "16px",
              backgroundColor: "var(--osrs-brown-medium)",
              border: "2px solid var(--inv-slot-border)",
              borderRadius: "4px",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onClick={() => {
              onSelectSend();
              onClose();
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--osrs-brown-light)";
              e.currentTarget.style.borderColor = "var(--osrs-gold)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor =
                "var(--osrs-brown-medium)";
              e.currentTarget.style.borderColor = "var(--inv-slot-border)";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <img
                src="/assets/exchange/gse_out.svg"
                alt="Send"
                width="40"
                height="40"
              />
              <div>
                <h4
                  style={{
                    color: "var(--osrs-text-yellow)",
                    fontSize: "16px",
                    marginBottom: "4px",
                  }}
                >
                  Send Bitcoin
                </h4>
                <p
                  style={{
                    color: "var(--osrs-text-gray)",
                    fontSize: "12px",
                  }}
                >
                  Create and sign a transaction to send Bitcoin from your wallet
                </p>
              </div>
            </div>
          </div>

          {/* Receive Bitcoin */}
          <div
            style={{
              padding: "16px",
              backgroundColor: "var(--osrs-brown-medium)",
              border: "2px solid var(--inv-slot-border)",
              borderRadius: "4px",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onClick={() => {
              onSelectReceive();
              onClose();
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--osrs-brown-light)";
              e.currentTarget.style.borderColor = "var(--osrs-gold)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor =
                "var(--osrs-brown-medium)";
              e.currentTarget.style.borderColor = "var(--inv-slot-border)";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <img
                src="/assets/exchange/gse_in.svg"
                alt="Receive"
                width="40"
                height="40"
              />
              <div>
                <h4
                  style={{
                    color: "var(--osrs-text-yellow)",
                    fontSize: "16px",
                    marginBottom: "4px",
                  }}
                >
                  Receive Bitcoin
                </h4>
                <p
                  style={{
                    color: "var(--osrs-text-gray)",
                    fontSize: "12px",
                  }}
                >
                  Generate an address to receive Bitcoin to your wallet
                </p>
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: "24px", textAlign: "center" }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
