import {
  DeviceManagementKitBuilder,
  type DeviceManagementKit,
} from "@ledgerhq/device-management-kit";
import { webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";

import {
  assertValidInternalDmkServiceConfig,
  type InternalDmkServiceConfig,
  sameInternalDmkServiceConfig,
  UNAPPROVED_PRODUCTION_DMK_CONFIG,
} from "./constants";

export type DmkRuntimeFactory = (
  config: InternalDmkServiceConfig,
) => DeviceManagementKit;

interface CachedDmkRuntime {
  readonly config: InternalDmkServiceConfig;
  readonly runtime: DeviceManagementKit;
}

let cachedRuntime: CachedDmkRuntime | undefined;
let runtimeConstructionInProgress = false;

export function buildOfficialDmkRuntime(
  config: InternalDmkServiceConfig,
): DeviceManagementKit {
  assertValidInternalDmkServiceConfig(config);

  return new DeviceManagementKitBuilder()
    .addTransport(webHidTransportFactory)
    .addConfig({
      managerApiUrl: config.managerApiUrl,
      webSocketUrl: config.webSocketUrl,
      provider: config.provider,
    })
    .build();
}

/** Acquire the single DMK instance cached for this JavaScript realm. */
export function acquireDmkRuntime(
  config: InternalDmkServiceConfig = UNAPPROVED_PRODUCTION_DMK_CONFIG,
  factory: DmkRuntimeFactory = buildOfficialDmkRuntime,
): DeviceManagementKit {
  assertValidInternalDmkServiceConfig(config);

  if (cachedRuntime) {
    if (!sameInternalDmkServiceConfig(cachedRuntime.config, config)) {
      throw new Error(
        "A Ledger DMK runtime already exists with different internal configuration.",
      );
    }
    return cachedRuntime.runtime;
  }

  if (runtimeConstructionInProgress) {
    throw new Error("Ledger DMK runtime construction is already in progress.");
  }

  const configSnapshot: InternalDmkServiceConfig = Object.freeze({ ...config });
  runtimeConstructionInProgress = true;
  try {
    const runtime = factory(configSnapshot);
    cachedRuntime = Object.freeze({
      config: configSnapshot,
      runtime,
    });
    return runtime;
  } finally {
    runtimeConstructionInProgress = false;
  }
}

/** Source-only reset for isolated tests; it never closes a live runtime. */
export function resetDmkRuntimeForTesting(): void {
  cachedRuntime = undefined;
  runtimeConstructionInProgress = false;
}
