import { readFileSync } from "node:fs";

import { InstallAppDeviceAction } from "@ledgerhq/device-management-kit";
import { firstValueFrom, NEVER } from "rxjs";

import {
  BITCOIN_APP_NAME,
  REVIEWED_INSTALL_UNLOCK_TIMEOUT_MS,
} from "./constants";
import {
  BitcoinOnlyInstallAppDeviceAction,
  isBitcoinInstallVerificationRequiredError,
} from "./installAppDeviceAction";

type Dependencies = ReturnType<InstallAppDeviceAction["extractDependencies"]>;
type InstallInput = Parameters<Dependencies["installApp"]>[0];

function inputFor(app: unknown): InstallInput {
  return { input: { deviceInfo: {}, app } } as InstallInput;
}

function stubBaseDependencies(installApp: Dependencies["installApp"]): void {
  vi.spyOn(
    InstallAppDeviceAction.prototype,
    "extractDependencies",
  ).mockReturnValue({ installApp } as Dependencies);
}

async function observableError(
  observable: ReturnType<Dependencies["installApp"]>,
) {
  return firstValueFrom(observable).catch((error) => error);
}

describe("Bitcoin-only pinned SDK action", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs the exact fixed target and timeout with no generic authority", () => {
    const action = new BitcoinOnlyInstallAppDeviceAction();

    expect(action).toBeInstanceOf(InstallAppDeviceAction);
    expect(action.input).toEqual({
      appName: BITCOIN_APP_NAME,
      unlockTimeout: REVIEWED_INSTALL_UNLOCK_TIMEOUT_MS,
    });
    expect(Object.keys(action.input)).toEqual(["appName", "unlockTimeout"]);
    expect(action.input).toEqual({ appName: "Bitcoin", unlockTimeout: 60_000 });
    expect(action.mutationAttempted()).toBe(false);
  });

  it("marks immediately before the first exact own-data Bitcoin delegation", () => {
    const delegated = vi.fn(() => {
      expect(action.mutationAttempted()).toBe(true);
      return NEVER;
    });
    stubBaseDependencies(delegated as Dependencies["installApp"]);
    const action = new BitcoinOnlyInstallAppDeviceAction();
    const dependencies = action.extractDependencies({} as never);
    const input = inputFor({ versionName: "Bitcoin" });

    expect(dependencies.installApp(input)).toBe(NEVER);
    expect(delegated).toHaveBeenCalledOnce();
    expect(delegated).toHaveBeenCalledWith(input);
    expect(action.mutationAttempted()).toBe(true);
  });

  it.each([
    ["primitive request", null],
    ["missing app", { input: { deviceInfo: {} } }],
    ["missing version", { input: { deviceInfo: {}, app: {} } }],
    [
      "wrong case",
      { input: { deviceInfo: {}, app: { versionName: "bitcoin" } } },
    ],
    [
      "trailing space",
      { input: { deviceInfo: {}, app: { versionName: "Bitcoin " } } },
    ],
    [
      "inherited",
      {
        input: {
          deviceInfo: {},
          app: Object.create({ versionName: "Bitcoin" }),
        },
      },
    ],
  ])("blocks %s before the mutation marker", async (_name, invalidInput) => {
    const delegated = vi.fn(() => NEVER);
    stubBaseDependencies(delegated as Dependencies["installApp"]);
    const action = new BitcoinOnlyInstallAppDeviceAction();
    const dependencies = action.extractDependencies({} as never);

    const error = await observableError(
      dependencies.installApp(invalidInput as InstallInput),
    );

    expect(error).toMatchObject({ name: "InvalidBitcoinInstallTargetError" });
    expect(action.mutationAttempted()).toBe(false);
    expect(delegated).not.toHaveBeenCalled();
  });

  it("never invokes accessors while validating the install target", async () => {
    const appGetter = vi.fn(() => ({ versionName: "Bitcoin" }));
    const versionGetter = vi.fn(() => "Bitcoin");
    const accessorInput = Object.defineProperty({}, "app", {
      get: appGetter,
    });
    const accessorApp = Object.defineProperty({}, "versionName", {
      get: versionGetter,
    });
    const delegated = vi.fn(() => NEVER);
    stubBaseDependencies(delegated as Dependencies["installApp"]);

    for (const input of [
      { input: accessorInput },
      { input: { app: accessorApp } },
    ]) {
      const action = new BitcoinOnlyInstallAppDeviceAction();
      const dependencies = action.extractDependencies({} as never);
      await observableError(dependencies.installApp(input as InstallInput));
      expect(action.mutationAttempted()).toBe(false);
    }

    expect(appGetter).not.toHaveBeenCalled();
    expect(versionGetter).not.toHaveBeenCalled();
    expect(delegated).not.toHaveBeenCalled();
  });

  it("contains hostile proxy traps before mutation and redacts their details", async () => {
    const canary = "private-catalog-target-and-hash-canary";
    const trap = vi.fn(() => {
      throw new Error(canary);
    });
    const delegated = vi.fn(() => NEVER);
    stubBaseDependencies(delegated as Dependencies["installApp"]);
    const action = new BitcoinOnlyInstallAppDeviceAction();
    const dependencies = action.extractDependencies({} as never);
    const proxy = new Proxy({}, { getOwnPropertyDescriptor: trap });

    const error = await observableError(
      dependencies.installApp(inputFor(proxy)),
    );

    expect(error).toMatchObject({
      name: "InvalidBitcoinInstallTargetError",
      message: "The Ledger install target is invalid.",
    });
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(error.message).not.toContain(canary);
    expect(trap).toHaveBeenCalledOnce();
    expect(action.mutationAttempted()).toBe(false);
    expect(delegated).not.toHaveBeenCalled();
  });

  it("returns a local error Observable on a second invocation and never delegates twice", async () => {
    const delegated = vi.fn(() => NEVER);
    stubBaseDependencies(delegated as Dependencies["installApp"]);
    const action = new BitcoinOnlyInstallAppDeviceAction();
    const dependencies = action.extractDependencies({} as never);
    const input = inputFor({ versionName: "Bitcoin" });

    expect(dependencies.installApp(input)).toBe(NEVER);
    const second = dependencies.installApp(input);
    expect(() => second).not.toThrow();
    const error = await firstValueFrom(second).catch((failure) => failure);
    expect(error).toMatchObject({
      name: "BitcoinInstallAlreadyAttemptedError",
    });
    expect(isBitcoinInstallVerificationRequiredError(error)).toBe(true);
    expect(
      isBitcoinInstallVerificationRequiredError({
        name: "BitcoinInstallAlreadyAttemptedError",
        message: error.message,
        _tag: "BitcoinInstallAlreadyAttemptedError",
      }),
    ).toBe(false);
    expect(delegated).toHaveBeenCalledOnce();
    expect(action.mutationAttempted()).toBe(true);
  });

  it("does not accept callable or primitive values as package-created repeat blockers", () => {
    expect(isBitcoinInstallVerificationRequiredError(() => undefined)).toBe(
      false,
    );
    expect(isBitcoinInstallVerificationRequiredError(null)).toBe(false);
  });

  it("leaves the marker true when the original dependency throws synchronously", () => {
    const delegatedError = new Error("private-original-sync-error-canary");
    const delegated = vi.fn(() => {
      throw delegatedError;
    });
    stubBaseDependencies(delegated as Dependencies["installApp"]);
    const action = new BitcoinOnlyInstallAppDeviceAction();
    const dependencies = action.extractDependencies({} as never);

    expect(() =>
      dependencies.installApp(inputFor({ versionName: "Bitcoin" })),
    ).toThrow(delegatedError);
    expect(action.mutationAttempted()).toBe(true);
    expect(delegated).toHaveBeenCalledOnce();
  });

  it("pins the root export and proves makeStateMachine still dispatches virtually", () => {
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
      new URL("./installAppDeviceAction.ts", import.meta.url),
      "utf8",
    );
    const action = new BitcoinOnlyInstallAppDeviceAction();
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
