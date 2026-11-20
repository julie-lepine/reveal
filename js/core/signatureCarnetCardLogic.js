/**
 * FEATURE-PROFILE-04 — carte share 9:16 (helpers purs).
 * Pas de DOM, pas de fetch, pas de noms d’amis.
 */
import { resolvedNameColorHex } from "../../data/signatureIdentity.js";
import { publicAvatarUrl } from "./signatureAvatar.js";
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
  const avatarPath = raw.avatarPath || raw.avatar_path || null;
  const avatarRev = raw.avatarRev ?? raw.avatar_rev;
  return {
    name: String(raw.name || "Joueur").trim().slice(0, 24) || "Joueur",
    emoji: raw.emoji || "👤",
    color: raw.color || "#60A5FA",
    nameColorHex: resolvedNameColorHex({
      signature,
      nameColor: raw.nameColor || raw.name_color || null,
    }),
    signature,
    avatarUrl: signature ? publicAvatarUrl(avatarPath, avatarRev) : null,
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

/** Annulation share sheet (Web AbortError / Capacitor « Share canceled »). */
export function isShareCancelError(error) {
  const name = error?.name || "";
  const msg = String(error?.message || error?.errorMessage || "");
  return (
    name === "AbortError" ||
    name === "ShareCancelledError" ||
    /share canceled/i.test(msg) ||
    /share cancelled/i.test(msg)
  );
}

/**
 * Zones en px (1080×1920) de la carte de collection. Les 250 px du haut et du bas
 * restent hors carte : Instagram y pose ses boutons en story.
 */
export function carnetCardLayout() {
  const w = CARNET_CARD_WIDTH;
  const h = CARNET_CARD_HEIGHT;
  const safeTop = 250;
  const safeBottom = 250;
  const cardX = 90;
  const card = { x: cardX, y: safeTop, w: w - cardX * 2, h: h - safeTop - safeBottom, r: 60, border: 8 };
  const padX = 66;
  const innerX = card.x + padX;
  const innerW = card.w - padX * 2;

  const top = { x: innerX, y: card.y + 50, w: innerW, h: 44 };
  const avatar = { cx: w / 2, cy: top.y + top.h + 40 + 150, r: 150, ring: 12 };
  const name = { x: innerX, y: avatar.cy + avatar.r + 34, w: innerW, h: 104, size: 116 };
  const badge = { x: innerX, y: name.y + name.h + 26, w: innerW, h: 58 };
  const hook = { x: innerX, y: badge.y + badge.h + 18, w: innerW, h: 60 };

  const tileGap = 20;
  const tileW = (innerW - tileGap) / 2;
  const tileH = 176;
  const tilesY = hook.y + hook.h + 26;
  const tiles = [
    { x: innerX, y: tilesY, w: tileW, h: tileH, r: 28 },
    { x: innerX + tileW + tileGap, y: tilesY, w: tileW, h: tileH, r: 28 },
    { x: innerX, y: tilesY + tileH + tileGap, w: tileW, h: tileH, r: 28 },
    { x: innerX + tileW + tileGap, y: tilesY + tileH + tileGap, w: tileW, h: tileH, r: 28 },
  ];
  const dots = { x: innerX, y: tiles[2].y + tileH + 36, w: innerW, h: 30, dot: 26 };
  const logoW = 330;
  const logo = {
    x: (w - logoW) / 2,
    y: dots.y + dots.h + 26,
    w: logoW,
    h: card.y + card.h - 40 - (dots.y + dots.h + 26),
  };

  return { w, h, safeTop, safeBottom, card, top, avatar, name, badge, hook, tiles, dots, logo };
}
