import { networks } from "bitcoinjs-lib-v5";

import type { BitcoinNetwork } from "./types/networks";

/**
 * This module exports network constants and provide some utility
 * functions for displaying the network name and passing the network
 * value to bitcoinjs.
 */
/* eslint-disable no-shadow */
export enum Network {
  MAINNET = "mainnet",
  TESTNET = "testnet",
  REGTEST = "regtest",
  SIGNET = "signet",
}

export type Bip32SerializationNetwork = Network.MAINNET | Network.TESTNET;

/**
 * Returns the network family used to select BIP32 Base58 version bytes.
 *
 * Regtest and signet retain their chain identity elsewhere, but serialize
 * extended keys with the same tpub version bytes as testnet.
 */
export function bip32SerializationNetwork(
  network: BitcoinNetwork
): Bip32SerializationNetwork {
  switch (network) {
    case Network.MAINNET:
      return Network.MAINNET;
    case Network.TESTNET:
    case Network.REGTEST:
    case Network.SIGNET:
      return Network.TESTNET;
    default: {
      const unsupportedNetwork: never = network;
      throw new Error(
        `Unsupported Bitcoin network for BIP32 serialization: ${String(
          unsupportedNetwork
        )}`
      );
    }
  }
}

/**
 * Returns bitcoinjs-lib network object corresponding to the given
 * network.
 *
 * This function is for internal use by this library.
 */
export function networkData(network: Network) {
  switch (network) {
    case Network.MAINNET:
      return networks.bitcoin;
    case Network.TESTNET:
      return networks.testnet;
    case Network.REGTEST:
      return networks.regtest;
    case Network.SIGNET:
      throw new Error("Signet is not supported yet");
    default:
      return networks.testnet;
  }
}

/**
 * Returns human-readable network label for the specified network.
 */
export function networkLabel(network: Network) {
  switch (network) {
    case Network.MAINNET:
      return "Mainnet";
    case Network.TESTNET:
      return "Testnet";
    default:
      return "Testnet";
  }
}

/**
 * given a prefix determine the network it indicates
 */
export function getNetworkFromPrefix(prefix: string) {
  switch (prefix.toLowerCase()) {
    case "xpub":
    case "ypub":
    case "zpub":
      return Network.MAINNET;

    case "tpub":
    case "upub":
    case "vpub":
      return Network.TESTNET;

    default:
      throw new Error(`Unrecognized extended public key prefix ${prefix}`);
  }
}
