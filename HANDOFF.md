# Astra Signal v3 — engineering handoff

## Current direction

Astra Signal is a self-contained song-metadata carrier shaped as one connected,
centered spectrum. It deliberately does not use MBIDs, ISRCs, short database
keys, registration, or accounts. The same TypeScript package is intended for
Astra Mobile, desktop, and the future client-side `astramusic.dev/signal` page.

The unpublished v2 square-finder/barcode prototype was discarded. v3 uses a
filled upper/lower envelope, three capacity tiers, Unicode-aware compression,
RS errors and erasures, and CRC-checked failure behavior. There is no backward
compatibility.

The exact contract is in `SPEC.md`; do not duplicate geometry or wire constants
outside `src/spec.ts`.

## Package state

- Package: `@boof2015/astra-signal` 0.3.0
- Runtime dependencies: none
- Link prefix: `astra:signal:v3:`
- Required regression artist: `ナナツカゼ`
- ASCII Huffman is lossless: case and punctuation such as `N!GHT` and `#iwannadance` must remain exact
- Optical API returns payload plus tier, corrected/erased byte counts, and confidence
- `dist` is committed and must be rebuilt after source changes

## Mobile testing scope

Astra Mobile consumes a freshly versioned npm tarball, never a symlink. The
Now Playing menu opens the Signal screen, which renders and shares the v3
envelope. The scanner uses still camera capture or an image picker. Live scanning,
playable-track resolution, desktop integration, and the website are later phases.

After any library change:

```sh
cd astra-signal
npm run typecheck
npm test
npm run build
npm pack
npm --prefix ../astra-mobile install ./boof2015-astra-signal-0.3.0.tgz
```

## S22 acceptance

1. Share/imported PNGs and ordinary phone screenshots must decode every time.
2. `ナナツカゼ` must survive exactly as the decoded artist.
3. Straight-on captures at 15–25 cm: 10/10.
4. Mixed handheld captures at 15–35 cm and up to about 25° tilt: at least 18/20.
5. Unrelated or failed images must never return a plausible song.

Do not launch an emulator. Camera, Skia offscreen rendering, and phone-to-phone
optics are device-only checks for the user's S22.
