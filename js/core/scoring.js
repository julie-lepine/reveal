import {
  HOT_TAKE_POINTS_MAJORITY,
  HOT_TAKE_POINTS_DISSENT,
} from "../../data/hotTakes.js";
import { filterVoterVotes, computeRoundMetrics } from "./truthMeterSession.js";
import { SPEED_VOTE_POINTS_WINNER } from "../../data/speedVote.js";
import { DILEMMA_POINTS_MAJORITY_WIN } from "../../data/dilemma.js";
import { countDilemmaResults } from "./dilemmaSession.js";
import {
  TRUTH_METER_BLUFF_GAP,
  TRUTH_METER_POINTS_BLUFF,
  TRUTH_METER_POINTS_CONSENSUS,
  TRUTH_METER_CONSENSUS_GAP,
  TRUTH_METER_POINTS_MIND_READER,
  TRUTH_METER_POINTS_CLOSE,
  TRUTH_METER_CLOSE_DISTANCE,
} from "../../data/truthMeter.js";
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

/** TruthMeter : bonus auteur si grand écart (bluff), « le plus proche » = plus proche de la moyenne groupe. */
export function awardTruthMeterRound(votes, author, authorEstimate) {
  const voterVotes = filterVoterVotes(votes, author);
  const { groupAvg, gap, variance } = computeRoundMetrics(
    voterVotes,
    authorEstimate,
    author
  );
  const summary = {
    groupAvg,
    gap,
    authorEstimate,
    variance,
    bluffWin: false,
    consensus: false,
    mindReader: null,
    closeVoters: [],
  };

  if (gap >= TRUTH_METER_BLUFF_GAP) {
    addScore(author, TRUTH_METER_POINTS_BLUFF);
    bumpPlayerStat(author, "truthMeterBluffWins", 1);
    summary.bluffWin = true;
  } else if (gap <= TRUTH_METER_CONSENSUS_GAP) {
    addScore(author, TRUTH_METER_POINTS_CONSENSUS);
    summary.consensus = true;
  }

  let closest = null;
  let bestDist = Infinity;
  Object.entries(voterVotes).forEach(([name, v]) => {
    const d = Math.abs(v - groupAvg);
    if (d <= TRUTH_METER_CLOSE_DISTANCE) {
      addScore(name, TRUTH_METER_POINTS_CLOSE);
      summary.closeVoters.push(name);
    }
    if (d < bestDist) {
      bestDist = d;
      closest = name;
    }
  });

  if (closest) {
    addScore(closest, TRUTH_METER_POINTS_MIND_READER);
    bumpPlayerStat(closest, "truthMeterMindReaderWins", 1);
    summary.mindReader = closest;
  }

  return summary;
}

/** Dilemma : +20 pts si vote aligné avec la majorité (victoire). */
export function awardDilemmaRound(votes) {
  const { majority, divided, pctA, pctB } = countDilemmaResults(votes);
  const summary = {
    majority,
    divided,
    pctA,
    pctB,
    majorityWinners: [],
    pointsAwarded: DILEMMA_POINTS_MAJORITY_WIN,
  };

  if (!majority) return summary;

  Object.entries(votes).forEach(([name, choice]) => {
    if (choice !== "A" && choice !== "B") return;
    if (choice === majority) {
      addScore(name, DILEMMA_POINTS_MAJORITY_WIN);
      bumpPlayerStat(name, "dilemmaMajorityPicks", 1);
      summary.majorityWinners.push(name);
    } else {
      bumpPlayerStat(name, "dilemmaMinorityPicks", 1);
    }
    if (divided) bumpPlayerStat(name, "dilemmaChaosRounds", 1);
  });

  return summary;
}
