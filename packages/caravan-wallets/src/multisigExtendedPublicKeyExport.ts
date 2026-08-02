import { ensureXpubAtPath } from "@caravan/bip32";
import {
  bip32SerializationNetwork,
  BitcoinNetwork,
  ExtendedPublicKey,
  EXTENDED_PUBLIC_KEY_VERSIONS,
  fingerprintToFixedLengthHex,
  KeyPrefix,
  MultisigAddressType,
  P2SH,
  P2SH_P2WSH,
  P2WSH,
  validateBIP32Path,
  validatePublicKey,
} from "@caravan/bitcoin";

/**
 * Known source paths and field names used by multisig extended-public-key
 * exports compatible with the Coldcard/Sparrow JSON format.
 */
export const MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_BIP32_PATHS =
  Object.freeze({
    "m/45'": P2SH,
    "m/48'/0'/0'/1'": P2SH_P2WSH.replace("-", "_"),
    "m/48'/0'/0'/2'": P2WSH,
    "m/48'/1'/0'/1'": P2SH_P2WSH.replace("-", "_"),
    "m/48'/1'/0'/2'": P2WSH,
  } as const satisfies Record<string, MultisigAddressType | string>);

export const MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_CHROOTS: readonly string[] =
  Object.freeze(
    Object.keys(MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_BIP32_PATHS)
  );

const ROOT_FINGERPRINT_PATTERN = /^[0-9a-f]{8}$/i;

export interface ParseMultisigExtendedPublicKeyExportOptions {
  network: BitcoinNetwork;
  bip32Path: string;
}

export interface MultisigExtendedPublicKeyExportData {
  xpub: string;
  rootFingerprint: string;
  bip32Path: string;
}

export class MissingMultisigExtendedPublicKeyExportParametersError extends Error {
  constructor() {
    super(
      "Missing required parameters in multisig extended public key export."
    );
    this.name = "MissingMultisigExtendedPublicKeyExportParametersError";
  }
}

export class UnsupportedMultisigExtendedPublicKeyExportPathError extends Error {
  constructor(bip32Path: string) {
    super(`Unable to determine multisig script type from ${bip32Path}`);
    this.name = "UnsupportedMultisigExtendedPublicKeyExportPathError";
  }
}

export class InvalidMultisigExtendedPublicKeyExportError extends Error {
  constructor() {
    super("Multisig extended public key export must be a JSON object.");
    this.name = "InvalidMultisigExtendedPublicKeyExportError";
  }
}

/**
 * Returns the known source path that contains the requested BIP32 path.
 */
export function multisigExtendedPublicKeyExportChroot(
  bip32Path: string
): string | null {
  for (
    let i = 0;
    i < MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_CHROOTS.length;
    i++
  ) {
    const chroot = MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_CHROOTS[i];
    if (bip32Path === chroot || bip32Path.startsWith(`${chroot}/`)) {
      return chroot;
    }
  }
  return null;
}

function parseExportInput(
  input: Record<string, unknown> | string
): Record<string, unknown> {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (_error) {
      throw new Error("Unable to parse JSON.");
    }
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidMultisigExtendedPublicKeyExportError();
  }

  return parsed as Record<string, unknown>;
}

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Reflect.apply(Object.prototype.hasOwnProperty, data, [key]);
}

function hasOwnNonEmptyString(
  data: Record<string, unknown>,
  key: string
): boolean {
  if (!hasOwn(data, key)) return false;
  const value = data[key];
  return typeof value === "string" && value.length > 0;
}

function hasCompleteFieldPair(
  data: Record<string, unknown>,
  derivationField: string,
  keyField: string
): boolean {
  return (
    hasOwnNonEmptyString(data, derivationField) &&
    hasOwnNonEmptyString(data, keyField)
  );
}

function validateRequiredFields(data: Record<string, unknown>): void {
  // Wrapped SegWit field names changed between firmware versions. At least
  // one complete naming pair must be present, while both remain accepted.
  if (
    !hasOwnNonEmptyString(data, "p2sh_deriv") ||
    !hasOwnNonEmptyString(data, "p2sh") ||
    !hasOwnNonEmptyString(data, "p2wsh_deriv") ||
    !hasOwnNonEmptyString(data, "p2wsh") ||
    (!hasCompleteFieldPair(data, "p2wsh_p2sh_deriv", "p2wsh_p2sh") &&
      !hasCompleteFieldPair(data, "p2sh_p2wsh_deriv", "p2sh_p2wsh"))
  ) {
    throw new MissingMultisigExtendedPublicKeyExportParametersError();
  }
}

