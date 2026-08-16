/**
 * Draw it ! T5 — guesses + foundOrder atomique + feed.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const HOST_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST_UID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const THIRD_UID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const LOBBY_ID = "11111111-1111-1111-1111-111111111111";
const NOW = Date.parse("2026-08-15T21:00:00.000Z");
const SERVER_AT = "2026-08-15T21:00:12.345Z";

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const { normalizeDrawItGuess, drawItGuessMatches } = await import(
  "../js/core/drawItNormalize.js"
);
const {
  DRAW_IT_GUESS_FEED_LIMIT,
  applyDrawItGuess,
  applyDrawItGuessesSerialized,
  canKeepDrawItGuessComposer,
  canSubmitDrawItGuess,
  drawItGuessesToChatMessages,
  isDrawItGuessInputLocked,
  isUidInDrawItFoundOrder,
  sanitizeDrawItGuesses,
} = await import("../js/core/drawItGuesses.js");
const {
  applyDrawItReveal,
  buildDrawItLaunchState,
  DRAW_IT_PHASE_DRAWING,
  DRAW_IT_PHASE_REVEAL,
} = await import("../js/core/drawItRound.js");
const {
  applyRemoteSession,
  drawItFromRemote,
  drawItToRemote,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const {
  defaultDrawItPrepSession,
  getDrawItSession,
  markDrawItLobbyStarted,
  setDrawItCategory,
  setDrawItRoundCount,
  submitDrawItGuess,
} = await import("../js/core/drawItSession.js");
const { peekLocalDrawItPrivate } = await import("../js/core/drawItPrivate.js");
const { saveStatePatch } = await import("../js/core/state.js");
const { initRouter, registerScreen, resetNav } = await import("../js/core/router.js");

function ensureScreens() {
  initRouter({
    innerHTML: "",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  });
  for (const id of [
    "home",
    "results",
    "leaderboard",
    "game-select",
    "drawit-prep",
    "drawit",
  ]) {
    registerScreen(id, () => {});
  }
}

function twoPlayers() {
  return [
    { userId: HOST_UID, name: "Alice", isHost: true, isLocal: true },
    { userId: GUEST_UID, name: "Bob", isHost: false, isLocal: false },
  ];
}

function threePlayers() {
  return [
    ...twoPlayers(),
    { userId: THIRD_UID, name: "Chloé", isHost: false, isLocal: false },
  ];
}

function drawingSession(extra = {}) {
  return {
    ...buildDrawItLaunchState({
      session: { selectedCategoryId: "demo", roundCount: 3, ready: {} },
      participants: extra.participants || twoPlayers(),
      nowMs: NOW,
      runId: extra.runId || "run-t5",
    }),
    ...extra,
  };
}

const SECRET = {
  wordLabel: "Éléphant",
  acceptedAnswers: ["Éléphant", "pachyderme"],
};

function guessOpts(uid, value, extra = {}) {
  return {
    uid,
    value,
    nowMs: extra.nowMs ?? NOW + 5_000,
    serverAt: extra.serverAt ?? SERVER_AT,
    wordLabel: extra.wordLabel ?? SECRET.wordLabel,
    acceptedAnswers: extra.acceptedAnswers ?? SECRET.acceptedAnswers,
    clientAt: extra.clientAt,
    at: extra.at,
  };
}

async function launchTwoPlayerGame() {
  saveStatePatch({
    inLobby: true,
    supabaseUserId: HOST_UID,
    lobby: {
      id: LOBBY_ID,
      hostId: HOST_UID,
      participants: twoPlayers(),
    },
    drawItGame: defaultDrawItPrepSession(),
  });
  await setDrawItCategory("demo");
  await setDrawItRoundCount(3);
  const result = await markDrawItLobbyStarted({ rosterNames: ["Alice", "Bob"] });
  assert.equal(result?.ok, true);
  return getDrawItSession();
}

describe("Draw it ! T5 — normalisation", () => {
  it("Éléphant ! correspond à elephant", () => {
    assert.equal(normalizeDrawItGuess("Éléphant !"), "elephant");
    assert.equal(drawItGuessMatches("Éléphant !", ["elephant"]), true);
    assert.equal(drawItGuessMatches("elephant", ["Éléphant"]), true);
  });

  it("espaces, casse, accents", () => {
    assert.equal(normalizeDrawItGuess("  ÉLÉPHANT  "), "elephant");
    assert.equal(normalizeDrawItGuess("éléphant"), "elephant");
    assert.equal(normalizeDrawItGuess("  pizza   royale  "), "pizza royale");
    assert.equal(normalizeDrawItGuess("PIZZA"), "pizza");
  });
});

describe("Draw it ! T5 — mauvaises / bonnes réponses", () => {
  it("mauvaise réponse : feed mis à jour, foundOrder inchangé, phase drawing", () => {
    const session = drawingSession();
    const ends = session.roundEndsAt;
    const applied = applyDrawItGuess(session, guessOpts(GUEST_UID, "girafe"));
    assert.equal(applied.ok, true);
    assert.equal(applied.correct, false);
    assert.equal(applied.session.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(applied.session.roundEndsAt, ends);
    assert.deepEqual(applied.session.foundOrder, []);
    assert.equal(applied.session.guesses.length, 1);
    assert.equal(applied.session.guesses[0].value, "girafe");
    assert.equal(applied.session.guesses[0].correct, false);
    assert.equal(applied.session.guesses[0].uid, GUEST_UID);
  });

  it("bonne réponse : foundOrder + feed, phase reste drawing", () => {
    const session = drawingSession();
    const ends = session.roundEndsAt;
    const applied = applyDrawItGuess(session, guessOpts(GUEST_UID, "Éléphant !"));
    assert.equal(applied.ok, true);
    assert.equal(applied.correct, true);
    assert.equal(applied.session.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(applied.session.roundEndsAt, ends);
    assert.equal(applied.session.foundOrder.length, 1);
    assert.equal(applied.session.foundOrder[0].uid, GUEST_UID);
    assert.equal(applied.session.foundOrder[0].at, SERVER_AT);
    assert.equal(applied.session.guesses[0].correct, true);
    assert.equal(applied.session.guesses[0].value, "");
  });

  it("variante acceptedAnswers acceptée", () => {
    const applied = applyDrawItGuess(
      drawingSession(),
      guessOpts(GUEST_UID, "Pachyderme")
    );
    assert.equal(applied.ok, true);
    assert.equal(applied.correct, true);
    assert.equal(applied.session.foundOrder[0].uid, GUEST_UID);
  });
});

describe("Draw it ! T5 — refus", () => {
  it("joueur déjà trouvé : nouvelle proposition refusée", () => {
    const first = applyDrawItGuess(drawingSession(), guessOpts(GUEST_UID, "elephant"));
    const second = applyDrawItGuess(first.session, guessOpts(GUEST_UID, "elephant"));
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_found");
    assert.equal(second.session.foundOrder.length, 1);
    assert.equal(second.session.guesses.length, 1);
  });

  it("drawer : proposition refusée", () => {
    const applied = applyDrawItGuess(drawingSession(), guessOpts(HOST_UID, "elephant"));
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "drawer");
    assert.deepEqual(applied.session.foundOrder, []);
    assert.deepEqual(applied.session.guesses, []);
  });

  it("phase reveal : proposition refusée", () => {
    const revealed = applyDrawItReveal(drawingSession(), {
      wordLabel: "Éléphant",
      nowMs: NOW + 60_000,
    }).session;
    const applied = applyDrawItGuess(
      revealed,
      guessOpts(GUEST_UID, "elephant", { nowMs: NOW + 61_000 })
    );
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "not_drawing");
  });

  it("après roundEndsAt : proposition refusée", () => {
    const applied = applyDrawItGuess(
      drawingSession(),
      guessOpts(GUEST_UID, "elephant", { nowMs: NOW + 60_000 })
    );
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "expired");
    assert.deepEqual(applied.session.foundOrder, []);
  });

  it("réponse vide refusée", () => {
    const applied = applyDrawItGuess(drawingSession(), guessOpts(GUEST_UID, "   !!!  "));
    assert.equal(applied.ok, false);
    assert.equal(applied.reason, "empty");
    assert.deepEqual(applied.session.guesses, []);
  });
});

describe("Draw it ! T5 — concurrence + timestamps", () => {
  it("A + B corrects simultanément : les deux dans foundOrder", () => {
    const { session, results } = applyDrawItGuessesSerialized(
      drawingSession({ participants: threePlayers() }),
      [
        guessOpts(GUEST_UID, "elephant", { serverAt: "2026-08-15T21:00:10.000Z" }),
        guessOpts(THIRD_UID, "elephant", { serverAt: "2026-08-15T21:00:10.010Z" }),
      ]
    );
    assert.equal(results.every((r) => r.ok && r.correct), true);
    assert.deepEqual(
      session.foundOrder.map((e) => e.uid),
      [GUEST_UID, THIRD_UID]
    );
    assert.equal(session.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(session.foundOrder[0].at, "2026-08-15T21:00:10.000Z");
    assert.equal(session.foundOrder[1].at, "2026-08-15T21:00:10.010Z");
  });

  it("deux joueurs : les deux guesses sont conservées", () => {
    const { session } = applyDrawItGuessesSerialized(
      drawingSession({ participants: threePlayers() }),
      [
        guessOpts(GUEST_UID, "girafe"),
        guessOpts(THIRD_UID, "lion"),
      ]
    );
    assert.equal(session.guesses.length, 2);
    assert.equal(session.guesses[0].uid, GUEST_UID);
    assert.equal(session.guesses[1].uid, THIRD_UID);
    assert.deepEqual(session.foundOrder, []);
  });

  it("mauvaise puis bonne du même joueur : feed 2, foundOrder 1", () => {
    const { session, results } = applyDrawItGuessesSerialized(drawingSession(), [
      guessOpts(GUEST_UID, "girafe"),
      guessOpts(GUEST_UID, "elephant"),
    ]);
    assert.equal(results[0].ok, true);
    assert.equal(results[0].correct, false);
    assert.equal(results[1].ok, true);
    assert.equal(results[1].correct, true);
    assert.equal(session.guesses.length, 2);
    assert.equal(session.foundOrder.length, 1);
    assert.equal(session.foundOrder[0].uid, GUEST_UID);
  });

  it("A correct deux fois : une seule entrée", () => {
    const { session, results } = applyDrawItGuessesSerialized(drawingSession(), [
      guessOpts(GUEST_UID, "elephant"),
      guessOpts(GUEST_UID, "elephant"),
    ]);
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.equal(session.foundOrder.length, 1);
    assert.equal(session.foundOrder[0].uid, GUEST_UID);
  });

  it("at vient du serveur, pas du timestamp client", () => {
    const applied = applyDrawItGuess(
      drawingSession(),
      guessOpts(GUEST_UID, "elephant", {
        serverAt: SERVER_AT,
        clientAt: "2099-01-01T00:00:00.000Z",
        at: "2099-01-01T00:00:00.000Z",
      })
    );
    assert.equal(applied.session.foundOrder[0].at, SERVER_AT);
    assert.equal(applied.session.guesses[0].at, SERVER_AT);
    assert.notEqual(applied.session.guesses[0].at, "2099-01-01T00:00:00.000Z");
  });
});

describe("Draw it ! T5 — secret + feed + hydrate", () => {
  it("mot et acceptedAnswers absents du payload public pendant drawing", () => {
    const session = applyDrawItGuess(
      drawingSession(),
      guessOpts(GUEST_UID, "elephant")
    ).session;
    const remote = drawItToRemote(session);
    assert.equal(remote.phase, DRAW_IT_PHASE_DRAWING);
    assert.ok(remote.foundOrder.length === 1);
    assert.ok(remote.guesses.length === 1);
    assert.equal("wordLabel" in remote, false);
    assert.equal("wordId" in remote, false);
    assert.equal("acceptedAnswers" in remote, false);
    assert.equal("deck" in remote, false);
    assert.equal(JSON.stringify(remote).includes("Éléphant"), false);
    assert.equal(JSON.stringify(remote).includes("elephant"), false);
    assert.equal(JSON.stringify(remote).includes("pachyderme"), false);
  });

  it("feed borné aux 20 dernières propositions", () => {
    let session = drawingSession();
    for (let i = 0; i < 25; i += 1) {
      session = applyDrawItGuess(
        session,
        guessOpts(GUEST_UID, `raté ${i}`, {
          serverAt: `2026-08-15T21:00:${String(i).padStart(2, "0")}.000Z`,
        })
      ).session;
    }
    assert.equal(session.guesses.length, DRAW_IT_GUESS_FEED_LIMIT);
    assert.equal(session.guesses[0].value, "raté 5");
    assert.equal(session.guesses[19].value, "raté 24");
    assert.deepEqual(session.foundOrder, []);
    assert.equal(sanitizeDrawItGuesses(session.guesses).length, 20);
  });

  it("reconnexion : foundOrder restauré et joueur trouvé toujours verrouillé", () => {
    const session = applyDrawItGuess(
      drawingSession(),
      guessOpts(GUEST_UID, "elephant")
    ).session;
    const hydrated = drawItFromRemote(drawItToRemote(session));
    assert.equal(hydrated.foundOrder[0].uid, GUEST_UID);
    assert.equal(hydrated.guesses[0].correct, true);
    assert.equal(hydrated.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(canSubmitDrawItGuess(hydrated, { uid: GUEST_UID, nowMs: NOW + 8_000 }).ok, false);
    assert.equal(isDrawItGuessInputLocked(hydrated, GUEST_UID, NOW + 8_000), true);
    assert.equal(isUidInDrawItFoundOrder(hydrated.foundOrder, GUEST_UID), true);
    assert.equal(canSubmitDrawItGuess(hydrated, { uid: THIRD_UID, nowMs: NOW + 8_000 }).reason, "not_in_party");
  });

  it("reveal : foundOrder conservé, aucun nouveau guess", () => {
    const found = applyDrawItGuess(
      drawingSession(),
      guessOpts(GUEST_UID, "elephant")
    ).session;
    const revealed = applyDrawItReveal(found, {
      wordLabel: "Éléphant",
      nowMs: NOW + 60_000,
    }).session;
    assert.equal(revealed.phase, DRAW_IT_PHASE_REVEAL);
    assert.equal(revealed.foundOrder[0].uid, GUEST_UID);
    assert.equal(revealed.lastRound.foundOrder[0].uid, GUEST_UID);
    const refused = applyDrawItGuess(
      revealed,
      guessOpts(GUEST_UID, "encore", { nowMs: NOW + 61_000 })
    );
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "not_drawing");
  });
});

describe("Draw it ! T5 — session + UI wiring", () => {
  beforeEach(async () => {
    globalThis.requestAnimationFrame = (fn) => {
      fn(0);
      return 0;
    };
    ensureScreens();
    resetNav();
    __resetCachedGameSessionForTests();
    await launchTwoPlayerGame();
  });

  afterEach(() => {
    __resetCachedGameSessionForTests();
  });

  it("dernier devineur hors-ligne : guess puis reveal sans second appel", async () => {
    const launched = getDrawItSession();
    const priv = peekLocalDrawItPrivate(LOBBY_ID, launched.runId, 0);
    assert.ok(priv?.wordLabel);
    saveStatePatch({ supabaseUserId: GUEST_UID });
    const result = await submitDrawItGuess(priv.wordLabel, {
      uid: GUEST_UID,
      nowMs: Date.now(),
    });
    assert.equal(result.ok, true);
    const session = getDrawItSession();
    assert.equal(session.phase, DRAW_IT_PHASE_REVEAL);
    assert.equal(session.foundOrder[0].uid, GUEST_UID);
    assert.equal(session.roundEndsAt, launched.roundEndsAt);
    assert.equal(session.lastRound.wordLabel, priv.wordLabel);
  });

  it("écran jeu monte mountChatPanel, pas lobby_messages", () => {
    const src = read("js/games/drawIt.js");
    assert.match(src, /mountChatPanel/);
    assert.match(src, /submitDrawItGuess/);
    assert.match(src, /drawItGuessesToChatMessages\(getDrawItSession\(\)\.guesses/);
    assert.match(src, /if \(!result\?\.ok\)/);
    assert.match(src, /throw new Error/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /addLobbyMessage/);
    assert.doesNotMatch(src, /pointerdown|Broadcast|awardDrawItRound/);
  });

  it("RPC appliquée : guesses locales + feed lisible tout de suite", () => {
    const launched = getDrawItSession();
    const withGuess = applyDrawItGuess(
      launched,
      guessOpts(GUEST_UID, "girafe")
    ).session;
    __resetCachedGameSessionForTests();
    applyRemoteSession({
      lobby_id: LOBBY_ID,
      game_id: "drawit",
      screen: "drawit",
      updated_at: "2026-08-15T21:00:30.000Z",
      state: { drawIt: drawItToRemote(withGuess) },
    });
    const session = getDrawItSession();
    assert.equal(session.guesses.length, 1);
    assert.equal(session.guesses[0].value, "girafe");
    assert.equal(session.guesses[0].uid, GUEST_UID);
    const feed = drawItGuessesToChatMessages(session.guesses, () => "Bob");
    assert.equal(feed.length, 1);
    assert.equal(feed[0].from, "Bob");
    assert.equal(feed[0].text, "girafe");
    assert.equal(JSON.stringify(feed).includes("lobby_messages"), false);
  });

  it("bonne réponse distante : guesses + foundOrder hydratés", () => {
    const launched = getDrawItSession();
    const withGuess = applyDrawItGuess(
      launched,
      guessOpts(GUEST_UID, "elephant")
    ).session;
    const revealed = applyDrawItReveal(withGuess, {
      wordLabel: "Éléphant",
      nowMs: NOW + 5_000,
    }).session;
    __resetCachedGameSessionForTests();
    applyRemoteSession({
      lobby_id: LOBBY_ID,
      game_id: "drawit",
      screen: "drawit",
      updated_at: "2026-08-15T21:00:31.000Z",
      state: { drawIt: drawItToRemote(revealed) },
    });
    const session = getDrawItSession();
    assert.equal(session.guesses[0].correct, true);
    assert.equal(session.foundOrder[0].uid, GUEST_UID);
    assert.equal(session.phase, DRAW_IT_PHASE_REVEAL);
    assert.equal(session.lastRound.wordLabel, "Éléphant");
    const feed = drawItGuessesToChatMessages(session.guesses, () => "Bob");
    assert.equal(feed[0].text, "✓ Mot trouvé !");
  });
});

describe("Draw it ! — composer guesses stable (clavier)", () => {
  function identity(extra = {}) {
    return {
      phase: DRAW_IT_PHASE_DRAWING,
      runId: "run-focus",
      roundIdx: 0,
      canvasEpoch: 0,
      drawerUid: HOST_UID,
      ...extra,
    };
  }

  it("un feed distant (guesses / foundOrder) conserve l'identité du composer", () => {
    const prev = identity({ guesses: [], foundOrder: [] });
    const nextGuess = applyDrawItGuess(drawingSession({
      runId: "run-focus",
    }), guessOpts(GUEST_UID, "girafe")).session;
    assert.equal(canKeepDrawItGuessComposer(prev, nextGuess), true);
    const nextFound = applyDrawItGuess(drawingSession({
      runId: "run-focus",
    }), guessOpts(GUEST_UID, "elephant")).session;
    assert.equal(canKeepDrawItGuessComposer(prev, nextFound), true);
    assert.equal(nextFound.foundOrder.length, 1);
  });

  it("phase / round / epoch / run / drawer : remount du composer", () => {
    const prev = identity();
    assert.equal(
      canKeepDrawItGuessComposer(prev, identity({ phase: DRAW_IT_PHASE_REVEAL })),
      false
    );
    assert.equal(canKeepDrawItGuessComposer(prev, identity({ roundIdx: 1 })), false);
    assert.equal(canKeepDrawItGuessComposer(prev, identity({ canvasEpoch: 1 })), false);
    assert.equal(canKeepDrawItGuessComposer(prev, identity({ runId: "run-b" })), false);
    assert.equal(
      canKeepDrawItGuessComposer(prev, identity({ drawerUid: GUEST_UID })),
      false
    );
  });

  it("écran jeu : patch live du feed, pas de remount innerHTML du composer", () => {
    const src = read("js/games/drawIt.js");
    const guesses = read("js/core/drawItGuesses.js");
    assert.match(guesses, /export function canKeepDrawItGuessComposer/);
    assert.match(src, /canKeepDrawItGuessComposer\(lastPlayIdentity/);
    assert.match(src, /function patchDrawingLive/);
    assert.match(src, /function syncGuessFeedDom/);
    assert.match(src, /appendChild\(buildGuessMsgNode/);
    const patchStart = src.indexOf("function patchDrawingLive");
    const patch = src.slice(patchStart, src.indexOf("function bindGuessChat"));
    assert.doesNotMatch(patch, /innerHTML\s*=/);
    assert.doesNotMatch(patch, /chatPanel\.refresh\(/);
    assert.doesNotMatch(patch, /teardownChat\(\)/);
    assert.doesNotMatch(patch, /bindGuessChat\(/);
    assert.doesNotMatch(patch, /\.focus\(/);
    assert.match(read("style.css"), /\.draw-it-guess \.chat-messages\{[\s\S]*?height:180px;/);
    const handlerStart = src.indexOf("const unsub = onGameSessionChange");
    const handler = src.slice(
      handlerStart,
      src.indexOf("activateDrawItLive({", handlerStart)
    );
    assert.match(handler, /canKeepDrawItGuessComposer\(lastPlayIdentity, session\)/);
    assert.match(handler, /patchDrawingLive\(session\)/);
    assert.match(src, /teardownChat\(\);\s*\n\s*teardownCanvas\(\);\s*\n\s*app\.innerHTML/);
    assert.match(src, /bindGuessChat\(session\)/);
  });
});

describe("Draw it ! T5 — SQL RPC", () => {
  it("submit_drawit_guess : FOR UPDATE + reveal atomique du dernier devineur", () => {
    const sql = read("supabase/feature-drawit-03-guesses.sql");
    assert.match(sql, /create or replace function public\.normalize_drawit_guess/);
    assert.match(sql, /create or replace function public\.submit_drawit_guess/);
    const fnStart = sql.indexOf("create or replace function public.submit_drawit_guess");
    const fn = sql.slice(fnStart);
    assert.match(fn, /for update/i);
    assert.match(fn, /clock_timestamp\(\)/);
    assert.match(fn, /DRAWIT_DRAWER/);
    assert.match(fn, /DRAWIT_ALREADY_FOUND/);
    assert.match(fn, /DRAWIT_EXPIRED/);
    assert.match(fn, /DRAWIT_NOT_DRAWING/);
    assert.match(fn, /drawit_private/);
    assert.doesNotMatch(fn, /p_word_label|p_accepted/);
    assert.match(fn, /drawit_all_guessers_found/);
    assert.match(fn, /drawit_revealed_state\(v_di, v_priv\.word_label\)/);
    assert.match(fn, /case when v_correct then '' else v_trimmed end/);
    assert.match(fn, /'foundOrder', v_found/);
    assert.match(fn, /'guesses', v_guesses/);
    assert.doesNotMatch(fn, /\{drawIt,roundEndsAt\}/);
    assert.match(read("js/core/gameSessionRpc.js"), /rpcSubmitDrawItGuess/);
    assert.match(read("js/core/gameSessionRpc.js"), /submit_drawit_guess/);
    assert.doesNotMatch(
      read("supabase/feature-drawit-01b-remote-ready.sql"),
      /create or replace function public\.submit_drawit_guess/
    );
    assert.doesNotMatch(
      read("supabase/feature-drawit-01-prep-guest-ready.sql"),
      /create or replace function public\.submit_drawit_guess/
    );
  });
});
