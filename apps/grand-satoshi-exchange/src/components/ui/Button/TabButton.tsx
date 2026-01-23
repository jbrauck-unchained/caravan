import { ReactNode, ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface TabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  active?: boolean;
}

export function TabButton({
  children,
  active = false,
  className = "",
  ...props
}: TabButtonProps) {
  return (
    <button
      className={`${styles.button} ${styles.tabButton} ${
        active ? styles.active : ""
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
