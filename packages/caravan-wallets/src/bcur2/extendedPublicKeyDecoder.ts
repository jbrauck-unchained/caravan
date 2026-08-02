import {
  BitcoinNetwork,
  ExtendedPublicKey,
  EXTENDED_PUBLIC_KEY_VERSIONS,
  fingerprintToFixedLengthHex,
  Network,
  validatePublicKey,
} from "@caravan/bitcoin";
import { Bytes } from "@keystonehq/bc-ur-registry";

import { ColdcardExportExtendedPublicKey } from "../coldcard";

import { BCUR2Decoder, ExtendedPublicKeyData } from "./decoder";
import { bip32SerializationNetwork } from "./utils";

const PASSPORT_MULTISIG_PATH = "m/45'";
const PASSPORT_MULTISIG_INDEX = 0x8000002d;
const FINGERPRINT_PATTERN = /^[0-9a-f]{8}$/i;

export const PASSPORT_MULTISIG_EXPORT_ERROR =
  "The BC-UR bytes payload is not a compatible Passport multisig key export.";

export interface BCUR2ExtendedPublicKeyDecoderOptions {
  network?: BitcoinNetwork;
}

type PassportMultisigExport = Record<string, unknown> & {
  p2sh_deriv: typeof PASSPORT_MULTISIG_PATH;
  p2sh: string;
  p2wsh_deriv: string;
  p2wsh: string;
  xfp: string;
};

function hasStringPair(
  data: Record<string, unknown>,
  derivationField: string,
  keyField: string,
): boolean {
  return (
    typeof data[derivationField] === "string" &&
    Boolean(data[derivationField]) &&
    typeof data[keyField] === "string" &&
    Boolean(data[keyField])
  );
}

function isPassportMultisigExport(
  value: unknown,
): value is PassportMultisigExport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const data = value as Record<string, unknown>;
  const hasWrappedSegwitKey =
    hasStringPair(data, "p2sh_p2wsh_deriv", "p2sh_p2wsh") ||
    hasStringPair(data, "p2wsh_p2sh_deriv", "p2wsh_p2sh");

  return (
    data.p2sh_deriv === PASSPORT_MULTISIG_PATH &&
    typeof data.p2sh === "string" &&
    hasStringPair(data, "p2wsh_deriv", "p2wsh") &&
    hasWrappedSegwitKey &&
    typeof data.xfp === "string" &&
    FINGERPRINT_PATTERN.test(data.xfp)
  );
}

/**
 * Decodes extended public keys from standard BC-UR registry items and from
 * Passport's Coldcard-compatible multisig JSON wrapped in `ur:bytes`.
 * Generic BC-UR decoding intentionally continues to reject `bytes`.
 */
export class BCUR2ExtendedPublicKeyDecoder extends BCUR2Decoder {
  private readonly network: BitcoinNetwork;

  private keyError: string | null = null;

  constructor({
    network = Network.MAINNET,
  }: BCUR2ExtendedPublicKeyDecoderOptions = {}) {
    super();
    this.network = network;
  }

  getError(): string | null {
    return this.keyError || super.getError();
  }

  private decodePassportBytes(
    cbor: Uint8Array,
    network: BitcoinNetwork,
  ): ExtendedPublicKeyData {
    const bytes = Bytes.fromCBOR(Buffer.from(cbor)).getData();

    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch (_error) {
      throw new Error(PASSPORT_MULTISIG_EXPORT_ERROR);
    }

    if (!isPassportMultisigExport(value)) {
      throw new Error(PASSPORT_MULTISIG_EXPORT_ERROR);
    }

    const serializationNetwork = bip32SerializationNetwork(network);
    const expectedVersion =
      serializationNetwork === Network.MAINNET
        ? EXTENDED_PUBLIC_KEY_VERSIONS.xpub
        : EXTENDED_PUBLIC_KEY_VERSIONS.tpub;

    let key: ExtendedPublicKey;
    try {
      key = ExtendedPublicKey.fromBase58(value.p2sh);
    } catch (_error) {
      throw new Error(PASSPORT_MULTISIG_EXPORT_ERROR);
    }

    if (
      key.version !== expectedVersion ||
      validatePublicKey(key.pubkey) ||
      key.depth !== 1 ||
      key.index !== PASSPORT_MULTISIG_INDEX ||
      typeof key.parentFingerprint !== "number" ||
      fingerprintToFixedLengthHex(key.parentFingerprint).toLowerCase() !==
        value.xfp.toLowerCase()
    ) {
      throw new Error(PASSPORT_MULTISIG_EXPORT_ERROR);
    }

    const parsed = new ColdcardExportExtendedPublicKey({
      network: serializationNetwork,
      bip32Path: PASSPORT_MULTISIG_PATH,
    }).parse(value);

    return {
      type: "bytes",
      xpub: parsed.xpub,
      rootFingerprint: parsed.rootFingerprint,
      bip32Path: parsed.bip32Path.replace(/^m\//, ""),
    };
  }

  getDecodedData(
    network: BitcoinNetwork = this.network,
  ): ExtendedPublicKeyData | null {
    if (!this.decoder.isComplete()) return null;

    try {
      const result = this.decoder.resultUR();

      if (result.type === "bytes") {
        return this.decodePassportBytes(result.cbor, network);
      }
      if (result.type === "crypto-psbt") {
        throw new Error("QR code contains a PSBT, not an extended public key.");
      }

      const decoded = super.getDecodedData(bip32SerializationNetwork(network));
      return typeof decoded === "string" ? null : decoded;
    } catch (error: unknown) {
      this.keyError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
}
