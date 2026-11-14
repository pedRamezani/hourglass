/**
 * The page: renders the simulation as pixel art on a canvas, rotates the glass (drag, keys, the
 * Flip button, tilt), runs the fixed-rate simulation loop and keeps the time and status readout.
 *
 * @remarks
 * Units: the sand canvas has one canvas pixel per grid cell; {@link cell} is the size of one cell in
 * CSS pixels, snapped to whole device pixels when it's large enough. Angles are in degrees,
 * clockwise. Colours come from CSS custom properties in `style.css` and are rebuilt when the colour
 * scheme changes.
 *
 * @see docs/interface.md for rendering, rotation, layout and controls.
 * @packageDocumentation
 */
import { buildHourglass, SandSim, OUTSIDE, EMPTY, GLASS, FRAME, SAND, TICKS_PER_SECOND } from './sim.js';
import { Tilt } from './tilt.js';

/** Length of one simulation tick, in milliseconds. */
const STEP_MS = 1000 / TICKS_PER_SECOND;

/** The rotatable area: receives pointer and keyboard input and carries the slider ARIA attributes. */
const stage = document.getElementById('stage');
/** Wrapper around the sand canvas that is rotated and scaled. */
const glass = document.getElementById('glass');
/** The pixel-art canvas: one canvas pixel per grid cell, scaled up with CSS. @type {HTMLCanvasElement} */
const canvas = document.getElementById('sand');
/** The contact shadow's canvas (stays upright). @type {HTMLCanvasElement} */
const shadowCanvas = document.getElementById('shadow');
const timeOut = document.getElementById('time');
const statusOut = document.getElementById('status');
const flipButton = document.getElementById('flip');
const refillButton = document.getElementById('refill');
const tiltButton = document.getElementById('tilt');
/** Timer duration in seconds; 0 means no timer. @type {HTMLSelectElement} */
const durationSelect = document.getElementById('duration');

/** The hourglass geometry shared by the simulation and the renderer. */
const shape = buildHourglass();
/** The running simulation. */
const sim = new SandSim(shape);
const { W, H } = sim;
/** Number of grid cells (and of sand-canvas pixels). */
const N = W * H;
sim.fill(-1);
sim.setDuration(Number(durationSelect.value));

canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d');
/** Frame buffer for the sand canvas, `W × H`. */
const image = ctx.createImageData(W, H);
/** {@link image}'s bytes viewed as one packed RGBA value per cell (see {@link pack}). */
const pixels = new Uint32Array(image.data.buffer);

// The contact shadow under the base: its own small canvas that doesn't rotate.
/** Height of the contact shadow, in cells; also reserved below the glass when sizing it. */
const SHADOW_ROWS = 4;
shadowCanvas.width = W + 2;
shadowCanvas.height = SHADOW_ROWS;

// ---------- Colours ----------

/** A 1×1 scratch context that {@link rgba} paints into to resolve CSS colours. */
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

/**
 * Resolves any CSS colour to [r, g, b, a] (0–255).
 * @param {string} css - Any colour the canvas accepts as `fillStyle`. Invalid values keep the previous fill style.
 * @returns {number[]} The colour as `[r, g, b, a]`, each 0–255.
 */
function rgba(css) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    return [...probe.getImageData(0, 0, 1, 1).data];
}

/**
 * Packs `[r, g, b, a]` into one value for {@link pixels}.
 * @param {number[]} rgba - Channels, 0–255.
 * @returns {number} An unsigned 32-bit value laid out as ImageData expects on little-endian machines.
 */
const pack = ([r, g, b, a]) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; // little-endian ImageData
/**
 * Linear blend between two colours, channel by channel.
 * @param {number[]} p - Colour at `t = 0`.
 * @param {number[]} q - Colour at `t = 1`.
 * @param {number} t - Blend factor, clamped to 0–1.
 * @returns {number[]} The rounded mix.
 */
