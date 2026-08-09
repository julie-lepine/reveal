import { TIER_LEVELS, getTierNightModifierById } from "../../data/tierTopics.js";
import { TIER_NIGHT_OUTSIDER_BONUS } from "../../data/eveningScoring.js";
import {
  buildTierNightScoreBreakdown,
  tierNightPointsForItem,
} from "./tierNightScoring.js";

export {
  buildTierNightScoreBreakdown,
  tierNightPointsForItem,
  tierNightPointsHintText,
  medianTierRank,
  tierRankToLetter,
  medianTierFromRanks,
} from "./tierNightScoring.js";
export { computeConsensusPlaced, recapHasPlacements } from "./tierNightConsensus.js";
import { getActivePlayers } from "./players.js";
import {
  getLocalDisplayName,
  getTierNightModifier,
  addScore,
  bumpPlayerStat,
  saveStatePatch,
  getState,
} from "./state.js";
import { isLobbyHost } from "./gameSync.js";
import { computeConsensusPlaced, recapHasPlacements } from "./tierNightConsensus.js";
import { enrichTierNightRecapsWithPlayerMeta as enrichRecapsWithPlayers } from "./tierNightRecapMeta.js";

const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };

export function getTierNightSession() {
  return getState().tierNightGame || { recaps: [], topicId: null, listName: "" };
}

export function saveTierNightRecaps(recaps, extra = {}) {
  const session = getTierNightSession();
  saveStatePatch({
    tierNightGame: { ...session, recaps, ...extra },
  });
}

function tierOfItem(placed, item) {
  for (const tier of TIER_LEVELS) {
    if ((placed[tier] || []).includes(item)) return tier;
  }
  return "D";
}

function rankValue(tier) {
  return TIER_RANK[tier] ?? 4;
}

function isMultiplayerLobby() {
  return Boolean(getState().lobby?.id);
}

function isLocalLobbyHost() {
  return isLobbyHost();
}

export function scoreConsensusProximity(localPlaced, consensus, { reverse = false } = {}) {
  return buildTierNightScoreBreakdown(localPlaced, consensus, { reverse }).proximityTotal;
}

/** Détail des points pour un joueur (écran récap). */
export function getTierNightScoreBreakdownForPlayer(playerName, session = getTierNightSession()) {
  const recap = (session.recaps || []).find((r) => r.player === playerName);
  if (!recap || !session.consensus) return null;
  const modifier = getTierNightModifierById(getTierNightModifier());
  return buildTierNightScoreBreakdown(recap.placed, session.consensus, {
    reverse: Boolean(modifier?.reverseScore),
    outsiderBonus: recap.outsiderBonus ?? 0,
  });
}

/** Item avec le plus de désaccord entre joueurs */
export function findMostControversialItem(recaps, items) {
  const participating = recaps.filter(recapHasPlacements);
  if (!participating.length) return { item: items[0], spread: 0 };
  let best = items[0];
  let bestSpread = -1;
  items.forEach((item) => {
    const ranks = participating.map((r) => rankValue(tierOfItem(r.placed, item)));
    const spread = Math.max(...ranks) - Math.min(...ranks);
    if (spread > bestSpread) {
      bestSpread = spread;
      best = item;
    }
  });
  return { item: best, spread: bestSpread };
}

function attachConsensusPoints(recaps, consensus) {
  const modifier = getTierNightModifierById(getTierNightModifier());
  const reverse = Boolean(modifier?.reverseScore);
  recaps.forEach((r) => {
    if (!recapHasPlacements(r)) {
      r.consensusPoints = 0;
      return;
    }
    r.consensusPoints = scoreConsensusProximity(r.placed, consensus, { reverse });
  });
  return recaps;
}

/**
 * Bonus « Outsider » (#3) : sur l'item le plus clivant, le ou les joueurs les
 * plus éloignés du consensus gagnent un bonus. Ajouté par-dessus la proximité.
 */
function attachOutsiderBonus(recaps, consensus, controversialItem) {
  recaps.forEach((r) => {
    r.outsiderBonus = 0;
  });
  if (!controversialItem) return;

  const consRank = rankValue(tierOfItem(consensus, controversialItem));
  const diffs = recaps.map((r) => {
    const placedHere = Object.values(r.placed || {})
      .flat()
      .includes(controversialItem);
    if (!placedHere) return -1;
    return Math.abs(rankValue(tierOfItem(r.placed, controversialItem)) - consRank);
  });

  const maxDiff = Math.max(...diffs);
  if (maxDiff < 1) return;

  recaps.forEach((r, i) => {
    if (diffs[i] === maxDiff) {
      r.outsiderBonus = TIER_NIGHT_OUTSIDER_BONUS;
      r.consensusPoints = (r.consensusPoints || 0) + TIER_NIGHT_OUTSIDER_BONUS;
    }
  });
}

