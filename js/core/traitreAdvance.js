/**
 * Transitions Spot the Fake — contrat partagé par les tests et par
 * `advance_traitre_play` (supabase/feature-traitre-01-advance-play.sql).
 *
 * Le client multijoueur n'applique pas ce résultat en local : il envoie
 * l'action et les gardes (phase, tour, paire, effectif). Le serveur relit
 * `traitre_private` pour savoir qui est le fake. `impostorName` n'est jamais
 * un argument de la requête.
 */
import {
  buildTraitreEliminationPatch,
  buildTraitreTieSpeakPatch,
  computeTraitreScoreDeltas,
} from "./traitreScoring.js";

/** Votes déjà traduits en pseudos. Le serveur fait la traduction uid → pseudo. */
function namedVotes(votes = {}, alive = []) {
  const out = {};
  alive.forEach((name) => {
    const target = votes[name];
    if (target && alive.includes(target)) out[name] = target;
  });
  return out;
}

function countNamedVotes(votes = {}, alive = []) {
  const normalized = namedVotes(votes, alive);
  const counts = {};
  alive.forEach((name) => {
    const target = normalized[name];
    if (!target) return;
    counts[target] = (counts[target] || 0) + 1;
  });
  let max = 0;
  Object.values(counts).forEach((n) => {
    if (n > max) max = n;
  });
  const leaders = Object.entries(counts)
    .filter(([, n]) => n === max && max > 0)
    .map(([name]) => name);
  return { leaders, isTie: leaders.length > 1, votedCount: Object.keys(normalized).length };
}

export const TRAITRE_ADVANCE_ACTIONS = Object.freeze([
  "deal_to_speak",
  "finish_speak",
  "continue_speak",
  "start_vote",
  "resolve_vote",
]);

function aliveCountOf(session) {
  return (session?.alive || []).length;
}

function dealAcksComplete(session) {
  const alive = session?.alive || [];
  return alive.length > 0 && alive.every((name) => session.dealAcks?.[name]);
}

function withoutImpostorName(session) {
  if (!session || !Object.prototype.hasOwnProperty.call(session, "impostorName")) {
    return session;
  }
  const next = { ...session };
  delete next.impostorName;
  return next;
}

/**
 * @param {object} session état logique (votes et listes par pseudo)
 * @param {{ action: string, expectedPhase: string|null, expectedSpeakRound: number, expectedPairId: string|null, expectedAliveCount: number, force?: boolean }} request
 * @param {{ impostorName?: string|null }} [context] identité du fake, connue du serveur seulement
 */
