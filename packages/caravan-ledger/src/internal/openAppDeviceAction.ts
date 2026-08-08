import { OpenAppDeviceAction } from "@ledgerhq/device-management-kit";

import {
  BITCOIN_APP_NAME,
  REVIEWED_READ_ONLY_UNLOCK_TIMEOUT_MS,
} from "./constants";

type OpenActionInternalApi = Parameters<
  OpenAppDeviceAction["extractDependencies"]
>[0];
type OpenActionDependencies = ReturnType<
  OpenAppDeviceAction["extractDependencies"]
>;
type OpenDependencyInput = Parameters<OpenActionDependencies["openApp"]>[0];

const missingOwnData = Symbol("missing-own-data");

class InvalidBitcoinOpenTargetError extends Error {
  readonly name = "InvalidBitcoinOpenTargetError" as const;

  constructor() {
    super("The Ledger open target is invalid.");
  }
}

function readOwnData(
  value: unknown,
  key: PropertyKey,
): unknown | typeof missingOwnData {
  if (typeof value !== "object" || value === null) return missingOwnData;

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor
      ? descriptor.value
      : missingOwnData;
  } catch {
    return missingOwnData;
  }
}

function hasExactBitcoinTarget(value: unknown): boolean {
  const input = readOwnData(value, "input");
  return (
    input !== missingOwnData &&
    readOwnData(input, "appName") === BITCOIN_APP_NAME
  );
}

/** The pinned OpenApp action has exactly one reviewed success value: void. */
export function isExactBitcoinOpenOutput(value: unknown): value is undefined {
  return value === undefined;
}

/** Private specialization of the pinned root-exported open action. */
export class BitcoinOnlyOpenAppDeviceAction extends OpenAppDeviceAction {
  constructor() {
    super({
      input: Object.freeze({
        appName: BITCOIN_APP_NAME,
        unlockTimeout: REVIEWED_READ_ONLY_UNLOCK_TIMEOUT_MS,
      }),
    });
  }

  override extractDependencies(
    internalApi: OpenActionInternalApi,
  ): OpenActionDependencies {
    const dependencies = super.extractDependencies(internalApi);
    const delegatedOpen = dependencies.openApp;

    return {
      ...dependencies,
      openApp: (input: OpenDependencyInput) => {
        if (!hasExactBitcoinTarget(input)) {
          return Promise.reject(new InvalidBitcoinOpenTargetError());
        }
        return delegatedOpen(input);
      },
    };
  }
}