/** Ajoute les points de manche au cumul soirée (une seule fois par partie). */
function applyTierNightRoundScores(recaps) {
  const session = getTierNightSession();
  if (session.scoresApplied) return false;

  const mp = isMultiplayerLobby();
  const toScore = mp ? recaps : recaps.filter((r) => r.player === getLocalDisplayName());

  toScore.forEach((r) => {
    if (!recapHasPlacements(r)) return;
    const pts = Math.max(0, r.consensusPoints ?? 0);
    addScore(r.player, pts);
    bumpPlayerStat(r.player, "tierConsensusPoints", pts);
    bumpPlayerStat(r.player, "tierNightsPlayed", 1);
  });

  saveTierNightRecaps(recaps, { scoresApplied: true });
  return true;
}

function finalizeTierNightRecapSave(recaps, meta) {
  const localName = getLocalDisplayName();
  const localPts = recaps.find((r) => r.player === localName)?.consensusPoints ?? 0;
  saveTierNightRecaps(recaps, {
    ...meta,
    localConsensusPoints: localPts,
  });
}

export function buildRecapsFromPlacements(
  topicId,
  listName,
  items,
  placementsByName,
  { applyScores = true } = {}
) {
  const recaps = getActivePlayers().map((p) => ({
    player: p.name,
    emoji: p.emoji,
    color: p.color,
    placed: placementsByName[p.name] || {},
  }));

  const consensus = computeConsensusPlaced(recaps, items);
  const controversial = findMostControversialItem(recaps, items);
  attachConsensusPoints(recaps, consensus);
  attachOutsiderBonus(recaps, consensus, controversial.item);

  finalizeTierNightRecapSave(recaps, {
    topicId,
    listName,
    consensus,
    controversialItem: controversial.item,
    controversialSpread: controversial.spread,
  });

  const mp = isMultiplayerLobby();
  if (applyScores && (!mp || isLocalLobbyHost())) {
    applyTierNightRoundScores(recaps);
  }

  return recaps;
}

/**
 * FEATURE-TIERNIGHT-04F — scoring d’une liste de série Rank Live.
 * Ledger `scoredRoundIds` (pas le singleton `scoresApplied`).
 * `tierNightsPlayed` uniquement à `isSeriesEnd`.
 *
 * @param {{
 *   roundId?: string|null,
 *   recaps?: object[],
 *   isSeriesEnd?: boolean,
 *   series?: object|null,
 * }} [opts]
 */
export function applyTierNightLiveSeriesListScores({
  roundId = null,
  recaps = [],
  isSeriesEnd = false,
  series = null,
} = {}) {
  const rid = roundId != null ? String(roundId) : "";
  const scored = Array.isArray(series?.scoredRoundIds)
    ? series.scoredRoundIds.map(String)
    : [];
  if (rid && scored.includes(rid)) {
    return { applied: false, alreadyScored: true };
  }

  const mp = isMultiplayerLobby();
  const toScore = mp
    ? recaps
    : recaps.filter((r) => r.player === getLocalDisplayName());

  toScore.forEach((r) => {
    if (!recapHasPlacements(r)) return;
    const pts = Math.max(0, r.consensusPoints ?? 0);
    addScore(r.player, pts);
    bumpPlayerStat(r.player, "tierConsensusPoints", pts);
    if (isSeriesEnd === true) {
      bumpPlayerStat(r.player, "tierNightsPlayed", 1);
    }
  });

  // Ne pas poser scoresApplied=true : bloquerait la liste suivante (mono-path).
  saveTierNightRecaps(recaps, { scoresApplied: false });
  return { applied: true, alreadyScored: false };
}

export function buildRecapsWithSimulation(topicId, listName, items, localPlaced) {
  const recaps = [
    {
      player: getLocalDisplayName(),
      emoji: "⭐",
      color: "#A78BFA",
      placed: { ...localPlaced },
    },
  ];

  const pool = [...items];
  getActivePlayers()
    .filter((p) => !p.isLocal)
    .forEach((p) => {
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      const placed = {};
      TIER_LEVELS.forEach((tier) => {
        placed[tier] = [];
      });
      shuffled.forEach((item, i) => {
        const tier = TIER_LEVELS[i % TIER_LEVELS.length];
        placed[tier].push(item);
      });
      recaps.push({
        player: p.name,
        emoji: p.emoji,
        color: p.color,
        placed,
      });
    });

  const consensus = computeConsensusPlaced(recaps, items);
  const controversial = findMostControversialItem(recaps, items);
  attachConsensusPoints(recaps, consensus);
  attachOutsiderBonus(recaps, consensus, controversial.item);

  finalizeTierNightRecapSave(recaps, {
    topicId,
    listName,
    consensus,
    controversialItem: controversial.item,
    controversialSpread: controversial.spread,
  });

  applyTierNightRoundScores(recaps);
  return recaps;
}

export function enrichTierNightRecapsWithPlayerMeta(recaps = [], players = getActivePlayers()) {
  return enrichRecapsWithPlayers(recaps, players);
}

export function getTierNightRecaps() {
  return enrichTierNightRecapsWithPlayerMeta(getTierNightSession().recaps || []);
}

export function getTierConsensus() {
  return getTierNightSession().consensus;
}
