# Grand Satoshi Exchange

> Bitcoin Multisig Wallet Manager with Old School RuneScape Grand Exchange UI

A new application in the Caravan monorepo that provides Bitcoin multisig wallet management through an interface that captures the essence and feel of Old School RuneScape's Grand Exchange.

## Features (Planned)

- **OSRS-Authentic UI**: Pixel-perfect Grand Exchange interface recreation
- **Multisig Wallet Management**: Load and manage Bitcoin multisig wallets
- **UTXO Display**: View your bitcoin UTXOs as items in an inventory grid
- **Transaction Creation**: Create send transactions through a GE-style offer flow
- **Hardware Wallet Support**: Sign with Ledger and Trezor devices
- **Broadcasting**: Broadcast transactions to the Bitcoin network

## Development

### Prerequisites

- Node.js >=20.18.0 <21.0.0
- npm >=10.5.0

### Getting Started

From the monorepo root:

```bash
# Install dependencies
npm install

# Start development server
npm run dev --workspace=grand-satoshi-exchange

# Or using turbo
npx turbo run dev --filter=grand-satoshi-exchange
```

### Build

```bash
# Build for production
npm run build --workspace=grand-satoshi-exchange

# Or using turbo
npx turbo run build --filter=grand-satoshi-exchange
```

### Testing

```bash
# Run tests
npm run test --workspace=grand-satoshi-exchange

# Run tests in watch mode
npm run test:watch --workspace=grand-satoshi-exchange
```

### Linting

```bash
npm run lint --workspace=grand-satoshi-exchange
```

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **Zustand** - State management
- **React Query** - Server state management
- **React Router** - Client-side routing
- **Zod** - Runtime validation

### Caravan Packages

- `@caravan/bitcoin` - Core Bitcoin utilities
- `@caravan/multisig` - Multisig wallet configuration
- `@caravan/wallets` - Hardware wallet interactions
- `@caravan/psbt` - PSBT creation and signing
- `@caravan/clients` - Blockchain API clients

## Project Structure

```
apps/grand-satoshi-exchange/
├── public/
│   └── assets/
│       ├── sprites/           # Pixel art spritesheets
│       └── fonts/             # OSRS-style bitmap fonts
├── src/
│   ├── components/
│   │   ├── ui/               # Base OSRS UI components
│   │   ├── wallet/           # Wallet-specific components
│   │   ├── exchange/         # GE-specific components
│   │   └── hardware/         # Hardware wallet UI
│   ├── hooks/                # Custom React hooks
│   ├── stores/               # Zustand stores
│   ├── utils/                # Utility functions
│   ├── types/                # TypeScript types
│   ├── styles/               # Global CSS
│   ├── routes/               # Route components
│   ├── App.tsx               # Main app component
│   └── main.tsx              # Entry point
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Documentation

For detailed planning and implementation docs, see:

- `.opencode/plans/grand-satoshi-exchange-overview.md` - Project vision
- `.opencode/plans/grand-satoshi-exchange-architecture.md` - Technical architecture
- `.opencode/plans/grand-satoshi-exchange-ui-design.md` - UI design specs
- `.opencode/plans/grand-satoshi-exchange-tasks.md` - Implementation tasks

## License

MIT
