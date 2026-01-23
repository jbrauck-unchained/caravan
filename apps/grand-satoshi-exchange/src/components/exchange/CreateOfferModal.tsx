/**
 * Grand Satoshi Exchange - Create Offer Modal
 *
 * Multi-step wizard for creating a send transaction offer.
 *
 * Steps:
 * 1. UTXO Selection
 * 2. Destination Address
 * 3. Amount
 * 4. Fee Selection
 * 5. Review & Confirm
 */

import { useState, useEffect } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { AddressInput, NumberInput } from "../ui/Input";
import { GoldAmount } from "../ui/Display/GoldAmount";
import { InventoryGrid, InventorySlot, ItemStack } from "../ui/Grid";
import { Tooltip } from "../ui/Display/Tooltip";
import { validateAddress } from "@caravan/bitcoin";
import { useWalletStore, useUTXOs, useAddresses } from "@/stores/walletStore";
import { useClientStore } from "@/stores/clientStore";
import { useTransactionStore } from "@/stores/transactionStore";
import { useFeeEstimates } from "@/hooks/useFeeEstimates";
import { useClient } from "@/stores/clientStore";
// import { selectCoins } from "@/utils/coinSelection"; // Will be used for auto-select feature
import { createUnsignedPsbt, calculateFeeAndChange } from "@/utils/psbt";
import type { UTXO } from "@/types/wallet";
import type { PendingOffer } from "@/types/transaction";

export interface CreateOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-selected UTXOs (optional, from Bank view) */
  preSelectedUtxos?: Set<string>;
}

type Step = "utxos" | "destination" | "amount" | "fee" | "review";

