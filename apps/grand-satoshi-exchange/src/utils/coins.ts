/**
 * Grand Satoshi Exchange - Coin Graphics Utilities
 *
 * Utilities for mapping satoshi amounts to tiered coin stack graphics.
 * Inspired by Old School RuneScape's coin stack system.
 */

export type CoinTier = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Coin tier thresholds (in satoshis)
 */
export const COIN_TIER_THRESHOLDS = {
  TIER_1: 0, // 0-100k sats (< 0.001 BTC)
  TIER_2: 100_000, // 100k-1M sats (0.001-0.01 BTC)
  TIER_3: 1_000_000, // 1M-5M sats (0.01-0.05 BTC)
  TIER_4: 5_000_000, // 5M-10M sats (0.05-0.1 BTC)
  TIER_5: 10_000_000, // 10M-100M sats (0.1-1 BTC)
  TIER_6: 100_000_000, // 100M+ sats (1+ BTC)
} as const;

/**
 * Get coin tier for a given satoshi amount
 *
 * @param sats - Amount in satoshis
 * @returns Coin tier (1-6)
 */
export function getCoinTier(sats: number): CoinTier {
  if (sats >= COIN_TIER_THRESHOLDS.TIER_6) return 6; // 1+ BTC
  if (sats >= COIN_TIER_THRESHOLDS.TIER_5) return 5; // 0.1-1 BTC
  if (sats >= COIN_TIER_THRESHOLDS.TIER_4) return 4; // 0.05-0.1 BTC
  if (sats >= COIN_TIER_THRESHOLDS.TIER_3) return 3; // 0.01-0.05 BTC
  if (sats >= COIN_TIER_THRESHOLDS.TIER_2) return 2; // 0.001-0.01 BTC
  return 1; // < 0.001 BTC
}

/**
 * Get coin stack image path for a given satoshi amount
 *
 * @param sats - Amount in satoshis
 * @returns Path to coin stack SVG
 */
export function getCoinImage(sats: number): string {
  const tier = getCoinTier(sats);
  return `/assets/sprites/coins-tier${tier}.svg`;
}

/**
 * Get coin tier description
 *
 * @param tier - Coin tier (1-6)
 * @returns Description of the tier
 */
export function getCoinTierDescription(tier: CoinTier): string {
  switch (tier) {
    case 1:
      return "Small stack (< 0.001 BTC)";
    case 2:
      return "Medium stack (0.001-0.01 BTC)";
    case 3:
      return "Large stack (0.01-0.05 BTC)";
    case 4:
      return "Huge stack (0.05-0.1 BTC)";
    case 5:
      return "Massive stack (0.1-1 BTC)";
    case 6:
      return "Legendary stack (1+ BTC)";
  }
}

/**
 * Get coin tier color for styling
 *
 * @param tier - Coin tier (1-6)
 * @returns CSS color value
 */
export function getCoinTierColor(tier: CoinTier): string {
  switch (tier) {
    case 1:
      return "#FFD700"; // Gold
    case 2:
      return "#FFD700"; // Gold
    case 3:
      return "#FFD700"; // Gold
    case 4:
      return "#FFD700"; // Gold
    case 5:
      return "#FFD700"; // Gold
    case 6:
      return "#FFFF00"; // Bright gold (legendary)
  }
}

/**
 * Format satoshi amount for display
 * Uses K/M/B suffixes like OSRS
 *
 * @param sats - Amount in satoshis
 * @returns Formatted string
 */
export function formatSatoshis(sats: number): string {
  if (sats >= 1_000_000_000) {
    // 1B+
    return `${(sats / 1_000_000_000).toFixed(1)}B`;
  }
  if (sats >= 1_000_000) {
    // 1M+
    return `${(sats / 1_000_000).toFixed(1)}M`;
  }
  if (sats >= 1_000) {
    // 1K+
    return `${(sats / 1_000).toFixed(1)}K`;
  }
  return sats.toString();
}

/**
 * Format satoshis as BTC
 *
 * @param sats - Amount in satoshis
 * @returns Formatted BTC string
 */
export function formatBTC(sats: number): string {
  return `${(sats / 100_000_000).toFixed(8)} BTC`;
}
