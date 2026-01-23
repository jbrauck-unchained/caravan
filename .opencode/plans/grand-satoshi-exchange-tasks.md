# Grand Satoshi Exchange - Granular Task Tracking

> Implementation task list with quick references for AI agents
> Related docs: [Overview](grand-satoshi-exchange-overview.md) | [Architecture](grand-satoshi-exchange-architecture.md) | [UI Design](grand-satoshi-exchange-ui-design.md)

## Quick Reference Links

### Caravan Documentation

| Topic                     | Location                                |
| ------------------------- | --------------------------------------- |
| Architecture Overview     | `docs/tree/ARCHITECTURE.md`             |
| Package Index             | `docs/tree/packages/INDEX.md`           |
| @caravan/bitcoin          | `docs/tree/packages/core/bitcoin.md`    |
| @caravan/multisig         | `docs/tree/packages/core/multisig.md`   |
| @caravan/wallets          | `docs/tree/packages/wallet/wallets.md`  |
| @caravan/psbt             | `docs/tree/packages/wallet/psbt.md`     |
| @caravan/clients          | `docs/tree/packages/utility/clients.md` |
| Coordinator App Reference | `docs/tree/apps/coordinator.md`         |

### Coordinator Code References (Patterns to Reuse)

| Pattern                    | Location                                        |
| -------------------------- | ----------------------------------------------- |
| Vite config with polyfills | `apps/coordinator/vite.config.ts`               |
| TypeScript config          | `apps/coordinator/tsconfig.json`                |
| ESLint config              | `apps/coordinator/.eslintrc.cjs`                |
| PSBT utilities             | `apps/coordinator/src/utils/psbtUtils.ts`       |
| Wallet selectors           | `apps/coordinator/src/selectors/wallet.ts`      |
| Transaction selectors      | `apps/coordinator/src/selectors/transaction.ts` |
| Client hooks               | `apps/coordinator/src/hooks/client.ts`          |
| Fee estimation             | `apps/coordinator/src/clients/fees.ts`          |

### Key Package Imports

```typescript
// Core
import {
  Network,
  validateAddress,
  generateMultisigFromPublicKeys,
} from "@caravan/bitcoin";
import {
  MultisigWalletConfig,
  WalletConfigKeyDerivation,
} from "@caravan/multisig";
import { combineBip32Paths, deriveChildPublicKey } from "@caravan/bip32";

// Wallet Operations
import {
  SignMultisigTransaction,
  ExportExtendedPublicKey,
  RegisterWalletPolicy,
  KEYSTORES,
} from "@caravan/wallets";
import {
  PsbtV2,
  getUnsignedMultisigPsbtV0,
  autoLoadPSBT,
  translatePSBT,
} from "@caravan/psbt";

// Blockchain
import {
  BlockchainClient,
  ClientType,
  PublicBitcoinProvider,
} from "@caravan/clients";
```

---

## Phase 0: Project Setup

**Goal:** Create the app scaffold and configure the build system.
**Estimated Time:** 1-2 days
**Reference:** See `apps/coordinator/` for patterns

### 0.1 Create App Directory Structure

- [x] **0.1.1** Create `apps/grand-satoshi-exchange/` directory
- [x] **0.1.2** Create `public/assets/sprites/` for pixel art
- [x] **0.1.3** Create `public/assets/fonts/` for bitmap fonts
- [x] **0.1.4** Create `src/components/ui/` for OSRS-styled base components
- [x] **0.1.5** Create `src/components/wallet/` for wallet-specific components
- [x] **0.1.6** Create `src/components/exchange/` for GE-specific components
- [x] **0.1.7** Create `src/components/hardware/` for HW wallet UI
- [x] **0.1.8** Create `src/hooks/` for custom React hooks
- [x] **0.1.9** Create `src/stores/` for Zustand stores
- [x] **0.1.10** Create `src/utils/` for utility functions
- [x] **0.1.11** Create `src/types/` for TypeScript types
- [x] **0.1.12** Create `src/styles/` for global CSS
- [x] **0.1.13** Create `src/routes/` for route components

### 0.2 Configure Package Files

> **Ref:** `apps/coordinator/package.json` for dependency patterns

- [x] **0.2.1** Create `package.json`:
  - Name: `"grand-satoshi-exchange"`
  - Type: `"module"`
  - Private: `true`
  - Engine: `node >=20.18.0 <21.0.0`, `npm >=10.5.0`
- [x] **0.2.2** Add dependencies:
  - `@caravan/bitcoin`, `@caravan/wallets`, `@caravan/psbt`, `@caravan/clients`, `@caravan/multisig` (all `"*"`)
  - `@tanstack/react-query` ^5.x
  - `react`, `react-dom` ^18.x
  - `react-router-dom` ^6.x
  - `zustand` ^4.x
  - `zod` ^3.x