export function resolveTraitreAdvance(session, request, context = {}) {
  const action = request?.action;
  const expectedPhase = request?.expectedPhase ?? null;
  const expectedSpeakRound = Number(request?.expectedSpeakRound ?? 1);
  const expectedPairId = request?.expectedPairId ?? null;
  const expectedAliveCount = Number(
    request?.expectedAliveCount ?? aliveCountOf(session)
  );
  const force = request?.force === true;
  const impostorName = context?.impostorName || null;
  const expectedMatchId = request?.expectedMatchId || null;
  const blobMatchId = session?.matchId || null;
  if (!blobMatchId || !expectedMatchId || blobMatchId !== expectedMatchId) {
    return { kind: "rejected", reason: "TRAITRE_STALE_MATCH", session };
  }

  if (!TRAITRE_ADVANCE_ACTIONS.includes(action)) {
    return { kind: "rejected", reason: "TRAITRE_BAD_ACTION", session };
  }
  if (!session || session.pairId !== expectedPairId) {
    return { kind: "stale", reason: "TRAITRE_STALE_PHASE", session };
  }

  const phase = session.phase ?? null;
  const speakRound = session.speakRound ?? 1;
  const aliveCount = aliveCountOf(session);

  const idempotent = () => ({ kind: "idempotent", session, eveningDeltas: null });
  const stale = () => ({ kind: "stale", reason: "TRAITRE_STALE_PHASE", session });
  const rejected = (reason) => ({ kind: "rejected", reason, session });
  const applied = (next, eveningDeltas = null) => ({
    kind: "applied",
    session: next,
    eveningDeltas,
  });

  if (action === "deal_to_speak") {
    if (
      expectedPhase === "deal" &&
      phase === "speak" &&
      speakRound === expectedSpeakRound &&
      !(session.eliminated || []).length &&
      !session.lastEliminated
    ) {
      return idempotent();
    }
    if (phase !== "deal" || expectedPhase !== "deal" || speakRound !== expectedSpeakRound) {
      return stale();
    }
    if (!dealAcksComplete(session)) return rejected("TRAITRE_WAITING_ACKS");
    return applied(withoutImpostorName({ ...session, phase: "speak", speakerIndex: 0 }));
  }

  if (action === "finish_speak") {
    if (expectedPhase !== "speak") return stale();
    if (phase === "speak" && speakRound === expectedSpeakRound) {
      if (speakRound === 1) {
        return applied(
          withoutImpostorName({
            ...session,
            phase: "decision",
            speakerIndex: 0,
            lastEliminated: null,
          })
        );
      }
      return applied(
        withoutImpostorName({
          ...session,
          phase: "vote",
          speakerIndex: 0,
          lastEliminated: null,
          votes: {},
          revotePending: false,
          revoteCount: 0,
          tieAfterVote: false,
        })
      );
    }
    if (expectedSpeakRound === 1 && phase === "decision" && speakRound === 1) {
      return idempotent();
    }
    if (expectedSpeakRound > 1 && phase === "vote" && speakRound === expectedSpeakRound) {
      return idempotent();
    }
    return stale();
  }

  if (action === "continue_speak") {
    if (expectedPhase !== "decision") return stale();
    if (phase === "decision" && speakRound === expectedSpeakRound) {
      return applied(
        withoutImpostorName({
          ...session,
          phase: "speak",
          speakRound: speakRound + 1,
          speakerIndex: 0,
        })
      );
    }
    if (phase === "speak" && speakRound === expectedSpeakRound + 1) return idempotent();
    return stale();
  }

  if (action === "start_vote") {
    if (expectedPhase !== "decision") return stale();
    if (phase === "decision" && speakRound === expectedSpeakRound) {
      return applied(
        withoutImpostorName({
          ...session,
          phase: "vote",
          votes: {},
          revotePending: false,
          revoteCount: 0,
          tieAfterVote: false,
        })
      );
    }
    if (phase === "vote" && speakRound === expectedSpeakRound) return idempotent();
    return stale();
  }

  if (phase === "vote" && speakRound === expectedSpeakRound && aliveCount === expectedAliveCount && expectedPhase === "vote") {
    const alive = session.alive || [];
    const votes = session.votes || {};
    const { leaders, isTie, votedCount } = countNamedVotes(votes, alive);
    if (!force && votedCount !== alive.length) return rejected("TRAITRE_VOTES_INCOMPLETE");
    if (votedCount === 0) return rejected("TRAITRE_NO_VOTES");
    if (!impostorName) return rejected("TRAITRE_ROLE_MISSING");
    if (isTie) {
      return applied(withoutImpostorName({ ...session, ...buildTraitreTieSpeakPatch(session) }));
    }
    if (!leaders.length) return rejected("TRAITRE_NO_MAJORITY");
    const patch = buildTraitreEliminationPatch(
      { ...session, impostorName, votes },
      leaders[0]
    );
    const merged = { ...session, ...patch, impostorName };
    if (merged.phase !== "final") {
      return applied(withoutImpostorName(merged));
    }
    const scored = computeTraitreScoreDeltas(merged);
    const finalSession = {
      ...merged,
      impostorName,
      impostorRevealed: true,
      scoresApplied: true,
      lastRound: scored,
    };
    return applied(finalSession, scored.deltas || {});
  }

  if (
    expectedPhase === "vote" &&
    phase === "speak" &&
    speakRound === expectedSpeakRound + 1 &&
    session.tieAfterVote &&
    aliveCount === expectedAliveCount
  ) {
    return idempotent();
  }
  if (
    expectedPhase === "vote" &&
    phase === "speak" &&
    speakRound === expectedSpeakRound + 1 &&
    !session.tieAfterVote &&
    aliveCount === expectedAliveCount - 1 &&
    session.lastEliminated
  ) {
    return idempotent();
  }
  if (
    expectedPhase === "vote" &&
    phase === "final" &&
    session.impostorRevealed &&
    session.scoresApplied &&
    session.pairId === expectedPairId &&
    speakRound === expectedSpeakRound &&
    aliveCount === expectedAliveCount - 1
  ) {
    return idempotent();
  }
  return stale();
}

