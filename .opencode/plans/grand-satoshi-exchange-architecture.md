# Grand Satoshi Exchange - Technical Architecture

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Grand Satoshi Exchange                               │
│                         (apps/grand-satoshi-exchange)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Bank      │  │   Exchange  │  │   Signing   │  │  Settings   │        │
│  │   View      │  │   View      │  │   Modal     │  │   View      │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │               │
│         └────────────────┴────────────────┴────────────────┘               │
│                                   │                                         │
│                          ┌────────┴────────┐                               │
│                          │   React Router   │                               │
│                          └────────┬────────┘                               │
│                                   │                                         │
│  ┌────────────────────────────────┴────────────────────────────────┐       │
│  │                         State Layer                              │       │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │       │
│  │  │ Wallet Store │  │   TX Store   │  │ Client Store │          │       │
│  │  │  (Zustand)   │  │  (Zustand)   │  │  (Zustand)   │          │       │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │       │
│  └────────────────────────────────────────────────────────────────┘       │
│                                   │                                         │
│  ┌────────────────────────────────┴────────────────────────────────┐       │
│  │                      React Query Layer                           │       │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │       │
│  │  │ UTXO Queries │  │  TX Queries  │  │ Fee Queries  │          │       │
│  │  └──────────────┘  └──────────────┘  └──────────────┘          │       │
│  └────────────────────────────────────────────────────────────────┘       │
│                                   │                                         │
└───────────────────────────────────┼─────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │       Caravan Packages         │
                    │                                │
                    │  @caravan/bitcoin              │
                    │  @caravan/wallets              │
                    │  @caravan/psbt                 │
                    │  @caravan/clients              │
                    │  @caravan/multisig             │
                    │                                │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              ┌─────┴─────┐                  ┌──────┴──────┐
              │ Hardware  │                  │ Blockchain  │
              │  Wallets  │                  │    APIs     │
              │           │                  │             │
              │ - Ledger  │                  │ - Mempool   │
              │ - Trezor  │                  │ - Blockstr. │
              └───────────┘                  └─────────────┘
```

## State Management

### Why Zustand over Redux?

| Factor         | Redux (Coordinator)                 | Zustand (GSE)       |
| -------------- | ----------------------------------- | ------------------- |
| Boilerplate    | High (actions, reducers, selectors) | Low (simple stores) |
| Learning curve | Steeper                             | Gentle              |
| Bundle size    | Larger                              | ~1KB                |
| DevTools       | Excellent                           | Good                |
| TypeScript     | Requires setup                      | Native              |
| Persistence    | redux-persist                       | Built-in middleware |

For a new app with simpler state needs, Zustand offers cleaner code.

### Store Definitions

#### Wallet Store

```typescript
// stores/walletStore.ts
interface WalletState {
  // Wallet configuration
  config: MultisigWalletConfig | null;

  // Address slices with UTXOs
  deposits: Map<string, AddressSlice>; // bip32Path -> slice
  change: Map<string, AddressSlice>;

  // Derived
  totalBalance: bigint;
  utxoCount: number;

  // Actions
  loadWallet: (config: MultisigWalletConfig) => void;
  updateSlice: (path: string, slice: AddressSlice) => void;
  clearWallet: () => void;
}

interface AddressSlice {
  bip32Path: string;
  address: string;
  utxos: UTXO[];
  balanceSats: bigint;
  used: boolean;
  isChange: boolean;
}
```

#### Transaction Store

```typescript
// stores/transactionStore.ts
interface TransactionState {
  // Pending offers (up to 8 slots)
  pendingOffers: PendingOffer[];

  // Current offer being created
  currentOffer: {
    selectedUtxos: UTXO[];
    outputs: TxOutput[];
    feeRate: number;
    unsignedPsbt: string | null;
    signatures: SignatureSet[];
  } | null;

  // Transaction history
  history: CompletedTransaction[];

  // Actions
  createOffer: (utxos: UTXO[], outputs: TxOutput[], feeRate: number) => void;
  addSignature: (signature: SignatureSet) => void;
  completeOffer: (txid: string) => void;
  cancelOffer: (offerId: string) => void;
}

interface PendingOffer {
  id: string;
  createdAt: Date;
  unsignedPsbt: string;
  signatures: SignatureSet[];
  requiredSignatures: number;
  totalSignatures: number;
  status: "pending" | "signing" | "ready" | "broadcasting";
}
```

#### Client Store

```typescript
// stores/clientStore.ts
interface ClientState {
  type: "public" | "private";
  provider: "mempool" | "blockstream";
  network: "mainnet" | "testnet" | "signet";

  // Private node settings
  privateUrl?: string;
  privateAuth?: { username: string; password: string };

  // Blockchain client instance
  client: BlockchainClient | null;

  // Actions
  setPublicProvider: (provider: "mempool" | "blockstream") => void;
  setPrivateNode: (
    url: string,
    auth: { username: string; password: string },
  ) => void;
  setNetwork: (network: Network) => void;
}
```

## Data Flow

### Loading Wallet

```
1. User imports wallet config JSON
   │