const mix = (p, q, t) => p.map((v, k) => Math.round(v + (q[k] - v) * Math.max(0, Math.min(1, t))));
/**
 * Smoothstep: 0 at or below `a`, 1 at or above `b`, eased in between.
 * @param {number} a - Lower edge.
 * @param {number} b - Upper edge.
 * @param {number} v - Input value.
 * @returns {number} 0–1.
 */
const smooth = (a, b, v) => {
    const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Stable per-cell noise (0–1) for wood grain and sand texture. */
const noise = new Float32Array(N).map(() => Math.random());

// Sand is drawn from a table of LIGHT_LEVELS × 256 shades. Each cell has a light level from the
// glass around it (darker at the walls, brighter under the highlights); grains on the surface of a
// pile get SURFACE_BONUS more.
/** Number of light levels in {@link sandTable}. */
const LIGHT_LEVELS = 16;
/** The light level at which sand shows its plain colour; lower is shadowed, higher is lit. */
const NEUTRAL = 9;
/** Extra light levels for a grain with free space above it on screen. */
const SURFACE_BONUS = 2;

/** Packed sand colours, indexed `level * 256 + shade` (see {@link SandSim.shade}). */
let sandTable = new Uint32Array(LIGHT_LEVELS * 256);
// Two of everything: lit for the glass standing upright, and for it standing on its head (its
// pixels rotated 180°), so the light keeps coming from the screen's upper left after a flip.
/** Packed colours of everything that isn't sand, per cell: `[upright, flipped]`. */
const backgrounds = [new Uint32Array(N), new Uint32Array(N)];
/** Light level of each interior cell (0 … LIGHT_LEVELS − 1 − SURFACE_BONUS): `[upright, flipped]`. */
const lights = [new Uint8Array(N), new Uint8Array(N)];

/**
 * How much of the glass highlight falls on column x of a row with interior half-width hw (−1…1 → 0…1).
 * @param {number} x - Column, in cells.
 * @param {number} hw - Interior half-width of the row, in cells.
 * @returns {{ u: number, glint: number }} `u`: position across the row, −1 at the left wall to 1 at the
 *   right; `glint`: highlight strength, 0–1 (weaker in narrow rows such as the neck).
 */
function highlight(x, hw) {
    const u = (x - shape.cx) / Math.max(hw, 1);
    const main = Math.max(0, 1 - Math.abs(u + 0.58) / 0.13);
    const soft = 0.12 * Math.max(0, 1 - Math.abs(u - 0.66) / 0.08);
    return { u, glint: Math.max(main, soft) * Math.min(1, hw / 5) };
}

/**
 * Reads the theme colours from CSS and rebuilds {@link sandTable}, both {@link backgrounds} and
 * {@link lights}, and the contact shadow. Runs at start-up and whenever the colour scheme changes.
 */
function buildPalette() {
    const style = getComputedStyle(document.documentElement);
    /** Resolves a CSS custom property on the root element to `[r, g, b, a]`. */
    const color = (name) => rgba(style.getPropertyValue(name).trim());
    const sandLight = color('--sand-light');
    const sandDark = color('--sand-dark');
    const fill = color('--glass-fill');
    const shine = color('--glass-shine');
    const edge = color('--glass-edge');
    const rim = color('--glass-rim');
    const woodLight = color('--wood-light');
    const woodDark = color('--wood-dark');
    const woodShine = color('--wood-shine');
    const shadow = color('--glass-shadow');

    /** Base colour of grain shade `s` (0–255), between the dark and light sand colours. */
    const shadeOf = (s) => mix(sandDark, sandLight, (s / 255) ** 1.4);
    const sandShadow = mix(sandDark, [0, 0, 0, 255], 0.45);
    const sandShine = mix(sandLight, [255, 255, 255, 255], 0.7);
    for (let level = 0; level < LIGHT_LEVELS; level++) {
        const f = (level - NEUTRAL) / (level < NEUTRAL ? NEUTRAL : LIGHT_LEVELS - 1 - NEUTRAL);
        for (let s = 0; s < 256; s++) {
            const base = shadeOf(s);
            sandTable[level * 256 + s] = pack(f < 0 ? mix(base, sandShadow, -f * 0.8) : mix(base, sandShine, f * 0.75));
        }
    }

    const { cells, halfWidth, cx, capHeight } = shape;
    const bg = backgrounds[0];
    const light = lights[0];
    for (let y = 0; y < H; y++) {
        const hw = halfWidth[y];
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const type = cells[i];
            if (type === EMPTY) {
                // Clear glass: greyer where you look through it at a slant (near the walls), plus highlights.
                const { u, glint } = highlight(x, hw);
                const slant = smooth(0.55, 1, Math.abs(u));
                bg[i] = pack(mix(mix(fill, edge, slant * 0.7), shine, glint * 0.9));
                const level = NEUTRAL - slant * 5 + glint * 6 - (u > 0 ? 0.6 * Math.abs(u) : 0);
                light[i] = Math.max(0, Math.min(LIGHT_LEVELS - 1 - SURFACE_BONUS, Math.round(level)));
            } else if (type === GLASS) {
                // Two layers: the inner edge (beside the interior) and the outer rim.
                const outer = [1, -1, W, -W].some((d) => cells[i + d] === OUTSIDE || cells[i + d] === undefined);
                const side = (x - cx) / W; // left is lit
                bg[i] = pack(outer ? mix(rim, shine, side < 0 ? 0.25 : 0) : mix(edge, shine, side < 0 ? 0.35 : 0.1));
            } else if (type === FRAME) {
                bg[i] = pack(woodColor(x, y, i, hw, { woodLight, woodDark, woodShine }));
            }
        }
    }

    // Flipped: the same glass turned 180°, lit from the same screen direction.
    for (let i = 0; i < N; i++) {
        backgrounds[1][i] = bg[N - 1 - i];
        lights[1][i] = light[N - 1 - i];
    }

    drawShadow(shadow);
}

