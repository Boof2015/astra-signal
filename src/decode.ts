import { decodeSignalColumns, type DecodeColumnInput } from "./encode";
import {
  LEFT_GUARD_LEVELS,
  levelHeightModules,
  rightGuardLevels,
  SIGNAL_SPEC,
  signalWidthModules,
  tierSpec,
} from "./spec";
import type { SignalDecodeResult, SignalTier } from "./types";

type Point = [number, number];
type ForegroundTest = (x: number, y: number) => boolean;

export interface DecodeImage {
  readonly data: ArrayLike<number>;
  readonly width: number;
  readonly height: number;
}

export interface DecodeOptions {
  readonly threshold?: number;
  readonly maxCandidates?: number;
  /** Receives per-threshold diagnostics. Intended for development tooling. */
  readonly onDiagnostic?: (diagnostic: DecodePassDiagnostic) => void;
}

export interface DecodeCandidateDiagnostic {
  readonly bounds: readonly [number, number, number, number];
  readonly area: number;
  readonly bestGuardMismatch: number | null;
  readonly guardMatches: number;
  readonly decodeAttempts: number;
  readonly lastDecodeError?: string;
}

export interface DecodePassDiagnostic {
  readonly binary: "global" | "adaptive" | "explicit";
  readonly threshold?: number;
  readonly candidates: ReadonlyArray<DecodeCandidateDiagnostic>;
}

interface Blob {
  area: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  tl: Point;
  tr: Point;
  bl: Point;
  br: Point;
}

interface SampledLevel {
  level: number;
  alternate: number;
  confidence: number;
}

interface SampledColumn {
  upper: SampledLevel;
  lower: SampledLevel;
}

function grayscale(image: DecodeImage): Uint8Array {
  const gray = new Uint8Array(image.width * image.height);
  for (let i = 0; i < gray.length; i++) {
    const r = image.data[i * 4] ?? 0;
    const g = image.data[i * 4 + 1] ?? 0;
    const b = image.data[i * 4 + 2] ?? 0;
    gray[i] = (r * 77 + g * 150 + b * 29) >> 8;
  }
  return gray;
}

function otsuHistogram(histogram: ReadonlyArray<number>, count: number): number {
  let totalSum = 0;
  for (let value = 0; value < 256; value++) totalSum += value * histogram[value]!;
  let backgroundSum = 0;
  let backgroundWeight = 0;
  let bestVariance = -1;
  let best = 127;
  for (let value = 0; value < 256; value++) {
    backgroundWeight += histogram[value]!;
    if (backgroundWeight === 0) continue;
    const foregroundWeight = count - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += value * histogram[value]!;
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = value;
    }
  }
  return best;
}

function otsu(gray: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (const value of gray) histogram[value] = histogram[value]! + 1;
  return otsuHistogram(histogram, gray.length);
}

function globalBinary(gray: Uint8Array, threshold: number): Uint8Array {
  const binary = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) binary[i] = gray[i]! <= threshold ? 1 : 0;
  return binary;
}

function adaptiveBinary(gray: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x]!;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + row;
    }
  }
  const radius = Math.max(8, Math.round(Math.min(width, height) / 12));
  const binary = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width, x + radius + 1);
      const sum = integral[y1 * stride + x1]! - integral[y0 * stride + x1]! -
        integral[y1 * stride + x0]! + integral[y0 * stride + x0]!;
      const mean = sum / ((x1 - x0) * (y1 - y0));
      binary[y * width + x] = gray[y * width + x]! <= mean - 7 ? 1 : 0;
    }
  }
  return binary;
}

