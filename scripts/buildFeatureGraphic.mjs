/**
 * Feature graphic Play Store 1024×500.
 * Usage :
 *   node scripts/buildFeatureGraphic.mjs           → bannière complète
 *   node scripts/buildFeatureGraphic.mjs --bg-only   → fond seul (Figma)
 */
import sharp from "sharp";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outFull = join(root, "store-assets/android/feature-graphic.png");
const outBg = join(root, "store-assets/android/feature-graphic-bg.png");

const W = 1024;
const H = 500;
const bgOnly = process.argv.includes("--bg-only");

const GAME_LOGOS = [
  "hottake",
  "dilemma",
  "guesslie",
  "trivia",
  "vibecheck",
];

function backgroundSvgBuffer() {
  return Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d0f1e"/>
      <stop offset="100%" stop-color="#05060f"/>
    </linearGradient>
    <radialGradient id="glowL" cx="18%" cy="45%" r="42%">
      <stop offset="0%" stop-color="#ff3cac" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ff3cac" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowR" cx="85%" cy="35%" r="48%">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glowL)"/>
  <rect width="100%" height="100%" fill="url(#glowR)"/>
</svg>`);
}

async function writeBackground(outPath) {
  await sharp(backgroundSvgBuffer()).resize(W, H).png().toFile(outPath);
  console.log(`OK → ${outPath} (${W}×${H}, fond seul)`);
}

async function logoWithoutWhiteBg(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 235 && g > 235 && b > 235) data[i + 3] = 0;
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png();
}

async function resizeLogo(path, size) {
  let pipeline;
  if (path.includes("icon-white")) {
    pipeline = await logoWithoutWhiteBg(path);
  } else {
    pipeline = sharp(path);
  }
  return pipeline
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function main() {
  if (bgOnly) {
    await writeBackground(outBg);
    return;
  }

  const bgSvg = backgroundSvgBuffer();

  const textSvg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <text x="248" y="188" font-family="Arial, Helvetica, sans-serif" font-size="56" font-weight="800" fill="#FFFFFF">REVEAL</text>
  <text x="248" y="228" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="400" fill="#CBD5E1">L'app de soirée entre amis</text>
</svg>`);

  const mainSize = 148;
  const gameSize = 68;
  const gameGap = 14;
  const gamesStartX = 248;
  const gamesY = 268;

  const composites = [];

  const mainLogo = await resizeLogo(join(root, "resources/icon-white.png"), mainSize);
  composites.push({
    input: mainLogo,
    left: 52,
    top: Math.round((H - mainSize) / 2 - 36),
  });

  composites.push({ input: textSvg, left: 0, top: 0 });

  let gx = gamesStartX;
  for (const id of GAME_LOGOS) {
    const gameBuf = await resizeLogo(join(root, `assets/games/${id}.png`), gameSize);
    composites.push({ input: gameBuf, left: gx, top: gamesY });
    gx += gameSize + gameGap;
  }

  await sharp(bgSvg)
    .resize(W, H)
    .composite(composites)
    .png()
    .toFile(outFull);

  console.log(`OK → ${outFull} (${W}×${H})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
