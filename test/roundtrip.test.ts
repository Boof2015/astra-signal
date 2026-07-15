import { describe, expect, it } from "vitest";
import { decodeSignalImage } from "../src/decode";
import { encodeSignal } from "../src/encode";
import { rasterizeSignal, type RasterImage } from "../src/raster";
import type { SignalInput } from "../src/types";

const SONGS: SignalInput[] = [
  { artist: "Kendrick Lamar", title: "HUMBLE.", durationSec: 177 },
  { artist: "ナナツカゼ", title: "Replay", durationSec: 161 },
  { artist: "ナナツカゼ", title: "五月猫", durationSec: 207 },
  { artist: "Молчат Дома", title: "Судно", durationSec: 141 },
];

function render(input: SignalInput, scale = 6): RasterImage {
  return rasterizeSignal(encodeSignal(input), { scale });
}

function rotate(source: RasterImage, degrees: number, pad = 80): RasterImage {
  const width = source.width + pad * 2;
  const height = source.height + pad * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const sx = Math.round(cosine * dx + sine * dy + source.width / 2);
      const sy = Math.round(-sine * dx + cosine * dy + source.height / 2);
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
      const sourceIndex = (sy * source.width + sx) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = source.data[sourceIndex]!;
      data[targetIndex + 1] = source.data[sourceIndex + 1]!;
      data[targetIndex + 2] = source.data[sourceIndex + 2]!;
      data[targetIndex + 3] = 255;
    }
  }
  return { width, height, data };
}

function perspectiveTilt(source: RasterImage, degrees: number, pad = 70): RasterImage {
  const amount = Math.sin(Math.abs(degrees) * Math.PI / 180) * 0.24;
  const width = source.width + pad * 2;
  const height = source.height + pad * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    const v = (y - pad) / source.height;
    if (v < 0 || v > 1) continue;
    const left = pad + amount * source.width * (1 - v);
    const right = pad + source.width - amount * source.width * (1 - v);
    for (let x = 0; x < width; x++) {
      const u = (x - left) / (right - left);
      if (u < 0 || u > 1) continue;
      const sx = Math.min(source.width - 1, Math.max(0, Math.round(u * source.width)));
      const sy = Math.min(source.height - 1, Math.max(0, Math.round(v * source.height)));
      const sourceIndex = (sy * source.width + sx) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = source.data[sourceIndex]!;
      data[targetIndex + 1] = source.data[sourceIndex + 1]!;
      data[targetIndex + 2] = source.data[sourceIndex + 2]!;
      data[targetIndex + 3] = 255;
    }
  }
  return { width, height, data };
}

function addNoise(source: RasterImage, probability: number, seed: number): RasterImage {
  const data = new Uint8ClampedArray(source.data);
  let state = seed >>> 0;
  for (let pixel = 0; pixel < source.width * source.height; pixel++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    if ((state & 0xffff) / 0xffff >= probability) continue;
    const value = (state & 0x10000) === 0 ? 0 : 255;
    data[pixel * 4] = value; data[pixel * 4 + 1] = value; data[pixel * 4 + 2] = value;
  }
  return { ...source, data };
}

function gaussianBlur(source: RasterImage): RasterImage {
  const kernel = [1, 4, 6, 4, 1];
  const horizontal = new Uint8ClampedArray(source.data.length);
  const data = new Uint8ClampedArray(source.data.length);
  const pass = (input: Uint8ClampedArray, output: Uint8ClampedArray, vertical: boolean): void => {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        let sum = 0;
        for (let offset = -2; offset <= 2; offset++) {
          const sx = vertical ? x : Math.max(0, Math.min(source.width - 1, x + offset));
          const sy = vertical ? Math.max(0, Math.min(source.height - 1, y + offset)) : y;
          sum += input[(sy * source.width + sx) * 4]! * kernel[offset + 2]!;
        }
        const index = (y * source.width + x) * 4;
        const value = Math.round(sum / 16);
        output[index] = value; output[index + 1] = value; output[index + 2] = value; output[index + 3] = 255;
      }
    }
  };
  pass(source.data, horizontal, false);
  pass(horizontal, data, true);
  return { ...source, data };
}