function connectedComponents(binary: Uint8Array, width: number, height: number): Blob[] {
  const visited = new Uint8Array(binary.length);
  const stack: number[] = [];
  const blobs: Blob[] = [];
  for (let start = 0; start < binary.length; start++) {
    if (binary[start] !== 1 || visited[start]) continue;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let minSum = Infinity;
    let maxSum = -Infinity;
    let minDiff = Infinity;
    let maxDiff = -Infinity;
    let tl: Point = [0, 0];
    let tr: Point = [0, 0];
    let bl: Point = [0, 0];
    let br: Point = [0, 0];
    while (stack.length) {
      const pixel = stack.pop()!;
      const x = pixel % width;
      const y = (pixel - x) / width;
      area++;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumYY += y * y;
      sumXY += x * y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const sum = x + y;
      const diff = x - y;
      if (sum < minSum) { minSum = sum; tl = [x, y]; }
      if (sum > maxSum) { maxSum = sum; br = [x, y]; }
      if (diff > maxDiff) { maxDiff = diff; tr = [x, y]; }
      if (diff < minDiff) { minDiff = diff; bl = [x, y]; }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (binary[neighbor] === 1 && !visited[neighbor]) {
            visited[neighbor] = 1;
            stack.push(neighbor);
          }
        }
      }
    }
    blobs.push({ area, sumX, sumY, sumXX, sumYY, sumXY, minX, maxX, minY, maxY, tl, tr, bl, br });
  }
  return blobs;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function blobFromParts(parts: ReadonlyArray<Blob>): Blob {
  const points = parts.flatMap((part) => [part.tl, part.tr, part.bl, part.br]);
  const bySum = [...points].sort((a, b) => a[0] + a[1] - b[0] - b[1]);
  const byDiff = [...points].sort((a, b) => a[0] - a[1] - b[0] + b[1]);
  return {
    area: parts.reduce((sum, part) => sum + part.area, 0),
    sumX: parts.reduce((sum, part) => sum + part.sumX, 0),
    sumY: parts.reduce((sum, part) => sum + part.sumY, 0),
    sumXX: parts.reduce((sum, part) => sum + part.sumXX, 0),
    sumYY: parts.reduce((sum, part) => sum + part.sumYY, 0),
    sumXY: parts.reduce((sum, part) => sum + part.sumXY, 0),
    minX: Math.min(...parts.map((part) => part.minX)),
    maxX: Math.max(...parts.map((part) => part.maxX)),
    minY: Math.min(...parts.map((part) => part.minY)),
    maxY: Math.max(...parts.map((part) => part.maxY)),
    tl: bySum[0]!,
    br: bySum[bySum.length - 1]!,
    bl: byDiff[0]!,
    tr: byDiff[byDiff.length - 1]!,
  };
}

function mergeable(a: Blob, b: Blob): boolean {
  const overlap = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) + 1);
  const minHeight = Math.min(a.maxY - a.minY + 1, b.maxY - b.minY + 1);
  const left = a.minX <= b.minX ? a : b;
  const right = left === a ? b : a;
  const gap = right.minX - left.maxX - 1;
  const combinedHeight = Math.max(a.maxY, b.maxY) - Math.min(a.minY, b.minY) + 1;
  return overlap / Math.max(1, minHeight) >= 0.55 && gap >= 0 && gap <= combinedHeight * 1.5;
}

function candidateBlobs(binary: Uint8Array, width: number, height: number, maxCandidates: number): Blob[] {
  const components = connectedComponents(binary, width, height)
    .filter((blob) => blob.area >= 50)
    .sort((a, b) => b.area - a.area)
    .slice(0, 24);
  const merged: Blob[] = [];
  for (let first = 0; first < components.length; first++) {
    for (let second = first + 1; second < components.length; second++) {
      if (mergeable(components[first]!, components[second]!)) {
        merged.push(blobFromParts([components[first]!, components[second]!]));
      }
    }
  }
  return [...components, ...merged]
    .filter((blob) => {
      const boxWidth = blob.maxX - blob.minX + 1;
      const boxHeight = blob.maxY - blob.minY + 1;
      const longSide = Math.max(boxWidth, boxHeight);
      const shortSide = Math.min(boxWidth, boxHeight);
      const fill = blob.area / (boxWidth * boxHeight);
      return blob.area >= 120 && longSide / Math.max(1, shortSide) >= 1.45 && fill >= 0.12;
    })
    .sort((a, b) => b.area - a.area)
    .slice(0, maxCandidates);
}

