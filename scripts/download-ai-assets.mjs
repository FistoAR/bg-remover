import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const TARGET_DIR = path.join(PROJECT_ROOT, "public", "background-removal-data");
const REMOTE_ROOT = new URL("https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/");
const REQUIRED_KEYS = [
  "/models/isnet_fp16",
  "/onnxruntime-web/ort-wasm-simd-threaded.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.mjs",
];

async function hasCompleteLocalAssets() {
  try {
    const localMap = JSON.parse(await readFile(path.join(TARGET_DIR, "resources.json"), "utf8"));
    for (const key of REQUIRED_KEYS) {
      const entry = localMap[key];
      if (!entry) return false;
      for (const chunk of entry.chunks) {
        const filename = path.join(TARGET_DIR, chunk.name);
        const fileInfo = await stat(filename);
        if (fileInfo.size !== chunk.offsets[1] - chunk.offsets[0]) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

if (await hasCompleteLocalAssets()) {
  console.log("Local AI model and runtime assets are ready.");
  process.exit(0);
}

await mkdir(TARGET_DIR, { recursive: true });
console.log("Fetching the higher-quality background-removal model and CPU/WASM runtime…");

const metadataResponse = await fetch(new URL("resources.json", REMOTE_ROOT));
if (!metadataResponse.ok) throw new Error(`Could not fetch IMG.LY asset metadata (${metadataResponse.status}).`);
const remoteMap = await metadataResponse.json();
const localMap = Object.fromEntries(REQUIRED_KEYS.map((key) => {
  if (!remoteMap[key]) throw new Error(`Required asset is missing from IMG.LY metadata: ${key}`);
  return [key, remoteMap[key]];
}));

const chunks = [...new Map(
  REQUIRED_KEYS.flatMap((key) => localMap[key].chunks.map((chunk) => [chunk.name, chunk])).values(),
).values()];
let nextChunk = 0;
let completedChunks = 0;

async function downloadWorker() {
  while (nextChunk < chunks.length) {
    const chunk = chunks[nextChunk++];
    const filename = path.join(TARGET_DIR, chunk.name);
    const expectedSize = chunk.offsets[1] - chunk.offsets[0];
    try {
      const existing = await stat(filename);
      if (existing.size === expectedSize) {
        completedChunks += 1;
        continue;
      }
    } catch {
      // Missing chunk; fetch it below.
    }

    const response = await fetch(new URL(chunk.name, REMOTE_ROOT));
    if (!response.ok) throw new Error(`Could not fetch model asset ${chunk.name} (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== expectedSize) {
      throw new Error(`Asset ${chunk.name} had ${bytes.length} bytes; expected ${expectedSize}.`);
    }
    await writeFile(filename, bytes);
    completedChunks += 1;
    console.log(`Downloaded AI assets: ${completedChunks}/${chunks.length}`);
  }
}

await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, downloadWorker));
await writeFile(path.join(TARGET_DIR, "resources.json"), `${JSON.stringify(localMap)}\n`);
const keepFiles = new Set(["resources.json", ...chunks.map((chunk) => chunk.name)]);
for (const filename of await readdir(TARGET_DIR)) {
  if (!keepFiles.has(filename)) await rm(path.join(TARGET_DIR, filename), { force: true });
}
console.log(`Local model assets are ready (${chunks.length} files, about 100 MB / 95 MiB).`);
