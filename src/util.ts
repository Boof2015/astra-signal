const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function bytesToBase64Url(bytes: ReadonlyArray<number>): string {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]! & 0xff;
    const second = index + 1 < bytes.length ? bytes[index + 1]! & 0xff : -1;
    const third = index + 2 < bytes.length ? bytes[index + 2]! & 0xff : -1;
    out += BASE64URL[first >>> 2];
    out += BASE64URL[((first & 0x03) << 4) | (second >= 0 ? second >>> 4 : 0)];
    if (second >= 0) out += BASE64URL[((second & 0x0f) << 2) | (third >= 0 ? third >>> 6 : 0)];
    if (third >= 0) out += BASE64URL[third & 0x3f];
  }
  return out;
}

export function base64UrlToBytes(value: string): number[] {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
    throw new Error("invalid base64url payload");
  }
  const lookup = new Int16Array(128).fill(-1);
  for (let index = 0; index < BASE64URL.length; index++) lookup[BASE64URL.charCodeAt(index)] = index;
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const a = lookup[value.charCodeAt(index)]!;
    const b = index + 1 < value.length ? lookup[value.charCodeAt(index + 1)]! : -1;
    const c = index + 2 < value.length ? lookup[value.charCodeAt(index + 2)]! : -1;
    const d = index + 3 < value.length ? lookup[value.charCodeAt(index + 3)]! : -1;
    if (a < 0 || b < 0) throw new Error("invalid base64url payload");
    out.push(((a << 2) | (b >>> 4)) & 0xff);
    if (c >= 0) out.push(((b << 4) | (c >>> 2)) & 0xff);
    if (d >= 0) out.push(((c << 6) | d) & 0xff);
  }
  return out;
}
