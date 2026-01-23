/**
 * Grand Satoshi Exchange - Wallet Store
 *
 * Zustand store for managing wallet state, UTXOs, and addresses.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Network } from "@caravan/bitcoin";
import type { MultisigWalletConfig } from "@caravan/multisig";
import type { WalletState, UTXO, AddressSlice } from "@/types/wallet";
import {
  deriveInitialAddresses,
  deriveAddressRange,
  createAddressMap,
  shouldDeriveMoreAddresses,
  findNextUnusedAddress,
} from "@/utils/address";

export interface WalletStoreState {
  /** Current wallet state (null if no wallet loaded) */
  wallet: WalletState | null;
  /** Whether wallet is loading */
  isLoading: boolean;
  /** Error message */
  error: string | null;

  // Actions
  loadWallet: (config: MultisigWalletConfig, network: Network) => Promise<void>;
  clearWallet: () => void;
  setUTXOs: (utxos: UTXO[]) => void;
  updateAddressBalances: () => void;
  deriveMoreAddresses: (change: 0 | 1, count: number) => void;
  setSyncing: (syncing: boolean) => void;
  clearError: () => void;
}

/**
 * Wallet Store
 * Manages wallet configuration, addresses, and UTXOs
 */
export const useWalletStore = create<WalletStoreState>()(
  persist(
    (set, get) => ({
      // Initial state
      wallet: null,
      isLoading: false,
      error: null,

      // Load wallet from configuration
      loadWallet: async (config: MultisigWalletConfig, network: Network) => {
        set({ isLoading: true, error: null });

        try {
          // Derive initial addresses (20 receiving + 20 change)
          const addresses = deriveInitialAddresses(config, network);

          // Create initial wallet state
          const walletState: WalletState = {
            config,
            network,
            utxos: [],
            addresses,
            totalBalance: 0,
            confirmedUTXOCount: 0,
            unconfirmedUTXOCount: 0,
            isSyncing: false,
            addressIndices: {
              receiving: 0,
              change: 0,
            },
          };

          set({
            wallet: walletState,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Failed to load wallet";

          console.error("Wallet loading error:", error);

          set({
            wallet: null,
            isLoading: false,
            error: errorMessage,
          });
        }
      },

      // Clear wallet
      clearWallet: () => {
        console.log("[WalletStore] Clearing wallet");
        set({ wallet: null, error: null });
        // Also clear from localStorage
        localStorage.removeItem("gse-wallet-storage");
      },

      // Set UTXOs and recalculate balances
      setUTXOs: (utxos: UTXO[]) => {
        const { wallet } = get();
        if (!wallet) return;

        // Calculate total balance
        const totalBalance = utxos.reduce((sum, utxo) => sum + utxo.value, 0);

        // Count confirmed/unconfirmed
        const confirmedUTXOCount = utxos.filter((u) => u.confirmed).length;
        const unconfirmedUTXOCount = utxos.length - confirmedUTXOCount;

        // Update wallet state
        set({
          wallet: {
            ...wallet,
            utxos,
            totalBalance,
            confirmedUTXOCount,
            unconfirmedUTXOCount,
            lastSynced: Date.now(),
          },
        });

        // Update address balances
        get().updateAddressBalances();
      },

      // Update address balances based on UTXOs
      updateAddressBalances: () => {
        const { wallet } = get();
        if (!wallet) return;

        // Create address map for quick lookup
        const addressMap = createAddressMap(wallet.addresses);

        // Reset all balances
        wallet.addresses.forEach((addr) => {
          addr.balance = 0;
          addr.utxoCount = 0;
          addr.totalReceived = 0;
        });

        // Track UTXOs without matching addresses
        const orphanedUTXOs: string[] = [];

        // Update balances from UTXOs
        wallet.utxos.forEach((utxo) => {
          const addressSlice = addressMap.get(utxo.address);
          if (addressSlice) {
            addressSlice.balance += utxo.value;
            addressSlice.utxoCount += 1;
            addressSlice.totalReceived += utxo.value;
            addressSlice.used = true;
          } else {
            // UTXO for an address we haven't derived yet!
            orphanedUTXOs.push(utxo.address);
            console.warn(
              `[WalletStore] Found UTXO for un-derived address: ${utxo.address}`,
            );
            console.warn(
              `[WalletStore] This address is beyond the current derivation range`,
            );
          }
        });

        if (orphanedUTXOs.length > 0) {
          console.error(
            `[WalletStore] ⚠️ ${orphanedUTXOs.length} UTXOs found for addresses not yet derived!`,
          );
          console.error(
            `[WalletStore] You may need to increase the gap limit or derive more addresses`,
          );
        }

        // Find next unused address indices
        const nextReceivingAddr = findNextUnusedAddress(wallet.addresses, 0);
        const nextChangeAddr = findNextUnusedAddress(wallet.addresses, 1);

        set({
          wallet: {
            ...wallet,
            addressIndices: {
              receiving: nextReceivingAddr?.index ?? 0,
              change: nextChangeAddr?.index ?? 0,
            },
          },
        });

        // Check if we need to derive more addresses (gap limit)
        if (shouldDeriveMoreAddresses(wallet.addresses, 0)) {
          get().deriveMoreAddresses(0, 20);
        }
        if (shouldDeriveMoreAddresses(wallet.addresses, 1)) {
          get().deriveMoreAddresses(1, 20);
        }
      },

      // Derive additional addresses
      deriveMoreAddresses: (change: 0 | 1, count: number) => {
        const { wallet } = get();
        if (!wallet) return;

        // Find highest existing index
        const existingAddresses = wallet.addresses.filter(
          (addr) => addr.change === change,
        );
        const highestIndex = Math.max(
          ...existingAddresses.map((addr) => addr.index),
          -1,
        );

        // Derive new addresses
        const newAddresses = deriveAddressRange(
          wallet.config,
          wallet.network,
          change,
          highestIndex + 1,
          count,
        );

        set({
          wallet: {
            ...wallet,
            addresses: [...wallet.addresses, ...newAddresses],
          },
        });
      },

      // Set syncing state
      setSyncing: (syncing: boolean) => {
        const { wallet } = get();
        if (!wallet) return;

        set({
          wallet: {
            ...wallet,
            isSyncing: syncing,
          },
        });
      },

      // Clear error
      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: "gse-wallet-storage",
      // Persist entire wallet state
      partialize: (state) => ({
        wallet: state.wallet,
      }),
      // Custom storage to ensure proper serialization/deserialization
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;

          try {
            const parsed = JSON.parse(str);
            console.log("[WalletStore] Loaded from storage:", {
              hasWallet: !!parsed.state?.wallet,
              hasConfig: !!parsed.state?.wallet?.config,
              hasExtendedPublicKeys:
                !!parsed.state?.wallet?.config?.extendedPublicKeys,
              extendedPublicKeysLength:
                parsed.state?.wallet?.config?.extendedPublicKeys?.length,
            });

            // Validate the restored wallet config
            if (parsed.state?.wallet?.config) {
              const config = parsed.state.wallet.config;
              if (
                !config.extendedPublicKeys ||
                !Array.isArray(config.extendedPublicKeys)
              ) {
                console.error(
                  "[WalletStore] Corrupted wallet config detected - clearing storage",
                );
                localStorage.removeItem(name);
                return null;
              }
            }

            return parsed;
          } catch (err) {
            console.error("[WalletStore] Failed to parse storage:", err);
            return null;
          }
        },
        setItem: (name, value) => {
          console.log("[WalletStore] Saving to storage:", {
            hasWallet: !!value.state?.wallet,
            hasConfig: !!value.state?.wallet?.config,
            hasExtendedPublicKeys:
              !!value.state?.wallet?.config?.extendedPublicKeys,
            extendedPublicKeysLength:
              value.state?.wallet?.config?.extendedPublicKeys?.length,
          });
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    },
  ),
);

/**
 * Hook to check if wallet is loaded
 */
export const useHasWallet = (): boolean => {
  return useWalletStore((state) => state.wallet !== null);
};

/**
 * Hook to get current wallet config
 */
export const useWalletConfig = (): MultisigWalletConfig | null => {
  return useWalletStore((state) => state.wallet?.config ?? null);
};

/**
 * Hook to get all addresses
 */
export const useAddresses = (): AddressSlice[] => {
  return useWalletStore((state) => state.wallet?.addresses ?? []);
};

/**
 * Hook to get receiving addresses only
 */
export const useReceivingAddresses = (): AddressSlice[] => {
  return useWalletStore(
    (state) =>
      state.wallet?.addresses.filter((addr) => addr.change === 0) ?? [],
  );
};

/**
 * Hook to get next unused receiving address
 */
export const useNextReceivingAddress = (): AddressSlice | null => {
  const addresses = useReceivingAddresses();
  return findNextUnusedAddress(addresses, 0) ?? null;
};

/**
 * Hook to get all UTXOs
 */
export const useUTXOs = (): UTXO[] => {
  return useWalletStore((state) => state.wallet?.utxos ?? []);
};

/**
 * Hook to get wallet balance
 */
export const useBalance = (): number => {
  return useWalletStore((state) => state.wallet?.totalBalance ?? 0);
};

/**
 * Hook to get wallet network
 */
export const useWalletNetwork = (): Network | null => {
  return useWalletStore((state) => state.wallet?.network ?? null);
};
