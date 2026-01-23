# Grand Satoshi Exchange - Project Overview

> Bitcoin Multisig Wallet Manager with Old School RuneScape Grand Exchange UI

## Project Vision

A new application in the Caravan monorepo (`apps/grand-satoshi-exchange`) that provides Bitcoin multisig wallet management through an interface that captures the essence and feel of Old School RuneScape's Grand Exchange.

### Core Philosophy

- **Full OSRS Recreation**: Pixel-perfect GE interface, authentic fonts, window chrome, inventory grids
- **Bitcoin as Gold**: OSRS gold coin imagery represents satoshis/bitcoin
- **Transactions as Trading**: Sending bitcoin feels like placing offers on the Grand Exchange
- **UTXOs as Inventory**: Your bitcoin UTXOs displayed as items in an inventory grid

## Key Decisions Made

| Decision         | Choice                     | Rationale                                                    |
| ---------------- | -------------------------- | ------------------------------------------------------------ |
| Visual Fidelity  | Full OSRS Recreation       | Pixel-perfect GE interface, OSRS fonts, window chrome        |
| Core Features    | Essential Operations       | Wallet management, tx creation, HW signing, broadcasting     |
| Tech Stack       | React + Vite               | Consistent with coordinator, easier component reuse          |
| UX Metaphor      | Inventory Management       | UTXOs as inventory grid, drag-drop to sell, receive to bank  |
| Hardware Wallets | Ledger + Trezor only       | Most common devices, faster implementation                   |
| Asset Strategy   | Create Original Assets     | Design new pixel art inspired by OSRS (legally safe, unique) |
| App Name         | **Grand Satoshi Exchange** | Direct GE reference + Bitcoin creator homage                 |

## Concept Mapping: OSRS → Bitcoin

| OSRS Concept              | Bitcoin Equivalent      | Implementation Notes                                 |
| ------------------------- | ----------------------- | ---------------------------------------------------- |
| Gold Coins (GP)           | Satoshis                | Stack display like GP stacks (1, 100, 10k, 1M, etc.) |
| Inventory Grid (28 slots) | UTXO Set                | Each UTXO = one "item" with satoshi amount           |
| Bank Interface            | Full Wallet View        | All addresses, all UTXOs, organized tabs             |
| Grand Exchange Slots (8)  | Pending Transactions    | Unsigned/partially signed PSBTs awaiting completion  |
| Place Sell Offer          | Create Send Transaction | Select UTXOs, set destination, set amount            |
| Collect Items             | Claim Received Bitcoin  | New UTXOs at receiving addresses                     |
| Trade History             | Transaction History     | Broadcast transactions with confirmations            |
| Collection Box            | Receiving Addresses     | Fresh addresses for incoming payments                |
| Offer Progress Bar        | Signature Progress      | 1/2, 2/3 signatures collected                        |
| "Offer Complete!"         | Transaction Broadcast   | Celebration animation when tx confirms               |

## Feature Scope

### Must Have (MVP)

- [ ] Load/create multisig wallet configuration
- [ ] Display UTXOs as inventory items
- [ ] Create send transactions (place sell offers)
- [ ] Sign with Ledger hardware wallet
- [ ] Sign with Trezor hardware wallet
- [ ] Broadcast transactions
- [ ] View transaction history
- [ ] Generate receiving addresses

### Should Have (v1.0)

- [ ] Multiple pending transaction slots
- [ ] Fee rate selection (priority tiers)
- [ ] Address book (saved destinations)
- [ ] UTXO coin selection (manual item selection)
- [ ] Export/import wallet configs

### Nice to Have (Future)

- [ ] Coldcard support (file-based)
- [ ] Fee bumping (RBF/CPFP)
- [ ] Privacy analysis (health metrics)
- [ ] Sound effects (OSRS sounds)
- [ ] Achievement system for milestones

## Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│                  Grand Satoshi Exchange                      │
├─────────────────────────────────────────────────────────────┤
│  UI Layer                                                    │
│  ├── React 18 + TypeScript                                  │
│  ├── Vite (build tool)                                      │
│  ├── Custom pixel art CSS (no Material-UI)                  │
│  ├── Canvas/WebGL for animations                            │
│  └── Zustand or Redux Toolkit (state)                       │
├─────────────────────────────────────────────────────────────┤
│  Caravan Packages                                            │
│  ├── @caravan/bitcoin    (core utilities)                   │
│  ├── @caravan/wallets    (HW wallet interactions)           │
│  ├── @caravan/psbt       (PSBT handling)                    │
│  ├── @caravan/clients    (blockchain API)                   │
│  └── @caravan/multisig   (wallet config types)              │
├─────────────────────────────────────────────────────────────┤
│  External                                                    │
│  ├── React Query (server state)                             │
│  ├── React Router (navigation)                              │
│  └── Zod (validation)                                       │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure (Proposed)

