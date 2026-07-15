# @boof2015/astra-signal

Portable TypeScript encoding and camera decoding for Astra Signal: a connected,
audio-spectrum-shaped mark carrying song metadata without accounts, database
registration, or provider-specific IDs.

Version 0.3.0 implements the clean-break v3 format. It preserves ASCII case and
punctuation exactly, supports Unicode metadata,
three payload sizes, Reed–Solomon errors and erasures, CRC validation, reference
rasterization, perspective and bounded lens-distortion recovery, and strict
`astra:signal:v3:` links. There are no runtime dependencies.

```ts
import {
  decodeSignalImage,
  decodeSignalLink,
  encodeSignal,
  encodeSignalLink,
  rasterizeSignal,
} from "@boof2015/astra-signal";

const input = {
  artist: "ナナツカゼ",
  title: "Replay",
  durationSec: 161,
};

const layout = encodeSignal(input);
const rgba = rasterizeSignal(layout, { scale: 6 });
const decoded = decodeSignalImage(rgba);

console.log(decoded.payload.artist); // ナナツカゼ
console.log(decodeSignalLink(encodeSignalLink(input)));
```

## API

- `encodeSignal(input)` → render-agnostic connected-envelope `SignalLayout`
- `decodeSignalImage(image, options?)` → validated `SignalDecodeResult`
- `encodeSignalLink(input)` / `decodeSignalLink(value)`
- `encodeSignalFrame(input)` / `decodeSignalFrame(bytes)` for wire-level use
- `decodeSignalColumns(tier, columns)` for already-sampled optical data
- `rasterizeSignal(layout, options?)` for a portable RGBA reference render
- `SIGNAL_SPEC`, `tierSpec`, and geometry helpers

See [SPEC.md](./SPEC.md) for the frozen wire and optical contract.

## Development

```sh
npm test
npm run typecheck
npm run build
npm pack
```

`prepublishOnly` runs typecheck, tests, and the ESM/CJS/declaration build. The
camera suite covers Unicode golden vectors, fractional scale, perspective,
rotation, blur, resampling, noise, lighting gradients, glare fragmentation,
display bloom on dark scenes, bounded lens distortion, block artifacts, clutter,
and negative images. Real phone-to-phone acceptance remains a required device
check because screen optics cannot be proven in Node.
