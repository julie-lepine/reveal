/**
 * Planches fiche store dans la DA des pubs SCREENS/Pub REVEAL 2.mp4 :
 * fond lavande, carte blanche arrondie, titre noir, capture dans un téléphone.
 *
 * Usage : node scripts/store-visuals/renderStoreVisuals.mjs
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

const slides = [
  {
    id: "01-jeux",
    title: "12 jeux<br>déjà disponibles",
    sub: "De quoi pimenter vos soirées<br>et ne jamais manquer de défis.",
    shot: "SCREENS/game-select2.png",
    w: 388,
    h: 901,
  },
  {
    id: "02-lobby",
    title: "Crée ton lobby.<br>Invite tes amis.",
    sub: "et que la partie commence !",
    shot: "scripts/store-visuals/shots/lobby-nathan.png",
    w: 390,
    h: 916,
  },
  {
    id: "03-dilemma",
    title: "Choisis ton camp.",
    sub: "Deux options. Tout le monde tranche.",
    shot: "SCREENS/dilemma.jpg",
    w: 378,
    h: 835,
  },
  {
    id: "04-consensus",
    title: "Pense comme<br>le groupe.",
    sub: "Le plus proche de la moyenne remporte la manche.",
    shot: "SCREENS/consensus.jpg",
    w: 391,
    h: 837,
  },
  {
    id: "05-classement",
    title: "Deviens<br>le GOAT !",
    sub: "Suis tes scores, grimpe au classement<br>et montre qui domine la soirée.",
    shot: "SCREENS/leaderboard.jpg",
    w: 390,
    h: 757,
  },
];

const targets = [
  { name: "play", width: 2160, height: 3840, dir: path.join(root, "store-assets", "promo", "play") },
  { name: "ios", width: 1242, height: 2688, dir: path.join(root, "store-assets", "promo", "ios") },
];

function shotFile(rel) {
  const local = path.join(root, rel);
  if (existsSync(local)) return local;
  const moved = path.resolve(root, "..", "COM", "assets", rel);
  if (existsSync(moved)) return moved;
  throw new Error("Capture introuvable : " + rel);
}

function page({ title, sub, shot, w, h, width, height }) {
  const shotUrl = shotFile(shot).replace(/\\/g, "/");
  const fontUrl = fontDir.replace(/\\/g, "/");
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
    padding: ${Math.round(width * 0.034)}px ${Math.round(width * 0.038)}px;
  }
  .card {
    height: 100%;
    background: #fff;
    border-radius: ${Math.round(width * 0.062)}px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: ${Math.round(height * 0.048)}px ${Math.round(width * 0.055)}px 0;
    overflow: hidden;
    container-type: size;
  }
  h1 {
    margin: 0;
    font-weight: 800;
    font-size: ${Math.round(width * 0.078)}px;
    line-height: 1.02;
    letter-spacing: -0.035em;
    color: #161616;
    text-align: center;
  }
  .sub {
    margin: ${Math.round(height * 0.018)}px 0 0;
    font-weight: 500;
    font-size: ${Math.round(width * 0.03)}px;
    line-height: 1.35;
    color: #8B909A;
    text-align: center;
  }
  .phone {
    margin-top: auto;
    margin-bottom: auto;
    width: min(92cqw, calc(74cqh * ${w} / ${h}));
    padding: ${Math.round(width * 0.01)}px;
    border-radius: ${Math.round(width * 0.048)}px;
    background: linear-gradient(165deg, #f4f4f6 0%, #c8c8ce 38%, #9a9aa2 100%);
    box-shadow: 0 ${Math.round(width * 0.018)}px ${Math.round(width * 0.045)}px rgba(22, 24, 36, 0.16);
  }
  .screen {
    position: relative;
    width: 100%;
    aspect-ratio: ${w} / ${h};
    border-radius: ${Math.round(width * 0.038)}px;
    overflow: hidden;
    background: #0d0f1e;
  }
  .screen img {
    position: absolute;
    inset: 0;
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
      <h1>${title}</h1>
      <p class="sub">${sub}</p>
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
for (const target of targets) await mkdir(target.dir, { recursive: true });

for (const slide of slides) {
  for (const target of targets) {
    const htmlPath = path.join(outDir, `${slide.id}-${target.name}.html`);
    const pngPath = path.join(target.dir, `${slide.id}.png`);
    await writeFile(htmlPath, page({ ...slide, width: target.width, height: target.height }), "utf8");
    await shot(htmlPath, pngPath, target.width, target.height);
    console.log(pngPath);
  }
}
