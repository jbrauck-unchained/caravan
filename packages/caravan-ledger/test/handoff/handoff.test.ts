import { readFileSync, readdirSync, type Dirent } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type LedgerTransport,
  resetLedgerDependenciesForTesting,
  setLedgerDependenciesForTesting,
} from "../../../caravan-wallets/src/internal/ledgerDependencies";
import { LedgerInteraction } from "../../../caravan-wallets/src/ledger";
import { createBitcoinAppInstallerCore } from "../../src/installer";
import { systemClock } from "../../src/internal/clock";
import type {
  DmkDiscoveredDevice,
  DmkSession,
} from "../../src/internal/dmkPort";
import {
  LEDGER_HID_VENDOR_ID,
  type HidDeviceIdentity,
  type HidDeviceSnapshot,
  type HidPort,
} from "../../src/internal/hidPort";
import { resetRuntimeLeaseForTesting } from "../../src/internal/runtimeLease";
import { createCandidateModelPolicyForTesting } from "../../src/internal/supportedModels";
import { ScriptedDmk } from "../../src/internal/testing/scriptedDmk";
import type {
  BitcoinAppInstaller,
  BitcoinInstallResult,
} from "../../src/types";

type TimelineLabel =
  | "prepare-click"
  | "install-click"
  | "management-disconnect"
  | "hid-close-observed"
  | "installer-result"
  | "continuation-enabled"
  | "signing-click"
  | "webusb-acquire"
  | "webusb-callback"
  | "webusb-close";

type ActivationToken = Readonly<Record<never, never>>;

interface Activated<T> {
  readonly token: ActivationToken;
  readonly value: T;
}

class SimulatedUserActivations {
  #active: ActivationToken | undefined;

  constructor(private readonly timeline: TimelineLabel[]) {}

  get current(): ActivationToken | undefined {
    return this.#active;
  }

  run<T>(
    label: "prepare-click" | "install-click" | "signing-click",
    action: () => T,
  ): Activated<T> {
    if (this.#active) throw new Error("Nested activation is not supported.");
    const token = Object.freeze({});
    this.timeline.push(label);
    this.#active = token;
    try {
      return Object.freeze({ token, value: action() });
    } finally {
      this.#active = undefined;
    }
  }
}

class SigningContinuation {
  enabled = false;

  resultSettlementActivation: ActivationToken | undefined;

  transportUsed: unknown;

  constructor(
    private readonly interaction: LedgerInteraction,
    private readonly activations: SimulatedUserActivations,
    private readonly timeline: TimelineLabel[],
  ) {}

  acceptInstallerResult(result: BitcoinInstallResult): BitcoinInstallResult {
    this.timeline.push("installer-result");
    this.resultSettlementActivation = this.activations.current;
    this.enabled = result.handoff === "ready";
    if (this.enabled) this.timeline.push("continuation-enabled");
    return result;
  }

  startSigning(): Promise<boolean> {
    if (!this.enabled || !this.activations.current) {
      return Promise.resolve(false);
    }
    this.enabled = false;
    return this.interaction.withTransport(async (transport) => {
      this.timeline.push("webusb-callback");
      this.transportUsed = transport;
      return true;
    });
  }
}

const discoveredDevice: DmkDiscoveredDevice = Object.freeze({
  internalDeviceId: "handoff-fixture-device",
});

const connectedSession: DmkSession = Object.freeze({
  internalSessionId: "handoff-fixture-session",
  modelId: "nanoS",
});

const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

function queueAlreadyInstalledLifecycle(): ScriptedDmk {
  return new ScriptedDmk(systemClock)
    .queueDiscovery([{ type: "next", value: discoveredDevice }])
    .queueConnect({ type: "resolve", value: connectedSession })
    .queueSessionLifecycle([{ type: "never" }])
    .queueAction("genuine", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { isGenuine: true },
        },
      },
    ])
    .queueAction("list-bitcoin", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { bitcoinPresent: true },
        },
      },
    ])
    .queueAction("open-bitcoin", [
      {
        type: "next",
        value: {
          status: "completed",
          output: { appOpened: true },
        },
      },
    ]);
}

