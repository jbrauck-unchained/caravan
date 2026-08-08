import { TEST_FIXTURES } from "@caravan/bitcoin";
import { braidDetailsToWalletConfig } from "@caravan/multisig";

import {
  getLedgerDependencies,
  type LedgerTransport,
  resetLedgerDependenciesForTesting,
  setLedgerDependenciesForTesting,
} from "./internal/ledgerDependencies";
import {
  LedgerExportPublicKey,
  LedgerGetMetadata,
  LedgerInteraction,
  LedgerRegisterWalletPolicy,
  LedgerSignMultisigTransaction,
  LedgerSignMessage,
  LedgerV2SignMultisigTransaction,
} from "./ledger";

type FakeTransport = {
  close: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  setExchangeTimeout: ReturnType<typeof vi.fn>;
  setScrambleKey: ReturnType<typeof vi.fn>;
};

function makeTransport(): FakeTransport {
  return {
    close: vi.fn().mockImplementation(() => Promise.resolve()),
    send: vi.fn(),
    setExchangeTimeout: vi.fn(),
    setScrambleKey: vi.fn(),
  };
}

function asLedgerTransport(transport: FakeTransport): LedgerTransport {
  return transport as unknown as LedgerTransport;
}

function installWebUSBDependencies({
  transport,
  app,
  version = "2.0.0",
  name = "Bitcoin",
}: {
  transport: FakeTransport;
  app?: object;
  version?: string;
  name?: string;
}) {
  const createWebUSBTransport = vi
    .fn()
    .mockResolvedValue(asLedgerTransport(transport));
  const getAppConfiguration = vi.fn().mockResolvedValue({
    name,
    version,
    flags: 0,
  });
  const createLegacyApp = vi.fn().mockReturnValue(app);
  const createModernApp = vi.fn().mockReturnValue(app);

  setLedgerDependenciesForTesting({
    createWebUSBTransport,
    getAppConfiguration,
    createLegacyApp,
    createModernApp,
  } as never);

  return {
    createLegacyApp,
    createModernApp,
    createWebUSBTransport,
    getAppConfiguration,
  };
}

