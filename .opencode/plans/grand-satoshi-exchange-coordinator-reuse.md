# Grand Satoshi Exchange - Coordinator Code Reuse Analysis

## Overview

This document identifies code from the existing Caravan Coordinator app that can be reused, adapted, or serves as reference for the Grand Satoshi Exchange.

## Reuse Categories

### 1. DIRECT REUSE (Copy/Import as-is)

These are battle-tested utilities with no UI coupling:

#### Utils from `apps/coordinator/src/utils/`

| File                         | Functions                                                             | Notes                         |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------- |
| `psbtUtils.ts`               | `loadPsbt`, `extractSignaturesFromPSBT`, `addMissingScriptDataToPsbt` | Core PSBT handling, essential |
| `transactionCalculations.ts` | Transaction value/fee calculations                                    | Pure math functions           |
| `validation.ts`              | Address/amount validation helpers                                     | Reusable validation           |

#### Key PSBT Utilities

```typescript
// From utils/psbtUtils.ts - DIRECTLY REUSABLE

/**
 * Load and parse a PSBT from various formats
 */
export function loadPsbt(psbtText: string, network: Network): Psbt;

/**
 * Extract signatures from a signed PSBT
 */
export function extractSignaturesFromPSBT(
  psbt: Psbt,
  inputs: Input[],
): SignatureSet[];

/**
 * Add redeem/witness scripts to PSBT inputs
 */
export function addMissingScriptDataToPsbt(psbt: Psbt, inputs: Input[]): Psbt;
```

### 2. ADAPT WITH MODIFICATIONS

These patterns/utilities need some adaptation:

#### Coin Selection (`utils/index.js`)

```javascript
// Original: naiveCoinSelection
// Selects UTXOs to cover target amount + fee

export function naiveCoinSelection(utxos, targetAmount, feeRate) {
  // Sort by value descending
  // Select until target + estimated fee is covered
  // Return selected UTXOs and change amount
}

// ADAPTATION NEEDED:
// - Convert to TypeScript
// - Add UTXO type definitions
// - Consider more sophisticated selection (minimize waste)
```

#### Selector Patterns (`selectors/`)

```typescript
// Pattern from selectors/wallet.ts
// Memoized derived state calculations

// Original (Redux + Reselect)
export const getTotalBalance = createSelector(
  [getDeposits, getChange],
  (deposits, change) => {
    return Object.values(deposits)
      .concat(Object.values(change))
      .reduce((sum, slice) => sum + slice.balanceSats, 0n);
  },
);

// ADAPTATION for Zustand:
// Use Zustand's built-in selectors or useMemo in components
const useWalletStore = create((set, get) => ({
  deposits: {},
  change: {},
  // Computed as getter
  get totalBalance() {
    const { deposits, change } = get();
    return [...Object.values(deposits), ...Object.values(change)].reduce(
      (sum, slice) => sum + slice.balanceSats,
      0n,
    );
  },
}));
```

#### React Query Patterns (`clients/`)

```typescript
// Pattern from clients/fees.ts
// Fee estimation hook

// Original
export const useFeeEstimate = (priority: FeePriority) => {
  const client = useGetClient();
  return useQuery({
    queryKey: feeEstimateKeys.feeEstimate(priority),
    queryFn: () => fetchFeeEstimate(priority, client),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 60 * 1000,
  });
};

// ADAPTATION for GSE:
// Same pattern, different client source (from Zustand store)
export const useFeeEstimate = (priority: "slow" | "standard" | "fast") => {
  const client = useClientStore((state) => state.client);
  const blocks = priority === "fast" ? 1 : priority === "standard" ? 6 : 144;

  return useQuery({
    queryKey: ["fees", priority],
    queryFn: () => client?.getFeeEstimate(blocks),
    enabled: !!client,
    staleTime: 60_000,
  });
};
```

### 3. REFERENCE ONLY (Understand patterns, rebuild from scratch)

These are tightly coupled to the existing UI but valuable for understanding:

#### Redux State Shape

```typescript
// Reference: reducers/index.ts
// Understanding the state structure helps design new stores

// Coordinator's transaction state (complex)
spend: {
  ownership: { ... },
  transaction: {
    inputs: Input[],
    outputs: Output[],
    fee: string,
    feeRate: string,
    unsignedPSBT: string,
    signedPSBT: string,
    finalizedPSBT: string,
    txid: string,
  },
  signatureImporters: { [number]: SignatureImporter }
}

// GSE's simpler version (Zustand)
// See architecture doc for new design
```

#### Hardware Wallet Flow

```typescript
// Reference: components/ScriptExplorer/DirectSignatureImporter.jsx
// Shows the interaction pattern with hardware wallets

class DirectSignatureImporter extends Component {
  interaction = () => {
    return SignMultisigTransaction({
      network,
      keystore: this.props.signatureImporter.method,
      walletConfig: this.props.walletConfig,
      psbt: this.props.unsignedPSBT,
      returnSignatureArray: true,
    });
  };

  async handleSign() {
    try {
      const interaction = this.interaction();
      // interaction.run() returns signature array
      const signatures = await interaction.run();
      this.props.onSignature(signatures);
    } catch (error) {
      this.handleError(error);
    }
  }
}

// GSE VERSION (hooks-based):
const useHardwareWalletSigning = () => {
  const [status, setStatus] = useState<
    "idle" | "connecting" | "signing" | "error"
  >("idle");
  const [error, setError] = useState<Error | null>(null);

  const sign = async (
    keystore: "LEDGER" | "TREZOR",
    psbt: string,
    walletConfig: MultisigWalletConfig,
  ) => {
    setStatus("connecting");
    setError(null);

    try {
      const interaction = SignMultisigTransaction({
        network: walletConfig.network,
        keystore,
        walletConfig,
        psbt,
        returnSignatureArray: true,
      });

      setStatus("signing");
      const signatures = await interaction.run();
      setStatus("idle");
      return signatures;
    } catch (e) {
      setError(e as Error);
      setStatus("error");
      throw e;
    }
  };

  return { sign, status, error };
};
```