- [x] **0.2.3** Add devDependencies:
  - `@caravan/eslint-config`, `@caravan/typescript-config` (`"*"`)
  - `@vitejs/plugin-react` ^4.x
  - `vite` ^6.x, `vitest` ^1.x
  - `typescript` ^5.x
  - `vite-plugin-node-polyfills`, `vite-plugin-wasm`
- [x] **0.2.4** Add scripts: `dev`, `build`, `preview`, `lint`, `test`, `test:watch`

### 0.3 Configure TypeScript

> **Ref:** `apps/coordinator/tsconfig.json`

- [x] **0.3.1** Create `tsconfig.json` extending `@caravan/typescript-config/base.json`
- [x] **0.3.2** Configure path aliases: `@/*`, `@components/*`, `@hooks/*`, `@stores/*`, `@utils/*`, `@types/*`
- [x] **0.3.3** Create `tsconfig.node.json` for Vite config

### 0.4 Configure Vite

> **Ref:** `apps/coordinator/vite.config.ts` - CRITICAL: includes polyfills for Buffer/process

- [x] **0.4.1** Create `vite.config.ts` with:
  - React plugin
  - `vite-plugin-node-polyfills` with `{ protocolImports: true }`
  - `vite-plugin-wasm` for potential WASM usage
  - Path alias resolution matching tsconfig
  - Build target `esnext`, output to `build/`
- [x] **0.4.2** Create `vitest.config.ts` for test configuration

### 0.5 Configure Linting

- [x] **0.5.1** Create `.eslintrc.cjs` extending `@caravan/eslint-config/app.js`

### 0.6 Create Entry Points

- [x] **0.6.1** Create `index.html`:
  - `<div id="app">` mount point
  - Module script to `src/main.tsx`
  - Meta tags (viewport, charset)
  - Title: "Grand Satoshi Exchange"
- [x] **0.6.2** Create `src/main.tsx`:
  - Import global styles
  - Setup `QueryClientProvider` (React Query)
  - Setup `BrowserRouter` (React Router)
  - Render `<App />` to `#app`
- [x] **0.6.3** Create `src/App.tsx`:
  - Basic `<Routes>` setup
  - Placeholder route components
- [x] **0.6.4** Create `src/vite-env.d.ts` for Vite types

### 0.7 Verify Build System

- [x] **0.7.1** Run `npm install` from monorepo root
- [ ] **0.7.2** Verify `npm run dev` starts Vite dev server (filter: `--filter=grand-satoshi-exchange`)
- [ ] **0.7.3** Verify `npm run build` compiles without errors
- [ ] **0.7.4** Verify `npm run lint` runs ESLint
- [x] **0.7.5** Test importing `@caravan/bitcoin`:
  ```typescript
  import { Network } from "@caravan/bitcoin";
  console.log(Network.MAINNET);
  ```
- [x] **0.7.6** Verify path aliases resolve correctly

### Phase 0 Exit Criteria

- [ ] `npm run dev` shows blank React app at localhost (needs verification)
- [x] TypeScript compiles with strict mode ✓
- [ ] ESLint passes (needs verification)
- [x] Can import and use @caravan/bitcoin Network type ✓
- [x] Turbo recognizes app: `turbo run build --filter=grand-satoshi-exchange` ✓

---

## Phase 1: Core UI Framework

**Goal:** Build the OSRS-styled base components.
**Estimated Time:** 3-5 days
**Reference:** See [UI Design doc](grand-satoshi-exchange-ui-design.md) for specs

### 1.1 Global Styles Setup

> **Ref:** UI Design doc "Color Palette" and "Typography" sections

- [x] **1.1.1** Create `src/styles/reset.css` - CSS reset with `box-sizing: border-box`
- [x] **1.1.2** Create `src/styles/variables.css` - OSRS color palette CSS variables:
  - `--osrs-brown-dark: #3e3529`
  - `--osrs-brown-medium: #5d5349`
  - `--osrs-text-yellow: #ffff00`
  - `--osrs-gold-medium: #c9a227`
  - (see UI Design doc for complete list)
- [x] **1.1.3** Create `src/styles/fonts.css` - Bitmap font setup with fallbacks
- [x] **1.1.4** Create `src/styles/animations.css` - Shared animations (coinDrop, progressFill, celebrate)
- [x] **1.1.5** Create `src/styles/global.css` - Import all styles, set pixel-perfect rendering
- [x] **1.1.6** Import global.css in `main.tsx`

### 1.2 Create Placeholder Assets

- [x] **1.2.1** Create placeholder coin sprite (colored square, 32x32)
- [x] **1.2.2** Create placeholder UI sprite (window borders)
- [x] **1.2.3** Create placeholder icons (send, receive, settings)
- [x] **1.2.4** Document asset requirements for future pixel art creation

### 1.3 Window Component

> **Ref:** UI Design doc "Main Window Frame" layout

- [x] **1.3.1** Create `src/components/ui/Window/Window.tsx`:
  - Props: `title`, `children`, `onClose?`
  - OSRS window frame with title bar
  - Close button (optional)
