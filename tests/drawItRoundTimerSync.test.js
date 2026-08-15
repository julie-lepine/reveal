/**
 * BUG Draw it ! — nouvelle manche : timestamps serveur et timer invité.
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
const T0 = Date.parse("2026-08-15T21:00:00.000Z");
const T1 = Date.parse("2026-08-15T21:00:15.000Z");

mock.module("../js/core/supabaseClient.js", {
  namedExports: {
    isSupabaseConfigured: () => false,
    supabase: null,
  },
});

const {
  applyDrawItNextRound,
  buildDrawItLaunchState,
  drawItSyncedNowMs,
  isNewDrawItRound,
  isStaleDrawItRound,
  remainingMsUntil,
} = await import("../js/core/drawItRound.js");
const {
  applyRemoteSession,
  drawItToRemote,
  __resetCachedGameSessionForTests,
} = await import("../js/core/gameSync.js");
const { getDrawItSession } = await import("../js/core/drawItSession.js");
const { getState, saveStatePatch } = await import("../js/core/state.js");
const { initRouter, registerScreen, resetNav } = await import(
  "../js/core/router.js"
);

function participants() {
  return [
    { userId: HOST_UID, name: "Alice" },
    { userId: GUEST_UID, name: "Bob" },
  ];
}

function roundOne() {
  return buildDrawItLaunchState({
    session: { selectedCategoryId: "demo", roundCount: 3, ready: {} },
    participants: participants(),
    nowMs: T0,
    runId: "run-timer-sync",
  });
}

function roundTwo() {
  const first = roundOne();
  return applyDrawItNextRound(
    { ...first, phase: "reveal" },
    { nowMs: T1 }
  ).session;
}

function row(session, updatedAt) {
  return {
    lobby_id: LOBBY_ID,
    game_id: "drawit",
    screen: "drawit",
    updated_at: updatedAt,
    state: { drawIt: drawItToRemote(session) },
  };
}

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

describe("Draw it ! — identité et timestamps de nouvelle manche", () => {
  it("manche 1 reste T0 → T0+60000", () => {
    const first = roundOne();
    assert.equal(first.roundIdx, 0);
    assert.equal(first.roundStartAt, new Date(T0).toISOString());
    assert.equal(first.roundEndsAt, new Date(T0 + 60_000).toISOString());
  });

  it("advance manche 2 remplace les deux timestamps", () => {
    const first = roundOne();
    const second = roundTwo();
    assert.equal(second.runId, first.runId);
    assert.equal(second.roundIdx, 1);
    assert.equal(second.roundStartAt, new Date(T1).toISOString());
    assert.equal(second.roundEndsAt, new Date(T1 + 60_000).toISOString());
    assert.notEqual(second.roundStartAt, first.roundStartAt);
    assert.notEqual(second.roundEndsAt, first.roundEndsAt);
  });

  it("isNewDrawItRound / stale utilisent runId + roundIdx", () => {
    const first = roundOne();
    const second = roundTwo();
    assert.equal(isNewDrawItRound(first, second), true);
    assert.equal(isStaleDrawItRound(second, first), true);
    assert.equal(isNewDrawItRound(second, { ...second }), false);
  });

  it("horloge invitée décalée de -15 s affiche quand même 60 s", () => {
    const second = {
      ...roundTwo(),
      serverTimeAtSync: new Date(T1).toISOString(),
      clientTimeAtSyncMs: T1 - 15_000,
    };
    const guestNowAtReceipt = T1 - 15_000;
    const serverNow = drawItSyncedNowMs(second, guestNowAtReceipt);
    assert.equal(serverNow, T1);
    assert.equal(remainingMsUntil(second.roundEndsAt, serverNow), 60_000);
    assert.equal(
      remainingMsUntil(
        second.roundEndsAt,
        drawItSyncedNowMs(second, guestNowAtReceipt + 10_000)
      ),
      50_000
    );
  });
});

describe("Draw it ! — hydratation invitée", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (fn) => {
      fn(0);
      return 0;
    };
    ensureScreens();
    resetNav();
    __resetCachedGameSessionForTests();
    saveStatePatch({
      inLobby: true,
      supabaseUserId: GUEST_UID,
      lobby: {
        id: LOBBY_ID,
        hostId: HOST_UID,
        participants: participants(),
      },
      drawItGame: roundOne(),
    });
  });

  afterEach(() => {
    __resetCachedGameSessionForTests();
  });

  it("manche 2 distante remplace exactement start/end chez l'invité", () => {
    const second = roundTwo();
    applyRemoteSession(row(second, new Date(T1).toISOString()));
    const guest = getDrawItSession();
    assert.equal(guest.runId, second.runId);
    assert.equal(guest.roundIdx, 1);
    assert.equal(guest.phase, "drawing");
    assert.equal(guest.drawerUid, second.drawerUid);
    assert.equal(guest.roundStartAt, second.roundStartAt);
    assert.equal(guest.roundEndsAt, second.roundEndsAt);
    assert.equal(guest.serverTimeAtSync, new Date(T1).toISOString());
    assert.equal(Number.isFinite(guest.clientTimeAtSyncMs), true);
  });

  it("patch tardif manche 1 ne restaure jamais son timer", () => {
    const second = roundTwo();
    applyRemoteSession(row(second, "2026-08-15T21:00:15.000Z"));
    applyRemoteSession(row(roundOne(), "2026-08-15T21:00:16.000Z"));
    const guest = getState().drawItGame;
    assert.equal(guest.roundIdx, 1);
    assert.equal(guest.roundStartAt, second.roundStartAt);
    assert.equal(guest.roundEndsAt, second.roundEndsAt);
  });

  it("timeout de manche 2 utilise uniquement son roundEndsAt", () => {
    const second = roundTwo();
    applyRemoteSession(row(second, "2026-08-15T21:00:15.000Z"));
    const guest = getDrawItSession();
    assert.equal(remainingMsUntil(guest.roundEndsAt, T1 + 59_999), 1);
    assert.equal(remainingMsUntil(guest.roundEndsAt, T1 + 60_000), 0);
  });
});

describe("Draw it ! — serveur et intervalle UI", () => {
  it("advance écrit atomiquement un seul instant serveur + 60 secondes", () => {
    const sql = read("supabase/feature-drawit-02-private-word.sql");
    const fn = sql.slice(
      sql.indexOf("create or replace function public.advance_drawit_round")
    );
    assert.ok(fn.indexOf("for update") < fn.indexOf("v_start := clock_timestamp()"));
    assert.match(fn, /v_end := v_start \+ interval '60 seconds'/);
    assert.match(fn, /'roundIdx', v_next/);
    assert.match(fn, /'roundStartAt', to_jsonb\(v_start\)/);
    assert.match(fn, /'roundEndsAt', to_jsonb\(v_end\)/);
    assert.match(fn, /'foundOrder', '\[\]'::jsonb/);
    assert.match(fn, /'guesses', '\[\]'::jsonb/);
  });

  it("un seul intervalle, nettoyé au remount, lit toujours la session courante", () => {
    const src = read("js/games/drawIt.js");
    assert.equal((src.match(/setInterval\(/g) || []).length, 1);
    assert.match(src, /function startTick\(\)\s*\{\s*stopTick\(\)/);
    assert.match(src, /const session = getDrawItSession\(\)/);
    assert.match(src, /drawItSyncedNowMs\(session\)/);
    assert.match(src, /return \(\) => \{\s*stopTick\(\)/);
  });
});
