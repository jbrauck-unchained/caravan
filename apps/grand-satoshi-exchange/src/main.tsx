import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles/global.css";
import { useWalletStore } from "./stores/walletStore";
import { deriveAddress } from "./utils/address";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Debug utilities - expose to window for console debugging
declare global {
  interface Window {
    debugDeriveAddress: (change: 0 | 1, index: number) => void;
    debugGetWallet: () => void;
  }
}

window.debugDeriveAddress = (change: 0 | 1, index: number) => {
  const wallet = useWalletStore.getState().wallet;
  if (!wallet) {
    console.error("❌ No wallet loaded");
    return;
  }

  console.log(`🔍 Deriving address at path ${change}/${index}...`);
  const address = deriveAddress({
    config: wallet.config,
    network: wallet.network,
    change,
    index,
  });
  console.log("✅ Derived address:", address);
  return address;
};

window.debugGetWallet = () => {
  const wallet = useWalletStore.getState().wallet;
  if (!wallet) {
    console.error("❌ No wallet loaded");
    return;
  }
  console.log("📋 Current wallet:", {
    name: wallet.config.name,
    network: wallet.network,
    addressType: wallet.config.addressType,
    quorum: wallet.config.quorum,
    totalBalance: wallet.totalBalance,
    utxoCount: wallet.utxos.length,
    addressCount: wallet.addresses.length,
  });
  return wallet;
};

ReactDOM.createRoot(document.getElementById("app")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
