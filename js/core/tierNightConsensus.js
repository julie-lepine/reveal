import { TIER_LEVELS } from "../../data/tierTopics.js";
import { medianTierFromRanks } from "./tierNightScoring.js";

const TIER_RANK = { S: 0, A: 1, B: 2, C: 3, D: 4 };

function tierOfItem(placed, item) {
  for (const tier of TIER_LEVELS) {
    if ((placed[tier] || []).includes(item)) return tier;
  }
  return "D";
}

function rankValue(tier) {
  return TIER_RANK[tier] ?? 4;
}

export function recapHasPlacements(recap) {
  return Object.values(recap?.placed || {}).flat().length > 0;
}

/** Consensus = tier médian des joueurs ayant participé pour chaque item. */
export function computeConsensusPlaced(recaps, items) {
  const consensus = {};
  TIER_LEVELS.forEach((t) => {
    consensus[t] = [];
  });

  const participating = recaps.filter(recapHasPlacements);
  if (!participating.length) return consensus;

  items.forEach((item) => {
    const ranks = participating.map((r) => rankValue(tierOfItem(r.placed, item)));
    const tier = medianTierFromRanks(ranks);
    consensus[tier].push(item);
  });
  return consensus;
}
