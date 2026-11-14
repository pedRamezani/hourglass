/**
 * Falling-sand simulation of an hourglass.
 *
 * @remarks
 * The world is a grid of cells. Every grain carries its own velocity, which
 * gravity accelerates each tick, so grains speed up while they fall, keep
 * their momentum when the gravity direction changes and lose it on impact.
 * When a grain is blocked it tries to slide to the two neighbouring cells
 * around its direction of travel, as long as that still leads "downhill"
 * along the current gravity vector. Gravity can point in any direction,
 * which is what makes rotating the glass (or tilting the phone) work.
 *
 * This module has no DOM dependencies, so it can be tested in Node.
 *
 * Coordinates: cell `i` sits at column `x = i % W`, row `y = (i / W) | 0`;
 * x grows to the right and y grows downwards.
 *
 * @see docs/simulation.md for the model, tuning and invariants.
 * @packageDocumentation
 */

/**
 * A cell type, as stored in {@link SandSim.cells} and {@link HourglassShape.cells}:
 * one of {@link OUTSIDE}, {@link EMPTY}, {@link GLASS}, {@link FRAME} or {@link SAND}.
 * @typedef {0 | 1 | 2 | 3 | 4} CellType
 */

/**
 * A 2D vector with x to the right and y downwards, used for gravity: in grid coordinates for
 * {@link SandSim.step}, in screen coordinates for `Tilt.gravity` (`js/tilt.js`).
 * A length of 1 is full gravity; shorter vectors mean the glass is tilted out of the screen plane.
 * @typedef {object} Vec2
 * @property {number} x - Horizontal component, positive to the right.
 * @property {number} y - Vertical component, positive downwards.
 */

/** Cell type: outside the hourglass (transparent background). */
export const OUTSIDE = 0;
/** Cell type: inside the glass and free, so sand can move in. */
export const EMPTY = 1;
/** Cell type: the glass wall (two cells thick). */
export const GLASS = 2;
/** Cell type: the wooden caps at either end. */
export const FRAME = 3;
/** Cell type: a grain of sand (only ever found in interior cells). */
export const SAND = 4;

/** Simulation rate: {@link SandSim.step} is meant to be called this many times per second. */
export const TICKS_PER_SECOND = 60;

/** Acceleration along gravity, in cells / tick², at full gravity (|g| = 1). */
const ACCEL = 0.06;
/** Speed cap, in cells / tick; also bounds how many cells a grain moves per tick. */
const MAX_SPEED = 3;
/** Minimum cosine between a slide direction and gravity, so slides always lead downhill. */
const SLIDE_MIN_DOT = 0.15;
/** Share of speed kept after sliding off an obstacle (0–1). */
const SLIDE_KEEP = 0.5;
/**
 * Chance per tick that a grain resting on a 45° slope spreads one more cell sideways (a knight's
 * move). Plain 8-neighbour sand piles at 45°; this lowers the angle of repose towards real sand's.
 */
const SPREAD = 0.3;
/** Gravity magnitude below which a tick moves nothing (e.g. a phone lying flat). */
const MIN_GRAVITY = 0.08;

// The 8 neighbours in ring order, so ring[(k ± 1) % 8] is a 45° rotation.
/** X offsets of the 8 neighbours, clockwise on screen starting at "right" (k = 0). */
const RING_X = [1, 1, 0, -1, -1, -1, 0, 1];
/** Y offsets of the 8 neighbours, matching {@link RING_X}. */
const RING_Y = [0, 1, 1, 1, 0, -1, -1, -1];
/** Length of each ring offset: 1 for orthogonal neighbours, √2 for diagonals. */
const RING_LEN = RING_X.map((x, k) => Math.hypot(x, RING_Y[k]));
/**
 * Inverse of the ring: maps an offset `(dx, dy)` in −1…1 to its ring index `k`,
 * looked up as `RING_INDEX[(dy + 1) * 3 + dx + 1]`. The centre entry (0, 0) is unused.
 */
const RING_INDEX = new Int8Array(9);
RING_X.forEach((x, k) => (RING_INDEX[(RING_Y[k] + 1) * 3 + x + 1] = k));

/**
 * The hourglass geometry produced by {@link buildHourglass}.
 * @typedef {object} HourglassShape
 * @property {number} W - Grid width, in cells (always odd, so there is a centre column).
 * @property {number} H - Grid height, in cells (always odd, so there is a neck row).
 * @property {number} cx - Index of the centre column.
 * @property {number} neckRow - Index of the narrowest row, which splits the top bulb from the bottom one.
 * @property {number} capHeight - Rows of wood at each end.
 * @property {Uint8Array} cells - `W * H` cell types ({@link CellType}), row-major; contains no sand.
 * @property {Float32Array} halfWidth - Per row, in cells: the interior half-width for bulb rows or the
 *   wood's half-width for cap rows, which the renderer uses for shading.
 */