function parsePublicExtendedKey(value: unknown): ExtendedPublicKey {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Invalid extended public key in multisig export.");
  }

  const prefix = value.slice(0, 4) as KeyPrefix;
  if (
    !Reflect.apply(
      Object.prototype.hasOwnProperty,
      EXTENDED_PUBLIC_KEY_VERSIONS,
      [prefix]
    )
  ) {
    throw new Error("Invalid extended public key in multisig export.");
  }

  try {
    const extendedPublicKey = ExtendedPublicKey.fromBase58(value);
    if (
      extendedPublicKey.version !== EXTENDED_PUBLIC_KEY_VERSIONS[prefix] ||
      extendedPublicKey.toBase58() !== value.trim() ||
      validatePublicKey(extendedPublicKey.pubkey).length > 0
    ) {
      throw new Error("Invalid extended public key in multisig export.");
    }
    return extendedPublicKey;
  } catch (_error) {
    throw new Error("Invalid extended public key in multisig export.");
  }
}

function rootFingerprintFromExport(data: Record<string, unknown>): string {
  const xpubClass = parsePublicExtendedKey(data.p2sh);
  let suppliedFingerprint: string | null = null;
  if (hasOwn(data, "xfp")) {
    if (
      typeof data.xfp !== "string" ||
      !ROOT_FINGERPRINT_PATTERN.test(data.xfp)
    ) {
      throw new Error("Invalid root fingerprint in multisig export.");
    }
    suppliedFingerprint = data.xfp;
  }
  if (!suppliedFingerprint && xpubClass.depth !== 1) {
    throw new Error("No xfp in JSON file.");
  }

  // A depth-one xpub contains the root key's fingerprint as its parent
  // fingerprint, so exports may omit the separate xfp field in that case.
  const xfpFromWithinXpub =
    xpubClass.depth === 1 && typeof xpubClass.parentFingerprint === "number"
      ? fingerprintToFixedLengthHex(xpubClass.parentFingerprint)
      : null;

  if (
    xfpFromWithinXpub &&
    suppliedFingerprint &&
    xfpFromWithinXpub !== suppliedFingerprint.toLowerCase()
  ) {
    throw new Error("Computed fingerprint does not match the one in the file.");
  }

  const rootFingerprint = suppliedFingerprint || xfpFromWithinXpub;
  return (rootFingerprint as string).toLowerCase();
}

function sourceXpubForPath(
  data: Record<string, unknown>,
  bip32Path: string
): { xpub: string; bip32Path: string } {
  const chroot = multisigExtendedPublicKeyExportChroot(bip32Path);
  if (!chroot) {
    throw new UnsupportedMultisigExtendedPublicKeyExportPathError(bip32Path);
  }

  let addressType =
    MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_BIP32_PATHS[
      chroot as keyof typeof MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_BIP32_PATHS
    ];

  // Older firmware used p2wsh_p2sh instead of p2sh_p2wsh.
  if (
    addressType.includes("_") &&
    !hasOwnNonEmptyString(data, addressType.toLowerCase())
  ) {
    addressType = "p2wsh_p2sh";
  }

  return {
    xpub: hasOwn(data, addressType.toLowerCase())
      ? (data[addressType.toLowerCase()] as string)
      : "",
    bip32Path: chroot,
  };
}

/**
 * Parse a Coldcard/Sparrow-compatible multisig extended-public-key export.
 *
 * This function intentionally preserves the format's historical field-name
 * aliases and derives only from a known exported source path to an unhardened
 * descendant requested by the caller.
 */
export function parseMultisigExtendedPublicKeyExport(
  input: Record<string, unknown> | string,
  { network, bip32Path }: ParseMultisigExtendedPublicKeyExportOptions
): MultisigExtendedPublicKeyExportData {
  // Validate the application network explicitly. The original chain identity
  // is retained for derivation; this helper only confirms its BIP32 family.
  bip32SerializationNetwork(network);
  if (validateBIP32Path(bip32Path)) {
    throw new UnsupportedMultisigExtendedPublicKeyExportPathError(bip32Path);
  }

  const data = parseExportInput(input);
  if (Object.keys(data).length === 0) {
    throw new Error("Empty JSON file.");
  }

  validateRequiredFields(data);

  const rootFingerprint = rootFingerprintFromExport(data);
  const source = sourceXpubForPath(data, bip32Path);
  parsePublicExtendedKey(source.xpub);
  const xpub = ensureXpubAtPath(source, bip32Path, network);
  parsePublicExtendedKey(xpub);

  return { xpub, rootFingerprint, bip32Path };
}
