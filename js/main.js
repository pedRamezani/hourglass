import { buildHourglass, SandSim, OUTSIDE, EMPTY, GLASS, FRAME, SAND, TICKS_PER_SECOND } from './sim.js';
import { Tilt } from './tilt.js';

const STEP_MS = 1000 / TICKS_PER_SECOND;

const stage = document.getElementById('stage');
const glass = document.getElementById('glass');
const canvas = document.getElementById('sand');
const timeOut = document.getElementById('time');
const statusOut = document.getElementById('status');
const flipButton = document.getElementById('flip');
const refillButton = document.getElementById('refill');
const tiltButton = document.getElementById('tilt');
const durationSelect = document.getElementById('duration');

const shape = buildHourglass();
const sim = new SandSim(shape);
const { W, H } = sim;
sim.fill(-1);
sim.setDuration(Number(durationSelect.value));

canvas.width = W;
canvas.height = H;
glass.style.setProperty('--aspect', `${W} / ${H}`);
const ctx = canvas.getContext('2d');
const image = ctx.createImageData(W, H);
const pixels = new Uint32Array(image.data.buffer);

// ---------- Colours ----------

const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

/** Resolves any CSS colour to [r, g, b, a] (0–255). */
function rgba(css) {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    return [...probe.getImageData(0, 0, 1, 1).data];
}

const pack = ([r, g, b, a]) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; // little-endian ImageData
const mix = (p, q, t) => p.map((v, k) => Math.round(v + (q[k] - v) * t));

// Stable per-cell noise for wood grain and sand texture.
const noise = new Float32Array(W * H).map(() => Math.random());

let background = new Uint32Array(W * H);
let sandColors = new Uint32Array(256);

function buildPalette() {
    const style = getComputedStyle(document.documentElement);
    const color = (name) => rgba(style.getPropertyValue(name).trim());
    const sandLight = color('--sand-light');
    const sandDark = color('--sand-dark');
    const fill = color('--glass-fill');
    const shine = color('--glass-shine');
    const edge = color('--glass-edge');
    const woodLight = color('--wood-light');
    const woodDark = color('--wood-dark');

    sandColors = Uint32Array.from({ length: 256 }, (_, s) => pack(mix(sandDark, sandLight, (s / 255) ** 1.5)));

    background = new Uint32Array(W * H);
    for (let y = 0; y < H; y++) {
        const hw = shape.halfWidth[y];
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            const type = shape.cells[i];
            if (type === EMPTY) {
                // A soft vertical highlight on the left side of the glass.
                const u = (x - shape.cx) / Math.max(hw, 1);
                const highlight = Math.max(0, 1 - Math.abs(u + 0.62) / 0.14);
                background[i] = pack(mix(fill, shine, highlight * Math.min(1, hw / 6)));
            } else if (type === GLASS) {
                background[i] = pack(edge);
            } else if (type === FRAME) {
                const grain = 0.5 + 0.35 * Math.sin(y * 1.7 + x * 0.15 + noise[i] * 1.5) + 0.15 * noise[i];
                background[i] = pack(mix(woodDark, woodLight, grain));
            }
        }
    }
}

buildPalette();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', buildPalette);

function render() {
    pixels.set(background);
    const { cells, shade } = sim;
    for (const i of sim.interior) {
        if (cells[i] === SAND) pixels[i] = sandColors[shade[i]];
    }
    ctx.putImageData(image, 0, 0);
}

// ---------- Rotation ----------

let angle = 0; // degrees, clockwise
let tween = null;
const tilt = new Tilt();

function setAngle(value) {
    angle = value;
    glass.style.setProperty('--angle', `${angle}deg`);
    const normalized = ((Math.round(angle) % 360) + 360) % 360;
    stage.setAttribute('aria-valuenow', normalized);
    stage.setAttribute('aria-valuetext', `${normalized} degrees`);
}

function rotateTo(target, duration) {
    tween = { from: angle, to: target, start: performance.now(), duration };
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function flip() {
    rotateTo(Math.round(angle / 180) * 180 + 180, 900);
}

/** Gravity in the grid's frame: the screen's gravity rotated against the glass. */
function gridGravity() {
    const g = tilt.active ? tilt.gravity : { x: 0, y: 1 };
    const a = (-angle * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: g.x * c - g.y * s, y: g.x * s + g.y * c };
}

// Drag to rotate around the glass's centre.
let drag = null;

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

let message = null;

function showMessage(text) {
    message = { text, until: performance.now() + 4000 };
}

function formatTime(seconds) {
    const s = Math.ceil(seconds);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

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

let last = performance.now();
let backlog = 0;

function frame(now) {
    requestAnimationFrame(frame);

    if (tween) {
        const t = Math.min(1, (now - tween.start) / tween.duration);
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