- [x] **1.3.2** Create `Window.module.css` with OSRS brown borders
- [x] **1.3.3** Create `WindowContent.tsx` - Scrollable content area
- [x] **1.3.4** Export from `src/components/ui/Window/index.ts`

### 1.4 Button Component

- [x] **1.4.1** Create `src/components/ui/Button/Button.tsx`:
  - Props: `children`, `onClick`, `disabled?`, `variant?`
  - States: normal, hover, pressed, disabled
- [x] **1.4.2** Create `Button.module.css` with pixel-art border styling
- [x] **1.4.3** Create `IconButton.tsx` for icon-only buttons
- [x] **1.4.4** Create `TabButton.tsx` for tab navigation
- [x] **1.4.5** Export from index.ts

### 1.5 Input Components

- [x] **1.5.1** Create `src/components/ui/Input/TextInput.tsx`:
  - OSRS-styled text field
  - Props: `value`, `onChange`, `placeholder?`, `label?`
- [x] **1.5.2** Create `NumberInput.tsx`:
  - Numeric input with validation
  - Props: `value`, `onChange`, `min?`, `max?`
- [x] **1.5.3** Create `AddressInput.tsx`:
  - Bitcoin address input with validation using `@caravan/bitcoin`
  - Props: `value`, `onChange`, `network`
  - Validate with `validateAddress()`
- [x] **1.5.4** Create shared input styles
- [x] **1.5.5** Export from index.ts

### 1.6 Display Components

- [x] **1.6.1** Create `src/components/ui/Display/GoldAmount.tsx`:
  - Satoshi amount with coin icon
  - Props: `sats: bigint`, `showBtc?: boolean`
  - Format with K/M/B suffixes like OSRS gold stacks
- [x] **1.6.2** Create `ProgressBar.tsx`:
  - GE-style offer progress bar
  - Props: `current`, `total`, `label?`
- [x] **1.6.3** Create `Tooltip.tsx`:
  - Hover tooltip for item details
  - Props: `content`, `children`
- [x] **1.6.4** Create display styles
- [x] **1.6.5** Export from index.ts

### 1.7 Grid Components (Inventory)

> **Ref:** UI Design doc "Bank View (Inventory Screen)" layout

- [x] **1.7.1** Create `src/components/ui/Grid/InventorySlot.tsx`:
  - Single 36x36 slot
  - Props: `children?`, `selected?`, `onClick?`
  - States: empty, filled, hover, selected
- [x] **1.7.2** Create `ItemStack.tsx`:
  - Item with quantity overlay
  - Props: `icon`, `quantity`, `onClick?`
  - Show quantity in OSRS style (white/cyan/green text based on amount)
- [x] **1.7.3** Create `InventoryGrid.tsx`:
  - 7x4 grid (28 slots like OSRS inventory)
  - Props: `items`, `onItemClick?`, `selectedItems?`
- [x] **1.7.4** Create grid styles with pixel-perfect spacing
- [x] **1.7.5** Export from index.ts

### 1.8 Modal Components

- [x] **1.8.1** Create `src/components/ui/Modal/Modal.tsx`:
  - OSRS-styled dialog overlay
  - Props: `isOpen`, `onClose`, `title`, `children`
  - Portal rendering
- [x] **1.8.2** Create `ConfirmDialog.tsx`:
  - Yes/No confirmation prompt
  - Props: `message`, `onConfirm`, `onCancel`
- [x] **1.8.3** Create modal styles with overlay backdrop
- [x] **1.8.4** Export from index.ts

### 1.9 App Shell

- [x] **1.9.1** Create `src/components/AppShell.tsx`:
  - Main Window wrapper
  - Tab bar with navigation
- [x] **1.9.2** Create tab navigation component:
  - Tabs: Bank, Exchange, History, Settings
  - Active tab styling
- [x] **1.9.3** Integrate with React Router:
  - `/bank` - Bank view
  - `/exchange` - Exchange view
  - `/history` - History view
  - `/settings` - Settings view
  - Default redirect to `/bank`
- [x] **1.9.4** Update `App.tsx` with routes and AppShell

### 1.10 Static Mockups

- [x] **1.10.1** Create `src/routes/Bank.tsx` with fake UTXO data:
  - Total balance display
  - Inventory grid with mock UTXOs
  - Send/Receive/Refresh buttons
- [x] **1.10.2** Create `src/routes/Exchange.tsx` with empty slots:
  - 8 offer slots (2x4 grid)
  - One slot with mock pending offer
  - Collection box area
- [x] **1.10.3** Create `src/routes/History.tsx` placeholder
- [x] **1.10.4** Create `src/routes/Settings.tsx` placeholder
- [x] **1.10.5** Verify visual style matches OSRS aesthetic

### Phase 1 Exit Criteria

- [x] All UI components render correctly ✓
- [x] App shell with working tab navigation ✓
- [x] Static Bank view looks like OSRS bank interface ✓
- [x] Static Exchange view shows GE-style slots ✓
- [x] Pixel-perfect CSS (no anti-aliasing on sprites) ✓

