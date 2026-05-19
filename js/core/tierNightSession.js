import { TIER_LEVELS } from "../../data/tierTopics.js";
import { getActivePlayers } from "./players.js";
import { getLocalDisplayName, addScore, bumpPlayerStat, saveStatePatch, getState } from "./state.js";

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

export function scoreConsensusProximity(localPlaced, consensus) {
  const items = Object.values(localPlaced).flat();
  if (!items.length) return 0;
  let total = 0;
  items.forEach((item) => {
    const localTier = tierOfItem(localPlaced, item);
    const consTier = tierOfItem(consensus, item);
    const diff = Math.abs(rankValue(localTier) - rankValue(consTier));
    total += Math.max(0, 15 - diff * 5);
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

export function buildRecapsFromPlacements(topicId, listName, items, placementsByName) {
  const recaps = getActivePlayers().map((p) => ({
    player: p.name,
    emoji: p.emoji,
    color: p.color,
    placed: placementsByName[p.name] || {},
  }));

  const consensus = computeConsensusPlaced(recaps, items);
  const controversial = findMostControversialItem(recaps, items);
  const localName = getLocalDisplayName();
  const localPlaced = placementsByName[localName] || {};
  const pts = scoreConsensusProximity(localPlaced, consensus);
  addScore(localName, pts);
  bumpPlayerStat(localName, "tierConsensusPoints", pts);
  bumpPlayerStat(localName, "tierNightsPlayed", 1);

  saveTierNightRecaps(recaps, {
    topicId,
    listName,
    consensus,
    controversialItem: controversial.item,
    controversialSpread: controversial.spread,
    localConsensusPoints: pts,
  });
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
  const localName = getLocalDisplayName();
  const pts = scoreConsensusProximity(localPlaced, consensus);
  addScore(localName, pts);
  bumpPlayerStat(localName, "tierConsensusPoints", pts);
  bumpPlayerStat(localName, "tierNightsPlayed", 1);

  saveTierNightRecaps(recaps, {
    topicId,
    listName,
    consensus,
    controversialItem: controversial.item,
    controversialSpread: controversial.spread,
    localConsensusPoints: pts,
  });
  return recaps;
}

export function getTierNightRecaps() {
  return getTierNightSession().recaps || [];
}

export function getTierConsensus() {
  return getTierNightSession().consensus;
}
