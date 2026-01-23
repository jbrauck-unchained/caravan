# Grand Satoshi Exchange - Asset Requirements

This document outlines the pixel art assets needed for the OSRS-authentic UI.

## Current Status

✅ **Placeholders Created** - SVG placeholders for development
⏳ **Final Assets Needed** - Pixel art to be created

## Asset Categories

### 1. Bitcoin/Satoshi Coin Stack Sprites (`sprites/coins-tier*.svg`)

**Status:** ✅ **Final assets integrated** (OSRS-style gold coin piles)
**Dimensions:** Varies (27x14 to 30x29)
**Format:** SVG with embedded PNG (OSRS pixel art style)
**Count:** 6 tiers
**Source:** Custom OSRS-inspired gold coin graphics

Bitcoin UTXO coin stacks based on satoshi amounts (inspired by OSRS):

| Tier | Satoshi Range  | BTC Range      | File              | Original Source   | Visual Description       |
| ---- | -------------- | -------------- | ----------------- | ----------------- | ------------------------ |
| 1    | 0 - 100k       | < 0.001 BTC    | `coins-tier1.svg` | `Coins_5.svg`     | Single coin (27x14)      |
| 2    | 100k - 1M      | 0.001-0.01 BTC | `coins-tier2.svg` | `Coins_25.svg`    | Small pile (27x19)       |
| 3    | 1M - 5M        | 0.01-0.05 BTC  | `coins-tier3.svg` | `Coins_100.svg`   | Medium pile (27x23)      |
| 4    | 5M - 10M       | 0.05-0.1 BTC   | `coins-tier4.svg` | `Coins_250.svg`   | Large pile (31x22)       |
| 5    | 10M - 100M     | 0.1-1 BTC      | `coins-tier5.svg` | `Coins_1000.svg`  | Huge pile (30x21)        |
| 6    | 100M+ (1+ BTC) | 1+ BTC         | `coins-tier6.svg` | `Coins_10000.svg` | **Massive pile (30x29)** |

**Implementation:**

- `src/utils/coins.ts` - Contains `getCoinTier()` and `getCoinImage()` functions
- `src/components/ui/Grid/ItemStack.tsx` - Automatically selects correct tier based on satoshi amount
- Text overlay uses OSRS color scheme (yellow text for amounts)
- Graphics use authentic OSRS pixel art style

**Notes:**

- Original graphics stored in `public/assets/gold/` directory
- Graphics feature OSRS-style gold coin piles viewed from isometric angle
- Each tier progressively shows larger coin piles
- Tier 6 (1+ BTC) is the most impressive treasure hoard!

### 2. Window Components (`sprites/ui.png`)

**Format:** PNG spritesheet
**Style:** OSRS window chrome

Components needed:

- Corner pieces (4x): 16x16 each (top-left, top-right, bottom-left, bottom-right)
- Edge pieces (4x): 16x16 tileable (top, bottom, left, right)
- Title bar background: 16x32 tileable
- Close button: 16x16 (3 states: normal, hover, pressed)

### 3. Button Sprites

**Dimensions:** Scalable with 9-slice
**Format:** PNG

Variants:

- Standard button: 64x24 base (normal, hover, pressed, disabled)
- Icon button: 24x24
- Tab button: 48x24 (active, inactive)

### 4. Icons (`sprites/icons.png`)

**Dimensions:** 24x24px each
**Format:** PNG spritesheet

Icons needed:

- Send arrow (outgoing transaction)
- Receive arrow (incoming)
- Refresh (reload)
- Settings gear
- History clock
- Wallet
- Exchange
- Copy
- QR code
- External link
- Check mark
- X mark
- Warning triangle
- Info circle
- Ledger device (pixelated)
- Trezor device (pixelated)

### 5. Inventory Slots

**Dimensions:** 36x36px
**Format:** PNG

States:

- Empty slot
- Hover state (lighter border)
- Selected state (highlighted)

### 6. Progress Bar

**Dimensions:** 100x12px (tileable)
**Format:** PNG

Components:

- Background track
- Fill bar (green)

### 7. Background Textures

**Format:** Tileable PNG

Textures:

- Stone (for window backgrounds)
- Parchment (for modals)
- Wood (for borders)

## Design Guidelines

### Color Palette

Use the OSRS-derived palette from `src/styles/variables.css`:

- Browns: `#3e3529`, `#5d5349`, `#8b7355`
- Gold: `#8b6914`, `#c9a227`, `#ffd700`
- Text: Yellow `#ffff00`, Green `#00ff00`, etc.

### Pixel Art Rules

1. **No anti-aliasing** - Sharp, crisp pixels only
2. **Limited palette** - Stick to OSRS colors
3. **Consistent lighting** - Top-left light source
4. **Dithering** - Use for gradients (optional)
5. **Readable at 1x** - Must be clear at base size

### Font Requirements

**Style:** OSRS-inspired bitmap font
**Fallback:** "Press Start 2P" (currently used)
**Future:** Custom bitmap font or licensed RuneScape-like font

Font characteristics:

- Monospace or near-monospace
- Bitmap/pixel style
- Good readability at small sizes
- Drop shadow for depth

## Creating Assets

### Recommended Tools

- **Aseprite** - Best for pixel art (paid)
- **Piskel** - Free browser-based pixel editor
- **GIMP** - Free, with pixel art plugins
- **Photoshop** - With "nearest neighbor" scaling

### Export Settings

- Format: PNG
- Color depth: 24-bit RGB or 8-bit indexed
- No compression artifacts
- No resampling/smoothing

### Testing

Test assets at multiple scales:

- 1x (base size)
- 1.5x (medium screens)
- 2x (high DPI)

Ensure pixel grid alignment at all scales.

## Implementation

### Sprite Usage

```css
.coin-sprite {
  background-image: url("/assets/sprites/coins.png");
  background-position: calc(var(--coin-index) * -32px) 0;
  width: 32px;
  height: 32px;
  image-rendering: pixelated;
}
```

### Icon Usage

```tsx
<img
  src="/assets/sprites/icons-placeholder.svg"
  alt="Send"
  style={{ imageRendering: "pixelated" }}
/>
```

## Future Enhancements

- [ ] Sound effects (OSRS-style clicks, coin sounds)
- [ ] Animated sprites (e.g., coin sparkle)
- [ ] Custom cursor (OSRS hand pointer)
- [ ] Loading spinner (OSRS-style)

## Legal Considerations

⚠️ **Important:** Do not use actual OSRS assets

- Create original pixel art inspired by OSRS style
- Avoid direct copying or extraction from game files
- Keep it visually similar but legally distinct

## References

- Old School RuneScape Wiki (for visual reference)
- Pixel art communities (for techniques)
- OSRS color palette guides
