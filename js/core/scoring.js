import { EVENING_POINTS, FIL_ROUGE_POINTS, tierNightPointsForRankDiff } from "../../data/eveningScoring.js";
import { PLAYLIST_GUESS_POINTS } from "../../data/playlistGuess.js";
import { CLUTCH_PODIUM_POINTS } from "../../data/clutch.js";
import { WRONG_ANSWER_PODIUM_POINTS } from "../../data/wrongAnswer.js";
import { computeWrongAnswerRoundAward } from "./wrongAnswerScoring.js";
import { filterVoterVotes, computeRoundMetrics } from "./truthMeterSession.js";
import { countDilemmaResults } from "./dilemmaSession.js";
import { DILEMMA_POINTS_MAJORITY_WIN, DILEMMA_POINTS_TIE } from "../../data/dilemma.js";
import { HOT_TAKE_POINTS_TIE } from "../../data/hotTakes.js";
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
    tieWinners: [],
    pointsAwarded: false,
  };

  if (tied) {
    summary.pointsAwarded = true;
    const deltas = {};
    Object.entries(votes).forEach(([name, choice]) => {
      if (!choice) return;
      addScore(name, HOT_TAKE_POINTS_TIE);
      summary.tieWinners.push(name);
      deltas[name] = HOT_TAKE_POINTS_TIE;
    });
    summary.deltas = deltas;
    return summary;
  }

  if (!majority) return summary;

  summary.pointsAwarded = true;
  const deltas = {};
  Object.entries(votes).forEach(([name, choice]) => {
    if (choice === majority) {
      addScore(name, EVENING_POINTS.WIN);
      bumpPlayerStat(name, "hotTakeMajorityWins", 1);
      summary.majorityWinners.push(name);
      deltas[name] = EVENING_POINTS.WIN;
    } else {
      addScore(name, EVENING_POINTS.BONUS);
      bumpPlayerStat(name, "hotTakeDissentWins", 1);
      summary.dissenters.push(name);
      deltas[name] = EVENING_POINTS.BONUS;
    }
  });
  summary.deltas = deltas;

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
  const deltas = {};
  winners.forEach((name) => {
    addScore(name, pointsAwarded);
    deltas[name] = pointsAwarded;
  });

  return { counts, winners, maxVotes: max, pointsAwarded, deltas };
}

/**
 * Clutch : le podium de la manche reçoit 15 / 10 / 5. Les non-tappeurs : 0.
 * `ranking` doit déjà être trié (plus proche de la cible d'abord, égalité = tap le plus tôt).
 */
export function awardClutchRound(ranking = [], { podiumPoints = CLUTCH_PODIUM_POINTS } = {}) {
  const deltas = {};
  let podiumIdx = 0;
  ranking.forEach((entry) => {
    if (!entry.tapped) return;
    const pts = podiumPoints[podiumIdx];
    podiumIdx += 1;
    if (pts == null) return;
    addScore(entry.name, pts);
    deltas[entry.name] = pts;
  });
  return { ranking, deltas };
}

export { rankWrongAnswerResults } from "./wrongAnswerScoring.js";

/**
 * Wrong Answer Only : podium de la manche 15 / 10 / 5 pour le top 3 (votes reçus).
 * `answers` = { [name]: { text, at? } } ; `votes` = { [voter]: targetName }.
 */
export function awardWrongAnswerRound(
  answers = {},
  votes = {},
  { podiumPoints = WRONG_ANSWER_PODIUM_POINTS } = {}
) {
  const award = computeWrongAnswerRoundAward(answers, votes, { podiumPoints });
  Object.entries(award.deltas).forEach(([name, pts]) => {
    addScore(name, pts);
  });
  return award;
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
    deltas: {},
  };

  if (gap >= TRUTH_METER_BLUFF_GAP) {
    addScore(author, EVENING_POINTS.BONUS);
    bumpPlayerStat(author, "truthMeterBluffWins", 1);
    summary.bluffWin = true;
    summary.authorPoints = EVENING_POINTS.BONUS;
    summary.deltas[author] = EVENING_POINTS.BONUS;
  } else if (gap <= TRUTH_METER_CONSENSUS_GAP) {
    addScore(author, EVENING_POINTS.WIN);
    summary.consensus = true;
    summary.authorPoints = EVENING_POINTS.WIN;
    summary.deltas[author] = EVENING_POINTS.WIN;
  }

  let closest = [];
  let bestDist = Infinity;
  Object.entries(voterVotes).forEach(([name, v]) => {
    const d = Math.abs(v - groupAvg);
    if (d < bestDist - 1e-9) {
      bestDist = d;
      closest = [name];
    } else if (Math.abs(d - bestDist) < 1e-9) {
      closest.push(name);
    }
  });

  if (closest.length) {
    const pts =
      bestDist <= TRUTH_METER_CLOSE_DISTANCE ? EVENING_POINTS.BONUS : EVENING_POINTS.WIN;
    closest.forEach((name) => {
      addScore(name, pts);
      summary.deltas[name] = (summary.deltas[name] || 0) + pts;
      if (bestDist <= TRUTH_METER_CLOSE_DISTANCE) {
        summary.closeVoters.push(name);
      }
      if (pts === EVENING_POINTS.BONUS) {
        bumpPlayerStat(name, "truthMeterMindReaderWins", 1);
      }
    });
    summary.mindReader = closest[0];
    summary.voterPoints = pts;
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
    tie: false,
    majorityWinners: [],
    tieWinners: [],
    pointsAwarded: DILEMMA_POINTS_MAJORITY_WIN,
    deltas: {},
  };

  if (!majority) {
    summary.tie = true;
    summary.pointsAwarded = DILEMMA_POINTS_TIE;
    Object.entries(votes).forEach(([name, choice]) => {
      if (choice !== "A" && choice !== "B") return;
      addScore(name, DILEMMA_POINTS_TIE);
      summary.tieWinners.push(name);
      summary.deltas[name] = DILEMMA_POINTS_TIE;
      if (divided) bumpPlayerStat(name, "dilemmaChaosRounds", 1);
    });
    return summary;
  }

  Object.entries(votes).forEach(([name, choice]) => {
    if (choice !== "A" && choice !== "B") return;
    if (choice === majority) {
      addScore(name, DILEMMA_POINTS_MAJORITY_WIN);
      bumpPlayerStat(name, "dilemmaMajorityPicks", 1);
      summary.majorityWinners.push(name);
      summary.deltas[name] = DILEMMA_POINTS_MAJORITY_WIN;
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

/** MOT INTERDIT (Fil Rouge) - désactivé, voir data/filRouge.js */
export function awardFilRougeMission(agentName) {
  // addFilRougeScore(agentName, FIL_ROUGE_POINTS.MISSION);
  // bumpPlayerStat(agentName, "filRougeMissionsValidated", 1);
  void agentName;
  return { points: 0 };
}