2. walletStore.loadWallet(config)
   │
3. For each address derivation path:
   │  ├── Derive address from config
   │  └── React Query: fetchAddressUtxos(address)
   │
4. Populate deposits/change slices with UTXOs
   │
5. Calculate totalBalance
   │
6. Render Bank view with UTXO inventory
```

### Creating Send Transaction (Sell Offer)

```
1. User selects UTXOs from inventory
   │
2. User enters destination + amount
   │
3. User selects fee rate
   │
4. transactionStore.createOffer(utxos, outputs, feeRate)
   │
5. Generate unsigned PSBT via @caravan/psbt
   │  └── getUnsignedMultisigPsbtV0({ network, inputs, outputs })
   │
6. Store in pendingOffers[nextSlot]
   │
7. Render offer in Exchange view slot
```

### Signing Transaction

```
1. User clicks "Sign" on pending offer
   │
2. Open SigningModal
   │
3. User selects hardware wallet (Ledger/Trezor)
   │
4. @caravan/wallets.SignMultisigTransaction({
   │    keystore: 'LEDGER' | 'TREZOR',
   │    psbt: unsignedPsbt,
   │    walletConfig,
   │    returnSignatureArray: true
   │  })
   │
5. transactionStore.addSignature(signatures)
   │
6. If signatures.length >= requiredSigners:
   │  └── Enable "Broadcast" button
   │
7. Update offer slot progress bar
```

### Broadcasting Transaction

```
1. User clicks "Broadcast" (offer complete)
   │
2. Finalize PSBT with all signatures
   │  └── @caravan/psbt finalization
   │
3. Extract raw transaction hex
   │
4. @caravan/clients.broadcastTransaction(rawTxHex)
   │
5. Receive txid
   │
6. transactionStore.completeOffer(txid)
   │
7. Move to history, show "Trade Complete!" animation
   │
8. React Query: invalidate UTXO queries
```

## Component Architecture

### UI Component Hierarchy

```
<App>
├── <OSRSWindow title="Grand Satoshi Exchange">
│   ├── <TabBar tabs={['Bank', 'Exchange', 'History']} />
│   └── <TabContent>
│       ├── <BankView>                    # /bank
│       │   ├── <BalanceDisplay />        # Total GP
│       │   ├── <InventoryGrid>           # UTXO grid
│       │   │   └── <UTXOItem />[]        # Individual items
│       │   └── <ActionButtons />         # Send/Receive
│       │
│       ├── <ExchangeView>                # /exchange
│       │   ├── <OfferSlots>              # 8 GE slots
│       │   │   └── <OfferSlot />[]       # Individual offers
│       │   └── <CollectionBox />         # Completed trades
│       │
│       └── <HistoryView>                 # /history
│           └── <TransactionList />
│               └── <TransactionItem />[]
│
├── <CreateOfferModal />                  # Send flow
│   ├── <UTXOSelector />
│   ├── <OutputEditor />
│   ├── <FeeSelector />
│   └── <ConfirmOffer />
│
├── <SigningModal />                      # HW wallet flow
│   ├── <DeviceSelector />
│   ├── <SigningProgress />
│   └── <SignatureResult />
│
└── <ReceiveModal />                      # Receive flow
    ├── <AddressDisplay />
    └── <QRCode />
```

### Base UI Components (OSRS-styled)

```
ui/
├── Window/
│   ├── Window.tsx           # OSRS window frame with title
│   ├── WindowHeader.tsx     # Draggable header bar
│   └── WindowContent.tsx    # Scrollable content area
├── Button/
│   ├── Button.tsx           # Standard OSRS button
│   ├── IconButton.tsx       # Icon-only button
│   └── TabButton.tsx        # Tab bar button
├── Input/
│   ├── TextInput.tsx        # OSRS text field
│   ├── NumberInput.tsx      # Amount input with validation
│   └── AddressInput.tsx     # Bitcoin address input
├── Display/
│   ├── GoldAmount.tsx       # GP-style number display
│   ├── ProgressBar.tsx      # GE offer progress
│   └── Tooltip.tsx          # Hover tooltip
├── Grid/
│   ├── InventoryGrid.tsx    # 28-slot inventory
│   ├── InventorySlot.tsx    # Single slot (empty/filled)
│   └── ItemStack.tsx        # Item with quantity
└── Modal/
    ├── Modal.tsx            # OSRS dialog box
    └── ConfirmDialog.tsx    # Yes/No prompt
```

## Caravan Package Integration

### @caravan/bitcoin

```typescript
import {
  Network,
  validateAddress,
  deriveChildPublicKey,
  generateMultisigFromPublicKeys,
  estimateMultisigTransactionFee,
  bip32PathToSequence,
} from "@caravan/bitcoin";

// Usage examples
const isValid = validateAddress(address, Network.MAINNET);
const childKey = deriveChildPublicKey(xpub, "m/0/5", Network.MAINNET);
```

### @caravan/wallets

```typescript
import {
  SignMultisigTransaction,
  ExportExtendedPublicKey,
  RegisterWalletPolicy,
  KEYSTORES,
} from "@caravan/wallets";

