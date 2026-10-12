import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  LEGACY_ALPHA_BLOCK,
  ORIGINAL_ALPHA_ASSIGNMENT,
  PATCHED_ALPHA_BLOCK,
  alphaPredictionToByte,
  patchAlphaConversion,
} from "../scripts/patch-imgly-alpha.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("clamps invalid model scores without imposing an extra confidence cutoff", () => {
  assert.equal(alphaPredictionToByte(-0.5), 0);
  assert.equal(alphaPredictionToByte(1.5), 255);
  assert.equal(alphaPredictionToByte(Number.NaN), 0);
  assert.equal(alphaPredictionToByte(Number.POSITIVE_INFINITY), 0);
  assert.equal(alphaPredictionToByte(0.005), 1);
  assert.equal(alphaPredictionToByte(0.01), 3);
  assert.equal(alphaPredictionToByte(0.02), 5);
});

test("keeps gradual alpha values for antialiased edges and fine details", () => {
  const alphas = [0.01, 0.03, 0.1, 0.5, 0.9].map(alphaPredictionToByte);
  assert.deepEqual(alphas, [3, 8, 26, 128, 230]);
  assert.ok(alphas.every((alpha, index) => index === 0 || alpha > alphas[index - 1]));
});

test("patches, migrates the old noise cutoff, and is idempotent", () => {
  const fixture = [
    "function convertFloat32ToUint8(float32Array) {",
    "  const uint8Array = new Uint8Array(float32Array.data.length);",
    "  for (let i = 0; i < float32Array.data.length; i++) {",
    `    ${ORIGINAL_ALPHA_ASSIGNMENT}`,
    "  }",
    "}",
  ].join("\n");
  const patched = patchAlphaConversion(fixture);
  const legacyFixture = fixture.replace(ORIGINAL_ALPHA_ASSIGNMENT, LEGACY_ALPHA_BLOCK);

  assert.ok(patched.includes(PATCHED_ALPHA_BLOCK));
  assert.ok(!patched.includes(ORIGINAL_ALPHA_ASSIGNMENT));
  assert.equal(patchAlphaConversion(patched), patched);
  assert.ok(!patchAlphaConversion(legacyFixture).includes("confidence < 0.02"));
  assert.throws(() => patchAlphaConversion("unrecognized package build"), /Refusing to patch/);
});

test("installed IMG.LY 1.7.0 ESM and CJS bundles both contain the clamp", async () => {
  const packagePath = path.join(PROJECT_ROOT, "node_modules", "@imgly", "background-removal");
  const packageJson = JSON.parse(await readFile(path.join(packagePath, "package.json"), "utf8"));
  assert.equal(packageJson.version, "1.7.0");

  for (const filename of ["dist/index.mjs", "dist/index.cjs"]) {
    const source = await readFile(path.join(packagePath, filename), "utf8");
    assert.ok(source.includes(PATCHED_ALPHA_BLOCK), `${filename} is missing the confidence clamp`);
    assert.ok(!source.includes(ORIGINAL_ALPHA_ASSIGNMENT), `${filename} still contains the unsafe conversion`);
    assert.ok(!source.includes("confidence < 0.02"), `${filename} still drops fine details`);
  }
});
