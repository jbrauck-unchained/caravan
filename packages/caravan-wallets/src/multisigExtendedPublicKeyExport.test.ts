import {
  ExtendedPublicKey,
  Network,
  ROOT_FINGERPRINT,
  TEST_FIXTURES,
} from "@caravan/bitcoin";

import { coldcardFixtures } from "./fixtures/coldcard.fixtures";
import {
  InvalidMultisigExtendedPublicKeyExportError,
  MissingMultisigExtendedPublicKeyExportParametersError,
  MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_BIP32_PATHS,
  MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_CHROOTS,
  parseMultisigExtendedPublicKeyExport,
  UnsupportedMultisigExtendedPublicKeyExportPathError,
} from "./multisigExtendedPublicKeyExport";

const { nodes } = TEST_FIXTURES.keys.open_source;

describe("parseMultisigExtendedPublicKeyExport", () => {
  it("keeps the exported path allowlist immutable", () => {
    const originalP2shField =
      MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_BIP32_PATHS["m/45'"];
    const originalChroots = [
      ...MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_CHROOTS,
    ];

    expect(
      Reflect.set(
        MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_BIP32_PATHS,
        "m/45'",
        "mutated"
      )
    ).toBe(false);
    expect(() =>
      Reflect.apply(
        Array.prototype.push,
        MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_CHROOTS,
        ["m/44'"]
      )
    ).toThrow(TypeError);
    expect(MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_BIP32_PATHS["m/45'"]).toBe(
      originalP2shField
    );
    expect(MULTISIG_EXTENDED_PUBLIC_KEY_EXPORT_BASE_CHROOTS).toEqual(
      originalChroots
    );
  });

  it("parses both object and JSON text inputs", () => {
    const options = {
      network: Network.TESTNET,
      bip32Path: "m/45'",
    };
    const expected = {
      xpub: nodes["m/45'"].tpub,
      rootFingerprint: ROOT_FINGERPRINT,
      bip32Path: "m/45'",
    };

    expect(
      parseMultisigExtendedPublicKeyExport(
        coldcardFixtures.validColdcardXpubJSON,
        options
      )
    ).toEqual(expected);
    expect(
      parseMultisigExtendedPublicKeyExport(
        JSON.stringify(coldcardFixtures.validColdcardXpubJSON),
        options
      )
    ).toEqual(expected);
  });

  it("accepts both historical wrapped-SegWit field-name aliases", () => {
    const bip32Path = "m/48'/1'/0'/1'";
    const options = { network: Network.TESTNET, bip32Path };
    const historical = parseMultisigExtendedPublicKeyExport(
      coldcardFixtures.validColdcardXpubJSON,
      options
    );
    const corrected = parseMultisigExtendedPublicKeyExport(
      coldcardFixtures.validColdcardXpubNewFirmwareJSON,
      options
    );

    expect(historical).toEqual(corrected);
    expect(historical.xpub).toMatch(/^tpub/);
    expect(ExtendedPublicKey.fromBase58(historical.xpub).pubkey).toEqual(
      ExtendedPublicKey.fromBase58(
        coldcardFixtures.validColdcardXpubJSON.p2wsh_p2sh
      ).pubkey
    );
  });

  it("computes a missing fingerprint from a depth-one xpub", () => {
    const input = { ...coldcardFixtures.validColdcardXpubJSON };
    Reflect.deleteProperty(input, "xfp");

    expect(
      parseMultisigExtendedPublicKeyExport(input, {
        network: Network.TESTNET,
        bip32Path: "m/45'",
      }).rootFingerprint
    ).toBe(ROOT_FINGERPRINT);
  });

  it("checks a supplied fingerprint against a depth-one xpub", () => {
    expect(() =>
      parseMultisigExtendedPublicKeyExport(
        { ...coldcardFixtures.validColdcardXpubJSON, xfp: "12341234" },
        { network: Network.TESTNET, bip32Path: "m/45'" }
      )
    ).toThrow("Computed fingerprint does not match the one in the file.");
  });

  it("checks an all-zero parent fingerprint instead of treating it as absent", () => {
    const zeroParentFingerprintKey = ExtendedPublicKey.fromBase58(
      nodes["m/45'"].tpub
    );
    zeroParentFingerprintKey.parentFingerprint = 0;
    const input = {
      ...coldcardFixtures.validColdcardXpubJSON,
      p2sh: zeroParentFingerprintKey.toBase58(),
      xfp: "00000000",
    };

    expect(
      parseMultisigExtendedPublicKeyExport(input, {
        network: Network.TESTNET,
        bip32Path: "m/45'",
      }).rootFingerprint
    ).toBe("00000000");
    expect(() =>
      parseMultisigExtendedPublicKeyExport(
        { ...input, xfp: "11111111" },
        { network: Network.TESTNET, bip32Path: "m/45'" }
      )
    ).toThrow("Computed fingerprint does not match the one in the file.");
  });

  it.each(["not-hex", "1234567", "123456789"])(
    "rejects malformed supplied fingerprint %s for a deeper source key",
    (xfp) => {
      expect(() =>
        parseMultisigExtendedPublicKeyExport(
          {
            ...coldcardFixtures.validColdcardXpubJSON,
            p2sh: nodes["m/45'/1/0"].tpub,
            xfp,
          },
          { network: Network.TESTNET, bip32Path: "m/45'" }
        )
      ).toThrow("Invalid root fingerprint in multisig export.");
    }
  );

  it("selects a known source path and derives an unhardened descendant", () => {
    const bip32Path = "m/45'/1/0";

    expect(
      parseMultisigExtendedPublicKeyExport(
        coldcardFixtures.validColdcardXpubJSON,
        { network: Network.TESTNET, bip32Path }
      )
    ).toEqual({
      xpub: nodes[bip32Path].tpub,
      rootFingerprint: ROOT_FINGERPRINT,
      bip32Path,
    });
  });

  it.each([Network.TESTNET, Network.REGTEST, Network.SIGNET])(
    "uses test-family serialization on %s",
    (network) => {
      const result = parseMultisigExtendedPublicKeyExport(
        coldcardFixtures.validColdcardXpubJSON,
        { network, bip32Path: "m/45'" }
      );

      expect(result.xpub).toBe(nodes["m/45'"].tpub);
    }
  );

  it("keeps mainnet serialization on mainnet", () => {
    const result = parseMultisigExtendedPublicKeyExport(
      coldcardFixtures.validColdcardXpubMainnetJSON,
      { network: Network.MAINNET, bip32Path: "m/45'" }
    );

    expect(result.xpub).toBe(nodes["m/45'"].xpub);
  });

  it("rejects exports missing fields required by the compatible format", () => {
    const input = { ...coldcardFixtures.validColdcardXpubJSON };
    Reflect.deleteProperty(input, "p2sh");

    expect(() =>
      parseMultisigExtendedPublicKeyExport(input, {
        network: Network.TESTNET,
        bip32Path: "m/45'",
      })
    ).toThrow(MissingMultisigExtendedPublicKeyExportParametersError);
  });

  it("does not consume inherited export fields", () => {
    const inheritedExport = Object.create(
      coldcardFixtures.validColdcardXpubJSON
    ) as Record<string, unknown>;
    inheritedExport.benignOwnField = true;

    expect(() =>
      parseMultisigExtendedPublicKeyExport(inheritedExport, {
        network: Network.TESTNET,
        bip32Path: "m/45'",
      })
    ).toThrow(MissingMultisigExtendedPublicKeyExportParametersError);
  });

  it("does not read a missing export field through a proxy getter", () => {
    const withoutP2sh = { ...coldcardFixtures.validColdcardXpubJSON };
    Reflect.deleteProperty(withoutP2sh, "p2sh");
    const guardedExport = new Proxy(withoutP2sh, {
      get(target, property, receiver) {
        if (property === "p2sh") throw new Error("missing field was read");
        return Reflect.get(target, property, receiver);
      },
    });

    expect(() =>
      parseMultisigExtendedPublicKeyExport(guardedExport, {
        network: Network.TESTNET,
        bip32Path: "m/45'",
      })
    ).toThrow(MissingMultisigExtendedPublicKeyExportParametersError);
  });

  it("rejects a malformed selected key even at its exact source path", () => {
    expect(() =>
      parseMultisigExtendedPublicKeyExport(
        {
          ...coldcardFixtures.validColdcardXpubJSON,
          p2wsh: "tpub-not-a-valid-extended-public-key",
        },
        { network: Network.TESTNET, bip32Path: "m/48'/1'/0'/2'" }
      )
    ).toThrow("Invalid extended public key in multisig export.");
  });

  it.each([null, [], 42, "null", "[]", '"scalar"'])(
    "rejects a non-object JSON shape %#",
    (input) => {
      expect(() =>
        parseMultisigExtendedPublicKeyExport(
          input as Record<string, unknown> | string,
          { network: Network.TESTNET, bip32Path: "m/45'" }
        )
      ).toThrow(InvalidMultisigExtendedPublicKeyExportError);
    }
  );

  it("rejects a requested path outside the known export sources", () => {
    expect(() =>
      parseMultisigExtendedPublicKeyExport(
        coldcardFixtures.validColdcardXpubJSON,
        { network: Network.TESTNET, bip32Path: "m/44'/0'/0'" }
      )
    ).toThrow(UnsupportedMultisigExtendedPublicKeyExportPathError);
  });

  it("rejects a malformed path that only shares a supported prefix", () => {
    expect(() =>
      parseMultisigExtendedPublicKeyExport(
        coldcardFixtures.validColdcardXpubJSON,
        { network: Network.TESTNET, bip32Path: "m/45'garbage" }
      )
    ).toThrow(UnsupportedMultisigExtendedPublicKeyExportPathError);
  });

  it("rejects hardened derivation below an exported public key", () => {
    expect(() =>
      parseMultisigExtendedPublicKeyExport(
        coldcardFixtures.validColdcardXpubJSON,
        { network: Network.TESTNET, bip32Path: "m/45'/0'" }
      )
    ).toThrow(/hardened child key/i);
  });
});
