import { ExtendedPublicKey, Network } from "@caravan/bitcoin";
import {
  Bytes,
  CryptoAccount,
  CryptoCoinInfo,
  CryptoCoinInfoNetwork,
  CryptoCoinInfoType,
  CryptoHDKey,
  CryptoKeypath,
  CryptoOutput,
  CryptoPSBT,
  PathComponent,
  RegistryItem,
  ScriptExpressions,
} from "@keystonehq/bc-ur-registry";

import { BCUR2Decoder, BCUR2RegistryDecoder } from "../decoder";
import {
  BCUR2ExtendedPublicKeyDecoder,
  PASSPORT_MULTISIG_EXPORT_ERROR,
} from "../extendedPublicKeyDecoder";

const PASSPORT_MULTISIG_EXPORT = {
  p2sh_deriv: "m/45'",
  p2sh: "tpubDA2HtQKGFGx9BPZQ3yemoxaH6tjBkKbwTc4mMqpvkvu2RSkmKgADtCVaCpV4iDhXnqb46iQ7PjMMVzU6MERq7tNoLJ8rEvaYSStJssFKfvb",
  p2sh_p2wsh_deriv: "m/48'/1'/0'/1'",
  p2sh_p2wsh:
    "Upub5SRh9Zozi9attVLrU2hezfntv3kUNwbeRa3zJr6aV1pnmEUtfgZnLszfFKJyULFMbEcogARAsKosJBgaN8AmotgvbVgJ78srDmj59wzuTP7",
  p2wsh_deriv: "m/48'/1'/0'/2'",
  p2wsh:
    "Vpub5mFxTEUurq8NoPJfC1T9dCYvSYrorqSRnWgCjbEBwZ2coBhBej9f3TK6tbz5m27sVn4TAY2KsbmN1k2oi2J2NcWJabKGSHdgXxJaJ4V8YMb",
  xfp: "EFA5D916",
};

// SeedSigner 0.8.7 vectors from tests/test_encodepsbtqr.py.
const SEEDSIGNER_MAINNET_CRYPTO_ACCOUNT = [
  "UR:CRYPTO-ACCOUNT/1-4/LPADAACSKPCYMOMNLGRYHDCKOEADCYSSMECPONAOLYTAADMETAADDLOXAXHDCLAOKSRLNLKPUEGYATHPMNSNIYMUECBY",
  "UR:CRYPTO-ACCOUNT/2-4/LPAOAACSKPCYMOMNLGRYHDCKKKGHZMLUZORPVDGUOTECSTTKTOLPCWPTNTLKZTTIZTBEAAHDCXVDTPMYRSTDMOPSCXFZ",
  "UR:CRYPTO-ACCOUNT/3-4/LPAXAACSKPCYMOMNLGRYHDCKSPZSBZSPGERLGDATUYNLPYBTGYIYYKBTWTAOSWKSVTSGCHBYDKYAVDAMTAADMONDGDFD",
  "UR:CRYPTO-ACCOUNT/4-4/LPAAAACSKPCYMOMNLGRYHDCKDYOTADLOCSDYYKADYKAEYKAOYKAOCYSSMECPONAXAAAYCYIOREKKJKAEAEAEWZWDMYON",
];

const SEEDSIGNER_TESTNET_CRYPTO_ACCOUNT = [
  "UR:CRYPTO-ACCOUNT/1-5/LPADAHCSKECYRTPEDKMOHDCFOEADCYSSMECPONAOLYTAADMETAADDLONAXHDCLAOKSRLNLKPUENSAHBTHS",
  "UR:CRYPTO-ACCOUNT/2-5/LPAOAHCSKECYRTPEDKMOHDCFGYATHPMNSNKKGHZMLUZORPVDGUOTECSTTKTOLPCWPTNTLKZTTIZTNDJSCF",
  "UR:CRYPTO-ACCOUNT/3-5/LPAXAHCSKECYRTPEDKMOHDCFZTBEAAHDCXVDTPMYRSTDSPZSBZSPGERLGDATUYNLPYBTGYIYYKBDFGWPKE",
  "UR:CRYPTO-ACCOUNT/4-5/LPAAAHCSKECYRTPEDKMOHDCFBTWTAOSWKSVTSGCHBYDKYAVDAHTAADEHOYAOADAMTAADDYOTADGYBKBWFE",
  "UR:CRYPTO-ACCOUNT/5-5/LPAHAHCSKECYRTPEDKMOHDCFLOCSDYYKADYKAEYKAOYKAOCYSSMECPONAXAAAYCYIOREKKJKAETODLFYWP",
];

