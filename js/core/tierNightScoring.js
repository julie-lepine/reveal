import { TIER_LEVELS } from "../../data/tierTopics.js";
import {
  tierNightPointsForRankDiff,
  tierNightReversePointsForRankDiff,
} from "../../data/eveningScoring.js";

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

/** Points pour un item selon l'écart de tier local vs consensus. */
export function tierNightPointsForItem(localTier, consensusTier, { reverse = false } = {}) {
  const diff = Math.abs(rankValue(localTier) - rankValue(consensusTier));
  const pointsFn = reverse ? tierNightReversePointsForRankDiff : tierNightPointsForRankDiff;
  return pointsFn(diff);
}

/**
 * Détail des points Tier Night (pur, testable).
 * proximityTotal = moyenne arrondie des points par item (comme scoreConsensusProximity).
 */
export function buildTierNightScoreBreakdown(
  localPlaced,
  consensus,
  { reverse = false, outsiderBonus = 0 } = {}
) {
  const items = Object.values(localPlaced || {}).flat();
  const rows = items.map((item) => {
    const localTier = tierOfItem(localPlaced, item);
    const consensusTier = tierOfItem(consensus, item);
    const pts = tierNightPointsForItem(localTier, consensusTier, { reverse });
    return { item, localTier, consensusTier, pts };
  });

  const proximityTotal = items.length
    ? Math.round(rows.reduce((sum, row) => sum + row.pts, 0) / items.length)
    : 0;
  const bonus = outsiderBonus || 0;

  return {
    rows,
    itemCount: items.length,
    proximityTotal,
    outsiderBonus: bonus,
    total: proximityTotal + bonus,
    reverse: Boolean(reverse),
  };
}

/** Libellé court pour l'écran de jeu selon le modificateur. */
export function tierNightPointsHintText({ reverse = false } = {}) {
  if (reverse) {
    return "Points : +15 si tu t'éloignes fort du groupe, +10 si modérément (à contre-courant).";
  }
  return "Points : +15 même tier que le groupe, +10 à 1 tier d'écart · bonus +15 sur l'item le plus clivant.";
}