// Only supporting Ledger + Trezor initially
const SUPPORTED_KEYSTORES = ["LEDGER", "TREZOR"] as const;

// Sign transaction
const signatures = await SignMultisigTransaction({
  keystore: "LEDGER",
  network: Network.MAINNET,
  psbt: unsignedPsbt,
  walletConfig: config,
  returnSignatureArray: true,
});
```

### @caravan/psbt

```typescript
import {
  getUnsignedMultisigPsbtV0,
  PsbtV2,
  autoLoadPSBT,
  translatePSBT,
} from "@caravan/psbt";

// Create unsigned PSBT
const psbt = getUnsignedMultisigPsbtV0({
  network: Network.MAINNET,
  inputs: selectedUtxos.map(utxoToInput),
  outputs: [
    { address: destinationAddress, amountSats: amount },
    { address: changeAddress, amountSats: changeAmount },
  ],
});
```

### @caravan/clients

```typescript
import { BlockchainClient, ClientType } from "@caravan/clients";

// Create client
const client = new BlockchainClient({
  type: ClientType.PUBLIC,
  network: "mainnet",
});

// Fetch UTXOs
const utxos = await client.getAddressUtxos(address);

// Broadcast
const txid = await client.broadcastTransaction(rawTxHex);

// Fee estimation
const feeRate = await client.getFeeEstimate(6);
```

### @caravan/multisig

```typescript
import {
  MultisigWalletConfig,
  braidDetailsToWalletConfig
} from '@caravan/multisig';

// Type-safe wallet config
const config: MultisigWalletConfig = {
  name: "My Vault",
  quorum: { requiredSigners: 2, totalSigners: 3 },
  addressType: "P2WSH",
  network: "mainnet",
  extendedPublicKeys: [...]
};
```

## File Structure (Detailed)

```
apps/grand-satoshi-exchange/
├── public/
│   ├── assets/
│   │   ├── sprites/
│   │   │   ├── coins.png          # Gold coin spritesheet
│   │   │   ├── ui.png             # UI element spritesheet
│   │   │   ├── icons.png          # Action icons
│   │   │   └── hardware.png       # HW wallet icons
│   │   ├── fonts/
│   │   │   └── runescape.woff2    # Bitmap font
│   │   └── sounds/                # Future: sound effects
│   │       ├── click.mp3
│   │       ├── coin.mp3
│   │       └── complete.mp3
│   └── favicon.ico
├── src/
│   ├── components/
│   │   ├── ui/                    # Base OSRS components
│   │   ├── wallet/                # Wallet-specific
│   │   ├── exchange/              # GE-specific
│   │   └── hardware/              # HW wallet UI
│   ├── hooks/
│   │   ├── useWallet.ts           # Wallet operations
│   │   ├── useTransaction.ts      # TX operations
│   │   ├── useClient.ts           # Blockchain client
│   │   ├── useHardwareWallet.ts   # HW interactions
│   │   └── useUTXOs.ts            # UTXO queries
│   ├── stores/
│   │   ├── walletStore.ts
│   │   ├── transactionStore.ts
│   │   └── clientStore.ts
│   ├── utils/
│   │   ├── format.ts              # Number/address formatting
│   │   ├── validation.ts          # Input validation
│   │   ├── psbt.ts                # PSBT helpers
│   │   └── sprites.ts             # Sprite utilities
│   ├── types/
│   │   ├── wallet.ts
│   │   ├── transaction.ts
│   │   └── ui.ts
│   ├── styles/
│   │   ├── reset.css
│   │   ├── variables.css          # OSRS color palette
│   │   ├── fonts.css
│   │   └── animations.css
│   ├── routes/
│   │   ├── Bank.tsx
│   │   ├── Exchange.tsx
│   │   ├── History.tsx
│   │   └── Settings.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── vite-env.d.ts
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── README.md
```

## Build Configuration

### package.json

```json
{
  "name": "grand-satoshi-exchange",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx",
    "test": "vitest"
  },
  "dependencies": {
    "@caravan/bitcoin": "*",
    "@caravan/clients": "*",
    "@caravan/multisig": "*",
    "@caravan/psbt": "*",
    "@caravan/wallets": "*",
    "@tanstack/react-query": "^5.x",
    "react": "^18.x",
    "react-dom": "^18.x",
    "react-router-dom": "^6.x",
    "zustand": "^4.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "@caravan/eslint-config": "*",
    "@caravan/typescript-config": "*",
    "@types/react": "^18.x",
    "@types/react-dom": "^18.x",
    "@vitejs/plugin-react": "^4.x",
    "typescript": "^5.x",
    "vite": "^5.x",
    "vitest": "^1.x"
  }
}
```

### vite.config.ts

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@stores": path.resolve(__dirname, "./src/stores"),
      "@utils": path.resolve(__dirname, "./src/utils"),
      "@types": path.resolve(__dirname, "./src/types"),
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
  },
});
```
