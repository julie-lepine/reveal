/**
 * Draw it ! T2 — sync session + routing distant (prépa / lancement uniquement).
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const LOBBY_ID = "11111111-1111-1111-1111-111111111111";
const HOST_UID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GUEST_UID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: {
      rpc: async () => ({ data: null, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        unsubscribe: () => {},
      }),
    },
  },
});

const {
  applyRemoteSession,
  drawItFromRemote,
  drawItToRemote,
  getEffectiveSessionScreen,
  isOnGameSetupScreen,
  shouldBlockLateGamePatchAfterPostGame,
  POST_GAME_SCREENS,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const { defaultDrawItPrepSession, getDrawItSession, setDrawItCategory, setDrawItRoundCount } =
  await import("../js/core/drawItSession.js");
const { saveStatePatch, getState } = await import("../js/core/state.js");
const { isContributePairAllowed } = await import("../js/core/gameSessionSecurity.js");
const { detectPlayerContribution, stateKeyToGameId } = await import(
  "../js/core/playerContribution.js"
);
const {
  initRouter,
  registerScreen,
  navigate,
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
    "speedvote-prep",
    "speedvote",
  ]) {
    registerScreen(id, () => {});
  }
}

function lobbyPatch() {
  return {
    inLobby: true,
    lobby: {
      id: LOBBY_ID,
      hostId: HOST_UID,
      participants: [
        { userId: HOST_UID, name: "Alice", isHost: true, isLocal: true },
        { userId: GUEST_UID, name: "Bob", isHost: false, isLocal: false },
      ],
    },
  };
}

function drawItRow({
  screen = "drawit-prep",
  lobbyStarted = false,
  selectedCategoryId = "demo",
  roundCount = 3,
  ready = {},
  updatedAt = "2026-08-15T21:00:00.000Z",
} = {}) {
  return {
    lobby_id: LOBBY_ID,
    game_id: "drawit",
    screen,
    updated_at: updatedAt,
    state: {
      drawIt: {
        ready,
        lobbyStarted,
        selectedCategoryId,
        roundCount,
      },
    },
  };
}

describe("Draw it ! T2 — codecs / hydratation", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (fn) => {
      fn(0);
      return 0;
    };
    ensureScreens();
    resetNav();
    __resetCachedGameSessionForTests();
    saveStatePatch({
      ...lobbyPatch(),
      drawItGame: defaultDrawItPrepSession(),
    });
  });

  afterEach(() => {
    __resetCachedGameSessionForTests();
  });

  it("drawItFromRemote hydrate les champs prépa et ignore le gameplay futur", () => {
    const remote = drawItFromRemote({
      ready: { [GUEST_UID]: true },
      lobbyStarted: true,
      selectedCategoryId: "demo",
      roundCount: 8,
      strokes: [{ x: 1 }],
      guesses: { Bob: "chat" },
      foundOrder: ["Bob"],
      drawerOrder: ["Alice"],
      phase: "drawing",
    });
    assert.equal(remote.selectedCategoryId, "demo");
    assert.equal(remote.roundCount, 8);
    assert.equal(remote.lobbyStarted, true);
    assert.equal(remote.ready.Bob, true);
    assert.equal("wordId" in remote, false);
    assert.equal("wordLabel" in remote, false);
    assert.equal("deck" in remote, false);
    assert.equal("acceptedAnswers" in remote, false);
  });

  it("drawItFromRemote traite undefined / absent comme les défauts prépa", () => {
    assert.equal(drawItFromRemote(null), null);
    const remote = drawItFromRemote({});
    assert.equal(remote.selectedCategoryId, "catalog");
    assert.equal(remote.roundCount, 5);
    assert.equal(remote.lobbyStarted, false);
    assert.deepEqual(remote.ready, {});
  });

  it("drawItToRemote encode ready en UID", () => {
    const remote = drawItToRemote({
      ready: { Alice: true, Bob: false },
      lobbyStarted: false,
      selectedCategoryId: "demo",
      roundCount: 8,
    });
    assert.equal(remote.ready[HOST_UID], true);
    assert.equal(remote.ready[GUEST_UID], false);
    assert.equal(Object.hasOwn(remote.ready, "Alice"), false);
  });

  it("applyRemoteSession injecte drawItGame depuis game_sessions", () => {
    applyRemoteSession(
      drawItRow({
        selectedCategoryId: "demo",
        roundCount: 8,
        ready: { [GUEST_UID]: true },
      })
    );
    const session = getDrawItSession();
    assert.equal(session.selectedCategoryId, "demo");
    assert.equal(session.roundCount, 8);
    assert.equal(session.lobbyStarted, false);
    assert.equal(session.ready.Bob, true);
    assert.equal(getState().drawItGame.selectedCategoryId, "demo");
  });
});

describe("Draw it ! T2 — setup / ready / sync prépa", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (fn) => {
      fn(0);
      return 0;
    };
    ensureScreens();
    resetNav();
    __resetCachedGameSessionForTests();
    saveStatePatch({
      ...lobbyPatch(),
      drawItGame: defaultDrawItPrepSession(),
    });
  });

  afterEach(() => {
    __resetCachedGameSessionForTests();
  });

  it("drawit-prep est un écran de setup", () => {
    assert.equal(isOnGameSetupScreen("drawit-prep"), true);
    assert.equal(isOnGameSetupScreen("drawit"), false);
  });

  it("ready Draw it ! est contribuable, pas vote/guess", () => {
    assert.equal(isContributePairAllowed("drawit", "ready"), true);
    assert.equal(isContributePairAllowed("drawit", "vote"), false);
    assert.equal(isContributePairAllowed("drawit", "answer"), false);
    assert.equal(stateKeyToGameId("drawIt"), "drawit");
    assert.deepEqual(
      detectPlayerContribution({ drawIt: { ready: { [GUEST_UID]: true } } }, GUEST_UID),
      { game: "drawit", kind: "ready", value: true }
    );
  });

  it("SQL repo autorise drawit ready uniquement", () => {
    const sql = read("supabase/feature-drawit-01-prep-guest-ready.sql");
    assert.match(sql, /when 'drawit' then 'drawIt'/);
    assert.match(sql, /when 'drawit' then 'drawit'/);
    const readyBlock = sql.match(
      /v_kind = 'ready' and v_game not in \(\s*([\s\S]*?)\)/
    );
    assert.ok(readyBlock);
    assert.match(readyBlock[1], /'drawit'/);
    const voteBlock = sql.match(
      /v_kind = 'vote' and v_game not in \(\s*([\s\S]*?)\)/
    );
    assert.ok(voteBlock);
    assert.equal(/'drawit'/.test(voteBlock[1]), false);
  });

  it("SQL 01B prod : mapping drawit + ready sans casser TierNight 04E", () => {
    const sql = read("supabase/feature-drawit-01b-remote-ready.sql");
    assert.match(sql, /when 'drawit' then 'drawIt'/);
    assert.match(sql, /when 'drawit' then 'drawit'/);
    assert.match(sql, /'trivia','consensus','truthmeter','tiernight','drawit'/);
    assert.match(sql, /tierNightLivePrep/);
    assert.match(sql, /pool_invalidate_request/);
    const voteBlock = sql.match(
      /v_kind = 'vote' and v_game not in \(\s*([\s\S]*?)\)/
    );
    assert.ok(voteBlock);
    assert.equal(/'drawit'/.test(voteBlock[1]), false);
  });

  it("catégorie hôte se propage via session distante", async () => {
    await setDrawItCategory("demo");
    assert.equal(getDrawItSession().selectedCategoryId, "demo");
    applyRemoteSession(
      drawItRow({
        selectedCategoryId: "catalog",
        roundCount: 5,
        updatedAt: "2026-08-15T21:01:00.000Z",
      })
    );
    assert.equal(getDrawItSession().selectedCategoryId, "catalog");
  });

  it("nombre de manches hôte se propage via session distante", async () => {
    await setDrawItRoundCount(8);
    assert.equal(getDrawItSession().roundCount, 8);
    applyRemoteSession(
      drawItRow({
        selectedCategoryId: "demo",
        roundCount: 3,
        updatedAt: "2026-08-15T21:02:00.000Z",
      })
    );
    assert.equal(getDrawItSession().roundCount, 3);
  });
});

describe("Draw it ! T2 — routing host / guest / post-game", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (fn) => {
      fn(0);
      return 0;
    };
    ensureScreens();
    resetNav();
    __resetCachedGameSessionForTests();
    saveStatePatch({
      ...lobbyPatch(),
      drawItGame: defaultDrawItPrepSession(),
    });
  });

  afterEach(() => {
    __resetCachedGameSessionForTests();
  });

  it("prépa : session drawit non lancée → drawit-prep", () => {
    assert.equal(getEffectiveSessionScreen(drawItRow()), "drawit-prep");
  });

  it("gameplay : lobbyStarted → drawit (hôte et invité)", () => {
    const play = drawItRow({
      screen: "drawit",
      lobbyStarted: true,
    });
    assert.equal(getEffectiveSessionScreen(play), "drawit");

    const guestSeesPrepDeclared = drawItRow({
      screen: "drawit-prep",
      lobbyStarted: true,
    });
    assert.equal(getEffectiveSessionScreen(guestSeesPrepDeclared), "drawit");
  });

  it("hôte prépa → play : drawit-prep puis drawit", () => {
    const prep = drawItRow();
    const play = drawItRow({
      screen: "drawit",
      lobbyStarted: true,
      updatedAt: "2026-08-15T21:03:00.000Z",
    });
    assert.equal(getEffectiveSessionScreen(prep), "drawit-prep");
    assert.equal(getEffectiveSessionScreen(play), "drawit");
  });

  it("invité suit la transition via la session, pas un navigate direct", () => {
    const src = read("js/screens/drawItPrep.js");
    assert.doesNotMatch(src, /navigate\(\s*["']drawit["']\s*\)/);
    const guestPrep = getEffectiveSessionScreen(drawItRow());
    const guestPlay = getEffectiveSessionScreen(
      drawItRow({ screen: "drawit-prep", lobbyStarted: true })
    );
    assert.equal(guestPrep, "drawit-prep");
    assert.equal(guestPlay, "drawit");
  });

  it("session Draw it ! terminée reste sur l'écran post-game", () => {
    navigate("results");
    const ended = {
      lobby_id: LOBBY_ID,
      game_id: "menu",
      screen: "results",
      state: {
        drawIt: {
          lobbyStarted: false,
          selectedCategoryId: "demo",
          roundCount: 3,
          ready: {},
        },
      },
    };
    assert.equal(POST_GAME_SCREENS.has("results"), true);
    assert.equal(getEffectiveSessionScreen(ended), "results");
  });

  it("late patch gameplay Draw it ! après post-game ne ressuscite pas drawit", () => {
    navigate("results");
    const stalePlay = {
      lobby_id: LOBBY_ID,
      game_id: "menu",
      screen: "results",
      state: {
        drawIt: {
          lobbyStarted: true,
          selectedCategoryId: "demo",
          roundCount: 3,
          ready: {},
        },
      },
    };
    assert.equal(getEffectiveSessionScreen(stalePlay), "results");
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(stalePlay, {
        drawIt: { lobbyStarted: true },
      }),
      true
    );
    assert.equal(
      shouldBlockLateGamePatchAfterPostGame(
        stalePlay,
        { drawIt: { lobbyStarted: true } },
        "drawit-prep"
      ),
      false
    );
  });
});

describe("Draw it ! T2 — non-régression SpeedVote", () => {
  it("SpeedVote prep / play restent résolus", () => {
    assert.equal(
      getEffectiveSessionScreen({
        game_id: "speedvote",
        screen: "speedvote-prep",
        state: { speedVote: { lobbyStarted: false, ready: {} } },
      }),
      "speedvote-prep"
    );
    assert.equal(
      getEffectiveSessionScreen({
        game_id: "speedvote",
        screen: "speedvote-prep",
        state: { speedVote: { lobbyStarted: true, ready: {} } },
      }),
      "speedvote"
    );
  });

  it("GAME_PLAY_STATE_KEYS contient drawIt sans retirer speedVote", () => {
    const sync = read("js/core/gameSync.js");
    const playMatch = sync.match(/const GAME_PLAY_STATE_KEYS = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(playMatch);
    const keys = [...playMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(keys.includes("drawIt"));
    assert.ok(keys.includes("speedVote"));
    assert.equal(keys.includes("drawit-prep"), false);
  });
});
