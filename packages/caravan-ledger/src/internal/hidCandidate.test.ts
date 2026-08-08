import {
  hidSnapshotMatchesModel,
  isKnownCandidateIdentity,
  LEDGER_HID_VENDOR_ID,
  selectHidReleaseCandidate,
} from "./hidCandidate";
import type {
  HidDeviceIdentity,
  HidDeviceSnapshot,
} from "./hidPort";

function identity(): HidDeviceIdentity {
  return Object.freeze({}) as HidDeviceIdentity;
}

function snapshot(
  deviceIdentity: HidDeviceIdentity,
  opened: boolean,
  productId = 0x4000,
  vendorId = LEDGER_HID_VENDOR_ID,
): HidDeviceSnapshot {
  return Object.freeze({
    identity: deviceIdentity,
    vendorId,
    productId,
    opened,
  });
}

describe("HID release candidate selection", () => {
  it("selects the sole same-identity closed-to-open transition", () => {
    const selected = identity();
    const sameModelPeer = identity();
    const otherModel = identity();
    const candidate = selectHidReleaseCandidate({
      before: [
        snapshot(selected, false),
        snapshot(sameModelPeer, false),
        snapshot(otherModel, true, 0x6000),
      ],
      after: [
        snapshot(selected, true),
        snapshot(sameModelPeer, false),
        snapshot(otherModel, true, 0x6000),
      ],
      modelId: "nanoX",
    });

    expect(candidate).toMatchObject({
      kind: "unique",
      identity: selected,
      modelId: "nanoX",
      productId: 0x4000,
    });
    if (candidate.kind === "unique") {
      expect(candidate.knownPeerIdentities).toEqual([sameModelPeer]);
      expect(candidate.knownOpenPeerIdentities).toEqual([]);
      expect(isKnownCandidateIdentity(candidate, selected)).toBe(true);
      expect(isKnownCandidateIdentity(candidate, sameModelPeer)).toBe(true);
      expect(isKnownCandidateIdentity(candidate, otherModel)).toBe(false);
    }
  });

  it("does not let same-model collisions break ties by product data", () => {
    const first = identity();
    const second = identity();

    expect(
      selectHidReleaseCandidate({
        before: [snapshot(first, false), snapshot(second, false)],
        after: [snapshot(first, true), snapshot(second, true)],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "ambiguous" });

    expect(
      selectHidReleaseCandidate({
        before: [snapshot(first, true), snapshot(second, true)],
        after: [snapshot(first, true), snapshot(second, true)],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "ambiguous" });
  });

  it("accepts a unique transition beside a stable peer but not a new opened peer", () => {
    const selected = identity();
    const stablePeer = identity();
    const newPeer = identity();

    const stablePeerCandidate = selectHidReleaseCandidate({
        before: [snapshot(selected, false), snapshot(stablePeer, true)],
        after: [snapshot(selected, true), snapshot(stablePeer, true)],
        modelId: "nanoX",
      });
    expect(stablePeerCandidate).toMatchObject({
      kind: "unique",
      identity: selected,
    });
    if (stablePeerCandidate.kind === "unique") {
      expect(stablePeerCandidate.knownOpenPeerIdentities).toEqual([
        stablePeer,
      ]);
    }

    expect(
      selectHidReleaseCandidate({
        before: [snapshot(selected, false)],
        after: [snapshot(selected, true), snapshot(newPeer, true)],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "ambiguous" });
  });

  it("accepts one pre-opened matching handle but rejects identity replacement", () => {
    const original = identity();
    const replacement = identity();

    expect(
      selectHidReleaseCandidate({
        before: [snapshot(original, true)],
        after: [snapshot(original, true)],
        modelId: "nanoX",
      }),
    ).toMatchObject({ kind: "unique", identity: original });

    expect(
      selectHidReleaseCandidate({
        before: [snapshot(original, false)],
        after: [snapshot(replacement, true)],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "ambiguous" });
  });

  it("uses a unique opened post-snapshot when the pre-snapshot was unavailable", () => {
    const selected = identity();
    expect(
      selectHidReleaseCandidate({
        before: undefined,
        after: [snapshot(selected, true)],
        modelId: "nanoX",
      }),
    ).toMatchObject({ kind: "unique", identity: selected });
  });

  it("returns explicit none, unavailable, and malformed markers", () => {
    const selected = identity();
    expect(
      selectHidReleaseCandidate({
        before: [],
        after: [snapshot(selected, false)],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "none" });
    expect(
      selectHidReleaseCandidate({
        before: [],
        after: undefined,
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      selectHidReleaseCandidate({
        before: [],
        after: [snapshot(selected, true)],
        modelId: "future-device",
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      selectHidReleaseCandidate({
        before: [],
        after: [snapshot(selected, true), snapshot(selected, true)],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "unavailable" });

    const hostile = new Proxy(snapshot(selected, true), {
      get() {
        throw new Error("hostile snapshot");
      },
    });
    expect(
      selectHidReleaseCandidate({
        before: [],
        after: [hostile],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("filters non-Ledger and different-model handles before ownership", () => {
    const selected = identity();
    const nonLedger = identity();
    const stax = identity();
    expect(
      selectHidReleaseCandidate({
        before: [snapshot(selected, false)],
        after: [
          snapshot(selected, true),
          snapshot(nonLedger, true, 0x4000, 0x1234),
          snapshot(stax, true, 0x6000),
        ],
        modelId: "nanoX",
      }),
    ).toMatchObject({ kind: "unique", identity: selected });
  });

  it("fails closed when one identity changes vendor or Ledger model", () => {
    const vendorMutation = identity();
    expect(
      selectHidReleaseCandidate({
        before: [snapshot(vendorMutation, false, 0x4000, 0x1234)],
        after: [snapshot(vendorMutation, true, 0x4000)],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "unavailable" });

    const modelMutation = identity();
    expect(
      selectHidReleaseCandidate({
        before: [snapshot(modelMutation, false, 0x6000)],
        after: [snapshot(modelMutation, true, 0x4000)],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it.each([
    [0x4000, 0x4001],
    [0x0004, 0x4000],
  ])(
    "fails closed when one identity changes product from %# to %# within a model",
    (beforeProductId, afterProductId) => {
      const selected = identity();
      expect(
        selectHidReleaseCandidate({
          before: [snapshot(selected, false, beforeProductId)],
          after: [snapshot(selected, true, afterProductId)],
          modelId: "nanoX",
        }),
      ).toEqual({ kind: "unavailable" });
    },
  );

  it.each([
    ["nanoS", 0x1000, 0x0001],
    ["nanoSP", 0x5000, 0x0005],
    ["nanoX", 0x4000, 0x0004],
    ["stax", 0x6000, 0x0006],
    ["flex", 0x7000, 0x0007],
    ["apexp", 0x8000, 0x0008],
  ] as const)(
    "matches pinned %s application prefixes and bootloader IDs",
    (modelId, applicationProductId, bootloaderProductId) => {
      const selected = identity();
      expect(
        hidSnapshotMatchesModel(
          snapshot(selected, true, applicationProductId),
          modelId,
        ),
      ).toBe(true);
      expect(
        hidSnapshotMatchesModel(
          snapshot(selected, true, bootloaderProductId),
          modelId,
        ),
      ).toBe(true);
    },
  );

  it("accepts callable opaque identities and rejects malformed containers", () => {
    const callableIdentity = (() => undefined) as unknown as HidDeviceIdentity;
    expect(
      selectHidReleaseCandidate({
        before: undefined,
        after: [snapshot(callableIdentity, true)],
        modelId: "nanoX",
      }),
    ).toMatchObject({ kind: "unique", identity: callableIdentity });

    expect(
      selectHidReleaseCandidate({
        before: [],
        after: {} as readonly HidDeviceSnapshot[],
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "unavailable" });

    const sparse = new Array(1) as readonly HidDeviceSnapshot[];
    expect(
      selectHidReleaseCandidate({
        before: [],
        after: sparse,
        modelId: "nanoX",
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("rejects primitive records and invalid own snapshot fields", () => {
    for (const malformed of [
      null,
      {
        identity: null,
        vendorId: LEDGER_HID_VENDOR_ID,
        productId: 0x4000,
        opened: true,
      },
    ]) {
      expect(
        selectHidReleaseCandidate({
          before: [],
          after: [malformed] as never,
          modelId: "nanoX",
        }),
      ).toEqual({ kind: "unavailable" });
    }
  });

  it("does not match a non-Ledger vendor even when its product ID matches", () => {
    expect(
      hidSnapshotMatchesModel(
        snapshot(identity(), true, 0x4000, 0x1234),
        "nanoX",
      ),
    ).toBe(false);
  });
});
