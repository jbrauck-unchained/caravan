import {
  createPendingEventMapper,
  mapDmkInteraction,
  normalizeUnitProgress,
} from "./eventMap";

describe("eventMap", () => {
  it("maps only reviewed interactions for the closed action kind", () => {
    expect(mapDmkInteraction("genuine", "none")).toBeUndefined();
    expect(mapDmkInteraction("genuine", "unlock-device")).toBe("unlock-device");
    expect(mapDmkInteraction("list-bitcoin", "allow-secure-connection")).toBe(
      "allow-secure-connection",
    );
    expect(mapDmkInteraction("open-bitcoin", "confirm-open-app")).toBe(
      "confirm-open-bitcoin",
    );
    expect(
      mapDmkInteraction("open-bitcoin", "allow-secure-connection"),
    ).toBeUndefined();
    expect(mapDmkInteraction("genuine", "confirm-open-app")).toBeUndefined();
    expect(
      mapDmkInteraction("list-bitcoin", "allow-list-apps"),
    ).toBeUndefined();
    expect(
      mapDmkInteraction("install-bitcoin", "caller-selected-app"),
    ).toBeUndefined();
  });

  it.each([
    [-2, 0],
    [0, 0],
    [0.004, 0],
    [0.005, 1],
    [0.555, 56],
    [1, 100],
    [4, 100],
  ])("normalizes unit progress %s to %s", (input, expected) => {
    expect(normalizeUnitProgress(input)).toBe(expected);
  });

  it("omits malformed progress rather than coercing it", () => {
    expect(normalizeUnitProgress("0.5")).toBeUndefined();
    expect(normalizeUnitProgress(Number.NaN)).toBeUndefined();
    expect(normalizeUnitProgress(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizeUnitProgress({ valueOf: () => 0.5 })).toBeUndefined();
  });

  it("keeps progress monotonic and suppresses equivalent events", () => {
    const mapper = createPendingEventMapper("installing", "install-bitcoin");

    expect(
      mapper.map({ interaction: "unlock-device", unitProgress: 0.2 }),
    ).toEqual({
      phase: "installing",
      interaction: "unlock-device",
      progress: 20,
    });
    expect(
      mapper.map({ interaction: "unlock-device", unitProgress: 0.2 }),
    ).toBeUndefined();
    expect(
      mapper.map({
        interaction: "allow-secure-connection",
        unitProgress: 0.1,
      }),
    ).toEqual({
      phase: "installing",
      interaction: "allow-secure-connection",
      progress: 20,
    });
    expect(
      mapper.map({
        interaction: "allow-secure-connection",
        unitProgress: 0.255,
      }),
    ).toEqual({
      phase: "installing",
      interaction: "allow-secure-connection",
      progress: 26,
    });
  });

  it.each(["genuine", "list-bitcoin", "open-bitcoin"] as const)(
    "does not expose progress for %s because the pinned SDK has no progress field",
    (actionKind) => {
      const mapper = createPendingEventMapper(
        "checking-genuine",
        actionKind,
      );

      expect(mapper.map({ unitProgress: 0.5 })).toEqual({
        phase: "checking-genuine",
      });
    },
  );

  it("uses 100 only as informational progress", () => {
    const mapper = createPendingEventMapper("installing", "install-bitcoin");

    expect(mapper.map({ unitProgress: 1 })).toEqual({
      phase: "installing",
      progress: 100,
    });
    expect(mapper.map({ unitProgress: 1 })).toBeUndefined();
  });

  it("emits no raw interaction or extra input fields", () => {
    const sensitiveCanary = "device-id-private-and-apdu-e0510000";
    const mapper = createPendingEventMapper(
      "checking-bitcoin-app",
      "list-bitcoin",
    );
    const input = {
      interaction: sensitiveCanary,
      unitProgress: 0.5,
      installedApps: [{ name: "Private App", hash: sensitiveCanary }],
    };
    const event = mapper.map(input);

    expect(event).toEqual({ phase: "checking-bitcoin-app" });
    expect(Object.keys(event ?? {}).sort()).toEqual(["phase"]);
    expect(JSON.stringify(event)).not.toContain(sensitiveCanary);
  });
});
