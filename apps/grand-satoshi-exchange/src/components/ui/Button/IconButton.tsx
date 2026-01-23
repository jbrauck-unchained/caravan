import { ReactNode, ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  "aria-label": string;
}

export function IconButton({
  children,
  className = "",
  ...props
}: IconButtonProps) {
  return (
    <button
      className={`${styles.button} ${styles.iconButton} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
