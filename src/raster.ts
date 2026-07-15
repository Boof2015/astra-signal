import { levelHeightModules, SIGNAL_SPEC } from "./spec";
import type { SignalLayout } from "./types";

export interface RasterImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

export interface RasterOptions {
  readonly scale?: number;
  readonly foreground?: readonly [number, number, number];
  readonly background?: readonly [number, number, number];
}

export function rasterizeSignal(layout: SignalLayout, options: RasterOptions = {}): RasterImage {
  const scale = options.scale ?? 6;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("raster scale must be positive");
  const width = Math.max(1, Math.round(layout.widthModules * scale));
  const height = Math.max(1, Math.round(layout.heightModules * scale));
  const foreground = options.foreground ?? [17, 17, 17];
  const background = options.background ?? [245, 245, 245];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    data[pixel * 4] = background[0];
    data[pixel * 4 + 1] = background[1];
    data[pixel * 4 + 2] = background[2];
    data[pixel * 4 + 3] = 255;
  }
  const fill = (x0: number, y0: number, x1: number, y1: number): void => {
    const left = Math.max(0, Math.floor(x0 * scale));
    const right = Math.min(width, Math.ceil(x1 * scale));
    const top = Math.max(0, Math.floor(y0 * scale));
    const bottom = Math.min(height, Math.ceil(y1 * scale));
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const index = (y * width + x) * 4;
        data[index] = foreground[0];
        data[index + 1] = foreground[1];
        data[index + 2] = foreground[2];
        data[index + 3] = 255;
      }
    }
  };
  const g = SIGNAL_SPEC.geom;
  const centerY = g.quietModules + g.halfHeightModules;
  for (let index = 0; index < layout.columns.length; index++) {
    const column = layout.columns[index]!;
    const x0 = g.quietModules + index * g.columnPitchModules;
    const x1 = x0 + g.columnPitchModules;
    fill(
      x0,
      centerY - levelHeightModules(column.upperLevel),
      x1,
      centerY + levelHeightModules(column.lowerLevel)
    );
  }
  return { width, height, data };
}