/**
 * Turned mahogany: horizontal grain, rounded like a cylinder, lit from the upper left.
 * @param {number} x - Column, in cells.
 * @param {number} y - Row, in cells.
 * @param {number} i - Cell index, `y * W + x`.
 * @param {number} hw - Half-width of the wood in this row, in cells.
 * @param {{ woodLight: number[], woodDark: number[], woodShine: number[] }} colours - Theme colours as `[r, g, b, a]`.
 * @returns {number[]} The cell's colour as `[r, g, b, a]`.
 */
function woodColor(x, y, i, hw, { woodLight, woodDark, woodShine }) {
    const { cells, cx } = shape;
    const u = (x - cx) / hw; // −1 … 1 across the disc
    const grain = 0.5 + 0.28 * Math.sin(y * 1.9 + Math.sin(x * 0.11 + y * 0.7) * 1.4 + noise[i] * 0.9) + 0.22 * (noise[i] - 0.5);
    let c = mix(woodDark, woodLight, grain * 0.75);
    // Round: darker towards both ends, a soft sheen left of centre.
    c = mix(c, woodDark, smooth(0.45, 1, Math.abs(u)) * 0.8);
    c = mix(c, woodShine, Math.max(0, 1 - Math.abs(u + 0.42) / 0.22) * 0.55);
    // Edges: a lit lip on top of each tier, a dark line under it.
    const above = cells[i - W];
    const below = cells[i + W];
    if (above !== FRAME) c = mix(c, woodShine, 0.45);
    else if (below !== FRAME) c = mix(c, woodDark, 0.6);
    // The collar is recessed.
    if (hw < shape.halfWidth[0]) c = mix(c, woodDark, 0.55);
    return c;
}

/**
 * A pixel ellipse in --glass-shadow, wider than the base, in three flat steps of opacity.
 * @param {number[]} colour - The shadow colour as `[r, g, b, a]`; its alpha is the darkest step's opacity.
 */
