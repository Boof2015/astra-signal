export const ASCII_EOF_SYMBOL = 128;

export function isStrictAscii(input: string): boolean {
  for (let i = 0; i < input.length; i++) if (input.charCodeAt(i) > 0x7f) return false;
  return true;
}

/** Exact ASCII mapping. Case, punctuation, spacing, and control bytes are preserved. */
export function asciiTextToSymbols(text: string): number[] {
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code > 0x7f) throw new Error("text is not strict ASCII metadata");
    out.push(code);
  }
  return out;
}

export function asciiSymbolsToText(symbols: ReadonlyArray<number>): string {
  let out = "";
  for (const symbol of symbols) {
    if (!Number.isInteger(symbol) || symbol < 0 || symbol > 0x7f) {
      throw new Error("invalid ASCII metadata symbol");
    }
    out += String.fromCharCode(symbol);
  }
  return out;
}