function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const work = matrix.map((row, index) => [...row, rhs[index]!]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(work[row]![column]!) > Math.abs(work[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(work[pivot]![column]!) < 1e-9) return null;
    [work[column], work[pivot]] = [work[pivot]!, work[column]!];
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = work[row]![column]! / work[column]![column]!;
      for (let item = column; item <= size; item++) {
        work[row]![item] = work[row]![item]! - factor * work[column]![item]!;
      }
    }
  }
  return work.map((row, index) => row[size]! / row[index]!);
}

function homography(source: Point[], destination: Point[]): ((x: number, y: number) => Point) | null {
  const matrix: number[][] = [];
  const rhs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = source[i]!;
    const [u, v] = destination[i]!;
    matrix.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -x * v, -y * v]); rhs.push(v);
  }
  const solved = solveLinear(matrix, rhs);
  if (!solved) return null;
  return (x, y) => {
    const denominator = solved[6]! * x + solved[7]! * y + 1;
    return [
      (solved[0]! * x + solved[1]! * y + solved[2]!) / denominator,
      (solved[3]! * x + solved[4]! * y + solved[5]!) / denominator,
    ];
  };
}

function quantizeHeight(height: number): SampledLevel {
  const step = SIGNAL_SPEC.geom.heightStepModules;
  const raw = height / step - 1;
  const level = Math.max(0, Math.min(3, Math.round(raw)));
  const alternate = Math.max(0, Math.min(3, raw < level ? level - 1 : level + 1));
  const error = Math.abs(height - levelHeightModules(level));
  return { level, alternate, confidence: Math.max(0, Math.min(1, 1 - error / (step * 0.55))) };
}

function pcaQuad(isForeground: ForegroundTest, blob: Blob): Point[] | null {
  const meanX = blob.sumX / blob.area;
  const meanY = blob.sumY / blob.area;
  const covarianceX = blob.sumXX / blob.area - meanX * meanX;
  const covarianceY = blob.sumYY / blob.area - meanY * meanY;
  const covarianceXY = blob.sumXY / blob.area - meanX * meanY;
  const angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceX - covarianceY);
  let axisX = Math.cos(angle);
  let axisY = Math.sin(angle);
  // Keep the longitudinal axis pointing toward image-right so the normal
  // points mostly downward and the corner ordering remains deterministic.
  if (axisX < 0) {
    axisX = -axisX;
    axisY = -axisY;
  }
  const normalX = -axisY;
  const normalY = axisX;
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  for (let y = blob.minY; y <= blob.maxY; y++) {
    for (let x = blob.minX; x <= blob.maxX; x++) {
      if (!isForeground(x, y)) continue;
      const along = (x - meanX) * axisX + (y - meanY) * axisY;
      minAlong = Math.min(minAlong, along);
      maxAlong = Math.max(maxAlong, along);
    }
  }
  if (!Number.isFinite(minAlong) || maxAlong - minAlong < 8) return null;
  const endBand = Math.max(2, (maxAlong - minAlong) * 0.035);
  let leftTop = Infinity;
  let leftBottom = -Infinity;
  let rightTop = Infinity;
  let rightBottom = -Infinity;
  for (let y = blob.minY; y <= blob.maxY; y++) {
    for (let x = blob.minX; x <= blob.maxX; x++) {
      if (!isForeground(x, y)) continue;
      const dx = x - meanX;
      const dy = y - meanY;
      const along = dx * axisX + dy * axisY;
      const across = dx * normalX + dy * normalY;
      if (along <= minAlong + endBand) {
        leftTop = Math.min(leftTop, across);
        leftBottom = Math.max(leftBottom, across);
      }
      if (along >= maxAlong - endBand) {
        rightTop = Math.min(rightTop, across);
        rightBottom = Math.max(rightBottom, across);
      }
    }
  }
  if (![leftTop, leftBottom, rightTop, rightBottom].every(Number.isFinite)) return null;
  const point = (along: number, across: number): Point => [
    meanX + along * axisX + across * normalX,
    meanY + along * axisY + across * normalY,
  ];
  return [
    point(minAlong, leftTop),
    point(maxAlong, rightTop),
    point(maxAlong, rightBottom),
    point(minAlong, leftBottom),
  ];
}