function drawShadow([r, g, b, alpha]) {
    const w = shadowCanvas.width;
    const sctx = shadowCanvas.getContext('2d');
    const img = sctx.createImageData(w, SHADOW_ROWS);
    const out = new Uint32Array(img.data.buffer);
    for (let y = 0; y < SHADOW_ROWS; y++) {
        for (let x = 0; x < w; x++) {
            const dx = (x - (w - 1) / 2) / (w / 2);
            const dy = (y + 0.5) / SHADOW_ROWS;
            const d = Math.hypot(dx, dy * 0.9);
            const step = d < 0.5 ? 1 : d < 0.7 ? 0.6 : d < 0.86 ? 0.32 : d < 0.97 ? 0.12 : 0;
            if (step) out[y * w + x] = pack([r, g, b, Math.round(alpha * step)]);
        }
    }
    sctx.putImageData(img, 0, 0);
}

buildPalette();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', buildPalette);

/** Index into {@link backgrounds} and {@link lights}: 0 upright, 1 on its head. Set by {@link place}. */
let flipped = 0; // which lighting set is in use: 0 upright, 1 on its head

/** Draws the current sand over the background into the canvas. Called once per animation frame. */
function render() {
    pixels.set(backgrounds[flipped]);
    const { cells, shade, vx, vy } = sim;
    const light = lights[flipped];
    const up = flipped ? W : -W; // the screen's "up" in grid cells
    for (const i of sim.interior) {
        if (cells[i] !== SAND) continue;
        const level = light[i] + (cells[i + up] === EMPTY ? SURFACE_BONUS : 0);
        const color = sandTable[(level << 8) | shade[i]];
        pixels[i] = color;
        // Motion blur: a falling grain is drawn as long as the distance it covers per tick (up to
        // 3 cells), into free cells behind it, so the stream reads as a pour rather than dots.
        const blur = Math.round(Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]));
        for (let k = 1, j = i + up; k <= blur && cells[j] === EMPTY; k++, j += up) pixels[j] = color;
    }
    ctx.putImageData(image, 0, 0);
}

// ---------- Size ----------

// The glass is as large as the stage allows when it stands upright, and shrinks just enough to fit
// while it's turned. Big enough sizes snap to whole device pixels per cell, which keeps the pixel
// art even.
/** Size of one grid cell, in CSS pixels (at least 0.5). */
let cell = 1;
/** The stage's last measured box, in CSS pixels. @type {{ width: number, height: number }} */
let stageBox = { width: 0, height: 0 };

/** Measures the stage, picks {@link cell} and sizes the glass and shadow to match. Runs on every stage resize. */
function resize() {
    const r = stage.getBoundingClientRect();
    stageBox = r;
    const dpr = devicePixelRatio || 1;
    let size = Math.min(r.width / W, r.height / (H + SHADOW_ROWS));
    const device = size * dpr;
    // Uneven cells show most when they're small, so snap harder there.
    const keep = Math.floor(device) / device;
    if (device >= 3 && keep > (device < 6 ? 0.85 : 0.975)) size = Math.floor(device) / dpr;
    cell = Math.max(size, 0.5);
    glass.style.width = `${W * cell}px`;
    glass.style.height = `${H * cell}px`;
    shadowCanvas.style.width = `${shadowCanvas.width * cell}px`;
    shadowCanvas.style.height = `${SHADOW_ROWS * cell}px`;
    stage.style.setProperty('--shadow-y', `${((H + SHADOW_ROWS) / 2 - 1.5) * cell}px`);
    place();
}

/**
 * Applies the angle: rotation, fit-to-stage scale, the contact shadow and which lighting set to use.
 *
 * @remarks
 * Scales the glass down (never up) so its rotated bounding box fits the stage. Sets the `--fit` and
 * `--shadow` custom properties on the stage; the shadow fades out quickly as the glass tilts away from vertical.
 */
