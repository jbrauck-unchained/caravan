/**
 * Grand Satoshi Exchange - Thick Progress Bar
 *
 * OSRS-style thick progress bar component with gold (partial) and green (complete) states
 */

export interface ThickProgressBarProps {
  /** Current progress value (0-max) */
  current: number;
  /** Maximum value */
  max: number;
  /** Height in pixels (default: 20) */
  height?: number;
  /** Color variant - gold for partial, green for complete */
  variant?: "gold" | "green";
  /** Optional label to display inside/above bar */
  label?: string;
}

export function ThickProgressBar({
  current,
  max,
  height = 20,
  variant = "gold",
  label,
}: ThickProgressBarProps) {
  const percentage = max > 0 ? Math.min((current / max) * 100, 100) : 0;
  const isComplete = current >= max;

  // Auto-select color based on completion if variant is gold
  const barColor =
    variant === "gold" && isComplete
      ? "var(--osrs-green)"
      : variant === "gold"
        ? "var(--osrs-gold)"
        : "var(--osrs-green)";

  return (
    <div style={{ width: "100%" }}>
      {label && (
        <div
          style={{
            color: "var(--osrs-text-white)",
            fontSize: "11px",
            marginBottom: "4px",
            textAlign: "center",
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          width: "100%",
          height: `${height}px`,
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "2px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Progress fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${percentage}%`,
            backgroundColor: barColor,
            transition: "width 0.3s ease-out, background-color 0.3s ease-out",
            boxShadow: "inset 0 -2px 4px rgba(0, 0, 0, 0.3)",
          }}
        />

        {/* Inner text */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--osrs-text-white)",
            fontSize: "11px",
            fontWeight: "bold",
            textShadow: "1px 1px 1px rgba(0, 0, 0, 0.8)",
            zIndex: 1,
          }}
        >
          {current}/{max}
        </div>
      </div>
    </div>
  );
}
