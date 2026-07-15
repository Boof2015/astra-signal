// A deterministic SCSU encoder and strict decoder following Unicode Technical
// Standard #6. The encoder deliberately uses a small, predictable subset of
// the format; the decoder accepts the complete standard command set.

const STATIC_OFFSETS = [0x0000, 0x0080, 0x0100, 0x0300, 0x2000, 0x2080, 0x2100, 0x3000];
const INITIAL_DYNAMIC_OFFSETS = [0x0080, 0x00c0, 0x0400, 0x0600, 0x0900, 0x3040, 0x30a0, 0xff00];
const SPECIAL_OFFSETS = [0x00c0, 0x0250, 0x0370, 0x0530, 0x3040, 0x30a0, 0xff60];

function offsetFromIndex(index: number): number | null {
  if (index >= 0x01 && index <= 0x67) return index << 7;
  if (index >= 0x68 && index <= 0xa7) return (index << 7) + 0xac00;
  if (index >= 0xf9 && index <= 0xff) return SPECIAL_OFFSETS[index - 0xf9] ?? null;
  return null;
}

function indexForCodePoint(codePoint: number): { index: number; offset: number } | null {
  for (let i = 0; i < SPECIAL_OFFSETS.length; i++) {
    const offset = SPECIAL_OFFSETS[i]!;
    if (codePoint >= offset && codePoint < offset + 0x80) return { index: 0xf9 + i, offset };
  }
  const offset = codePoint & ~0x7f;
  if (offset >= 0x0080 && offset <= 0x3380) return { index: offset >>> 7, offset };
  if (offset >= 0xe000 && offset <= 0xff80) return { index: (offset - 0xac00) >>> 7, offset };
  return null;
}

function pushCodePoint(out: number[], codePoint: number): void {
  if (codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    throw new Error("invalid SCSU code point");
  }
  if (codePoint <= 0xffff) {
    out.push(codePoint);
    return;
  }
  const value = codePoint - 0x10000;
  out.push(0xd800 + (value >>> 10), 0xdc00 + (value & 0x3ff));
}

function codePoints(input: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const first = input.charCodeAt(i);
    if (first >= 0xd800 && first <= 0xdbff && i + 1 < input.length) {
      const second = input.charCodeAt(i + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        out.push(0x10000 + ((first - 0xd800) << 10) + second - 0xdc00);
        i++;
        continue;
      }
    }
    out.push(first >= 0xd800 && first <= 0xdfff ? 0xfffd : first);
  }
  return out;
}

function directSingleByte(codePoint: number): boolean {
  return codePoint === 0 || codePoint === 9 || codePoint === 10 || codePoint === 13 ||
    (codePoint >= 0x20 && codePoint <= 0x7f);
}

export function scsuEncode(input: string): number[] {
  const dynamic = [...INITIAL_DYNAMIC_OFFSETS];
  let current = 0;
  const out: number[] = [];
  for (const cp of codePoints(input)) {
    if (directSingleByte(cp)) {
      out.push(cp);
      continue;
    }
    const currentOffset = dynamic[current]!;
    if (cp >= currentOffset && cp < currentOffset + 0x80) {
      out.push(0x80 + cp - currentOffset);
      continue;
    }
    let existing = -1;
    for (let window = 0; window < dynamic.length; window++) {
      if (cp >= dynamic[window]! && cp < dynamic[window]! + 0x80) {
        existing = window;
        break;
      }
    }
    if (existing >= 0) {
      current = existing;
      out.push(0x10 + current, 0x80 + cp - dynamic[current]!);
      continue;
    }
    let quoted = false;
    for (let window = 0; window < STATIC_OFFSETS.length; window++) {
      const offset = STATIC_OFFSETS[window]!;
      if (cp >= offset && cp < offset + 0x80) {
        out.push(0x01 + window, cp - offset);
        quoted = true;
        break;
      }
    }
    if (quoted) continue;
    const definition = indexForCodePoint(cp);
    if (definition) {
      dynamic[current] = definition.offset;
      out.push(0x18 + current, definition.index, 0x80 + cp - definition.offset);
      continue;
    }
    if (cp <= 0xffff) {
      out.push(0x0e, cp >>> 8, cp & 0xff);
      continue;
    }
    const block = Math.floor((cp - 0x10000) / 0x80);
    const first = (current << 5) | ((block >>> 8) & 0x1f);
    const second = block & 0xff;
    const offset = 0x10000 + block * 0x80;
    dynamic[current] = offset;
    out.push(0x0b, first, second, 0x80 + cp - offset);
  }
  return out;
}

export function scsuDecode(bytes: ReadonlyArray<number>): string {
  const dynamic = [...INITIAL_DYNAMIC_OFFSETS];
  const units: number[] = [];
  let current = 0;
  let unicodeMode = false;
  let i = 0;
  const next = (): number => {
    if (i >= bytes.length) throw new Error("truncated SCSU stream");
    return bytes[i++]! & 0xff;
  };
  const defineExtended = (first: number, second: number): void => {
    current = first >>> 5;
    dynamic[current] = 0x10000 + ((((first & 0x1f) << 8) | second) * 0x80);
  };
  while (i < bytes.length) {
    const value = next();
    if (!unicodeMode) {
      if (directSingleByte(value)) {
        units.push(value);
      } else if (value >= 0x80) {
        pushCodePoint(units, dynamic[current]! + value - 0x80);
      } else if (value >= 0x01 && value <= 0x08) {
        const quoted = next();
        const window = value - 1;
        pushCodePoint(units, quoted < 0x80
          ? STATIC_OFFSETS[window]! + quoted
          : dynamic[window]! + quoted - 0x80);
      } else if (value === 0x0b) {
        defineExtended(next(), next());
      } else if (value === 0x0e) {
        pushCodePoint(units, (next() << 8) | next());
      } else if (value === 0x0f) {
        unicodeMode = true;
      } else if (value >= 0x10 && value <= 0x17) {
        current = value - 0x10;
      } else if (value >= 0x18 && value <= 0x1f) {
        current = value - 0x18;
        const offset = offsetFromIndex(next());
        if (offset === null) throw new Error("invalid SCSU window definition");
        dynamic[current] = offset;
      } else {
        throw new Error("reserved SCSU command");
      }
      continue;
    }
    if (value >= 0xe0 && value <= 0xe7) {
      current = value - 0xe0;
      unicodeMode = false;
    } else if (value >= 0xe8 && value <= 0xef) {
      current = value - 0xe8;
      const offset = offsetFromIndex(next());
      if (offset === null) throw new Error("invalid SCSU window definition");
      dynamic[current] = offset;
      unicodeMode = false;
    } else if (value === 0xf0) {
      units.push((next() << 8) | next());
    } else if (value === 0xf1) {
      defineExtended(next(), next());
      unicodeMode = false;
    } else {
      units.push((value << 8) | next());
    }
  }
  let out = "";
  const chunk = 0x4000;
  for (let start = 0; start < units.length; start += chunk) {
    out += String.fromCharCode(...units.slice(start, start + chunk));
  }
  return out;
}