function createInstaller(
  fake: ScriptedDmk,
  createHidPort: () => HidPort,
): BitcoinAppInstaller {
  return createBitcoinAppInstallerCore({
    clock: systemClock,
    createHidPort,
    createPort: () => fake,
    getSupport: () => ({ supported: true }),
    modelPolicy: candidatePolicy,
  });
}

function nanoSHidSnapshot(
  identity: HidDeviceIdentity,
  opened: boolean,
): HidDeviceSnapshot {
  return Object.freeze({
    identity,
    vendorId: LEDGER_HID_VENDOR_ID,
    productId: 0x1000,
    opened,
  });
}

class ObservableManagementHid implements HidPort {
  readonly #identity = Object.freeze({}) as HidDeviceIdentity;

  readonly #listeners = new Set<
    Parameters<HidPort["subscribeToDeviceChanges"]>[0]
  >();

  #opened = false;

  #disconnectSettled = false;

  #closureRecorded = false;

  constructor(private readonly timeline: TimelineLabel[]) {}

  get opened(): boolean {
    return this.#opened;
  }

  get activeListeners(): number {
    return this.#listeners.size;
  }

  markManagementOpened(): void {
    this.#opened = true;
  }

  releaseAfterDisconnect(): void {
    this.#disconnectSettled = true;
    this.#opened = false;
  }