---

## Phase 2: Wallet Integration

**Goal:** Load wallets and display UTXOs.
**Estimated Time:** 3-4 days
**Reference:**

- [Architecture doc](grand-satoshi-exchange-architecture.md) "State Management" section
- `docs/tree/packages/core/multisig.md` for MultisigWalletConfig

### 2.1 TypeScript Types

- [ ] **2.1.1** Create `src/types/wallet.ts`:

  ```typescript
  import { MultisigWalletConfig } from "@caravan/multisig";

  interface AddressSlice {
    bip32Path: string;
    address: string;
    utxos: UTXO[];
    balanceSats: bigint;
    used: boolean;
    isChange: boolean;
    multisig: MultisigDetails;
  }

  interface UTXO {
    txid: string;
    vout: number;
    value: number;
    status: { confirmed: boolean; block_height?: number };
  }
  ```

- [ ] **2.1.2** Create `src/types/transaction.ts` for transaction types
- [ ] **2.1.3** Create `src/types/ui.ts` for UI-specific types

### 2.2 Client Store

> **Ref:** `docs/tree/packages/utility/clients.md` for BlockchainClient API

- [ ] **2.2.1** Create `src/stores/clientStore.ts`:

  ```typescript
  interface ClientState {
    network: "mainnet" | "testnet" | "signet";
    clientType: "public" | "private";
    provider: "mempool" | "blockstream";
    client: BlockchainClient | null;

    setNetwork: (network: Network) => void;
    setProvider: (provider: string) => void;
    initializeClient: () => void;
  }
  ```

- [ ] **2.2.2** Initialize BlockchainClient on store creation
- [ ] **2.2.3** Persist network/provider selection to localStorage
- [ ] **2.2.4** Create `src/hooks/useClient.ts` hook for easy access

### 2.3 Wallet Store

> **Ref:** [Architecture doc](grand-satoshi-exchange-architecture.md) "Wallet Store" section

- [ ] **2.3.1** Create `src/stores/walletStore.ts`:

  ```typescript
  interface WalletState {
    config: MultisigWalletConfig | null;
    deposits: Map<string, AddressSlice>;
    change: Map<string, AddressSlice>;
    isLoading: boolean;
    error: string | null;

    loadWallet: (config: MultisigWalletConfig) => Promise<void>;
    refreshUtxos: () => Promise<void>;
    clearWallet: () => void;

    // Computed (getters)
    get totalBalance(): bigint;
    get allUtxos(): UTXO[];
  }
  ```

- [ ] **2.3.2** Implement `loadWallet`:
  - Validate config with Zod
  - Derive addresses (gap limit: 20 deposit, 20 change)
  - Trigger UTXO fetch
- [ ] **2.3.3** Implement `refreshUtxos`:
  - Fetch UTXOs for all derived addresses
  - Update slices with UTXO data
- [ ] **2.3.4** Persist config to localStorage (consider encryption for mainnet)
- [ ] **2.3.5** Create `src/hooks/useWallet.ts` hook

### 2.4 Address Derivation Utilities

> **Ref:** `docs/tree/packages/core/bip32.md` and `@caravan/bitcoin`

- [ ] **2.4.1** Create `src/utils/address.ts`:

  ```typescript
  import {
    deriveChildPublicKey,
    generateMultisigFromPublicKeys,
  } from "@caravan/bitcoin";

  function deriveAddressAtIndex(
    config: MultisigWalletConfig,
    index: number,
    isChange: boolean,
  ): { address: string; multisig: MultisigDetails };
  ```

- [ ] **2.4.2** Implement address derivation following BIP48 paths:
  - Deposit: `m/0/{index}`
  - Change: `m/1/{index}`
- [ ] **2.4.3** Add caching for derived addresses

### 2.5 UTXO Fetching

> **Ref:** `docs/tree/packages/utility/clients.md` "Address Methods"

- [ ] **2.5.1** Create `src/hooks/useUTXOs.ts` with React Query:
  ```typescript
  const useUTXOs = (addresses: string[]) => {
    const client = useClientStore((state) => state.client);
    return useQuery({
      queryKey: ["utxos", addresses],
      queryFn: () => fetchUtxosForAddresses(client, addresses),
      staleTime: 30_000,
      refetchInterval: 60_000,
    });
  };
  ```
- [ ] **2.5.2** Implement batch UTXO fetching (rate limit aware)
- [ ] **2.5.3** Filter for confirmed UTXOs only

### 2.6 Wallet Import Flow

- [ ] **2.6.1** Create `src/components/wallet/ImportWalletModal.tsx`:
  - File upload (JSON)
  - Paste JSON textarea
  - Validation feedback
- [ ] **2.6.2** Create Zod schema for wallet config validation:
  ```typescript
  const walletConfigSchema = z.object({
    name: z.string().optional(),
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
  ```
- [ ] **2.6.3** Show loading state during UTXO fetch
- [ ] **2.6.4** Handle import errors gracefully

