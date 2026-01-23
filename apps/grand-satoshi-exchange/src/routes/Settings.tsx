/**
 * Grand Satoshi Exchange - Settings
 *
 * Configuration for network, blockchain provider, and wallet management.
 */

import { Button } from "../components/ui/Button";
import {
  useClientStore,
  getNetworkName,
  getClientTypeName,
} from "@/stores/clientStore";
import { useWalletStore } from "@/stores/walletStore";
import { Network } from "@caravan/bitcoin";
import { ClientType } from "@caravan/clients";

export function Settings() {
  const { network, clientType, setNetwork, setClientType } = useClientStore();
  const { clearWallet, wallet } = useWalletStore();

  const handleNetworkChange = async (newNetwork: Network) => {
    if (network === newNetwork) return;

    // Warn if wallet is loaded and network doesn't match
    if (wallet && wallet.network !== newNetwork) {
      const confirmed = window.confirm(
        `Switching to ${getNetworkName(newNetwork)} will clear your current wallet (configured for ${wallet.network}). Continue?`,
      );
      if (!confirmed) return;
      clearWallet();
    }

    await setNetwork(newNetwork);
  };

  const handleClientTypeChange = async (newClientType: ClientType) => {
    if (clientType === newClientType) return;
    await setClientType(newClientType);
  };

  const handleExportConfig = () => {
    if (!wallet) {
      alert("No wallet loaded to export");
      return;
    }

    const json = JSON.stringify(wallet.config, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${wallet.config.name || "wallet"}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearWallet = () => {
    if (!wallet) {
      alert("No wallet loaded");
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to clear "${wallet.config.name || "this wallet"}"? You can re-import it later.`,
    );
    if (confirmed) {
      clearWallet();
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h3
        style={{
          color: "var(--osrs-text-yellow)",
          marginBottom: "16px",
          textAlign: "center",
        }}
      >
        Settings
      </h3>

      {/* Network Selection */}
      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
          marginBottom: "16px",
        }}
      >
        <h4
          style={{
            color: "var(--osrs-text-yellow)",
            fontSize: "14px",
            marginBottom: "8px",
          }}
        >
          Network
        </h4>
        <p
          style={{
            color: "var(--osrs-text-orange)",
            fontSize: "12px",
            marginBottom: "12px",
          }}
        >
          Current: {getNetworkName(network)}
        </p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Button
            variant={network === Network.MAINNET ? "primary" : "secondary"}
            onClick={() => handleNetworkChange(Network.MAINNET)}
          >
            Mainnet
          </Button>
          <Button
            variant={network === Network.TESTNET ? "primary" : "secondary"}
            onClick={() => handleNetworkChange(Network.TESTNET)}
          >
            Testnet
          </Button>
          <Button
            variant={network === Network.REGTEST ? "primary" : "secondary"}
            onClick={() => handleNetworkChange(Network.REGTEST)}
          >
            Regtest
          </Button>
        </div>
        {wallet && wallet.network !== network && (
          <div
            style={{
              marginTop: "12px",
              padding: "8px",
              background: "rgba(255, 165, 0, 0.1)",
              border: "2px solid #ff9900",
              borderRadius: "4px",
              color: "#ffcc66",
              fontSize: "12px",
            }}
          >
            ⚠️ Warning: Wallet is configured for {wallet.network}, but you've
            selected {network}. Switch back to {wallet.network} or clear the
            wallet.
          </div>
        )}
      </div>

      {/* Blockchain Client */}
      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
          marginBottom: "16px",
        }}
      >
        <h4
          style={{
            color: "var(--osrs-text-yellow)",
            fontSize: "14px",
            marginBottom: "8px",
          }}
        >
          Blockchain Provider
        </h4>
        <p
          style={{
            color: "var(--osrs-text-orange)",
            fontSize: "12px",
            marginBottom: "12px",
          }}
        >
          Current: {getClientTypeName(clientType)}
        </p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Button
            variant={
              clientType === ClientType.MEMPOOL ? "primary" : "secondary"
            }
            onClick={() => handleClientTypeChange(ClientType.MEMPOOL)}
          >
            Mempool.space
          </Button>
          <Button
            variant={
              clientType === ClientType.BLOCKSTREAM ? "primary" : "secondary"
            }
            onClick={() => handleClientTypeChange(ClientType.BLOCKSTREAM)}
          >
            Blockstream
          </Button>

          <Button
            variant={
              clientType === ClientType.PRIVATE ? "primary" : "secondary"
            }
            onClick={() => handleClientTypeChange(ClientType.PRIVATE)}
          >
            Private
          </Button>
        </div>
      </div>

      {/* Wallet Management */}
      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
          marginBottom: "16px",
        }}
      >
        <h4
          style={{
            color: "var(--osrs-text-yellow)",
            fontSize: "14px",
            marginBottom: "8px",
          }}
        >
          Wallet
        </h4>
        {wallet ? (
          <>
            <p
              style={{
                color: "var(--osrs-text-white)",
                fontSize: "12px",
                marginBottom: "12px",
              }}
            >
              Loaded: <strong>{wallet.config.name || "Unnamed Wallet"}</strong>
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <Button onClick={handleExportConfig}>Export Config</Button>
              <Button variant="danger" onClick={handleClearWallet}>
                Clear Wallet
              </Button>
            </div>
          </>
        ) : (
          <p style={{ color: "#888", fontSize: "12px" }}>
            No wallet loaded. Go to Bank to import a wallet.
          </p>
        )}
      </div>

      {/* About */}
      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
          textAlign: "center",
        }}
      >
        <p style={{ color: "var(--osrs-text-white)", fontSize: "12px" }}>
          Grand Satoshi Exchange v0.1.0
        </p>
        <p style={{ color: "#888", fontSize: "10px", marginTop: "4px" }}>
          Bitcoin Multisig Wallet Manager
        </p>
      </div>
    </div>
  );
}
