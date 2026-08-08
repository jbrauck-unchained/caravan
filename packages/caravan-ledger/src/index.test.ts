const RUNTIME_EXPORTS = [
  "BitcoinInstallerError",
  "createBitcoinAppInstaller",
  "getBitcoinInstallerSupport",
] as const;

export {};

describe("@caravan/ledger package entry", () => {
  it("exports only the reviewed runtime surface without a browser", async () => {
    const packageEntry = await import("./index");

    expect(Object.keys(packageEntry).sort()).toEqual([...RUNTIME_EXPORTS]);
    expect(packageEntry.getBitcoinInstallerSupport()).toEqual({
      supported: false,
      reason: "not-browser",
    });
    const installer = packageEntry.createBitcoinAppInstaller();
    await expect(installer.prepare()).rejects.toMatchObject({
      code: "unsupported-environment",
      phase: "idle",
    });
    await installer.dispose();
  });
});
