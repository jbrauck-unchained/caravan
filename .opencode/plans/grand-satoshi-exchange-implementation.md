# Grand Satoshi Exchange - Implementation Plan

## Phase Overview

```
Phase 0: Project Setup (1-2 days)
    │
    ▼
Phase 1: Core UI Framework (3-5 days)
    │
    ▼
Phase 2: Wallet Integration (3-4 days)
    │
    ▼
Phase 3: Transaction Flow (4-5 days)
    │
    ▼
Phase 4: Hardware Wallet Signing (3-4 days)
    │
    ▼
Phase 5: Polish & Testing (2-3 days)
    │
    ▼
MVP Complete (~16-23 days)
```

---

## Phase 0: Project Setup

**Goal:** Create the app scaffold and configure the build system.

### Tasks

#### 0.1 Create App Directory Structure

```bash
apps/grand-satoshi-exchange/
├── public/
│   └── assets/
│       ├── sprites/
│       └── fonts/
├── src/
│   ├── components/
│   ├── hooks/
│   ├── stores/
│   ├── utils/
│   ├── types/
│   ├── styles/
│   ├── routes/
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

#### 0.2 Configure package.json

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
    "@tanstack/react-query": "^5.17.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.0",
    "zustand": "^4.4.7",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@caravan/eslint-config": "*",
    "@caravan/typescript-config": "*",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "vitest": "^1.1.0"
  }
}
```

#### 0.3 Configure TypeScript

```json
// tsconfig.json
{
  "extends": "@caravan/typescript-config/base.json",
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@components/*": ["./src/components/*"],
      "@hooks/*": ["./src/hooks/*"],
      "@stores/*": ["./src/stores/*"],
      "@utils/*": ["./src/utils/*"],
      "@types/*": ["./src/types/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

#### 0.4 Configure Vite

```typescript
// vite.config.ts
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
});
```

#### 0.5 Create Entry Points

- `index.html` - Basic HTML shell
- `src/main.tsx` - React entry with providers
- `src/App.tsx` - Router setup

#### 0.6 Verify Build

```bash
npm install
npm run dev
# Should see blank app running
```

### Deliverables

- [ ] Working Vite dev server
- [ ] TypeScript compiling
- [ ] Path aliases working
- [ ] Caravan packages importable

---

## Phase 1: Core UI Framework

**Goal:** Build the OSRS-styled base components.

### Tasks

#### 1.1 Global Styles Setup

```
src/styles/
├── reset.css       # CSS reset
├── variables.css   # OSRS color palette
├── fonts.css       # Bitmap font setup
├── animations.css  # Shared animations
└── global.css      # Global styles
```

#### 1.2 Create Placeholder Assets

- Temporary colored squares for sprites
- System font fallback until custom font ready
- Can iterate on real assets later

#### 1.3 Build Base UI Components

**Window Component** (`components/ui/Window/`)

- `Window.tsx` - Main frame with title bar
- `WindowHeader.tsx` - Draggable header (optional)
- `WindowContent.tsx` - Scrollable content area

**Button Component** (`components/ui/Button/`)

- `Button.tsx` - Standard clickable button
- States: normal, hover, pressed, disabled
- Pixel-art border styling

**Input Components** (`components/ui/Input/`)

- `TextInput.tsx` - Basic text input
- `NumberInput.tsx` - Numeric with validation
- `AddressInput.tsx` - Bitcoin address with validation

**Display Components** (`components/ui/Display/`)

- `GoldAmount.tsx` - Satoshi amount with coin icon
- `ProgressBar.tsx` - Offer progress
- `Tooltip.tsx` - Hover information

**Grid Components** (`components/ui/Grid/`)

- `InventoryGrid.tsx` - 7x4 UTXO grid (28 slots)
- `InventorySlot.tsx` - Single slot
- `ItemStack.tsx` - Item with quantity overlay

**Modal Component** (`components/ui/Modal/`)

- `Modal.tsx` - Overlay dialog
- `ConfirmDialog.tsx` - Yes/No confirmation

#### 1.4 Create App Shell

- Main window frame
- Tab navigation (Bank, Exchange, History, Settings)
- Router integration

#### 1.5 Build Static Mockups

- Bank view with fake data
- Exchange view with empty slots
- Verify visual style is correct

### Deliverables

- [ ] Complete UI component library
- [ ] App shell with navigation
- [ ] Static mockups looking OSRS-authentic
- [ ] Component documentation (Storybook optional)

---

## Phase 2: Wallet Integration

**Goal:** Load wallets and display UTXOs.

### Tasks

#### 2.1 Create Zustand Stores

**Wallet Store** (`stores/walletStore.ts`)

```typescript
interface WalletStore {
  config: MultisigWalletConfig | null;
  deposits: Map<string, AddressSlice>;
  change: Map<string, AddressSlice>;
  isLoading: boolean;
  error: string | null;

