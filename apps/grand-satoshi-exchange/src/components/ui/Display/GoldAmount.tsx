import styles from "./Display.module.css";
import { formatSatoshis, formatBTC } from "@/utils/coins";

interface GoldAmountProps {
  sats: bigint | number;
  showBtc?: boolean;
  size?: "normal" | "large" | "xlarge";
}

export function GoldAmount({
  sats,
  showBtc = false,
  size = "normal",
}: GoldAmountProps) {
  const satoshis = typeof sats === "bigint" ? Number(sats) : sats;

  return (
    <span className={`${styles.goldAmount} ${styles[size]}`}>
      <span className={styles.coinIcon}>₿</span>
      <span>{formatSatoshis(satoshis)} sats</span>
      {showBtc && (
        <span className={styles.btcValue}>≈ {formatBTC(satoshis)}</span>
      )}
    </span>
  );
}
