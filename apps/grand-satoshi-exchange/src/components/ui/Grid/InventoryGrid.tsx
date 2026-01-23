import { ReactNode } from "react";
import styles from "./Grid.module.css";

interface InventoryGridProps {
  children: ReactNode;
  title?: string;
  itemCount?: number;
  compact?: boolean;
}

export function InventoryGrid({
  children,
  title = "Inventory",
  itemCount,
  compact = false,
}: InventoryGridProps) {
  return (
    <div className={`${styles.inventoryGrid} ${compact ? styles.compact : ""}`}>
      {(title || itemCount !== undefined) && (
        <div className={styles.inventoryHeader}>
          <span className={styles.inventoryTitle}>{title}</span>
          {itemCount !== undefined && (
            <span className={styles.itemCount}>{itemCount} items</span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
