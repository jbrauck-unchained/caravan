/**
 * Grand Satoshi Exchange - Fee Estimates Hook
 *
 * React Query hook for fetching fee rate estimates from the blockchain.
 */

import { useQuery } from "@tanstack/react-query";
import { useClientStore } from "@/stores/clientStore";
import type { FeeRatePreset } from "@/types/transaction";

/**
 * Default fee rates (fallback if API fails)
 */
const DEFAULT_FEE_RATES: FeeRatePreset[] = [
  { label: "Slow", rate: 1, eta: "~24 hours", blocks: 144 },
  { label: "Standard", rate: 5, eta: "~1 hour", blocks: 6 },
  { label: "Fast", rate: 10, eta: "~10 min", blocks: 1 },
];

/**
 * Fetch fee estimates from blockchain client
 */
async function fetchFeeEstimates(client: any): Promise<FeeRatePreset[]> {
  try {
    console.log("[Fees] Fetching fee estimates...");

    // Fetch fee estimates for different block targets
    const [slow, standard, fast] = await Promise.all([
      client.getFeeEstimate(144), // ~24 hours
      client.getFeeEstimate(6), // ~1 hour
      client.getFeeEstimate(1), // Next block
    ]);

    console.log("[Fees] Raw estimates:", { slow, standard, fast });

    const presets: FeeRatePreset[] = [
      {
        label: "Slow",
        rate: Math.max(1, Math.ceil(slow)),
        eta: "~24 hours",
        blocks: 144,
      },
      {
        label: "Standard",
        rate: Math.max(1, Math.ceil(standard)),
        eta: "~1 hour",
        blocks: 6,
      },
      {
        label: "Fast",
        rate: Math.max(1, Math.ceil(fast)),
        eta: "~10 min",
        blocks: 1,
      },
    ];

    console.log("[Fees] Fee presets:", presets);
    return presets;
  } catch (error) {
    console.error("[Fees] Failed to fetch fee estimates:", error);
    console.warn("[Fees] Using default fee rates");
    return DEFAULT_FEE_RATES;
  }
}

/**
 * Hook to fetch fee rate estimates
 */
export function useFeeEstimates() {
  const client = useClientStore((state) => state.client);
  const network = useClientStore((state) => state.network);

  const {
    data: feeRates,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["fee-estimates", network],
    queryFn: () => {
      if (!client) {
        console.warn("[Fees] No client available, using defaults");
        return DEFAULT_FEE_RATES;
      }
      return fetchFeeEstimates(client);
    },
    enabled: !!client,
    staleTime: 60_000, // 1 minute
    refetchInterval: 60_000, // Refresh every minute
    initialData: DEFAULT_FEE_RATES,
  });

  return {
    feeRates: feeRates ?? DEFAULT_FEE_RATES,
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  };
}

/**
 * Hook to get a specific fee rate preset
 */
export function useFeeRate(label: "Slow" | "Standard" | "Fast"): number {
  const { feeRates } = useFeeEstimates();
  const preset = feeRates.find((p) => p.label === label);
  return preset?.rate ?? 5;
}

/**
 * Hook to get recommended fee rate (Standard)
 */
export function useRecommendedFeeRate(): number {
  return useFeeRate("Standard");
}
