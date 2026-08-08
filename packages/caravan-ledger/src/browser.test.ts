const RUNTIME_EXPORTS = [
  "BitcoinInstallerError",
  "createBitcoinAppInstaller",
  "getBitcoinInstallerSupport",
] as const;

export {};

describe("@caravan/ledger browser entry", () => {
  it("exports the same reviewed runtime surface without eager runtime work", async () => {
    const browserEntry = await import("./browser");

    expect(Object.keys(browserEntry).sort()).toEqual([...RUNTIME_EXPORTS]);
    expect(browserEntry.getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "not-browser",
    });
    expect(browserEntry.createBitcoinAppInstaller()).toBeDefined();
  });
});
