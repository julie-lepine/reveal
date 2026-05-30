import { EVENING_POINTS, FIL_ROUGE_POINTS, tierNightPointsForRankDiff } from "../../data/eveningScoring.js";
import { PLAYLIST_GUESS_POINTS } from "../../data/playlistGuess.js";
import { filterVoterVotes, computeRoundMetrics } from "./truthMeterSession.js";
import { countDilemmaResults } from "./dilemmaSession.js";
import {
  TRUTH_METER_BLUFF_GAP,
  TRUTH_METER_CONSENSUS_GAP,
  TRUTH_METER_CLOSE_DISTANCE,
} from "../../data/truthMeter.js";
import { addScore, addFilRougeScore, bumpPlayerStat } from "./state.js";
import { getMajorityOption } from "./hotTakeSession.js";

export { EVENING_POINTS, FIL_ROUGE_POINTS, tierNightPointsForRankDiff };

export function awardHotTakeVotes(votes, options) {
  const { majority, tied, counts } = getMajorityOption(votes, options);
  const summary = {
    majority,
    tied: Boolean(tied),
    counts,
    dissenters: [],
    majorityWinners: [],
    pointsAwarded: false,
  };

  if (!majority || tied) return summary;

  summary.pointsAwarded = true;
  Object.entries(votes).forEach(([name, choice]) => {
    if (choice === majority) {
      addScore(name, EVENING_POINTS.WIN);
      bumpPlayerStat(name, "hotTakeMajorityWins", 1);
      summary.majorityWinners.push(name);
    } else {
      addScore(name, EVENING_POINTS.BONUS);
      bumpPlayerStat(name, "hotTakeDissentWins", 1);
      summary.dissenters.push(name);
    }
  });

  return summary;
}

/** Joueur(s) le plus voté(s) : +10 (×2 si modificateur). Les autres : 0. */
export function awardSpeedVoteRound(votes, { multiplier = 1 } = {}) {
  const counts = {};
  Object.values(votes).forEach((target) => {
    if (!target) return;
    counts[target] = (counts[target] || 0) + 1;
  });

  let max = 0;
  Object.values(counts).forEach((n) => {
    if (n > max) max = n;
  });

  const winners =
    max > 0
      ? Object.entries(counts)
          .filter(([, n]) => n === max)
          .map(([name]) => name)
      : [];

  const pointsAwarded = EVENING_POINTS.WIN * multiplier;
  winners.forEach((name) => addScore(name, pointsAwarded));

  return { counts, winners, maxVotes: max, pointsAwarded };
}

/** TruthMeter : au plus un bonus par joueur et par manche. */
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
    authorPoints: 0,
    voterPoints: 0,
  };

  if (gap >= TRUTH_METER_BLUFF_GAP) {
    addScore(author, EVENING_POINTS.BONUS);
    bumpPlayerStat(author, "truthMeterBluffWins", 1);
    summary.bluffWin = true;
    summary.authorPoints = EVENING_POINTS.BONUS;
  } else if (gap <= TRUTH_METER_CONSENSUS_GAP) {
    addScore(author, EVENING_POINTS.WIN);
    summary.consensus = true;
    summary.authorPoints = EVENING_POINTS.WIN;
  }

  let closest = null;
  let bestDist = Infinity;
  Object.entries(voterVotes).forEach(([name, v]) => {
    const d = Math.abs(v - groupAvg);
    if (d < bestDist) {
      bestDist = d;
      closest = name;
    }
  });

  if (closest) {
    const pts =
      bestDist <= TRUTH_METER_CLOSE_DISTANCE ? EVENING_POINTS.BONUS : EVENING_POINTS.WIN;
    addScore(closest, pts);
    summary.mindReader = closest;
    summary.voterPoints = pts;
    if (bestDist <= TRUTH_METER_CLOSE_DISTANCE) {
      summary.closeVoters.push(closest);
    }
    if (pts === EVENING_POINTS.BONUS) {
      bumpPlayerStat(closest, "truthMeterMindReaderWins", 1);
    }
  }

  return summary;
}

