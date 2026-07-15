// Static Huffman coder over the Signal symbol alphabet. Deterministic and
// dictionary-free (the frequency table is baked in), so encoder and decoder
// build the identical tree — no shared asset, no database, and it shrinks the
// text ~30-40% vs. flat 6-bit symbols, which is what lets a Signal fit in a
// single short row of bars.
//
// Symbols 0..127 map exactly to ASCII bytes and 128 is EOF. Frequencies favor
// music-metadata text while retaining every case and punctuation mark losslessly.

import { BitReader, BitWriter } from "./bits";

export const EOF_SYMBOL = 128;
const NUM_SYMBOLS = 129;

// Relative frequencies (English letters + space-heavy text). Exact values don't
// matter for correctness, only for how short each code ends up; both ends use
// this same table so the tree is identical.
const WEIGHTS: number[] = (() => {
  const w = new Array<number>(NUM_SYMBOLS).fill(1);
  const letters = [
    82, 15, 28, 43, 127, 22, 20, 61, 70, 2, 8, 40, 24, // a..m
    67, 75, 19, 1, 60, 63, 91, 28, 10, 24, 2, 20, 1, // n..z
  ];
  for (let i = 0; i < 26; i++) {
    w[0x61 + i] = letters[i]!;
    w[0x41 + i] = Math.max(2, Math.round(letters[i]! / 8));
  }
  for (let i = 0; i < 10; i++) w[0x30 + i] = 7;
  w[0x20] = 180;
  for (const [character, weight] of [
    ["'", 16], ["-", 14], ["&", 12], [".", 11], ["!", 9], ["/", 8],
    ["#", 7], ["(", 6], [")", 6], [",", 6], [":", 5], ["+", 4], ["?", 4],
  ] as const) {
    w[character.charCodeAt(0)] = weight;
  }
  w[EOF_SYMBOL] = 30;
  return w;
})();

interface Node {
  weight: number;
  symbol: number; // -1 for internal nodes
  left?: Node;
  right?: Node;
  order: number; // stable tie-breaker so the tree is deterministic
}

const TREE: Node = (() => {
  let counter = 0;
  let nodes: Node[] = [];
  for (let s = 0; s < NUM_SYMBOLS; s++) {
    nodes.push({ weight: WEIGHTS[s]!, symbol: s, order: counter++ });
  }
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.weight - b.weight || a.order - b.order);
    const a = nodes.shift()!;
    const b = nodes.shift()!;
    nodes.push({ weight: a.weight + b.weight, symbol: -1, left: a, right: b, order: counter++ });
  }
  return nodes[0]!;
})();

// symbol -> array of bits (0/1), MSB-first along the tree path.
const CODES: number[][] = (() => {
  const codes: number[][] = new Array(NUM_SYMBOLS);
  const walk = (node: Node, path: number[]) => {
    if (node.symbol >= 0) {
      codes[node.symbol] = path.slice();
      return;
    }
    if (node.left) walk(node.left, [...path, 0]);
    if (node.right) walk(node.right, [...path, 1]);
  };
  walk(TREE, []);
  return codes;
})();

/** Huffman-encode a symbol stream (append EOF_SYMBOL yourself) to a bit array. */
export function huffEncodeBits(symbols: ReadonlyArray<number>): number[] {
  const bits: number[] = [];
  for (const s of symbols) {
    const code = CODES[s];
    if (!code) throw new Error(`no Huffman code for symbol ${s}`);
    for (const b of code) bits.push(b);
  }
  return bits;
}

/** Bit length a symbol would occupy — used to greedily pack up to a budget. */
export function huffBitLength(symbol: number): number {
  return CODES[symbol]?.length ?? 0;
}

/** Decode from a BitReader until EOF_SYMBOL (which is not included in output). */
export function huffDecodeSymbols(reader: BitReader): number[] {
  const out: number[] = [];
  // Bounded so a corrupted/rubbish stream can't loop forever.
  for (let guard = 0; guard < 4096; guard++) {
    let node = TREE;
    while (node.symbol < 0) {
      const bit = reader.readBits(1);
      node = bit === 0 ? node.left! : node.right!;
      if (!node) return out;
    }
    if (node.symbol === EOF_SYMBOL) break;
    out.push(node.symbol);
    if (reader.remaining <= 0) break;
  }
  return out;
}

export function huffDecodeSymbolsStrict(reader: BitReader): number[] {
  const out: number[] = [];
  for (let guard = 0; guard < 4096 && reader.remaining > 0; guard++) {
    let node = TREE;
    while (node.symbol < 0) {
      if (reader.remaining <= 0) throw new Error("ASCII Huffman stream is missing EOF");
      node = reader.readBits(1) === 0 ? node.left! : node.right!;
    }
    if (node.symbol === EOF_SYMBOL) {
      while (reader.remaining > 0) {
        if (reader.readBits(1) !== 0) throw new Error("ASCII Huffman stream has non-zero padding");
      }
      return out;
    }
    out.push(node.symbol);
  }
  throw new Error("ASCII Huffman stream is missing EOF");
}

/** Convenience: pack an encoded bit array into bytes. */
export function bitsToBytes(bits: ReadonlyArray<number>): number[] {
  const bw = new BitWriter();
  for (const b of bits) bw.writeBits(b, 1);
  return bw.toBytes();
}
