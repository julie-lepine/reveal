#!/usr/bin/env node
// Remplit les jaquettes (albumImage) de data/vibecheckSongs.js via l'API iTunes Search.
// Usage : node scripts/fetchVibeCheckCovers.mjs
// Nécessite une connexion Internet. Ré-écrit le fichier en conservant l'ordre des chansons.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PLAYLIST_GUESS_SONGS } from "../data/vibecheckSongs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(__dirname, "../data/vibecheckSongs.js");
const ART_SIZE = "600x600bb";

function upscale(url) {
  // iTunes renvoie du 100x100 ; on remonte en 600x600.
  return url ? url.replace(/\/\d+x\d+bb?\.(jpg|png)$/i, `/${ART_SIZE}.jpg`) : null;
}

async function lookupArtwork(song) {
  const term = encodeURIComponent(`${song.title} ${song.artist}`);
  const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "vibecheck-cover-fetch" } });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data?.results?.[0];
    return upscale(hit?.artworkUrl100 || hit?.artworkUrl60 || null);
  } catch {
    return null;
  }
}

function jsLine(song) {
  const img = song.albumImage ? `"${song.albumImage}"` : "null";
  return `  { id: ${JSON.stringify(song.id)}, title: ${JSON.stringify(song.title)}, artist: ${JSON.stringify(song.artist)}, albumImage: ${img} },`;
}

async function main() {
  console.log(`Récupération des jaquettes pour ${PLAYLIST_GUESS_SONGS.length} chansons…`);
  const updated = [];
  let ok = 0;
  for (const song of PLAYLIST_GUESS_SONGS) {
    const art = await lookupArtwork(song);
    if (art) ok += 1;
    updated.push({ ...song, albumImage: art || song.albumImage || null });
    console.log(`  ${art ? "✓" : "✗"} ${song.title} — ${song.artist}`);
    await new Promise((r) => setTimeout(r, 250)); // politesse anti rate-limit
  }

  const header = `// Base de chansons VibeCheck.
// \`albumImage\` est rempli automatiquement par \`scripts/fetchVibeCheckCovers.mjs\`
// (récupère les jaquettes iTunes 600x600). Tant qu'il est null, un placeholder 🎵 s'affiche.
// Pour modifier la liste : édite ce fichier puis lance \`node scripts/fetchVibeCheckCovers.mjs\`.

export const PLAYLIST_GUESS_SONGS = [
`;
  const body = updated.map(jsLine).join("\n");
  await writeFile(TARGET, `${header}${body}\n];\n`, "utf8");

  console.log(`\nTerminé : ${ok}/${updated.length} jaquettes récupérées.`);
  if (ok < updated.length) {
    console.log("Certaines chansons n'ont pas de jaquette (placeholder 🎵 conservé).");
  }
}

main().catch((e) => {
  console.error("Échec :", e?.message || e);
  process.exit(1);
});
