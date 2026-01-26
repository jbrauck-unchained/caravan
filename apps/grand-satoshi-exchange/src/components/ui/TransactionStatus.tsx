/**
 * Grand Satoshi Exchange - Transaction Status Badge
 *
 * Visual indicator for transaction confirmation status.
 * Shows different colors and animations based on confirmation count.
 */

import type { TransactionStatus } from "@/types/transaction";

export interface TransactionStatusProps {
  /** Current transaction status */
  status: TransactionStatus;
  /** Number of confirmations */
  confirmations: number;
  /** Size variant */
  size?: "small" | "normal" | "large";
}

/**
 * Transaction Status Badge Component
 *
 * Displays a colored badge with animation based on transaction status:
 * - Mempool (0 conf): Yellow with pulse animation
 * - Confirming (1-5 conf): Orange with progress indicator
 * - Confirmed (6+ conf): Green with checkmark
 * - Archived: Gray with archive icon
 *
 * @example
 * ```tsx
 * <TransactionStatus status="confirming" confirmations={3} />
 * <TransactionStatus status="confirmed" confirmations={6} size="large" />
 * ```
 */
export function TransactionStatus({
  status,
  confirmations,
  size = "normal",
}: TransactionStatusProps) {
  // Size styles
  const sizeStyles = {
    small: {
      padding: "2px 6px",
      fontSize: "10px",
      gap: "3px",
    },
    normal: {
      padding: "4px 8px",
      fontSize: "11px",
      gap: "4px",
    },
    large: {
      padding: "6px 12px",
      fontSize: "13px",
      gap: "6px",
    },
  };

  const currentSize = sizeStyles[size];

  // Status-specific styles and content
  const getStatusConfig = () => {
    switch (status) {
      case "mempool":
        return {
          backgroundColor: "var(--osrs-yellow)",
          color: "var(--osrs-brown-dark)",
          label: "Pending",
          icon: "⏳",
          animate: true,
        };
      case "confirming":
        return {
          backgroundColor: "var(--osrs-orange)",
          color: "var(--osrs-text-white)",
          label: `${confirmations}/6`,
          icon: "🔄",
          animate: true,
        };
      case "confirmed":
        return {
          backgroundColor: "var(--osrs-green)",
          color: "var(--osrs-text-white)",
          label: "Confirmed",
          icon: "✓",
          animate: false,
        };
      case "archived":
        return {
          backgroundColor: "var(--osrs-brown-medium)",
          color: "var(--osrs-text-gray)",
          label: "Archived",
          icon: "📦",
          animate: false,
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: currentSize.gap,
        padding: currentSize.padding,
        backgroundColor: config.backgroundColor,
        color: config.color,
        fontSize: currentSize.fontSize,
        fontWeight: "bold",
        borderRadius: "3px",
        border: "1px solid rgba(0, 0, 0, 0.2)",
        boxShadow: "0 1px 2px rgba(0, 0, 0, 0.2)",
        animation: config.animate ? "pulse 2s ease-in-out infinite" : "none",
        whiteSpace: "nowrap",
      }}
      role="status"
      aria-label={`Transaction status: ${config.label} (${confirmations} confirmations)`}
    >
      <span style={{ lineHeight: 1 }}>{config.icon}</span>
      <span style={{ lineHeight: 1 }}>{config.label}</span>

      {/* Inline animation styles */}
      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.9;
            transform: scale(1.02);
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Minimal status indicator (just a colored dot)
 * Useful for compact layouts
 */
export function TransactionStatusDot({
  status,
}: {
  status: TransactionStatus;
}) {
  const getColor = () => {
    switch (status) {
      case "mempool":
        return "var(--osrs-yellow)";
      case "confirming":
        return "var(--osrs-orange)";
      case "confirmed":
        return "var(--osrs-green)";
      case "archived":
        return "var(--osrs-brown-medium)";
    }
  };

  return (
    <div
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        backgroundColor: getColor(),
        border: "1px solid rgba(0, 0, 0, 0.3)",
        animation:
          status === "mempool" || status === "confirming"
            ? "pulse 2s ease-in-out infinite"
            : "none",
      }}
      role="presentation"
      aria-hidden="true"
    />
  );
}

/**
 * Progress bar showing confirmation progress (0-6)
 */
export function ConfirmationProgress({
  confirmations,
  target = 6,
}: {
  confirmations: number;
  target?: number;
}) {
  const progress = Math.min(confirmations, target);
  const percentage = (progress / target) * 100;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "10px",
          color: "var(--osrs-text-gray)",
        }}
      >
        <span>{confirmations} confirmations</span>
        <span>
          {progress}/{target}
        </span>
      </div>
      <div
        style={{
          height: "6px",
          backgroundColor: "var(--osrs-brown-dark)",
          borderRadius: "3px",
          overflow: "hidden",
          border: "1px solid rgba(0, 0, 0, 0.3)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${percentage}%`,
            backgroundColor:
              confirmations >= target
                ? "var(--osrs-green)"
                : "var(--osrs-orange)",
            transition: "width 0.3s ease-out",
          }}
        />
      </div>
    </div>
  );
}
