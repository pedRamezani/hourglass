// Run with `npm test` (Node's built-in test runner, no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHourglass, SandSim, SAND, EMPTY, OUTSIDE, TICKS_PER_SECOND } from '../js/sim.js';

const countSand = (sim) => sim.cells.reduce((n, c) => n + (c === SAND), 0);

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

function countNeck(sim) {
    let n = 0;
    for (let x = 0; x < sim.W; x++) n += sim.cells[sim.neckRow * sim.W + x] === SAND;
    return n;
}
