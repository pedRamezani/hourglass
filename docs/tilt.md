# Tilt sensor (`js/tilt.js`)

`Tilt` turns `deviceorientation` events into a gravity vector in screen coordinates (x right, y down). Its length is the share of gravity in the screen plane: 1 with the phone upright, about 0 lying flat (the simulation then rests).

## Maths

From the spec's Z-X'-Y'' Euler angles, gravity in device coordinates is `(cos β · sin γ, sin β)`. It is then rotated by the screen orientation angle (`screen.orientation.angle`, falling back to `window.orientation`) so landscape works. A low-pass filter (factor 0.25) smooths sensor noise.

## Enabling

- The "Use tilt" button is only shown when `DeviceOrientationEvent` exists and the device has a coarse pointer.
- `enable()` must run inside a user gesture: iOS Safari requires `DeviceOrientationEvent.requestPermission()`.
- Desktop browsers expose the event but never send real values. `enable()` waits up to 1.5 s for an event with non-null `beta`/`gamma` and otherwise rejects with "No tilt sensor found"; the error is shown in the status line.
- Browsers only deliver orientation data in secure contexts: HTTPS or `localhost`. A phone opening the dev server by LAN IP gets nothing.

## Testing

- **Desktop:** Chrome/Brave DevTools → More tools → Sensors → Orientation emulates `beta`/`gamma`. Turn on device emulation too, so the pointer is coarse and the button appears.
- **Phone:** needs HTTPS, e.g. a deployed preview or a tunnel to the local server.
- The maths has not been verified on a real device yet. If the sand moves the wrong way on one platform, check the sign of `beta`/`gamma` there first.
