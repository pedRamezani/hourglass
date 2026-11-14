# Hourglass

A falling-sand hourglass in the browser. Turn it by dragging, flip it, tilt your phone, and use it as a timer.

## Features

- **Gravity in any direction.** Every grain has its own velocity: it accelerates while falling, keeps its momentum when the glass turns and loses it on impact. Blocked grains slide off to either side as long as that still leads downhill, and now and then spread one cell further, so heaps settle at a real sand's shallow angle instead of 45°.
- **Turn the glass.** Drag it around its centre, press the arrow keys (Shift for 45° steps) or Space/Enter to flip. The sand reacts while the glass is turning.
- **Tilt sensor.** On phones and tablets, *Use tilt* takes gravity from the device orientation sensor. Laying the phone flat lets the sand rest. iOS asks for permission first, and the sensor only works over HTTPS.
- **Timer.** The neck lets grains through at a fixed rate, so the top bulb empties in exactly the chosen time (30 s to 10 min). The timer pauses while the tab is in the background.
- **Fills the screen.** The glass stands at full height and shrinks only as far as it must while it turns. Pixel art throughout, lit from the upper left, with mahogany caps and a contact shadow.
- Light and dark mode follow the system setting.
- **Installable.** On a phone, *Add to Home Screen* installs it as an app (portrait, full screen, own icon), and it keeps working offline once opened. Needs HTTPS, like the tilt sensor.

## Getting started

The scripts are ES modules, so the page has to be served over HTTP rather than opened as a file:

```bash
npm start   # python3 -m http.server 8000
npm test    # simulation tests (Node 22 or newer, no dependencies)
```

Then open http://localhost:8000. Any static host works for deployment; there is no build step. The tilt sensor only works over HTTPS (or on localhost).

## Structure

| Path | Purpose |
|---|---|
| `js/sim.js` | Hourglass shape and the sand simulation (no DOM, runs in Node too) |
| `js/tilt.js` | Gravity vector from the `deviceorientation` event |
| `js/main.js` | Rendering, rotation, input and the timer readout |
| `manifest.webmanifest`, `sw.js` | Install metadata and the offline service worker (network first, cache as fallback) |
| `fonts/` | monogram, the pixel font of the controls (CC0) |
| `icon/` | Pixel-art icons: `favicon.svg`, and `icon.svg` with the PNGs made from it for home screens |
| `style.css` | Layout and the colour palette, including the simulation colours |
| `test/` | Simulation tests |
| `docs/` | How the simulation, interface and tilt sensor work, for contributors and coding agents |

Tuning lives at the top of `js/sim.js` and in the `buildHourglass` options; [docs/simulation.md](docs/simulation.md) explains each knob and the one pitfall (funnel walls must stay steeper than 45°).

## Origin

Started as a draft post ("JS Playground") on [pedramramezani.de](https://www.pedramramezani.de).
