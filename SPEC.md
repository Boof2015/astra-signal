# Astra Signal format — v3

An Astra Signal is a self-contained, monochrome spectrum mark carrying enough
metadata to identify a song without a registration service or private ID. v3 is
a clean break from the unpublished v2 prototype.

## Frame

The unpadded frame is:

| Byte | Meaning |
| --- | --- |
| 0 | `0011 cc tt`: v3, two-bit text codec, two-bit tier |
| 1–2 | duration in whole seconds, unsigned big-endian |
| 3 | combined encoded body length |
| 4 | encoded artist length within the body |
| 5… | artist bytes followed by title bytes |
| final 2 | CRC-16/CCITT-FALSE over all preceding frame bytes |

Codec IDs are `1` SCSU, `2` strict UTF-8, and `3` ASCII Huffman. Codec ID `0`
is reserved and rejected so lossy prototype frames cannot be misinterpreted.
ASCII Huffman uses a frozen music-metadata frequency tree over all 128 ASCII values,
preserving case, punctuation, and spacing exactly. Artist and title are encoded
as separate EOF-terminated streams. The deterministic SCSU encoder follows UTS
#6 and the decoder accepts all standard commands. The encoder compares every
eligible codec and chooses the shortest, breaking ties in the order above.

Tier IDs and Reed–Solomon parameters are:

| Tier | Data | Parity | Codeword | Optical columns |
| --- | ---: | ---: | ---: | ---: |
| small | 19 | 8 | 27 | 54 |
| medium | 27 | 12 | 39 | 78 |
| large | 35 | 16 | 51 | 102 |

The frame is zero-padded to the tier's data length before RS encoding. RS uses
GF(256), primitive polynomial `0x11d`, generator alpha 2. Decoding supports both
errors and confidence-derived erasures under `2e + s <= parityBytes`.

The smallest fitting tier is used. If a complete frame exceeds the large tier,
the title is shortened at a Unicode scalar boundary while preserving the full
artist. Only when the artist alone cannot fit is the artist shortened.

## Optical carrier

Every codeword byte becomes two optical columns. The high nibble is emitted
first. Within each nibble, two bits select the upper height and two select the
lower height. Each two-bit value is Gray-decoded to one of four levels, so an
adjacent height error changes one bit.

The columns touch horizontally and cross the center axis, producing one filled
dual-envelope spectrum rather than separated barcode sticks. Each side uses
heights 4, 8, 12, and 16 modules. Column pitch is 2 modules; the quiet zone is 4
modules; total height is 40 modules.

Four guard columns sit on each side. Top and bottom use the same guard levels:

- Left: `3,0,2,3`
- Right: `3,tier,1,3`

The full-height outside guards provide the four perspective anchors. The
asymmetric interior chirps establish direction and tier.

Canonical dimensions are 132×40 modules for small, 180×40 for medium, and
228×40 for large.

## Decode contract

Image decoding tries scene Otsu, bounded lifted-global, and local adaptive
thresholds. The lifted candidates handle display bloom when a large dark phone
body biases scene Otsu below the apparent ink level. The decoder finds connected
wide-spectrum candidates, merges fragments separated by narrow glare, and tries
extreme-point, principal-axis, and bounding quadrilaterals before homography
rectification. It samples upper/lower heights from three sub-columns. When the
guards validate but the payload does not, a bounded endpoint-preserving cubic
warp covers residual horizontal lens distortion. Low-confidence bytes become RS
erasures and a bounded secondary-level search handles ambiguous edges.

A result is valid only when guard chirps, tier, version, lengths, text streams,
RS syndromes, and CRC all agree. Failure at any stage must throw; a plausible but
uncertain payload must never be returned.

## Link form

`astra:signal:v3:<base64url-frame>` contains the unpadded frame including CRC.
It omits RS parity because the link is not an optical channel. v1/v2 links are
not accepted.
