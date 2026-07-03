import { TRAITRE_POINTS } from "../../data/traitre.js";

function normalizeRoundVotes(votes = {}, alive = []) {
  const out = {};
  alive.forEach((name) => {
    const target = votes[name];
    if (target && alive.includes(target)) out[name] = target;
  });
  Object.entries(votes).forEach(([voter, target]) => {
    if (alive.includes(voter) && alive.includes(target)) out[voter] = target;
  });
  return out;
}

export function buildTraitreEliminationPatch(session, eliminatedName) {
  const impostor = session.impostorName;
  const aliveBefore = session.alive || [];
  const votes = normalizeRoundVotes(session.votes || {}, aliveBefore);
  const newEliminated = [...(session.eliminated || []), eliminatedName];
  const newAlive = aliveBefore.filter((n) => n !== eliminatedName);
  const intuitionAwards = { ...(session.intuitionAwards || {}) };

  if (eliminatedName !== impostor && votes[eliminatedName] === impostor) {
    intuitionAwards[eliminatedName] =
      (intuitionAwards[eliminatedName] || 0) + TRAITRE_POINTS.GOOD_INTUITION;
  }

  const base = {
    eliminated: newEliminated,
    alive: newAlive,
    lastEliminated: eliminatedName,
    votes: {},
    revotePending: false,
    revoteCount: 0,
    tieAfterVote: false,
    intuitionAwards,
  };

  if (eliminatedName === impostor) {
    return {
      ...base,
      phase: "final",
      impostorRevealed: true,
      winner: "civilians",
      lastVoteSnapshot: votes,
    };
  }

  if (newAlive.length <= 2 && newAlive.includes(impostor)) {
    return {
      ...base,
      phase: "final",
      impostorRevealed: true,
      winner: "traitre",
    };
  }

  return {
    ...base,
    phase: "speak",
    speakRound: (session.speakRound || 1) + 1,
    speakerIndex: 0,
    voteSurvivals: (session.voteSurvivals || 0) + 1,
  };
}

/** Calcule les points de fin de partie (pur, testable). */
export function computeTraitreScoreDeltas(session) {
  const impostor = session.impostorName;
  const deltas = {};
  const breakdown = {};

  const add = (name, pts, label) => {
    if (!name || pts <= 0) return;
    deltas[name] = (deltas[name] || 0) + pts;
    if (!breakdown[name]) breakdown[name] = [];
    breakdown[name].push({ label, pts });
  };

  if (!impostor) {
    return { deltas, breakdown, winner: session.winner, impostorName: impostor, voteSurvivals: 0 };
  }

  const voteSurvivals = session.voteSurvivals || 0;

  if (session.winner === "traitre") {
    add(impostor, TRAITRE_POINTS.FAKE_WIN, "Victoire fake");
    if (voteSurvivals > 0) {
      add(impostor, voteSurvivals * TRAITRE_POINTS.FAKE_SURVIVE_VOTE, "Votes survécus");
    }
  } else if (session.winner === "civilians") {
    if (voteSurvivals > 0) {
      add(impostor, voteSurvivals * TRAITRE_POINTS.FAKE_SURVIVE_VOTE, "Votes survécus");
    }

    const survivors = session.alive || [];
    survivors.forEach((name) => add(name, TRAITRE_POINTS.SURVIVOR, "Survivant"));

    const voterPool = [
      ...survivors,
      ...(session.eliminated || []),
      session.lastEliminated,
      impostor,
    ].filter(Boolean);
    const snapshot = normalizeRoundVotes(session.lastVoteSnapshot || {}, [
      ...new Set(voterPool),
    ]);
    Object.entries(snapshot).forEach(([name, target]) => {
      if (target !== impostor || !survivors.includes(name)) return;
      add(name, TRAITRE_POINTS.DETECTIVE_BONUS, "Détective");
    });
  }

  Object.entries(session.intuitionAwards || {}).forEach(([name, pts]) => {
    if (pts > 0) add(name, pts, "Bonne intuition");
  });

  return {
    deltas,
    breakdown,
    winner: session.winner,
    impostorName: impostor,
    voteSurvivals,
    pairId: session.pairId,
  };
}
