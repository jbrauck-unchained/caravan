import type { BitcoinInstallerErrorCode } from "../errors";

import { mapPreMutationError } from "./errorMap";

describe("mapPreMutationError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<[tag: string, code: BitcoinInstallerErrorCode, recoverable: boolean]>(
    [
      ["WebHidTransportNotSupportedError", "unsupported-environment", false],
      ["TransportNotSupportedError", "unsupported-environment", false],
      ["NoTransportsProvidedError", "unsupported-environment", false],
      ["NoTransportProvidedError", "unsupported-environment", false],
      ["NoAccessibleDeviceError", "no-device-selected", true],
      ["DeviceAlreadyDiscoveredError", "device-busy", true],
      ["ConnectionOpeningError", "device-busy", true],
      ["DeviceBusyError", "device-busy", true],
      ["SendApduConcurrencyError", "device-busy", true],
      ["AlreadySendingApduError", "device-busy", true],
      ["DeviceDisconnectedWhileSendingError", "device-disconnected", true],
      ["DeviceDisconnectedBeforeSendingApdu", "device-disconnected", true],
      ["DisconnectError", "device-disconnected", true],
      ["ReconnectionFailedError", "device-disconnected", true],
      ["DeviceSessionNotFound", "device-disconnected", true],
      ["DeviceLockedError", "device-locked", true],
      ["DeviceNotOnboardedError", "device-not-onboarded", false],
      ["DeviceNotRecognizedError", "unsupported-device", false],
      ["UnsupportedFirmwareDAError", "unsupported-firmware", false],
      ["ActionRefusedError", "user-refused", true],
      ["RefusedByUserDAError", "user-refused", true],
      ["NetworkDAError", "network-unavailable", true],
      ["FetchError", "network-unavailable", true],
      ["WebSocketConnectionError", "ledger-service-unavailable", true],
      ["SecureChannelError", "secure-channel-failed", true],
      ["SendApduTimeoutError", "operation-timeout", true],
      ["SendCommandTimeoutError", "operation-timeout", true],
    ],
  )("maps reviewed tag %s", (tag, code, recoverable) => {
    const error = mapPreMutationError({ _tag: tag }, "checking-genuine");

    expect(error).toMatchObject({
      name: "BitcoinInstallerError",
      code,
      phase: "checking-genuine",
      recoverable,
    });
  });

  it("uses tags instead of vendor constructor identity", () => {
    class ForeignRealmLockedError {
      readonly _tag = "DeviceLockedError";
    }

    expect(
      mapPreMutationError(
        new ForeignRealmLockedError(),
        "checking-bitcoin-app",
      ),
    ).toMatchObject({
      code: "device-locked",
      phase: "checking-bitcoin-app",
      recoverable: true,
    });
  });

  it.each([
    "AppAlreadyInstalledDAError",
    "OutOfMemoryDAError",
    "UnsupportedApplicationDAError",
    "UnknownDAError",
  ])("does not flatten install-stage tag %s", (tag) => {
    expect(
      mapPreMutationError({ _tag: tag }, "checking-bitcoin-app"),
    ).toMatchObject({ code: "internal", recoverable: false });
  });

  it("maps unknown and malformed values to a generic internal error", () => {
    const values: unknown[] = [
      null,
      "DeviceLockedError",
      { _tag: "UnreviewedVendorFailure" },
      { _tag: { message: "DeviceLockedError" } },
      Object.create({ _tag: "DeviceLockedError" }),
    ];

    for (const value of values) {
      const error = mapPreMutationError(value, "connecting");
      expect(error).toMatchObject({
        code: "internal",
        phase: "connecting",
        recoverable: false,
      });
      expect(error.message).toBe("The operation could not be completed.");
    }
  });

  it("discards identifiers, APDUs, inventories, URLs, bodies, and stacks", () => {
    const canaries = [
      "device-id-private-7c9d",
      "session-id-private-3a51",
      "apdu-e051000000",
      "Private Installed App",
      "app-hash-deadbeef",
      "wss://ledger.invalid/socket?token=private-token",
      "private-response-body",
      "vendor-stack-private-marker",
    ];
    const vendorError = new Error(canaries[6]);
    vendorError.stack = canaries[7];
    const rawError = {
      _tag: "SecureChannelError",
      deviceId: canaries[0],
      sessionId: canaries[1],
      apdu: canaries[2],
      installedApps: [{ name: canaries[3], hash: canaries[4] }],
      url: canaries[5],
      responseBody: canaries[6],
      originalError: vendorError,
      cause: vendorError,
      message: canaries.join("|"),
      stack: canaries[7],
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(vi.fn());
    const consoleLog = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(vi.fn());

    const error = mapPreMutationError(rawError, "checking-genuine");
    const exposed = [
      error.name,
      error.message,
      error.code,
      error.phase,
      String(error.recoverable),
      error.stack ?? "",
      JSON.stringify(error),
    ].join("|");

    expect(Object.keys(error).sort()).toEqual([
      "code",
      "name",
      "phase",
      "recoverable",
    ]);
    expect("cause" in error).toBe(false);
    expect("originalError" in error).toBe(false);
    for (const canary of canaries) expect(exposed).not.toContain(canary);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });
});
