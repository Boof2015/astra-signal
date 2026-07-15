import { crc16Ccitt } from "./crc";
import { SIGNAL_SPEC, tierSpec, type SignalTierSpec } from "./spec";
import { decodeFields, encodeFieldCandidates, type EncodedFields } from "./text";
import type { SignalInput, SignalPayload, SignalTextCodec, SignalTier } from "./types";

const HEADER_BYTES = 5;
const CRC_BYTES = 2;
// ID 0 belonged to the lossy v3 prototype Huffman tree and is intentionally
// rejected. Reusing it could turn an old test frame into plausible wrong text.
const CODEC_ID: Record<SignalTextCodec, number> = { "ascii-huffman": 3, scsu: 1, utf8: 2 };
const ID_CODEC: ReadonlyArray<SignalTextCodec | undefined> = [undefined, "scsu", "utf8", "ascii-huffman"];

export interface EncodedFrame {
  readonly bytes: number[];
  readonly paddedData: number[];
  readonly tier: SignalTier;
  readonly codec: SignalTextCodec;
  readonly payload: SignalPayload;
}

export interface DecodedFrame {
  readonly payload: SignalPayload;
  readonly tier: SignalTier;
  readonly codec: SignalTextCodec;
  readonly usedBytes: number;
}

function clampDuration(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return 0;
  return Math.max(0, Math.min(0xffff, Math.round(value)));
}

function frameForCandidate(candidate: EncodedFields, tier: SignalTierSpec, durationSec: number): EncodedFrame | null {
  const body = [...candidate.artistBytes, ...candidate.titleBytes];
  if (body.length > 0xff || candidate.artistBytes.length > 0xff) return null;
  const usedBytes = HEADER_BYTES + body.length + CRC_BYTES;
  if (usedBytes > tier.dataBytes) return null;
  const header = (SIGNAL_SPEC.version << 4) | (CODEC_ID[candidate.codec] << 2) | tier.id;
  const bytes = [
    header,
    (durationSec >>> 8) & 0xff,
    durationSec & 0xff,
    body.length,
    candidate.artistBytes.length,
    ...body,
  ];
  const crc = crc16Ccitt(bytes);
  bytes.push((crc >>> 8) & 0xff, crc & 0xff);
  const paddedData = bytes.concat(new Array<number>(tier.dataBytes - bytes.length).fill(0));
  return {
    bytes,
    paddedData,
    tier: tier.name,
    codec: candidate.codec,
    payload: {
      version: 3,
      type: "metadata",
      artist: candidate.artist,
      title: candidate.title,
      durationSec,
    },
  };
}

function tryEncode(artist: string, title: string, durationSec: number): EncodedFrame | null {
  for (const tier of SIGNAL_SPEC.tiers) {
    for (const candidate of encodeFieldCandidates(artist, title)) {
      const frame = frameForCandidate(candidate, tier, durationSec);
      if (frame) return frame;
    }
  }
  return null;
}

function scalarPrefixes(input: string): string[] {
  const prefixes = [""];
  let value = "";
  for (const scalar of input) {
    value += scalar;
    prefixes.push(value);
  }
  return prefixes;
}

export function encodeSignalFrame(input: SignalInput | SignalPayload): EncodedFrame {
  const durationSec = clampDuration(input.durationSec);
  const artist = input.artist ?? "";
  const title = input.title ?? "";
  const full = tryEncode(artist, title, durationSec);
  if (full) return full;

  const titlePrefixes = scalarPrefixes(title);
  for (let i = titlePrefixes.length - 1; i >= 0; i--) {
    const frame = tryEncode(artist, titlePrefixes[i]!, durationSec);
    if (frame) return frame;
  }
  const artistPrefixes = scalarPrefixes(artist);
  for (let i = artistPrefixes.length - 1; i >= 0; i--) {
    const frame = tryEncode(artistPrefixes[i]!, "", durationSec);
    if (frame) return frame;
  }
  throw new Error("could not encode Signal metadata");
}

export function decodeSignalFrame(bytes: ReadonlyArray<number>, expectedTier?: SignalTier): DecodedFrame {
  if (bytes.length < HEADER_BYTES + CRC_BYTES) throw new Error("Signal frame is too short");
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) {
    throw new Error("Signal frame contains an invalid byte");
  }
  const header = bytes[0]! & 0xff;
  const version = header >>> 4;
  if (version !== SIGNAL_SPEC.version) throw new Error(`unsupported Signal version ${version}`);
  const codecId = (header >>> 2) & 0x03;
  const codec = ID_CODEC[codecId];
  if (!codec) throw new Error("unsupported Signal text codec");
  const tier = tierSpec(header & 0x03);
  if (expectedTier && expectedTier !== tier.name) throw new Error("Signal tier marker does not match frame");
  if (bytes.length > tier.dataBytes) throw new Error("Signal frame exceeds its tier");
  const bodyLength = bytes[3]!;
  const artistLength = bytes[4]!;
  if (artistLength > bodyLength) throw new Error("invalid Signal artist length");
  const usedBytes = HEADER_BYTES + bodyLength + CRC_BYTES;
  if (usedBytes > bytes.length || usedBytes > tier.dataBytes) throw new Error("truncated Signal body");
  const expectedCrc = (bytes[usedBytes - 2]! << 8) | bytes[usedBytes - 1]!;
  const actualCrc = crc16Ccitt(bytes.slice(0, usedBytes - CRC_BYTES));
  if (expectedCrc !== actualCrc) throw new Error("Signal checksum mismatch");
  for (let index = usedBytes; index < bytes.length; index++) {
    if (bytes[index] !== 0) throw new Error("Signal frame contains non-zero padding");
  }
  const body = bytes.slice(HEADER_BYTES, HEADER_BYTES + bodyLength);
  const fields = decodeFields(codec, body.slice(0, artistLength), body.slice(artistLength));
  return {
    payload: {
      version: 3,
      type: "metadata",
      artist: fields.artist,
      title: fields.title,
      durationSec: (bytes[1]! << 8) | bytes[2]!,
    },
    tier: tier.name,
    codec,
    usedBytes,
  };
}