function candidateQuads(isForeground: ForegroundTest, blob: Blob): Point[][] {
  const pca = pcaQuad(isForeground, blob);
  return [
    [blob.tl, blob.tr, blob.br, blob.bl],
    ...(pca ? [pca] : []),
    [
      [blob.minX, blob.minY] as Point,
      [blob.maxX, blob.minY] as Point,
      [blob.maxX, blob.maxY] as Point,
      [blob.minX, blob.maxY] as Point,
    ],
  ];
}

function sampleCandidate(
  foreground: ForegroundTest,
  width: number,
  height: number,
  destination: Point[],
  tierName: SignalTier,
  centerOffset = 0,
  horizontalWarp = 0
): SampledColumn[] | null {
  const tier = tierSpec(tierName);
  const g = SIGNAL_SPEC.geom;
  const canonicalWidth = signalWidthModules(tier);
  const source: Point[] = [
    [g.quietModules, g.quietModules],
    [canonicalWidth - g.quietModules, g.quietModules],
    [canonicalWidth - g.quietModules, g.heightModules - g.quietModules],
    [g.quietModules, g.heightModules - g.quietModules],
  ];
  const map = homography(source, destination);
  if (!map) return null;
  const inkCenterX = canonicalWidth / 2;
  const inkHalfWidth = (canonicalWidth - g.quietModules * 2) / 2;
  const warpedX = (x: number): number => {
    if (horizontalWarp === 0) return x;
    const normalized = (x - inkCenterX) / inkHalfWidth;
    // Endpoint-preserving cubic warp. It models the residual horizontal bow
    // left after a phone's ultra-wide correction while keeping both guard
    // anchors and the center axis fixed.
    return x + horizontalWarp * (normalized ** 3 - normalized) * inkHalfWidth;
  };
  const centerY = g.quietModules + g.halfHeightModules + centerOffset;
  const isForeground = (point: Point): boolean => {
    const x = Math.round(point[0]);
    const y = Math.round(point[1]);
    return x >= 0 && y >= 0 && x < width && y < height && foreground(x, y);
  };
  const extent = (x: number, direction: -1 | 1): number => {
    const increment = 0.25;
    let best = 0;
    let misses = 0;
    for (let step = 0; step <= (g.halfHeightModules + 2) / increment; step++) {
      const distanceFromCenter = step * increment;
      if (isForeground(map(warpedX(x), centerY + direction * distanceFromCenter))) {
        best = distanceFromCenter;
        misses = 0;
      } else if (++misses >= 3) break;
    }
    return best;
  };
  const totalColumns = tier.dataColumns + g.guardColumnsPerSide * 2;
  const columns: SampledColumn[] = [];
  for (let index = 0; index < totalColumns; index++) {
    const centerX = g.quietModules + (index + 0.5) * g.columnPitchModules;
    const offsets = [-0.25, 0, 0.25].map((fraction) => centerX + fraction * g.columnPitchModules);
    const uppers = offsets.map((x) => extent(x, -1)).sort((a, b) => a - b);
    const lowers = offsets.map((x) => extent(x, 1)).sort((a, b) => a - b);
    columns.push({ upper: quantizeHeight(uppers[1]!), lower: quantizeHeight(lowers[1]!) });
  }
  return columns;
}

