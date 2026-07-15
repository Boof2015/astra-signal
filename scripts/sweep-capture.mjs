import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { decodeSignalImage } from "../dist/index.js";

const path = resolve(process.argv[2]);
const height = Number(process.argv[3] ?? 2048);
const width = Math.round(height * 0.75);
const converted = spawnSync(
  "ffmpeg",
  [
    "-v", "error",
    "-i", path,
    "-vf", `scale=${width}:${height}:flags=lanczos`,
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "pipe:1",
  ],
  { maxBuffer: 64 * 1024 * 1024 }
);

if (converted.status !== 0) {
  throw new Error(converted.stderr.toString().trim() || "ffmpeg conversion failed");
}

for (let threshold = 24; threshold <= 224; threshold += 4) {
  const diagnostics = [];
  try {
    const result = decodeSignalImage(
      { width, height, data: converted.stdout },
      {
        threshold,
        maxCandidates: 24,
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      }
    );
    console.log(JSON.stringify({ threshold, status: "decoded", result, diagnostics }));
  } catch (error) {
    const bestGuardMismatch = Math.min(
      ...diagnostics.flatMap((pass) => pass.candidates.map((candidate) => candidate.bestGuardMismatch ?? Infinity))
    );
    const guardMatches = diagnostics.reduce(
      (sum, pass) => sum + pass.candidates.reduce((candidateSum, candidate) => candidateSum + candidate.guardMatches, 0),
      0
    );
    console.log(JSON.stringify({
      threshold,
      status: "rejected",
      bestGuardMismatch: Number.isFinite(bestGuardMismatch) ? bestGuardMismatch : null,
      guardMatches,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