function highlightBloom(source: RasterImage, radius = 2): RasterImage {
  const data = new Uint8ClampedArray(source.data.length);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      let brightest = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = Math.max(0, Math.min(source.width - 1, x + dx));
          const sy = Math.max(0, Math.min(source.height - 1, y + dy));
          brightest = Math.max(brightest, source.data[(sy * source.width + sx) * 4]!);
        }
      }
      const index = (y * source.width + x) * 4;
      data[index] = brightest; data[index + 1] = brightest; data[index + 2] = brightest; data[index + 3] = 255;
    }
  }
  return gaussianBlur({ ...source, data });
}

function tightlyFrame(source: RasterImage, inset: number): RasterImage {
  const width = source.width - inset * 2;
  const height = source.height - inset * 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceIndex = ((y + inset) * source.width + x + inset) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = source.data[sourceIndex]!;
      data[targetIndex + 1] = source.data[sourceIndex + 1]!;
      data[targetIndex + 2] = source.data[sourceIndex + 2]!;
      data[targetIndex + 3] = 255;
    }
  }
  return { width, height, data };
}

function resizeNearest(source: RasterImage, scale: number): RasterImage {
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(source.width - 1, Math.floor(x / scale));
      const sy = Math.min(source.height - 1, Math.floor(y / scale));
      const sourceIndex = (sy * source.width + sx) * 4;
      const targetIndex = (y * width + x) * 4;
      data[targetIndex] = source.data[sourceIndex]!;
      data[targetIndex + 1] = source.data[sourceIndex + 1]!;
      data[targetIndex + 2] = source.data[sourceIndex + 2]!;
      data[targetIndex + 3] = 255;
    }
  }
  return { width, height, data };
}

function lightingGradient(source: RasterImage): RasterImage {
  const data = new Uint8ClampedArray(source.data);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const factor = 0.55 + 0.55 * (x / Math.max(1, source.width - 1));
      const index = (y * source.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        data[index + channel] = Math.max(0, Math.min(255, Math.round(data[index + channel]! * factor)));
      }
    }
  }
  return { ...source, data };
}

function glare(source: RasterImage): RasterImage {
  const data = new Uint8ClampedArray(source.data);
  const x0 = Math.round(source.width * 0.62);
  const x1 = Math.round(source.width * 0.66);
  for (let y = 0; y < source.height; y++) {
    for (let x = x0; x < x1; x++) {
      const index = (y * source.width + x) * 4;
      data[index] = 248; data[index + 1] = 248; data[index + 2] = 248;
    }
  }
  return { ...source, data };
}

function jpegArtifacts(source: RasterImage): RasterImage {
  const data = new Uint8ClampedArray(source.data);
  for (let y = 0; y < source.height; y += 8) {
    for (let x = 0; x < source.width; x += 8) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < 8 && y + dy < source.height; dy++) {
        for (let dx = 0; dx < 8 && x + dx < source.width; dx++) {
          sum += source.data[((y + dy) * source.width + x + dx) * 4]!;
          count++;
        }
      }
      const average = Math.round(sum / count / 12) * 12;
      for (let dy = 0; dy < 8 && y + dy < source.height; dy++) {
        for (let dx = 0; dx < 8 && x + dx < source.width; dx++) {
          const index = ((y + dy) * source.width + x + dx) * 4;
          const original = source.data[index]!;
          const value = Math.round((original * 3 + average) / 4);
          data[index] = value; data[index + 1] = value; data[index + 2] = value;
        }
      }
    }
  }
  return { ...source, data };
}

function corruptGuards(source: RasterImage, scale: number): RasterImage {
  const data = new Uint8ClampedArray(source.data);
  const x0 = 4 * scale;
  const x1 = 12 * scale;
  for (let y = 0; y < source.height; y++) {
    for (let x = x0; x < x1; x++) {
      const index = (y * source.width + x) * 4;
      data[index] = 255; data[index + 1] = 255; data[index + 2] = 255; data[index + 3] = 255;
    }
  }
  return { ...source, data };
}

