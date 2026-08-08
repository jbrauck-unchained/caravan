import type {
  BitcoinAppInstaller,
  BitcoinInstallPlan,
  BitcoinInstallResult,
} from "./types";

describe("public installer types", () => {
  it("keeps plans nominal while exposing only their status", () => {
    // @ts-expect-error A structural clone is not a valid branded plan.
    const forged: BitcoinInstallPlan = { status: "installation-required" };
    const visibleShape = { status: forged.status };

    expect(visibleShape).toEqual({ status: "installation-required" });
  });

  it("matches the reviewed result and instance methods", () => {
    const result: BitcoinInstallResult = {
      status: "already-installed",
      appOpen: false,
      handoff: "reconnect-required",
    };
    const installerMethods: ReadonlyArray<keyof BitcoinAppInstaller> = [
      "subscribe",
      "prepare",
      "install",
      "recover",
      "cancel",
      "dispose",
    ];

    expect(result).toEqual({
      status: "already-installed",
      appOpen: false,
      handoff: "reconnect-required",
    });
    expect(installerMethods).toHaveLength(6);
  });
});
