/**
 * Tests for the simulation in `js/sim.js`: the glass is closed, the sand drains, the timer is
 * accurate and grains are conserved.
 *
 * @remarks
 * Run with `npm test` (Node's built-in test runner, no dependencies). Needs Node 22 or newer.
 * The simulation is random, so the bounds are generous.
 *
 * @see docs/simulation.md ("Invariants").
 * @packageDocumentation
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHourglass, SandSim, SAND, EMPTY, OUTSIDE, TICKS_PER_SECOND } from '../js/sim.js';

/**
 * Counts the sand cells in the whole grid.
 * @param {SandSim} sim - The simulation to inspect.
 * @returns {number} Number of {@link SAND} cells.
 */
const countSand = (sim) => sim.cells.reduce((n, c) => n + (c === SAND), 0);

/**
 * Steps the simulation under constant gravity until the top bulb is empty.
 * @param {SandSim} sim - The simulation to advance.
 * @param {number} gx - Gravity's x component, in grid coordinates.
 * @param {number} gy - Gravity's y component, in grid coordinates.
 * @param {number} maxSeconds - Simulated time to give up after, in seconds.
 * @returns {number} Simulated seconds until `sim.top` reached 0, or `Infinity` if it never did.
 */
function run(sim, gx, gy, maxSeconds) {
    for (let t = 0; t < maxSeconds * TICKS_PER_SECOND; t++) {
        sim.step(gx, gy);
        if (sim.top === 0) return t / TICKS_PER_SECOND;
    }
    return Infinity;
}

test('the hourglass is closed: no interior cell touches the outside', () => {
    const { W, cells } = buildHourglass();
    for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== EMPTY) continue;
        for (const d of [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1]) {
            assert.notEqual(cells[i + d], OUTSIDE, `cell ${i} leaks`);
        }
    }
});

test('the top bulb drains completely without a timer', () => {
    const sim = new SandSim(buildHourglass());
    sim.fill(-1);
    const seconds = run(sim, 0, 1, 60);
    assert.ok(seconds < 20, `took ${seconds}s, grains are probably stuck on the walls`);
});

test('the neck gate makes the timer accurate', () => {
    for (const duration of [30, 60]) {
        const sim = new SandSim(buildHourglass());
        sim.fill(-1);
        sim.setDuration(duration);
        const seconds = run(sim, 0, 1, duration * 2);
        assert.ok(Math.abs(seconds - duration) < 1, `${duration}s timer took ${seconds}s`);
    }
});

test('grains are conserved under any gravity', () => {
    const sim = new SandSim(buildHourglass());
    sim.fill(-1);
    const total = countSand(sim);
    for (let k = 0; k < 600; k++) {
        const a = k / 60;
        sim.step(Math.sin(a), Math.cos(a)); // a full slow rotation
    }
    for (let k = 0; k < 120; k++) sim.step(0, 0.03); // below the rest threshold
    assert.equal(countSand(sim), total);
    assert.equal(sim.top + sim.bottom + countNeck(sim), total);
});

/**
 * Counts the grains in the neck row, which {@link SandSim.top} and {@link SandSim.bottom} leave out.
 * @param {SandSim} sim - The simulation to inspect.
 * @returns {number} Number of {@link SAND} cells in `sim.neckRow`.
 */
function countNeck(sim) {
    let n = 0;
    for (let x = 0; x < sim.W; x++) n += sim.cells[sim.neckRow * sim.W + x] === SAND;
    return n;
}
