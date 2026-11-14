// Falling-sand simulation of an hourglass.
//
// The world is a grid of cells. Every grain carries its own velocity, which
// gravity accelerates each tick, so grains speed up while they fall, keep
// their momentum when the gravity direction changes and lose it on impact.
// When a grain is blocked it tries to slide to the two neighbouring cells
// around its direction of travel, as long as that still leads "downhill"
// along the current gravity vector. Gravity can point in any direction,
// which is what makes rotating the glass (or tilting the phone) work.
//
// This module has no DOM dependencies, so it can be tested in Node.

export const OUTSIDE = 0;
export const EMPTY = 1; // inside the glass, free
export const GLASS = 2;
export const FRAME = 3; // wood
export const SAND = 4;

export const TICKS_PER_SECOND = 60;

const ACCEL = 0.06; // cells / tick² at full gravity
const MAX_SPEED = 3; // cells / tick
const SLIDE_MIN_DOT = 0.15; // a slide must point at least this much along gravity
const SLIDE_KEEP = 0.5; // share of speed kept after sliding off an obstacle
// Chance per tick that a grain resting on a 45° slope spreads one more cell sideways (a knight's
// move). Plain 8-neighbour sand piles at 45°; this lowers the angle of repose towards real sand's.
const SPREAD = 0.3;
const MIN_GRAVITY = 0.08; // below this (e.g. a phone lying flat) nothing moves

// The 8 neighbours in ring order, so ring[(k ± 1) % 8] is a 45° rotation.
const RING_X = [1, 1, 0, -1, -1, -1, 0, 1];
const RING_Y = [0, 1, 1, 1, 0, -1, -1, -1];
const RING_LEN = RING_X.map((x, k) => Math.hypot(x, RING_Y[k]));
const RING_INDEX = new Int8Array(9);
RING_X.forEach((x, k) => (RING_INDEX[(RING_Y[k] + 1) * 3 + x + 1] = k));

/**
 * Builds the hourglass shape: a grid of cell types plus, per row, the interior
 * half-width (bulb rows) or the wood's half-width (cap rows), which the renderer
 * uses for shading.
 */
export function buildHourglass({
    bulbWidth = 32, // max interior half-width of a bulb, in cells
    bulbHeight = 66, // rows from the neck to a cap
    neck = 1.5, // interior half-width at the neck (1.5 → 3 cells wide)
    neckLength = 3, // straight rows on either side of the neck row
    capHeight = 10, // rows of wood at each end, collar included
    // Max widening per row going away from the neck. Below 1 so the funnel is steeper than
    // the 45° piles sand forms in a cellular automaton; otherwise grains stay stuck to the walls.
    wallSlope = 0.85,
} = {}) {
    const capHalf = bulbWidth + 6; // the wooden disc overhangs the glass
    const W = 2 * capHalf + 1;
    const H = 2 * (capHeight + bulbHeight) + 1;
    const cx = capHalf;
    const neckRow = capHeight + bulbHeight;
    const cells = new Uint8Array(W * H);
    const halfWidth = new Float32Array(H).fill(-1);

    // Profile from the neck outwards: a funnel that eases out of the neck, blended (soft minimum)
    // into a round, pear-shaped bulb that closes in again towards the cap.
    const profile = new Float32Array(bulbHeight + 1);
    const softMin = (a, b, k) => {
        const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
        return b + (a - b) * h - k * h * (1 - h);
    };
    for (let dy = 0; dy <= bulbHeight; dy++) {
        const t = dy / bulbHeight;
        const body = bulbWidth * Math.sqrt(Math.max(0, 1 - ((t - 0.56) / 0.62) ** 2));
        const run = Math.max(0, dy - neckLength);
        const funnel = neck + wallSlope * (run - 8 * (1 - Math.exp(-run / 8)));
        profile[dy] = Math.max(neck, softMin(body, funnel, 8));
        if (dy > 0) profile[dy] = Math.min(profile[dy], profile[dy - 1] + wallSlope);
    }

    for (let y = capHeight; y < H - capHeight; y++) {
        const hw = profile[Math.abs(y - neckRow)];
        halfWidth[y] = hw;
        for (let x = 0; x < W; x++) {
            if (Math.abs(x - cx) <= hw) cells[y * W + x] = EMPTY;
        }
    }

    // Glass, two cells thick: every cell touching the interior, then every cell beside those.
    const ring = (target, from, neighbours) => {
        const add = [];
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const i = y * W + x;
                if (cells[i] !== OUTSIDE) continue;
                for (let k = 0; k < 8; k += neighbours === 4 ? 2 : 1) {
                    if (cells[i + RING_Y[k] * W + RING_X[k]] === from) {
                        add.push(i);
                        break;
                    }
                }
            }
        }
        for (const i of add) cells[i] = target;
    };
    ring(GLASS, EMPTY, 8);
    ring(GLASS, GLASS, 4);

    // Wooden caps, from the outer face inwards: a rounded disc, then a narrower collar
    // that holds the glass.
    const collar = Math.round(profile[bulbHeight]) + 4;
    const capProfile = [capHalf - 2, capHalf - 1, capHalf, capHalf, capHalf, capHalf, capHalf, capHalf - 1, collar + 1, collar];
    for (let r = 0; r < capHeight; r++) {
        const hw = capProfile[Math.min(r, capProfile.length - 1)];
        for (const y of [r, H - 1 - r]) {
            halfWidth[y] = hw;
            for (let x = 0; x < W; x++) {
                if (Math.abs(x - cx) <= hw) cells[y * W + x] = FRAME;
            }
        }
    }

    return { W, H, cx, neckRow, capHeight, cells, halfWidth };
}

