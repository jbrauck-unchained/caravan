import { ExtendedPublicKey, Network } from "@caravan/bitcoin";
import {
  Bytes,
  CryptoHDKey,
  CryptoKeypath,
  CryptoPSBT,
  PathComponent,
  RegistryItem,
  URRegistryDecoder,
} from "@keystonehq/bc-ur-registry";

import { BCUR2Decoder } from "../decoder";
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

// SeedSigner 0.8.7 testnet vector from tests/test_encodepsbtqr.py.
const SEEDSIGNER_TESTNET_CRYPTO_ACCOUNT = [
  "UR:CRYPTO-ACCOUNT/1-5/LPADAHCSKECYRTPEDKMOHDCFOEADCYSSMECPONAOLYTAADMETAADDLONAXHDCLAOKSRLNLKPUENSAHBTHS",
  "UR:CRYPTO-ACCOUNT/2-5/LPAOAHCSKECYRTPEDKMOHDCFGYATHPMNSNKKGHZMLUZORPVDGUOTECSTTKTOLPCWPTNTLKZTTIZTNDJSCF",
  "UR:CRYPTO-ACCOUNT/3-5/LPAXAHCSKECYRTPEDKMOHDCFZTBEAAHDCXVDTPMYRSTDSPZSBZSPGERLGDATUYNLPYBTGYIYYKBDFGWPKE",
  "UR:CRYPTO-ACCOUNT/4-5/LPAAAHCSKECYRTPEDKMOHDCFBTWTAOSWKSVTSGCHBYDKYAVDAHTAADEHOYAOADAMTAADDYOTADGYBKBWFE",
  "UR:CRYPTO-ACCOUNT/5-5/LPAHAHCSKECYRTPEDKMOHDCFLOCSDYYKADYKAEYKAOYKAOCYSSMECPONAXAAAYCYIOREKKJKAETODLFYWP",
];

const SEEDSIGNER_TESTNET_XPUB =
  "tpubDEfkEY1bXf2FvRVCxiMRXWZPrEaxkMdwoVnjWhGnP42kk2ZPfkB86p5rLEjAVc7YgVGuUQWPPo6mbwTt9qXEW4YUyQXkkpQ5uJdppanC7rL";

function makeHDKey(): CryptoHDKey {
  const origin = new CryptoKeypath(
    [new PathComponent({ index: 45, hardened: true })],
    Buffer.from("efa5d916", "hex"),
    1,
  );

  return new CryptoHDKey({
    isMaster: false,
    key: Buffer.from(
      "039b9ba1ad522fa2c4fc550c23626c2fb352373e22fbb8d59b984d058affe97e18",
      "hex",
    ),
    chainCode: Buffer.from(
      "6ff1bd910b424c55d269864c9f9ee9e3a5b20b034999ba83cb17f5635f56077c",
      "hex",
    ),
    origin,
    parentFingerprint: Buffer.from("efa5d916", "hex"),
  });
}

function scan(
  item: RegistryItem,
  network = Network.TESTNET,
): BCUR2ExtendedPublicKeyDecoder {
  const decoder = new BCUR2ExtendedPublicKeyDecoder({ network });
  item
    .toUREncoder(100)
    .encodeWhole()
    .forEach((fragment) => decoder.receivePart(fragment));
  return decoder;
}

function scanPassport(
  value: unknown,
  network = Network.TESTNET,
): BCUR2ExtendedPublicKeyDecoder {
  return scan(new Bytes(Buffer.from(JSON.stringify(value))), network);
}

