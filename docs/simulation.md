# Simulation (`js/sim.js`)

DOM-free, so it runs in Node; `test/sim.test.mjs` exercises it directly.

## Model

- The world is a `W × H` grid (71 × 133 by default). `cells` holds one type per cell: `OUTSIDE`, `EMPTY` (inside the glass), `GLASS`, `FRAME` (wooden caps and posts) or `SAND`.
- Per-grain state lives in parallel typed arrays indexed by cell and is copied along when a grain moves: `shade` (colour variant 0–255), `vx`, `vy` (velocity in cells per tick).
- `interior` lists every cell a grain can ever occupy; all loops run over it instead of the whole grid.
- One tick is 1/60 s (`TICKS_PER_SECOND`). `step(gx, gy)` takes gravity in **grid coordinates** (x right, y down); length 1 is full gravity. The caller rotates screen gravity into the glass's frame (see [interface.md](interface.md)).

## One tick

1. Grains are visited furthest-along-gravity first, so a column falls together instead of one grain per tick. `orderFor()` sorts the interior by `position · gravity` plus a small fixed per-cell jitter (breaks left/right bias) and caches one order per 5° of gravity angle.
2. `stamp[cell] = tick` marks grains that already moved, so a grain moving "ahead" isn't processed twice.
3. Each grain: velocity += gravity × `ACCEL`, capped at `MAX_SPEED`. It moves `max(1, round-random(speed))` cells. The direction is its velocity once it moves faster than 0.6, otherwise gravity. A continuous direction is turned into one of the 8 neighbours by stochastic rounding, so the average path follows the exact angle.
4. Blocked: it tries the two cells 45° to either side, the more downhill one first. A slide is only allowed if it points at least `SLIDE_MIN_DOT` along gravity, which is what makes piles settle perpendicular to a tilted gravity. A slide keeps `SLIDE_KEEP` of the speed; no free cell means the grain stops (velocity 0).
5. Below `MIN_GRAVITY` (phone lying flat) nothing moves.
6. `count()` updates `top` / `bottom` (grains above / below `neckRow` in grid coordinates).

## Tuning

| Constant | Effect |
|---|---|
| `ACCEL` | How quickly falling grains speed up |
| `MAX_SPEED` | Terminal speed; higher values make streams thinner and more spread out |
| `SLIDE_MIN_DOT` | Higher = steeper piles, grains stop sooner on tilted surfaces |
| `SLIDE_KEEP` | Momentum kept after sliding off an obstacle |
| `MIN_GRAVITY` | Below this, sand rests |

## Hourglass shape (`buildHourglass`)

The interior half-width is built row by row outwards from the neck: a straight neck (`neck`, `neckLength`), then a funnel widening by at most `wallSlope` per row (gentler right at the neck), easing into a vertical bulb wall that rounds off towards the cap. Glass is every cell touching the interior; caps and posts are `FRAME`.

**Keep `wallSlope` well below 1.** The automaton piles sand at 45°, so a funnel wall at 45° or flatter holds a permanent layer of grains and the top bulb never empties. The test "the top bulb drains completely" catches this.

Changing the shape changes `W`/`H` and the grain count; the canvas and timer adapt automatically.

## Timer (neck gate)

`setDuration(seconds)` sets `flowRate = grains / (seconds × 60)` grains per tick; `0` removes the gate. Each tick adds `flowRate` to `budget`; entering the neck row from outside costs 1. The budget banks up to two seconds of flow, so short stalls (empty neck, a sideways tilt) are caught up and the timer stays accurate to well under a second. Without the gate the glass drains in about 10 s, so durations below ~15 s can't be enforced.

Call `setDuration` again after `fill()`, since the rate depends on the grain count.

## Invariants (covered by `npm test`)

- The interior never touches `OUTSIDE` (no leaks).
- The number of grains never changes.
- The top bulb drains completely; gated timers finish within 1 s of their duration.

A tick takes about 0.2 ms with ~1,700 grains, so there is plenty of headroom for a larger grid.