### 2.7 Bank View Implementation

- [ ] **2.7.1** Update `src/routes/Bank.tsx` to use real wallet data:
  - Connect to walletStore
  - Show loading spinner during fetch
  - Display total balance with GoldAmount component
- [ ] **2.7.2** Create `src/components/wallet/UTXOItem.tsx`:
  - Display single UTXO as inventory item
  - Show coin stack based on value
  - Tooltip with txid, confirmations, address
- [ ] **2.7.3** Render UTXOs in InventoryGrid
- [ ] **2.7.4** Add empty state when no wallet loaded
- [ ] **2.7.5** Add "Import Wallet" button that opens ImportWalletModal

### 2.8 Receiving Addresses

- [ ] **2.8.1** Create `src/components/wallet/ReceiveModal.tsx`:
  - Display next unused deposit address
  - QR code (use `qrcode` npm package)
  - Copy address button
  - "New Address" button
- [ ] **2.8.2** Track address usage in wallet store
- [ ] **2.8.3** Add "Receive" button to Bank view that opens modal

### Phase 2 Exit Criteria

- [ ] Can import wallet config JSON
- [ ] UTXOs display in inventory grid
- [ ] Total balance shows correctly
- [ ] Receive modal generates addresses with QR
- [ ] Data persists on page refresh
- [ ] Network switching works (testnet/mainnet)

---

## Phase 3: Transaction Flow

**Goal:** Create and manage pending transactions.
**Estimated Time:** 4-5 days
**Reference:**

- [Architecture doc](grand-satoshi-exchange-architecture.md) "Transaction Store" and "Data Flow" sections
- `docs/tree/packages/wallet/psbt.md` for PSBT creation

### 3.1 Transaction Types

- [ ] **3.1.1** Expand `src/types/transaction.ts`:

  ```typescript
  interface TransactionDraft {
    selectedUtxos: UTXO[];
    destination: string;
    amount: bigint;
    feeRate: number;
    changeAddress: string;
  }

  interface PendingOffer {
    id: string;
    createdAt: Date;
    unsignedPsbt: string;
    signatures: SignatureSet[];
    requiredSignatures: number;
    totalSignatures: number;
    status: "pending" | "signing" | "ready" | "broadcasting";
    destination: string;
    amount: bigint;
    fee: bigint;
  }

  interface CompletedTransaction {
    txid: string;
    completedAt: Date;
    amount: bigint;
    destination: string;
    fee: bigint;
  }
  ```

### 3.2 Transaction Store

- [ ] **3.2.1** Create `src/stores/transactionStore.ts`:

  ```typescript
  interface TransactionState {
    pendingOffers: PendingOffer[];
    currentDraft: TransactionDraft | null;
    history: CompletedTransaction[];

    // Draft actions
    startDraft: () => void;
    selectUtxo: (utxo: UTXO) => void;
    deselectUtxo: (utxo: UTXO) => void;
    setDestination: (address: string) => void;
    setAmount: (sats: bigint) => void;
    setFeeRate: (rate: number) => void;
    createOffer: () => Promise<string>;
    cancelDraft: () => void;

    // Offer actions
    addSignature: (offerId: string, sig: SignatureSet) => void;
    broadcastOffer: (offerId: string) => Promise<string>;
    cancelOffer: (offerId: string) => void;
  }
  ```

- [ ] **3.2.2** Implement draft management actions
- [ ] **3.2.3** Implement offer lifecycle actions
- [ ] **3.2.4** Persist pending offers to localStorage
- [ ] **3.2.5** Create `src/hooks/useTransaction.ts` hook

### 3.3 Fee Estimation

> **Ref:** `docs/tree/packages/utility/clients.md` "Fee Estimation"

- [ ] **3.3.1** Create `src/hooks/useFeeEstimates.ts`:
  ```typescript
  const useFeeEstimates = () => {
    const client = useClientStore((state) => state.client);
    return useQuery({
      queryKey: ["fees"],
      queryFn: async () => ({
        slow: await client.getFeeEstimate(144), // ~24 hours
        standard: await client.getFeeEstimate(6), // ~1 hour
        fast: await client.getFeeEstimate(1), // Next block
      }),
      staleTime: 60_000,
      refetchInterval: 60_000,
    });
  };
  ```
- [ ] **3.3.2** Display fee rates in sat/vB with estimated time

### 3.4 PSBT Generation

> **Ref:** `docs/tree/packages/wallet/psbt.md` "getUnsignedMultisigPsbtV0"

- [ ] **3.4.1** Create `src/utils/psbt.ts`:

  ```typescript
  import { getUnsignedMultisigPsbtV0 } from "@caravan/psbt";

  async function createUnsignedPsbt(
    draft: TransactionDraft,
    walletConfig: MultisigWalletConfig,
    slices: Map<string, AddressSlice>,
  ): Promise<string>;
  ```

