import type {
  BitcoinInstallerEvent,
  BitcoinInstallerInteraction,
  BitcoinInstallerPhase,
} from "./events";

describe("public event vocabulary", () => {
  it("is finite and exhaustive", () => {
    const phases: Record<BitcoinInstallerPhase, true> = {
      idle: true,
      "selecting-device": true,
      connecting: true,
      "checking-genuine": true,
      "checking-bitcoin-app": true,
      "ready-to-install": true,
      installing: true,
      verifying: true,
      "opening-bitcoin": true,
      "releasing-device": true,
      "ready-for-webusb": true,
      "needs-recovery": true,
      cancelled: true,
      failed: true,
      disposed: true,
    };
    const interactions: Record<BitcoinInstallerInteraction, true> = {
      "select-device": true,
      "unlock-device": true,
      "allow-secure-connection": true,
      "confirm-install": true,
      "confirm-open-bitcoin": true,
    };
    const event: BitcoinInstallerEvent = {
      phase: "installing",
      interaction: "confirm-install",
      progress: 50,
    };

    expect(Object.keys(phases)).toHaveLength(15);
    expect(Object.keys(interactions)).toHaveLength(5);
    expect(event).toEqual({
      phase: "installing",
      interaction: "confirm-install",
      progress: 50,
    });
  });
});
