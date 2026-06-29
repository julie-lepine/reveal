import { TIER_LEVELS, getTierNightModifierById } from "../../data/tierTopics.js";
import {
  tierNightPointsForRankDiff,
  tierNightReversePointsForRankDiff,
  EVENING_POINTS,
} from "../../data/eveningScoring.js";
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

/** Consensus = tier médian des joueurs pour chaque item */
export function computeConsensusPlaced(recaps, items) {
  const consensus = {};
  TIER_LEVELS.forEach((t) => {
    consensus[t] = [];
  });

  items.forEach((item) => {
    const ranks = recaps.map((r) => rankValue(tierOfItem(r.placed, item)));
    ranks.sort((a, b) => a - b);
    const mid = ranks[Math.floor(ranks.length / 2)];
    const tier = TIER_LEVELS[mid] || "C";
    consensus[tier].push(item);
  });
  return consensus;
}

export function scoreConsensusProximity(localPlaced, consensus, { reverse = false } = {}) {
  const items = Object.values(localPlaced).flat();
  if (!items.length) return 0;
  const pointsFn = reverse
    ? tierNightReversePointsForRankDiff
    : tierNightPointsForRankDiff;
  let total = 0;
  items.forEach((item) => {
    const localTier = tierOfItem(localPlaced, item);
    const consTier = tierOfItem(consensus, item);
    const diff = Math.abs(rankValue(localTier) - rankValue(consTier));
    total += pointsFn(diff);
  });
  return Math.round(total / items.length);
}

/** Item avec le plus de désaccord entre joueurs */
export function findMostControversialItem(recaps, items) {
  let best = items[0];
  let bestSpread = -1;
  items.forEach((item) => {
    const ranks = recaps.map((r) => rankValue(tierOfItem(r.placed, item)));
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
      r.outsiderBonus = EVENING_POINTS.BONUS;
      r.consensusPoints = (r.consensusPoints || 0) + EVENING_POINTS.BONUS;
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
    const pts = r.consensusPoints ?? 0;
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

export function buildRecapsFromPlacements(topicId, listName, items, placementsByName) {
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
  if (!mp || isLocalLobbyHost()) {
    applyTierNightRoundScores(recaps);
  }

  return recaps;
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

export function getTierNightRecaps() {
  return getTierNightSession().recaps || [];
}

export function getTierConsensus() {
  return getTierNightSession().consensus;
}

/** Points de la manche Tier Night, triés (pour l’écran récap). */
export function getTierNightRoundPointsSorted() {
  return [...getTierNightRecaps()].sort(
    (a, b) => (b.consensusPoints ?? 0) - (a.consensusPoints ?? 0)
  );
}
