import type { SignalTier } from "./types";

export interface SignalTierSpec {
  readonly id: number;
  readonly name: SignalTier;
  readonly dataBytes: number;
  readonly parityBytes: number;
  readonly codewordBytes: number;
  readonly dataColumns: number;
}

export interface SignalGeometry {
  readonly quietModules: number;
  readonly columnPitchModules: number;
  readonly guardColumnsPerSide: number;
  readonly halfHeightModules: number;
  readonly heightStepModules: number;
  readonly heightModules: number;
}

export interface SignalSpec {
  readonly version: 3;
  readonly levelsPerSide: 4;
  readonly bitsPerColumn: 4;
  readonly tiers: ReadonlyArray<SignalTierSpec>;
  readonly geom: SignalGeometry;
}

const TIERS: ReadonlyArray<SignalTierSpec> = [
  { id: 0, name: "small", dataBytes: 19, parityBytes: 8, codewordBytes: 27, dataColumns: 54 },
  { id: 1, name: "medium", dataBytes: 27, parityBytes: 12, codewordBytes: 39, dataColumns: 78 },
  { id: 2, name: "large", dataBytes: 35, parityBytes: 16, codewordBytes: 51, dataColumns: 102 },
];

export const SIGNAL_SPEC: SignalSpec = {
  version: 3,
  levelsPerSide: 4,
  bitsPerColumn: 4,
  tiers: TIERS,
  geom: {
    quietModules: 4,
    columnPitchModules: 2,
    guardColumnsPerSide: 4,
    halfHeightModules: 16,
    heightStepModules: 4,
    heightModules: 40,
  },
};

export function tierSpec(tier: SignalTier | number): SignalTierSpec {
  const found = typeof tier === "number"
    ? SIGNAL_SPEC.tiers.find((candidate) => candidate.id === tier)
    : SIGNAL_SPEC.tiers.find((candidate) => candidate.name === tier);
  if (!found) throw new Error(`unsupported Signal tier ${String(tier)}`);
  return found;
}

export function signalWidthModules(tier: SignalTier | SignalTierSpec): number {
  const resolved = typeof tier === "string" ? tierSpec(tier) : tier;
  const g = SIGNAL_SPEC.geom;
  const columns = resolved.dataColumns + g.guardColumnsPerSide * 2;
  return g.quietModules * 2 + columns * g.columnPitchModules;
}

export function levelHeightModules(level: number): number {
  const clamped = Math.max(0, Math.min(SIGNAL_SPEC.levelsPerSide - 1, Math.round(level)));
  return (clamped + 1) * SIGNAL_SPEC.geom.heightStepModules;
}

export function grayToLevel(gray: number): number {
  const value = gray & 0x03;
  return value ^ (value >>> 1);
}

export function levelToGray(level: number): number {
  const clamped = Math.max(0, Math.min(3, Math.round(level)));
  return clamped ^ (clamped >>> 1);
}

export const LEFT_GUARD_LEVELS: ReadonlyArray<number> = [3, 0, 2, 3];

export function rightGuardLevels(tier: SignalTier): ReadonlyArray<number> {
  return [3, tierSpec(tier).id, 1, 3];
}