  loadWallet: (config: MultisigWalletConfig) => Promise<void>;
  refreshUtxos: () => Promise<void>;
  clearWallet: () => void;

  // Computed
  totalBalance: bigint;
  allUtxos: UTXO[];
}
```

**Client Store** (`stores/clientStore.ts`)

```typescript
interface ClientStore {
  network: "mainnet" | "testnet" | "signet";
  clientType: "public" | "private";
  provider: "mempool" | "blockstream";
  client: BlockchainClient | null;

  setNetwork: (network: Network) => void;
  setProvider: (provider: string) => void;
  initializeClient: () => void;
}
```

#### 2.2 Create Custom Hooks

**useWallet** (`hooks/useWallet.ts`)

- Access wallet store
- Derived calculations
- UTXO queries

**useClient** (`hooks/useClient.ts`)

- Access blockchain client
- Connection status

**useUTXOs** (`hooks/useUTXOs.ts`)

- React Query for UTXO fetching
- Cache management
- Refetch logic

#### 2.3 Wallet Import Flow

1. **Import Modal**

   - File upload or paste JSON
   - Validate with Zod
   - Show validation errors

2. **Post-Import**

   - Store config in Zustand
   - Derive first N addresses (configurable gap limit)
   - Fetch UTXOs for all addresses

3. **Persistence**
   - Store config in localStorage (encrypted?)
   - Auto-load on app start

#### 2.4 Bank View Implementation

- Display total balance
- Render UTXO inventory grid
- Each UTXO shows:
  - Coin stack sprite (based on value)
  - Satoshi amount
  - Tooltip with details (txid, confirmations)

#### 2.5 Receiving Addresses

- Generate new address button
- Display address with QR code
- Copy to clipboard functionality

### Deliverables

- [ ] Working wallet import
- [ ] UTXO display in inventory
- [ ] Balance calculation
- [ ] Receive address generation
- [ ] Data persists on refresh

---

## Phase 3: Transaction Flow

**Goal:** Create and manage pending transactions.

### Tasks

#### 3.1 Transaction Store

**Transaction Store** (`stores/transactionStore.ts`)

```typescript
interface TransactionStore {
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
  createOffer: () => Promise<string>; // Returns offer ID
  cancelDraft: () => void;

  // Offer actions
  addSignature: (offerId: string, sig: SignatureSet) => void;
  broadcastOffer: (offerId: string) => Promise<string>; // Returns txid
  cancelOffer: (offerId: string) => void;
}
```

#### 3.2 Create Offer Modal

**Step 1: UTXO Selection**

- Show inventory with selectable items
- Track selected UTXOs
- Display selected total

**Step 2: Destination**

- Address input with validation
- Optional address book integration

**Step 3: Amount**

- Satoshi input
- "Max" button (all selected minus fee)
- Show remaining as change

**Step 4: Fee Selection**

- Three presets: Slow, Standard, Fast
- Show estimated confirmation time
- Show fee in sats and sat/vB
- React Query for fee estimates

**Step 5: Confirmation**

- Summary of transaction
- Final review before creating

#### 3.3 PSBT Generation

Using `@caravan/psbt`:

```typescript
async function createPsbt(
  draft: TransactionDraft,
  walletConfig: MultisigWalletConfig,
): Promise<string> {
  const inputs = draft.selectedUtxos.map(utxoToInput);
  const outputs = [
    { address: draft.destination, amountSats: draft.amount },
    { address: changeAddress, amountSats: draft.change },
  ];

  return getUnsignedMultisigPsbtV0({
    network: walletConfig.network,
    inputs,
    outputs,
  });
}
```

#### 3.4 Exchange View Implementation

- 8 offer slots (like real GE)
- Each slot shows:
  - Status (empty, pending, ready)
  - Amount being sent
  - Destination (truncated)
  - Signature progress bar
  - Action buttons (Sign, Cancel, Broadcast)

#### 3.5 Offer Slot Component

```typescript
interface OfferSlotProps {
  offer: PendingOffer | null;
  onSign: () => void;
  onCancel: () => void;
  onBroadcast: () => void;
  onCreateNew: () => void;
}
```

Display states:

- Empty: "Click to create offer"
- Pending: Show details + Sign button
- Ready: Show details + Broadcast button
- Broadcasting: Show spinner

### Deliverables

- [ ] Create offer flow working
- [ ] PSBT generation correct
- [ ] Pending offers displayed
- [ ] Offer management (cancel, etc.)
- [ ] Fee estimation working

---

## Phase 4: Hardware Wallet Signing

**Goal:** Sign transactions with Ledger and Trezor.

### Tasks

#### 4.1 Hardware Wallet Hook

**useHardwareWallet** (`hooks/useHardwareWallet.ts`)

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
}
```

