import { BitReader, bytesToBits } from "./bits";
import { asciiSymbolsToText, asciiTextToSymbols, isStrictAscii } from "./charset";
import { bitsToBytes, EOF_SYMBOL, huffDecodeSymbolsStrict, huffEncodeBits } from "./compress";
import { scsuDecode, scsuEncode } from "./scsu";
import type { SignalTextCodec } from "./types";

export interface EncodedFields {
  readonly codec: SignalTextCodec;
  readonly artist: string;
  readonly title: string;
  readonly artistBytes: number[];
  readonly titleBytes: number[];
}

function utf8Encode(input: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let cp = input.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + low - 0xdc00;
        i++;
      } else cp = 0xfffd;
    } else if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp <= 0x7f) out.push(cp);
    else if (cp <= 0x7ff) out.push(0xc0 | (cp >>> 6), 0x80 | (cp & 0x3f));
    else if (cp <= 0xffff) out.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >>> 18), 0x80 | ((cp >>> 12) & 0x3f), 0x80 | ((cp >>> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

function utf8Decode(bytes: ReadonlyArray<number>): string {
  const units: number[] = [];
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++]! & 0xff;
    let cp = first;
    let count = 0;
    let min = 0;
    if (first <= 0x7f) {
      units.push(first);
      continue;
    } else if (first >= 0xc2 && first <= 0xdf) {
      cp = first & 0x1f; count = 1; min = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      cp = first & 0x0f; count = 2; min = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      cp = first & 0x07; count = 3; min = 0x10000;
    } else throw new Error("invalid UTF-8 lead byte");
    if (i + count > bytes.length) throw new Error("truncated UTF-8 stream");
    for (let j = 0; j < count; j++) {
      const next = bytes[i++]! & 0xff;
      if ((next & 0xc0) !== 0x80) throw new Error("invalid UTF-8 continuation byte");
      cp = (cp << 6) | (next & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) throw new Error("invalid UTF-8 code point");
    if (cp <= 0xffff) units.push(cp);
    else {
      cp -= 0x10000;
      units.push(0xd800 + (cp >>> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return String.fromCharCode(...units);
}

function huffmanEncodeField(input: string): number[] {
  const symbols = [...asciiTextToSymbols(input), EOF_SYMBOL];
  return bitsToBytes(huffEncodeBits(symbols));
}

function huffmanDecodeField(bytes: ReadonlyArray<number>): string {
  return asciiSymbolsToText(huffDecodeSymbolsStrict(new BitReader(bytesToBits(bytes))));
}

export function encodeFieldCandidates(artistInput: string, titleInput: string): EncodedFields[] {
  const artist = artistInput ?? "";
  const title = titleInput ?? "";
  const candidates: EncodedFields[] = [];
  if (isStrictAscii(artist) && isStrictAscii(title)) {
    candidates.push({
      codec: "ascii-huffman",
      artist,
      title,
      artistBytes: huffmanEncodeField(artist),
      titleBytes: huffmanEncodeField(title),
    });
  }
  candidates.push({ codec: "scsu", artist, title, artistBytes: scsuEncode(artist), titleBytes: scsuEncode(title) });
  candidates.push({ codec: "utf8", artist, title, artistBytes: utf8Encode(artist), titleBytes: utf8Encode(title) });
  const priority: Record<SignalTextCodec, number> = { "ascii-huffman": 0, scsu: 1, utf8: 2 };
  return candidates.sort((a, b) =>
    a.artistBytes.length + a.titleBytes.length - b.artistBytes.length - b.titleBytes.length ||
    priority[a.codec] - priority[b.codec]
  );
}

export function decodeFields(
  codec: SignalTextCodec,
  artistBytes: ReadonlyArray<number>,
  titleBytes: ReadonlyArray<number>
): { artist: string; title: string } {
  if (codec === "ascii-huffman") {
    return { artist: huffmanDecodeField(artistBytes), title: huffmanDecodeField(titleBytes) };
  }
  if (codec === "scsu") return { artist: scsuDecode(artistBytes), title: scsuDecode(titleBytes) };
  return { artist: utf8Decode(artistBytes), title: utf8Decode(titleBytes) };
}
