import {
  bip32SerializationNetwork,
  BitcoinNetwork,
  ExtendedPublicKey,
  EXTENDED_PUBLIC_KEY_VERSIONS,
  fingerprintToFixedLengthHex,
  Network,
  validateExtendedPublicKey,
  validatePublicKey,
} from "@caravan/bitcoin";
import { Bytes, URRegistryDecoder } from "@keystonehq/bc-ur-registry";

import { parseMultisigExtendedPublicKeyExport } from "../multisigExtendedPublicKeyExport";

import {
  BCUR2Decoder,
  BCUR2RegistryDecoder,
  ExtendedPublicKeyData,
} from "./decoder";
import { processCryptoAccountCBOR, processCryptoHDKeyCBOR } from "./utils";

const PASSPORT_MULTISIG_PATH = "m/45'";
const PASSPORT_MULTISIG_INDEX = 0x8000002d;
const FINGERPRINT_PATTERN = /^[0-9a-f]{8}$/i;
// A definite-length CBOR byte string uses at most a one-byte marker plus an
// eight-byte length, independently of the inner payload size.
const BYTES_CBOR_ENVELOPE_ALLOWANCE = 9;

export const DEFAULT_BCUR2_XPUB_MAX_PAYLOAD_BYTES = 64 * 1024;

export const PASSPORT_MULTISIG_EXPORT_ERROR =
  "The BC-UR bytes payload is not a compatible Passport multisig key export.";

export interface BCUR2ExtendedPublicKeyDecoderOptions {
  network?: BitcoinNetwork;
  /**
   * Maximum decoded inner bytes. After fountain assembly, raw bytes-CBOR is
   * separately capped at this value plus its nine-byte envelope allowance.
   * Scanners must still bound fragment size, accepted frame count, and scan
   * duration before assembly completes.
   */
  maxPayloadBytes?: number;
}

export type BCUR2RegistryDecoderFactory = () => BCUR2RegistryDecoder;

type PassportMultisigExport = Record<string, unknown> & {
  p2sh_deriv: typeof PASSPORT_MULTISIG_PATH;
  p2sh: string;
  p2wsh_deriv: string;
  p2wsh: string;
  xfp: string;
};

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCompleteFieldPair(
  data: Record<string, unknown>,
  derivationField: string,
  keyField: string
): boolean {
  return (
    hasOwnNonEmptyString(data, derivationField) &&
    hasOwnNonEmptyString(data, keyField)
  );
}

function hasPartialFieldPair(
  data: Record<string, unknown>,
  derivationField: string,
  keyField: string
): boolean {
  const pairIsPresent = hasOwn(data, derivationField) || hasOwn(data, keyField);
  return pairIsPresent && !isCompleteFieldPair(data, derivationField, keyField);
}

function assertPassportSchema(value: unknown): PassportMultisigExport {
  if (!isPlainRecord(value)) throw new Error(PASSPORT_MULTISIG_EXPORT_ERROR);

  const historicalWrappedPair = isCompleteFieldPair(
    value,
    "p2wsh_p2sh_deriv",
    "p2wsh_p2sh"
  );
  const correctedWrappedPair = isCompleteFieldPair(
    value,
    "p2sh_p2wsh_deriv",
    "p2sh_p2wsh"
  );

  if (
    !hasOwn(value, "p2sh_deriv") ||
    value.p2sh_deriv !== PASSPORT_MULTISIG_PATH ||
    !hasOwnNonEmptyString(value, "p2sh") ||
    !hasOwnNonEmptyString(value, "p2wsh_deriv") ||
    !hasOwnNonEmptyString(value, "p2wsh") ||
    (!historicalWrappedPair && !correctedWrappedPair) ||
    hasPartialFieldPair(value, "p2wsh_p2sh_deriv", "p2wsh_p2sh") ||
    hasPartialFieldPair(value, "p2sh_p2wsh_deriv", "p2sh_p2wsh") ||
    !hasOwnNonEmptyString(value, "xfp") ||
    !FINGERPRINT_PATTERN.test(value.xfp as string)
  ) {
    throw new Error(PASSPORT_MULTISIG_EXPORT_ERROR);
  }

  return value as PassportMultisigExport;
}

function assertPassportSourceKey(
  data: PassportMultisigExport,
  network: BitcoinNetwork
): void {
  const serializationNetwork = bip32SerializationNetwork(network);
  const expectedPrefix =
    serializationNetwork === Network.MAINNET ? "xpub" : "tpub";

  if (data.p2sh.slice(0, 4) !== expectedPrefix) {
    throw new Error(
      `Passport extended public key does not match the ${serializationNetwork} serialization family.`
    );
  }

  if (validateExtendedPublicKey(data.p2sh, network)) {
    throw new Error("Passport export contains an invalid extended public key.");
  }

  let extendedPublicKey: ExtendedPublicKey;
  try {
    extendedPublicKey = ExtendedPublicKey.fromBase58(data.p2sh);
  } catch (_error) {
    throw new Error("Passport export contains an invalid extended public key.");
  }

  const expectedVersion =
    serializationNetwork === Network.MAINNET
      ? EXTENDED_PUBLIC_KEY_VERSIONS.xpub
      : EXTENDED_PUBLIC_KEY_VERSIONS.tpub;
  const publicKeyError = validatePublicKey(extendedPublicKey.pubkey);
  if (extendedPublicKey.version !== expectedVersion || publicKeyError) {
    throw new Error("Passport export contains an invalid extended public key.");
  }

  if (
    extendedPublicKey.depth !== 1 ||
    extendedPublicKey.index !== PASSPORT_MULTISIG_INDEX
  ) {
    throw new Error(
      `Passport extended public key does not match path ${PASSPORT_MULTISIG_PATH}.`
    );
  }

  if (typeof extendedPublicKey.parentFingerprint !== "number") {
    throw new Error("Passport extended public key has no parent fingerprint.");
  }

  const embeddedFingerprint = fingerprintToFixedLengthHex(
    extendedPublicKey.parentFingerprint
  );
  if (embeddedFingerprint.toLowerCase() !== data.xfp.toLowerCase()) {
    throw new Error("Computed fingerprint does not match the one in the file.");
  }
}

