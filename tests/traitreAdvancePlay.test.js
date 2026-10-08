/**
 * Spot the Fake — acting host.
 * Le résolveur pur est le contrat de advance_traitre_play.
 * Le SQL n'est pas exécuté ici : le fichier est vérifié comme contrat.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pickRemotePlayFields } from "../js/core/playPatch.js";
import { validateActingHostPlayPatch } from "../js/core/gameSessionSecurity.js";
import { TRAITRE_POINTS } from "../data/traitre.js";
import {
  resolveTraitreAdvance,
  traitreAdvanceRpcArgs,
} from "../js/core/traitreAdvance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function session(overrides = {}) {
  return {
    matchId: "match-a",
    pairId: "social_1",
    phase: "deal",
    speakRound: 1,
    speakerIndex: 0,
    alive: ["Alice", "Bob", "Chloé"],
    eliminated: [],
    votes: {},
    dealAcks: {},
    revotePending: false,
    revoteCount: 0,
    tieAfterVote: false,
    voteSurvivals: 0,
    intuitionAwards: {},
    impostorRevealed: false,
    winner: null,
    scoresApplied: false,
    lastEliminated: null,
    ...overrides,
  };
}

function request(current, action, extra = {}) {
  return {
    action,
    expectedMatchId: current.matchId,
    expectedPhase: current.phase,
    expectedSpeakRound: current.speakRound ?? 1,
    expectedPairId: current.pairId,
    expectedAliveCount: (current.alive || []).length,
    force: false,
    ...extra,
  };
}

describe("hypothèse A — patch de session trop large", () => {
  it("refuse pairId, alive, speakRound, speakerIndex et impostorRevealed", () => {
    const remote = {
      phase: "speak",
      pairId: "social_1",
      speakRound: 1,
      speakerIndex: 0,
      alive: ["Alice", "Bob", "Chloé"],
      eliminated: [],
      votes: {},
      dealAcks: { Alice: true },
      revotePending: false,
      revoteCount: 0,
      tieAfterVote: false,
      voteSurvivals: 0,
      lastVoteSnapshot: null,
      lastEliminated: null,
      intuitionAwards: {},
      impostorRevealed: false,
      winner: null,
      scoresApplied: false,
      lastRound: null,
    };
    const patch = pickRemotePlayFields(remote, { ...remote, phase: "speak" });
    assert.equal(patch.phase, "speak");
    assert.equal(patch.pairId, "social_1");
    assert.deepEqual(patch.alive, remote.alive);
    assert.equal(patch.speakRound, 1);
    assert.equal(patch.speakerIndex, 0);
    assert.equal(patch.impostorRevealed, false);
    const verdict = validateActingHostPlayPatch(patch);
    assert.equal(verdict.ok, false);
    assert.ok(
      ["pairId", "speakRound", "speakerIndex", "alive", "impostorRevealed"].includes(verdict.key)
    );
  });
});

describe("transitions d'acting host", () => {
  it("deal vers speak, puis retry idempotent", () => {
    const current = session({
      dealAcks: { Alice: true, Bob: true, Chloé: true },
    });
    const asked = request(current, "deal_to_speak");
    const first = resolveTraitreAdvance(current, asked);
    assert.equal(first.kind, "applied");
    assert.equal(first.session.phase, "speak");
    assert.equal(first.session.speakerIndex, 0);
    assert.equal(current.phase, "deal");
    assert.equal(Object.hasOwn(first.session, "impostorName"), false);
    const retry = resolveTraitreAdvance(first.session, asked);
    assert.equal(retry.kind, "idempotent");
    assert.equal(retry.eveningDeltas, null);
    assert.equal(retry.session.phase, "speak");
  });

  it("ack manquant : aucun changement", () => {
    const current = session({ dealAcks: { Alice: true, Bob: true } });
    const result = resolveTraitreAdvance(current, request(current, "deal_to_speak"));
    assert.equal(result.kind, "rejected");
    assert.equal(result.reason, "TRAITRE_WAITING_ACKS");
    assert.equal(result.session, current);
  });

  it("fin du premier tour vers la décision, retry idempotent", () => {
    const current = session({ phase: "speak", speakRound: 1, lastEliminated: "Chloé" });
    const asked = request(current, "finish_speak");
    const first = resolveTraitreAdvance(current, asked);
    assert.equal(first.kind, "applied");
    assert.equal(first.session.phase, "decision");
    assert.equal(first.session.lastEliminated, null);
    const retry = resolveTraitreAdvance(first.session, asked);
    assert.equal(retry.kind, "idempotent");
    assert.equal(retry.session.phase, "decision");
  });

  it("fin d'un tour suivant ouvre le vote sans effacer les votes au retry", () => {
    const current = session({ phase: "speak", speakRound: 2 });
    const asked = request(current, "finish_speak");
    const first = resolveTraitreAdvance(current, asked);
    assert.equal(first.session.phase, "vote");
    assert.deepEqual(first.session.votes, {});
    const withVotes = { ...first.session, votes: { Alice: "Bob", Bob: "Alice" } };
    const retry = resolveTraitreAdvance(withVotes, asked);
    assert.equal(retry.kind, "idempotent");
    assert.deepEqual(retry.session.votes, withVotes.votes);
  });

  it("continuer la discussion, puis un vote lancé trop tard est périmé", () => {
    const current = session({ phase: "decision", speakRound: 1 });
    const asked = request(current, "continue_speak");
    const first = resolveTraitreAdvance(current, asked);
    assert.equal(first.session.phase, "speak");
    assert.equal(first.session.speakRound, 2);
    const retry = resolveTraitreAdvance(first.session, asked);
    assert.equal(retry.kind, "idempotent");
    const lateVote = resolveTraitreAdvance(first.session, request(current, "start_vote"));
    assert.equal(lateVote.kind, "stale");
    assert.equal(lateVote.session, first.session);
  });

  it("démarrer le vote depuis la décision, retry idempotent", () => {
    const current = session({ phase: "decision", speakRound: 2, speakerIndex: 1 });
    const asked = request(current, "start_vote");
    const first = resolveTraitreAdvance(current, asked);
    assert.equal(first.session.phase, "vote");
    assert.equal(first.session.speakerIndex, 1);
    assert.deepEqual(first.session.votes, {});
    const retry = resolveTraitreAdvance(first.session, asked);
    assert.equal(retry.kind, "idempotent");
  });
});

describe("fake connu seulement du serveur", () => {
  const votes = { Alice: "Bob", Bob: "Bob", Chloé: "Bob" };

  it("sans impostorName : aucune mutation", () => {
    const current = session({ phase: "vote", votes, impostorName: null });
    const result = resolveTraitreAdvance(current, request(current, "resolve_vote"), {});
    assert.equal(result.kind, "rejected");
    assert.equal(result.reason, "TRAITRE_ROLE_MISSING");
    assert.equal(result.session, current);
    assert.equal(result.eveningDeltas, undefined);
  });

  it("civil sans impostorName local : le serveur désigne Bob", () => {
    const current = session({ phase: "vote", votes, impostorName: null });
    const result = resolveTraitreAdvance(current, request(current, "resolve_vote"), {
      impostorName: "Bob",
    });
    assert.equal(result.kind, "applied");
    assert.equal(result.session.phase, "final");
    assert.equal(result.session.winner, "civilians");
    assert.equal(result.session.impostorName, "Bob");
    assert.equal(result.session.impostorRevealed, true);
    assert.equal(current.phase, "vote");
    assert.equal(current.impostorName, null);
  });

  it("un impostorName local faux ne change pas la décision", () => {
    const civilian = session({ phase: "vote", votes, impostorName: null });
    const fakeClient = session({ phase: "vote", votes, impostorName: "Alice" });
    const server = { impostorName: "Bob" };
    const fromCivilian = resolveTraitreAdvance(civilian, request(civilian, "resolve_vote"), server);
    const fromFake = resolveTraitreAdvance(fakeClient, request(fakeClient, "resolve_vote"), server);
    assert.equal(fromCivilian.session.winner, fromFake.session.winner);
    assert.equal(fromFake.session.winner, "civilians");
    assert.equal(fromFake.session.impostorName, "Bob");
    assert.deepEqual(fromCivilian.eveningDeltas, fromFake.eveningDeltas);
  });

  it("éliminer un civil quand le fake est Bob fait gagner le fake", () => {
    const current = session({
      phase: "vote",
      impostorName: null,
      votes: { Alice: "Chloé", Bob: "Alice", Chloé: "Alice" },
    });
    const result = resolveTraitreAdvance(current, request(current, "resolve_vote"), {
      impostorName: "Bob",
    });
    assert.equal(result.session.phase, "final");
    assert.equal(result.session.winner, "traitre");
    assert.equal(result.session.impostorName, "Bob");
    assert.equal(result.eveningDeltas.Bob, TRAITRE_POINTS.FAKE_WIN);
    assert.equal(result.eveningDeltas.Chloé, undefined);
  });
});

describe("scoring après confirmation", () => {
  it("une finale renvoie les points une fois ; le retry n'en renvoie plus", () => {
    const current = session({
      phase: "vote",
      voteSurvivals: 1,
      intuitionAwards: { Chloé: TRAITRE_POINTS.GOOD_INTUITION },
      eliminated: ["Chloé"],
      alive: ["Alice", "Bob"],
      votes: { Alice: "Bob", Bob: "Bob" },
    });
    const asked = request(current, "resolve_vote");
    const first = resolveTraitreAdvance(current, asked, { impostorName: "Bob" });
    assert.equal(first.kind, "applied");
    assert.equal(first.session.scoresApplied, true);
    assert.equal(first.eveningDeltas.Alice, TRAITRE_POINTS.SURVIVOR + TRAITRE_POINTS.DETECTIVE_BONUS);
    assert.equal(first.eveningDeltas.Bob, TRAITRE_POINTS.FAKE_SURVIVE_VOTE);
    assert.equal(first.eveningDeltas.Chloé, TRAITRE_POINTS.GOOD_INTUITION);
    assert.equal(first.session.voteSurvivals, 1);
    const retry = resolveTraitreAdvance(first.session, asked, { impostorName: "Bob" });
    assert.equal(retry.kind, "idempotent");
    assert.equal(retry.eveningDeltas, null);
    assert.equal(retry.session.scoresApplied, true);
  });

  it("un rejet ne marque pas la partie comme scorée", () => {
    const current = session({
      phase: "vote",
      votes: { Alice: "Bob" },
    });
    const result = resolveTraitreAdvance(current, request(current, "resolve_vote", { force: false }));
    assert.equal(result.kind, "rejected");
    assert.equal(result.reason, "TRAITRE_VOTES_INCOMPLETE");
    assert.equal(current.scoresApplied, false);
    assert.equal(result.session, current);
  });

  it("le client de transition n'appelle pas addScore", () => {
    const src = read("js/core/traitreAdvance.js");
    const commit = src.slice(src.indexOf("export async function commitTraitreAdvance"));
    assert.doesNotMatch(commit, /addScore|awardTraitreGame|bumpPlayerStat|recordTraitrePlayed/);
    const args = src.slice(
      src.indexOf("export function traitreAdvanceRpcArgs"),
      src.indexOf("function advanceErrorCode")
    );
    assert.doesNotMatch(args, /impostorName/);
  });
});

describe("idempotence, concurrence, phase périmée", () => {
  it("la même résolution appliquée deux fois ne double pas les effets", () => {
    const current = session({
      phase: "vote",
      alive: ["Alice", "Bob", "Chloé", "Dom"],
      votes: { Alice: "Dom", Bob: "Dom", Chloé: "Dom", Dom: "Alice" },
    });
    const asked = request(current, "resolve_vote");
    const first = resolveTraitreAdvance(current, asked, { impostorName: "Bob" });
    const second = resolveTraitreAdvance(first.session, asked, { impostorName: "Bob" });
    assert.equal(first.session.phase, "speak");
    assert.equal(first.session.speakRound, 2);
    assert.equal(first.session.alive.length, 3);
    assert.equal(first.eveningDeltas, null);
    assert.equal(Object.hasOwn(first.session, "impostorName"), false);
    assert.equal(second.kind, "idempotent");
    assert.equal(second.session.speakRound, 2);
    assert.equal(second.session.alive.length, 3);
  });

  it("deux résultats successifs sur le même état de départ divergent ; le second sur l'état produit converge", () => {
    const current = session({
      phase: "vote",
      votes: { Alice: "Bob", Bob: "Bob", Chloé: "Bob" },
    });
    const asked = request(current, "resolve_vote");
    const actorA = resolveTraitreAdvance(current, asked, { impostorName: "Bob" });
    const actorB = resolveTraitreAdvance(actorA.session, asked, { impostorName: "Bob" });
    assert.equal(actorA.kind, "applied");
    assert.equal(actorB.kind, "idempotent");
    assert.equal(actorB.eveningDeltas, null);
  });

  it("une transition ancienne ne réécrit pas une phase plus récente", () => {
    const current = session({ phase: "decision", speakRound: 1 });
    const lateDeal = resolveTraitreAdvance(current, request(session(), "deal_to_speak"));
    assert.equal(lateDeal.kind, "stale");
    assert.equal(lateDeal.session, current);
    assert.equal(current.phase, "decision");
  });

  it("une autre paire est périmée", () => {
    const current = session({
      phase: "vote",
      votes: { Alice: "Bob", Bob: "Bob", Chloé: "Bob" },
    });
    const result = resolveTraitreAdvance(
      current,
      request(current, "resolve_vote", { expectedPairId: "other_pair" }),
      { impostorName: "Bob" }
    );
    assert.equal(result.kind, "stale");
    assert.equal(result.session, current);
  });

  it("égalité : nouveau tour, pas de finale, retry sans second tour", () => {
    const current = session({
      phase: "vote",
      votes: { Alice: "Bob", Bob: "Chloé", Chloé: "Alice" },
    });
    const asked = request(current, "resolve_vote");
    const first = resolveTraitreAdvance(current, asked, { impostorName: "Bob" });
    assert.equal(first.session.phase, "speak");
    assert.equal(first.session.tieAfterVote, true);
    assert.equal(first.session.speakRound, 2);
    assert.equal(first.session.alive.length, 3);
    assert.equal(first.eveningDeltas, null);
    const retry = resolveTraitreAdvance(first.session, asked, { impostorName: "Bob" });
    assert.equal(retry.kind, "idempotent");
    assert.equal(retry.session.speakRound, 2);
  });

  it("clôture forcée avec un seul vote", () => {
    const current = session({ phase: "vote", votes: { Alice: "Bob" } });
    const refused = resolveTraitreAdvance(current, request(current, "resolve_vote"));
    assert.equal(refused.reason, "TRAITRE_VOTES_INCOMPLETE");
    const forced = resolveTraitreAdvance(
      current,
      request(current, "resolve_vote", { force: true }),
      { impostorName: "Bob" }
    );
    assert.equal(forced.session.phase, "final");
    assert.equal(forced.session.winner, "civilians");
  });
});

describe("manches successives", () => {
  it("une élimination de civil puis le fake enchaînent sans rescorer la première", () => {
    const round1 = session({
      phase: "vote",
      alive: ["Alice", "Bob", "Chloé", "Dom"],
      votes: { Alice: "Dom", Bob: "Dom", Chloé: "Dom", Dom: "Bob" },
    });
    const asked1 = request(round1, "resolve_vote");
    const eliminated = resolveTraitreAdvance(round1, asked1, { impostorName: "Bob" });
    assert.equal(eliminated.session.phase, "speak");
    assert.equal(eliminated.session.speakRound, 2);
    assert.equal(eliminated.session.voteSurvivals, 1);
    assert.equal(eliminated.session.intuitionAwards.Dom, TRAITRE_POINTS.GOOD_INTUITION);
    assert.equal(eliminated.eveningDeltas, null);
    assert.equal(eliminated.session.scoresApplied, false);

    const round2 = {
      ...eliminated.session,
      phase: "vote",
      votes: { Alice: "Bob", Bob: "Bob", Chloé: "Bob" },
      tieAfterVote: false,
    };
    const asked2 = request(round2, "resolve_vote");
    const finalRound = resolveTraitreAdvance(round2, asked2, { impostorName: "Bob" });
    assert.equal(finalRound.session.phase, "final");
    assert.equal(finalRound.session.winner, "civilians");
    assert.equal(finalRound.session.voteSurvivals, 1);
    assert.equal(finalRound.eveningDeltas.Dom, TRAITRE_POINTS.GOOD_INTUITION);
    const retryOld = resolveTraitreAdvance(finalRound.session, asked1, { impostorName: "Bob" });
    assert.equal(retryOld.kind, "stale");
    const retryNew = resolveTraitreAdvance(finalRound.session, asked2, { impostorName: "Bob" });
    assert.equal(retryNew.kind, "idempotent");
    assert.equal(retryNew.eveningDeltas, null);
  });
});

describe("contrat client et SQL", () => {
  it("les arguments RPC ne contiennent pas le fake", () => {
    const args = traitreAdvanceRpcArgs(
      session({ phase: "vote", impostorName: "Bob" }),
      "resolve_vote",
      { force: true }
    );
    assert.deepEqual(Object.keys(args).sort(), [
      "action",
      "expectedAliveCount",
      "expectedMatchId",
      "expectedPairId",
      "expectedPhase",
      "expectedSpeakRound",
      "force",
    ]);
    assert.equal(args.force, true);
    assert.equal(JSON.stringify(args).includes("Bob"), false);
  });

  it("l'écran multijoueur demande la RPC et ne score qu'en solo", () => {
    const src = read("js/games/traitre.js");
    for (const action of ["deal_to_speak", "finish_speak", "continue_speak", "start_vote", "resolve_vote"]) {
      assert.match(src, new RegExp(`commitTraitreAdvance\\("${action}"`));
    }
    const resolve = src.slice(
      src.indexOf("async function resolveVoteRound"),
      src.indexOf("async function finishAndExit")
    );
    const advanceAt = resolve.indexOf('commitTraitreAdvance("resolve_vote"');
    const awardAt = resolve.indexOf("awardTraitreGame");
    assert.ok(advanceAt !== -1 && awardAt > advanceAt);
    assert.match(resolve, /if \(mp\) \{\s*await commitTraitreAdvance\("resolve_vote"/);
    assert.match(src, /commitTraitreDealAck\(/);
    assert.match(src, /commitTraitreVote\(/);
    assert.equal(src.includes("apply_acting_host_play"), false);
    const rpc = read("js/core/gameSessionRpc.js");
    const fn = rpc.slice(rpc.indexOf("export async function rpcAdvanceTraitrePlay"));
    assert.match(fn, /advance_traitre_play/);
    assert.doesNotMatch(fn, /impostorName|p_impostor/);
  });

  it("la RPC verrouille, lit traitre_private et ne score qu'une fois au reveal", () => {
    const sql = read("supabase/feature-traitre-01-advance-play.sql");
    assert.match(sql, /for update/i);
    assert.match(sql, /is_acting_host/);
    assert.match(sql, /is_lobby_host/);
    assert.match(sql, /traitre_private/);
    assert.match(sql, /is_impostor is true/);
    assert.match(sql, /TRAITRE_STALE_MATCH/);
    assert.match(sql, /TRAITRE_STALE_PHASE/);
    assert.match(sql, /p_match_id/);
    assert.match(sql, /match_id = p_match_id/);
    const matchGuard = sql.indexOf("TRAITRE_STALE_MATCH");
    const idempotent = sql.indexOf("Retry : la transition");
    const privateRead = sql.indexOf("from public.traitre_private");
    const scoreCall = sql.lastIndexOf("traitre_add_score_deltas");
    const sessionUpdate = sql.lastIndexOf("update public.game_sessions");
    assert.ok(matchGuard > 0 && matchGuard < idempotent);
    assert.ok(idempotent < privateRead);
    assert.ok(privateRead < scoreCall);
    assert.ok(scoreCall < sessionUpdate);
    assert.doesNotMatch(sql, /'matchId'\s*,\s*p_match_id/);
    assert.match(sql, /TRAITRE_ROLE_MISSING/);
    assert.match(sql, /TRAITRE_VOTES_INCOMPLETE/);
    assert.match(sql, /jsonb_array_length\(v_new_alive\) <= 2/);
    assert.match(sql, /scoresApplied', true/);
    assert.match(sql, /v_pts_win constant int := 10/);
    assert.match(sql, /v_pts_bonus constant int := 15/);
    assert.doesNotMatch(sql, /create or replace function public\.apply_acting_host_play/);
    const earlyReturn = sql.indexOf("coalesce((v_tr->>'scoresApplied')::boolean, false) is true");
    assert.ok(earlyReturn > 0 && scoreCall > earlyReturn);
    const sets = [...sql.matchAll(/'impostorName', v_impostor_name/g)];
    assert.equal(sets.length, 3);
    const firstFinal = sql.indexOf("'phase', 'final'");
    assert.ok(firstFinal > 0);
    for (const match of sets) {
      assert.ok(match.index > firstFinal);
    }
    assert.match(sql, /grant execute on function public\.advance_traitre_play/);
    assert.match(sql, /revoke all on function public\.advance_traitre_play[\s\S]*from anon/);
  });
});
