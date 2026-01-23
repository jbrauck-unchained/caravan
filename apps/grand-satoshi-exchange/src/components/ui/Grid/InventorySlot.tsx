import { ReactNode } from "react";
import styles from "./Grid.module.css";

interface InventorySlotProps {
  children?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

export function InventorySlot({
  children,
  selected = false,
  onClick,
  disabled = false,
}: InventorySlotProps) {
  const isEmpty = !children;

  return (
    <div
      className={`${styles.inventorySlot} ${
        selected ? styles.selected : ""
      } ${disabled ? styles.disabled : ""} ${isEmpty ? styles.empty : ""}`}
      onClick={!disabled && onClick ? onClick : undefined}
      role={onClick ? "button" : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
    >
      {children}
      {selected && <div className={styles.checkmark}>✓</div>}
    </div>
  );
}