function uiScreenshot(seed: number): RasterImage {
  const width = 720;
  const height = 1280;
  const data = new Uint8ClampedArray(width * height * 4).fill(247);
  const fill = (x0: number, y0: number, x1: number, y1: number, value: number): void => {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const index = (y * width + x) * 4;
        data[index] = value; data[index + 1] = value; data[index + 2] = value; data[index + 3] = 255;
      }
    }
  };
  fill(32, 40, 688, 140, 28);
  fill(32, 180, 260, 408, 55);
  for (let row = 0; row < 14; row++) {
    const y = 450 + row * 48;
    const length = 180 + ((row * 97 + seed * 31) % 430);
    fill(42, y, Math.min(width - 42, 42 + length), y + 8 + (row % 3), 35 + (row % 4) * 20);
  }
  fill(0, 1180, width, height, 24);
  return { width, height, data };
}

function addClutter(source: RasterImage, pad = 90): RasterImage {
  const width = source.width + pad * 2;
  const height = source.height + pad * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sourceIndex = (y * source.width + x) * 4;
      const targetIndex = ((y + pad) * width + x + pad) * 4;
      data[targetIndex] = source.data[sourceIndex]!;
      data[targetIndex + 1] = source.data[sourceIndex + 1]!;
      data[targetIndex + 2] = source.data[sourceIndex + 2]!;
      data[targetIndex + 3] = 255;
    }
  }
  const rectangles: Array<readonly [number, number, number, number]> = [
    [10, 12, 95, 25],
    [width - 120, 20, width - 15, 36],
    [18, height - 32, 160, height - 20],
  ];
  for (const [x0, y0, x1, y1] of rectangles) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const index = (y * width + x) * 4;
        data[index] = 30; data[index + 1] = 30; data[index + 2] = 30; data[index + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

function cameraBloomScene(source: RasterImage): RasterImage {
  const width = 1600;
  const height = 1000;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const index = pixel * 4;
    const x = pixel % width;
    const value = 18 + Math.round(70 * x / (width - 1));
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value + 4;
    data[index + 3] = 255;
  }
  const left = Math.floor((width - source.width) / 2);
  const top = Math.floor((height - source.height) / 2);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sourceIndex = (y * source.width + x) * 4;
      const targetIndex = ((top + y) * width + left + x) * 4;
      const value = source.data[sourceIndex]! < 128 ? 98 : 218;
      data[targetIndex] = value;
      data[targetIndex + 1] = value;
      data[targetIndex + 2] = value;
      data[targetIndex + 3] = 255;
    }
  }
  return { width, height, data };
}

function horizontalLensWarp(source: RasterImage, amount: number): RasterImage {
  const data = new Uint8ClampedArray(source.data.length).fill(255);
  const center = (source.width - 1) / 2;
  const half = Math.max(1, center);
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const distorted = (x - center) / half;
      let normalized = distorted;
      for (let iteration = 0; iteration < 5; iteration++) {
        const value = normalized + amount * (normalized ** 3 - normalized) - distorted;
        const derivative = 1 + amount * (3 * normalized ** 2 - 1);
        normalized -= value / derivative;
      }
      const sx = Math.max(0, Math.min(source.width - 1, Math.round(center + normalized * half)));
      const sourceIndex = (y * source.width + sx) * 4;
      const targetIndex = (y * source.width + x) * 4;
      data[targetIndex] = source.data[sourceIndex]!;
      data[targetIndex + 1] = source.data[sourceIndex + 1]!;
      data[targetIndex + 2] = source.data[sourceIndex + 2]!;
      data[targetIndex + 3] = 255;
    }
  }
  return { ...source, data };
}

function expectDecoded(image: RasterImage, input: SignalInput): void {
  const expected = encodeSignal(input).payload;
  expect(decodeSignalImage(image).payload).toEqual(expected);
}