function place() {
    const a = (angle * Math.PI) / 180;
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    const w = W * cell;
    const h = (H + SHADOW_ROWS) * cell;
    const fit = Math.min(1, stageBox.width / (w * c + h * s), stageBox.height / (w * s + h * c));
    glass.style.transform = `rotate(${angle}deg) scale(${fit})`;
    stage.style.setProperty('--fit', fit);
    stage.style.setProperty('--shadow', (c ** 6).toFixed(3));
    flipped = Math.cos(a) < 0 ? 1 : 0;
}

new ResizeObserver(resize).observe(stage);

// ---------- Rotation ----------

/** The glass's rotation, in degrees, clockwise; unbounded (it keeps counting past 360). */
let angle = 0; // degrees, clockwise
/**
 * The running rotation animation, if any.
 * @type {{ from: number, to: number, start: number, duration: number } | null}
 */
let tween = null;
/** The orientation sensor reader, used once the user turns tilt on. */
const tilt = new Tilt();

/**
 * Sets the rotation, applies it and updates the stage's slider value for assistive technology.
 * @param {number} value - Angle in degrees, clockwise; any value (normalised to 0–359 for ARIA only).
 */
function setAngle(value) {
    angle = value;
    place();
    const normalized = ((Math.round(angle) % 360) + 360) % 360;
    stage.setAttribute('aria-valuenow', normalized);
    stage.setAttribute('aria-valuetext', `${normalized} degrees`);
}

/**
 * Starts animating the rotation to `target`, replacing any running animation.
 * @param {number} target - Final angle, in degrees, clockwise.
 * @param {number} duration - Animation length, in milliseconds; 0 jumps on the next frame.
 */
function rotateTo(target, duration) {
    tween = { from: angle, to: target, start: performance.now(), duration };
}

/**
 * Cubic ease-in-out.
 * @param {number} t - Progress, 0–1.
 * @returns {number} Eased progress, 0–1.
 */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Whether the user prefers reduced motion; flips then happen instantly. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** Turns the glass over: half a turn on from the nearest upright or upside-down position, so it always ends on one of the two. */
function flip() {
    rotateTo(Math.round(angle / 180) * 180 + 180, reducedMotion.matches ? 0 : 900);
}

/**
 * Gravity in the grid's frame: the screen's gravity rotated against the glass.
 * @returns {import('./sim.js').Vec2} Gravity in grid coordinates, ready for {@link SandSim.step}; straight
 *   down the screen at full strength unless tilt is active.
 */
function gridGravity() {
    const g = tilt.active ? tilt.gravity : { x: 0, y: 1 };
    const a = (-angle * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: g.x * c - g.y * s, y: g.x * s + g.y * c };
}

// Drag to rotate around the glass's centre.
/**
 * The drag in progress, if any: the pointer being tracked and its last angle in degrees.
 * @type {{ id: number, last: number } | null}
 */
let drag = null;

/**
 * Angle of the pointer around the stage's centre.
 * @param {PointerEvent} event - The pointer event.
 * @returns {number} Degrees, clockwise from the positive x axis, in −180…180.
 */
function pointerAngle(event) {
    const r = stage.getBoundingClientRect();
    return (Math.atan2(event.clientY - (r.top + r.height / 2), event.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
}

stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    tween = null;
    drag = { id: event.pointerId, last: pointerAngle(event) };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
});

stage.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const current = pointerAngle(event);
    let delta = current - drag.last;
    delta -= Math.round(delta / 360) * 360; // unwrap across ±180°
    drag.last = current;
    setAngle(angle + delta);
});

/** Ends the drag when its pointer is released or cancelled. @param {PointerEvent} event */
const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag = null;
    stage.classList.remove('dragging');
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

stage.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 45 : 15;
    const base = tween ? tween.to : angle;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') rotateTo(base - step, 200);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') rotateTo(base + step, 200);
    else if (event.key === ' ' || event.key === 'Enter') flip();
    else return;
    event.preventDefault();
});

// ---------- Controls ----------

