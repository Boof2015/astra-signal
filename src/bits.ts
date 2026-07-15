// Minimal MSB-first bit packing helpers, shared by the payload codec (packing
// 6-bit symbols into bytes) and the visual layer (mapping codeword bytes to
// per-bar height levels).

export class BitWriter {
  private bits: number[] = [];

  writeBits(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  /** Pack accumulated bits into bytes, MSB-first, zero-padding the last byte. */
  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] ?? 0);
      bytes.push(b);
    }
    return bytes;
  }
}

export class BitReader {
  private pos = 0;
  constructor(private readonly bits: ReadonlyArray<number>) {}

  readBits(count: number): number {
    let v = 0;
    for (let i = 0; i < count; i++) v = (v << 1) | (this.bits[this.pos++] ?? 0);
    return v;
  }

  get remaining(): number {
    return this.bits.length - this.pos;
  }
}

/** Expand a byte array to an MSB-first bit array. */
export function bytesToBits(bytes: ReadonlyArray<number>): number[] {
  const bits: number[] = [];
  for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  return bits;
}
