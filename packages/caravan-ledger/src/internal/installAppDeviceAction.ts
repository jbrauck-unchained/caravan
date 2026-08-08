import { InstallAppDeviceAction } from "@ledgerhq/device-management-kit";
import { throwError } from "rxjs";

import {
  BITCOIN_APP_NAME,
  REVIEWED_INSTALL_UNLOCK_TIMEOUT_MS,
} from "./constants";

type InstallActionInternalApi = Parameters<
  InstallAppDeviceAction["extractDependencies"]
>[0];
type InstallActionDependencies = ReturnType<
  InstallAppDeviceAction["extractDependencies"]
>;
type InstallDependencyInput = Parameters<
  InstallActionDependencies["installApp"]
>[0];

const missingOwnData = Symbol("missing-own-data");

const verificationRequiredErrors = new WeakSet<object>();

class InvalidBitcoinInstallTargetError extends Error {
  readonly name = "InvalidBitcoinInstallTargetError" as const;

  constructor() {
    super("The Ledger install target is invalid.");
  }
}

class BitcoinInstallAlreadyAttemptedError extends Error {
  readonly name = "BitcoinInstallAlreadyAttemptedError" as const;

  constructor() {
    super("The Ledger install action may only attempt mutation once.");
    verificationRequiredErrors.add(this);
  }
}

/**
 * Recognize only the exact package-created blocker object. Vendor-controlled
 * tags, names, messages, and prototypes cannot manufacture this settlement.
 */
export function isBitcoinInstallVerificationRequiredError(
  value: unknown,
): boolean {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  )
    ? verificationRequiredErrors.has(value)
    : false;
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
  if (input === missingOwnData) return false;

  const app = readOwnData(input, "app");
  if (app === missingOwnData) return false;

  return readOwnData(app, "versionName") === BITCOIN_APP_NAME;
}

/**
 * Private specialization of the pinned root-exported install action.
 *
 * The SDK performs read-only preparation before it invokes `installApp`.
 * Overriding the public dependency seam places the mutation marker at the
 * closest package-owned instant to the first secure-channel install attempt.
 */
export class BitcoinOnlyInstallAppDeviceAction extends InstallAppDeviceAction {
  #mutationAttempted = false;

  constructor() {
    super({
      input: {
        appName: BITCOIN_APP_NAME,
        unlockTimeout: REVIEWED_INSTALL_UNLOCK_TIMEOUT_MS,
      },
    });
  }

  mutationAttempted(): boolean {
    return this.#mutationAttempted;
  }

  override extractDependencies(
    internalApi: InstallActionInternalApi,
  ): InstallActionDependencies {
    const dependencies = super.extractDependencies(internalApi);
    const delegatedInstall = dependencies.installApp;

    return {
      ...dependencies,
      installApp: (input: InstallDependencyInput) => {
        if (this.#mutationAttempted) {
          return throwError(() => new BitcoinInstallAlreadyAttemptedError());
        }
        if (!hasExactBitcoinTarget(input)) {
          return throwError(() => new InvalidBitcoinInstallTargetError());
        }

        // This assignment is deliberately the final package-owned operation
        // before delegation. It is idempotent, synchronous, and nonthrowing.
        this.#mutationAttempted = true;
        return delegatedInstall(input);
      },
    };
  }
}