describe("Ledger transport lifecycle", () => {
  afterEach(() => {
    resetLedgerDependenciesForTesting();
    vi.restoreAllMocks();
  });

  describe("withTransport", () => {
    it("closes the exact created WebUSB transport once after success", async () => {
      const transport = makeTransport();
      const { createWebUSBTransport } = installWebUSBDependencies({
        transport,
      });
      const interaction = new LedgerInteraction();
      const callback = vi.fn().mockResolvedValue("ok");

      await expect(interaction.withTransport(callback)).resolves.toBe("ok");

      expect(createWebUSBTransport).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(asLedgerTransport(transport));
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("closes once and preserves a rejected operation over cleanup failure", async () => {
      const transport = makeTransport();
      const operationError = new Error("operation failed");
      transport.close.mockRejectedValue(new Error("cleanup failed"));
      installWebUSBDependencies({ transport });
      const interaction = new LedgerInteraction();

      await expect(
        interaction.withTransport(() => Promise.reject(operationError))
      ).rejects.toBe(operationError);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("closes once and preserves a synchronously thrown operation error", async () => {
      const transport = makeTransport();
      const operationError = new Error("synchronous failure");
      installWebUSBDependencies({ transport });
      const interaction = new LedgerInteraction();

      await expect(
        interaction.withTransport(() => {
          throw operationError;
        })
      ).rejects.toBe(operationError);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("surfaces cleanup failure when the operation succeeds", async () => {
      const transport = makeTransport();
      const closeError = new Error("cleanup failed");
      transport.close.mockRejectedValue(closeError);
      installWebUSBDependencies({ transport });
      const interaction = new LedgerInteraction();

      await expect(
        interaction.withTransport(() => Promise.resolve("ok"))
      ).rejects.toBe(closeError);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("does not attempt cleanup when transport creation fails", async () => {
      const interaction = new LedgerInteraction();
      const createError = new Error("No device selected.");
      const createWebUSBTransport = vi.fn().mockRejectedValue(createError);
      const callback = vi.fn();
      setLedgerDependenciesForTesting({ createWebUSBTransport } as never);

      await expect(interaction.withTransport(callback)).rejects.toThrow(
        "Select your device in the WebUSB dialog box"
      );
      expect(callback).not.toHaveBeenCalled();
    });

    it("preserves the Firefox U2F factory and closes its exact transport", async () => {
      const transport = makeTransport();
      const createU2FTransport = vi
        .fn()
        .mockResolvedValue(asLedgerTransport(transport));
      const createWebUSBTransport = vi.fn();
      setLedgerDependenciesForTesting({
        createU2FTransport,
        createWebUSBTransport,
      } as never);
      const interaction = new LedgerInteraction();
      vi.spyOn(interaction.environment, "satisfies").mockReturnValue(true);

      await interaction.withTransport(() => Promise.resolve());

      expect(createU2FTransport).toHaveBeenCalledTimes(1);
      expect(createWebUSBTransport).not.toHaveBeenCalled();
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("preserves Firefox U2F transport creation error messages", async () => {
      const createU2FTransport = vi
        .fn()
        .mockRejectedValue(new Error("No device selected."));
      const createWebUSBTransport = vi.fn();
      setLedgerDependenciesForTesting({
        createU2FTransport,
        createWebUSBTransport,
      } as never);
      const interaction = new LedgerInteraction();
      vi.spyOn(interaction.environment, "satisfies").mockReturnValue(true);

      await expect(
        interaction.withTransport(() => Promise.resolve())
      ).rejects.toThrow("No device selected.");
      expect(createU2FTransport).toHaveBeenCalledTimes(1);
      expect(createWebUSBTransport).not.toHaveBeenCalled();
    });

    it("keeps closeTransport compatible without opening a chooser", async () => {
      const createU2FTransport = vi.fn();
      const createWebUSBTransport = vi.fn();
      setLedgerDependenciesForTesting({
        createU2FTransport,
        createWebUSBTransport,
      } as never);

      await expect(
        new LedgerInteraction().closeTransport()
      ).resolves.toBeUndefined();
      expect(createU2FTransport).not.toHaveBeenCalled();
      expect(createWebUSBTransport).not.toHaveBeenCalled();
    });
  });

  describe("withApp and version detection", () => {
    it("uses one transport for configuration, app construction, and callback", async () => {
      const transport = makeTransport();
      const app = { getWalletPublicKey: vi.fn() };
      const dependencies = installWebUSBDependencies({ transport, app });
      const interaction = new LedgerInteraction();
      const callback = vi.fn().mockResolvedValue("done");

      await expect(interaction.withApp(callback)).resolves.toBe("done");

      expect(dependencies.createWebUSBTransport).toHaveBeenCalledTimes(1);
      expect(dependencies.getAppConfiguration).toHaveBeenCalledWith(
        asLedgerTransport(transport)
      );
      expect(dependencies.createLegacyApp).toHaveBeenCalledWith(
        asLedgerTransport(transport)
      );
      expect(callback).toHaveBeenCalledWith(app, asLedgerTransport(transport));
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("constructs the modern app on the same owned transport", async () => {
      const transport = makeTransport();
      const app = { getMasterFingerprint: vi.fn() };
      const dependencies = installWebUSBDependencies({
        transport,
        app,
        version: "2.1.0",
      });
      const callback = vi.fn().mockResolvedValue("done");

      await expect(new LedgerInteraction().withApp(callback)).resolves.toBe(
        "done"
      );

      expect(dependencies.createWebUSBTransport).toHaveBeenCalledTimes(1);
      expect(dependencies.createLegacyApp).not.toHaveBeenCalled();
      expect(dependencies.createModernApp).toHaveBeenCalledWith(
        asLedgerTransport(transport)
      );
      expect(callback).toHaveBeenCalledWith(app, asLedgerTransport(transport));
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("closes the transport when configuration fails", async () => {
      const transport = makeTransport();
      const configurationError = new Error("configuration failed");
      const createLegacyApp = vi.fn();
      const createModernApp = vi.fn();
      setLedgerDependenciesForTesting({
        createWebUSBTransport: vi
          .fn()
          .mockResolvedValue(asLedgerTransport(transport)),
        getAppConfiguration: vi.fn().mockRejectedValue(configurationError),
        createLegacyApp,
        createModernApp,
      } as never);

      await expect(
        new LedgerInteraction().withApp(() => Promise.resolve())
      ).rejects.toBe(configurationError);
      expect(createLegacyApp).not.toHaveBeenCalled();
      expect(createModernApp).not.toHaveBeenCalled();
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("closes the transport when app construction fails", async () => {
      const transport = makeTransport();
      const appError = new Error("app construction failed");
      setLedgerDependenciesForTesting({
        createWebUSBTransport: vi
          .fn()
          .mockResolvedValue(asLedgerTransport(transport)),
        getAppConfiguration: vi.fn().mockResolvedValue({
          name: "Bitcoin",
          version: "2.0.0",
          flags: 0,
        }),
        createLegacyApp: vi.fn(() => {
          throw appError;
        }),
      } as never);

      await expect(
        new LedgerInteraction().withApp(() => Promise.resolve())
      ).rejects.toBe(appError);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("detects an app version with one owned transport", async () => {
      const transport = makeTransport();
      const dependencies = installWebUSBDependencies({
        transport,
        version: "2.1.0",
      });
      const interaction = new LedgerInteraction();

      await expect(interaction.setAppVersion()).resolves.toBe("2.1.0");
      expect(interaction.appVersion).toBe("2.1.0");
      expect(dependencies.createWebUSBTransport).toHaveBeenCalledTimes(1);
      expect(dependencies.getAppConfiguration).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("representative public flows", () => {
    it("closes metadata transport once when the device call fails", async () => {
      const transport = makeTransport();
      const operationError = new Error("device disconnected");
      transport.send.mockRejectedValue(operationError);
      const dependencies = installWebUSBDependencies({ transport });

      await expect(new LedgerGetMetadata().run()).rejects.toBe(operationError);
      expect(dependencies.createWebUSBTransport).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("exports a legacy public key with one transport lifetime", async () => {
      const transport = makeTransport();
      const app = {
        getWalletPublicKey: vi.fn().mockResolvedValue({
          publicKey:
            "0429b3e0919adc41a316aad4f41444d9bf3a9b639550f2aa735676ffff25ba3898d6881e81d2e0163348ff07b3a9a3968401572aa79c79e7edb522f41addc8e6ce",
        }),
      };
      const dependencies = installWebUSBDependencies({ transport, app });
      const interaction = new LedgerExportPublicKey({
        bip32Path: "m/45'/0'/0'/0/0",
      });

      await expect(interaction.run()).resolves.toBe(
        "0229b3e0919adc41a316aad4f41444d9bf3a9b639550f2aa735676ffff25ba3898"
      );
      expect(dependencies.createWebUSBTransport).toHaveBeenCalledTimes(1);
      expect(dependencies.getAppConfiguration).toHaveBeenCalledTimes(1);
      expect(app.getWalletPublicKey).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("signs a message with one transport lifetime", async () => {
      const transport = makeTransport();
      const signature = { v: 0, r: "r", s: "s" };
      const app = {
        signMessageNew: vi.fn().mockResolvedValue(signature),
      };
      const dependencies = installWebUSBDependencies({ transport, app });
      const interaction = new LedgerSignMessage({
        bip32Path: "m/48'/1'/0'/2'/0/0",
        message: "hello world",
      });

      await expect(interaction.run()).resolves.toBe(signature);
      expect(dependencies.createWebUSBTransport).toHaveBeenCalledTimes(1);
      expect(dependencies.getAppConfiguration).toHaveBeenCalledTimes(1);
      expect(transport.setExchangeTimeout).toHaveBeenCalledWith(20000);
      expect(app.signMessageNew).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("registers a v2 wallet with one transport lifetime", async () => {
      const transport = makeTransport();
      const policyHmac = Buffer.from("deadbeef", "hex");
      const app = {
        registerWallet: vi
          .fn()
          .mockResolvedValue([Buffer.from("policy"), policyHmac]),
      };
      const dependencies = installWebUSBDependencies({
        transport,
        app,
        version: "2.1.0",
      });
      const walletConfig = braidDetailsToWalletConfig(TEST_FIXTURES.braids[0]);
      const interaction = new LedgerRegisterWalletPolicy(walletConfig);

      await expect(interaction.run()).resolves.toBe("deadbeef");
      expect(dependencies.createWebUSBTransport).toHaveBeenCalledTimes(1);
      expect(dependencies.getAppConfiguration).toHaveBeenCalledTimes(1);
      expect(app.registerWallet).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("preserves an app rejection when cleanup also rejects", async () => {
      const transport = makeTransport();
      const operationError = new Error("user rejected");
      transport.close.mockRejectedValue(new Error("cleanup failed"));
      const app = {
        signMessageNew: vi.fn().mockRejectedValue(operationError),
      };
      installWebUSBDependencies({ transport, app });
      const interaction = new LedgerSignMessage({
        bip32Path: "m/48'/1'/0'/2'/0/0",
        message: "hello world",
      });

      await expect(interaction.run()).rejects.toBe(operationError);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("keeps the legacy signing fallback for app-configuration failures", async () => {
      const transport = makeTransport();
      const configurationError = new Error("configuration failed");
      const fallback = vi
        .spyOn(LedgerV2SignMultisigTransaction.prototype, "run")
        .mockResolvedValue("fallback" as never);
      setLedgerDependenciesForTesting({
        createWebUSBTransport: vi
          .fn()
          .mockResolvedValue(asLedgerTransport(transport)),
        getAppConfiguration: vi.fn().mockRejectedValue(configurationError),
      } as never);
      const fixture = TEST_FIXTURES.transactions[0];
      const interaction = new LedgerSignMultisigTransaction({
        network: fixture.network,
        inputs: [],
        outputs: [],
        bip32Paths: [],
        v2Options: {
          ...braidDetailsToWalletConfig(fixture.braidDetails),
          psbt: fixture.psbt,
        },
      });

      await expect(interaction.run()).resolves.toBe("fallback");
      expect(fallback).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("does not fall back when the legacy signing operation itself fails", async () => {
      const transport = makeTransport();
      const operationError = new Error("signing failed");
      const app = {
        signP2SHTransaction: vi.fn().mockRejectedValue(operationError),
      };
      installWebUSBDependencies({ transport, app });
      const fallback = vi
        .spyOn(LedgerV2SignMultisigTransaction.prototype, "run")
        .mockResolvedValue("fallback" as never);
      const fixture = TEST_FIXTURES.transactions[0];
      const interaction = new LedgerSignMultisigTransaction({
        network: fixture.network,
        inputs: [],
        outputs: [],
        bip32Paths: [],
        v2Options: {
          ...braidDetailsToWalletConfig(fixture.braidDetails),
          psbt: fixture.psbt,
        },
      });
      vi.spyOn(interaction, "ledgerInputs").mockReturnValue([]);
      vi.spyOn(interaction, "ledgerKeysets").mockReturnValue([]);
      vi.spyOn(interaction, "ledgerOutputScriptHex").mockReturnValue("");
      vi.spyOn(interaction, "anySegwitInputs").mockReturnValue(false);

      await expect(interaction.run()).rejects.toBe(operationError);
      expect(fallback).not.toHaveBeenCalled();
      expect(app.signP2SHTransaction).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("does not open a chooser for an unsupported signing environment", async () => {
      const createU2FTransport = vi.fn();
      const createWebUSBTransport = vi.fn();
      setLedgerDependenciesForTesting({
        createU2FTransport,
        createWebUSBTransport,
      } as never);
      const interaction = new LedgerSignMessage({
        bip32Path: "m/48'/1'/0'/2'/0/0",
        message: "hello world",
      });
      vi.spyOn(interaction, "isSupported").mockReturnValue(false);

      await expect(interaction.run()).rejects.toThrow(
        "Method not supported for this version of Ledger app"
      );
      expect(createU2FTransport).not.toHaveBeenCalled();
      expect(createWebUSBTransport).not.toHaveBeenCalled();
    });

    it("returns a cached wallet registration without opening a chooser", async () => {
      const createU2FTransport = vi.fn();
      const createWebUSBTransport = vi.fn();
      setLedgerDependenciesForTesting({
        createU2FTransport,
        createWebUSBTransport,
      } as never);
      const interaction = new LedgerRegisterWalletPolicy({
        ...braidDetailsToWalletConfig(TEST_FIXTURES.braids[0]),
        policyHmac: "deadbeef",
      });

      await expect(interaction.registerWallet()).resolves.toEqual(
        Buffer.from("deadbeef", "hex")
      );
      expect(createU2FTransport).not.toHaveBeenCalled();
      expect(createWebUSBTransport).not.toHaveBeenCalled();
    });
  });

  it("keeps the production defaults restorable between tests", () => {
    resetLedgerDependenciesForTesting();
    expect(getLedgerDependencies().createWebUSBTransport).toBeTypeOf(
      "function"
    );
  });
});
