/**
 * Grand Satoshi Exchange - Client Store
 *
 * Zustand store for managing blockchain client state and network selection.
 */

import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BlockchainClient, ClientType } from "@caravan/clients";
import { Network } from "@caravan/bitcoin";

export interface ClientState {
  /** Current network */
  network: Network;
  /** Current blockchain provider */
  clientType: ClientType;
  /** Initialized blockchain client */
  client: BlockchainClient | null;
  /** Whether client is initializing */
  isInitializing: boolean;
  /** Client error (if any) */
  error: string | null;

  // Actions
  setNetwork: (network: Network) => void;
  setClientType: (clientType: ClientType) => void;
  initializeClient: () => Promise<void>;
  clearError: () => void;
}

/**
 * Client Store
 * Manages blockchain client configuration and initialization
 */
export const useClientStore = create<ClientState>()(
  persist(
    (set, get) => ({
      // Initial state
      network: Network.MAINNET,
      clientType: ClientType.MEMPOOL,
      client: null,
      isInitializing: false,
      error: null,

      // Set network and reinitialize client
      setNetwork: async (network: Network) => {
        set({ network, client: null });
        await get().initializeClient();
      },

      // Set client type and reinitialize client
      setClientType: async (clientType: ClientType) => {
        set({ clientType, client: null });
        await get().initializeClient();
      },

      // Initialize blockchain client
      initializeClient: async () => {
        const { network, clientType } = get();

        set({ isInitializing: true, error: null });

        try {
          console.log(
            `[ClientStore] Initializing client: ${clientType} on ${network}`,
          );

          // Create new blockchain client
          const client = new BlockchainClient({
            type: clientType,
            network,
          });

          console.log(`[ClientStore] Client created successfully`);

          set({
            client,
            isInitializing: false,
            error: null,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error
              ? error.message
              : "Failed to initialize blockchain client";

          console.error("[ClientStore] Client initialization error:", error);

          set({
            client: null,
            isInitializing: false,
            error: errorMessage,
          });
        }
      },

      // Clear error state
      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: "gse-client-storage",
      // Only persist network and clientType, not the client instance
      partialize: (state) => ({
        network: state.network,
        clientType: state.clientType,
      }),
    },
  ),
);

/**
 * Hook to get the current blockchain client
 * Automatically initializes if needed
 */
export const useClient = (): BlockchainClient | null => {
  const { client, initializeClient, isInitializing } = useClientStore();

  // Auto-initialize on first use
  useEffect(() => {
    if (!client && !isInitializing) {
      initializeClient();
    }
  }, [client, isInitializing, initializeClient]);

  return client;
};

/**
 * Get network display name
 */
export const getNetworkName = (network: Network): string => {
  switch (network) {
    case Network.MAINNET:
      return "Mainnet";
    case Network.TESTNET:
      return "Testnet";
    case Network.SIGNET:
      return "Signet";
    case Network.REGTEST:
      return "Regtest";
    default:
      return "Unknown";
  }
};

/**
 * Get client type display name
 */
export const getClientTypeName = (clientType: ClientType): string => {
  const names: Record<string, string> = {
    mempool: "Mempool.space",
    blockstream: "Blockstream",
    public: "Public Provider",
    private: "Private Server",
  };
  return names[clientType] || "Unknown";
};