flipButton.addEventListener('click', flip);

refillButton.addEventListener('click', () => {
    const g = gridGravity();
    sim.fill(g.y >= 0 ? -1 : 1); // into whichever bulb is currently on top
    sim.setDuration(Number(durationSelect.value));
});

durationSelect.addEventListener('change', () => sim.setDuration(Number(durationSelect.value)));

if (Tilt.supported && matchMedia('(any-pointer: coarse)').matches) {
    tiltButton.hidden = false;
    tiltButton.addEventListener('click', async () => {
        if (tilt.active) {
            tilt.disable();
        } else {
            tiltButton.disabled = true;
            try {
                await tilt.enable();
            } catch (error) {
                showMessage(error.message);
            }
            tiltButton.disabled = false;
        }
        tiltButton.setAttribute('aria-pressed', tilt.active);
    });
}

// ---------- Readout ----------

/**
 * A temporary message that replaces the status line, such as a tilt error.
 * @type {{ text: string, until: number } | null}
 */
let message = null;

/**
 * Shows `text` in the status line for 4 seconds.
 * @param {string} text - The message.
 */
function showMessage(text) {
    message = { text, until: performance.now() + 4000 };
}

/**
 * Formats a duration as minutes and seconds, rounding up.
 * @param {number} seconds - Duration, in seconds.
 * @returns {string} For example `"1:05"`.
 * @example
 * formatTime(64.2); // "1:05"
 */
function formatTime(seconds) {
    const s = Math.ceil(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Updates the remaining time and the status line, touching the DOM only when the text changes.
 *
 * @remarks
 * The time left is the sand in whichever bulb is currently on top divided by the gate's flow rate,
 * so without a timer (infinite flow rate) it reads 0:00.
 *
 * @param {number} now - The frame timestamp, in milliseconds (`performance.now()` clock).
 */
function updateReadout(now) {
    const g = gridGravity();
    const strength = Math.hypot(g.x, g.y);
    const upper = g.y >= 0 ? sim.top : sim.bottom;
    const time = formatTime(upper / (sim.flowRate * TICKS_PER_SECOND));

    let status;
    if (message && now < message.until) status = message.text;
    else if (upper === 0) status = 'Time’s up. Flip the glass to start again.';
    else if (strength < 0.15) status = 'Lying flat, the sand rests.';
    else if (Math.abs(g.y) < 0.35 * strength) status = 'On its side, the sand can’t reach the neck.';
    else status = 'Running';

    if (timeOut.textContent !== time) timeOut.textContent = time;
    if (statusOut.textContent !== status) statusOut.textContent = status;
}

// ---------- Loop ----------

/** Timestamp of the previous frame, in milliseconds. */
let last = performance.now();
/** Real time not yet simulated, in milliseconds. */
let backlog = 0;

/**
 * Animation frame: advances the rotation tween, runs as many fixed-length simulation ticks as the
 * elapsed time calls for (at most 8 per frame, and at most 250 ms of catch-up), then renders.
 * @param {number} now - The frame timestamp from `requestAnimationFrame`, in milliseconds.
 */
function frame(now) {
    requestAnimationFrame(frame);

    if (tween) {
        const t = tween.duration > 0 ? Math.min(1, (now - tween.start) / tween.duration) : 1;
        setAngle(tween.from + (tween.to - tween.from) * ease(t));
        if (t === 1) tween = null;
    }

    backlog += Math.min(now - last, 250);
    last = now;
    let steps = 0;
    while (backlog >= STEP_MS && steps < 8) {
        const g = gridGravity();
        sim.step(g.x, g.y);
        backlog -= STEP_MS;
        steps++;
    }
    if (steps === 8) backlog = 0; // too slow to keep up: drop time instead of spiralling

    render();
    updateReadout(now);
}

setAngle(0);
render();
requestAnimationFrame(frame);

// ---------- Offline ----------

// Installable and offline-capable (see sw.js). Service workers need HTTPS or localhost.
if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}
