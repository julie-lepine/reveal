/**
 * FEATURE-TIERNIGHT-SERIES-03A - calcul de scores série (pur), aligné mono-thème + SQL.
 *
 * Utilise les helpers canoniques JS (consensus / proximité / outsider).
 * Les golden tests comparent ces sorties aux helpers SQL `tiernight_series_*`.
 */

import { TIER_LEVELS } from "../../data/tierTopics.js";
import { TIER_NIGHT_OUTSIDER_BONUS } from "../../data/eveningScoring.js";
import { computeConsensusPlaced } from "./tierNightConsensus.js";
import {
  buildTierNightScoreBreakdown,
  medianTierRank,
  tierRankToLetter,
} from "./tierNightScoring.js";
import { validateTierNightSeriesPlacement } from "./tierNightSeriesPlacement.js";

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

/**
 * Miroir exact de `tiernight_series_points_for_diff` / eveningScoring.
 */
export function tierNightSeriesPointsForDiff(diff, reverse = false) {
  const d = Number(diff) || 0;
  if (reverse) {
    if (d >= 3) return 15;
    if (d === 2) return 10;
    return 0;
  }
  if (d <= 0) return 15;
  if (d === 1) return 10;
  return 0;
}

/**
 * Miroir `tiernight_series_median_rank`.
 */
export function tierNightSeriesMedianRank(ranks) {
  if (!Array.isArray(ranks) || ranks.length === 0) return 2;
  const sorted = [...ranks].sort((a, b) => a - b);
  return medianTierRank(sorted);
}

/**
 * @param {object} opts
 * @param {string[]} opts.items
 * @param {Record<string, object>} opts.placementsByUid
 * @param {string[]} opts.participantUids - ordre stable
 * @param {Record<string, string>} [opts.displayNames]
 * @param {boolean} [opts.reverse]
 * @returns {{
 *   ok: boolean,
 *   code?: string,
 *   consensus?: object,
 *   controversialItem?: string|null,
 *   controversialSpread?: number,
 *   recaps?: object[],
 * }}
 */
export function computeTierNightSeriesRoundScores({
  items,
  placementsByUid,
  participantUids,
  displayNames = {},
  reverse = false,
} = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, code: "TNS_ITEMS_EMPTY" };
  }
  if (!Array.isArray(participantUids) || participantUids.length === 0) {
    return { ok: false, code: "TNS_NO_PARTICIPANTS" };
  }

  for (const uid of participantUids) {
    const v = validateTierNightSeriesPlacement(placementsByUid?.[uid], items);
    if (!v.ok) {
      return { ok: false, code: v.code, detail: v.detail, uid };
    }
  }

  const recapsInput = participantUids.map((uid) => ({
    uid,
    player: displayNames[uid] || uid,
    placed: placementsByUid[uid],
  }));

  const consensus = computeConsensusPlaced(recapsInput, items);

  let controversialItem = items[0];
  let bestSpread = -1;
  for (const item of items) {
    const ranks = participantUids.map((uid) =>
      rankValue(tierOfItem(placementsByUid[uid], item))
    );
    const spread = Math.max(...ranks) - Math.min(...ranks);
    if (spread > bestSpread) {
      bestSpread = spread;
      controversialItem = item;
    }
  }

  const recaps = recapsInput.map((r) => {
    const breakdown = buildTierNightScoreBreakdown(r.placed, consensus, {
      reverse: Boolean(reverse),
      outsiderBonus: 0,
    });
    return {
      uid: r.uid,
      player: r.player,
      placed: r.placed,
      proximityPoints: breakdown.proximityTotal,
      outsiderBonus: 0,
      consensusPoints: breakdown.proximityTotal,
    };
  });

  if (controversialItem != null && bestSpread >= 1) {
    const consRank = rankValue(tierOfItem(consensus, controversialItem));
    const diffs = participantUids.map((uid) =>
      Math.abs(
        rankValue(tierOfItem(placementsByUid[uid], controversialItem)) - consRank
      )
    );
    const maxDiff = Math.max(...diffs);
    if (maxDiff >= 1) {
      recaps.forEach((r, i) => {
        if (diffs[i] === maxDiff) {
          r.outsiderBonus = TIER_NIGHT_OUTSIDER_BONUS;
          r.consensusPoints = (r.proximityPoints || 0) + TIER_NIGHT_OUTSIDER_BONUS;
        }
      });
    }
  }

  return {
    ok: true,
    consensus,
    controversialItem: bestSpread >= 0 ? controversialItem : null,
    controversialSpread: bestSpread,
    recaps,
    // exposition golden / SQL
    medianHelpers: {
      medianTierRank,
      tierRankToLetter,
      tierNightSeriesMedianRank,
      tierNightSeriesPointsForDiff,
    },
  };
}