/**
 * Options for {@link buildHourglass}. All sizes are in cells.
 * @typedef {object} HourglassOptions
 * @property {number} [bulbWidth=32] - Max interior half-width of a bulb.
 * @property {number} [bulbHeight=66] - Rows from the neck to a cap.
 * @property {number} [neck=1.5] - Interior half-width at the neck (1.5 → 3 cells wide).
 * @property {number} [neckLength=3] - Straight rows on either side of the neck row.
 * @property {number} [capHeight=10] - Rows of wood at each end, collar included.
 * @property {number} [wallSlope=0.85] - Max widening per row going away from the neck, in cells / row.
 */

/**
 * Builds the hourglass shape: a grid of cell types plus, per row, the interior
 * half-width (bulb rows) or the wood's half-width (cap rows), which the renderer
 * uses for shading.
 *
 * @remarks
 * The shape is symmetric about the neck row and the centre column. The interior is wrapped in
 * glass two cells thick, so the bulbs are closed (no {@link EMPTY} cell touches {@link OUTSIDE},
 * even diagonally), and capped with wood at both ends.
 *
 * @param {HourglassOptions} [options] - Dimensions of the glass; the defaults make the shipped hourglass.
 * @returns {HourglassShape} The geometry, ready to pass to {@link SandSim}.
 * @see docs/simulation.md ("Hourglass shape").
 * @example
 * const sim = new SandSim(buildHourglass());
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
    /** Smooth minimum of `a` and `b`; `k` is the blend width (in cells) over which they round into each other. */
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
    /**
     * Turns every {@link OUTSIDE} cell next to a `from` cell into `target`, as one layer
     * (cells added in this pass don't spread further in the same pass).
     * @param {CellType} target - Type to write.
     * @param {CellType} from - Type the new cells must touch.
     * @param {4 | 8} neighbours - 4 for orthogonal neighbours only, 8 to include diagonals.
     */
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

/**
 * The sand simulation: owns a copy of the hourglass grid plus per-cell grain state and advances it
 * one tick at a time under an arbitrary gravity vector.
 *
 * @remarks
 * Per-cell arrays are all `W * H` long and indexed like {@link HourglassShape.cells}. Velocities live
 * in the cell that holds the grain and move with it. The grain count is conserved under any gravity.
 *
 * @see docs/simulation.md
 * @example
 * const sim = new SandSim(buildHourglass());
 * sim.fill(-1);            // sand in the top bulb
 * sim.setDuration(60);     // a one-minute timer
 * sim.step(0, 1);          // one tick, gravity straight down
 */
export class SandSim {
    /**
     * @param {HourglassShape} shape - Geometry from {@link buildHourglass}. Its `cells` are copied, not mutated.
     */
    constructor(shape) {
        const { W, H, cells } = shape;
        /** The geometry this simulation was built from. @type {HourglassShape} */
        this.shape = shape;
        /** Grid width, in cells. @type {number} */
        this.W = W;
        /** Grid height, in cells. @type {number} */
        this.H = H;
        /** Row that separates the top bulb from the bottom one. @type {number} */
        this.neckRow = shape.neckRow;
        /** Live cell types ({@link CellType}), including {@link SAND}. @type {Uint8Array} */
        this.cells = cells.slice();
        /** Per-grain colour variant (0–255), moves with the grain. @type {Uint8Array} */
        this.shade = new Uint8Array(W * H); // per-grain colour variant, moves with the grain
        /** Horizontal velocity of the grain in each cell, in cells / tick. @type {Float32Array} */
        this.vx = new Float32Array(W * H);
        /** Vertical velocity of the grain in each cell, in cells / tick (positive is down). @type {Float32Array} */
        this.vy = new Float32Array(W * H);
        /** Tick at which a grain last arrived in each cell, so no grain moves twice in one tick. @type {Uint32Array} */
        this.stamp = new Uint32Array(W * H);
        /** Ticks simulated so far (starts at 0, incremented at the start of each {@link SandSim.step}). @type {number} */
        this.tick = 0;

        const interior = [];
        for (let i = 0; i < cells.length; i++) if (cells[i] === EMPTY) interior.push(i);
        /** Indices of all interior cells (the only cells sand can occupy), in row-major order. @type {Int32Array} */
        this.interior = Int32Array.from(interior);
        /** Random per-cell tie-break (0–0.3 cells) added to the sweep order, so equal rows aren't swept in a fixed pattern. @type {Float32Array} */
        this.jitter = new Float32Array(W * H).map(() => Math.random() * 0.3);
        /** Cache of sweep orders by gravity direction bin (see {@link SandSim.orderFor}). @type {Map<number, Int32Array>} */
        this.orders = new Map();

        // Neck gate: limits how many grains may enter the neck row per tick,
        // which turns the toy into a timer with a predictable duration.
        /** Grains allowed into the neck row per tick; `Infinity` when there is no gate. @type {number} */
        this.flowRate = Infinity; // grains per tick
        /** Grains that may currently enter the neck row (accrues {@link SandSim.flowRate} per tick). @type {number} */
        this.budget = 0;

        /** Total grains placed by the last {@link SandSim.fill}. @type {number} */
        this.grains = 0;
        /** Grains above the neck row (in grid coordinates), as of the last {@link SandSim.count}. @type {number} */
        this.top = 0; // grains above the neck row (in grid coordinates)
        /** Grains below the neck row, as of the last {@link SandSim.count}. Grains in the neck row count as neither. @type {number} */
        this.bottom = 0;
    }

