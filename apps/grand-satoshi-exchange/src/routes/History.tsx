export function History() {
  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h3
        style={{
          color: "var(--osrs-text-yellow)",
          marginBottom: "16px",
        }}
      >
        Transaction History
      </h3>
      <p style={{ color: "var(--osrs-text-white)", marginBottom: "12px" }}>
        Completed transactions will appear here
      </p>
      <div
        style={{
          padding: "24px",
          backgroundColor: "var(--osrs-brown-dark)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
        }}
      >
        <p style={{ color: "#888", fontSize: "14px" }}>
          No transaction history yet
        </p>
      </div>
    </div>
  );
}