export function CreateOfferModal({
  isOpen,
  onClose,
  preSelectedUtxos,
}: CreateOfferModalProps) {
  // State
  const [step, setStep] = useState<Step>("utxos");
  const [selectedUtxos, setSelectedUtxos] = useState<Set<string>>(new Set());
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedFeeRate, setSelectedFeeRate] = useState<number>(0);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wallet data
  const utxos = useUTXOs();
  const addresses = useAddresses();
  const wallet = useWalletStore((state) => state.wallet);
  const network = useClientStore((state) => state.network);
  const client = useClient();
  const { feeRates } = useFeeEstimates();
  const { createOffer } = useTransactionStore();

  // Reset on open/close
  useEffect(() => {
    if (isOpen) {
      // If UTXOs were pre-selected from Bank view, skip to destination step
      if (preSelectedUtxos && preSelectedUtxos.size > 0) {
        setStep("destination");
        setSelectedUtxos(new Set(preSelectedUtxos));
      } else {
        setStep("utxos");
        setSelectedUtxos(new Set());
      }
      setDestination("");
      setAmount("");
      setSelectedFeeRate(0);
      setError(null);
    }
  }, [isOpen, preSelectedUtxos]);

  // Get selected UTXO objects
  const selectedUtxoObjects = utxos.filter((utxo) =>
    selectedUtxos.has(`${utxo.txid}:${utxo.vout}`),
  );

  // Calculate totals
  const selectedTotal = selectedUtxoObjects.reduce(
    (sum, utxo) => sum + utxo.value,
    0,
  );

  // Toggle UTXO selection
  const toggleUtxo = (utxo: UTXO) => {
    const id = `${utxo.txid}:${utxo.vout}`;
    const newSelected = new Set(selectedUtxos);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedUtxos(newSelected);
  };

  // Validate destination address
  const isValidAddress = (addr: string): boolean => {
    if (!addr) return false;
    try {
      const result = validateAddress(addr, network);
      // validateAddress returns "" for valid or error string for invalid
      return result === "";
    } catch {
      return false;
    }
  };

  // Handle step navigation
  const canProceed = (): boolean => {
    switch (step) {
      case "utxos":
        return selectedUtxos.size > 0;
      case "destination":
        return isValidAddress(destination);
      case "amount":
        const amt = BigInt(amount || "0");
        return amt > 0n && amt <= BigInt(selectedTotal);
      case "fee":
        return selectedFeeRate > 0;
      case "review":
        return true;
      default:
        return false;
    }
  };

  const nextStep = () => {
    const steps: Step[] = ["utxos", "destination", "amount", "fee", "review"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex < steps.length - 1) {
      setStep(steps[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const steps: Step[] = ["utxos", "destination", "amount", "fee", "review"];
    const currentIndex = steps.indexOf(step);
    if (currentIndex > 0) {
      setStep(steps[currentIndex - 1]);
    }
  };

  // Create the offer
  const handleCreateOffer = async () => {
    if (!wallet?.config || !client) {
      setError("Wallet or client not available");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const sendAmount = BigInt(amount);

      // Calculate fee and change
      const { fee, change } = calculateFeeAndChange(
        selectedUtxoObjects,
        sendAmount,
        selectedFeeRate,
        wallet.config,
      );

      // Get change address (first unused change address)
      const changeAddresses = addresses.filter((addr) => addr.change === 1);
      const unusedChange = changeAddresses.find((addr) => !addr.used);
      if (!unusedChange) {
        throw new Error("No unused change addresses available");
      }

      // Create PSBT
      console.log("[CreateOffer] Creating PSBT...");
      const psbtBase64 = await createUnsignedPsbt(
        {
          selectedUtxos: selectedUtxoObjects,
          destination,
          amount: sendAmount,
          feeRate: selectedFeeRate,
          changeAddress: unusedChange.address,
          estimatedFee: fee,
          changeAmount: change,
        },
        wallet.config,
        network,
        addresses,
        client,
      );

      // Create offer object
      const offer: PendingOffer = {
        id: `offer-${Date.now()}`,
        createdAt: new Date(),
        unsignedPsbt: psbtBase64,
        signatures: [],
        requiredSignatures: wallet.config.quorum.requiredSigners,
        totalSignatures:
          wallet.config.quorum.totalSigners ??
          wallet.config.extendedPublicKeys.length,
        status: "pending",
        destination,
        amount: sendAmount,
        fee,
        feeRate: selectedFeeRate,
        inputs: selectedUtxoObjects,
        changeAmount: change > 0n ? change : undefined,
        changeAddress: change > 0n ? unusedChange.address : undefined,
      };

      // Add to store
      createOffer(offer);

      console.log("[CreateOffer] ✓ Offer created successfully");

      // Close modal
      onClose();
    } catch (err) {
      console.error("[CreateOffer] Failed to create offer:", err);
      setError(err instanceof Error ? err.message : "Failed to create offer");
    } finally {
      setIsCreating(false);
    }
  };

  // Render step content
  const renderStepContent = () => {
    switch (step) {
      case "utxos":
        return renderUtxoSelection();
      case "destination":
        return renderDestination();
      case "amount":
        return renderAmount();
      case "fee":
        return renderFeeSelection();
      case "review":
        return renderReview();
    }
  };

  // Step 1: UTXO Selection
  const renderUtxoSelection = () => {
    const slots = Array.from({ length: 28 }, (_, i) => {
      const utxo = utxos[i];
      const utxoId = utxo ? `${utxo.txid}:${utxo.vout}` : "";
      const isSelected = utxo ? selectedUtxos.has(utxoId) : false;

      return (
        <InventorySlot
          key={i}
          selected={isSelected}
          onClick={utxo ? () => toggleUtxo(utxo) : undefined}
        >
          {utxo && (
            <Tooltip
              content={`${utxo.value.toLocaleString()} sats${utxo.confirmed ? " (confirmed)" : " (unconfirmed)"}`}
            >
              <ItemStack icon="" quantity={utxo.value} isUTXO={true} />
            </Tooltip>
          )}
        </InventorySlot>
      );
    });

    return (
      <>
        <div style={{ marginBottom: "16px" }}>
          <p style={{ color: "var(--osrs-text-white)", fontSize: "14px" }}>
            Select the UTXOs (coins) you want to spend:
          </p>
        </div>
        <InventoryGrid title="Select UTXOs" itemCount={utxos.length}>
          {slots}
        </InventoryGrid>
        <div
          style={{
            marginTop: "16px",
            padding: "12px",
            backgroundColor: "var(--osrs-brown-dark)",
            borderRadius: "4px",
          }}
        >
          <div
            style={{ color: "var(--osrs-text-yellow)", marginBottom: "8px" }}
          >
            Selected: {selectedUtxos.size} UTXO
            {selectedUtxos.size !== 1 ? "s" : ""}
          </div>
          <GoldAmount sats={selectedTotal} showBtc size="normal" />
        </div>
      </>
    );
  };

  // Step 2: Destination
  const renderDestination = () => (
    <>
      <div style={{ marginBottom: "16px" }}>
        <p
          style={{
            color: "var(--osrs-text-white)",
            fontSize: "14px",
            marginBottom: "8px",
          }}
        >
          Enter the destination Bitcoin address:
        </p>
      </div>
      <AddressInput
        value={destination}
        onChange={setDestination}
        network={network}
        label="Destination Address"
        placeholder="bc1q..."
      />
      {destination && !isValidAddress(destination) && (
        <div
          style={{
            marginTop: "8px",
            color: "var(--osrs-text-red)",
            fontSize: "12px",
          }}
        >
          ⚠️ Invalid address for {network}
        </div>
      )}
    </>
  );

  // Step 3: Amount
  const renderAmount = () => {
    const amountSats = BigInt(amount || "0");
    const selectedBigInt = BigInt(selectedTotal);

    return (
      <>
        <div style={{ marginBottom: "16px" }}>
          <p style={{ color: "var(--osrs-text-white)", fontSize: "14px" }}>
            How much do you want to send?
          </p>
        </div>

        <div style={{ marginBottom: "8px" }}>
          <div
            style={{
              color: "var(--osrs-text-yellow)",
              fontSize: "12px",
              marginBottom: "4px",
            }}
          >
            Available
          </div>
          <GoldAmount sats={selectedTotal} showBtc size="normal" />
        </div>

        <NumberInput
          value={amount}
          onChange={setAmount}
          label="Amount (satoshis)"
          placeholder="0"
          min={0}
          max={selectedTotal}
        />

        <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
          <Button
            variant="secondary"
            onClick={() => setAmount(Math.floor(selectedTotal / 2).toString())}
          >
            50%
          </Button>
          <Button
            variant="secondary"
            onClick={() => setAmount(selectedTotal.toString())}
          >
            MAX
          </Button>
        </div>

        {amountSats > selectedBigInt && (
          <div
            style={{
              marginTop: "8px",
              color: "var(--osrs-text-red)",
              fontSize: "12px",
            }}
          >
            ⚠️ Amount exceeds available balance
          </div>
        )}
      </>
    );
  };

  // Step 4: Fee Selection
  const renderFeeSelection = () => (
    <>
      <div style={{ marginBottom: "16px" }}>
        <p style={{ color: "var(--osrs-text-white)", fontSize: "14px" }}>
          Select transaction speed (fee rate):
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {feeRates.map((preset) => (
          <div
            key={preset.label}
            onClick={() => setSelectedFeeRate(preset.rate)}
            style={{
              padding: "12px",
              backgroundColor:
                selectedFeeRate === preset.rate
                  ? "var(--osrs-brown-medium)"
                  : "var(--osrs-brown-dark)",
              border:
                selectedFeeRate === preset.rate
                  ? "2px solid var(--osrs-text-yellow)"
                  : "2px solid var(--inv-slot-border)",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    color: "var(--osrs-text-yellow)",
                    fontSize: "14px",
                    fontWeight: "bold",
                  }}
                >
                  {preset.label}
                </div>
                <div
                  style={{ color: "var(--osrs-text-gray)", fontSize: "12px" }}
                >
                  {preset.eta}
                </div>
              </div>
              <div
                style={{
                  color: "var(--osrs-text-white)",
                  fontSize: "14px",
                }}
              >
                {preset.rate} sat/vB
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );

  // Step 5: Review
  const renderReview = () => {
    const amountSats = BigInt(amount);
    const { fee, change } = calculateFeeAndChange(
      selectedUtxoObjects,
      amountSats,
      selectedFeeRate,
      wallet!.config,
    );

    return (
      <>
        <div style={{ marginBottom: "16px" }}>
          <h4
            style={{
              color: "var(--osrs-text-yellow)",
              fontSize: "16px",
              marginBottom: "12px",
            }}
          >
            Review Transaction
          </h4>
        </div>

        <div
          style={{
            padding: "12px",
            backgroundColor: "var(--osrs-brown-dark)",
            borderRadius: "4px",
            marginBottom: "12px",
          }}
        >
          <div style={{ marginBottom: "8px" }}>
            <div style={{ color: "var(--osrs-text-gray)", fontSize: "12px" }}>
              Sending
            </div>
            <GoldAmount sats={Number(amountSats)} showBtc size="normal" />
          </div>

          <div style={{ marginBottom: "8px" }}>
            <div style={{ color: "var(--osrs-text-gray)", fontSize: "12px" }}>
              To
            </div>
            <div
              style={{
                color: "var(--osrs-text-white)",
                fontSize: "11px",
                fontFamily: "monospace",
                wordBreak: "break-all",
              }}
            >
              {destination}
            </div>
          </div>

          <div style={{ marginBottom: "8px" }}>
            <div style={{ color: "var(--osrs-text-gray)", fontSize: "12px" }}>
              Fee
            </div>
            <div style={{ color: "var(--osrs-text-white)", fontSize: "14px" }}>
              {Number(fee).toLocaleString()} sats ({selectedFeeRate} sat/vB)
            </div>
          </div>

          {change > 0n && (
            <div style={{ marginBottom: "8px" }}>
              <div style={{ color: "var(--osrs-text-gray)", fontSize: "12px" }}>
                Change
              </div>
              <div
                style={{ color: "var(--osrs-text-white)", fontSize: "14px" }}
              >
                {Number(change).toLocaleString()} sats
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: "12px",
              paddingTop: "12px",
              borderTop: "1px solid var(--inv-slot-border)",
            }}
          >
            <div style={{ color: "var(--osrs-text-gray)", fontSize: "12px" }}>
              Total Input
            </div>
            <GoldAmount sats={selectedTotal} showBtc size="normal" />
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: "12px",
              backgroundColor: "var(--osrs-brown-dark)",
              border: "2px solid var(--osrs-text-red)",
              borderRadius: "4px",
              marginBottom: "12px",
            }}
          >
            <div style={{ color: "var(--osrs-text-red)", fontSize: "12px" }}>
              ❌ {error}
            </div>
          </div>
        )}
      </>
    );
  };

  // Render modal
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create Offer">
      <div style={{ minHeight: "400px" }}>
        {/* Step Indicator */}
        <div
          style={{
            marginBottom: "16px",
            padding: "8px",
            backgroundColor: "var(--osrs-brown-medium)",
            borderRadius: "4px",
            textAlign: "center",
          }}
        >
          <div style={{ color: "var(--osrs-text-yellow)", fontSize: "14px" }}>
            Step{" "}
            {["utxos", "destination", "amount", "fee", "review"].indexOf(step) +
              1}{" "}
            of 5
          </div>
          <div style={{ color: "var(--osrs-text-white)", fontSize: "12px" }}>
            {step === "utxos" && "Select UTXOs"}
            {step === "destination" && "Destination Address"}
            {step === "amount" && "Send Amount"}
            {step === "fee" && "Fee Selection"}
            {step === "review" && "Review & Confirm"}
          </div>
        </div>

        {/* Step Content */}
        <div>{renderStepContent()}</div>

        {/* Navigation Buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "24px",
          }}
        >
          <Button
            variant="secondary"
            onClick={prevStep}
            disabled={step === "utxos"}
          >
            Back
          </Button>

          {step !== "review" ? (
            <Button
              variant="primary"
              onClick={nextStep}
              disabled={!canProceed()}
            >
              Next
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleCreateOffer}
              disabled={isCreating}
            >
              {isCreating ? "Creating..." : "Create Offer"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