#### 4.2 Signing Modal

**Device Selection**

- Ledger button with icon
- Trezor button with icon
- Show connection instructions

**Signing Progress**

- Connection status
- "Review on device" prompt
- Success/failure feedback

**Integration with @caravan/wallets**

```typescript
const signatures = await SignMultisigTransaction({
  keystore: "LEDGER", // or 'TREZOR'
  network: config.network,
  psbt: unsignedPsbt,
  walletConfig: config,
  returnSignatureArray: true,
});
```

#### 4.3 Signature Management

- Store signatures in offer
- Track which signers have signed
- Update progress bar
- Enable broadcast when quorum met

#### 4.4 Ledger-Specific: Policy Registration

For Ledger devices (especially newer firmware):

```typescript
// May need to register policy first
const registration = await RegisterWalletPolicy({
  keystore: "LEDGER",
  walletConfig: config,
});

// Store HMAC for future signing
config.ledgerPolicyHmacs.push({
  xfp: myXfp,
  policyHmac: registration.policyHmac,
});
```

#### 4.5 Error Handling

Common errors to handle:

- Device not connected
- Wrong app open
- User rejected
- Communication error
- Invalid signature

Show user-friendly messages with retry options.

### Deliverables

- [ ] Ledger signing working
- [ ] Trezor signing working
- [ ] Signature progress tracking
- [ ] Error handling with recovery
- [ ] Policy registration for Ledger

---

## Phase 5: Polish & Testing

**Goal:** Finalize MVP quality.

### Tasks

#### 5.1 Broadcast Flow

**Finalize PSBT**

```typescript
// Combine all signatures and finalize
const finalizedPsbt = finalizePsbt(unsignedPsbt, signatures);
const rawTx = extractTransaction(finalizedPsbt);
```

**Broadcast**

```typescript
const txid = await client.broadcastTransaction(rawTx);
```

**Post-Broadcast**

- Show "Offer Complete!" celebration
- Link to block explorer
- Move to history
- Refresh UTXOs

#### 5.2 History View

- List of completed transactions
- Each shows:
  - Date/time
  - Amount sent
  - Destination
  - Txid (linked to explorer)
  - Confirmation count

#### 5.3 Settings View

- Network selection (mainnet/testnet)
- Client provider selection
- Clear wallet option
- Export wallet config
- About/version info

#### 5.4 Asset Polish

- Create final pixel art sprites
- Gold coin stack variations
- UI elements
- Hardware wallet icons
- Animations

#### 5.5 Testing

**Unit Tests**

- Store logic
- Utility functions
- Validation

**Integration Tests**

- Wallet loading
- Transaction creation
- PSBT handling

**Manual Testing**

- Full flows on testnet
- Hardware wallet testing
- Error scenarios

#### 5.6 Documentation

- README with setup instructions
- Usage guide
- Screenshots/GIFs

### Deliverables

- [ ] Full transaction lifecycle working
- [ ] Polish complete
- [ ] Tests passing
- [ ] Documentation complete
- [ ] Ready for release

---

## Risk Mitigation

### Technical Risks

| Risk                   | Mitigation                                    |
| ---------------------- | --------------------------------------------- |
| Package API mismatches | Verify actual exports before coding           |
| Hardware wallet issues | Test early, have fallback to text import      |
| PSBT complexity        | Rely on @caravan/psbt, study coordinator      |
| Browser compatibility  | Target modern browsers only (Chrome, Firefox) |

### Design Risks

| Risk              | Mitigation                                     |
| ----------------- | ---------------------------------------------- |
| OSRS IP concerns  | Create original assets inspired by, not copied |
| Complex UX        | Keep flows simple, add complexity later        |
| Pixel art quality | Start with placeholders, iterate               |

### Schedule Risks

| Risk                | Mitigation                                 |
| ------------------- | ------------------------------------------ |
| Scope creep         | Strict MVP scope, future phases for extras |
| Asset creation time | Use placeholders, polish later             |
| Testing time        | Automate what's possible                   |

---

## Success Metrics

### MVP Complete When:

1. Can import a multisig wallet config
2. Can view UTXOs in inventory
3. Can create a send transaction
4. Can sign with Ledger OR Trezor
5. Can broadcast transaction
6. UI has authentic OSRS feel

### Quality Bar:

- No crashes on happy path
- Clear error messages
- Testnet verified
- Code is clean and typed
