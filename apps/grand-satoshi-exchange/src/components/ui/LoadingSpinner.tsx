/**
 * Grand Satoshi Exchange - Loading Spinner
 *
 * RuneScape-inspired loading animation with coin spinning effect
 */

import { useEffect, useState } from "react";
import styles from "./LoadingSpinner.module.css";

interface LoadingSpinnerProps {
  message?: string;
}

export function LoadingSpinner({
  message = "Loading...",
}: LoadingSpinnerProps) {
  const [dots, setDots] = useState("");

  // Animate dots
  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => {
        if (prev === "...") return "";
        return prev + ".";
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.spinner}>
        {/* Spinning Bitcoin symbol animation */}
        <div className={styles.coin}>
          <div className={styles.coinFront}>₿</div>
          <div className={styles.coinEdge}></div>
        </div>
      </div>
      <div className={styles.message}>
        {message}
        {dots}
      </div>
    </div>
  );
}

/**
 * Full-screen loading overlay (for blocking operations like wallet import)
 */
export function LoadingOverlay({ message }: LoadingSpinnerProps) {
  return (
    <div className={styles.overlay}>
      <LoadingSpinner message={message} />
    </div>
  );
}
