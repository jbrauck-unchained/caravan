const sdkMocks = vi.hoisted(() => {
  const webHidTransportFactory = vi.fn();
  const runtime = Object.freeze({ marker: "official-runtime" });
  const builders: Array<{
    addTransport: ReturnType<typeof vi.fn>;
    addConfig: ReturnType<typeof vi.fn>;
    addLogger: ReturnType<typeof vi.fn>;
    build: ReturnType<typeof vi.fn>;
  }> = [];

  class DeviceManagementKitBuilder {
    readonly addTransport = vi.fn(() => this);
    readonly addConfig = vi.fn(() => this);
    readonly addLogger = vi.fn(() => this);
    readonly build = vi.fn(() => runtime);

    constructor() {
      builders.push(this);
    }
  }

  return {
    builders,
    DeviceManagementKitBuilder,
    runtime,
    webHidTransportFactory,
  };
});

vi.mock("@ledgerhq/device-management-kit", () => ({
  DeviceManagementKitBuilder: sdkMocks.DeviceManagementKitBuilder,
}));

vi.mock("@ledgerhq/device-transport-kit-web-hid", () => ({
  webHidTransportFactory: sdkMocks.webHidTransportFactory,
}));

import {
  assertProductionDmkConfigurationApproved,
  type InternalDmkServiceConfig,
  UNAPPROVED_PRODUCTION_DMK_CONFIG,
} from "./constants";
import {
  acquireDmkRuntime,
  buildOfficialDmkRuntime,
  resetDmkRuntimeForTesting,
} from "./dmkRuntime";

const alternateConfig: InternalDmkServiceConfig = Object.freeze({
  ...UNAPPROVED_PRODUCTION_DMK_CONFIG,
  provider: 2,
});

describe("cached DMK runtime", () => {
  beforeEach(() => {
    resetDmkRuntimeForTesting();
    sdkMocks.builders.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetDmkRuntimeForTesting();
  });

  it("builds once with WebHID, reviewed service config, and no logger", () => {
    const first = acquireDmkRuntime();
    const second = acquireDmkRuntime({
      ...UNAPPROVED_PRODUCTION_DMK_CONFIG,
    });

    expect(first).toBe(sdkMocks.runtime);
    expect(second).toBe(first);
    expect(sdkMocks.builders).toHaveLength(1);
    const [builder] = sdkMocks.builders;
    expect(builder.addTransport).toHaveBeenCalledOnce();
    expect(builder.addTransport).toHaveBeenCalledWith(
      sdkMocks.webHidTransportFactory,
    );
    expect(builder.addConfig).toHaveBeenCalledOnce();
    expect(builder.addConfig).toHaveBeenCalledWith({
      managerApiUrl: "https://manager.api.live.ledger.com/api",
      webSocketUrl: "wss://scriptrunner.api.live.ledger.com/update",
      provider: 1,
    });
    expect(builder.addLogger).not.toHaveBeenCalled();
    expect(builder.build).toHaveBeenCalledOnce();
  });

  it("rejects conflicting cached configuration without rebuilding", () => {
    const factory = vi.fn(() => sdkMocks.runtime as never);
    acquireDmkRuntime(UNAPPROVED_PRODUCTION_DMK_CONFIG, factory);

    expect(() => acquireDmkRuntime(alternateConfig, factory)).toThrow(
      "different internal configuration",
    );
    expect(factory).toHaveBeenCalledOnce();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid provider %s before construction",
    (provider) => {
      const factory = vi.fn(() => sdkMocks.runtime as never);
      const config = {
        ...UNAPPROVED_PRODUCTION_DMK_CONFIG,
        provider,
      };

      expect(() => acquireDmkRuntime(config, factory)).toThrow(
        "positive integer",
      );
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it("does not cache a failed construction attempt", () => {
    const constructionError = new Error("symbolic construction failure");
    const failingFactory = vi.fn(() => {
      throw constructionError;
    });
    const succeedingFactory = vi.fn(() => sdkMocks.runtime as never);

    expect(() =>
      acquireDmkRuntime(UNAPPROVED_PRODUCTION_DMK_CONFIG, failingFactory),
    ).toThrow(constructionError);
    expect(
      acquireDmkRuntime(UNAPPROVED_PRODUCTION_DMK_CONFIG, succeedingFactory),
    ).toBe(sdkMocks.runtime);
    expect(succeedingFactory).toHaveBeenCalledOnce();
  });

  it("retains an explicit failing production authorization gate", () => {
    expect(UNAPPROVED_PRODUCTION_DMK_CONFIG.authorization).toBe("unapproved");
    expect(assertProductionDmkConfigurationApproved).toThrow(
      "not approved for release",
    );
  });

  it("constructs the official boundary without invoking runtime services", () => {
    const runtime = buildOfficialDmkRuntime(UNAPPROVED_PRODUCTION_DMK_CONFIG);

    expect(runtime).toBe(sdkMocks.runtime);
    expect(Object.keys(sdkMocks.runtime)).toEqual(["marker"]);
  });
});
