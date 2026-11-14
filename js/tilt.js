/**
 * Gravity from the device orientation sensor, in screen coordinates (x right, y down).
 * The length of the vector is the share of gravity acting in the screen plane:
 * 1 when the phone is upright, ~0 when it lies flat on a table.
 *
 * @see docs/tilt.md for the maths, the permission flow and how to test without a phone.
 * @packageDocumentation
 */

/** Radians per degree. */
const DEG = Math.PI / 180;

/**
 * Reads `deviceorientation` events and turns them into a smoothed gravity vector in screen
 * coordinates, ready to be rotated into the glass's frame.
 *
 * @example
 * const tilt = new Tilt();
 * button.addEventListener('click', () => tilt.enable().catch((e) => show(e.message)));
 * // every frame:
 * const g = tilt.active ? tilt.gravity : { x: 0, y: 1 };
 */
export class Tilt {
    /**
     * Whether the browser exposes `DeviceOrientationEvent` at all. Desktop browsers often expose
     * it without ever firing it, so {@link Tilt.enable} still has to wait for real data.
     * @returns {boolean}
     */
    static get supported() {
        return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
    }

    /** Creates an inactive reader; nothing is listened to until {@link Tilt.enable}. */
    constructor() {
        /** True once {@link Tilt.enable} has received sensor data, until {@link Tilt.disable}. @type {boolean} */
        this.active = false;
        /**
         * Low-pass filtered gravity in screen coordinates (x right, y down); length 0–1, the share of
         * gravity in the screen plane. Straight down `{ x: 0, y: 1 }` while inactive.
         * @type {import('./sim.js').Vec2}
         */
        this.gravity = { x: 0, y: 1 };
        this.onOrientation = this.onOrientation.bind(this);
    }

    /**
     * Must be called from a user gesture (iOS asks for permission). Resolves once data arrives.
     *
     * @remarks
     * Starts listening, then polls every 50 ms for the first real reading. If none arrives within
     * 1.5 s (a desktop browser, or a device without a sensor) it stops listening and rejects.
     *
     * @returns {Promise<void>} Resolves once {@link Tilt.gravity} holds sensor data and {@link Tilt.active} is true.
     * @throws {Error} If permission is denied or no sensor data arrives; the message is meant for the user.
     */
    async enable() {
        const Event = window.DeviceOrientationEvent;
        if (typeof Event.requestPermission === 'function') {
            const state = await Event.requestPermission();
            if (state !== 'granted') throw new Error('Motion access was denied.');
        }

        /** Whether a usable reading has arrived since the last {@link Tilt.enable}. @type {boolean} */
        this.hasData = false;
        window.addEventListener('deviceorientation', this.onOrientation);
        // Desktop browsers expose the event but never fire it with real values.
        await new Promise((resolve, reject) => {
            const start = performance.now();
            /** Resolves on data, rejects after 1.5 s, otherwise polls again in 50 ms. */
            const check = () => {
                if (this.hasData) resolve();
                else if (performance.now() - start > 1500) reject(new Error('No tilt sensor found on this device.'));
                else setTimeout(check, 50);
            };
            check();
        }).catch((error) => {
            this.disable();
            throw error;
        });
        this.active = true;
    }

    /** Stops listening and resets {@link Tilt.gravity} to straight down. Safe to call when inactive. */
    disable() {
        window.removeEventListener('deviceorientation', this.onOrientation);
        this.active = false;
        this.gravity = { x: 0, y: 1 };
    }

    /**
     * `deviceorientation` handler (bound in the constructor): converts the angles to screen-plane
     * gravity and blends it into {@link Tilt.gravity}.
     *
     * @remarks
     * The first reading is taken as is; later ones are low-pass filtered (25 % per event).
     * Events without angles (some desktop browsers fire those) are ignored.
     *
     * @param {DeviceOrientationEvent} event - Uses `beta` (front-back tilt) and `gamma` (left-right tilt), in degrees.
     */
    onOrientation({ beta, gamma }) {
        if (beta == null || gamma == null) return;
        const b = beta * DEG;
        const g = gamma * DEG;
        // Gravity in device coordinates (x right, y down), derived from the Z-X'-Y'' Euler angles.
        const dx = Math.cos(b) * Math.sin(g);
        const dy = Math.sin(b);
        // The screen may be rotated relative to the device (landscape).
        const a = (screen.orientation?.angle ?? window.orientation ?? 0) * DEG;
        const x = dx * Math.cos(a) + dy * Math.sin(a);
        const y = -dx * Math.sin(a) + dy * Math.cos(a);

        // Low-pass filter against sensor noise.
        const k = this.hasData ? 0.25 : 1;
        this.gravity = {
            x: this.gravity.x + (x - this.gravity.x) * k,
            y: this.gravity.y + (y - this.gravity.y) * k,
        };
        this.hasData = true;
    }
}
