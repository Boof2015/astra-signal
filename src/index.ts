export { SIGNAL_SPEC, levelHeightModules, signalWidthModules, tierSpec } from "./spec";
export type { SignalGeometry, SignalSpec, SignalTierSpec } from "./spec";

export type {
  SignalColumn,
  SignalDecodeResult,
  SignalInput,
  SignalLayout,
  SignalPayload,
  SignalTextCodec,
  SignalTier,
} from "./types";

export { encodeSignalFrame, decodeSignalFrame } from "./payload";
export type { EncodedFrame, DecodedFrame } from "./payload";
export { encodeSignal, decodeSignalColumns } from "./encode";
export type { DecodeColumnInput } from "./encode";
export { encodeSignalLink, decodeSignalLink, SIGNAL_LINK_PREFIX } from "./link";
export { rasterizeSignal } from "./raster";
export type { RasterImage, RasterOptions } from "./raster";
export { decodeSignalImage } from "./decode";
export type {
  DecodeCandidateDiagnostic,
  DecodeImage,
  DecodeOptions,
  DecodePassDiagnostic,
} from "./decode";
