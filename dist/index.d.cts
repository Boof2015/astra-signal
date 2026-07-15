type SignalTier = "small" | "medium" | "large";
type SignalTextCodec = "ascii-huffman" | "scsu" | "utf8";
interface SignalInput {
    artist: string;
    title: string;
    durationSec?: number;
}
interface SignalPayload {
    readonly version: 3;
    readonly type: "metadata";
    readonly artist: string;
    readonly title: string;
    readonly durationSec: number;
}
interface SignalColumn {
    readonly upperLevel: number;
    readonly lowerLevel: number;
    readonly role: "guard" | "data";
}
interface SignalLayout {
    readonly version: 3;
    readonly tier: SignalTier;
    readonly widthModules: number;
    readonly heightModules: number;
    readonly dataColumnOffset: number;
    readonly dataColumns: number;
    readonly columns: ReadonlyArray<SignalColumn>;
    readonly payload: SignalPayload;
}
interface SignalDecodeResult {
    readonly payload: SignalPayload;
    readonly tier: SignalTier;
    readonly correctedBytes: number;
    readonly erasedBytes: number;
    readonly confidence: number;
}

interface SignalTierSpec {
    readonly id: number;
    readonly name: SignalTier;
    readonly dataBytes: number;
    readonly parityBytes: number;
    readonly codewordBytes: number;
    readonly dataColumns: number;
}
interface SignalGeometry {
    readonly quietModules: number;
    readonly columnPitchModules: number;
    readonly guardColumnsPerSide: number;
    readonly halfHeightModules: number;
    readonly heightStepModules: number;
    readonly heightModules: number;
}
interface SignalSpec {
    readonly version: 3;
    readonly levelsPerSide: 4;
    readonly bitsPerColumn: 4;
    readonly tiers: ReadonlyArray<SignalTierSpec>;
    readonly geom: SignalGeometry;
}
declare const SIGNAL_SPEC: SignalSpec;
declare function tierSpec(tier: SignalTier | number): SignalTierSpec;
declare function signalWidthModules(tier: SignalTier | SignalTierSpec): number;
declare function levelHeightModules(level: number): number;

interface EncodedFrame {
    readonly bytes: number[];
    readonly paddedData: number[];
    readonly tier: SignalTier;
    readonly codec: SignalTextCodec;
    readonly payload: SignalPayload;
}
interface DecodedFrame {
    readonly payload: SignalPayload;
    readonly tier: SignalTier;
    readonly codec: SignalTextCodec;
    readonly usedBytes: number;
}
declare function encodeSignalFrame(input: SignalInput | SignalPayload): EncodedFrame;
declare function decodeSignalFrame(bytes: ReadonlyArray<number>, expectedTier?: SignalTier): DecodedFrame;

declare function encodeSignal(input: SignalInput | SignalPayload): SignalLayout;
interface DecodeColumnInput {
    readonly upperLevel: number;
    readonly lowerLevel: number;
    readonly confidence?: number;
}
declare function decodeSignalColumns(tierName: SignalTier, columns: ReadonlyArray<DecodeColumnInput>, erasureThreshold?: number): SignalDecodeResult;

declare const SIGNAL_LINK_PREFIX = "astra:signal:v3:";
declare function encodeSignalLink(input: SignalInput | SignalPayload): string;
declare function decodeSignalLink(value: string): SignalPayload;

interface RasterImage {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
}
interface RasterOptions {
    readonly scale?: number;
    readonly foreground?: readonly [number, number, number];
    readonly background?: readonly [number, number, number];
}
declare function rasterizeSignal(layout: SignalLayout, options?: RasterOptions): RasterImage;

interface DecodeImage {
    readonly data: ArrayLike<number>;
    readonly width: number;
    readonly height: number;
}
interface DecodeOptions {
    readonly threshold?: number;
    readonly maxCandidates?: number;
    /** Receives per-threshold diagnostics. Intended for development tooling. */
    readonly onDiagnostic?: (diagnostic: DecodePassDiagnostic) => void;
}
interface DecodeCandidateDiagnostic {
    readonly bounds: readonly [number, number, number, number];
    readonly area: number;
    readonly bestGuardMismatch: number | null;
    readonly guardMatches: number;
    readonly decodeAttempts: number;
    readonly lastDecodeError?: string;
}
interface DecodePassDiagnostic {
    readonly binary: "global" | "adaptive" | "explicit";
    readonly threshold?: number;
    readonly candidates: ReadonlyArray<DecodeCandidateDiagnostic>;
}
declare function decodeSignalImage(image: DecodeImage, options?: DecodeOptions): SignalDecodeResult;

export { type DecodeCandidateDiagnostic, type DecodeColumnInput, type DecodeImage, type DecodeOptions, type DecodePassDiagnostic, type DecodedFrame, type EncodedFrame, type RasterImage, type RasterOptions, SIGNAL_LINK_PREFIX, SIGNAL_SPEC, type SignalColumn, type SignalDecodeResult, type SignalGeometry, type SignalInput, type SignalLayout, type SignalPayload, type SignalSpec, type SignalTextCodec, type SignalTier, type SignalTierSpec, decodeSignalColumns, decodeSignalFrame, decodeSignalImage, decodeSignalLink, encodeSignal, encodeSignalFrame, encodeSignalLink, levelHeightModules, rasterizeSignal, signalWidthModules, tierSpec };
