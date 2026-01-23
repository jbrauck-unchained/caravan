import { ReactNode } from "react";
import styles from "./Display.module.css";

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: "top" | "bottom";
}

export function Tooltip({ content, children, position = "top" }: TooltipProps) {
  return (
    <div className={styles.tooltipContainer}>
      {children}
      <div className={`${styles.tooltip} ${styles[position]}`}>{content}</div>
    </div>
  );
}
