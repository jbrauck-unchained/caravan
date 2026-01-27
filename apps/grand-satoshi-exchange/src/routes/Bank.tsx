/**
 * Grand Satoshi Exchange - Bank View
 *
 * Displays wallet UTXOs in an OSRS-style inventory grid.
 */

import { useState } from "react";
import { Button } from "../components/ui/Button";
import { GoldAmount, Tooltip } from "../components/ui/Display";
import { InventoryGrid, InventorySlot, ItemStack } from "../components/ui/Grid";
import { ImportWalletModal } from "../components/modals/ImportWalletModal";
import { ReceiveModal } from "../components/modals/ReceiveModal";
import { CreateOfferModal } from "../components/exchange/CreateOfferModal";
import {
  useWalletStore,
  useHasWallet,
  useUTXOs,
  useBalance,
} from "@/stores/walletStore";
import { useWalletSync } from "@/hooks/useWalletSync";

export function Bank() {
  const [selectedUTXOs, setSelectedUTXOs] = useState<Set<string>>(new Set());
  const [showImportModal, setShowImportModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showCreateOfferModal, setShowCreateOfferModal] = useState(false);

  // Wallet state
  const hasWallet = useHasWallet();
  const utxos = useUTXOs();
  const totalBalance = useBalance();
  const wallet = useWalletStore((state) => state.wallet);

  // Sync hook
  const { isSyncing, sync } = useWalletSync();

  // Toggle UTXO selection (using txid:vout as unique ID)
  const toggleUTXO = (txid: string, vout: number) => {
    const utxoId = `${txid}:${vout}`;
    const newSelected = new Set(selectedUTXOs);
    if (newSelected.has(utxoId)) {
      newSelected.delete(utxoId);
    } else {
      newSelected.add(utxoId);
    }
    setSelectedUTXOs(newSelected);
  };

  // Calculate selected balance
  const selectedBalance = utxos
    .filter((utxo) => selectedUTXOs.has(`${utxo.txid}:${utxo.vout}`))
    .reduce((sum, utxo) => sum + (utxo.value || 0), 0);

  // Create 28 slots (7x4 grid like OSRS)
  const slots = Array.from({ length: 28 }, (_, i) => {
    const utxo = utxos[i];
    const utxoId = utxo ? `${utxo.txid}:${utxo.vout}` : "";
    const isSelected = utxo ? selectedUTXOs.has(utxoId) : false;

    return (
      <InventorySlot
        key={i}
        selected={isSelected}
        onClick={utxo ? () => toggleUTXO(utxo.txid, utxo.vout) : undefined}
      >
        {utxo && utxo.value !== undefined && !isNaN(utxo.value) && (
          <Tooltip
            content={`${utxo.value.toLocaleString()} sats${utxo.confirmed ? " (confirmed)" : " (unconfirmed)"}`}
          >
            <ItemStack icon="" quantity={utxo.value} isUTXO={true} />
          </Tooltip>
        )}
      </InventorySlot>
    );
  });

  // No wallet loaded state
  if (!hasWallet) {
    return (
      <div style={{ padding: "20px" }}>
        <div
          style={{
            padding: "40px",
            textAlign: "center",
            backgroundColor: "var(--osrs-brown-dark)",
            borderRadius: "4px",
            border: "2px solid var(--inv-slot-border)",
          }}
        >
          <h2
            style={{
              color: "var(--osrs-text-yellow)",
              marginBottom: "16px",
              fontSize: "24px",
            }}
          >
            No Wallet Loaded
          </h2>
          <p
            style={{
              color: "var(--osrs-text-white)",
              marginBottom: "24px",
              fontSize: "14px",
            }}
          >
            Import a MultisigWalletConfig JSON file to get started.
          </p>
          <Button variant="primary" onClick={() => setShowImportModal(true)}>
            Import Wallet
          </Button>
        </div>

        <ImportWalletModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: "20px" }}>
      {/* Wallet Info Header */}
      <div
        style={{
          marginBottom: "16px",
          padding: "16px",
          backgroundColor: "var(--osrs-brown-dark)",
          borderRadius: "4px",
          border: "2px solid var(--inv-slot-border)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h3
              style={{
                color: "var(--osrs-text-yellow)",
                marginBottom: "4px",
                fontSize: "16px",
              }}
            >
              {wallet?.config.name || "Unnamed Wallet"}
            </h3>
            <div style={{ color: "var(--osrs-text-orange)", fontSize: "12px" }}>
              {wallet?.config.addressType} •{" "}
              {wallet?.config.quorum.requiredSigners}-of-
              {wallet?.config.quorum.totalSigners ||
                wallet?.config.extendedPublicKeys.length}{" "}
              • {wallet?.network}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {isSyncing && (
              <span
                style={{ color: "var(--osrs-text-orange)", fontSize: "12px" }}
              >
                Syncing...
              </span>
            )}
            <Button onClick={sync} disabled={isSyncing}>
              {isSyncing ? "Syncing..." : "Refresh"}
            </Button>
          </div>
        </div>
      </div>

      {/* Total Balance */}
      <div
        style={{
          marginBottom: "16px",
          padding: "16px",
          backgroundColor: "var(--osrs-brown-dark)",
          borderRadius: "4px",
          border: "2px solid var(--inv-slot-border)",
        }}
      >
        <h3
          style={{
            color: "var(--osrs-text-yellow)",
            marginBottom: "8px",
            fontSize: "18px",
          }}
        >
          Total Balance
        </h3>
        <GoldAmount sats={totalBalance} showBtc size="large" />

        {selectedUTXOs.size > 0 && (
          <div
            style={{
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid var(--inv-slot-border)",
            }}
          >
            <div
              style={{
                color: "var(--osrs-text-orange)",
                fontSize: "14px",
                marginBottom: "4px",
              }}
            >
              Selected: {selectedUTXOs.size} UTXO
              {selectedUTXOs.size !== 1 ? "s" : ""}
            </div>
            <GoldAmount sats={selectedBalance} showBtc size="normal" />
          </div>
        )}
      </div>

      {/* Inventory Grid */}
      <InventoryGrid title="UTXOs (Inventory)" itemCount={utxos.length}>
        {slots}
      </InventoryGrid>

      {/* Action Buttons */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginTop: "16px",
          justifyContent: "center",
        }}
      >
        <Tooltip content="Send selected UTXOs to an address">
          <Button
            variant="primary"
            disabled={selectedUTXOs.size === 0}
            onClick={() => setShowCreateOfferModal(true)}
          >
            Send ({selectedUTXOs.size} selected)
          </Button>
        </Tooltip>
        <Tooltip content="Generate a receiving address">
          <Button variant="secondary" onClick={() => setShowReceiveModal(true)}>
            Receive
          </Button>
        </Tooltip>
        <Tooltip content="Clear wallet and import a new one">
          <Button
            variant="danger"
            onClick={() => {
              useWalletStore.getState().clearWallet();
              setSelectedUTXOs(new Set());
            }}
          >
            Clear Wallet
          </Button>
        </Tooltip>
      </div>

      {/* Empty state hint */}
      {utxos.length === 0 && !isSyncing && (
        <div
          style={{
            marginTop: "24px",
            padding: "16px",
            textAlign: "center",
            backgroundColor: "var(--osrs-brown-dark)",
            borderRadius: "4px",
            border: "2px solid var(--inv-slot-border)",
          }}
        >
          <p style={{ color: "var(--osrs-text-white)", fontSize: "14px" }}>
            No UTXOs found. Send some bitcoin to your wallet addresses to get
            started!
          </p>
        </div>
      )}

      {/* Instructions */}
      {utxos.length > 0 && (
        <div
          style={{
            marginTop: "24px",
            padding: "12px",
            backgroundColor: "var(--osrs-brown-dark)",
            borderRadius: "4px",
            border: "2px solid var(--inv-slot-border)",
          }}
        >
          <p
            style={{
              color: "var(--osrs-text-white)",
              fontSize: "12px",
              lineHeight: "1.5",
            }}
          >
            💡 <strong>Tip:</strong> Click on coin stacks to select UTXOs for
            spending. Selected UTXOs will have a green checkmark. Different coin
            stack sizes represent different satoshi amounts!
          </p>
        </div>
      )}

      <ImportWalletModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
      />

      <ReceiveModal
        isOpen={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
      />

      <CreateOfferModal
        isOpen={showCreateOfferModal}
        onClose={() => setShowCreateOfferModal(false)}
        preSelectedUtxos={selectedUTXOs}
      />
    </div>
  );
}