describe("v3 image round trip", () => {
  it("decodes clean renders across useful scales", () => {
    for (const scale of [1, 1.25, 1.5, 2, 4, 6]) {
      for (const song of SONGS) expectDecoded(render(song, scale), song);
    }
  });

  it("decodes rotation, perspective, and optical noise", () => {
    expectDecoded(rotate(render(SONGS[0]!), 12), SONGS[0]!);
    expectDecoded(rotate(render(SONGS[1]!), -10), SONGS[1]!);
    expectDecoded(perspectiveTilt(render(SONGS[2]!), 25), SONGS[2]!);
    expectDecoded(addNoise(render(SONGS[3]!), 0.012, 42), SONGS[3]!);
  });

  it("decodes Gaussian blur, resize cycles, gradients, glare, JPEG-like artifacts, and clutter", () => {
    expectDecoded(gaussianBlur(render(SONGS[0]!, 4)), SONGS[0]!);
    expectDecoded(resizeNearest(resizeNearest(render(SONGS[1]!, 5), 0.55), 1.8), SONGS[1]!);
    expectDecoded(lightingGradient(render(SONGS[2]!, 5)), SONGS[2]!);
    expectDecoded(glare(render(SONGS[0]!, 6)), SONGS[0]!);
    expectDecoded(jpegArtifacts(render(SONGS[1]!, 5)), SONGS[1]!);
    expectDecoded(addClutter(render(SONGS[2]!, 4)), SONGS[2]!);
  });

  it("decodes display bloom, a dimmer screen carrier, and tight quiet-zone framing", () => {
    expectDecoded(highlightBloom(render(SONGS[1]!, 6)), SONGS[1]!);
    const dimmer = rasterizeSignal(encodeSignal(SONGS[0]!), { scale: 6, background: [208, 208, 212] });
    expectDecoded(dimmer, SONGS[0]!);
    expectDecoded(tightlyFrame(render(SONGS[2]!, 6), 18), SONGS[2]!);
  });

  it("decodes bloomed screen ink when a dark phone biases scene thresholding", () => {
    const diagnostics: Array<{ threshold?: number }> = [];
    const input = SONGS[0]!;
    const result = decodeSignalImage(cameraBloomScene(render(input, 2)), {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(result.payload).toEqual(encodeSignal(input).payload);
    expect(diagnostics.length).toBeGreaterThan(1);
    expect(diagnostics.at(-1)?.threshold).toBeGreaterThan(diagnostics[0]?.threshold ?? 255);
  });

  it("decodes bounded endpoint-preserving horizontal lens distortion", () => {
    const input = SONGS[1]!;
    expectDecoded(horizontalLensWarp(render(input, 2), 0.08), input);
  });

  it("supports 180-degree orientation", () => {
    expectDecoded(rotate(render(SONGS[1]!), 180, 20), SONGS[1]!);
  });

  it("rejects blank, UI, random-spectrum, malformed, and corrupted-guard images", () => {
    const blank = new Uint8ClampedArray(400 * 200 * 4).fill(255);
    expect(() => decodeSignalImage({ width: 400, height: 200, data: blank })).toThrow();
    const random = new Uint8ClampedArray(blank);
    for (let i = 0; i < 120; i++) {
      const x = 20 + i * 3;
      const barHeight = 5 + (i * 17) % 70;
      for (let y = 100 - barHeight; y <= 100 + barHeight; y++) {
        for (let dx = 0; dx < 2; dx++) {
          const index = (y * 400 + x + dx) * 4;
          random[index] = 0; random[index + 1] = 0; random[index + 2] = 0; random[index + 3] = 255;
        }
      }
    }
    expect(() => decodeSignalImage({ width: 400, height: 200, data: random })).toThrow();
    for (let seed = 0; seed < 4; seed++) expect(() => decodeSignalImage(uiScreenshot(seed))).toThrow();
    expect(() => decodeSignalImage(corruptGuards(render(SONGS[0]!, 6), 6))).toThrow();
    expect(() => decodeSignalImage({ width: 100, height: 50, data: new Uint8Array(12) })).toThrow(/truncated/);
  });
});
