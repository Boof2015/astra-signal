import { describe, expect, it } from "vitest";
import { decodeSignalFrame, encodeSignalFrame } from "../src/payload";
import { decodeSignalLink, encodeSignalLink } from "../src/link";

const CASES = [
  { artist: "Kendrick Lamar", title: "HUMBLE.", durationSec: 177 },
  { artist: "Beyoncé", title: "Déjà Vu", durationSec: 240 },
  { artist: "ナナツカゼ", title: "Replay", durationSec: 161 },
  { artist: "ナナツカゼ", title: "五月猫", durationSec: 207 },
  { artist: "PIKASONIC & ナナツカゼ", title: "青さは止んだ", durationSec: 194 },
  { artist: "Молчат Дома", title: "Судно", durationSec: 141 },
  { artist: "아이유", title: "밤편지", durationSec: 253 },
  { artist: "Porter Robinson", title: "Look at the Sky ✨", durationSec: 309 },
  { artist: "N!GHT", title: "#iwannadance", durationSec: 222 },
  { artist: "", title: "", durationSec: 0 },
];

describe("v3 frame codec", () => {
  const golden = [
    [
      { artist: "Portishead", title: "Roads", durationSec: 302 },
      "small", "ascii-huffman", "3c012e0b07eec6f019c6a2ade914566d6798",
    ],
    [
      { artist: "ナナツカゼ", title: "Replay", durationSec: 161 },
      "small", "scsu", "3400a10c0616aaaaa48b9c5265706c6179d7a0",
    ],
    [
      { artist: "中中א", title: "", durationSec: 1 },
      "small", "utf8", "3800010808e4b8ade4b8add790244d",
    ],
    [
      { artist: "Kendrick Lamar", title: "HUMBLE.", durationSec: 177 },
      "medium", "ascii-huffman", "3d00b1130beeb7eab851d6cf9244bda0e7edcefb83ee4badb49e",
    ],
    [
      { artist: "PIKASONIC & ナナツカゼ", title: "青さは止んだ", durationSec: 194 },
      "large", "scsu", "3600c21c1250494b41534f4e494320262016aaaaa48b9c0e97521595af0e6b62d339e0",
    ],
    [
      { artist: "Beyoncé", title: "Déjà Vu", durationSec: 240 },
      "medium", "scsu", "3500f00e074265796f6e63e944e96ae0205675e3ed",
    ],
    [
      { artist: "ナナツカゼ", title: "五月猫", durationSec: 207 },
      "medium", "scsu", "3500cf0f0616aaaaa48b9c0e4e940e67080e732b35ef",
    ],
    [
      { artist: "Молчат Дома", title: "Судно", durationSec: 141 },
      "medium", "scsu", "35008d120c129cbebbc7b0c22094bebcb012a1c3b4bdbee26f",
    ],
    [
      { artist: "아이유", title: "밤편지", durationSec: 253 },
      "medium", "scsu", "3500fd12090ec5440ec7740ec7200ebc240ed3b80ec9c0ada2",
    ],
    [
      { artist: "🎧", title: "Mix", durationSec: 1 },
      "small", "scsu", "34000107040b01e7a74d6978f983",
    ],
    [
      { artist: "", title: "", durationSec: 0 },
      "small", "scsu", "340000000094e4",
    ],
    [
      { artist: "N!GHT", title: "#iwannadance", durationSec: 222 },
      "medium", "ascii-huffman", "3d00de0f06e8f79d73afb49f0953ff4527e8db401e77",
    ],
    [
      { artist: "ナナツカゼ".repeat(50), title: "五月猫".repeat(100), durationSec: 207 },
      "large", "scsu", "3600cf1c1c16aaaaa48b9caaaaa48b9caaaaa48b9caaaaa48b9caaaaa48b9caaaad394",
    ],
  ] as const;

  it("matches the frozen golden vectors for every codec and tier", () => {
    for (const [input, tier, codec, hex] of golden) {
      const frame = encodeSignalFrame(input);
      expect(frame.tier).toBe(tier);
      expect(frame.codec).toBe(codec);
      expect(frame.bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")).toBe(hex);
    }
  });

  for (const input of CASES) {
    it(`round-trips ${input.artist || "<empty>"} - ${input.title || "<empty>"}`, () => {
      const encoded = encodeSignalFrame(input);
      const decoded = decodeSignalFrame(encoded.bytes);
      expect(decoded.payload).toEqual(encoded.payload);
      expect(decoded.tier).toBe(encoded.tier);
    });
  }

  it("uses deterministic codecs and tiers", () => {
    expect(encodeSignalFrame(CASES[0]!).codec).toBe("ascii-huffman");
    expect(encodeSignalFrame(CASES[2]!).codec).toBe("scsu");
    expect(encodeSignalFrame({ artist: "Portishead", title: "Roads", durationSec: 302 }).tier).toBe("small");
    expect(encodeSignalFrame({ artist: "A very long artist name", title: "A sufficiently long title to require another tier", durationSec: 1 }).tier)
      .not.toBe("small");
  });

  it("preserves ASCII case, punctuation, and spacing exactly", () => {
    const input = { artist: "N!GHT & Co.", title: "  #iwannadance?!  ", durationSec: 222 };
    const encoded = encodeSignalFrame(input);
    expect(encoded.codec).toBe("ascii-huffman");
    expect(decodeSignalFrame(encoded.bytes).payload).toEqual({ version: 3, type: "metadata", ...input });
  });

  it("round-trips deterministic Unicode properties across scalar ranges", () => {
    const scalars = ["ナ", "風", "é", "Ж", "한", "א", "🎧", "✨"];
    let state = 0x51a9c3;
    for (let trial = 0; trial < 100; trial++) {
      const next = (): string => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return scalars[state % scalars.length]!;
      };
      const artist = `${next()}${next()}${next()}`;
      const title = `${next()}${next()}`;
      const input = { artist, title, durationSec: state & 0xffff };
      const first = encodeSignalFrame(input);
      const second = encodeSignalFrame(input);
      expect(second.bytes).toEqual(first.bytes);
      expect(second.codec).toBe(first.codec);
      expect(decodeSignalFrame(first.bytes).payload).toEqual({
        version: 3,
        type: "metadata",
        ...input,
      });
    }
  });

  it("selects exact tier boundaries and truncates only after large is full", () => {
    expect(encodeSignalFrame({ artist: "x", title: "a".repeat(18) }).tier).toBe("small");
    expect(encodeSignalFrame({ artist: "x", title: "a".repeat(19) }).tier).toBe("medium");
    expect(encodeSignalFrame({ artist: "x", title: "a".repeat(34) }).tier).toBe("medium");
    expect(encodeSignalFrame({ artist: "x", title: "a".repeat(35) }).tier).toBe("large");
    expect(encodeSignalFrame({ artist: "x", title: "a".repeat(50) }).payload.title).toBe("a".repeat(50));
    expect(encodeSignalFrame({ artist: "x", title: "a".repeat(51) }).payload.title).toBe("a".repeat(50));
  });

  it("preserves the artist and truncates the title at a Unicode scalar boundary", () => {
    const artist = "ナナツカゼ";
    const encoded = encodeSignalFrame({ artist, title: "五月猫".repeat(100), durationSec: 207 });
    expect(encoded.tier).toBe("large");
    expect(encoded.payload.artist).toBe(artist);
    expect("五月猫".repeat(100).startsWith(encoded.payload.title)).toBe(true);
    expect(encoded.payload.title.length).toBeGreaterThan(0);
  });

  it("rejects damaged headers, lengths, and checksums", () => {
    const encoded = encodeSignalFrame(CASES[2]!);
    const wrongVersion = encoded.bytes.slice(); wrongVersion[0] = 0x20;
    const reservedCodec = encoded.bytes.slice(); reservedCodec[0] = reservedCodec[0]! & 0xf3;
    const wrongLength = encoded.bytes.slice(); wrongLength[3] = 250;
    const wrongCrc = encoded.bytes.slice(); wrongCrc[wrongCrc.length - 1] = wrongCrc[wrongCrc.length - 1]! ^ 1;
    const badPadding = encodeSignalFrame({ artist: "", title: "", durationSec: 0 }).paddedData.slice();
    badPadding[badPadding.length - 1] = 1;
    expect(() => decodeSignalFrame(wrongVersion)).toThrow(/version/);
    expect(() => decodeSignalFrame(reservedCodec)).toThrow(/codec/);
    expect(() => decodeSignalFrame(wrongLength)).toThrow(/truncated|exceeds/);
    expect(() => decodeSignalFrame(wrongCrc)).toThrow(/checksum/);
    expect(() => decodeSignalFrame(badPadding)).toThrow(/padding/);
    expect(() => decodeSignalFrame([...encoded.bytes.slice(0, -1), 999])).toThrow(/invalid byte/);
  });

  it("round-trips strict v3 links and rejects v2 or malformed input", () => {
    const link = encodeSignalLink(CASES[2]!);
    expect(link).toMatch(/^astra:signal:v3:[A-Za-z0-9_-]+$/);
    expect(decodeSignalLink(link)).toEqual(encodeSignalFrame(CASES[2]!).payload);
    expect(() => decodeSignalLink(link.replace("v3", "v2"))).toThrow();
    expect(() => decodeSignalLink(`${link}!`)).toThrow();

    const shortLink = encodeSignalLink({ artist: "", title: "", durationSec: 0 });
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(shortLink.at(-1)!);
    const nonCanonical = `${shortLink.slice(0, -1)}${alphabet[(last & 0x30) | ((last + 1) & 0x0f)]}`;
    expect(() => decodeSignalLink(nonCanonical)).toThrow(/canonical/);
  });
});