  getGrantedDevices(): Promise<readonly HidDeviceSnapshot[]> {
    if (this.#disconnectSettled && !this.#opened && !this.#closureRecorded) {
      this.#closureRecorded = true;
      this.timeline.push("hid-close-observed");
    }
    return Promise.resolve(
      Object.freeze([nanoSHidSnapshot(this.#identity, this.#opened)]),
    );
  }

  subscribeToDeviceChanges(
    listener: Parameters<HidPort["subscribeToDeviceChanges"]>[0],
  ): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

function instrumentManagementLifecycle(
  fake: ScriptedDmk,
  hid: ObservableManagementHid,
  timeline: TimelineLabel[],
): void {
  const connect = fake.connect.bind(fake);
  vi.spyOn(fake, "connect").mockImplementation((device) => {
    const connection = connect(device);
    hid.markManagementOpened();
    return connection;
  });

  const disconnect = fake.disconnect.bind(fake);
  vi.spyOn(fake, "disconnect").mockImplementation((session) => {
    timeline.push("management-disconnect");
    return disconnect(session).then(() => hid.releaseAfterDisconnect());
  });
}

function forceWebUsb(interaction: LedgerInteraction): void {
  vi.spyOn(interaction.environment, "satisfies").mockReturnValue(false);
}

function indexOf(timeline: readonly TimelineLabel[], label: TimelineLabel) {
  const index = timeline.indexOf(label);
  expect(
    index,
    `missing sanitized timeline label: ${label}`,
  ).toBeGreaterThanOrEqual(0);
  return index;
}

const ledgerPackageRoot = fileURLToPath(new URL("../../", import.meta.url));
const walletsPackageRoot = fileURLToPath(
  new URL("../../../caravan-wallets/", import.meta.url),
);

function runtimeTypeScriptFiles(directory: string): string[] {
  const entries: Dirent[] = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...runtimeTypeScriptFiles(entryPath));
    } else if (
      entry.isFile() &&
      /\.[cm]?tsx?$/.test(entry.name) &&
      !/\.(?:test|spec)\.[cm]?tsx?$/.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

function moduleSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const pattern =
    /\b(?:from\s+|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function importsPackage(
  sourceFile: string,
  specifier: string,
  packageName: string,
  packageRoot: string,
): boolean {
  if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
    return true;
  }
  if (!specifier.startsWith(".")) return false;
  const resolvedSpecifier = resolve(dirname(sourceFile), specifier);
  return (
    resolvedSpecifier === packageRoot ||
    resolvedSpecifier.startsWith(`${packageRoot}${sep}`)
  );
}

function crossPackageRuntimeImports(
  sourcePackageRoot: string,
  targetPackageName: string,
  targetPackageRoot: string,
): string[] {
  const sourceRoot = resolve(sourcePackageRoot, "src");
  const violations: string[] = [];
  for (const sourceFile of runtimeTypeScriptFiles(sourceRoot)) {
    for (const specifier of moduleSpecifiers(sourceFile)) {
      if (
        importsPackage(
          sourceFile,
          specifier,
          targetPackageName,
          targetPackageRoot,
        )
      ) {
        violations.push(
          `${relative(sourcePackageRoot, sourceFile)}:${specifier}`,
        );
      }
    }
  }
  return violations;
}

function runtimeDependencies(packageRoot: string): Record<string, unknown> {
  const manifest = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
  ) as {
    readonly dependencies?: Record<string, unknown>;
    readonly optionalDependencies?: Record<string, unknown>;
    readonly peerDependencies?: Record<string, unknown>;
  };
  return {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };
}

describe("private management-to-signing handoff contract", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
    resetLedgerDependenciesForTesting();
    vi.stubGlobal("window", {
      navigator: {
        userAgent:
          "Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetLedgerDependenciesForTesting();
    resetRuntimeLeaseForTesting();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("observes management release before enabling a separately activated WebUSB continuation", async () => {
    const timeline: TimelineLabel[] = [];
    const activations = new SimulatedUserActivations(timeline);
    const hid = new ObservableManagementHid(timeline);
    const fake = queueAlreadyInstalledLifecycle();
    instrumentManagementLifecycle(fake, hid, timeline);

    let webUsbOpen = false;
    let overlapObserved = false;
    let factoryActivation: ActivationToken | undefined;
    const close = vi.fn(async () => {
      timeline.push("webusb-close");
      webUsbOpen = false;
    });
    const acquiredTransport = {
      close,
      send: vi.fn(),
      setExchangeTimeout: vi.fn(),
      setScrambleKey: vi.fn(),
    } as unknown as LedgerTransport;
    const createWebUSBTransport = vi.fn(async () => {
      timeline.push("webusb-acquire");
      factoryActivation = activations.current;
      overlapObserved ||= hid.opened || webUsbOpen;
      webUsbOpen = true;
      return acquiredTransport;
    });
    setLedgerDependenciesForTesting({ createWebUSBTransport } as never);

    const interaction = new LedgerInteraction();
    forceWebUsb(interaction);
    const continuation = new SigningContinuation(
      interaction,
      activations,
      timeline,
    );
    const installer = createInstaller(fake, () => hid);

    const preparation = activations.run("prepare-click", () =>
      installer.prepare(),
    );
    const plan = await preparation.value;
    const installation = activations.run("install-click", () =>
      installer.install(plan),
    );
    const result = await installation.value.then((settled) =>
      continuation.acceptInstallerResult(settled),
    );

    expect(result).toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "ready",
    });
    expect(continuation.resultSettlementActivation).toBeUndefined();
    expect(continuation.enabled).toBe(true);
    await Promise.resolve();
    expect(createWebUSBTransport).not.toHaveBeenCalled();
    await expect(continuation.startSigning()).resolves.toBe(false);
    expect(createWebUSBTransport).not.toHaveBeenCalled();

    const signing = activations.run("signing-click", () =>
      continuation.startSigning(),
    );
    expect(signing.token).not.toBe(installation.token);
    expect(factoryActivation).toBe(signing.token);
    await expect(signing.value).resolves.toBe(true);

    expect(overlapObserved).toBe(false);
    expect(acquiredTransport).not.toBe(fake);
    expect(acquiredTransport).not.toBe(hid);
    expect(continuation.transportUsed).toBe(acquiredTransport);
    expect(createWebUSBTransport).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(webUsbOpen).toBe(false);
    expect(hid.activeListeners).toBe(0);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });
    expect(vi.getTimerCount()).toBe(0);

    expect(indexOf(timeline, "management-disconnect")).toBeLessThan(
      indexOf(timeline, "hid-close-observed"),
    );
    expect(indexOf(timeline, "hid-close-observed")).toBeLessThan(
      indexOf(timeline, "installer-result"),
    );
    expect(indexOf(timeline, "installer-result")).toBeLessThan(
      indexOf(timeline, "continuation-enabled"),
    );
    expect(indexOf(timeline, "continuation-enabled")).toBeLessThan(
      indexOf(timeline, "signing-click"),
    );
    expect(indexOf(timeline, "signing-click")).toBeLessThan(
      indexOf(timeline, "webusb-acquire"),
    );
    expect(timeline).toEqual([
      "prepare-click",
      "install-click",
      "management-disconnect",
      "hid-close-observed",
      "installer-result",
      "continuation-enabled",
      "signing-click",
      "webusb-acquire",
      "webusb-callback",
      "webusb-close",
    ]);

    await installer.dispose();
  });

  it("keeps reconnect-required disabled and never enters the WebUSB seam", async () => {
    const timeline: TimelineLabel[] = [];
    const activations = new SimulatedUserActivations(timeline);
    const fake = queueAlreadyInstalledLifecycle();
    const disconnect = fake.disconnect.bind(fake);
    vi.spyOn(fake, "disconnect").mockImplementation((session) => {
      timeline.push("management-disconnect");
      return disconnect(session);
    });

    const createWebUSBTransport = vi.fn();
    setLedgerDependenciesForTesting({ createWebUSBTransport } as never);
    const interaction = new LedgerInteraction();
    forceWebUsb(interaction);
    const continuation = new SigningContinuation(
      interaction,
      activations,
      timeline,
    );
    const installer = createInstaller(fake, () => {
      throw new Error("HID observation unavailable");
    });

    const preparation = activations.run("prepare-click", () =>
      installer.prepare(),
    );
    const plan = await preparation.value;
    const installation = activations.run("install-click", () =>
      installer.install(plan),
    );
    const result = await installation.value.then((settled) =>
      continuation.acceptInstallerResult(settled),
    );

    expect(result).toEqual({
      status: "already-installed",
      appOpen: true,
      handoff: "reconnect-required",
    });
    expect(continuation.enabled).toBe(false);
    const signing = activations.run("signing-click", () =>
      continuation.startSigning(),
    );
    await expect(signing.value).resolves.toBe(false);
    expect(createWebUSBTransport).not.toHaveBeenCalled();
    expect(timeline).not.toContain("continuation-enabled");
    expect(timeline).toEqual([
      "prepare-click",
      "install-click",
      "management-disconnect",
      "installer-result",
      "signing-click",
    ]);
    expect(fake.resources()).toMatchObject({
      disconnectCount: 1,
      activeSubscriptions: 0,
      scheduledTimers: 0,
    });

    await installer.dispose();
  });

  it("keeps the two production packages runtime-independent", () => {
    expect(runtimeDependencies(ledgerPackageRoot)).not.toHaveProperty(
      "@caravan/wallets",
    );
    expect(runtimeDependencies(walletsPackageRoot)).not.toHaveProperty(
      "@caravan/ledger",
    );
    expect(
      crossPackageRuntimeImports(
        ledgerPackageRoot,
        "@caravan/wallets",
        walletsPackageRoot,
      ),
    ).toEqual([]);
    expect(
      crossPackageRuntimeImports(
        walletsPackageRoot,
        "@caravan/ledger",
        ledgerPackageRoot,
      ),
    ).toEqual([]);
  });
});
