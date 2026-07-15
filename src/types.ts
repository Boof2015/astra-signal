export type SignalTier = "small" | "medium" | "large";
export type SignalTextCodec = "ascii-huffman" | "scsu" | "utf8";

export interface SignalInput {
  artist: string;
  title: string;
  durationSec?: number;
}

export interface SignalPayload {
  readonly version: 3;
  readonly type: "metadata";
  readonly artist: string;
  readonly title: string;
  readonly durationSec: number;
}

export interface SignalColumn {
  readonly upperLevel: number;
  readonly lowerLevel: number;
  readonly role: "guard" | "data";
}

export interface SignalLayout {
  readonly version: 3;
  readonly tier: SignalTier;
  readonly widthModules: number;
  readonly heightModules: number;
  readonly dataColumnOffset: number;
  readonly dataColumns: number;
  readonly columns: ReadonlyArray<SignalColumn>;
  readonly payload: SignalPayload;
}

export interface SignalDecodeResult {
  readonly payload: SignalPayload;
  readonly tier: SignalTier;
  readonly correctedBytes: number;
  readonly erasedBytes: number;
  readonly confidence: number;
}
