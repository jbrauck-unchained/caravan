import React from "react";

import type { BitcoinAppInstaller } from "@caravan/ledger";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "../../utils/test-utils";
import { LedgerBitcoinInstallerLivePage } from "./LedgerBitcoinInstallerLivePage";

function fakeInstaller(): BitcoinAppInstaller {
  return {
    subscribe: () => () => undefined,
    prepare: vi.fn(() => Promise.reject(new Error("not exercised"))),
    install: vi.fn(() => Promise.reject(new Error("not exercised"))),
    recover: vi.fn(() => Promise.reject(new Error("not exercised"))),
    cancel: vi.fn(),
    dispose: vi.fn(() => Promise.resolve()),
  };
}

describe("LedgerBitcoinInstallerLivePage", () => {
  it("keeps the real device controls locked without explicit authorization", () => {
    const createInstaller = vi.fn(fakeInstaller);

    render(
      <LedgerBitcoinInstallerLivePage
        authorizationConfirmed={false}
        createInstaller={createInstaller}
        readSupport={() => ({ supported: true })}
      />,
    );

    expect(
      screen.getByText("REAL LEDGER PLUMBING — LIVE SERVICES LOCKED"),
    ).toBeVisible();
    expect(screen.getByText("What is already wired")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Check Ledger" }),
    ).not.toBeInTheDocument();
    expect(createInstaller).not.toHaveBeenCalled();
  });

  it("explains unsupported browser environments without constructing an installer", () => {
    const createInstaller = vi.fn(fakeInstaller);

    render(
      <LedgerBitcoinInstallerLivePage
        authorizationConfirmed
        createInstaller={createInstaller}
        readSupport={() => ({
          supported: false,
          reason: "webhid-unavailable",
        })}
      />,
    );

    expect(
      screen.getByText("This browser cannot start the Ledger flow"),
    ).toBeVisible();
    expect(
      screen.getByText(/desktop Chromium browser with WebHID/i),
    ).toBeVisible();
    expect(createInstaller).not.toHaveBeenCalled();
  });

  it("constructs the real flow only when authorization and browser support are present", () => {
    const createInstaller = vi.fn(fakeInstaller);

    render(
      <LedgerBitcoinInstallerLivePage
        authorizationConfirmed
        createInstaller={createInstaller}
        readSupport={() => ({ supported: true })}
      />,
    );

    expect(screen.getByText("AUTHORIZED HARDWARE TEST MODE")).toBeVisible();
    expect(screen.getByRole("button", { name: "Check Ledger" })).toBeVisible();
    expect(createInstaller).toHaveBeenCalledTimes(1);
  });
});