- [ ] **3.4.2** Convert UTXOs to PSBT input format:
  - Need `txid`, `index`, `amountSats`, `multisig` details
  - Fetch transaction hex if needed for non-witness UTXOs
- [ ] **3.4.3** Generate change address from next unused change slot
- [ ] **3.4.4** Calculate fee using `@caravan/bitcoin` `estimateMultisigTransactionFee`

### 3.5 Create Offer Modal

> **Ref:** [UI Design doc](grand-satoshi-exchange-ui-design.md) "Create Offer Modal" layout

- [ ] **3.5.1** Create `src/components/exchange/CreateOfferModal.tsx`:
  - Multi-step wizard flow
  - State machine for steps
- [ ] **3.5.2** **Step 1: UTXO Selection**
  - Show inventory with selectable items
  - Track selected UTXOs with checkmarks
  - Display selected total at bottom
- [ ] **3.5.3** **Step 2: Destination**
  - AddressInput with validation
  - Show validation errors inline
- [ ] **3.5.4** **Step 3: Amount**
  - NumberInput for satoshi amount
  - "MAX" button (selected total - estimated fee)
  - Show remaining as change amount
  - Warn if dust output
- [ ] **3.5.5** **Step 4: Fee Selection**
  - Three preset buttons: Slow, Standard, Fast
  - Show fee rate (sat/vB) and estimated time
  - Show total fee in sats
- [ ] **3.5.6** **Step 5: Confirmation**
  - Summary: sending, to, fee, change
  - "Confirm Offer" button creates PSBT
- [ ] **3.5.7** Handle PSBT creation errors
- [ ] **3.5.8** On success, add to pending offers and close modal

### 3.6 Exchange View Implementation

> **Ref:** [UI Design doc](grand-satoshi-exchange-ui-design.md) "Exchange View (GE Slots)" layout

- [ ] **3.6.1** Update `src/routes/Exchange.tsx`:
  - 8 offer slots in 2x4 grid
  - Connect to transactionStore
- [ ] **3.6.2** Create `src/components/exchange/OfferSlot.tsx`:
  ```typescript
  interface OfferSlotProps {
    offer: PendingOffer | null;
    slotNumber: number;
    onSign: () => void;
    onCancel: () => void;
    onBroadcast: () => void;
    onCreateNew: () => void;
  }
  ```
- [ ] **3.6.3** Implement slot states:
  - **Empty**: "Click to create offer" with + icon
  - **Pending**: Amount, destination (truncated), signature progress bar, Sign/Cancel buttons
  - **Ready**: Same as pending but Broadcast button enabled
  - **Broadcasting**: Spinner with "Broadcasting..." text
- [ ] **3.6.4** Create `src/components/exchange/CollectionBox.tsx`:
  - Shows completed transactions ready to "collect" (acknowledge)
  - Clear after user clicks

### 3.7 Coin Selection

- [ ] **3.7.1** Create `src/utils/coinSelection.ts`:
  ```typescript
  function selectCoins(
    utxos: UTXO[],
    targetAmount: bigint,
    feeRate: number,
    addressType: MultisigAddressType,
  ): { selected: UTXO[]; fee: bigint; change: bigint };
  ```
- [ ] **3.7.2** Implement naive selection (largest first)
- [ ] **3.7.3** Add "Auto Select" button to UTXO selection step

### Phase 3 Exit Criteria

- [ ] Can create offer through full wizard flow
- [ ] PSBT generates correctly
- [ ] Pending offers display in Exchange view slots
- [ ] Can cancel pending offers
- [ ] Fee estimation updates periodically
- [ ] Offers persist on refresh

---

## Phase 4: Hardware Wallet Signing

**Goal:** Sign transactions with Ledger and Trezor.
**Estimated Time:** 3-4 days
**Reference:**

- `docs/tree/packages/wallet/wallets.md` for SignMultisigTransaction API
- [Coordinator Reuse doc](grand-satoshi-exchange-coordinator-reuse.md) "Hardware Wallet Flow"

### 4.1 Hardware Wallet Hook

> **Ref:** `docs/tree/packages/wallet/wallets.md` "SignMultisigTransaction"

- [ ] **4.1.1** Create `src/hooks/useHardwareWallet.ts`:

  ```typescript
  interface UseHardwareWallet {
    status: "idle" | "connecting" | "signing" | "success" | "error";
    error: Error | null;

    signWithLedger: (
      psbt: string,
      config: MultisigWalletConfig,
    ) => Promise<SignatureSet>;
    signWithTrezor: (
      psbt: string,
      config: MultisigWalletConfig,
    ) => Promise<SignatureSet>;
    reset: () => void;
  }
  ```

- [ ] **4.1.2** Implement `signWithLedger`:

  ```typescript
  import { SignMultisigTransaction } from "@caravan/wallets";

  const signatures = await SignMultisigTransaction({
    keystore: "LEDGER",
    network: config.network,
    psbt: psbtBase64,
    walletConfig: config,
    returnSignatureArray: true,
  });
  ```

