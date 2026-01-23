# Grand Satoshi Exchange - UI Design Specification

## Visual Design Philosophy

### OSRS Authenticity Goals

1. **Pixel-perfect recreation** of Grand Exchange interface elements
2. **Authentic color palette** from OSRS UI
3. **Bitmap-style fonts** matching the game's text rendering
4. **Consistent iconography** following OSRS visual language
5. **Proper scaling** - maintain crisp pixels at any zoom level

### Color Palette (OSRS-derived)

```css
:root {
  /* Primary UI Colors */
  --osrs-brown-dark: #3e3529; /* Window borders */
  --osrs-brown-medium: #5d5349; /* Window backgrounds */
  --osrs-brown-light: #8b7355; /* Highlights */

  /* Text Colors */
  --osrs-text-yellow: #ffff00; /* Primary text */
  --osrs-text-white: #ffffff; /* Headers */
  --osrs-text-orange: #ff9900; /* Warnings/values */
  --osrs-text-green: #00ff00; /* Success/positive */
  --osrs-text-red: #ff0000; /* Errors/negative */
  --osrs-text-cyan: #00ffff; /* Links/interactive */

  /* Gold Colors (Bitcoin!) */
  --osrs-gold-dark: #8b6914; /* Coin shadow */
  --osrs-gold-medium: #c9a227; /* Coin base */
  --osrs-gold-light: #ffd700; /* Coin highlight */

  /* GE Specific */
  --ge-slot-empty: #494034; /* Empty offer slot */
  --ge-slot-active: #5d5349; /* Active offer */
  --ge-progress-bg: #2d2822; /* Progress bar bg */
  --ge-progress-fill: #00b300; /* Progress bar fill */

  /* Inventory */
  --inv-slot-bg: #3e3529; /* Slot background */
  --inv-slot-border: #2d2822; /* Slot border */
  --inv-slot-highlight: #5d5349; /* Hover state */
  --inv-slot-selected: #7d6d55; /* Selected state */
}
```

## Typography

### Font Stack

```css
/* Primary OSRS-style font */
@font-face {
  font-family: "RuneScape";
  src: url("/assets/fonts/runescape.woff2") format("woff2");
}

/* Fallback to similar open-source fonts */
.osrs-text {
  font-family: "RuneScape", "Press Start 2P", "Pixelify Sans", monospace;
  font-smooth: never;
  -webkit-font-smoothing: none;
  image-rendering: pixelated;
}
```

### Text Sizes (scaled for pixel-perfect)

```css
--font-size-small: 12px; /* Tooltips, secondary info */
--font-size-normal: 16px; /* Body text */
--font-size-large: 20px; /* Headers, amounts */
--font-size-xlarge: 24px; /* Big numbers (balance) */
```

## Screen Layouts

### 1. Main Window Frame

```
┌─────────────────────────────────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ▓  Grand Satoshi Exchange                            [X] ▓ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ┌─────────┬─────────┬─────────┬─────────┐                 │
│ │  Bank   │ Exchange│ History │ Settings│  ← Tab bar      │
│ └─────────┴─────────┴─────────┴─────────┘                 │
│ ┌─────────────────────────────────────────────────────────┐│
│ │                                                         ││
│ │                                                         ││
│ │                   Content Area                          ││
│ │                                                         ││
│ │                                                         ││
│ │                                                         ││
│ │                                                         ││
│ └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 2. Bank View (Inventory Screen)

```
┌─────────────────────────────────────────────────────────────┐
│  BANK                                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Total Balance: [COIN] 1,234,567,890 sats                  │
│                        ≈ 0.01234567 BTC                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Inventory (UTXOs)                         [7 items] │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │   │
│  │ │COIN│ │COIN│ │COIN│ │COIN│ │COIN│ │COIN│ │COIN│  │   │
│  │ │500K│ │250K│ │100K│ │100K│ │ 50K│ │ 10K│ │ 5K │  │   │
│  │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │   │
│  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │   │
│  │ │    │ │    │ │    │ │    │ │    │ │    │ │    │  │   │
│  │ │    │ │    │ │    │ │    │ │    │ │    │ │    │  │   │
│  │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │   │
│  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │   │
│  │ │    │ │    │ │    │ │    │ │    │ │    │ │    │  │   │
│  │ │    │ │    │ │    │ │    │ │    │ │    │ │    │  │   │
│  │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │   │
│  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │   │
│  │ │    │ │    │ │    │ │    │ │    │ │    │ │    │  │   │
│  │ │    │ │    │ │    │ │    │ │    │ │    │ │    │  │   │
│  │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │    SEND      │  │   RECEIVE    │  │   REFRESH    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. Exchange View (GE Slots)

