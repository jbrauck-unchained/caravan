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

export interface PrivateClientConfig {
  url: string;
  username: string;
  password: string;
  walletName?: string;
}

export interface ClientState {
  /** Current network */
  network: Network;
  /** Current blockchain provider */
  clientType: ClientType;
  /** Private client configuration (for regtest/local node) */
  privateClientConfig: PrivateClientConfig | null;
  /** Initialized blockchain client */
  client: BlockchainClient | null;
  /** Whether client is initializing */
  isInitializing: boolean;
  /** Client error (if any) */
  error: string | null;

  // Actions
  setNetwork: (network: Network) => void;
  setClientType: (clientType: ClientType) => void;
  setPrivateClientConfig: (config: PrivateClientConfig | null) => void;
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
      privateClientConfig: null,
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

      // Set private client configuration
      setPrivateClientConfig: (config: PrivateClientConfig | null) => {
        console.log(
          "[ClientStore] Setting private client config:",
          config ? "configured" : "cleared",
        );
        set({ privateClientConfig: config, client: null });
        get().initializeClient();
      },

      // Initialize blockchain client
      initializeClient: async () => {
        const { network, clientType, privateClientConfig } = get();

        set({ isInitializing: true, error: null });

        try {
          console.log(
            `[ClientStore] Initializing client: ${clientType} on ${network}`,
          );

          // Build client configuration
          const clientConfig: any = {
            type: clientType,
            network,
          };

          // Add private client configuration if available
          if (clientType === ClientType.PRIVATE && privateClientConfig) {
            console.log(`[ClientStore] Using private client config:`, {
              url: privateClientConfig.url,
              username: privateClientConfig.username,
              walletName: privateClientConfig.walletName,
            });
            clientConfig.client = {
              url: privateClientConfig.url,
              username: privateClientConfig.username,
              password: privateClientConfig.password,
              walletName: privateClientConfig.walletName,
            };
          } else if (clientType === ClientType.PRIVATE) {
            throw new Error(
              "Private client selected but no configuration provided",
            );
          }

          // Create new blockchain client
          const client = new BlockchainClient(clientConfig);

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
      // Only persist network, clientType, and privateClientConfig (not the client instance)
      partialize: (state) => ({
        network: state?.network ?? Network.MAINNET,
        clientType: state?.clientType ?? ClientType.MEMPOOL,
        privateClientConfig: state?.privateClientConfig ?? null,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("[ClientStore] Hydration error:", error);
        } else {
          console.log("[ClientStore] Hydration complete:", state);
        }
      },
      // Merge persisted state with defaults
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<ClientState>),
      }),
    },
  ),
);

/**
 * Hook to get the current blockchain client
 * Automatically initializes if needed
 */
export const useClient = (): BlockchainClient | null => {
  const client = useClientStore((state) => state?.client ?? null);
  const isInitializing = useClientStore(
    (state) => state?.isInitializing ?? false,
  );
  const initializeClient = useClientStore((state) => state?.initializeClient);

  // Auto-initialize on first use
  useEffect(() => {
    if (!client && !isInitializing && initializeClient) {
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