/**
 * Decodes extended public keys from standard BC-UR key registry items and
 * Passport's deployed Coldcard-compatible JSON wrapped in `ur:bytes`.
 *
 * `ur:bytes` remains unsupported by the generic decoder. This class accepts it
 * only after validating the Passport envelope, schema, network, path and key.
 */
export class BCUR2ExtendedPublicKeyDecoder {
  private registryDecoder!: BCUR2RegistryDecoder;

  private transportDecoder!: BCUR2Decoder;

  private readonly registryDecoderFactory: BCUR2RegistryDecoderFactory;

  readonly network: BitcoinNetwork;

  private readonly maxPayloadBytes: number;

  private error: string | null = null;

  private decodeAttempted = false;

  private decodedData: ExtendedPublicKeyData | null = null;

  constructor(
    {
      network = Network.MAINNET,
      maxPayloadBytes = DEFAULT_BCUR2_XPUB_MAX_PAYLOAD_BYTES,
    }: BCUR2ExtendedPublicKeyDecoderOptions = {},
    registryDecoderFactory: BCUR2RegistryDecoderFactory = () =>
      new URRegistryDecoder()
  ) {
    bip32SerializationNetwork(network);
    if (
      !Number.isSafeInteger(maxPayloadBytes) ||
      maxPayloadBytes <= 0 ||
      maxPayloadBytes > Number.MAX_SAFE_INTEGER - BYTES_CBOR_ENVELOPE_ALLOWANCE
    ) {
      throw new Error("maxPayloadBytes must be a positive safe integer.");
    }

    this.network = network;
    this.maxPayloadBytes = maxPayloadBytes;
    this.registryDecoderFactory = registryDecoderFactory;
    this.initializeTransport();
  }

  private initializeTransport(): void {
    this.registryDecoder = this.registryDecoderFactory();
    this.transportDecoder = new BCUR2Decoder(this.registryDecoder);
  }

  receivePart(text: string): void {
    if (this.decodeAttempted || this.getError()) return;
    this.transportDecoder.receivePart(text);
  }

  reset(): void {
    this.error = null;
    this.decodeAttempted = false;
    this.decodedData = null;
    this.initializeTransport();
  }

  isComplete(): boolean {
    return this.transportDecoder.isComplete();
  }

  percentComplete(): number {
    return this.transportDecoder.percentComplete();
  }

  getProgress(): string {
    return this.transportDecoder.getProgress();
  }

  getError(): string | null {
    return this.error || this.transportDecoder.getError();
  }

  private decodePassportBytes(cborView: Uint8Array): ExtendedPublicKeyData {
    if (
      cborView.byteLength >
      this.maxPayloadBytes + BYTES_CBOR_ENVELOPE_ALLOWANCE
    ) {
      throw new Error(
        `BC-UR payload exceeds the ${this.maxPayloadBytes}-byte limit.`
      );
    }

    let bytes: Buffer;
    try {
      bytes = Bytes.fromCBOR(Buffer.from(cborView)).getData();
    } catch (_error) {
      throw new Error("BC-UR bytes payload contains invalid CBOR.");
    }

    if (bytes.byteLength > this.maxPayloadBytes) {
      throw new Error(
        `BC-UR payload exceeds the ${this.maxPayloadBytes}-byte limit.`
      );
    }

    let json: string;
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_error) {
      throw new Error("Passport key export contains invalid UTF-8.");
    }

    let parsedJSON: unknown;
    try {
      parsedJSON = JSON.parse(json);
    } catch (_error) {
      throw new Error("Passport key export is not valid JSON.");
    }

    const passportExport = assertPassportSchema(parsedJSON);
    assertPassportSourceKey(passportExport, this.network);

    const parsed = parseMultisigExtendedPublicKeyExport(passportExport, {
      network: this.network,
      bip32Path: PASSPORT_MULTISIG_PATH,
    });

    return {
      type: "bytes",
      xpub: parsed.xpub,
      rootFingerprint: parsed.rootFingerprint,
      bip32Path: parsed.bip32Path.replace(/^m\//, ""),
    };
  }

  getDecodedData(
    requestedNetwork: BitcoinNetwork = this.network
  ): ExtendedPublicKeyData | null {
    if (this.decodeAttempted) return this.decodedData;
    if (!this.registryDecoder.isComplete()) return null;
    if (requestedNetwork !== this.network) {
      this.decodeAttempted = true;
      this.decodedData = null;
      this.error = `BC-UR decoder network ${this.network} does not match requested network ${requestedNetwork}.`;
      return null;
    }

    this.decodeAttempted = true;
    try {
      const result = this.registryDecoder.resultUR();

      switch (result.type) {
        case "crypto-account":
          this.decodedData = processCryptoAccountCBOR(
            Buffer.from(result.cbor),
            this.network
          );
          break;
        case "crypto-hdkey":
          this.decodedData = processCryptoHDKeyCBOR(
            Buffer.from(result.cbor),
            this.network
          );
          break;
        case "bytes":
          this.decodedData = this.decodePassportBytes(result.cbor);
          break;
        case "crypto-psbt":
          throw new Error(
            "QR code contains a PSBT, not an extended public key."
          );
        default:
          throw new Error(
            `Unsupported UR type for extended public key: ${result.type}`
          );
      }

      return this.decodedData;
    } catch (error: unknown) {
      this.error = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
}
