/**
 * Visuels App Store (iOS 27) dans la DA des planches promo :
 * fond lavande, carte blanche, titre Jakarta, capture dans un téléphone.
 *
 * En-tête fiche : 3840×1646 (21:9)
 * Résultats de recherche : 3840×2560 (3:2)
 *
 * Usage : node scripts/store-visuals/renderAppleCreatives.mjs
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outDir = path.join(root, "tmp", "store-visuals", "html");
const fontDir = path.join(root, "scripts", "store-visuals", "fonts");
const destDir = path.join(root, "store-assets", "promo", "apple");

const slides = [
  {
    id: "header",
    width: 3840,
    height: 1646,
    title: "Crée ton lobby.<br>Invite tes amis.",
    sub: "et que la partie commence !",
    shot: "scripts/store-visuals/shots/lobby-nathan.png",
    w: 390,
    h: 916,
    titlePx: 196,
    subPx: 84,
    phoneH: 1240,
  },
  {
    id: "search",
    width: 3840,
    height: 2560,
    title: "12 jeux<br>déjà disponibles",
    sub: "De quoi pimenter vos soirées<br>et ne jamais manquer de défis.",
    shot: "SCREENS/game-select2.png",
    w: 388,
    h: 901,
    titlePx: 248,
    subPx: 100,
    phoneH: 1980,
  },
];

function shotFile(rel) {
  const local = path.join(root, rel);
  if (existsSync(local)) return local;
  const moved = path.resolve(root, "..", "COM", "assets", rel);
  if (existsSync(moved)) return moved;
  throw new Error("Capture introuvable : " + rel);
}

function page(slide) {
  const { title, sub, shot, w, h, width, height, titlePx, subPx, phoneH } = slide;
  const shotUrl = shotFile(shot).replace(/\\/g, "/");
  const fontUrl = fontDir.replace(/\\/g, "/");
  const pad = Math.round(width * 0.028);
  const radius = Math.round(width * 0.036);
  const bezel = Math.round(phoneH * 0.018);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: Jakarta;
    src: url("file:///${fontUrl}/Jakarta-800.woff2") format("woff2");
    font-weight: 800;
    font-style: normal;
  }
  @font-face {
    font-family: Jakarta;
    src: url("file:///${fontUrl}/Jakarta-500.woff2") format("woff2");
    font-weight: 500;
    font-style: normal;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: #DBDFEA;
    font-family: Jakarta, "Segoe UI", sans-serif;
  }
  .stage {
    width: ${width}px;
    height: ${height}px;
    padding: ${pad}px;
  }
  .card {
    height: 100%;
    background: #fff;
    border-radius: ${radius}px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: 0 ${Math.round(width * 0.055)}px 0 ${Math.round(width * 0.07)}px;
    overflow: hidden;
    gap: ${Math.round(width * 0.03)}px;
  }
  .copy {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  h1 {
    margin: 0;
    max-width: 16ch;
    font-weight: 800;
    font-size: ${titlePx}px;
    line-height: 1.02;
    letter-spacing: -0.035em;
    color: #161616;
  }
  .sub {
    margin: ${Math.round(subPx * 0.7)}px 0 0;
    max-width: 28ch;
    font-weight: 500;
    font-size: ${subPx}px;
    line-height: 1.35;
    color: #8B909A;
  }
  .phone {
    flex: none;
    height: ${phoneH}px;
    padding: ${bezel}px;
    border-radius: ${Math.round(phoneH * 0.055)}px;
    background: linear-gradient(165deg, #f4f4f6 0%, #c8c8ce 38%, #9a9aa2 100%);
    box-shadow: 0 ${Math.round(phoneH * 0.028)}px ${Math.round(phoneH * 0.07)}px rgba(22, 24, 36, 0.16);
  }
  .screen {
    height: 100%;
    aspect-ratio: ${w} / ${h};
    border-radius: ${Math.round(phoneH * 0.042)}px;
    overflow: hidden;
    background: #0d0f1e;
  }
  .screen img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="card">
      <div class="copy">
        <h1>${title}</h1>
        <p class="sub">${sub}</p>
      </div>
      <div class="phone"><div class="screen"><img src="file:///${shotUrl}" alt=""></div></div>
    </div>
  </div>
</body>
</html>`;
}

function shot(htmlPath, pngPath, width, height) {
  const url = "file:///" + htmlPath.replace(/\\/g, "/");
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--allow-file-access-from-files",
      "--virtual-time-budget=8000",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`,
      url,
    ], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("chrome " + code))));
  });
}

await mkdir(outDir, { recursive: true });
await mkdir(destDir, { recursive: true });

for (const slide of slides) {
  const htmlPath = path.join(outDir, `${slide.id}-apple.html`);
  const pngPath = path.join(destDir, `${slide.id}.png`);
  await writeFile(htmlPath, page(slide), "utf8");
  await shot(htmlPath, pngPath, slide.width, slide.height);
  console.log(pngPath);
}