- [ ] **4.1.3** Implement `signWithTrezor` (same pattern, different keystore)
- [ ] **4.1.4** Handle device connection errors
- [ ] **4.1.5** Handle user rejection

### 4.2 Ledger Policy Registration

> **Ref:** `docs/tree/packages/wallet/wallets.md` "Ledger Policy Registration"

- [ ] **4.2.1** Create `src/utils/ledger.ts`:

  ```typescript
  import { RegisterWalletPolicy } from "@caravan/wallets";

  async function ensureLedgerPolicyRegistered(
    config: MultisigWalletConfig,
  ): Promise<MultisigWalletConfig>;
  ```

- [ ] **4.2.2** Check if `ledgerPolicyHmacs` exists in config
- [ ] **4.2.3** If not, prompt user to register on device
- [ ] **4.2.4** Store returned `policyHmac` in wallet config
- [ ] **4.2.5** Update persisted config with HMAC

### 4.3 Signing Modal

> **Ref:** [UI Design doc](grand-satoshi-exchange-ui-design.md) "Signing Modal" layout

- [ ] **4.3.1** Create `src/components/hardware/SigningModal.tsx`:
  - Props: `isOpen`, `onClose`, `offer: PendingOffer`, `onSignatureCollected`
- [ ] **4.3.2** **Device Selection UI**:
  - Ledger button with pixelated icon
  - Trezor button with pixelated icon
  - Show which devices already signed
- [ ] **4.3.3** **Connection Instructions**:
  1. Connect your hardware wallet
  2. Open the Bitcoin app
  3. Review the transaction on your device
  4. Confirm if details are correct
- [ ] **4.3.4** **Signing Progress States**:
  - "Connecting to device..."
  - "Review transaction on device"
  - "Signing..."
  - "Signature collected!" (success)
  - Error state with retry button
- [ ] **4.3.5** **Transaction Details Display**:
  - Sending amount
  - Destination address
  - Fee (sats and sat/vB)
- [ ] **4.3.6** Handle Ledger policy registration inline if needed

### 4.4 Signature Management

- [ ] **4.4.1** Update transactionStore `addSignature`:
  - Validate signature
  - Add to offer's signature array
  - Track which signer (by xfp) signed
  - Update offer status if quorum reached
- [ ] **4.4.2** Create signature validation utility:
  ```typescript
  import { validateMultisigPsbtSignature } from "@caravan/psbt";
  ```
- [ ] **4.4.3** Update OfferSlot progress bar to show `{collected}/{required}`
- [ ] **4.4.4** Enable Broadcast button when `signatures.length >= requiredSigners`

### 4.5 Error Handling

- [ ] **4.5.1** Create error message mappings for common errors:
  - "Device not connected" → "Please connect your hardware wallet and try again"
  - "Wrong app" → "Please open the Bitcoin app on your device"
  - "User rejected" → "Transaction was rejected on device"
  - "Communication error" → "Lost connection to device. Please reconnect."
- [ ] **4.5.2** Add retry button for recoverable errors
- [ ] **4.5.3** Log errors for debugging (console in dev, optional error reporting)

### Phase 4 Exit Criteria

- [ ] Ledger signing works end-to-end
- [ ] Trezor signing works end-to-end
- [ ] Signature progress shows correctly
- [ ] Ledger policy registration handled seamlessly
- [ ] Errors show helpful messages with retry

---

## Phase 5: Polish & Testing

**Goal:** Finalize MVP quality.
**Estimated Time:** 2-3 days

### 5.1 Broadcast Flow

> **Ref:** `docs/tree/packages/wallet/psbt.md` "finalize()" and `docs/tree/packages/utility/clients.md` "broadcastTransaction"

- [ ] **5.1.1** Create `src/utils/broadcast.ts`:

  ```typescript
  import { PsbtV2 } from "@caravan/psbt";

  async function broadcastTransaction(
    psbt: string,
    signatures: SignatureSet[],
    client: BlockchainClient,
  ): Promise<string>; // returns txid
  ```

- [ ] **5.1.2** Implement PSBT finalization:
  - Add all signatures to PSBT
  - Call `psbt.finalize()`
  - Extract raw transaction hex
- [ ] **5.1.3** Broadcast via client
- [ ] **5.1.4** Handle broadcast errors (dust, insufficient fee, etc.)
- [ ] **5.1.5** On success:
  - Show "Offer Complete!" celebration modal
  - Move offer to history
  - Trigger UTXO refresh

### 5.2 Offer Complete Animation

> **Ref:** [UI Design doc](grand-satoshi-exchange-ui-design.md) "Offer Complete Animation"

- [ ] **5.2.1** Create `src/components/exchange/OfferCompleteModal.tsx`:
  - "OFFER COMPLETE!" banner
  - Coin animation
  - Transaction summary
  - "View on Explorer" link
  - "OK" button to dismiss
