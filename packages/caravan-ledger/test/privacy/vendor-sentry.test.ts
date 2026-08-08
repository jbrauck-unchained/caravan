import { readFileSync } from "node:fs";

import {
  defaultApduReceiverServiceStubBuilder,
  defaultApduSenderServiceStubBuilder,
  NoAccessibleDeviceError,
  noopLoggerFactory,
  StaticDeviceModelDataSource,
} from "@ledgerhq/device-management-kit";
import { WebHidTransport } from "@ledgerhq/device-transport-kit-web-hid";
// This test intentionally audits the exact transitive Sentry hub used by WebHID.
// eslint-disable-next-line import/no-extraneous-dependencies
import { getCurrentHub, Hub, makeMain } from "@sentry/hub";

import type { BitcoinInstallerEvent } from "../../src/events";
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

const CANARIES = Object.freeze({
  apdu: "privacy-apdu-6-6",
  appHash: "privacy-app-hash-6-6",
  deviceId: "privacy-device-id-6-6",
  errorMessage: "privacy-error-message-6-6",
  hidSerial: "privacy-hid-serial-6-6",
  nestedCause: "privacy-nested-cause-6-6",
  responseBody: "privacy-response-body-6-6",
  sessionId: "privacy-session-id-6-6",
  stack: "privacy-stack-6-6",
  url: "https://privacy.invalid/6-6?token=privacy-query-6-6",
});

const ALL_CANARIES = Object.freeze(Object.values(CANARIES));

interface SideEffectTripwires {
  readonly consoleSpies: readonly ReturnType<typeof vi.spyOn>[];
  readonly fetch: ReturnType<typeof vi.fn>;
  readonly localStorage: Storage;
  readonly sendBeacon: ReturnType<typeof vi.fn>;
  readonly sessionStorage: Storage;
  readonly webSocket: ReturnType<typeof vi.fn>;
  readonly xmlHttpRequest: ReturnType<typeof vi.fn>;
}

function createStorageTripwire(): Storage {
  return {
    clear: vi.fn(),
    getItem: vi.fn(() => null),
    key: vi.fn(() => null),
    get length() {
      return 0;
    },
    removeItem: vi.fn(),
    setItem: vi.fn(),
  };
}

function installSideEffectTripwires(): SideEffectTripwires {
  const fetch = vi.fn(() =>
    Promise.reject(new Error("Unexpected fetch in the offline privacy test.")),
  );
  const sendBeacon = vi.fn(() => false);
  const webSocket = vi.fn();
  const xmlHttpRequest = vi.fn();
  const localStorage = createStorageTripwire();
  const sessionStorage = createStorageTripwire();

  class DeniedWebSocket {
    constructor() {
      webSocket();
      throw new Error("Unexpected WebSocket in the offline privacy test.");
    }
  }

  class DeniedXmlHttpRequest {
    constructor() {
      xmlHttpRequest();
      throw new Error("Unexpected XHR in the offline privacy test.");
    }
  }

  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("WebSocket", DeniedWebSocket);
  vi.stubGlobal("XMLHttpRequest", DeniedXmlHttpRequest);
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("sessionStorage", sessionStorage);

  const consoleSpies = (["debug", "error", "info", "log", "warn"] as const).map(
    (method) => vi.spyOn(console, method).mockImplementation(() => undefined),
  );

  return {
    consoleSpies,
    fetch,
    localStorage,
    sendBeacon,
    sessionStorage,
    webSocket,
    xmlHttpRequest,
  };
}

function expectNoObservedSideEffects(tripwires: SideEffectTripwires): void {
  const callCounts = [
    tripwires.fetch.mock.calls.length,
    tripwires.sendBeacon.mock.calls.length,
    tripwires.webSocket.mock.calls.length,
    tripwires.xmlHttpRequest.mock.calls.length,
  ];
  for (const spy of tripwires.consoleSpies) {
    callCounts.push(spy.mock.calls.length);
  }
  for (const storage of [tripwires.localStorage, tripwires.sessionStorage]) {
    for (const method of [
      storage.clear,
      storage.getItem,
      storage.key,
      storage.removeItem,
      storage.setItem,
    ]) {
      callCounts.push((method as ReturnType<typeof vi.fn>).mock.calls.length);
    }
  }
  expect(
    callCounts,
    "numbered network, console, or storage tripwires observed a side effect",
  ).toEqual(callCounts.map(() => 0));
}

