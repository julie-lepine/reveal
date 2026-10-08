/**
 * Identité de manche Spot the fake.
 * Le SQL n'est pas exécuté : les gardes sont vérifiées sur le résolveur
 * et sur le texte des fonctions. Aucune concurrence PostgreSQL ici.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MATCH_A = "11111111-1111-4111-8111-111111111111";
const MATCH_B = "22222222-2222-4222-8222-222222222222";
const PAIR = "social_1";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

let remotePrivate = false;
const privateRows = [];

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => remotePrivate,
    supabase: {
      from() {
        const filters = {};
        const api = {
          select() {
            return api;
          },
          eq(column, value) {
            filters[column] = value;
            return api;
          },
          maybeSingle() {
            if (!filters.match_id) {
              return Promise.resolve({ data: null, error: { message: "PGRST116" } });
            }
            const found = privateRows.filter((row) =>
              Object.entries(filters).every(([column, value]) => row[column] === value)
            );
            if (found.length !== 1) {
              return Promise.resolve({ data: null, error: { message: "PGRST116" } });
            }
            return Promise.resolve({ data: found[0], error: null });
          },
          upsert() {
            return Promise.resolve({ error: null });
          },
          delete() {
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
        return api;
      },
    },
  },
});

const { createStartedTraitreSession } = await import("../js/core/traitreSession.js");
const { fetchMyTraitrePrivate, hostDistributeTraitreRoles } = await import(
  "../js/core/traitrePrivate.js"
);
const { saveStatePatch } = await import("../js/core/state.js");
const { traitreToRemote, traitreFromRemote } = await import("../js/core/gameSync.js");
const { isNewTraitreGame, mergeTraitrePatchState, mergeTraitrePhase } = await import(
  "../js/core/sessionMerge.js"
);
const { resolveTraitreAdvance } = await import("../js/core/traitreAdvance.js");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function voteRequest(matchId) {
  return {
    action: "resolve_vote",
    expectedMatchId: matchId,
    expectedPhase: "vote",
    expectedSpeakRound: 1,
    expectedPairId: PAIR,
    expectedAliveCount: 3,
    force: false,
  };
}

function voteSession(matchId) {
  return {
    matchId,
    pairId: PAIR,
    phase: "vote",
    speakRound: 1,
    speakerIndex: 0,
    lobbyStarted: true,
    alive: ["Alice", "Bob", "Chloé"],
    eliminated: [],
    votes: { Alice: "Bob", Bob: "Bob", "Chloé": "Bob" },
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
  };
}

const mergeOpts = {
  mergeReadyUid: (_cur, inc) => inc?.ready || {},
  mergeVotes: (_cur, inc) => inc?.votes || {},
};

describe("matchId", () => {
  it("une nouvelle partie reçoit un UUID, la suivante un autre", () => {
    const first = createStartedTraitreSession(["Alice", "Bob", "Chloé"]);
    const second = createStartedTraitreSession(["Alice", "Bob", "Chloé"]);
    assert.equal(first.ok, true);
    assert.match(
      first.session.matchId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    assert.notEqual(first.session.matchId, second.session.matchId);
    assert.equal(first.session.privateRoleMatchId, first.session.matchId);
    const src = read("js/core/traitreSession.js");
    assert.equal(src.split("randomUUID").length - 1, 1);
  });

  it("le même UUID traverse les tours, la finale et le remote", () => {
    const started = createStartedTraitreSession(["Alice", "Bob", "Chloé"]);
    const id = started.session.matchId;
    const deal = {
      ...started.session,
      dealAcks: { Alice: true, Bob: true, "Chloé": true },
    };
    const speak = resolveTraitreAdvance(deal, {
      action: "deal_to_speak",
      expectedMatchId: id,
      expectedPhase: "deal",
      expectedSpeakRound: 1,
      expectedPairId: deal.pairId,
      expectedAliveCount: 3,
    });
    assert.equal(speak.kind, "applied");
    assert.equal(speak.session.phase, "speak");
    assert.equal(speak.session.matchId, id);

    const again = resolveTraitreAdvance(speak.session, {
      action: "deal_to_speak",
      expectedMatchId: id,
      expectedPhase: "deal",
      expectedSpeakRound: 1,
      expectedPairId: deal.pairId,
      expectedAliveCount: 3,
    });
    assert.equal(again.kind, "idempotent");
    assert.equal(again.eveningDeltas, null);
    assert.equal(again.session.speakRound, 1);

    const final = resolveTraitreAdvance(voteSession(id), voteRequest(id), { impostorName: "Bob" });
    assert.equal(final.kind, "applied");
    assert.equal(final.session.phase, "final");
    assert.equal(final.session.matchId, id);
    assert.ok(final.eveningDeltas);
    const retry = resolveTraitreAdvance(final.session, voteRequest(id), { impostorName: "Bob" });
    assert.equal(retry.kind, "idempotent");
    assert.equal(retry.eveningDeltas, null);
    assert.equal(retry.session.phase, "final");
    assert.equal(retry.session.speakRound, 1);

    const remote = traitreToRemote(final.session);
    const back = traitreFromRemote(remote);
    assert.equal(remote.matchId, id);
    assert.equal(back.matchId, id);
    assert.equal(traitreToRemote({ ...deal, matchId: null, lobbyStarted: false, phase: null }).matchId, null);
  });
});

describe("traitre_private", () => {
  it("deux manches du même joueur coexistent, y compris avec la même paire", async () => {
    saveStatePatch({
      supabaseUserId: "ua",
      lobby: {
        id: "lobby-match",
        participants: [
          { name: "Alice", userId: "ua", isLocal: true, isHost: true },
          { name: "Bob", userId: "ub", isLocal: false, isHost: false },
          { name: "Chloé", userId: "uc", isLocal: false, isHost: false },
        ],
      },
      user: { name: "Alice" },
    });
    remotePrivate = false;
    const first = await hostDistributeTraitreRoles(MATCH_A, PAIR, "Bob", ["Alice", "Bob", "Chloé"]);
    const second = await hostDistributeTraitreRoles(MATCH_B, PAIR, "Alice", ["Alice", "Bob", "Chloé"]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    const roleA = await fetchMyTraitrePrivate(MATCH_A);
    const roleB = await fetchMyTraitrePrivate(MATCH_B);
    assert.equal(roleA.is_impostor, false);
    assert.equal(roleB.is_impostor, true);
    assert.equal(roleA.pair_id, PAIR);
    assert.equal(roleB.pair_id, PAIR);
    assert.equal(roleA.match_id, MATCH_A);
    assert.equal(roleB.match_id, MATCH_B);

    const bundle = JSON.parse(localStorage.getItem("reveal-traitre-private:lobby-match"));
    assert.equal(bundle[MATCH_A].ua.match_id, MATCH_A);
    assert.equal(bundle[MATCH_B].ua.is_impostor, true);
  });

  it("maybeSingle filtré par match_id ne renvoie pas l'autre manche", async () => {
    privateRows.splice(0, privateRows.length,
      {
        lobby_id: "lobby-match",
        user_id: "ua",
        match_id: MATCH_A,
        pair_id: PAIR,
        is_impostor: true,
      },
      {
        lobby_id: "lobby-match",
        user_id: "ua",
        match_id: MATCH_B,
        pair_id: PAIR,
        is_impostor: false,
      }
    );
    remotePrivate = true;
    const roleA = await fetchMyTraitrePrivate(MATCH_A);
    const roleB = await fetchMyTraitrePrivate(MATCH_B);
    assert.equal(roleA.is_impostor, true);
    assert.equal(roleB.is_impostor, false);
    assert.notEqual(roleA.match_id, roleB.match_id);
  });
});

describe("manche périmée et fusion", () => {
  it("une requête A sur un blob B ne score pas et ne lit pas le rôle de B", () => {
    const blobB = voteSession(MATCH_B);
    const stale = resolveTraitreAdvance(blobB, voteRequest(MATCH_A), { impostorName: "Alice" });
    assert.equal(stale.kind, "rejected");
    assert.equal(stale.reason, "TRAITRE_STALE_MATCH");
    assert.equal(stale.session, blobB);
    assert.equal(stale.session.phase, "vote");
    assert.equal(stale.eveningDeltas ?? null, null);

    const finalA = resolveTraitreAdvance(voteSession(MATCH_A), voteRequest(MATCH_A), {
      impostorName: "Bob",
    });
    const lateB = resolveTraitreAdvance(finalA.session, voteRequest(MATCH_B), { impostorName: "Bob" });
    assert.equal(lateB.kind, "rejected");
    assert.equal(lateB.reason, "TRAITRE_STALE_MATCH");
    assert.notEqual(lateB.kind, "idempotent");

    const sql = read("supabase/feature-traitre-01-advance-play.sql");
    const guard = sql.indexOf("raise exception 'TRAITRE_STALE_MATCH'");
    const retry = sql.indexOf("Retry : la transition");
    const privateRead = sql.indexOf("from public.traitre_private");
    const update = sql.lastIndexOf("update public.game_sessions");
    assert.ok(guard > 0 && guard < retry && retry < privateRead && privateRead < update);
    assert.equal(sql.split("match_id = p_match_id").length - 1, 2);
  });

  it("un matchId différent remplace l'état même si paire, phase, tour et effectif coincident", () => {
    const local = {
      matchId: MATCH_A,
      pairId: PAIR,
      phase: "final",
      speakRound: 1,
      lobbyStarted: true,
      alive: ["Alice", "Bob"],
    };
    const remote = {
      matchId: MATCH_B,
      pairId: PAIR,
      phase: "deal",
      speakRound: 1,
      lobbyStarted: true,
      alive: ["Alice", "Bob"],
    };
    assert.equal(isNewTraitreGame(local, remote), true);
    assert.equal(isNewTraitreGame(local, { ...local, phase: "speak" }), false);
    assert.equal(isNewTraitreGame(local, { ...remote, matchId: null }), false);
    assert.equal(
      isNewTraitreGame({ pairId: "a", phase: "final" }, { pairId: "b", phase: "deal" }),
      false
    );
    assert.equal(
      isNewTraitreGame(
        { matchId: MATCH_A, phase: "vote", lobbyStarted: true },
        { matchId: null, phase: null, lobbyStarted: false }
      ),
      true
    );

    const replaced = mergeTraitrePatchState(local, remote, mergeOpts);
    assert.equal(replaced.matchId, MATCH_B);
    assert.equal(replaced.phase, "deal");

    const kept = mergeTraitrePatchState(
      local,
      { ...remote, matchId: null },
      mergeOpts
    );
    assert.equal(kept.matchId, MATCH_A);
    assert.equal(kept.phase, "final");

    const echo = mergeTraitrePatchState(
      { ...local, phase: "vote" },
      { ...local, phase: "deal" },
      mergeOpts
    );
    assert.equal(echo.matchId, MATCH_A);
    assert.equal(echo.phase, "vote");
    assert.equal(mergeTraitrePhase("vote", "deal", { newGame: false }), "vote");
    assert.equal(mergeTraitrePhase("vote", "deal", { newGame: true }), "deal");

    const rejoined = mergeTraitrePatchState(null, remote, mergeOpts);
    assert.equal(rejoined.matchId, MATCH_B);
    assert.equal(
      isNewTraitreGame({ lobbyStarted: false, phase: null, matchId: null }, remote),
      true
    );
  });
});

describe("updated_at, remap et nettoyage", () => {
  it("set_updated_at échantillonne clock_timestamp et les triggers de session le gardent", () => {
    const schema = read("supabase/schema.sql");
    const fn = schema.slice(
      schema.indexOf("function public.set_updated_at"),
      schema.indexOf("drop trigger if exists lobbies_updated_at")
    );
    assert.match(fn, /clock_timestamp\(\)/);
    assert.doesNotMatch(fn, /now\(\)/);
    const migration = read("supabase/feature-traitre-02-match-id.sql");
    assert.match(migration, /clock_timestamp\(\)/);
    assert.match(migration, /unique \(lobby_id, match_id, user_id\)/);
    assert.match(migration, /traitre_private_lobby_match_idx/);
    assert.match(migration, /delete from public\.traitre_private where match_id is null/);
    assert.match(read("supabase/game-sessions.sql"), /execute function public\.set_updated_at\(\)/);
    const lobbies = read("supabase/lobby-lifecycle.sql");
    assert.match(lobbies, /set_lobbies_timestamps/);
    assert.doesNotMatch(
      lobbies.slice(lobbies.indexOf("function public.set_lobbies_timestamps")),
      /clock_timestamp\(\)/
    );

    const sync = read("js/core/gameSync.js");
    const older = sync.slice(
      sync.indexOf("function isOlderSessionRow"),
      sync.indexOf("export function isGameSyncActive")
    );
    assert.match(older, /return incoming < current/);
    const same = "2026-10-08T18:00:00.000Z";
    assert.equal(Date.parse(same) < Date.parse(same), false);
    assert.equal(Date.parse("2026-10-08T17:00:00.000Z") < Date.parse(same), true);
  });

  it("le remap couvre toutes les manches et le clear ne précède plus la distribution", () => {
    for (const rel of [
      "supabase/cleanup-filrouge-02-remove-server-legacy.sql",
      "supabase/reclaim-guest-membership.sql",
    ]) {
      const sql = read(rel);
      const update = sql.slice(
        sql.indexOf("update public.traitre_private"),
        sql.indexOf("update public.traitre_private") + 180
      );
      assert.match(update, /where lobby_id = p_lobby_id/);
      assert.match(update, /user_id = p_old_user_id/);
      assert.doesNotMatch(update, /match_id/);
    }
    const start = read("js/core/traitreSession.js");
    assert.equal(start.includes("clearTraitrePrivateForLobby"), false);
    assert.match(read("js/core/restartGame.js"), /clearTraitrePrivateForLobby/);
    assert.match(read("js/core/traitrePrivate.js"), /export async function clearTraitrePrivateForLobby/);
  });
});