function oriented(columns: ReadonlyArray<SampledColumn>, reverse: boolean): SampledColumn[] {
  if (!reverse) return columns.map((column) => ({ upper: { ...column.upper }, lower: { ...column.lower } }));
  return [...columns].reverse().map((column) => ({ upper: { ...column.lower }, lower: { ...column.upper } }));
}

function guardMismatch(columns: ReadonlyArray<SampledColumn>, tier: SignalTier): number {
  const guards = SIGNAL_SPEC.geom.guardColumnsPerSide;
  const expected = [...LEFT_GUARD_LEVELS, ...rightGuardLevels(tier)];
  const actual = [...columns.slice(0, guards), ...columns.slice(-guards)];
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch += Math.abs(actual[i]!.upper.level - expected[i]!);
    mismatch += Math.abs(actual[i]!.lower.level - expected[i]!);
  }
  return mismatch;
}

function attemptDecode(columns: SampledColumn[], tier: SignalTier): SignalDecodeResult {
  const guards = SIGNAL_SPEC.geom.guardColumnsPerSide;
  const data = columns.slice(guards, -guards);
  const toInput = (): DecodeColumnInput[] => data.map((column) => ({
    upperLevel: column.upper.level,
    lowerLevel: column.lower.level,
    confidence: Math.min(column.upper.confidence, column.lower.confidence),
  }));
  try {
    return decodeSignalColumns(tier, toInput(), 0);
  } catch (primaryError) {
    try {
      return decodeSignalColumns(tier, toInput());
    } catch {
      // Continue into the bounded alternate-level search.
    }
    const alternatives: Array<{ index: number; side: "upper" | "lower"; confidence: number }> = [];
    for (let index = 0; index < data.length; index++) {
      alternatives.push({ index, side: "upper", confidence: data[index]!.upper.confidence });
      alternatives.push({ index, side: "lower", confidence: data[index]!.lower.confidence });
    }
    const ambiguous = alternatives.sort((a, b) => a.confidence - b.confidence).slice(0, 4);
    for (let mask = 1; mask < (1 << ambiguous.length); mask++) {
      const changed: Array<{ item: SampledLevel; level: number }> = [];
      for (let bit = 0; bit < ambiguous.length; bit++) {
        if ((mask & (1 << bit)) === 0) continue;
        const choice = ambiguous[bit]!;
        const item = data[choice.index]![choice.side];
        changed.push({ item, level: item.level });
        item.level = item.alternate;
      }
      try {
        try {
          return decodeSignalColumns(tier, toInput(), 0);
        } catch {
          return decodeSignalColumns(tier, toInput());
        }
      } catch {
        // Try the next bounded hypothesis.
      } finally {
        for (const change of changed) change.item.level = change.level;
      }
    }
    throw primaryError;
  }
}

function aspectScore(blob: Blob, tier: SignalTier): number {
  const observedWidth = (distance(blob.tl, blob.tr) + distance(blob.bl, blob.br)) / 2;
  const observedHeight = (distance(blob.tl, blob.bl) + distance(blob.tr, blob.br)) / 2;
  const g = SIGNAL_SPEC.geom;
  const expected = (signalWidthModules(tier) - g.quietModules * 2) /
    (g.heightModules - g.quietModules * 2);
  return Math.abs(Math.log((observedWidth / Math.max(1, observedHeight)) / expected));
}