export class SandSim {
    constructor(shape) {
        const { W, H, cells } = shape;
        this.shape = shape;
        this.W = W;
        this.H = H;
        this.neckRow = shape.neckRow;
        this.cells = cells.slice();
        this.shade = new Uint8Array(W * H); // per-grain colour variant, moves with the grain
        this.vx = new Float32Array(W * H);
        this.vy = new Float32Array(W * H);
        this.stamp = new Uint32Array(W * H);
        this.tick = 0;

        const interior = [];
        for (let i = 0; i < cells.length; i++) if (cells[i] === EMPTY) interior.push(i);
        this.interior = Int32Array.from(interior);
        this.jitter = new Float32Array(W * H).map(() => Math.random() * 0.3);
        this.orders = new Map();

        // Neck gate: limits how many grains may enter the neck row per tick,
        // which turns the toy into a timer with a predictable duration.
        this.flowRate = Infinity; // grains per tick
        this.budget = 0;

        this.grains = 0;
        this.top = 0; // grains above the neck row (in grid coordinates)
        this.bottom = 0;
    }

    /**
     * Removes all sand and fills `fraction` of the top (-1) or bottom (+1) bulb, settled: from the
     * neck outwards, so the sand starts as a level heap resting in the funnel.
     */
    fill(side = -1, fraction = 0.62) {
        const { cells, W, neckRow } = this;
        for (const i of this.interior) {
            cells[i] = EMPTY;
            this.vx[i] = this.vy[i] = 0;
        }
        const row = (i) => (i / W) | 0;
        const bulb = [...this.interior].filter((i) => Math.sign(row(i) - neckRow) === side);
        bulb.sort((a, b) => Math.abs(row(a) - neckRow) - Math.abs(row(b) - neckRow));
        const count = Math.round(bulb.length * fraction);
        for (let n = 0; n < count; n++) {
            const i = bulb[n];
            cells[i] = SAND;
            this.shade[i] = (Math.random() * 256) | 0;
        }
        this.grains = count;
        this.count();
    }

    /** Sets the neck gate so `grains` pass in `seconds`. Pass 0 to remove the gate. */
    setDuration(seconds) {
        this.flowRate = seconds > 0 ? this.grains / (seconds * TICKS_PER_SECOND) : Infinity;
        this.budget = 0;
    }

    count() {
        let top = 0;
        let bottom = 0;
        const { cells, W, neckRow } = this;
        for (const i of this.interior) {
            if (cells[i] !== SAND) continue;
            const y = (i / W) | 0;
            if (y < neckRow) top++;
            else if (y > neckRow) bottom++;
        }
        this.top = top;
        this.bottom = bottom;
    }

    /** Interior cells sorted so the cells furthest along gravity come first. */
    orderFor(nx, ny) {
        const bins = 72;
        const bin = Math.round(((Math.atan2(ny, nx) / (2 * Math.PI)) * bins + bins)) % bins;
        let order = this.orders.get(bin);
        if (!order) {
            const a = (bin / bins) * 2 * Math.PI;
            const gx = Math.cos(a);
            const gy = Math.sin(a);
            const { W, jitter } = this;
            const key = (i) => (i % W) * gx + ((i / W) | 0) * gy + jitter[i];
            order = Int32Array.from(this.interior).sort((p, q) => key(q) - key(p));
            this.orders.set(bin, order);
        }
        return order;
    }

