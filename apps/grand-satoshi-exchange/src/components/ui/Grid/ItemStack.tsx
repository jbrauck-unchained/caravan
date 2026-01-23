import styles from "./Grid.module.css";
import { getCoinImage, formatSatoshis } from "@/utils/coins";

interface ItemStackProps {
  /** Icon path or 'coins' for UTXO coins */
  icon: string;
  /** Quantity to display */
  quantity?: number;
  /** Whether this is a UTXO (uses tiered coin graphics) */
  isUTXO?: boolean;
  /** Click handler */
  onClick?: () => void;
}

export function ItemStack({
  icon,
  quantity,
  isUTXO = false,
  onClick,
}: ItemStackProps) {
  // For UTXOs, use tiered coin graphics based on satoshi amount
  const displayIcon = isUTXO && quantity ? getCoinImage(quantity) : icon;

  // Determine quantity color based on amount (like OSRS)
  const getQuantityClass = (qty?: number): string => {
    if (!qty || qty < 100_000) return "";
    if (qty < 1_000_000) return styles.large;
    if (qty < 10_000_000) return styles.huge;
    return styles.massive;
  };

  // Format quantity display
  const formatQuantity = (qty?: number): string => {
    if (!qty || qty === 1) return "";
    return formatSatoshis(qty);
  };

  return (
    <div className={styles.itemStack} onClick={onClick}>
      <img
        src={displayIcon}
        alt={isUTXO ? "Bitcoin UTXO" : "Item"}
        className={styles.itemIcon}
        draggable={false}
      />
      {quantity && quantity > 1 && (
        <span
          className={`${styles.itemQuantity} ${getQuantityClass(quantity)}`}
        >
          {formatQuantity(quantity)}
        </span>
      )}
    </div>
  );
}
