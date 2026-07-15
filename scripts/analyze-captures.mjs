import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { decodeSignalImage } from "../dist/index.js";

const directory = resolve(process.argv[2] ?? "test/fixtures/s22-raw");
const height = Number(process.argv[3] ?? 2048);
const width = Math.round(height * 0.75);
const files = readdirSync(directory)
  .filter((name) => /\.(?:jpe?g)$/i.test(name))
  .sort();

for (const name of files) {
  const path = resolve(directory, name);
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
    console.log(JSON.stringify({ file: basename(path), status: "convert-failed", error: converted.stderr.toString().trim() }));
    continue;
  }
  const diagnostics = [];
  const startedAt = performance.now();
  try {
    const result = decodeSignalImage(
      { width, height, data: converted.stdout },
      { onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) }
    );
    console.log(JSON.stringify({
      file: basename(path),
      status: "decoded",
      elapsedMs: Math.round(performance.now() - startedAt),
      ...result,
      diagnostics,
    }));
  } catch (error) {
    console.log(JSON.stringify({
      file: basename(path),
      status: "rejected",
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      diagnostics,
    }));
  }
}
