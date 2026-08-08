import { readFileSync } from "node:fs";

import { OpenAppDeviceAction } from "@ledgerhq/device-management-kit";

import {
  BITCOIN_APP_NAME,
  REVIEWED_READ_ONLY_UNLOCK_TIMEOUT_MS,
} from "./constants";
import {
  BitcoinOnlyOpenAppDeviceAction,
  isExactBitcoinOpenOutput,
} from "./openAppDeviceAction";

type Dependencies = ReturnType<OpenAppDeviceAction["extractDependencies"]>;
type OpenInput = Parameters<Dependencies["openApp"]>[0];

function inputFor(appName: unknown): OpenInput {
  return { input: { appName } } as OpenInput;
}

function stubBaseDependencies(openApp: Dependencies["openApp"]): Dependencies {
  const dependencies = {
    closeApp: vi.fn(),
    openApp,
    getDeviceSessionState: vi.fn(),
    setDeviceSessionState: vi.fn(),
  } as unknown as Dependencies;
  vi.spyOn(
    OpenAppDeviceAction.prototype,
    "extractDependencies",
  ).mockReturnValue(dependencies);
  return dependencies;
}

describe("Bitcoin-only pinned open action", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs the exact fixed target and reviewed timeout", () => {
    const action = new BitcoinOnlyOpenAppDeviceAction();

    expect(action).toBeInstanceOf(OpenAppDeviceAction);
    expect(action.input).toEqual({
      appName: BITCOIN_APP_NAME,
      unlockTimeout: REVIEWED_READ_ONLY_UNLOCK_TIMEOUT_MS,
    });
    expect(action.input).toEqual({ appName: "Bitcoin", unlockTimeout: 60_000 });
    expect(Object.keys(action.input)).toEqual(["appName", "unlockTimeout"]);
    expect(Object.isFrozen(action.input)).toBe(true);
    expect(BitcoinOnlyOpenAppDeviceAction.length).toBe(0);
  });

  it("delegates only an exact own-data Bitcoin target", async () => {
    const delegatedResult = Promise.resolve({}) as ReturnType<
      Dependencies["openApp"]
    >;
    const delegated = vi.fn(() => delegatedResult);
    const base = stubBaseDependencies(
      delegated as unknown as Dependencies["openApp"],
    );
    const action = new BitcoinOnlyOpenAppDeviceAction();
    const dependencies = action.extractDependencies({} as never);
    const input = inputFor("Bitcoin");

    await expect(dependencies.openApp(input)).resolves.toEqual({});
    expect(delegated).toHaveBeenCalledOnce();
    expect(delegated).toHaveBeenCalledWith(input);
    expect(dependencies.closeApp).toBe(base.closeApp);
    expect(dependencies.getDeviceSessionState).toBe(base.getDeviceSessionState);
    expect(dependencies.setDeviceSessionState).toBe(base.setDeviceSessionState);
  });

  it.each([
    ["primitive request", null],
    ["missing input", {}],
    ["missing app name", { input: {} }],
    ["wrong case", { input: { appName: "bitcoin" } }],
    ["trailing space", { input: { appName: "Bitcoin " } }],
    ["inherited", { input: Object.create({ appName: "Bitcoin" }) }],
  ])("blocks %s without invoking the SDK dependency", async (_name, input) => {
    const delegated = vi.fn();
    stubBaseDependencies(delegated as unknown as Dependencies["openApp"]);
    const action = new BitcoinOnlyOpenAppDeviceAction();
    const dependencies = action.extractDependencies({} as never);

    const error = await dependencies
      .openApp(input as OpenInput)
      .catch((failure) => failure);

    expect(error).toMatchObject({
      name: "InvalidBitcoinOpenTargetError",
      message: "The Ledger open target is invalid.",
    });
    expect(delegated).not.toHaveBeenCalled();
  });

  it("never invokes target accessors or leaks hostile proxy details", async () => {
    const appNameGetter = vi.fn(() => "Bitcoin");
    const accessorInput = {
      input: Object.defineProperty({}, "appName", { get: appNameGetter }),
    };
    const canary = "private-open-target-and-session-canary";
    const trap = vi.fn(() => {
      throw new Error(canary);
    });
    const proxyInput = {
      input: new Proxy({}, { getOwnPropertyDescriptor: trap }),
    };
    const delegated = vi.fn();
    stubBaseDependencies(delegated as unknown as Dependencies["openApp"]);
    const action = new BitcoinOnlyOpenAppDeviceAction();
    const dependencies = action.extractDependencies({} as never);

    for (const input of [accessorInput, proxyInput]) {
      const error = await dependencies
        .openApp(input as OpenInput)
        .catch((failure) => failure);
      expect(error).toMatchObject({ name: "InvalidBitcoinOpenTargetError" });
      expect(JSON.stringify(error)).not.toContain(canary);
      expect(error.message).not.toContain(canary);
    }

    expect(appNameGetter).not.toHaveBeenCalled();
    expect(trap).toHaveBeenCalledOnce();
    expect(delegated).not.toHaveBeenCalled();
  });

  it("accepts only the pinned action's exact void completion value", () => {
    expect(isExactBitcoinOpenOutput(undefined)).toBe(true);
    for (const value of [null, false, true, 0, "", {}, () => undefined]) {
      expect(isExactBitcoinOpenOutput(value)).toBe(false);
    }
  });

  it("pins the package-root export and virtual dependency dispatch", () => {
    const packageManifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const installedManifest = JSON.parse(
      readFileSync(
        new URL(
          "../../node_modules/@ledgerhq/device-management-kit/package.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { version?: string };
    const source = readFileSync(
      new URL("./openAppDeviceAction.ts", import.meta.url),
      "utf8",
    );
    const action = new BitcoinOnlyOpenAppDeviceAction();
    const extract = vi.spyOn(action, "extractDependencies");

    expect(
      packageManifest.dependencies?.["@ledgerhq/device-management-kit"],
    ).toBe("1.7.1");
    expect(installedManifest.version).toBe("1.7.1");
    expect(source).toContain('from "@ledgerhq/device-management-kit"');
    expect(source).not.toContain("@ledgerhq/device-management-kit/");
    expect(() => action.makeStateMachine({} as never)).not.toThrow();
    expect(extract).toHaveBeenCalledOnce();
  });
});
