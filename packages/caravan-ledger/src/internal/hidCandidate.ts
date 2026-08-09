import type {
  HidDeviceIdentity,
  HidDeviceSnapshot,
} from "./hidPort";
import { LEDGER_HID_VENDOR_ID } from "./hidPort";
import type { KnownLedgerModelId } from "./supportedModels";

export { LEDGER_HID_VENDOR_ID } from "./hidPort";

interface LedgerModelUsbIdentity {
  readonly applicationProductPrefix: number;
  readonly bootloaderProductId: number;
}

const LEDGER_MODEL_USB_IDENTITIES: Readonly<
  Record<KnownLedgerModelId, LedgerModelUsbIdentity>
> = Object.freeze({
  nanoS: Object.freeze({
    applicationProductPrefix: 0x10,
    bootloaderProductId: 0x0001,
  }),
  nanoSP: Object.freeze({
    applicationProductPrefix: 0x50,
    bootloaderProductId: 0x0005,
  }),
  nanoX: Object.freeze({
    applicationProductPrefix: 0x40,
    bootloaderProductId: 0x0004,
  }),
  stax: Object.freeze({
    applicationProductPrefix: 0x60,
    bootloaderProductId: 0x0006,
  }),
  flex: Object.freeze({
    applicationProductPrefix: 0x70,
    bootloaderProductId: 0x0007,
  }),
  apexp: Object.freeze({
    applicationProductPrefix: 0x80,
    bootloaderProductId: 0x0008,
  }),
});

export type HidReleaseCandidate =
  | {
      readonly kind: "unique";
      readonly identity: HidDeviceIdentity;
      readonly modelId: KnownLedgerModelId;
      readonly productId: number;
      readonly knownPeerIdentities: readonly HidDeviceIdentity[];
      readonly knownOpenPeerIdentities: readonly HidDeviceIdentity[];
    }
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "unavailable" };

export interface SelectHidReleaseCandidateOptions {
  /** Undefined means the pre-connect snapshot was unavailable. */
  readonly before: readonly HidDeviceSnapshot[] | undefined;
  /** Undefined means the post-connect snapshot was unavailable. */
  readonly after: readonly HidDeviceSnapshot[] | undefined;
  readonly modelId: string | undefined;
}

function isKnownLedgerModelId(value: string): value is KnownLedgerModelId {
  return Object.prototype.hasOwnProperty.call(LEDGER_MODEL_USB_IDENTITIES, value);
}

function isUsbIdentifier(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 0xffff
  );
}

function isObject(value: unknown): value is object {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  );
}

function validatedDevices(
  devices: readonly HidDeviceSnapshot[],
): readonly HidDeviceSnapshot[] | undefined {
  if (!Array.isArray(devices)) return undefined;

  const identities = new Set<HidDeviceIdentity>();
  const validated: HidDeviceSnapshot[] = [];
  try {
    for (let index = 0; index < devices.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(devices, index)) {
        return undefined;
      }
      const device: unknown = devices[index];
      if (!isObject(device)) return undefined;
      const candidateIdentity: unknown = Reflect.get(device, "identity");
      const vendorId: unknown = Reflect.get(device, "vendorId");
      const productId: unknown = Reflect.get(device, "productId");
      const opened: unknown = Reflect.get(device, "opened");
      if (
        !isObject(candidateIdentity) ||
        !isUsbIdentifier(vendorId) ||
        !isUsbIdentifier(productId) ||
        typeof opened !== "boolean"
      ) {
        return undefined;
      }
      const validatedIdentity = candidateIdentity as HidDeviceIdentity;
      if (identities.has(validatedIdentity)) return undefined;
      identities.add(validatedIdentity);
      validated.push(
        Object.freeze({
          identity: validatedIdentity,
          vendorId,
          productId,
          opened,
        }),
      );
    }
  } catch {
    return undefined;
  }
  return validated;
}

export function hidSnapshotMatchesModel(
  snapshot: HidDeviceSnapshot,
  modelId: KnownLedgerModelId,
): boolean {
  if (snapshot.vendorId !== LEDGER_HID_VENDOR_ID) return false;
  const identity = LEDGER_MODEL_USB_IDENTITIES[modelId];
  return (
    snapshot.productId === identity.bootloaderProductId ||
    snapshot.productId >>> 8 === identity.applicationProductPrefix
  );
}

function ledgerModelClassification(
  snapshot: HidDeviceSnapshot,
): KnownLedgerModelId | "unknown" {
  for (const modelId of Object.keys(
    LEDGER_MODEL_USB_IDENTITIES,
  ) as KnownLedgerModelId[]) {
    if (hidSnapshotMatchesModel(snapshot, modelId)) return modelId;
  }
  return "unknown";
}