export function decodeSignalImage(image: DecodeImage, options: DecodeOptions = {}): SignalDecodeResult {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0) {
    throw new Error("invalid image dimensions");
  }
  const pixelCount = image.width * image.height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > 100_000_000) throw new Error("image is too large");
  if (!Number.isSafeInteger(image.data.length) || image.data.length < pixelCount * 4) {
    throw new Error("image pixel data is truncated");
  }
  const gray = grayscale(image);
  const globalThreshold = options.threshold ?? otsu(gray);
  const liftedThresholds = [...new Set([0, 30, 46, 62, 78]
    .map((offset) => Math.min(244, globalThreshold + offset)))];
  const passes: ReadonlyArray<{
    makeBinary: () => Uint8Array;
    kind: DecodePassDiagnostic["binary"];
    threshold?: number;
  }> = options.threshold === undefined
    ? [
      // Whole-camera frames often contain a large near-black phone body. Otsu
      // then chooses a threshold that is excellent for separating the phone
      // from the room but too low for the optically bloomed Signal ink. Lifted
      // candidates reconnect that ink; guards, RS, frame validation, and CRC
      // still gate every successful return.
      ...liftedThresholds.map((threshold) => ({
        makeBinary: () => globalBinary(gray, threshold),
        kind: "global",
        threshold,
      } as const)),
      {
        makeBinary: () => adaptiveBinary(gray, image.width, image.height),
        kind: "adaptive",
      },
    ]
    : [{
      makeBinary: () => globalBinary(gray, options.threshold!),
      kind: "explicit",
      threshold: options.threshold,
    }];
  let lastError: unknown = new Error("could not locate an Astra Signal");
  for (const pass of passes) {
    const binary = pass.makeBinary();
    const blobs = candidateBlobs(binary, image.width, image.height, options.maxCandidates ?? 12);
    const candidateDiagnostics: Array<{
      bounds: readonly [number, number, number, number];
      area: number;
      bestGuardMismatch: number | null;
      guardMatches: number;
      decodeAttempts: number;
      lastDecodeError?: string;
    }> = blobs.map((blob) => ({
      bounds: [blob.minX, blob.minY, blob.maxX, blob.maxY] as const,
      area: blob.area,
      bestGuardMismatch: null,
      guardMatches: 0,
      decodeAttempts: 0,
    }));
    const emitDiagnostic = (): void => options.onDiagnostic?.({
      binary: pass.kind,
      threshold: pass.threshold,
      candidates: candidateDiagnostics,
    });
    for (let blobIndex = 0; blobIndex < blobs.length; blobIndex++) {
      const blob = blobs[blobIndex]!;
      const diagnostic = candidateDiagnostics[blobIndex]!;
      const foreground: ForegroundTest = (x, y) => binary[y * image.width + x] === 1;
      const tiers = SIGNAL_SPEC.tiers
        .map((tier) => tier.name)
        .sort((a, b) => aspectScore(blob, a) - aspectScore(blob, b));
      for (const tier of tiers) {
        // Refine the center axis around the guard-derived homography. Sub-pixel
        // offsets absorb slight silhouette/threshold asymmetry without relaxing
        // any of the frame, guard, RS, or CRC validity checks.
        for (const quad of candidateQuads(foreground, blob)) {
          for (const centerOffset of [0, -0.5, 0.5, -1, 1]) {
            let retryWithWarp = false;
            for (const horizontalWarp of [0, -0.04, 0.04, -0.08, 0.08]) {
              if (horizontalWarp !== 0 && !retryWithWarp) break;
              const sampled = sampleCandidate(
                foreground,
                image.width,
                image.height,
                quad,
                tier,
                centerOffset,
                horizontalWarp
              );
              if (!sampled) continue;
              for (const reverse of [false, true]) {
                const columns = oriented(sampled, reverse);
                const mismatch = guardMismatch(columns, tier);
                diagnostic.bestGuardMismatch = diagnostic.bestGuardMismatch === null
                  ? mismatch
                  : Math.min(diagnostic.bestGuardMismatch, mismatch);
                if (mismatch > 3) continue;
                diagnostic.guardMatches++;
                diagnostic.decodeAttempts++;
                try {
                  const result = attemptDecode(columns, tier);
                  emitDiagnostic();
                  return result;
                } catch (error) {
                  if (horizontalWarp === 0) retryWithWarp = true;
                  lastError = error;
                  diagnostic.lastDecodeError = error instanceof Error ? error.message : String(error);
                }
              }
            }
          }
        }
      }
    }
    emitDiagnostic();
  }
  throw lastError instanceof Error ? lastError : new Error("could not decode Astra Signal");
}
