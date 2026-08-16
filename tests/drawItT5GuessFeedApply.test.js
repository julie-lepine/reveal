/**
 * Draw it ! T5 — soumission RPC → état local → feed (bug feed vide).
 * Ne mocke PAS applyRemoteSession : le chemin réel doit hydrater drawItGame.guesses.
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

const rpcSubmitDrawItGuessMock = mock.fn();
const showAppAlertMock = mock.fn(async () => {});

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => true,
    supabase: {
      rpc: async () => ({
        data: null,
        error: { message: "test must use rpcSubmitDrawItGuess mock" },
      }),
    },
  },
});

mock.module("../js/core/gameSessionRpc.js", {
  namedExports: {
    rpcSubmitDrawItGuess: (...args) => rpcSubmitDrawItGuessMock(...args),
  },
});

mock.module("../js/core/dialog.js", {
  namedExports: {
    isAppDialogOpen: () => false,
    showAppAlert: showAppAlertMock,
    showAppRichDialog: async () => {},
    showAppConfirm: async () => true,
    showClaimHostDialog: async () => {},
    showAppEmailPrompt: async () => {},
    showTransferHostDialog: async () => {},
    showLobbyPlayersManageDialog: async () => {},
    showEmojiPickerDialog: async () => {},
  },
});

const {
  applyRemoteSession,
  drawItToRemote,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const {
  applyDrawItReveal,
  buildDrawItLaunchState,
  DRAW_IT_PHASE_DRAWING,
  DRAW_IT_PHASE_REVEAL,
} = await import("../js/core/drawItRound.js");
const {
  applyDrawItGuess,
  drawItGuessesToChatMessages,
} = await import("../js/core/drawItGuesses.js");
const { getDrawItSession, submitDrawItGuess } = await import(
  "../js/core/drawItSession.js"
);
const { saveStatePatch } = await import("../js/core/state.js");
const {
  initRouter,
  registerScreen,
  resetNav,
} = await import("../js/core/router.js");

function fakeApp() {
  return {
    innerHTML: "",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

function ensureScreens() {
  initRouter(fakeApp());
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

function participants() {
  return [
    { userId: HOST_UID, name: "Alice", isHost: true, isLocal: false },
    { userId: GUEST_UID, name: "Bob", isHost: false, isLocal: true },
    { userId: THIRD_UID, name: "Chloé", isHost: false, isLocal: false },
  ];
}

function launchedSession(extra = {}) {
  return {
    ...buildDrawItLaunchState({
      session: { selectedCategoryId: "Facile", roundCount: 3, ready: {} },
      participants: participants(),
      nowMs: NOW,
      runId: extra.runId || "run-t5-rpc",
    }),
    ...extra,
  };
}

function seedPlay(session = launchedSession()) {
  saveStatePatch({
    inLobby: true,
    supabaseUserId: GUEST_UID,
    lobby: {
      id: LOBBY_ID,
      hostId: HOST_UID,
      participants: participants(),
    },
    drawItGame: session,
  });
  return session;
}

function sessionRow(session, updatedAt = "2026-08-15T21:00:20.000Z") {
  return {
    lobby_id: LOBBY_ID,
    game_id: "drawit",
    screen: "drawit",
    updated_at: updatedAt,
    state: { drawIt: drawItToRemote(session) },
  };
}

function guessOpts(uid, value, extra = {}) {
  return {
    uid,
    value,
    nowMs: extra.nowMs ?? NOW + 5_000,
    serverAt: extra.serverAt ?? "2026-08-15T21:00:12.345Z",
    wordLabel: extra.wordLabel ?? "Éléphant",
    acceptedAnswers: extra.acceptedAnswers ?? ["Éléphant", "pachyderme"],
  };
}

describe("Draw it ! T5 — RPC → état local → feed", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (fn) => {
      fn(0);
      return 0;
    };
    ensureScreens();
    resetNav();
    __resetCachedGameSessionForTests();
    rpcSubmitDrawItGuessMock.mock.resetCalls();
    showAppAlertMock.mock.resetCalls();
    seedPlay();
  });

  afterEach(() => {
    __resetCachedGameSessionForTests();
  });

  it("mauvaise proposition : RPC appliquée, B voit son message tout de suite", async () => {
    const launched = getDrawItSession();
    const after = applyDrawItGuess(launched, guessOpts(GUEST_UID, "girafe")).session;
    rpcSubmitDrawItGuessMock.mock.mockImplementation(async () => sessionRow(after));

    const result = await submitDrawItGuess("girafe", {
      uid: GUEST_UID,
      nowMs: NOW + 5_000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.correct, false);
    assert.equal(rpcSubmitDrawItGuessMock.mock.calls.length, 1);
    const session = getDrawItSession();
    assert.equal(session.guesses.length, 1);
    assert.equal(session.guesses[0].uid, GUEST_UID);
    assert.equal(session.guesses[0].value, "girafe");
    assert.deepEqual(session.foundOrder, []);
    assert.equal(session.phase, DRAW_IT_PHASE_DRAWING);
    const feed = drawItGuessesToChatMessages(session.guesses, () => "Bob");
    assert.equal(feed[0].text, "girafe");
    assert.equal(feed[0].from, "Bob");
  });

  it("bonne proposition : guesses + foundOrder, phase inchangée", async () => {
    const launched = getDrawItSession();
    const after = applyDrawItGuess(launched, guessOpts(GUEST_UID, "éléphant")).session;
    rpcSubmitDrawItGuessMock.mock.mockImplementation(async () => sessionRow(after));

    const result = await submitDrawItGuess("éléphant", {
      uid: GUEST_UID,
      nowMs: NOW + 5_000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.correct, true);
    const session = getDrawItSession();
    assert.equal(session.guesses[0].correct, true);
    assert.equal(session.foundOrder[0].uid, GUEST_UID);
    assert.equal(session.phase, DRAW_IT_PHASE_DRAWING);
    assert.equal(session.roundEndsAt, launched.roundEndsAt);
    const feed = drawItGuessesToChatMessages(session.guesses, () => "Bob");
    assert.equal(session.guesses[0].value, "");
    assert.equal(feed[0].text, "✓ Mot trouvé !");
  });

  it("dernier devineur : la même RPC retourne reveal, sans second appel", async () => {
    const launched = getDrawItSession();
    const first = applyDrawItGuess(
      launched,
      guessOpts(GUEST_UID, "éléphant")
    ).session;
    seedPlay(first);
    saveStatePatch({ supabaseUserId: THIRD_UID });
    const withLastGuess = applyDrawItGuess(
      first,
      guessOpts(THIRD_UID, "éléphant", {
        serverAt: "2026-08-15T21:00:13.000Z",
      })
    ).session;
    const revealed = applyDrawItReveal(withLastGuess, {
      wordLabel: "Éléphant",
      nowMs: NOW + 6_000,
    }).session;
    rpcSubmitDrawItGuessMock.mock.mockImplementation(async () =>
      sessionRow(revealed, "2026-08-15T21:00:23.000Z")
    );

    const result = await submitDrawItGuess("éléphant", {
      uid: THIRD_UID,
      nowMs: NOW + 6_000,
    });

    assert.equal(result.ok, true);
    assert.equal(result.correct, true);
    assert.equal(rpcSubmitDrawItGuessMock.mock.calls.length, 1);
    const session = getDrawItSession();
    assert.equal(session.phase, DRAW_IT_PHASE_REVEAL);
    assert.deepEqual(
      session.foundOrder.map((entry) => entry.uid),
      [GUEST_UID, THIRD_UID]
    );
    assert.equal(session.lastRound.wordLabel, "Éléphant");
    assert.equal(session.roundEndsAt, launched.roundEndsAt);
  });

  it("RPC absente (01b seul) : pas de succès fantôme, feed vide", async () => {
    rpcSubmitDrawItGuessMock.mock.mockImplementation(async () => {
      throw new Error(
        "Could not find the function public.submit_drawit_guess in the schema cache"
      );
    });

    const result = await submitDrawItGuess("girafe", {
      uid: GUEST_UID,
      nowMs: NOW + 5_000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "rpc_failed");
    assert.equal(getDrawItSession().guesses?.length || 0, 0);
    assert.equal(showAppAlertMock.mock.calls.length, 1);
  });

  it("RPC OK mais état sans la guess : not_applied, pas de feed", async () => {
    rpcSubmitDrawItGuessMock.mock.mockImplementation(async () =>
      sessionRow(getDrawItSession())
    );

    const result = await submitDrawItGuess("girafe", {
      uid: GUEST_UID,
      nowMs: NOW + 5_000,
    });

    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_applied");
    assert.equal(getDrawItSession().guesses?.length || 0, 0);
  });

  it("autre joueur : applyRemoteSession hydrate le même feed", () => {
    const launched = getDrawItSession();
    const after = applyDrawItGuess(launched, guessOpts(GUEST_UID, "girafe")).session;
    __resetCachedGameSessionForTests();
    applyRemoteSession(sessionRow(after, "2026-08-15T21:00:21.000Z"));
    const session = getDrawItSession();
    assert.equal(session.guesses[0].value, "girafe");
    const feed = drawItGuessesToChatMessages(session.guesses, (uid) =>
      uid === GUEST_UID ? "Bob" : "Joueur"
    );
    assert.equal(feed[0].from, "Bob");
    assert.equal(feed[0].text, "girafe");
  });

  it("deux joueurs : les deux guesses restent après hydrate", () => {
    let session = getDrawItSession();
    session = applyDrawItGuess(session, guessOpts(GUEST_UID, "girafe")).session;
    session = applyDrawItGuess(session, guessOpts(THIRD_UID, "lion")).session;
    __resetCachedGameSessionForTests();
    applyRemoteSession(sessionRow(session, "2026-08-15T21:00:22.000Z"));
    const live = getDrawItSession();
    assert.equal(live.guesses.length, 2);
    assert.equal(live.guesses[0].uid, GUEST_UID);
    assert.equal(live.guesses[1].uid, THIRD_UID);
  });

  it("le feed Draw it ! ne lit pas lobby_messages", () => {
    const src = read("js/games/drawIt.js");
    assert.match(src, /drawItGuessesToChatMessages\(getDrawItSession\(\)\.guesses/);
    assert.doesNotMatch(src, /lobby_messages/);
    assert.doesNotMatch(src, /getLobbyMessages/);
    assert.match(read("js/core/drawItSession.js"), /if \(!row\.state\)/);
    assert.match(read("js/core/drawItSession.js"), /applyRemoteSession\(full\)/);
    assert.match(read("js/core/gameSync.js"), /patch\.drawItGame\.guesses/);
  });
});
