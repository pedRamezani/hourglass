# Sand Clock — Agent Guide

A falling-sand hourglass in the browser that can be turned, tilted with the phone's orientation sensor and used as a timer. Plain HTML, CSS and ES modules: no dependencies, no build step.

## Commands

```bash
npm start   # serves the page on http://localhost:8000 (ES modules don't load from file://)
npm test    # simulation tests, Node ≥ 22 built-in runner
```

## Rules for every task

- Before reporting done, run `npm test`. For anything visible, also look at the page in a browser, in light and dark mode.
- Keep it dependency-free: no bundler, no npm packages, no CDN scripts.
- Not deployed and no git remote yet; ask before setting up either.

## Docs

| Doc | Open when you… |
|---|---|
| [docs/simulation.md](docs/simulation.md) | change how sand moves, the hourglass shape or the timer (`js/sim.js`) |
| [docs/interface.md](docs/interface.md) | change rendering, colours, rotation, controls or layout (`js/main.js`, `style.css`, `index.html`) |
| [docs/tilt.md](docs/tilt.md) | work on the orientation sensor (`js/tilt.js`) or need to test tilt |