## File-by-File Analysis

### High Value Files to Study

| File                       | Value  | Action                              |
| -------------------------- | ------ | ----------------------------------- |
| `utils/psbtUtils.ts`       | High   | Copy + adapt types                  |
| `selectors/wallet.ts`      | High   | Study patterns, rebuild for Zustand |
| `selectors/transaction.ts` | High   | Study patterns                      |
| `hooks/client.ts`          | Medium | Adapt for Zustand client store      |
| `clients/fees.ts`          | Medium | Adapt React Query patterns          |
| `clients/transactions.ts`  | Medium | Adapt React Query patterns          |

### Files to Ignore

| File                     | Reason                                |
| ------------------------ | ------------------------------------- |
| `components/*`           | Tightly coupled to Material-UI        |
| `actions/*`              | Redux-specific, not applicable        |
| `reducers/*`             | Redux-specific, reference only        |
| `proptypes/*`            | Using TypeScript instead              |
| All `.css`/`.styles.tsx` | Completely different styling approach |

## Key Code Snippets to Extract

### 1. UTXO to PSBT Input Conversion

```typescript
// From coordinator codebase - pattern for converting UTXOs to PSBT inputs
function utxoToInput(utxo: UTXO, slice: AddressSlice): PsbtInput {
  return {
    txid: utxo.txid,
    index: utxo.vout,
    amountSats: utxo.value.toString(),
    transactionHex: utxo.transactionHex, // Need to fetch this
    multisig: slice.multisig,
    bip32Path: slice.bip32Path,
  };
}
```

### 2. Wallet Config Validation

```typescript
// Pattern for validating imported wallet configs
function validateWalletConfig(config: unknown): MultisigWalletConfig {
  // Use Zod schema validation
  const schema = z.object({
    name: z.string().optional(),
    uuid: z.string().optional(),
    quorum: z.object({
      requiredSigners: z.number().min(1),
      totalSigners: z.number().optional(),
    }),
    addressType: z.enum(["P2SH", "P2WSH", "P2SH-P2WSH"]),
    network: z.enum(["mainnet", "testnet", "signet", "regtest"]),
    extendedPublicKeys: z.array(
      z.object({
        xpub: z.string(),
        bip32Path: z.string(),
        xfp: z.string(),
        name: z.string().optional(),
      }),
    ),
  });

  return schema.parse(config);
}
```

### 3. Address Derivation Pattern

```typescript
// Derive addresses from wallet config at index
function deriveAddressAtIndex(
  config: MultisigWalletConfig,
  index: number,
  isChange: boolean,
): { address: string; multisig: MultisigDetails } {
  const bip32Path = `m/${isChange ? 1 : 0}/${index}`;

  // Derive child public keys for each signer
  const publicKeys = config.extendedPublicKeys.map((key) =>
    deriveChildPublicKey(key.xpub, bip32Path, config.network),
  );

  // Generate multisig from public keys
  const multisig = generateMultisigFromPublicKeys(
    config.network,
    config.addressType,
    config.quorum.requiredSigners,
    ...publicKeys,
  );

  return {
    address: multisig.address,
    multisig,
  };
}
```

### 4. Transaction Fee Calculation

```typescript
// Estimate fee for a transaction
function estimateFee(
  inputs: PsbtInput[],
  outputs: TxOutput[],
  feeRate: number,
  addressType: MultisigAddressType,
  requiredSigners: number,
  totalSigners: number,
): number {
  const fee = estimateMultisigTransactionFee({
    addressType,
    numInputs: inputs.length,
    numOutputs: outputs.length,
    m: requiredSigners,
    n: totalSigners,
    feesPerByteInSatoshis: feeRate,
  });

  return fee;
}
```

## Migration Checklist

When building GSE, ensure these coordinator features are covered:

### Wallet Operations

- [ ] Import wallet config from JSON
- [ ] Validate wallet config structure
- [ ] Derive addresses from config
- [ ] Fetch UTXOs for addresses
- [ ] Calculate total balance
- [ ] Display individual UTXOs

### Transaction Operations

- [ ] Select UTXOs for spending
- [ ] Set destination address
- [ ] Set send amount
- [ ] Calculate fee based on rate
- [ ] Generate change output
- [ ] Create unsigned PSBT
- [ ] Store pending transaction

### Signing Operations

- [ ] Connect to Ledger
- [ ] Connect to Trezor
- [ ] Sign PSBT with device
- [ ] Extract signatures
- [ ] Validate signatures
- [ ] Track signature progress

### Broadcast Operations

- [ ] Finalize PSBT
- [ ] Extract raw transaction
- [ ] Broadcast to network
- [ ] Handle broadcast errors
- [ ] Store txid on success

### Blockchain Operations

- [ ] Configure blockchain client
- [ ] Fetch UTXOs
- [ ] Fetch fee estimates
- [ ] Broadcast transactions
- [ ] Lookup transactions

## Notes on Coordinator Issues

The LSP errors in the coordinator suggest some API mismatches between the app and packages:

- `@caravan/wallets` missing `JADE`, `BCUR2` exports
- `@caravan/clients` missing `PublicBitcoinProvider`, some method names changed
- `@tanstack/react-query` not installed in coordinator

For GSE, we should:

1. Use current package APIs (check actual exports)
2. Ensure all dependencies are properly installed
3. Use TypeScript strict mode to catch issues early
