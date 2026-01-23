import styles from "./Display.module.css";

interface ProgressBarProps {
  current: number;
  total: number;
  label?: string;
  showLabel?: boolean;
}

export function ProgressBar({
  current,
  total,
  label,
  showLabel = true,
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (current / total) * 100));
  const displayLabel = label || `${current}/${total}`;

  return (
    <div className={styles.progressBar}>
      <div
        className={styles.progressFill}
        style={{ width: `${percentage}%` }}
      />
      {showLabel && <div className={styles.progressLabel}>{displayLabel}</div>}
    </div>
  );
}