```
apps/grand-satoshi-exchange/
├── public/
│   └── assets/
│       ├── sprites/           # Pixel art spritesheets
│       ├── fonts/             # OSRS-style bitmap fonts
│       └── sounds/            # (future) Sound effects
├── src/
│   ├── components/
│   │   ├── ui/               # Base OSRS UI components
│   │   │   ├── Window/       # OSRS window frame
│   │   │   ├── Button/       # Pixel art buttons
│   │   │   ├── Input/        # Text input fields
│   │   │   ├── Inventory/    # 28-slot grid
│   │   │   └── ProgressBar/  # Offer progress
│   │   ├── wallet/           # Wallet-specific
│   │   │   ├── Bank/         # Full wallet view
│   │   │   ├── UTXOItem/     # Single UTXO display
│   │   │   └── AddressSlot/  # Receiving address
│   │   ├── exchange/         # GE-specific
│   │   │   ├── OfferSlot/    # Pending tx slot
│   │   │   ├── SellOffer/    # Create send tx
│   │   │   ├── CollectionBox/# Incoming payments
│   │   │   └── History/      # Transaction log
│   │   └── hardware/         # HW wallet UI
│   │       ├── DeviceConnect/
│   │       └── SigningModal/
│   ├── hooks/                # Custom React hooks
│   ├── stores/               # Zustand stores
│   ├── utils/                # Utility functions
│   ├── types/                # TypeScript types
│   ├── styles/               # Global CSS/pixel art
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## UI Screens (Main Views)

### 1. Bank View (Main Screen)

- OSRS bank interface aesthetic
- Tabs for different address types/slices
- UTXO grid showing all holdings
- Total balance in "GP" style display
- Quick actions: Send, Receive, History

### 2. Grand Exchange View

- 8 offer slots (like real GE)
- Each slot shows pending transaction status
- Progress bars for signature collection
- "Collect" button for completed trades

### 3. Create Offer (Send Transaction)

- Select items (UTXOs) from inventory
- Enter destination address
- Set amount (with max button)
- Fee selection (slow/medium/fast)
- Review and confirm

### 4. Signing Modal

- Hardware wallet connection UI
- Device selection (Ledger/Trezor)
- Sign prompt with transaction details
- Progress indicator

### 5. Collection Box (Receive)

- List of receiving addresses
- QR code display
- Copy address button
- "Fresh address" generation

## Asset Requirements

### Pixel Art Needed

1. **Gold coin sprites** - Various stack sizes (1, 5, 25, 100, 1K, 10K, 1M, 10M, 100M, 1B)
2. **Window frames** - OSRS-style borders and chrome
3. **Buttons** - Normal, hover, pressed states
4. **Icons** - Send, receive, settings, history, wallet, exchange
5. **Inventory slot** - Empty and highlighted states
6. **Progress bar** - GE-style offer progress
7. **Background textures** - Stone, parchment, wood
8. **Hardware wallet icons** - Pixelated Ledger/Trezor
9. **Confirmation badges** - 1-conf, 2-conf, 3+conf indicators
10. **Status indicators** - Pending, signed, broadcast, confirmed

### Font Requirements

- OSRS-style bitmap font (or similar open-source)
- Number font for amounts
- Consider: Press Start 2P, Pixelify Sans, or custom

## Success Criteria

### Technical

- [ ] Successful transaction creation and broadcast
- [ ] Hardware wallet signing works reliably
- [ ] State persists across sessions
- [ ] Responsive to different screen sizes (within reason)

### UX

- [ ] Feels like using the Grand Exchange
- [ ] Clear feedback on all operations
- [ ] Intuitive for OSRS players
- [ ] Sufficient for Bitcoin operations

### Visual

- [ ] Authentic OSRS pixel art aesthetic
- [ ] Consistent visual language throughout
- [ ] Animations feel right (not too modern)
- [ ] Gold = Bitcoin association is clear
