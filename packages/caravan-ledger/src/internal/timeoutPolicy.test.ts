import type { BitcoinInstallerErrorCode } from "../errors";

import {
  classifyInstallActionEvidence,
  classifyInstallFailure,
  INSTALL_FAILURE_BOUNDARY_TABLE,
  INSTALL_FAILURE_STAGES,
  PROVISIONAL_OPERATION_WATCHDOG_POLICY,
  type InstallFailureDecision,
  type InstallFailureStage,
  readInstallFailureDiagnostic,
} from "./timeoutPolicy";

function vendorFailure(
  stage: InstallFailureStage,
  mutationAttempted: boolean,
  tag: string,
): InstallFailureDecision {
  return classifyInstallFailure({
    stage,
    mutationAttempted,
    trigger: { kind: "vendor-error", error: { _tag: tag } },
  });
}

function expectRejection(
  decision: InstallFailureDecision,
  terminalPhase: "cancelled" | "failed" | "needs-recovery",
  code: BitcoinInstallerErrorCode,
): void {
  expect(decision).toMatchObject({
    kind: "reject",
    terminalPhase,
    error: { code },
  });
}

describe("install timeout and failure policy", () => {
  it("centralizes finite provisional watchdogs for every non-release stage", () => {
    expect(Object.keys(PROVISIONAL_OPERATION_WATCHDOG_POLICY)).toEqual(
      INSTALL_FAILURE_STAGES.filter((stage) => stage !== "release"),
    );
    expect(Object.isFrozen(PROVISIONAL_OPERATION_WATCHDOG_POLICY)).toBe(true);
    for (const timeoutMs of Object.values(
      PROVISIONAL_OPERATION_WATCHDOG_POLICY,
    )) {
      expect(Number.isSafeInteger(timeoutMs)).toBe(true);
      expect(timeoutMs).toBeGreaterThan(0);
    }
    for (const stage of [
      "genuine",
      "inspect",
      "install-dispatched",
      "verify",
      "open",
    ] as const) {
      expect(PROVISIONAL_OPERATION_WATCHDOG_POLICY[stage]).toBeGreaterThan(
        60_000,
      );
    }
  });

  it("defines every stage x mutation-marker cell explicitly and immutably", () => {
    expect(Object.keys(INSTALL_FAILURE_BOUNDARY_TABLE)).toEqual(
      INSTALL_FAILURE_STAGES,
    );
    expect(Object.isFrozen(INSTALL_FAILURE_BOUNDARY_TABLE)).toBe(true);

    for (const stage of INSTALL_FAILURE_STAGES) {
      expect(Object.keys(INSTALL_FAILURE_BOUNDARY_TABLE[stage]).sort()).toEqual(
        ["attempted", "not-attempted"],
      );
      expect(Object.isFrozen(INSTALL_FAILURE_BOUNDARY_TABLE[stage])).toBe(true);
    }
  });

  it.each<[tag: string, code: BitcoinInstallerErrorCode, recoverable: boolean]>(
    [
      ["DeviceLockedError", "device-locked", true],
      ["DeviceNotOnboardedError", "device-not-onboarded", false],
      ["RefusedByUserDAError", "user-refused", true],
      ["UnsupportedFirmwareDAError", "unsupported-firmware", false],
      ["NetworkDAError", "network-unavailable", true],
      ["FetchError", "network-unavailable", true],
      ["WebSocketConnectionError", "ledger-service-unavailable", true],
      ["SecureChannelError", "secure-channel-failed", true],
      ["DeviceDisconnectedWhileSendingError", "device-disconnected", true],
      ["SendApduTimeoutError", "operation-timeout", true],
      ["UnknownDAError", "internal", false],
    ],
  )(
    "maps reviewed pre-native vendor tag %s to %s without a raw cause",
    (tag, code, recoverable) => {
      const decision = vendorFailure("inspect", false, tag);

      expectRejection(decision, "failed", code);
      if (decision.kind !== "reject") throw new Error("Expected rejection");
      expect(decision.error.recoverable).toBe(recoverable);
      expect("cause" in decision.error).toBe(false);
    },
  );

  it.each([
    "DeviceLockedError",
    "RefusedByUserDAError",
    "NetworkDAError",
    "WebSocketConnectionError",
    "SendApduTimeoutError",
    "UnknownDAError",
    "UnreviewedPrivateVendorFailure",
  ])("lets mutation ambiguity override post-marker vendor tag %s", (tag) => {
    expectRejection(
      vendorFailure("install-dispatched", true, tag),
      "needs-recovery",
      "state-unknown",
    );
  });

  it.each([
    "DeviceLockedError",
    "RefusedByUserDAError",
    "NetworkDAError",
    "WebSocketConnectionError",
    "SendApduTimeoutError",
    "UnknownDAError",
    "UnreviewedPrivateVendorFailure",
  ])(
    "treats native-started marker-false vendor tag %s as state unknown",
    (tag) => {
      expectRejection(
        vendorFailure("install-dispatched", false, tag),
        "needs-recovery",
        "state-unknown",
      );
    },
  );

  it("requires fresh inspection for AppAlreadyInstalled before or after the marker", () => {
    for (const mutationAttempted of [false, true]) {
      const decision = vendorFailure(
        "install-dispatched",
        mutationAttempted,
        "AppAlreadyInstalledDAError",
      );
      expect(decision).toEqual({ kind: "fresh-inspection-required" });
      expect(readInstallFailureDiagnostic(decision)).toMatchObject({
        stage: "install-dispatched",
        mutationAttempted,
        reviewedVendorTag: "AppAlreadyInstalledDAError",
      });
    }
  });

  it("retains out-of-memory only as recovery guidance, never final-state proof", () => {
    for (const mutationAttempted of [false, true]) {
      const decision = vendorFailure(
        "install-dispatched",
        mutationAttempted,
        "OutOfMemoryDAError",
      );
      expectRejection(decision, "needs-recovery", "insufficient-space");
      expect(decision).toMatchObject({
        recoveryGuidance: "insufficient-space",
      });
      expect(decision).not.toHaveProperty("status");
      expect(decision).not.toHaveProperty("bitcoinPresent");
      expect(decision).not.toHaveProperty("deviceState");
    }
  });

  it("classifies cancellation and watchdog timeout across every table cell", () => {
    for (const stage of INSTALL_FAILURE_STAGES) {
      for (const mutationAttempted of [false, true]) {
        const boundary =
          INSTALL_FAILURE_BOUNDARY_TABLE[stage][
            mutationAttempted ? "attempted" : "not-attempted"
          ];
        const cancelled = classifyInstallFailure({
          stage,
          mutationAttempted,
          trigger: { kind: "cancelled" },
        });
        const timedOut = classifyInstallFailure({
          stage,
          mutationAttempted,
          trigger: { kind: "timeout" },
        });

        switch (boundary) {
          case "safe-pre-mutation":
            expectRejection(cancelled, "cancelled", "cancelled");
            expectRejection(timedOut, "failed", "operation-timeout");
            break;
          case "mutation-state-unknown":
          case "verification-unproven":
          case "native-install-started":
            expectRejection(cancelled, "needs-recovery", "state-unknown");
            expectRejection(timedOut, "needs-recovery", "state-unknown");
            break;
          case "open-non-authoritative":
            expect(cancelled).toEqual({
              kind: "continue-to-release",
              appOpen: false,
            });
            expect(timedOut).toEqual({
              kind: "continue-to-release",
              appOpen: false,
            });
            break;
          case "release-unproven":
            expect(cancelled).toEqual({
              kind: "handoff-reconnect-required",
            });
            expect(timedOut).toEqual({
              kind: "handoff-reconnect-required",
            });
            break;
        }
      }
    }
  });

  it("treats verification failure as unknown even when no mutation marker exists", () => {
    expectRejection(
      vendorFailure("verify", false, "FetchError"),
      "needs-recovery",
      "state-unknown",
    );
  });

  it("keeps cancellation conservative when the native actor can mark mutation later", () => {
    let mutationAttempted = false;
    const decision = classifyInstallFailure({
      stage: "install-dispatched",
      mutationAttempted,
      trigger: { kind: "cancelled" },
    });

    // Cooperative actor cancellation cannot prove a still-running dependency
    // will not cross the synchronous marker after this classification.
    mutationAttempted = true;
    expect(mutationAttempted).toBe(true);
    expectRejection(decision, "needs-recovery", "state-unknown");
  });

  it("does not let an install-only tag escape its reviewed stage", () => {
    expectRejection(
      vendorFailure("genuine", false, "OutOfMemoryDAError"),
      "failed",
      "internal",
    );
    expectRejection(
      vendorFailure("verify", true, "AppAlreadyInstalledDAError"),
      "needs-recovery",
      "state-unknown",
    );
  });

  it("does not invent fixed-action unsupported-app evidence from a planted tag", () => {
    expectRejection(
      vendorFailure("inspect", false, "UnsupportedApplicationDAError"),
      "failed",
      "internal",
    );
    expectRejection(
      vendorFailure(
        "install-dispatched",
        false,
        "UnsupportedApplicationDAError",
      ),
      "needs-recovery",
      "state-unknown",
    );
  });

  it("progress 100 remains pending evidence and completion still requires inspection", () => {
    for (const progress of [-1, 0, 99, 100, 101, Number.NaN]) {
      expect(
        classifyInstallActionEvidence({ kind: "progress", progress }),
      ).toEqual({ kind: "await-terminal" });
    }
    expect(classifyInstallActionEvidence({ kind: "completed" })).toEqual({
      kind: "fresh-inspection-required",
    });
  });

  it("drops raw vendor messages, causes, URLs, identifiers, and arbitrary tags", () => {
    const canaries = [
      "private-device-id",
      "private-session-id",
      "private-apdu-e051",
      "wss://private.invalid/path?secret=yes",
      "Private Other App",
      "private-vendor-stack",
      "PrivateArbitraryTag",
    ];
    const raw = {
      _tag: canaries[6],
      message: canaries.join("|"),
      cause: new Error(canaries[0]),
      deviceId: canaries[0],
      sessionId: canaries[1],
      apdu: canaries[2],
      url: canaries[3],
      installedApps: [{ name: canaries[4] }],
      stack: canaries[5],
    };

    const decision = classifyInstallFailure({
      stage: "install-dispatched",
      mutationAttempted: false,
      trigger: { kind: "vendor-error", error: raw },
    });
    expectRejection(decision, "needs-recovery", "state-unknown");
    const diagnostic = readInstallFailureDiagnostic(decision);
    expect(diagnostic).toEqual({
      stage: "install-dispatched",
      mutationAttempted: false,
      boundary: "native-install-started",
      trigger: "vendor-error",
    });

    const exposed = [
      JSON.stringify(decision),
      decision.kind === "reject" ? decision.error.stack ?? "" : "",
      JSON.stringify(diagnostic),
    ].join("|");
    for (const canary of canaries) expect(exposed).not.toContain(canary);
  });

  it("ignores inherited tags, accessors, and hostile reflection", () => {
    const inherited = Object.create({ _tag: "DeviceLockedError" });
    const accessor = Object.defineProperty({}, "_tag", {
      get: () => {
        throw new Error("private-getter-canary");
      },
    });
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("private-proxy-canary");
        },
      },
    );

    for (const error of [inherited, accessor, hostile]) {
      expectRejection(
        classifyInstallFailure({
          stage: "install-dispatched",
          mutationAttempted: false,
          trigger: { kind: "vendor-error", error },
        }),
        "needs-recovery",
        "state-unknown",
      );
    }
  });
});