function packageVersion(relativeManifest: string): string | undefined {
  const manifest = JSON.parse(
    readFileSync(new URL(relativeManifest, import.meta.url), "utf8"),
  ) as { readonly version?: unknown };
  return typeof manifest.version === "string" ? manifest.version : undefined;
}

function createRawCanaryError(): Error {
  const rawError = new Error(CANARIES.errorMessage, {
    cause: { nested: CANARIES.nestedCause },
  });
  rawError.stack = `Error: ${CANARIES.stack}`;
  Object.assign(rawError, {
    apdu: CANARIES.apdu,
    apps: [{ hash: CANARIES.appHash }],
    deviceId: CANARIES.deviceId,
    hidDevice: { serialNumber: CANARIES.hidSerial },
    requestUrl: CANARIES.url,
    responseBody: CANARIES.responseBody,
    sessionId: CANARIES.sessionId,
  });
  return rawError;
}

function capturedDiscoveryError(transport: WebHidTransport): Promise<unknown> {
  return new Promise((resolve, reject) => {
    transport.startDiscovering().subscribe({
      complete: () =>
        reject(new Error("Discovery completed without an error.")),
      error: resolve,
      next: () => reject(new Error("Discovery emitted an unexpected device.")),
    });
  });
}

function stubNavigator(
  hid: {
    readonly addEventListener: ReturnType<typeof vi.fn>;
    readonly getDevices: ReturnType<typeof vi.fn>;
    readonly requestDevice: ReturnType<typeof vi.fn>;
  },
  sendBeacon: ReturnType<typeof vi.fn>,
): void {
  vi.stubGlobal("navigator", { hid, sendBeacon });
}

function observedCanaryCategories(value: unknown): readonly number[] {
  const observed = new Set<number>();
  const pending: unknown[] = [value];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const candidate = pending.pop();
    if (typeof candidate === "string") {
      for (const [index, canary] of ALL_CANARIES.entries()) {
        if (candidate.includes(canary)) observed.add(index + 1);
      }
      continue;
    }
    if (
      (typeof candidate !== "object" && typeof candidate !== "function") ||
      candidate === null ||
      visited.has(candidate)
    ) {
      continue;
    }

    visited.add(candidate);
    if (candidate instanceof Error) {
      for (const property of ["name", "message", "stack", "cause"] as const) {
        try {
          pending.push(Reflect.get(candidate, property));
        } catch (error) {
          pending.push(error);
        }
      }
    }
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    for (const property of Reflect.ownKeys(descriptors)) {
      pending.push(
        typeof property === "symbol" ? property.description : property,
      );
      const descriptor = Reflect.get(descriptors, property);
      if (descriptor && "value" in descriptor) pending.push(descriptor.value);
    }
  }

  return [...observed].sort((left, right) => left - right);
}

function assertNoCanaries(value: unknown): void {
  expect(
    observedCanaryCategories(value),
    "public output contained one or more numbered privacy canary categories",
  ).toEqual([]);
}

class SequencedHidPort implements HidPort {
  readonly #snapshots: readonly (readonly HidDeviceSnapshot[])[];

  #reads = 0;

  constructor(snapshots: readonly (readonly HidDeviceSnapshot[])[]) {
    this.#snapshots = snapshots;
  }

  getGrantedDevices(): Promise<readonly HidDeviceSnapshot[]> {
    const snapshots =
      this.#snapshots[this.#reads] ?? this.#snapshots.at(-1) ?? [];
    this.#reads += 1;
    return Promise.resolve(snapshots);
  }

  subscribeToDeviceChanges(): () => void {
    return () => undefined;
  }
}