/** Arguments RPC. Aucun champ privé. */
export function traitreAdvanceRpcArgs(session, action, { force = false } = {}) {
  return {
    action,
    expectedMatchId: session?.matchId ?? null,
    expectedPhase: session?.phase ?? null,
    expectedSpeakRound: session?.speakRound ?? 1,
    expectedPairId: session?.pairId ?? null,
    expectedAliveCount: aliveCountOf(session),
    force: action === "resolve_vote" && force === true,
  };
}

function advanceErrorCode(error) {
  const message = String(error?.message || error || "");
  const match = message.match(/TRAITRE_[A-Z_]+/);
  return match ? match[0] : "";
}

const QUIET_CODES = new Set([
  "TRAITRE_STALE_PHASE",
  "TRAITRE_VOTES_INCOMPLETE",
  "TRAITRE_WAITING_ACKS",
  "TRAITRE_NO_VOTES",
  "TRAITRE_NO_MAJORITY",
]);

function advanceErrorText(code) {
  if (code === "TRAITRE_ROLE_MISSING") {
    return "Les rôles secrets de cette manche sont introuvables. La résolution est annulée.";
  }
  if (code === "TRAITRE_WAITING_ACKS") {
    return "Tout le monde n'a pas encore mémorisé son mot.";
  }
  if (code === "TRAITRE_VOTES_INCOMPLETE" || code === "TRAITRE_NO_VOTES") {
    return "Il manque encore des votes pour clôturer.";
  }
  if (code === "TRAITRE_STALE_PHASE") {
    return "La manche a déjà avancé sur un autre téléphone.";
  }
  return "Impossible de faire avancer la manche. Réessaie.";
}

/**
 * Multijoueur : transition autorisée par `advance_traitre_play`.
 * Pas d'écriture locale préalable. Un retry après timeout retombe sur
 * l'état serveur (idempotent), sans second scoring.
 */
export async function commitTraitreAdvance(action, { force = false, quiet = false } = {}) {
  const { getTraitreSession } = await import("./traitreSession.js");
  const { getState } = await import("./state.js");
  const session = getTraitreSession();
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return { ok: false, reason: "no_lobby", session };

  const args = traitreAdvanceRpcArgs(session, action, { force });
  try {
    const { rpcAdvanceTraitrePlay } = await import("./gameSessionRpc.js");
    const { applyRemoteSession } = await import("./gameSync.js");
    const row = await rpcAdvanceTraitrePlay({
      lobbyId,
      ...args,
      matchId: args.expectedMatchId,
    });
    if (!row) return { ok: false, reason: "rpc_failed", session: getTraitreSession() };
    applyRemoteSession(row);
    return { ok: true, reason: null, session: getTraitreSession() };
  } catch (error) {
    const code = advanceErrorCode(error);
    const beforePhase = session.phase;
    const beforeRound = session.speakRound ?? 1;
    const beforeScores = Boolean(session.scoresApplied);
    try {
      const { refreshGameSession } = await import("./gameSync.js");
      await refreshGameSession();
    } catch {
      /* la prochaine notification realtime rattrape */
    }
    const after = getTraitreSession();
    if (code === "TRAITRE_STALE_MATCH") {
      return { ok: false, reason: code, session: after };
    }
    const moved =
      after.phase !== beforePhase ||
      (after.speakRound ?? 1) !== beforeRound ||
      (Boolean(after.scoresApplied) && !beforeScores);
    if (!quiet && !moved && !QUIET_CODES.has(code)) {
      try {
        const { showAppAlert } = await import("./dialog.js");
        await showAppAlert(advanceErrorText(code), { title: "Spot the fake", icon: "🎭" });
      } catch {
        /* alerte optionnelle */
      }
    }
    return {
      ok: moved,
      reason: moved ? null : code || "rpc_failed",
      session: after,
    };
  }
}
