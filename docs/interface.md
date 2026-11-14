# Interface (`js/main.js`, `style.css`, `index.html`)

## Rendering

- The canvas is exactly `W × H` pixels, one pixel per cell, and CSS scales it up with `image-rendering: pixelated`. Don't draw at screen resolution.
- `buildPalette()` precomputes a `background` buffer (glass, highlight, wood grain) and a 256-entry `sandColors` lookup. Each frame copies the background and writes sand pixels on top, then calls `putImageData` once.
- Pixels are packed as little-endian `0xAABBGGRR` (`pack()`).

## Colours and theme

All colours, including the simulation's, are CSS custom properties in `style.css`: the light palette on `:root`, the dark one in `@media (prefers-color-scheme: dark)`. `main.js` reads `--sand-light`, `--sand-dark`, `--glass-fill`, `--glass-shine`, `--glass-edge`, `--wood-light` and `--wood-dark` and rebuilds the palette when the system theme changes. Any CSS colour syntax works (it is resolved through a 1×1 canvas). Change both palettes together. There is no manual theme toggle.

## Rotation and gravity

- `angle` (degrees, clockwise) is applied as `--angle` on `.glass`. The `.stage` around it is square, so the tall glass fits at any angle.
- `gridGravity()` rotates the screen's gravity, `(0, 1)` or the tilt sensor's vector, by `-angle` into the glass's frame and feeds it to `sim.step()`. Rotating the glass and tilting the phone therefore combine naturally.
- Input: drag on the stage (pointer capture, angle unwrapped across ±180°); arrow keys ±15° (Shift ±45°); Space/Enter and the Flip button tween to the next multiple of 180°. Gravity follows the tween every tick, so sand moves while the glass turns.

## Readout

The time left is `grains in the upper bulb / (flowRate × 60)`, where "upper" depends on the sign of the grid gravity's y. The status line reports running, lying flat, on its side, time's up, or a tilt error for 4 s.

## Loop

Fixed 60 Hz simulation steps inside `requestAnimationFrame`, at most 8 per frame; backlog beyond that is dropped. Browsers pause rAF in background tabs, so the timer pauses too (documented in the README).

## Accessibility

The stage is focusable with `role="slider"` and reports its angle via `aria-valuenow`/`aria-valuetext`. The keyboard hint in the header is hidden on devices without a fine pointer. Buttons are at least 44 px tall.

## Checking visual changes

Serve the page and look at it at desktop width and around 390 px wide, in light and dark mode, mid-flow and mid-flip. The headless captures in `CLAUDE.local.md` (if present on this machine) describe how to do that here.