const SEEDSIGNER_MAINNET_XPUB =
  "xpub6EJ7iJBupP4oedJMWXNLKbE2X7VJky8tFsCSA9De39GrzjtgbXL2xNR26CeNy7AJtajzrpzWrhGiukyGkyfzcd6BuonT5HjrKM3R4VqFnrb";

const SEEDSIGNER_TESTNET_XPUB =
  "tpubDEfkEY1bXf2FvRVCxiMRXWZPrEaxkMdwoVnjWhGnP42kk2ZPfkB86p5rLEjAVc7YgVGuUQWPPo6mbwTt9qXEW4YUyQXkkpQ5uJdppanC7rL";

function makeStandardHDKey(useInfo?: CryptoCoinInfo): CryptoHDKey {
  const origin = new CryptoKeypath(
    [new PathComponent({ index: 45, hardened: true })],
    Buffer.from("efa5d916", "hex"),
    1
  );

  return new CryptoHDKey({
    isMaster: false,
    key: Buffer.from(
      "039b9ba1ad522fa2c4fc550c23626c2fb352373e22fbb8d59b984d058affe97e18",
      "hex"
    ),
    chainCode: Buffer.from(
      "6ff1bd910b424c55d269864c9f9ee9e3a5b20b034999ba83cb17f5635f56077c",
      "hex"
    ),
    origin,
    parentFingerprint: Buffer.from("efa5d916", "hex"),
    useInfo,
  });
}

function makeStandardAccount(hdKey = makeStandardHDKey()): CryptoAccount {
  return new CryptoAccount(Buffer.from("efa5d916", "hex"), [
    new CryptoOutput([ScriptExpressions.SCRIPT_HASH], hdKey),
  ]);
}

function scanRegistryItem(
  item: RegistryItem,
  network = Network.TESTNET
): BCUR2ExtendedPublicKeyDecoder {
  const decoder = new BCUR2ExtendedPublicKeyDecoder({ network });
  item
    .toUREncoder(100)
    .encodeWhole()
    .forEach((fragment) => decoder.receivePart(fragment));
  return decoder;
}

function scanPassport(
  data: unknown,
  network = Network.TESTNET
): BCUR2ExtendedPublicKeyDecoder {
  return scanRegistryItem(
    new Bytes(Buffer.from(JSON.stringify(data), "utf8")),
    network
  );
}

function completeRegistryDecoder(
  type: string,
  cbor: Uint8Array
): BCUR2RegistryDecoder & { resultUR: ReturnType<typeof vi.fn> } {
  return {
    receivePart: vi.fn(),
    isComplete: vi.fn(() => true),
    getProgress: vi.fn(() => 1),
    resultUR: vi.fn(() => ({ type, cbor })),
  };
}