- [ ] **5.2.2** Link to appropriate block explorer:
  - Mainnet: mempool.space
  - Testnet: mempool.space/testnet
  - Signet: mempool.space/signet

### 5.3 History View

- [ ] **5.3.1** Update `src/routes/History.tsx`:
  - List completed transactions from transactionStore.history
  - Sort by date (newest first)
- [ ] **5.3.2** Create `src/components/exchange/TransactionItem.tsx`:
  - Date/time
  - Amount sent (with coin icon)
  - Destination (truncated with copy button)
  - Txid (linked to explorer)
  - Confirmation count (if API available)
- [ ] **5.3.3** Add empty state: "No transactions yet"
- [ ] **5.3.4** Persist history to localStorage

### 5.4 Settings View

- [ ] **5.4.1** Update `src/routes/Settings.tsx`:
- [ ] **5.4.2** **Network Selection**:
  - Radio buttons: Mainnet, Testnet, Signet
  - Warning when switching networks (will clear wallet)
- [ ] **5.4.3** **Client Provider Selection**:
  - Radio buttons: Mempool, Blockstream
  - (Future: Private node option)
- [ ] **5.4.4** **Wallet Management**:
  - "Export Wallet Config" button (download JSON)
  - "Clear Wallet" button with confirmation
- [ ] **5.4.5** **About Section**:
  - Version number
  - Links to documentation
  - Credits

### 5.5 Asset Polish

- [ ] **5.5.1** Create or acquire OSRS-inspired pixel art:
  - Gold coin sprites (10 stack sizes)
  - Window borders and chrome
  - Button states
  - Icons (send, receive, settings, etc.)
- [ ] **5.5.2** Create hardware wallet icons (pixelated Ledger/Trezor)
- [ ] **5.5.3** Add animations:
  - Coin drop on receive
  - Progress bar fill
  - Celebration sparkles
- [ ] **5.5.4** Test all sprites at 1x, 1.5x, 2x scale
- [ ] **5.5.5** Ensure no anti-aliasing (crisp pixels)

### 5.6 Testing

- [ ] **5.6.1** Create unit tests for stores:
  - `walletStore.test.ts`
  - `transactionStore.test.ts`
  - `clientStore.test.ts`
- [ ] **5.6.2** Create unit tests for utilities:
  - `address.test.ts`
  - `psbt.test.ts`
  - `coinSelection.test.ts`
- [ ] **5.6.3** Create integration tests:
  - Wallet loading flow
  - Transaction creation flow
  - PSBT generation accuracy
- [ ] **5.6.4** Manual testing checklist:
  - [ ] Import wallet on testnet
  - [ ] View UTXOs
  - [ ] Create transaction
  - [ ] Sign with Ledger (if available)
  - [ ] Sign with Trezor (if available)
  - [ ] Broadcast transaction
  - [ ] Verify on explorer
- [ ] **5.6.5** Test error scenarios:
  - Invalid wallet config
  - Invalid address
  - Insufficient balance
  - Device disconnection mid-sign

### 5.7 Documentation

- [ ] **5.7.1** Create `apps/grand-satoshi-exchange/README.md`:
  - Project description
  - Setup instructions
  - Development commands
  - Architecture overview
- [ ] **5.7.2** Add inline code documentation
- [ ] **5.7.3** Create usage guide with screenshots
- [ ] **5.7.4** Document known limitations

### Phase 5 Exit Criteria

- [ ] Full transaction lifecycle works (create → sign → broadcast)
- [ ] Testnet verified end-to-end
- [ ] All unit tests pass
- [ ] Visual polish complete
- [ ] README documentation complete

---

## Final MVP Checklist

### Functionality

- [ ] Import multisig wallet config (JSON)
- [ ] View UTXOs in inventory grid
- [ ] View total balance
- [ ] Create send transaction (select UTXOs, destination, amount, fee)
- [ ] Sign with Ledger
- [ ] Sign with Trezor
- [ ] Broadcast transaction
- [ ] View transaction history
- [ ] Generate receiving addresses

### Quality

- [ ] No crashes on happy path
- [ ] Clear error messages
- [ ] Testnet verified
- [ ] TypeScript strict mode passes
- [ ] ESLint passes
- [ ] Basic test coverage

### Visual

- [ ] OSRS-authentic aesthetic
- [ ] Pixel-perfect sprites
- [ ] Consistent visual language
- [ ] Responsive within minimum size (800x600)

---

## Post-MVP Enhancements

For tracking future work after MVP:

### v1.0 Features

- [ ] Multiple pending transaction slots (full 8 GE slots)
- [ ] Fee rate selection with custom input
- [ ] Address book (saved destinations)
- [ ] Manual UTXO coin selection
- [ ] Export/import wallet configs

### Future Features

- [ ] Coldcard support (file-based PSBT)
- [ ] Fee bumping (RBF/CPFP) using `@caravan/transactions`
- [ ] Privacy analysis using `@caravan/health`
- [ ] Sound effects (OSRS-style)
- [ ] Achievement system
- [ ] Private node connection
