const RUNTIME_EXPORTS = [
  "BitcoinInstallerError",
  "getBitcoinInstallerSupport",
] as const;

describe("@caravan/ledger package entry", () => {
  it("exports only the reviewed runtime surface without a browser", async () => {
    const packageEntry = await import("./index");

    expect(Object.keys(packageEntry).sort()).toEqual([...RUNTIME_EXPORTS]);
    expect(packageEntry.getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "not-browser",
    });
  });
});