    /**
     * Removes all sand and fills `fraction` of the top (-1) or bottom (+1) bulb, settled: from the
     * neck outwards, so the sand starts as a level heap resting in the funnel.
     *
     * @remarks
     * Resets velocities, gives each grain a random {@link SandSim.shade}, sets {@link SandSim.grains}
     * and recounts. Does not touch the neck gate; call {@link SandSim.setDuration} afterwards so the
     * flow rate matches the new grain count.
     *
     * @param {-1 | 1} [side=-1] - Which bulb to fill, in grid coordinates: -1 above the neck row, +1 below it.
     * @param {number} [fraction=0.62] - Share of that bulb's interior cells to fill (0–1).
     */
    fill(side = -1, fraction = 0.62) {
        const { cells, W, neckRow } = this;
        for (const i of this.interior) {
            cells[i] = EMPTY;
            this.vx[i] = this.vy[i] = 0;
        }
        /** Row of cell `i`. */
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

    /**
     * Sets the neck gate so `grains` pass in `seconds`. Pass 0 to remove the gate.
     *
     * @remarks
     * Uses the current {@link SandSim.grains}, so call it after {@link SandSim.fill}. Resets the
     * banked {@link SandSim.budget}.
     *
     * @param {number} seconds - Run time of the timer, in seconds; 0 (or less) for free flow.
     * @see docs/simulation.md ("Timer (neck gate)").
     */
    setDuration(seconds) {
        this.flowRate = seconds > 0 ? this.grains / (seconds * TICKS_PER_SECOND) : Infinity;
        this.budget = 0;
    }

    /**
     * Recounts the grains above and below the neck row into {@link SandSim.top} and
     * {@link SandSim.bottom}. Called at the end of every {@link SandSim.step}.
     */
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

    /**
     * Interior cells sorted so the cells furthest along gravity come first.
     *
     * @remarks
     * Sweeping in this order lets a grain move into a cell the grain below it has just left.
     * Directions are quantised into 72 bins (5° each) and each bin's order is computed once
     * and cached in {@link SandSim.orders}.
     *
     * @param {number} nx - X component of the unit gravity direction.
     * @param {number} ny - Y component of the unit gravity direction.
     * @returns {Int32Array} Interior cell indices, most "downhill" first. Shared with the cache; don't mutate.
     */
    orderFor(nx, ny) {
        const bins = 72;
        const bin = Math.round(((Math.atan2(ny, nx) / (2 * Math.PI)) * bins + bins)) % bins;
        let order = this.orders.get(bin);
        if (!order) {
            const a = (bin / bins) * 2 * Math.PI;
            const gx = Math.cos(a);
            const gy = Math.sin(a);
            const { W, jitter } = this;
            /** Distance of cell `i` along gravity, in cells, plus its jitter. */
            const key = (i) => (i % W) * gx + ((i / W) | 0) * gy + jitter[i];
            order = Int32Array.from(this.interior).sort((p, q) => key(q) - key(p));
            this.orders.set(bin, order);
        }
        return order;
    }

    /**
     * Advances one tick with gravity (gx, gy) in grid coordinates; |g| = 1 is full gravity.
     *
     * @remarks
     * Each grain is accelerated by `ACCEL * |g|` along gravity, capped at `MAX_SPEED`, then moves up to
     * that many cells, one neighbour at a time: straight on if free, else a 45° slide downhill, else
     * (sometimes) a knight's-move spread, else it comes to rest and loses its velocity. Below
     * `MIN_GRAVITY` nothing moves, but the neck gate still banks flow and the counts are refreshed.
     *
     * @param {number} gx - Gravity's x component, in grid coordinates (positive to the right).
     * @param {number} gy - Gravity's y component, in grid coordinates (positive downwards).
     * @see docs/simulation.md ("One tick").
     */
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

    /**
     * Whether a grain may move into cell `q`: it must be {@link EMPTY}, and when the neck gate is on,
     * entering the neck row from outside it needs at least one grain of {@link SandSim.budget}.
     *
     * @param {number} q - Index of the target cell.
     * @param {number} fromY - Row the grain is moving from.
     * @param {number} toY - Row of `q`.
     * @param {boolean} gated - Whether the neck gate is active (finite {@link SandSim.flowRate}).
     * @returns {boolean} True if the move is allowed. Doesn't spend budget; the caller does.
     */
    canEnter(q, fromY, toY, gated) {
        if (this.cells[q] !== EMPTY) return false;
        if (gated && toY === this.neckRow && fromY !== this.neckRow) return this.budget >= 1;
        return true;
    }
}
