import { ReactNode } from "react";
import styles from "./Window.module.css";

interface WindowProps {
  title: string;
  children: ReactNode;
  onClose?: () => void;
}

export function Window({ title, children, onClose }: WindowProps) {
  return (
    <div className={styles.window}>
      <div className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {onClose && (
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
