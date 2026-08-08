import type { BitcoinInstallerErrorCode } from "./errors";
import { BitcoinInstallerError } from "./errors";

describe("BitcoinInstallerError", () => {
  it("covers the finite reviewed code vocabulary, including cancellation", () => {
    const codes: Record<BitcoinInstallerErrorCode, true> = {
      "unsupported-environment": true,
      "permission-denied": true,
      "no-device-selected": true,
      "device-busy": true,
      "device-disconnected": true,
      "device-locked": true,
      "device-not-onboarded": true,
      "device-not-genuine": true,
      "unsupported-device": true,
      "unsupported-firmware": true,
      "user-refused": true,
      "bitcoin-app-unsupported": true,
      "insufficient-space": true,
      "network-unavailable": true,
      "ledger-service-unavailable": true,
      "secure-channel-failed": true,
      "operation-timeout": true,
      cancelled: true,
      "state-unknown": true,
      internal: true,
    };

    expect(Object.keys(codes)).toHaveLength(20);
  });

  it("derives a stable message and never accepts a vendor cause", () => {
    const error = new BitcoinInstallerError(
      "secure-channel-failed",
      "checking-genuine",
      true,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BitcoinInstallerError");
    expect(error.message).toBe("The secure connection could not be completed.");
    expect(error.code).toBe("secure-channel-failed");
    expect(error.phase).toBe("checking-genuine");
    expect(error.recoverable).toBe(true);
    expect(Object.keys(error).sort()).toEqual([
      "code",
      "name",
      "phase",
      "recoverable",
    ]);
    expect("cause" in error).toBe(false);
  });

  it("serializes only finite, redacted fields", () => {
    const sensitiveCanary =
      "apdu=e0510000&session=private-session&device=private-device";
    const error = new BitcoinInstallerError(
      "internal",
      "checking-bitcoin-app",
      false,
    );
    const serialized = JSON.stringify(error);

    expect(JSON.parse(serialized)).toEqual({
      name: "BitcoinInstallerError",
      code: "internal",
      phase: "checking-bitcoin-app",
      recoverable: false,
    });
    expect(serialized).not.toContain(sensitiveCanary);
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("cause");
  });

  it("ignores extra runtime arguments instead of retaining vendor details", () => {
    const sensitiveCanary = "vendor-session-private-value";
    const VendorCallable = BitcoinInstallerError as unknown as new (
      code: BitcoinInstallerErrorCode,
      phase: "connecting",
      recoverable: boolean,
      vendorError: Error,
    ) => BitcoinInstallerError;
    const error = new VendorCallable(
      "internal",
      "connecting",
      false,
      new Error(sensitiveCanary),
    );

    expect(error.message).toBe("The operation could not be completed.");
    expect(JSON.stringify(error)).not.toContain(sensitiveCanary);
    expect("cause" in error).toBe(false);
  });
});