export function awardDilemmaRound(votes) {
  const { majority, divided, pctA, pctB } = countDilemmaResults(votes);
  const summary = {
    majority,
    divided,
    pctA,
    pctB,
    majorityWinners: [],
    pointsAwarded: EVENING_POINTS.WIN,
  };

  if (!majority) return summary;

  Object.entries(votes).forEach(([name, choice]) => {
    if (choice !== "A" && choice !== "B") return;
    if (choice === majority) {
      addScore(name, EVENING_POINTS.WIN);
      bumpPlayerStat(name, "dilemmaMajorityPicks", 1);
      summary.majorityWinners.push(name);
    } else {
      bumpPlayerStat(name, "dilemmaMinorityPicks", 1);
    }
    if (divided) bumpPlayerStat(name, "dilemmaChaosRounds", 1);
  });

  return summary;
}

/**
 * VibeCheck - les joueurs votent à qui la chanson correspond le mieux.
 * Le(s) plus voté(s) gagnent MOST_VOTED. Tout joueur ayant voté pour un
 * plus-voté (majorité) gagne MAJORITY. Les deux peuvent se cumuler.
 */
export function awardPlaylistGuessRound({ votesByUid, resolveName }) {
  const nameFor = (uid) => (resolveName ? resolveName(uid) : uid);
  const entries = Object.entries(votesByUid || {}).filter(([, pick]) => pick != null && pick !== "");

  const counts = {};
  entries.forEach(([, pick]) => {
    counts[pick] = (counts[pick] || 0) + 1;
  });

  let maxVotes = 0;
  Object.values(counts).forEach((n) => {
    if (n > maxVotes) maxVotes = n;
  });
  const leaders = Object.entries(counts)
    .filter(([, n]) => n === maxVotes && maxVotes > 0)
    .map(([uid]) => uid);
  const leaderSet = new Set(leaders);

  leaders.forEach((uid) => addScore(nameFor(uid), PLAYLIST_GUESS_POINTS.MOST_VOTED));

  const majorityVoterUids = entries
    .filter(([, pick]) => leaderSet.has(pick))
    .map(([voterUid]) => voterUid);
  majorityVoterUids.forEach((uid) => addScore(nameFor(uid), PLAYLIST_GUESS_POINTS.MAJORITY));

  return {
    counts,
    leaders,
    maxVotes,
    totalVotes: entries.length,
    winnerNames: leaders.map((uid) => nameFor(uid)),
    majorityVoterUids,
    mostVotedPoints: PLAYLIST_GUESS_POINTS.MOST_VOTED,
    majorityPoints: PLAYLIST_GUESS_POINTS.MAJORITY,
  };
}

export function awardGuessLieRound({ correct, liarName, liarBonus }) {
  correct.forEach((name) => {
    addScore(name, EVENING_POINTS.WIN);
    bumpPlayerStat(name, "liesDetected", 1);
  });
  if (liarBonus && liarName) {
    addScore(liarName, EVENING_POINTS.BONUS);
    bumpPlayerStat(liarName, "liesFooled", 1);
  }
  return {
    detectivePoints: EVENING_POINTS.WIN,
    liarPoints: liarBonus && liarName ? EVENING_POINTS.BONUS : 0,
  };
}

/** Mensonge non trouvé par la majorité des détectives → bonus menteur. */
export function guessLieLiarWins(correctCount, voterCount) {
  if (voterCount <= 0) return true;
  return correctCount * 2 < voterCount;
}

export function awardFilRougeMission(agentName) {
  addFilRougeScore(agentName, FIL_ROUGE_POINTS.MISSION);
  bumpPlayerStat(agentName, "filRougeMissionsValidated", 1);
  return { points: FIL_ROUGE_POINTS.MISSION };
}
