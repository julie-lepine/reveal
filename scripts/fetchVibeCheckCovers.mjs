#!/usr/bin/env node
// Remplit les jaquettes (albumImage) de data/vibecheckSongs.js via l'API iTunes Search.
// Usage :
//   node scripts/fetchVibeCheckCovers.mjs --insecure   → manquantes seulement (recommandé sous Windows)
//   node scripts/fetchVibeCheckCovers.mjs --all --insecure
// `--insecure` : contourne les erreurs certificat TLS (proxy / antivirus).

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import https from "node:https";
import { PLAYLIST_GUESS_SONGS } from "../data/vibecheckSongs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = resolve(__dirname, "../data/vibecheckSongs.js");
const ART_SIZE = "600x600bb";
const STORES = ["FR", "US"];
const REQUEST_DELAY_MS = 1200;
const ONLY_MISSING = !process.argv.includes("--all");
const INSECURE_TLS = process.argv.includes("--insecure");

if (INSECURE_TLS) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const HTTPS_AGENT = INSECURE_TLS ? new https.Agent({ rejectUnauthorized: false }) : undefined;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function upscale(url) {
  if (!url) return null;
  if (/\/\d+x\d+bb?\.(jpg|png)$/i.test(url)) {
    return url.replace(/\/\d+x\d+bb?\.(jpg|png)$/i, `/${ART_SIZE}.jpg`);
  }
  return url;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

function primaryArtist(artist) {
  return String(artist || "")
    .split(/\s+(?:ft\.|feat\.|featuring|&|x|\+|,)\s+/i)[0]
    .trim();
}

function buildSearchTerms(song) {
  const { title, artist } = song;
  const primary = primaryArtist(artist);
  return [...new Set([`${title} ${primary}`, `${title} ${artist}`, title].filter(Boolean))].slice(
    0,
    3
  );
}

function scoreHit(hit, song) {
  const titleNeedle = normalizeText(song.title);
  const artistNeedle = normalizeText(primaryArtist(song.artist));
  const track = normalizeText(hit.trackName || hit.collectionName);
  const artist = normalizeText(hit.artistName);
  let score = 0;
  if (track.includes(titleNeedle) || titleNeedle.includes(track)) score += 4;
  if (artist.includes(artistNeedle) || artistNeedle.includes(artist)) score += 3;
  if (hit.wrapperType === "track") score += 1;
  return score;
}

function pickBestHit(results, song) {
  if (!results?.length) return null;
  return [...results]
    .filter((h) => h.artworkUrl100 || h.artworkUrl60)
    .sort((a, b) => scoreHit(b, song) - scoreHit(a, song))[0];
}

async function searchItunes(term, { country = "FR", limit = 5 } = {}) {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=${limit}&country=${country}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "vibecheck-cover-fetch/2" },
      ...(HTTPS_AGENT ? { agent: HTTPS_AGENT } : {}),
    });
    const text = await res.text();
    if (/rate limit/i.test(text)) {
      return { status: 429, results: [] };
    }
    if (!text.trimStart().startsWith("{")) {
      return { status: res.status, results: [] };
    }
    const data = JSON.parse(text);
    return { status: res.status, results: data?.results || [] };
  } catch {
    return { status: 0, results: [] };
  }
}

async function lookupArtwork(song) {
  const terms = buildSearchTerms(song);

  for (const country of STORES) {
    for (const term of terms) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { status, results } = await searchItunes(term, { country });
        if (status === 429) {
          const wait = 12000 + attempt * 8000;
          console.log(`    ⏳ rate limit, pause ${Math.round(wait / 1000)}s…`);
          await sleep(wait);
          continue;
        }
        const hit = pickBestHit(results, song);
        const art = upscale(hit?.artworkUrl100 || hit?.artworkUrl60 || null);
        if (art) return art;
        break;
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  return null;
}

function jsLine(song) {
  const img = song.albumImage ? `"${song.albumImage}"` : "null";
  return `  { id: ${JSON.stringify(song.id)}, title: ${JSON.stringify(song.title)}, artist: ${JSON.stringify(song.artist)}, albumImage: ${img} },`;
}

async function main() {
  if (!INSECURE_TLS) {
    console.warn("Astuce : sous Windows, ajoute --insecure si fetch échoue (certificat TLS).\n");
  }

  const toFetch = ONLY_MISSING
    ? PLAYLIST_GUESS_SONGS.filter((s) => !s.albumImage)
    : PLAYLIST_GUESS_SONGS;

  console.log(
    ONLY_MISSING
      ? `Jaquettes manquantes : ${toFetch.length}/${PLAYLIST_GUESS_SONGS.length}`
      : `Toute la liste : ${PLAYLIST_GUESS_SONGS.length} chansons`
  );

  const updated = [];
  let ok = 0;
  let skipped = 0;

  for (const song of PLAYLIST_GUESS_SONGS) {
    if (ONLY_MISSING && song.albumImage) {
      updated.push(song);
      skipped += 1;
      continue;
    }

    const art = await lookupArtwork(song);
    const finalArt = art || song.albumImage || null;
    if (art) ok += 1;
    updated.push({ ...song, albumImage: finalArt });
    console.log(`  ${art ? "✓" : "✗"} ${song.title} — ${song.artist}`);
    await sleep(REQUEST_DELAY_MS);
  }

  const header = `// Base de chansons VibeCheck.
// \`albumImage\` est rempli automatiquement par \`scripts/fetchVibeCheckCovers.mjs\`
// (récupère les jaquettes iTunes 600x600). Tant qu'il est null, un placeholder 🎵 s'affiche.
// Pour modifier la liste : édite ce fichier puis lance \`node scripts/fetchVibeCheckCovers.mjs --insecure\`.

export const PLAYLIST_GUESS_SONGS = [
`;
  const body = updated.map(jsLine).join("\n");
  await writeFile(TARGET, `${header}${body}\n];\n`, "utf8");

  const stillMissing = updated.filter((s) => !s.albumImage).length;
  console.log(`\nTerminé : ${ok} récupérée(s), ${skipped} conservée(s), ${stillMissing} sans image.`);
  if (stillMissing) {
    console.log("Relance plus tard si rate limit : node scripts/fetchVibeCheckCovers.mjs --insecure");
  }
}

main().catch((e) => {
  console.error("Échec :", e?.message || e);
  process.exit(1);
});
