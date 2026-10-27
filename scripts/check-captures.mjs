import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeSignalImage } from "../dist/index.js";

// Decodes the private capture corpus with the built dist and compares every
// result with the recorded baseline, so decoder changes that are meant to be
// speed-only can be proven to change no outcome.
//
//   node scripts/check-captures.mjs [dir] [--record]
//
// --record (re)writes <dir>/expected.json from the current dist. The corpus and
// its baseline stay local (test/fixtures/s22-raw/ is gitignored).

const args = process.argv.slice(2);
const record = args.includes("--record");
const directory = resolve(args.find((arg) => !arg.startsWith("--")) ?? "test/fixtures/s22-raw");
const expectedPath = resolve(directory, "expected.json");
const height = 2048;
const width = Math.round(height * 0.75);

const files = readdirSync(directory)
  .filter((name) => /\.(?:jpe?g)$/i.test(name))
  .sort();
const expected = record || !existsSync(expectedPath)
  ? null
  : JSON.parse(readFileSync(expectedPath, "utf8"));
if (!record && !expected) {
  console.error(`No baseline at ${expectedPath}; run with --record on a known-good dist first.`);
  process.exit(1);
}

const results = {};
let mismatches = 0;
let totalMs = 0;
for (const name of files) {
  const converted = spawnSync(
    "ffmpeg",
    [
      "-v", "error",
      "-i", resolve(directory, name),
      "-vf", `scale=${width}:${height}:flags=lanczos`,
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "pipe:1",
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  if (converted.status !== 0) throw new Error(`ffmpeg failed on ${name}: ${converted.stderr}`);
  const startedAt = performance.now();
  let outcome;
  try {
    outcome = { decoded: decodeSignalImage({ width, height, data: converted.stdout }).payload };
  } catch (error) {
    outcome = { rejected: error instanceof Error ? error.message : String(error) };
  }
  const elapsedMs = Math.round(performance.now() - startedAt);
  totalMs += elapsedMs;
  results[name] = outcome;
  let verdict = "recorded";
  if (expected) {
    const same = JSON.stringify(expected[name]) === JSON.stringify(outcome);
    if (!same) mismatches++;
    verdict = same ? "same" : `CHANGED (expected ${JSON.stringify(expected[name])})`;
  }
  console.log(`${name}  ${outcome.decoded ? "decoded " : "rejected"}  ${String(elapsedMs).padStart(5)}ms  ${verdict}`);
}

if (record) {
  writeFileSync(expectedPath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Recorded ${files.length} outcomes to ${expectedPath} (${totalMs}ms decode total)`);
} else {
  const missing = Object.keys(expected).filter((name) => !(name in results));
  mismatches += missing.length;
  for (const name of missing) console.log(`${name}  MISSING from corpus`);
  console.log(`${files.length - mismatches}/${files.length} unchanged, ${totalMs}ms decode total`);
  if (mismatches > 0) process.exit(1);
}
