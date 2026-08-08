import React, { useEffect, useMemo, useState } from "react";

import type { BitcoinAppInstaller } from "./installerContract";
import { describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen, waitFor } from "../../utils/test-utils";

import { LedgerBitcoinInstallerPocPage } from "./LedgerBitcoinInstallerPocPage";

vi.mock("./BitcoinAppInstallerFlow", () => ({
  BitcoinAppInstallerFlow: ({
    createInstaller,
  }: {
    createInstaller: () => BitcoinAppInstaller;
  }) => {
    const installer = useMemo(createInstaller, [createInstaller]);
    const [planStatus, setPlanStatus] = useState("Not started");

    useEffect(
      () => () => {
        void installer.dispose();
      },
      [installer],
    );

    return (
      <div data-testid="mock-ledger-installer-flow">
        <button
          type="button"
          onClick={() => {
            void installer.prepare().then((plan) => {
              setPlanStatus(plan.status);
            });
          }}
        >
          Begin simulated preparation
        </button>
        <output aria-label="Simulated plan status">{planStatus}</output>
      </div>
    );
  },
}));

describe("LedgerBitcoinInstallerPocPage", () => {
  it("labels the experience unmistakably as an inert simulation", () => {
    render(<LedgerBitcoinInstallerPocPage />);

    expect(
      screen.getByText("SIMULATION ONLY — NO LEDGER DEVICE IS USED"),
    ).toBeVisible();
    expect(
      screen.getByText(/cannot access hardware, contact Ledger services/i),
    ).toBeVisible();
    expect(screen.getByText(/cannot .* start Caravan signing/i)).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Try the Ledger Bitcoin app installer",
    );
  });

  it("offers every deterministic acceptance scenario", () => {
    render(<LedgerBitcoinInstallerPocPage />);

    fireEvent.mouseDown(screen.getByLabelText("Simulated scenario"));
    expect(
      screen.getByRole("option", { name: "Install Bitcoin successfully" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Bitcoin is already installed" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "User refuses on the device" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "State unknown, then recover" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", {
        name: "Reconnect required after installation",
      }),
    ).toBeVisible();
  });

  it("replaces and resets the flow when the selected scenario changes", async () => {
    render(<LedgerBitcoinInstallerPocPage />);

    fireEvent.click(
      screen.getByRole("button", { name: "Begin simulated preparation" }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Simulated plan status")).toHaveTextContent(
        "installation-required",
      );
    });

    fireEvent.mouseDown(screen.getByLabelText("Simulated scenario"));
    fireEvent.click(
      screen.getByRole("option", { name: "Bitcoin is already installed" }),
    );
    expect(screen.getByLabelText("Simulated plan status")).toHaveTextContent(
      "Not started",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Begin simulated preparation" }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Simulated plan status")).toHaveTextContent(
        "already-installed",
      );
    });
  });
});
