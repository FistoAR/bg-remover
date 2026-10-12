import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const PACKAGE_DIR = path.join(PROJECT_ROOT, "node_modules", "@imgly", "background-removal");
const EXPECTED_VERSION = "1.7.0";

export const ORIGINAL_ALPHA_ASSIGNMENT = "uint8Array[i] = float32Array.data[i] * 255;";
export const PATCHED_ALPHA_BLOCK = [
  "const prediction = float32Array.data[i];",
  "    const confidence = Number.isFinite(prediction) ? Math.max(0, Math.min(1, prediction)) : 0;",
  "    uint8Array[i] = Math.round(confidence * 255);",
].join("\n");
export const LEGACY_ALPHA_BLOCK = [
  "const prediction = float32Array.data[i];",
  "    const confidence = Number.isFinite(prediction) ? Math.max(0, Math.min(1, prediction)) : 0;",
  "    uint8Array[i] = Math.round(confidence < 0.02 ? 0 : confidence * 255);",
].join("\n");

export function alphaPredictionToByte(value) {
  const confidence = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return Math.round(confidence * 255);
}

export function patchAlphaConversion(source) {
  const matches = source.split(ORIGINAL_ALPHA_ASSIGNMENT).length - 1;
  if (matches === 1) return source.replace(ORIGINAL_ALPHA_ASSIGNMENT, PATCHED_ALPHA_BLOCK);
  if (matches === 0 && source.includes(LEGACY_ALPHA_BLOCK)) {
    return source.replace(LEGACY_ALPHA_BLOCK, PATCHED_ALPHA_BLOCK);
  }
  if (matches === 0 && source.includes(PATCHED_ALPHA_BLOCK)) return source;
  throw new Error(
    `Expected one known IMG.LY alpha conversion in the installed bundle, found ${matches}. Refusing to patch an unknown package build.`,
  );
}

export async function patchInstalledPackage() {
  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8"));
  if (packageJson.version !== EXPECTED_VERSION) {
    throw new Error(
      `The alpha-confidence patch is verified for @imgly/background-removal ${EXPECTED_VERSION}; found ${packageJson.version}. Review the upstream converter before building.`,
    );
  }

  let changed = false;
  for (const filename of ["dist/index.mjs", "dist/index.cjs"]) {
    const bundlePath = path.join(PACKAGE_DIR, filename);
    const original = await readFile(bundlePath, "utf8");
    const patched = patchAlphaConversion(original);
    if (patched !== original) {
      await writeFile(bundlePath, patched);
      changed = true;
    }
  }

  console.log(
    changed
      ? "Hardened IMG.LY alpha conversion (clamp model scores and preserve all representable soft edges)."
      : "IMG.LY alpha conversion patch is already applied.",
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await patchInstalledPackage();
}
