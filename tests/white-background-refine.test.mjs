import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectWhiteBorderBackground,
  refineWhiteBackgroundMask,
} from "../src/white-background-refine.js";

function makeRgba(width, height, color, alpha = 0) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = alpha;
  }
  return pixels;
}

function setPixel(pixels, width, x, y, color, alpha = 0) {
  const index = (y * width + x) * 4;
  pixels[index] = color[0];
  pixels[index + 1] = color[1];
  pixels[index + 2] = color[2];
  pixels[index + 3] = alpha;
}

test("detects a neutral white or near-white border", () => {
  const pixels = makeRgba(20, 20, [247, 247, 247]);
  setPixel(pixels, 20, 10, 10, [10, 20, 30]);
  assert.deepEqual(detectWhiteBorderBackground(pixels, 20, 20), {
    red: 247,
    green: 247,
    blue: 247,
  });
});

test("restores high-contrast text pixels and keeps antialiased edges soft", () => {
  const width = 20;
  const pixels = makeRgba(width, 20, [255, 255, 255]);
  setPixel(pixels, width, 10, 10, [0, 0, 0]);
  setPixel(pixels, width, 9, 10, [127, 127, 127]);

  const result = refineWhiteBackgroundMask(pixels, width, 20);
  const coreIndex = (10 * width + 10) * 4;
  const edgeIndex = (10 * width + 9) * 4;
  const blankIndex = (10 * width + 8) * 4;

  assert.equal(result.whiteBackgroundDetected, true);
  assert.equal(result.repairedPixels, 2);
  assert.equal(pixels[coreIndex + 3], 255);
  assert.equal(pixels[edgeIndex + 3], 128);
  assert.equal(pixels[edgeIndex], 0);
  assert.equal(pixels[blankIndex + 3], 0);
});

test("keeps antialiased edges of light-gray lettering on a white background", () => {
  const width = 20;
  const pixels = makeRgba(width, 20, [255, 255, 255]);
  setPixel(pixels, width, 10, 10, [230, 230, 230]);
  setPixel(pixels, width, 9, 10, [242, 242, 242]);

  const result = refineWhiteBackgroundMask(pixels, width, 20);
  const coreIndex = (10 * width + 10) * 4;
  const edgeIndex = (10 * width + 9) * 4;

  assert.equal(result.whiteBackgroundDetected, true);
  assert.equal(pixels[coreIndex + 3], 255);
  assert.ok(pixels[edgeIndex + 3] > 0 && pixels[edgeIndex + 3] < 255);
  assert.ok(Math.abs(pixels[edgeIndex] - 230) <= 1);
});

test("does not alter cutouts whose border is not white", () => {
  const width = 20;
  const pixels = makeRgba(width, 20, [80, 100, 120]);
  setPixel(pixels, width, 10, 10, [0, 0, 0]);
  const before = new Uint8ClampedArray(pixels);

  const result = refineWhiteBackgroundMask(pixels, width, 20);
  assert.equal(result.whiteBackgroundDetected, false);
  assert.equal(result.repairedPixels, 0);
  assert.deepEqual(pixels, before);
});
