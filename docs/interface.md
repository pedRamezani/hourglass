# Interface (`js/main.js`, `style.css`, `index.html`)

## Rendering

- The canvas is exactly `W × H` pixels, one pixel per cell, and CSS scales it up with `image-rendering: pixelated`. Don't draw at screen resolution.
- `buildPalette()` precomputes a background buffer (glass with its slant tint and highlights, the two glass layers, turned-mahogany caps with grain, sheen and edge lips), a per-cell light level for sand, and a `sandTable` of 16 light levels × 256 shades. Each frame copies the background, writes each grain as `sandTable[light + surface bonus][shade]` (grains with free space above them are a little brighter), then calls `putImageData` once.
- Lighting comes from the screen's upper left. Everything is baked twice, upright and turned 180° (the shape is symmetric, so the second set is the first one reversed); `place()` picks the set from the sign of `cos(angle)`, so after a flip the highlights are still on the left. While the glass passes 90° the set swaps.
- The contact shadow is a separate small canvas (`#shadow`) under the glass that doesn't rotate: a pixel ellipse in three opacity steps, faded by `cos⁶(angle)`.
- Pixels are packed as little-endian `0xAABBGGRR` (`pack()`).

## Colours and theme

All colours, including the simulation's, are CSS custom properties in `style.css`: the light palette on `:root`, the dark one in `@media (prefers-color-scheme: dark)`. `main.js` reads `--sand-light`, `--sand-dark`, `--glass-fill`, `--glass-shine`, `--glass-edge`, `--glass-rim`, `--glass-shadow`, `--wood-light`, `--wood-dark` and `--wood-shine` and rebuilds the palette when the system theme changes. The look follows a studio product shot: a seamless backdrop (`--color-paper` fading to `--color-paper-2`), mahogany wood, which is also the accent of the Flip button. Any CSS colour syntax works (it is resolved through a 1×1 canvas). Change both palettes together. There is no manual theme toggle.

## Rotation and gravity

- `angle` (degrees, clockwise) is applied by `place()` as `transform: rotate() scale()` on `.glass`.
- Size: `resize()` (a `ResizeObserver` on `.stage`) makes the glass as large as the stage allows when upright, and snaps the cell size to whole device pixels when that costs little (more readily for small cells, where uneven cells show). `place()` then shrinks it just enough to fit the stage at the current angle, so it is full height at rest and never overflows while turned. `.stage` has `contain: size`, so the canvases never size the layout.
- `gridGravity()` rotates the screen's gravity, `(0, 1)` or the tilt sensor's vector, by `-angle` into the glass's frame and feeds it to `sim.step()`. Rotating the glass and tilting the phone therefore combine naturally.
- Input: drag on the stage (pointer capture, angle unwrapped across ±180°); arrow keys ±15° (Shift ±45°); Space/Enter and the Flip button tween to the next multiple of 180° (instantly with `prefers-reduced-motion`). Gravity follows the tween every tick, so sand moves while the glass turns.

## Layout

Phones (portrait): title and hint, then the stage taking all remaining height, then the time with its status, then one row of controls; the Timer label is visually hidden there. Wide landscape screens (`min-width: 48rem`): the stage is a full-height centre column and the title, readout and controls form a caption column on its left.

## Controls

Flip is the one filled button (mahogany, `--color-accent`). The others are neutral chips with a 2px bottom lip that flattens on `:active`. The select uses `appearance: none` with its own chevron, and Refill shows a small hourglass with a full top bulb. Both glyphs are pixel art drawn with `box-shadow` cells in `currentColor` (one cell is `--px`; cell (0, 0) is the element's own background, since a box-shadow never paints under its box), so they follow the theme. On phones the padding tightens so all four controls fit one row at 390px.

## Readout

The time left is `grains in the upper bulb / (flowRate × 60)`, where "upper" depends on the sign of the grid gravity's y. The status line reports running, lying flat, on its side, time's up, or a tilt error for 4 s.

## Loop

Fixed 60 Hz simulation steps inside `requestAnimationFrame`, at most 8 per frame; backlog beyond that is dropped. Browsers pause rAF in background tabs, so the timer pauses too (documented in the README).

## Accessibility

The stage is focusable with `role="slider"` and reports its angle via `aria-valuenow`/`aria-valuetext`. The keyboard hint in the header is hidden on devices without a fine pointer. Buttons are at least 44 px tall.

## Checking visual changes

Serve the page and look at it at desktop width and around 390 px wide, in light and dark mode, mid-flow and mid-flip. The headless captures in `CLAUDE.local.md` (if present on this machine) describe how to do that here.

## Installing and offline

- `manifest.webmanifest` makes the page installable: standalone, portrait, `theme_color` and the `theme-color` metas in `index.html` match `--color-paper` (light) and the dark paper. iOS reads the `apple-*` metas and `icon/apple-touch-icon.png` instead.
- `sw.js` caches the files in its `FILES` list on install and serves the network first, falling back to the cache when offline, so a dev server never shows a stale page. Add new files to `FILES` and bump `VERSION`. `main.js` registers it only in a secure context (HTTPS or localhost).
- The icons are pixel art: `icon/favicon.svg` (transparent) and `icon/icon.svg` (on walnut brown, `#4a2a1c`, padded to stay inside a maskable circle). The PNGs (180, 192, 512) are rendered from `icon.svg`; regenerate them if it changes.
- `overscroll-behavior: none` on `body` and `touch-action: manipulation` on controls keep it feeling like an app (no pull-to-refresh, no double-tap zoom).