/**
 * Fixtures golden versionnées (entrées → sorties attendues via compute JS).
 * Comparées aussi aux helpers SQL dans le runbook staging.
 */
export function buildTierNightSeriesGoldenFixtures() {
  const items = ["alpha", "beta", "gamma"];

  const place = (map) => {
    const placed = { S: [], A: [], B: [], C: [], D: [] };
    for (const [item, tier] of Object.entries(map)) {
      placed[tier].push(item);
    }
    return placed;
  };

  const u1 = "11111111-1111-4111-8111-111111111111";
  const u2 = "22222222-2222-4222-8222-222222222222";
  const u3 = "33333333-3333-4333-8333-333333333333";
  const u4 = "44444444-4444-4444-8444-444444444444";

  /** @type {Array<object>} */
  const cases = [];

  // Impair (3) - consensus médian
  cases.push({
    id: "odd-median-exact",
    reverse: false,
    items,
    participantUids: [u1, u2, u3],
    placementsByUid: {
      [u1]: place({ alpha: "S", beta: "A", gamma: "B" }),
      [u2]: place({ alpha: "S", beta: "B", gamma: "B" }),
      [u3]: place({ alpha: "A", beta: "C", gamma: "B" }),
    },
  });

  // Pair (2)
  cases.push({
    id: "even-median-floor",
    reverse: false,
    items,
    participantUids: [u1, u2],
    placementsByUid: {
      [u1]: place({ alpha: "S", beta: "S", gamma: "S" }),
      [u2]: place({ alpha: "D", beta: "D", gamma: "D" }),
    },
  });

  // Diff 0 / 1 / 2+
  cases.push({
    id: "diff-buckets-normal",
    reverse: false,
    items: ["x", "y"],
    participantUids: [u1, u2, u3],
    placementsByUid: {
      [u1]: place({ x: "S", y: "S" }),
      [u2]: place({ x: "S", y: "A" }),
      [u3]: place({ x: "S", y: "C" }),
    },
  });

  // Reverse
  cases.push({
    id: "reverse-modifier",
    reverse: true,
    items: ["x", "y"],
    participantUids: [u1, u2, u3],
    placementsByUid: {
      [u1]: place({ x: "S", y: "S" }),
      [u2]: place({ x: "A", y: "B" }),
      [u3]: place({ x: "D", y: "D" }),
    },
  });

  // Outsider tie (2 outsiders)
  cases.push({
    id: "outsider-tie",
    reverse: false,
    items: ["hot", "cold"],
    participantUids: [u1, u2, u3, u4],
    placementsByUid: {
      [u1]: place({ hot: "S", cold: "B" }),
      [u2]: place({ hot: "S", cold: "B" }),
      [u3]: place({ hot: "D", cold: "B" }),
      [u4]: place({ hot: "D", cold: "B" }),
    },
  });

  // Ordre items différent - même score
  cases.push({
    id: "item-order-invariant",
    reverse: false,
    items: ["gamma", "alpha", "beta"],
    participantUids: [u1, u2, u3],
    placementsByUid: {
      [u1]: place({ alpha: "S", beta: "A", gamma: "B" }),
      [u2]: place({ alpha: "S", beta: "B", gamma: "B" }),
      [u3]: place({ alpha: "A", beta: "C", gamma: "B" }),
    },
  });

  // Tiers vides autorisés
  cases.push({
    id: "empty-tiers-ok",
    reverse: false,
    items: ["solo"],
    participantUids: [u1, u2],
    placementsByUid: {
      [u1]: place({ solo: "S" }),
      [u2]: place({ solo: "S" }),
    },
  });

  return cases.map((c) => {
    const result = computeTierNightSeriesRoundScores({
      items: c.items,
      placementsByUid: c.placementsByUid,
      participantUids: c.participantUids,
      reverse: c.reverse,
      displayNames: Object.fromEntries(
        c.participantUids.map((uid, i) => [uid, `P${i + 1}`])
      ),
    });
    return {
      ...c,
      expected: {
        ok: result.ok,
        consensus: result.consensus,
        controversialItem: result.controversialItem,
        controversialSpread: result.controversialSpread,
        scores: (result.recaps || []).map((r) => ({
          uid: r.uid,
          proximityPoints: r.proximityPoints,
          outsiderBonus: r.outsiderBonus,
          consensusPoints: r.consensusPoints,
        })),
      },
    };
  });
}