const candidatePolicy = createCandidateModelPolicyForTesting(["nanoS"]);

describe("resolved WebHID Sentry privacy behavior", () => {
  afterEach(() => {
    resetRuntimeLeaseForTesting();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("routes a requestDevice rejection to the host hub twice with both raw-error aliases", async () => {
    expect(
      packageVersion(
        "../../node_modules/@ledgerhq/device-transport-kit-web-hid/package.json",
      ),
    ).toBe("1.2.4");
    expect(
      packageVersion("../../../../node_modules/@sentry/minimal/package.json"),
    ).toBe("6.19.7");
    expect(
      packageVersion("../../../../node_modules/@sentry/hub/package.json"),
    ).toBe("6.19.7");

    const rawError = createRawCanaryError();
    const tripwires = installSideEffectTripwires();
    const hid = {
      addEventListener: vi.fn(),
      getDevices: vi.fn(() => Promise.resolve([])),
      requestDevice: vi.fn(() => Promise.reject(rawError)),
    };
    stubNavigator(hid, tripwires.sendBeacon);

    const isolatedHub = new Hub();
    expect(isolatedHub.getClient()).toBeUndefined();
    const hubCapture = vi.spyOn(isolatedHub, "captureException");
    const previousHub = makeMain(isolatedHub);
    let transport: WebHidTransport | undefined;

    try {
      transport = new WebHidTransport(
        new StaticDeviceModelDataSource(),
        noopLoggerFactory,
        (args) => defaultApduSenderServiceStubBuilder(args, noopLoggerFactory),
        (args) =>
          defaultApduReceiverServiceStubBuilder(args, noopLoggerFactory),
      );
      expect(getCurrentHub()).toBe(isolatedHub);
      const observedError = await capturedDiscoveryError(transport);

      assertNoCanaries(hid.requestDevice.mock.calls);
      expect(hid.requestDevice).toHaveBeenCalledOnce();
      expect(hid.requestDevice).toHaveBeenCalledWith({
        filters: [{ vendorId: LEDGER_HID_VENDOR_ID }],
      });
      expect(hid.getDevices).not.toHaveBeenCalled();
      expect(observedError instanceof NoAccessibleDeviceError).toBe(true);
      expect(Object.keys(observedError as object).sort()).toEqual([
        "_tag",
        "err",
        "originalError",
      ]);
      expect(Reflect.get(observedError as object, "_tag")).toBe(
        "NoAccessibleDeviceError",
      );
      expect(Reflect.get(observedError as object, "err") === rawError).toBe(
        true,
      );
      expect(
        Reflect.get(observedError as object, "originalError") === rawError,
      ).toBe(true);
      expect(observedCanaryCategories(observedError)).toEqual(
        ALL_CANARIES.map((_, index) => index + 1),
      );

      expect(hubCapture.mock.calls.length).toBe(2);
      for (const [captured, hint] of hubCapture.mock.calls) {
        expect(captured === observedError).toBe(true);
        expect(
          Reflect.get(hint as object, "originalException") === observedError,
        ).toBe(true);
        const syntheticException = Reflect.get(
          hint as object,
          "syntheticException",
        );
        assertNoCanaries(syntheticException);
        expect(syntheticException).toMatchObject({
          message: "Sentry syntheticException",
        });
      }
      expect(
        hubCapture.mock.calls[0]?.[1] === hubCapture.mock.calls[1]?.[1],
      ).toBe(false);
      expect(isolatedHub.getClient()).toBeUndefined();
    } finally {
      try {
        transport?.destroy();
      } finally {
        makeMain(previousHub);
      }
    }
    expect(getCurrentHub() === previousHub).toBe(true);
    expectNoObservedSideEffects(tripwires);
  });
});

describe("Caravan public privacy boundary", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
  });

  afterEach(() => {
    resetRuntimeLeaseForTesting();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("normalizes a canary-rich vendor failure into finite public error and events", async () => {
    const tripwires = installSideEffectTripwires();
    stubNavigator(
      {
        addEventListener: vi.fn(),
        getDevices: vi.fn(() => Promise.resolve([])),
        requestDevice: vi.fn(() => Promise.resolve([])),
      },
      tripwires.sendBeacon,
    );
    const rawError = createRawCanaryError();
    const vendorError = new NoAccessibleDeviceError(rawError);
    const fake = new ScriptedDmk(systemClock).queueDiscovery([
      { type: "error", error: vendorError },
    ]);
    const installer = createBitcoinAppInstallerCore({
      clock: systemClock,
      createHidPort: () => new SequencedHidPort([[]]),
      createPort: () => fake,
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });
    const events: BitcoinInstallerEvent[] = [];
    installer.subscribe((event) => events.push(event));

    try {
      const publicError = await installer.prepare().catch((error) => error);

      assertNoCanaries({ error: publicError, events });
      expect(publicError).toMatchObject({
        code: "no-device-selected",
        message: "No usable device was selected.",
        name: "BitcoinInstallerError",
        phase: "selecting-device",
        recoverable: true,
      });
      expect(events).toEqual([
        { phase: "selecting-device", interaction: "select-device" },
        { phase: "failed" },
      ]);
    } finally {
      await installer.dispose();
    }
    expectNoObservedSideEffects(tripwires);
  });

  it("does not expose internal identifiers, HID metadata, or raw open errors in a result", async () => {
    const tripwires = installSideEffectTripwires();
    stubNavigator(
      {
        addEventListener: vi.fn(),
        getDevices: vi.fn(() => Promise.resolve([])),
        requestDevice: vi.fn(() => Promise.resolve([])),
      },
      tripwires.sendBeacon,
    );

    const discoveredDevice: DmkDiscoveredDevice = Object.freeze({
      internalDeviceId: CANARIES.deviceId,
    });
    const session: DmkSession = Object.freeze({
      internalSessionId: CANARIES.sessionId,
      modelId: "nanoS",
    });
    const rawOpenError = Object.assign(createRawCanaryError(), {
      _tag: "ActionRefusedError",
    });
    const fake = new ScriptedDmk(systemClock)
      .queueDiscovery([{ type: "next", value: discoveredDevice }])
      .queueConnect({ type: "resolve", value: session })
      .queueSessionLifecycle([{ type: "never" }])
      .queueAction("genuine", [
        {
          type: "next",
          value: {
            status: "pending",
            interaction: CANARIES.nestedCause,
          } as never,
        },
        {
          type: "next",
          value: { status: "completed", output: { isGenuine: true } },
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
          value: { status: "error", rawError: rawOpenError },
        },
      ]);

    const identity = Object.freeze({
      serialNumber: CANARIES.hidSerial,
    }) as unknown as HidDeviceIdentity;
    const snapshot = (opened: boolean): HidDeviceSnapshot =>
      Object.freeze({
        identity,
        opened,
        productId: 0x1000,
        vendorId: LEDGER_HID_VENDOR_ID,
      });
    const hidPort = new SequencedHidPort([
      [snapshot(false)],
      [snapshot(true)],
      [snapshot(true)],
      [snapshot(false)],
    ]);
    const installer = createBitcoinAppInstallerCore({
      clock: systemClock,
      createHidPort: () => hidPort,
      createPort: () => fake,
      getSupport: () => ({ supported: true }),
      modelPolicy: candidatePolicy,
    });
    const events: BitcoinInstallerEvent[] = [];
    installer.subscribe((event) => events.push(event));

    try {
      const plan = await installer.prepare();
      const result = await installer.install(plan);

      assertNoCanaries({ events, plan, result });
      expect(plan).toEqual({ status: "already-installed" });
      expect(result).toEqual({
        appOpen: false,
        handoff: "ready",
        status: "already-installed",
      });
      expect(events.at(-1)).toEqual({ phase: "ready-for-webusb" });
    } finally {
      await installer.dispose();
    }
    expectNoObservedSideEffects(tripwires);
  });
});
