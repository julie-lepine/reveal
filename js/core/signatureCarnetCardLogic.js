/**
 * FEATURE-PROFILE-04 — carte share 9:16 (helpers purs).
 * Pas de DOM, pas de fetch, pas de noms d’amis.
 */
import { resolvedNameColorHex } from "../../data/signatureIdentity.js";
import { catalogTitleForSessionGameId } from "./gameCatalogTitle.js";
import {
  SIGNATURE_CARNET_MAX_EVENINGS,
  aggregateCarnetRankSplit,
  carnetRankBarPercents,
  chronologicalCarnetEvenings,
} from "./signatureCarnetLogic.js";

export const CARNET_CARD_WIDTH = 1080;
export const CARNET_CARD_HEIGHT = 1920;
export const CARNET_CARD_MIME = "image/png";
export const CARNET_CARD_FILE = "reveal-carnet.png";

export function canShareCarnetCard(evenings = []) {
  return Array.isArray(evenings) && evenings.length > 0;
}

function rankDotTone(rank) {
  const r = Number(rank);
  if (r === 1) return "first";
  if (r === 2) return "second";
  if (Number.isInteger(r) && r >= 3) return "rest";
  return "empty";
}

/** 20 pastilles, chrono gauche → droite (comme la courbe). Slots vides à droite. */
export function carnetCardRankDots(evenings = [], slots = SIGNATURE_CARNET_MAX_EVENINGS) {
  const n = Number.isInteger(slots) && slots > 0 ? slots : SIGNATURE_CARNET_MAX_EVENINGS;
  const tones = chronologicalCarnetEvenings(evenings)
    .slice(0, n)
    .map((row) => rankDotTone(row?.rank));
  while (tones.length < n) tones.push("empty");
  return tones;
}

/** 1ers d’affilée les plus récents (pastilles remplies, droite = récent). */
export function carnetCardRecentFirstStreak(dots = []) {
  const filled = (Array.isArray(dots) ? dots : []).filter((t) => t !== "empty");
  let n = 0;
  for (let i = filled.length - 1; i >= 0; i -= 1) {
    if (filled[i] !== "first") break;
    n += 1;
  }
  return n;
}

/**
 * Une accroche, la plus rare. Pas de honte, pas de titre générique.
 */
export function carnetCardHook(model = {}) {
  const stats = model.stats || {};
  const split = model.rankSplit || {};
  const n = Math.max(0, Number(stats.evenings) || 0);
  const mvp = Math.max(0, Number(stats.mvp) || 0);
  const winrate = stats.winrate;
  const first = Math.max(0, Number(split.first) || 0);
  const second = Math.max(0, Number(split.second) || 0);
  const rest = Math.max(0, Number(split.rest) || 0);
  const streak = carnetCardRecentFirstStreak(model.dots);

  if (streak >= 2) return `${streak} 🥇 d'affilée`;
  if (n >= 2 && rest === 0 && first + second === n) {
    return `${n} soirées, ${n} podiums`;
  }
  if (mvp >= 2 && n < 6) return `${mvp} MVP en ${n} soirée${n > 1 ? "s" : ""}`;
  if (n >= 3 && winrate != null && Number.isFinite(winrate) && winrate >= 0.5) {
    return `${Math.round(winrate * 100)} % de 1re places`;
  }
  if (n === 1 && first === 1) return "Première soirée, première place";
  const fav = catalogTitleForSessionGameId(stats.favoriteGame);
  if (fav) return `Jeu fétiche : ${fav}`;
  if (n === 1) return "C'est lancé";
  if (n >= 2) return `${n} soirées au compteur`;
  return "C'est lancé";
}

function cardIdentity(raw = {}) {
  const signature = raw.signature === true;
  return {
    name: String(raw.name || "Joueur").trim().slice(0, 24) || "Joueur",
    emoji: raw.emoji || "👤",
    color: raw.color || "#60A5FA",
    nameColorHex: resolvedNameColorHex({
      signature,
      nameColor: raw.nameColor || raw.name_color || null,
    }),
    signature,
  };
}

/**
 * Payload de dessin / preview. Jamais de friendNames, lobby_id, ni liste détaillée.
 */
export function buildCarnetCardModel({ identity, evenings, stats } = {}) {
  const rows = Array.isArray(evenings) ? evenings : [];
  const slim = rows.map((row) => ({
    endedAt: row?.endedAt || null,
    rank: row?.rank ?? null,
    score: row?.score,
    games: Array.isArray(row?.games) ? row.games : [],
  }));
  const split = aggregateCarnetRankSplit(slim);
  const model = {
    identity: cardIdentity(identity),
    stats: {
      evenings: Number(stats?.evenings) || slim.length,
      games: Number(stats?.games) || 0,
      mvp: Number(stats?.mvp) || 0,
      winrate: stats?.winrate == null ? null : Number(stats.winrate),
      favoriteGame: typeof stats?.favoriteGame === "string" ? stats.favoriteGame : null,
    },
    sparkScores: chronologicalCarnetEvenings(slim).map((row) => Number(row.score)),
    rankSplit: split,
    rankPercents: carnetRankBarPercents(split),
    dots: carnetCardRankDots(slim),
  };
  model.hook = carnetCardHook(model);
  return model;
}

/** Zones en px (1080×1920). Logo sous les pastilles, marge IG bas. */
export function carnetCardLayout() {
  const w = CARNET_CARD_WIDTH;
  const h = CARNET_CARD_HEIGHT;
  const padX = 56;
  const padTop = 148;
  const padBottom = 210;
  const innerW = w - padX * 2;
  const gap = 16;
  const r = 24;

  const hero = { x: padX, y: padTop, w: innerW, h: 400, r: 36 };
  const ident = { x: padX, y: hero.y + hero.h + 36, w: innerW, h: 96, avatar: 88 };
  const vizY = ident.y + ident.h + 28;
  const topH = 250;
  const ringW = Math.round(innerW * 0.36);
  const ring = { x: padX, y: vizY, w: ringW, h: topH, r };
  const spark = {
    x: padX + ringW + gap,
    y: vizY,
    w: innerW - ringW - gap,
    h: topH,
    r,
  };
  const ranks = { x: padX, y: vizY + topH + gap, w: innerW, h: 188, r };
  const tileGap = 14;
  const tileW = (innerW - tileGap) / 2;
  const tileH = 118;
  const tilesY = ranks.y + ranks.h + gap;
  const tiles = [
    { x: padX, y: tilesY, w: tileW, h: tileH, r },
    { x: padX + tileW + tileGap, y: tilesY, w: tileW, h: tileH, r },
    { x: padX, y: tilesY + tileH + tileGap, w: tileW, h: tileH, r },
    { x: padX + tileW + tileGap, y: tilesY + tileH + tileGap, w: tileW, h: tileH, r },
  ];
  const dotsY = tiles[2].y + tileH + 28;
  const dots = { x: padX, y: dotsY, w: innerW, h: 70 };
  const logoH = 120;
  const logo = { x: padX, y: h - padBottom - logoH, w: innerW, h: logoH };

  return {
    w,
    h,
    padX,
    padTop,
    padBottom,
    hero,
    ident,
    ring,
    spark,
    ranks,
    tiles,
    dots,
    logo,
  };
}