describe("BCUR2ExtendedPublicKeyDecoder", () => {
  it.each([Network.TESTNET, Network.REGTEST, Network.SIGNET])(
    "decodes SeedSigner's testnet account on %s",
    (network) => {
      const decoder = new BCUR2ExtendedPublicKeyDecoder({ network });
      SEEDSIGNER_TESTNET_CRYPTO_ACCOUNT.forEach((fragment) =>
        decoder.receivePart(fragment),
      );

      expect(decoder.getDecodedData()).toEqual({
        type: "crypto-account",
        xpub: SEEDSIGNER_TESTNET_XPUB,
        rootFingerprint: "C49122A5",
        bip32Path: "48'/1'/0'/2'",
      });
      expect(decoder.getError()).toBeNull();
    },
  );

  it("uses test-family serialization for a standalone HD key on regtest", () => {
    const decoder = scan(makeHDKey(), Network.REGTEST);

    expect(decoder.getDecodedData()).toEqual({
      type: "crypto-hdkey",
      xpub: PASSPORT_MULTISIG_EXPORT.p2sh,
      rootFingerprint: "EFA5D916",
      bip32Path: "45'",
    });
  });

  it("decodes Passport's bytes export as its source key", () => {
    const decoder = scanPassport(PASSPORT_MULTISIG_EXPORT);

    expect(decoder.getDecodedData()).toEqual({
      type: "bytes",
      xpub: PASSPORT_MULTISIG_EXPORT.p2sh,
      rootFingerprint: "efa5d916",
      bip32Path: "45'",
    });
    expect(decoder.getError()).toBeNull();
  });

  it("accepts Passport's historical wrapped-SegWit field alias", () => {
    const { p2sh_p2wsh_deriv, p2sh_p2wsh, ...rest } = PASSPORT_MULTISIG_EXPORT;
    const decoder = scanPassport({
      ...rest,
      p2wsh_p2sh_deriv: p2sh_p2wsh_deriv,
      p2wsh_p2sh: p2sh_p2wsh,
    });

    expect(decoder.getDecodedData()?.xpub).toBe(PASSPORT_MULTISIG_EXPORT.p2sh);
  });

  it.each([
    ["arbitrary bytes", { hello: "world" }],
    [
      "the wrong source path",
      { ...PASSPORT_MULTISIG_EXPORT, p2sh_deriv: "m/84'/1'/0'" },
    ],
    [
      "a mismatched fingerprint",
      { ...PASSPORT_MULTISIG_EXPORT, xfp: "00000000" },
    ],
  ])("rejects %s", (_label, value) => {
    const decoder = scanPassport(value);

    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBe(PASSPORT_MULTISIG_EXPORT_ERROR);
  });

  it("rejects a key from the wrong serialization family", () => {
    const decoder = scanPassport(PASSPORT_MULTISIG_EXPORT, Network.MAINNET);

    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBe(PASSPORT_MULTISIG_EXPORT_ERROR);
  });

  it("rejects a key that does not represent m/45'", () => {
    const key = ExtendedPublicKey.fromBase58(PASSPORT_MULTISIG_EXPORT.p2sh);
    key.index = 0x8000002e;
    const decoder = scanPassport({
      ...PASSPORT_MULTISIG_EXPORT,
      p2sh: key.toBase58(),
    });

    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBe(PASSPORT_MULTISIG_EXPORT_ERROR);
  });

  it("rejects PSBTs in the key-only decoder", () => {
    const decoder = scan(new CryptoPSBT(Buffer.from([1, 2, 3])));

    expect(decoder.getDecodedData()).toBeNull();
    expect(decoder.getError()).toBe(
      "QR code contains a PSBT, not an extended public key.",
    );
  });

  it("keeps bytes unsupported in the generic decoder", () => {
    const item = new Bytes(
      Buffer.from(JSON.stringify(PASSPORT_MULTISIG_EXPORT)),
    );
    const decoder = new BCUR2Decoder();
    item
      .toUREncoder(100)
      .encodeWhole()
      .forEach((fragment) => decoder.receivePart(fragment));

    expect(decoder.getDecodedData(Network.TESTNET)).toBeNull();
    expect(decoder.getError()).toBe("Unsupported UR type: bytes");
  });

  it("decodes only the supplied CBOR view", () => {
    const cbor = makeHDKey().toCBOR();
    const backing = Buffer.alloc(cbor.byteLength + 8, 0xff);
    cbor.copy(backing, 4);
    const registryDecoder = {
      isComplete: () => true,
      getProgress: () => 1,
      resultUR: () => ({
        type: "crypto-hdkey",
        cbor: backing.subarray(4, 4 + cbor.byteLength),
      }),
    } as unknown as URRegistryDecoder;
    const decoder = new BCUR2Decoder(registryDecoder);

    expect(decoder.getDecodedData(Network.TESTNET)?.xpub).toBe(
      PASSPORT_MULTISIG_EXPORT.p2sh,
    );
  });
});
