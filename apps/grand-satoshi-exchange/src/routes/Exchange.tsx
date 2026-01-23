import { Button } from "../components/ui/Button";
import { ProgressBar } from "../components/ui/Display";

export function Exchange() {
  // Mock pending offers
  const mockOffers = [
    {
      id: 1,
      amount: 500000,
      destination: "bc1q...xyz",
      signatures: 2,
      required: 3,
    },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ];

  return (
    <div style={{ padding: "20px" }}>
      <h3
        style={{
          color: "var(--osrs-text-yellow)",
          marginBottom: "16px",
          textAlign: "center",
        }}
      >
        Grand Exchange (Pending Transactions)
      </h3>

      {/* 8 Offer Slots in 2x4 grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        {mockOffers.map((offer, index) => (
          <div
            key={index}
            style={{
              padding: "16px",
              backgroundColor: offer
                ? "var(--ge-slot-active)"
                : "var(--ge-slot-empty)",
              border: "2px solid var(--inv-slot-border)",
              borderRadius: "4px",
              minHeight: "120px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            {offer ? (
              <>
                <div
                  style={{
                    color: "var(--osrs-text-yellow)",
                    fontSize: "14px",
                  }}
                >
                  Slot {index + 1}
                </div>
                <div
                  style={{
                    color: "var(--osrs-text-white)",
                    fontSize: "12px",
                  }}
                >
                  Amount: {offer.amount.toLocaleString()} sats
                </div>
                <div
                  style={{
                    color: "var(--osrs-text-cyan)",
                    fontSize: "12px",
                  }}
                >
                  To: {offer.destination}
                </div>
                <ProgressBar
                  current={offer.signatures}
                  total={offer.required}
                  label={`${offer.signatures}/${offer.required} signatures`}
                />
                <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                  <Button variant="primary" style={{ fontSize: "12px" }}>
                    Sign
                  </Button>
                  <Button variant="danger" style={{ fontSize: "12px" }}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Button variant="secondary">+ New Offer</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Collection Box */}
      <div
        style={{
          padding: "16px",
          backgroundColor: "var(--osrs-brown-medium)",
          border: "2px solid var(--inv-slot-border)",
          borderRadius: "4px",
        }}
      >
        <h4
          style={{
            color: "var(--osrs-text-yellow)",
            marginBottom: "8px",
            fontSize: "14px",
          }}
        >
          Collection Box
        </h4>
        <p style={{ color: "#888", fontSize: "12px" }}>
          No completed transactions to collect
        </p>
      </div>
    </div>
  );
}
