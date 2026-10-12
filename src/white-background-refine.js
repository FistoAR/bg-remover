// Use a restrained color-based fallback only when most of the image border is neutral white.
const WHITE_MIN_CHANNEL = 230;
const WHITE_MAX_CHANNEL_SPREAD = 32;
const MIN_WHITE_BORDER_RATIO = 0.78;
const MIN_DETAIL_CONTRAST = 10;
const MIN_LOCAL_CORE_CONTRAST = 20;
const LOCAL_CORE_RADIUS = 2;

function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function detectWhiteBorderBackground(rgba, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  if (!rgba || rgba.length !== width * height * 4) return null;

  const stride = Math.max(1, Math.floor(Math.max(width, height) / 128));
  const samples = [];
  let totalSamples = 0;

  function sampleAt(x, y) {
    const index = (y * width + x) * 4;
    const red = rgba[index];
    const green = rgba[index + 1];
    const blue = rgba[index + 2];
    totalSamples += 1;
    if (
      Math.min(red, green, blue) >= WHITE_MIN_CHANNEL
      && Math.max(red, green, blue) - Math.min(red, green, blue) <= WHITE_MAX_CHANNEL_SPREAD
    ) {
      samples.push([red, green, blue]);
    }
  }

  for (let x = 0; x < width; x += stride) {
    sampleAt(x, 0);
    if (height > 1) sampleAt(x, height - 1);
  }
  for (let y = stride; y < height - 1; y += stride) {
    sampleAt(0, y);
    if (width > 1) sampleAt(width - 1, y);
  }

  if (totalSamples === 0 || samples.length / totalSamples < MIN_WHITE_BORDER_RATIO) return null;
  return {
    red: median(samples.map(([red]) => red)),
    green: median(samples.map(([, green]) => green)),
    blue: median(samples.map(([, , blue]) => blue)),
  };
}

export function refineWhiteBackgroundMask(rgba, width, height) {
  const background = detectWhiteBorderBackground(rgba, width, height);
  if (!background) return { whiteBackgroundDetected: false, repairedPixels: 0 };

  const pixelCount = width * height;
  // Snapshot local contrast before editing RGB so recovery remains order-independent.
  const contrast = new Uint8Array(pixelCount);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 4;
    contrast[pixel] = Math.max(
      Math.abs(rgba[index] - background.red),
      Math.abs(rgba[index + 1] - background.green),
      Math.abs(rgba[index + 2] - background.blue),
    );
  }

  let repairedPixels = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const index = pixel * 4;
    const pixelContrast = contrast[pixel];
    if (rgba[index + 3] >= 250 || pixelContrast < MIN_DETAIL_CONTRAST) continue;

    const x = pixel % width;
    const y = Math.floor(pixel / width);
    let localCoreContrast = pixelContrast;
    for (let dy = -LOCAL_CORE_RADIUS; dy <= LOCAL_CORE_RADIUS; dy += 1) {
      const neighborY = y + dy;
      if (neighborY < 0 || neighborY >= height) continue;
      for (let dx = -LOCAL_CORE_RADIUS; dx <= LOCAL_CORE_RADIUS; dx += 1) {
        const neighborX = x + dx;
        if (neighborX < 0 || neighborX >= width) continue;
        localCoreContrast = Math.max(localCoreContrast, contrast[neighborY * width + neighborX]);
      }
    }

    if (localCoreContrast < MIN_LOCAL_CORE_CONTRAST) continue;
    const coverage = Math.min(1, pixelContrast / localCoreContrast);
    if (coverage < 0.06) continue;

    const rescuedAlpha = Math.round(coverage * 255);
    if (rescuedAlpha <= rgba[index + 3]) continue;

    // Unblend against the sampled white so rescued antialiased text has no white fringe.
    const inverseCoverage = 1 / coverage;
    rgba[index] = Math.max(0, Math.min(255, Math.round(
      (rgba[index] - background.red * (1 - coverage)) * inverseCoverage,
    )));
    rgba[index + 1] = Math.max(0, Math.min(255, Math.round(
      (rgba[index + 1] - background.green * (1 - coverage)) * inverseCoverage,
    )));
    rgba[index + 2] = Math.max(0, Math.min(255, Math.round(
      (rgba[index + 2] - background.blue * (1 - coverage)) * inverseCoverage,
    )));
    rgba[index + 3] = rescuedAlpha;
    repairedPixels += 1;
  }

  return { whiteBackgroundDetected: true, repairedPixels };
}