function hasIdentityClassificationMutation(
  before: readonly HidDeviceSnapshot[],
  after: readonly HidDeviceSnapshot[],
): boolean {
  const beforeByIdentity = new Map<HidDeviceIdentity, HidDeviceSnapshot>();
  for (const device of before) beforeByIdentity.set(device.identity, device);

  for (const device of after) {
    const prior = beforeByIdentity.get(device.identity);
    if (!prior) continue;
    if (prior.vendorId !== device.vendorId) return true;
    if (prior.productId !== device.productId) return true;
    if (
      device.vendorId === LEDGER_HID_VENDOR_ID &&
      ledgerModelClassification(prior) !== ledgerModelClassification(device)
    ) {
      return true;
    }
  }
  return false;
}

function sameIdentity(
  left: HidDeviceIdentity,
  right: HidDeviceIdentity,
): boolean {
  return left === right;
}

function findByIdentity(
  devices: readonly HidDeviceSnapshot[],
  identity: HidDeviceIdentity,
): HidDeviceSnapshot | undefined {
  return devices.find((device) => sameIdentity(device.identity, identity));
}

function uniqueCandidate(
  candidate: HidDeviceSnapshot,
  matchingAfter: readonly HidDeviceSnapshot[],
  modelId: KnownLedgerModelId,
): HidReleaseCandidate {
  return Object.freeze({
    kind: "unique",
    identity: candidate.identity,
    modelId,
    productId: candidate.productId,
    knownPeerIdentities: Object.freeze(
      matchingAfter
        .filter((device) => !sameIdentity(device.identity, candidate.identity))
        .map((device) => device.identity),
    ),
    knownOpenPeerIdentities: Object.freeze(
      matchingAfter
        .filter(
          (device) =>
            device.opened &&
            !sameIdentity(device.identity, candidate.identity),
        )
        .map((device) => device.identity),
    ),
  });
}

/** Select at most one privately observable HID handle for the connected model. */
export function selectHidReleaseCandidate({
  before,
  after,
  modelId,
}: SelectHidReleaseCandidateOptions): HidReleaseCandidate {
  if (typeof modelId !== "string" || !isKnownLedgerModelId(modelId)) {
    return Object.freeze({ kind: "unavailable" });
  }
  if (!after) return Object.freeze({ kind: "unavailable" });

  const validatedAfter = validatedDevices(after);
  const validatedBefore =
    before === undefined ? undefined : validatedDevices(before);
  if (!validatedAfter || (before !== undefined && !validatedBefore)) {
    return Object.freeze({ kind: "unavailable" });
  }
  if (
    validatedBefore &&
    hasIdentityClassificationMutation(validatedBefore, validatedAfter)
  ) {
    return Object.freeze({ kind: "unavailable" });
  }

  const ledgerAfter = validatedAfter.filter(
    (device) => device.vendorId === LEDGER_HID_VENDOR_ID,
  );
  const ledgerBefore = validatedBefore?.filter(
    (device) => device.vendorId === LEDGER_HID_VENDOR_ID,
  );

  const matchingAfter = ledgerAfter.filter((device) =>
    hidSnapshotMatchesModel(device, modelId),
  );
  const matchingBefore =
    ledgerBefore?.filter((device) =>
      hidSnapshotMatchesModel(device, modelId),
    ) ?? undefined;
  const openedAfter = matchingAfter.filter((device) => device.opened);

  if (matchingBefore) {
    const transitions = openedAfter.filter((device) => {
      const prior = findByIdentity(matchingBefore, device.identity);
      return prior !== undefined && !prior.opened;
    });
    if (transitions.length === 1) {
      const otherOpenedEvidenceIsStable = openedAfter.every((device) => {
        if (sameIdentity(device.identity, transitions[0].identity)) return true;
        return findByIdentity(matchingBefore, device.identity)?.opened === true;
      });
      if (!otherOpenedEvidenceIsStable) {
        return Object.freeze({ kind: "ambiguous" });
      }
      return uniqueCandidate(transitions[0], matchingAfter, modelId);
    }
    if (transitions.length > 1) return Object.freeze({ kind: "ambiguous" });
  }

  if (openedAfter.length === 0) return Object.freeze({ kind: "none" });
  if (openedAfter.length > 1) return Object.freeze({ kind: "ambiguous" });

  const soleOpened = openedAfter[0];
  if (matchingBefore && matchingBefore.length > 0) {
    const prior = findByIdentity(matchingBefore, soleOpened.identity);
    if (!prior) {
      // Same-model evidence changed identity across the connection boundary.
      return Object.freeze({ kind: "ambiguous" });
    }
  }
  return uniqueCandidate(soleOpened, matchingAfter, modelId);
}

export function isKnownCandidateIdentity(
  candidate: Extract<HidReleaseCandidate, { readonly kind: "unique" }>,
  identity: HidDeviceIdentity,
): boolean {
  return (
    sameIdentity(candidate.identity, identity) ||
    candidate.knownPeerIdentities.some((peer) => sameIdentity(peer, identity))
  );
}

export function isKnownOpenPeerIdentity(
  candidate: Extract<HidReleaseCandidate, { readonly kind: "unique" }>,
  identity: HidDeviceIdentity,
): boolean {
  return candidate.knownOpenPeerIdentities.some((peer) =>
    sameIdentity(peer, identity),
  );
}
