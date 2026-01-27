/**
 * Grand Satoshi Exchange - Settings
 *
 * Configuration for network, blockchain provider, and wallet management.
 */

import { useState, useEffect } from "react";
import { Button } from "../components/ui/Button";
import {
  useClientStore,
  getNetworkName,
  getClientTypeName,
  PrivateClientConfig,
} from "@/stores/clientStore";
import { useWalletStore } from "@/stores/walletStore";
import { Network } from "@caravan/bitcoin";
import { ClientType } from "@caravan/clients";

export function Settings() {
  const {
    network,
    clientType,
    privateClientConfig,
    setNetwork,
    setClientType,
    setPrivateClientConfig,
  } = useClientStore();
  const { clearWallet, wallet } = useWalletStore();

  // Local state for private client form
  const [privateUrl, setPrivateUrl] = useState(
    privateClientConfig?.url ||
      (network === Network.REGTEST ? "http://localhost:18443" : ""),
  );
  const [privateUsername, setPrivateUsername] = useState(
    privateClientConfig?.username || "",
  );
  const [privatePassword, setPrivatePassword] = useState(
    privateClientConfig?.password || "",
  );
  const [privateWalletName, setPrivateWalletName] = useState(
    privateClientConfig?.walletName || "",
  );

  // Update form when privateClientConfig changes from store
  useEffect(() => {
    if (privateClientConfig) {
      setPrivateUrl(privateClientConfig.url);
      setPrivateUsername(privateClientConfig.username);
      setPrivatePassword(privateClientConfig.password);
      setPrivateWalletName(privateClientConfig.walletName || "");
    }
  }, [privateClientConfig]);

  // Update default URL when network changes
  useEffect(() => {
    if (clientType === ClientType.PRIVATE && !privateUrl) {
      const defaultPort = network === Network.REGTEST ? 18443 : 18332;
      setPrivateUrl(`http://localhost:${defaultPort}`);
    }
  }, [network, clientType, privateUrl]);

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

  const handleSavePrivateConfig = () => {
    if (!privateUrl.trim()) {
      alert("Please enter a URL for your private Bitcoin node");
      return;
    }
    if (!privateUsername.trim()) {
      alert("Please enter RPC username");
      return;
    }
    if (!privatePassword.trim()) {
      alert("Please enter RPC password");
      return;
    }

    const config: PrivateClientConfig = {
      url: privateUrl.trim(),
      username: privateUsername.trim(),
      password: privatePassword.trim(),
      walletName: privateWalletName.trim() || undefined,
    };

    setPrivateClientConfig(config);
    alert("Private node configuration saved!");
  };

  const handleTestConnection = async () => {
    if (
      !privateUrl.trim() ||
      !privateUsername.trim() ||
      !privatePassword.trim()
    ) {
      alert("Please fill in all required fields first");
      return;
    }

    alert(
      "Connection testing will be implemented in a future update.\n\nFor now, the configuration will be saved and used when you switch to Private mode.",
    );
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

      {/* Private Node Configuration - Only show when Private is selected */}
      {clientType === ClientType.PRIVATE && (
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
            Private Node Configuration
          </h4>
          <p
            style={{
              color: "#888",
              fontSize: "11px",
              marginBottom: "12px",
              lineHeight: "1.4",
            }}
          >
            Configure connection to your private Bitcoin Core node. Required for
            regtest networks.
          </p>

          {/* URL Input */}
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                color: "var(--osrs-text-orange)",
                fontSize: "12px",
                marginBottom: "4px",
              }}
            >
              RPC URL *
            </label>
            <input
              type="text"
              value={privateUrl}
              onChange={(e) => setPrivateUrl(e.target.value)}
              placeholder="http://localhost:18443"
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: "12px",
                backgroundColor: "var(--osrs-brown-medium)",
                color: "var(--osrs-text-white)",
                border: "2px solid var(--inv-slot-border)",
                borderRadius: "4px",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Username Input */}
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                color: "var(--osrs-text-orange)",
                fontSize: "12px",
                marginBottom: "4px",
              }}
            >
              RPC Username *
            </label>
            <input
              type="text"
              value={privateUsername}
              onChange={(e) => setPrivateUsername(e.target.value)}
              placeholder="bitcoin_rpc_user"
              autoComplete="username"
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: "12px",
                backgroundColor: "var(--osrs-brown-medium)",
                color: "var(--osrs-text-white)",
                border: "2px solid var(--inv-slot-border)",
                borderRadius: "4px",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Password Input */}
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                color: "var(--osrs-text-orange)",
                fontSize: "12px",
                marginBottom: "4px",
              }}
            >
              RPC Password *
            </label>
            <input
              type="password"
              value={privatePassword}
              onChange={(e) => setPrivatePassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: "12px",
                backgroundColor: "var(--osrs-brown-medium)",
                color: "var(--osrs-text-white)",
                border: "2px solid var(--inv-slot-border)",
                borderRadius: "4px",
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Wallet Name Input (Optional) */}
          <div style={{ marginBottom: "12px" }}>
            <label
              style={{
                display: "block",
                color: "var(--osrs-text-orange)",
                fontSize: "12px",
                marginBottom: "4px",
              }}
            >
              Wallet Name (optional)
            </label>
            <input
              type="text"
              value={privateWalletName}
              onChange={(e) => setPrivateWalletName(e.target.value)}
              placeholder="Leave empty for default wallet"
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: "12px",
                backgroundColor: "var(--osrs-brown-medium)",
                color: "var(--osrs-text-white)",
                border: "2px solid var(--inv-slot-border)",
                borderRadius: "4px",
                fontFamily: "inherit",
              }}
            />
            <p
              style={{
                color: "#888",
                fontSize: "10px",
                marginTop: "4px",
                fontStyle: "italic",
              }}
            >
              For multi-wallet Bitcoin Core setups
            </p>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
            <Button onClick={handleSavePrivateConfig}>
              Save Configuration
            </Button>
            <Button variant="secondary" onClick={handleTestConnection}>
              Test Connection
            </Button>
          </div>

          {/* Help Text */}
          <div
            style={{
              marginTop: "12px",
              padding: "8px",
              background: "rgba(255, 165, 0, 0.1)",
              border: "1px solid #ff9900",
              borderRadius: "4px",
              color: "#ffcc66",
              fontSize: "11px",
              lineHeight: "1.4",
            }}
          >
            <strong>⚠️ Important:</strong> Bitcoin Core does not support CORS by
            default. You may need to run a CORS proxy (nginx or corsproxy) to
            connect from the browser.
          </div>
        </div>
      )}

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
