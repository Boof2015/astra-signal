import { describe, it, expect } from "vitest";
import { rsEncode, rsDecode } from "../src/ecc";

function randomMsg(len: number, seed: number): number[] {
  // deterministic LCG so failures are reproducible
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out.push(s & 0xff);
  }
  return out;
}

describe("Reed–Solomon GF(256)", () => {
  it("round-trips with no errors", () => {
    const msg = [0x40, 0xd2, 0x75, 0x47, 0x76, 0x17, 0x32, 0x06, 0x27, 0x26];
    const nsym = 10;
    const code = rsEncode(msg, nsym);
    expect(code.length).toBe(msg.length + nsym);
    const { msg: decoded, corrected } = rsDecode(code, nsym);
    expect(decoded).toEqual(msg);
    expect(corrected).toBe(0);
  });

  it("corrects up to floor(nsym/2) byte errors at random positions", () => {
    const nsym = 16; // corrects up to 8 errors
    for (let trial = 0; trial < 200; trial++) {
      const msg = randomMsg(30, trial + 1);
      const code = rsEncode(msg, nsym);
      const t = nsym / 2; // 8

      // corrupt exactly t distinct positions with nonzero deltas
      const positions = new Set<number>();
      let s = (trial * 2654435761) >>> 0;
      while (positions.size < t) {
        s = (s * 1664525 + 1013904223) >>> 0;
        positions.add(s % code.length);
      }
      for (const p of positions) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const delta = (s % 255) + 1; // 1..255, guarantees a real change
        code[p] = code[p]! ^ delta;
      }

      const { msg: decoded, corrected } = rsDecode(code, nsym);
      expect(decoded).toEqual(msg);
      expect(corrected).toBe(t);
    }
  });

  it("corrects a single-byte error (the common camera case)", () => {
    const msg = randomMsg(40, 999);
    const nsym = 12;
    const code = rsEncode(msg, nsym);
    code[7] = code[7]! ^ 0x5a;
    const { msg: decoded } = rsDecode(code, nsym);
    expect(decoded).toEqual(msg);
  });

  it("uses erasure positions to recover beyond the error-only limit", () => {
    const msg = randomMsg(24, 1234);
    const nsym = 8;
    const code = rsEncode(msg, nsym);
    const positions = [1, 5, 9, 13, 17, 21];
    for (const position of positions) code[position] = code[position]! ^ (0x31 + position);
    const decoded = rsDecode(code, nsym, positions);
    expect(decoded.msg).toEqual(msg);
    expect(decoded.erasures).toBe(positions.length);
  });

  it("throws when corruption exceeds correction capacity", () => {
    const msg = randomMsg(20, 3);
    const nsym = 8; // corrects up to 4
    const code = rsEncode(msg, nsym);
    // 6 errors -> uncorrectable; should throw rather than silently mis-decode
    for (const p of [0, 3, 6, 9, 12, 15]) code[p] = code[p]! ^ 0x7f;
    expect(() => rsDecode(code, nsym)).toThrow();
  });
});