    /** Advances one tick with gravity (gx, gy) in grid coordinates; |g| = 1 is full gravity. */
    step(gx, gy) {
        const tick = ++this.tick;
        if (this.flowRate !== Infinity) {
            // Bank up to two seconds of flow so short stalls (an empty neck, a sideways tilt) are caught up.
            this.budget = Math.min(this.budget + this.flowRate, 1 + this.flowRate * 2 * TICKS_PER_SECOND);
        }

        const gm = Math.hypot(gx, gy);
        if (gm < MIN_GRAVITY) {
            this.count();
            return;
        }
        const nx = gx / gm;
        const ny = gy / gm;
        const acc = ACCEL * gm;
        const { cells, shade, vx: VX, vy: VY, stamp, W, neckRow } = this;
        const gated = this.flowRate !== Infinity;

        for (const i of this.orderFor(nx, ny)) {
            if (cells[i] !== SAND || stamp[i] === tick) continue;

            let vx = VX[i] + nx * acc;
            let vy = VY[i] + ny * acc;
            let sp = Math.hypot(vx, vy);
            if (sp > MAX_SPEED) {
                vx *= MAX_SPEED / sp;
                vy *= MAX_SPEED / sp;
                sp = MAX_SPEED;
            }

            let p = i;
            let x = i % W;
            let y = (i - x) / W;
            const steps = Math.max(1, (sp + Math.random()) | 0);

            for (let s = 0; s < steps; s++) {
                // Travel along the velocity once the grain is moving, otherwise along gravity.
                const fx = sp > 0.6 ? vx : nx;
                const fy = sp > 0.6 ? vy : ny;
                const ax = Math.abs(fx);
                const ay = Math.abs(fy);
                const m = Math.max(ax, ay);
                // Stochastic rounding of the direction to a neighbour: on average it matches (fx, fy).
                const dx = Math.random() * m < ax ? Math.sign(fx) : 0;
                const dy = Math.random() * m < ay ? Math.sign(fy) : 0;

                let tx = x + dx;
                let ty = y + dy;
                let ok = this.canEnter(ty * W + tx, y, ty, gated);

                if (!ok) {
                    // Blocked: try the two cells 45° to either side, preferring the one more downhill.
                    const k = RING_INDEX[(dy + 1) * 3 + dx + 1];
                    const l = (k + 7) & 7;
                    const r = (k + 1) & 7;
                    const dotL = (RING_X[l] * nx + RING_Y[l] * ny) / RING_LEN[l];
                    const dotR = (RING_X[r] * nx + RING_Y[r] * ny) / RING_LEN[r];
                    const first = Math.random() < 0.5 + (dotL - dotR) ? l : r;
                    for (const c of [first, first === l ? r : l]) {
                        const dot = c === l ? dotL : dotR;
                        if (dot < SLIDE_MIN_DOT) continue;
                        tx = x + RING_X[c];
                        ty = y + RING_Y[c];
                        if (this.canEnter(ty * W + tx, y, ty, gated)) {
                            const keep = (sp * SLIDE_KEEP) / RING_LEN[c];
                            vx = RING_X[c] * keep;
                            vy = RING_Y[c] * keep;
                            sp *= SLIDE_KEEP;
                            ok = true;
                            break;
                        }
                    }
                }

                if (!ok && Math.random() < SPREAD) {
                    // Spread: one cell sideways, then one diagonally, if both are free and the sideways
                    // cell doesn't skip the neck gate.
                    const k = RING_INDEX[(dy + 1) * 3 + dx + 1];
                    const sides = Math.random() < 0.5 ? [2, 6] : [6, 2];
                    for (const turn of sides) {
                        const c = (k + turn) & 7; // 90° to the travel direction
                        const d = (k + (turn === 2 ? 1 : 7)) & 7; // 45°, on the same side
                        const dot = ((RING_X[c] + RING_X[d]) * nx + (RING_Y[c] + RING_Y[d]) * ny) / Math.hypot(RING_X[c] + RING_X[d], RING_Y[c] + RING_Y[d]);
                        if (dot < SLIDE_MIN_DOT) continue;
                        const sx = x + RING_X[c];
                        const sy = y + RING_Y[c];
                        if (cells[sy * W + sx] !== EMPTY || (sy === neckRow) !== (y === neckRow)) continue;
                        const ex = sx + RING_X[d];
                        const ey = sy + RING_Y[d];
                        if (!this.canEnter(ey * W + ex, sy, ey, gated)) continue;
                        tx = ex;
                        ty = ey;
                        vx = vy = sp = 0;
                        ok = true;
                        break;
                    }
                }

                if (!ok) {
                    vx = vy = sp = 0; // came to rest
                    break;
                }

                const q = ty * W + tx;
                if (gated && ty === neckRow && y !== neckRow) this.budget -= 1;
                cells[q] = SAND;
                shade[q] = shade[p];
                stamp[q] = tick;
                cells[p] = EMPTY;
                VX[p] = VY[p] = 0;
                p = q;
                x = tx;
                y = ty;
            }

            VX[p] = vx;
            VY[p] = vy;
        }

        this.count();
    }

    canEnter(q, fromY, toY, gated) {
        if (this.cells[q] !== EMPTY) return false;
        if (gated && toY === this.neckRow && fromY !== this.neckRow) return this.budget >= 1;
        return true;
    }
}