describe("BCUR2ExtendedPublicKeyDecoder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves standard crypto-hdkey and crypto-account source keys", () => {
    const hdKeyDecoder = scanRegistryItem(makeStandardHDKey());
    const accountDecoder = scanRegistryItem(makeStandardAccount());

    expect(hdKeyDecoder.getDecodedData()).toEqual({
      type: "crypto-hdkey",
      xpub: PASSPORT_MULTISIG_EXPORT.p2sh,
      rootFingerprint: "EFA5D916",
      bip32Path: "45'",
    });
    expect(accountDecoder.getDecodedData()).toEqual({
      type: "crypto-account",
      xpub: PASSPORT_MULTISIG_EXPORT.p2sh,
      rootFingerprint: "EFA5D916",
      bip32Path: "45'",
    });
  });

  it("serializes a standard mainnet source key as xpub", () => {
    const decoder = scanRegistryItem(makeStandardHDKey(), Network.MAINNET);

    expect(decoder.getDecodedData()).toMatchObject({
      type: "crypto-hdkey",
      xpub: expect.stringMatching(/^xpub/),
      rootFingerprint: "EFA5D916",
      bip32Path: "45'",
    });
    expect(decoder.getError()).toBeNull();
  });

  it.each([Network.TESTNET, Network.REGTEST, Network.SIGNET])(
    "uses tpub serialization for a standard key on %s",
    (network) => {
      const testnetUseInfo = new CryptoCoinInfo(
        CryptoCoinInfoType.bitcoin,
        CryptoCoinInfoNetwork.testnet
      );
      const decoder = scanRegistryItem(
        makeStandardAccount(makeStandardHDKey(testnetUseInfo)),
        network
      );

      expect(decoder.getDecodedData()?.xpub).toBe(
        PASSPORT_MULTISIG_EXPORT.p2sh
      );
      expect(decoder.getError()).toBeNull();
    }
  );

  it("temporarily keeps the caller network authoritative over contradictory useInfo", () => {
    const mainnetUseInfo = new CryptoCoinInfo(
      CryptoCoinInfoType.bitcoin,
      CryptoCoinInfoNetwork.mainnet
    );
    const testnetUseInfo = new CryptoCoinInfo(
      CryptoCoinInfoType.bitcoin,
      CryptoCoinInfoNetwork.testnet
    );

    const testnetDecoder = scanRegistryItem(
      makeStandardHDKey(mainnetUseInfo),
      Network.TESTNET
    );
    const mainnetDecoder = scanRegistryItem(
      makeStandardHDKey(testnetUseInfo),
      Network.MAINNET
    );

    expect(testnetDecoder.getDecodedData()?.xpub).toMatch(/^tpub/);
    expect(mainnetDecoder.getDecodedData()?.xpub).toMatch(/^xpub/);
  });

  it("decodes SeedSigner's official multipart mainnet vector", () => {
    const decoder = new BCUR2ExtendedPublicKeyDecoder({
      network: Network.MAINNET,
    });
    SEEDSIGNER_MAINNET_CRYPTO_ACCOUNT.forEach((fragment) =>
      decoder.receivePart(fragment)
    );

    expect(decoder.getDecodedData()).toEqual({
      type: "crypto-account",
      xpub: SEEDSIGNER_MAINNET_XPUB,
      rootFingerprint: "C49122A5",
      bip32Path: "48'/1'/0'/2'",
    });
    expect(decoder.getError()).toBeNull();
  });

  it.each([Network.TESTNET, Network.REGTEST, Network.SIGNET])(
    "decodes SeedSigner's official multipart testnet vector on %s",
    (network) => {
      const decoder = new BCUR2ExtendedPublicKeyDecoder({ network });
      SEEDSIGNER_TESTNET_CRYPTO_ACCOUNT.forEach((fragment) =>
        decoder.receivePart(fragment)
      );

      expect(decoder.getDecodedData()).toEqual({
        type: "crypto-account",
        xpub: SEEDSIGNER_TESTNET_XPUB,
        rootFingerprint: "C49122A5",
        bip32Path: "48'/1'/0'/2'",
      });
      expect(decoder.getError()).toBeNull();
    }
  );

  it("decodes Passport's multipart bytes export without deriving it", () => {
    const decoder = scanPassport({
      ...PASSPORT_MULTISIG_EXPORT,
      fw_version: "2.3.4",
      benign_future_field: { ignored: true },
    });

    expect(decoder.getDecodedData()).toEqual({
      type: "bytes",
      xpub: PASSPORT_MULTISIG_EXPORT.p2sh,
      rootFingerprint: "efa5d916",
      bip32Path: "45'",
    });
    expect(decoder.getError()).toBeNull();
  });

  it("accepts the historical wrapped-SegWit field alias", () => {
    const { p2sh_p2wsh_deriv, p2sh_p2wsh, ...remainingExport } =
      PASSPORT_MULTISIG_EXPORT;
    const decoder = scanPassport({
      ...remainingExport,
      p2wsh_p2sh_deriv: p2sh_p2wsh_deriv,
      p2wsh_p2sh: p2sh_p2wsh,
    });

    expect(decoder.getDecodedData()?.xpub).toBe(PASSPORT_MULTISIG_EXPORT.p2sh);
  });

  it.each([
    null,
    [],
    "not an export",
    { ...PASSPORT_MULTISIG_EXPORT, p2sh_deriv: "m/84'/1'/0'" },
    { ...PASSPORT_MULTISIG_EXPORT, xfp: "not-hex!" },
    {
      ...PASSPORT_MULTISIG_EXPORT,
      p2sh_p2wsh: "",
    },
  ])("rejects a non-Passport bytes payload %#", (payload) => {
    const decoder = scanPassport(payload);

    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBe(PASSPORT_MULTISIG_EXPORT_ERROR);
  });

  it("requires Passport schema fields to be own properties", () => {
    const withoutOwnRootPath = { ...PASSPORT_MULTISIG_EXPORT };
    Reflect.deleteProperty(withoutOwnRootPath, "p2sh_deriv");
    const inheritedRootPath = new Proxy(withoutOwnRootPath, {
      get(target, property, receiver) {
        return property === "p2sh_deriv"
          ? "m/45'"
          : Reflect.get(target, property, receiver);
      },
    });
    vi.spyOn(JSON, "parse").mockReturnValue(inheritedRootPath);

    const decoder = scanPassport(withoutOwnRootPath);
    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBe(PASSPORT_MULTISIG_EXPORT_ERROR);
  });

  it("does not read missing Passport fields through a proxy getter", () => {
    const exportWithGuardedMissingFields = new Proxy(
      { ...PASSPORT_MULTISIG_EXPORT },
      {
        get(target, property, receiver) {
          if (property === "p2wsh_p2sh_deriv" || property === "p2wsh_p2sh") {
            throw new Error("missing field was read");
          }
          return Reflect.get(target, property, receiver);
        },
      }
    );
    vi.spyOn(JSON, "parse").mockReturnValue(exportWithGuardedMissingFields);

    const decoder = scanPassport(PASSPORT_MULTISIG_EXPORT);
    expect(decoder.getDecodedData()?.xpub).toBe(PASSPORT_MULTISIG_EXPORT.p2sh);
    expect(decoder.getError()).toBeNull();
  });

  it("rejects arbitrary binary and malformed JSON bytes", () => {
    const invalidUTF8 = scanRegistryItem(
      new Bytes(Buffer.from([0xff, 0xfe, 0xfd]))
    );
    const invalidJSON = scanRegistryItem(new Bytes(Buffer.from("{", "utf8")));

    expect(invalidUTF8.getDecodedData()).toBeNull();
    expect(invalidUTF8.getError()).toBe(
      "Passport key export contains invalid UTF-8."
    );
    expect(invalidJSON.getDecodedData()).toBeNull();
    expect(invalidJSON.getError()).toBe(
      "Passport key export is not valid JSON."
    );
  });

  it("rejects network, fingerprint, and source-path mismatches", () => {
    const networkMismatch = scanPassport(
      PASSPORT_MULTISIG_EXPORT,
      Network.MAINNET
    );
    const fingerprintMismatch = scanPassport({
      ...PASSPORT_MULTISIG_EXPORT,
      xfp: "00000000",
    });
    const wrongPathKey = ExtendedPublicKey.fromBase58(
      PASSPORT_MULTISIG_EXPORT.p2sh
    );
    wrongPathKey.index = 0x8000002e;
    const pathMismatch = scanPassport({
      ...PASSPORT_MULTISIG_EXPORT,
      p2sh: wrongPathKey.toBase58(),
    });

    expect(networkMismatch.getDecodedData()).toBeNull();
    expect(networkMismatch.getError()).toContain("serialization family");
    expect(fingerprintMismatch.getDecodedData()).toBeNull();
    expect(fingerprintMismatch.getError()).toBe(
      "Computed fingerprint does not match the one in the file."
    );
    expect(pathMismatch.getDecodedData()).toBeNull();
    expect(pathMismatch.getError()).toBe(
      "Passport extended public key does not match path m/45'."
    );
  });

  it("rejects malformed and private extended key fields", () => {
    const malformedPublicKey = scanPassport({
      ...PASSPORT_MULTISIG_EXPORT,
      p2sh: "tpub-not-a-valid-extended-public-key",
    });
    const privateKey = scanPassport({
      ...PASSPORT_MULTISIG_EXPORT,
      p2sh: "tprv8ZgxMBicQKsPeiJrWn8nQY5RAGw1cV",
    });

    expect(malformedPublicKey.getDecodedData()).toBeNull();
    expect(malformedPublicKey.getError()).toBe(
      "Passport export contains an invalid extended public key."
    );
    expect(privateKey.getDecodedData()).toBeNull();
    expect(privateKey.getError()).toContain("serialization family");
  });

  it("rejects PSBT registry items in the key-only decoder", () => {
    const decoder = scanRegistryItem(new CryptoPSBT(Buffer.from([1, 2, 3])));

    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBe(
      "QR code contains a PSBT, not an extended public key."
    );
  });

  it("keeps generic bytes decoding unsupported", () => {
    const decoder = new BCUR2Decoder();
    new Bytes(Buffer.from(JSON.stringify(PASSPORT_MULTISIG_EXPORT)))
      .toUREncoder(100)
      .encodeWhole()
      .forEach((fragment) => decoder.receivePart(fragment));

    expect(decoder.getDecodedData(Network.TESTNET)).toBeNull();
    expect(decoder.getError()).toBe("Unsupported UR type: bytes");
  });

  it("copies only a sliced CBOR view", () => {
    const cbor = new Bytes(
      Buffer.from(JSON.stringify(PASSPORT_MULTISIG_EXPORT))
    ).toCBOR();
    const backing = Buffer.alloc(cbor.byteLength + 8, 0xff);
    cbor.copy(backing, 4);
    const slicedView = backing.subarray(4, 4 + cbor.byteLength);
    const registry = completeRegistryDecoder("bytes", slicedView);
    const decoder = new BCUR2ExtendedPublicKeyDecoder(
      { network: Network.TESTNET },
      () => registry
    );

    expect(decoder.getDecodedData()?.xpub).toBe(PASSPORT_MULTISIG_EXPORT.p2sh);
  });

  it("rejects raw CBOR over the limit before invoking the CBOR parser", () => {
    const registry = completeRegistryDecoder("bytes", Buffer.alloc(20));
    const fromCBOR = vi.spyOn(Bytes, "fromCBOR");
    const decoder = new BCUR2ExtendedPublicKeyDecoder(
      { network: Network.TESTNET, maxPayloadBytes: 10 },
      () => registry
    );

    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBe("BC-UR payload exceeds the 10-byte limit.");
    expect(fromCBOR).not.toHaveBeenCalled();
  });

  it("separately rejects decoded inner bytes over the limit", () => {
    const cbor = new Bytes(Buffer.alloc(11, 0x61)).toCBOR();
    const registry = completeRegistryDecoder("bytes", cbor);
    const decoder = new BCUR2ExtendedPublicKeyDecoder(
      { network: Network.TESTNET, maxPayloadBytes: 10 },
      () => registry
    );

    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBe("BC-UR payload exceeds the 10-byte limit.");
  });

  it("caches terminal success and semantic error", () => {
    const validCBOR = new Bytes(
      Buffer.from(JSON.stringify(PASSPORT_MULTISIG_EXPORT))
    ).toCBOR();
    const successRegistry = completeRegistryDecoder("bytes", validCBOR);
    const successDecoder = new BCUR2ExtendedPublicKeyDecoder(
      { network: Network.TESTNET },
      () => successRegistry
    );
    const wrongPurposeRegistry = completeRegistryDecoder(
      "crypto-psbt",
      Buffer.from([1])
    );
    const errorDecoder = new BCUR2ExtendedPublicKeyDecoder(
      { network: Network.TESTNET },
      () => wrongPurposeRegistry
    );

    const result = successDecoder.getDecodedData();
    expect(successDecoder.getDecodedData(Network.MAINNET)).toBe(result);
    expect(successRegistry.resultUR).toHaveBeenCalledTimes(1);
    expect(errorDecoder.getDecodedData()).toBeNull();
    const terminalError = errorDecoder.getError();
    expect(errorDecoder.getDecodedData(Network.MAINNET)).toBeNull();
    expect(errorDecoder.getError()).toBe(terminalError);
    expect(wrongPurposeRegistry.resultUR).toHaveBeenCalledTimes(1);
  });

  it("keeps an incomplete network check non-terminal", () => {
    const decoder = new BCUR2ExtendedPublicKeyDecoder({
      network: Network.TESTNET,
    });

    expect(decoder.getDecodedData(Network.MAINNET)).toBeNull();
    expect(decoder.getError()).toBeNull();

    new Bytes(Buffer.from(JSON.stringify(PASSPORT_MULTISIG_EXPORT)))
      .toUREncoder(100)
      .encodeWhole()
      .forEach((fragment) => decoder.receivePart(fragment));

    expect(decoder.getDecodedData()?.xpub).toBe(PASSPORT_MULTISIG_EXPORT.p2sh);
  });

  it("reset clears partial, successful, and failed terminal state", () => {
    const decoder = scanPassport(PASSPORT_MULTISIG_EXPORT);
    expect(decoder.getDecodedData()).not.toBeNull();

    decoder.reset();
    expect(decoder.isComplete()).toBe(false);
    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBeNull();

    const partialFrames = new Bytes(
      Buffer.from(JSON.stringify(PASSPORT_MULTISIG_EXPORT))
    )
      .toUREncoder(50)
      .encodeWhole();
    expect(partialFrames.length).toBeGreaterThan(1);
    decoder.receivePart(partialFrames[0]);
    expect(decoder.isComplete()).toBe(false);
    decoder.reset();
    expect(decoder.isComplete()).toBe(false);
    expect(decoder.getProgress()).toBe("Idle");

    decoder.receivePart("not-a-ur");
    expect(decoder.getError()).toBe("Invalid QR format: Must start with UR:");
    decoder.reset();
    expect(decoder.getError()).toBeNull();
    expect(decoder.getProgress()).toBe("Idle");
  });
});
