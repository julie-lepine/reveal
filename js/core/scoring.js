import {
  HOT_TAKE_POINTS_MAJORITY,
  HOT_TAKE_POINTS_DISSENT,
} from "../../data/hotTakes.js";
import { SPEED_VOTE_POINTS_WINNER } from "../../data/speedVote.js";
import { addScore, bumpPlayerStat } from "./state.js";
import { getMajorityOption } from "./hotTakeSession.js";

export function awardHotTakeVotes(votes, options) {
  const { majority } = getMajorityOption(votes, options);
  const summary = { majority, dissenters: [], majorityWinners: [] };

  Object.entries(votes).forEach(([name, choice]) => {
    if (choice === majority) {
      addScore(name, HOT_TAKE_POINTS_MAJORITY);
      bumpPlayerStat(name, "hotTakeMajorityWins", 1);
      summary.majorityWinners.push(name);
    } else {
      addScore(name, HOT_TAKE_POINTS_DISSENT);
      bumpPlayerStat(name, "hotTakeDissentWins", 1);
      summary.dissenters.push(name);
    }
  });

  return summary;
}

/** Le(s) joueur(s) le plus voté(s) reçoivent les points de la manche. */
export function awardSpeedVoteRound(votes, { basePoints = SPEED_VOTE_POINTS_WINNER, multiplier = 1 } = {}) {
  const counts = {};
  Object.values(votes).forEach((target) => {
    if (!target) return;
    counts[target] = (counts[target] || 0) + 1;
  });

  let max = 0;
  Object.values(counts).forEach((n) => {
    if (n > max) max = n;
  });

  const winners = Object.entries(counts)
    .filter(([, n]) => n === max && max > 0)
    .map(([name]) => name);

  const pointsAwarded = basePoints * multiplier;
  winners.forEach((name) => addScore(name, pointsAwarded));

  return { counts, winners, maxVotes: max, pointsAwarded };
}
