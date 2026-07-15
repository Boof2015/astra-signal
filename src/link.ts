import { decodeSignalFrame, encodeSignalFrame } from "./payload";
import type { SignalInput, SignalPayload } from "./types";
import { base64UrlToBytes, bytesToBase64Url } from "./util";

export const SIGNAL_LINK_PREFIX = "astra:signal:v3:";

export function encodeSignalLink(input: SignalInput | SignalPayload): string {
  return `${SIGNAL_LINK_PREFIX}${bytesToBase64Url(encodeSignalFrame(input).bytes)}`;
}

export function decodeSignalLink(value: string): SignalPayload {
  const trimmed = value.trim();
  if (!trimmed.startsWith(SIGNAL_LINK_PREFIX)) throw new Error("not an Astra Signal v3 link");
  const encoded = trimmed.slice(SIGNAL_LINK_PREFIX.length);
  const bytes = base64UrlToBytes(encoded);
  if (bytesToBase64Url(bytes) !== encoded) throw new Error("non-canonical Astra Signal link");
  return decodeSignalFrame(bytes).payload;
}
