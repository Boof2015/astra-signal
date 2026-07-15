import { rsDecode, rsEncode } from "./ecc";
import { decodeSignalFrame, encodeSignalFrame } from "./payload";
import {
  grayToLevel,
  LEFT_GUARD_LEVELS,
  levelToGray,
  rightGuardLevels,
  SIGNAL_SPEC,
  signalWidthModules,
  tierSpec,
} from "./spec";
import type {
  SignalColumn,
  SignalDecodeResult,
  SignalInput,
  SignalLayout,
  SignalPayload,
  SignalTier,
} from "./types";

function dataColumnsFromCodeword(codeword: ReadonlyArray<number>): SignalColumn[] {
  const columns: SignalColumn[] = [];
  for (const byte of codeword) {
    for (const nibble of [(byte >>> 4) & 0x0f, byte & 0x0f]) {
      columns.push({
        upperLevel: grayToLevel((nibble >>> 2) & 0x03),
        lowerLevel: grayToLevel(nibble & 0x03),
        role: "data",
      });
    }
  }
  return columns;
}

function guardColumns(levels: ReadonlyArray<number>): SignalColumn[] {
  return levels.map((level) => ({ upperLevel: level, lowerLevel: level, role: "guard" }));
}

export function encodeSignal(input: SignalInput | SignalPayload): SignalLayout {
  const frame = encodeSignalFrame(input);
  const tier = tierSpec(frame.tier);
  const codeword = rsEncode(frame.paddedData, tier.parityBytes);
  const columns = [
    ...guardColumns(LEFT_GUARD_LEVELS),
    ...dataColumnsFromCodeword(codeword),
    ...guardColumns(rightGuardLevels(frame.tier)),
  ];
  return {
    version: 3,
    tier: frame.tier,
    widthModules: signalWidthModules(tier),
    heightModules: SIGNAL_SPEC.geom.heightModules,
    dataColumnOffset: SIGNAL_SPEC.geom.guardColumnsPerSide,
    dataColumns: tier.dataColumns,
    columns,
    payload: frame.payload,
  };
}

export interface DecodeColumnInput {
  readonly upperLevel: number;
  readonly lowerLevel: number;
  readonly confidence?: number;
}

function codewordFromColumns(columns: ReadonlyArray<DecodeColumnInput>): number[] {
  if (columns.length % 2 !== 0) throw new Error("Signal data column count must be even");
  const bytes: number[] = [];
  for (let i = 0; i < columns.length; i += 2) {
    const first = columns[i]!;
    const second = columns[i + 1]!;
    const high = (levelToGray(first.upperLevel) << 2) | levelToGray(first.lowerLevel);
    const low = (levelToGray(second.upperLevel) << 2) | levelToGray(second.lowerLevel);
    bytes.push((high << 4) | low);
  }
  return bytes;
}

export function decodeSignalColumns(
  tierName: SignalTier,
  columns: ReadonlyArray<DecodeColumnInput>,
  erasureThreshold = 0.36
): SignalDecodeResult {
  const tier = tierSpec(tierName);
  if (columns.length !== tier.dataColumns) throw new Error("Signal data column count does not match tier");
  const codeword = codewordFromColumns(columns);
  const erasureCandidates: Array<{ byte: number; confidence: number }> = [];
  for (let byte = 0; byte < codeword.length; byte++) {
    const confidence = Math.min(columns[byte * 2]?.confidence ?? 1, columns[byte * 2 + 1]?.confidence ?? 1);
    if (confidence < erasureThreshold) erasureCandidates.push({ byte, confidence });
  }
  const erasures = erasureCandidates
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, tier.parityBytes)
    .map((candidate) => candidate.byte);
  const corrected = rsDecode(codeword, tier.parityBytes, erasures);
  const frame = decodeSignalFrame(corrected.msg, tierName);
  const confidence = columns.reduce((sum, column) => sum + (column.confidence ?? 1), 0) / Math.max(1, columns.length);
  return {
    payload: frame.payload,
    tier: tierName,
    correctedBytes: corrected.corrected,
    erasedBytes: corrected.erasures,
    confidence,
  };
}
