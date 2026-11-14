// Gravity from the device orientation sensor, in screen coordinates (x right, y down).
// The length of the vector is the share of gravity acting in the screen plane:
// 1 when the phone is upright, ~0 when it lies flat on a table.

const DEG = Math.PI / 180;

export class Tilt {
    static get supported() {
        return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
    }

    constructor() {
        this.active = false;
        this.gravity = { x: 0, y: 1 };
        this.onOrientation = this.onOrientation.bind(this);
    }

    /** Must be called from a user gesture (iOS asks for permission). Resolves once data arrives. */
    async enable() {
        const Event = window.DeviceOrientationEvent;
        if (typeof Event.requestPermission === 'function') {
            const state = await Event.requestPermission();
            if (state !== 'granted') throw new Error('Motion access was denied.');
        }

        this.hasData = false;
        window.addEventListener('deviceorientation', this.onOrientation);
        // Desktop browsers expose the event but never fire it with real values.
        await new Promise((resolve, reject) => {
            const start = performance.now();
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

    disable() {
        window.removeEventListener('deviceorientation', this.onOrientation);
        this.active = false;
        this.gravity = { x: 0, y: 1 };
    }

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