```
┌─────────────────────────────────────────────────────────────┐
│  GRAND EXCHANGE                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Offer Slots                                         │   │
│  ├──────────────────────┬──────────────────────────────┤   │
│  │ ┌──────────────────┐ │ ┌──────────────────────────┐ │   │
│  │ │ Slot 1           │ │ │ Slot 2                   │ │   │
│  │ │ [COIN] 500,000   │ │ │ [Empty - Click to sell]  │ │   │
│  │ │ → bc1q...xyz     │ │ │                          │ │   │
│  │ │ ████████░░ 2/3   │ │ │                          │ │   │
│  │ │ [Sign] [Cancel]  │ │ │     [+ New Offer]        │ │   │
│  │ └──────────────────┘ │ └──────────────────────────┘ │   │
│  │ ┌──────────────────┐ │ ┌──────────────────────────┐ │   │
│  │ │ Slot 3           │ │ │ Slot 4                   │ │   │
│  │ │ [Empty]          │ │ │ [Empty]                  │ │   │
│  │ └──────────────────┘ │ └──────────────────────────┘ │   │
│  │ ┌──────────────────┐ │ ┌──────────────────────────┐ │   │
│  │ │ Slot 5           │ │ │ Slot 6                   │ │   │
│  │ │ [Empty]          │ │ │ [Empty]                  │ │   │
│  │ └──────────────────┘ │ └──────────────────────────┘ │   │
│  │ ┌──────────────────┐ │ ┌──────────────────────────┐ │   │
│  │ │ Slot 7           │ │ │ Slot 8                   │ │   │
│  │ │ [Empty]          │ │ │ [Empty]                  │ │   │
│  │ └──────────────────┘ │ └──────────────────────────┘ │   │
│  └──────────────────────┴──────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Collection Box                             [COLLECT]│   │
│  │ No items to collect                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4. Create Offer Modal (Send Transaction)

```
┌─────────────────────────────────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ▓  Create Sell Offer                                 [X] ▓ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│                                                             │
│  Step 1: Select items to sell                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Your Inventory              Selected: 2 items       │   │
│  │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │   │
│  │ │████│ │COIN│ │████│ │COIN│ │COIN│ │COIN│ │COIN│  │   │
│  │ │500K│ │250K│ │100K│ │100K│ │ 50K│ │ 10K│ │ 5K │  │   │
│  │ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │   │
│  │  [✓]            [✓]                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Step 2: Enter destination                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Send to: [bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh]│   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Step 3: Enter amount                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Amount: [500000        ] sats    [MAX]              │   │
│  │ Available: 600,000 sats  (from selected items)      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Step 4: Select speed                                      │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│  │   SLOW     │ │  STANDARD  │ │   FAST     │             │
│  │  ~60 min   │ │  ~30 min   │ │  ~10 min   │             │
│  │  5 sat/vB  │ │ 12 sat/vB  │ │ 25 sat/vB  │             │
│  └────────────┘ └────────────┘ └────────────┘             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Summary                                             │   │
│  │ Sending:     500,000 sats                          │   │
│  │ Fee:           1,200 sats                          │   │
│  │ Change:       98,800 sats (returned to you)        │   │
│  │ ─────────────────────────────                      │   │
│  │ Total spent:  501,200 sats                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │       CANCEL         │  │    CONFIRM OFFER     │        │
│  └──────────────────────┘  └──────────────────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5. Signing Modal

```
┌─────────────────────────────────────────────────────────────┐
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ▓  Sign Transaction                                  [X] ▓ │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│                                                             │
│  Select your signing device:                               │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │   ┌───────────┐     │  │   ┌───────────┐     │          │
│  │   │  LEDGER   │     │  │   │  TREZOR   │     │          │
│  │   │  ░░░░░░   │     │  │   │  ░░░░░░   │     │          │
│  │   │  ░░░░░░   │     │  │   │   ░░░░    │     │          │
│  │   └───────────┘     │  │   └───────────┘     │          │
│  │     Ledger          │  │     Trezor          │          │
│  └─────────────────────┘  └─────────────────────┘          │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Status: Waiting for device...                             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  1. Connect your hardware wallet                    │   │
│  │  2. Open the Bitcoin app                            │   │
│  │  3. Review the transaction on your device           │   │
│  │  4. Confirm if details are correct                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Transaction Details:                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Sending: 500,000 sats                               │   │
│  │ To: bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh      │   │
│  │ Fee: 1,200 sats (12 sat/vB)                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────┐                                  │
│  │       CANCEL         │                                  │
│  └──────────────────────┘                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6. Offer Complete Animation

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                                                             │
│                    ╔═══════════════════╗                   │
│                    ║                   ║                   │
│                    ║  OFFER COMPLETE!  ║                   │
│                    ║                   ║                   │
│                    ║   ✦  ✦  ✦  ✦  ✦   ║                   │
│                    ║                   ║                   │
│                    ║  [COIN] 500,000   ║                   │
│                    ║      sent to      ║                   │
│                    ║   bc1q...xyz      ║                   │
│                    ║                   ║                   │
│                    ║  TXID: abc123...  ║                   │
│                    ║                   ║                   │
│                    ╚═══════════════════╝                   │
│                                                             │
│                   [ View on Explorer ]                     │
│                                                             │
│                        [  OK  ]                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Sprite Sheets

### Gold Coin Sprites (coins.png)

```
Sprite dimensions: 32x32 px each
Layout: Horizontal strip

┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ 1  │ 2-4│5-24│25- │100-│1K- │10K-│100K│ 1M-│10M+│
│coin│coin│coin│99  │999 │9.9K│99K │-1M │10M │    │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘

Visual progression:
- 1 coin: Single small gold coin
- 2-4: Small stack
- 5-24: Medium stack
- 25-99: Larger stack
- 100-999: Pile (white text)
- 1K-9.9K: Bigger pile (cyan text)
- 10K-99K: Large pile (green text)
- 100K-1M: Huge pile (green text)
- 1M-10M: Massive pile (green text)
- 10M+: Overflowing (green text)
```

### UI Elements (ui.png)

```
Window components:
- Corner pieces (4x): 16x16 each
- Edge pieces (4x): 16x16 tileable
- Title bar background: 16x32 tileable
- Close button: 16x16 (normal, hover, pressed)

Buttons:
- Standard button: 64x24 (9-slice scalable)
- Icon button: 24x24
- Tab button: 48x24 (active, inactive)

Slots:
- Inventory slot: 36x36 (empty, hover, selected)
- GE offer slot: 180x80 (empty, active, complete)

Misc:
- Progress bar: 100x12 (background + fill)
- Scrollbar: 16x16 (track, thumb, arrows)
- Checkbox: 16x16 (unchecked, checked)
- Divider: 1x16 tileable
```

### Icon Set (icons.png)

```
24x24 icons:
- Send arrow
- Receive arrow
- Refresh
- Settings gear
- History clock
- Wallet
- Exchange
- Copy
- QR code
- Link/external
- Check mark
- X mark
- Warning triangle
- Info circle
- Ledger device
- Trezor device
```

## CSS Architecture

### Global Styles

```css
/* styles/reset.css */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* Pixel-perfect rendering */
img,
canvas {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}

/* styles/variables.css */
:root {
  /* All color variables from palette above */
  /* Font variables */
  /* Spacing scale (multiples of 4px for pixel grid) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
}

/* styles/fonts.css */
@font-face {
  font-family: "RuneScape";
  src: url("/assets/fonts/runescape.woff2") format("woff2");
  font-display: swap;
}

.osrs-text {
  font-family: "RuneScape", "Press Start 2P", monospace;
  color: var(--osrs-text-yellow);
  text-shadow: 1px 1px 0 #000;
}
```

### Component CSS Pattern

```css
/* Each component has its own CSS module */
/* components/ui/Button/Button.module.css */

.button {
  /* 9-slice background */
  border-image: url("/assets/sprites/ui.png") 4 fill / 4px;
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  font-family: inherit;
}

.button:hover {
  /* Lighter variant slice */
  filter: brightness(1.1);
}

.button:active {
  /* Pressed state slice */
  transform: translateY(1px);
}
```

## Animations

### Key Animations Needed

1. **Coin drop** - When receiving bitcoin (UTXO appears)
2. **Coin pickup** - When selecting UTXO
3. **Progress fill** - Signature progress bar
4. **Offer complete** - Celebration effect
5. **Button press** - Tactile feedback
6. **Tab switch** - Smooth content transition
7. **Modal open/close** - Slide or fade

### Animation CSS

```css
/* styles/animations.css */

@keyframes coinDrop {
  0% {
    transform: translateY(-20px);
    opacity: 0;
  }
  60% {
    transform: translateY(5px);
  }
  100% {
    transform: translateY(0);
    opacity: 1;
  }
}

@keyframes progressFill {
  from {
    width: 0%;
  }
  to {
    width: var(--progress);
  }
}

@keyframes celebrate {
  0% {
    transform: scale(0.8);
    opacity: 0;
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.coin-enter {
  animation: coinDrop 0.3s ease-out;
}

.progress-bar-fill {
  animation: progressFill 0.5s ease-out forwards;
}

.offer-complete {
  animation: celebrate 0.5s ease-out;
}
```

## Responsive Considerations

### Minimum Viable Size

- Minimum width: 800px
- Minimum height: 600px
- Below this, show "resize window" message

### Scaling Strategy

- Use CSS transform: scale() to maintain pixel-perfect rendering
- Scale factor: 1x, 1.5x, 2x based on screen size
- Never use fractional scaling (maintains crisp pixels)

```css
.app-container {
  /* Base size */
  width: 800px;
  height: 600px;

  /* Scale up on larger screens */
  transform-origin: top left;
}

@media (min-width: 1200px) {
  .app-container {
    transform: scale(1.5);
  }
}

@media (min-width: 1600px) {
  .app-container {
    transform: scale(2);
  }
}
```
