// One-shot: read /tier/apex.webp, convert it to /tier/apex-cutout.png
// where the dark background bakes into the alpha channel. Brightness ->
// alpha is the right move for a glowing object on black: black pixels
// become transparent, the crystal + base glow stay opaque, and the
// transition feathers smoothly without leaving a rectangular silhouette.
//
// Run once with: node scripts/extract-apex-cutout.mjs

import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const inputPath = path.join(here, "..", "public", "tier", "apex.webp");
const outputPath = path.join(here, "..", "public", "tier", "apex-cutout.png");

const img = sharp(inputPath).ensureAlpha();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });

const { width, height, channels } = info;
if (channels !== 4) {
  throw new Error(`expected 4 channels after ensureAlpha, got ${channels}`);
}

const out = Buffer.alloc(data.length);
// ITU-R BT.709 luminance weights so the cool-blue crystal gets the
// emphasis it has visually (otherwise pure-blue pixels read dimmer than
// they should in a flat average).
const wR = 0.2126;
const wG = 0.7152;
const wB = 0.0722;

// Pre-knockout floor: pixels darker than this go straight to fully
// transparent. Pushes the starfield + ambient haze out of frame while
// keeping the bright crown crystal and its ground glow untouched.
const FLOOR = 28;
// Anything above this saturates to fully opaque, so the crown core stays
// solid and isn't washed out by alpha scaling.
const CEIL = 175;

for (let i = 0; i < data.length; i += 4) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const lum = r * wR + g * wG + b * wB;

  let alpha;
  if (lum <= FLOOR) {
    alpha = 0;
  } else if (lum >= CEIL) {
    alpha = 255;
  } else {
    // Smooth ramp between FLOOR and CEIL.
    alpha = Math.round(((lum - FLOOR) / (CEIL - FLOOR)) * 255);
  }

  out[i] = r;
  out[i + 1] = g;
  out[i + 2] = b;
  out[i + 3] = alpha;
}

await sharp(out, { raw: { width, height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

console.log(`wrote ${outputPath} (${width}x${height})`);
