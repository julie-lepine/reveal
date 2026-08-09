/**
 * Guest follow Rank Live prep : series_end stale ne doit pas bloquer live-prep.
 */
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

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
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), unsubscribe: () => {} }),
    },
  },
});

const { getEffectiveSessionScreen } = await import("../js/core/gameSync.js");
const { shouldPreferTierNightEndRoute } = await import("../js/core/tierNightConfig.js");

const staleLiveEnd = {
  lobbyStarted: false,
  finished: true,
  series: { kind: "live", phase: "series_end", roundIndex: 2, queue: [{}, {}, {}] },
};

const livePrepBlob = {
  categoryIds: ["*"],
  roundCount: 3,
  ready: {},
  setupEpoch: 1,
};

describe("BUG — guest follow Rank Live prep vs Classe le groupe", () => {
  it("1 — remote Rank Live : declared live-prep + series_end stale → effective live-prep", () => {
    const row = {
      screen: "tiernight-live-prep",
      game_id: "tiernight",
      state: {
        tierNightLivePrep: livePrepBlob,
        tierNightLive: staleLiveEnd,
        tierNight: {
          lobbyStarted: false,
          recap: { recaps: [{ player: "Host", placed: { A: ["x"] } }] },
        },
      },
    };
    assert.equal(
      shouldPreferTierNightEndRoute({
        state: row.state,
        declared: row.screen,
      }),
      false
    );
    assert.equal(getEffectiveSessionScreen(row), "tiernight-live-prep");
  });

  it("2 — Classe le groupe : declared tiernight-prep → effective prep (non-régression)", () => {
    const row = {
      screen: "tiernight-prep",
      game_id: "tiernight",
      state: {
        tierNightPrep: {
          categoryIds: ["*"],
          roundCount: 5,
          ready: {},
          setupEpoch: 0,
        },
      },
    };
    assert.equal(getEffectiveSessionScreen(row), "tiernight-prep");
  });

  it("3 — series_end + declared tiernight-end → end (fin réelle)", () => {
    const row = {
      screen: "tiernight-end",
      game_id: "tiernight",
      state: {
        tierNightLive: staleLiveEnd,
        tierNight: {
          lobbyStarted: false,
          recap: { recaps: [{ player: "Host", placed: { A: ["x"] } }] },
        },
      },
    };
    assert.equal(getEffectiveSessionScreen(row), "tiernight-end");
  });

  it("4 — hydrate : remote déjà en live-prep → guest résout live-prep", () => {
    const row = {
      screen: "tiernight-live-prep",
      game_id: "tiernight",
      state: {
        tierNightLivePrep: livePrepBlob,
        tierNightLive: {
          lobbyStarted: false,
          finished: false,
          series: null,
        },
      },
    };
    assert.equal(getEffectiveSessionScreen(row), "tiernight-live-prep");
  });

  it("5 — enterTierNightLivePrep clear live stale (source)", () => {
    const src = read("js/core/tierNightLivePrepSession.js");
    assert.match(src, /tierNightLive/);
    assert.match(src, /series:\s*null/);
    assert.match(src, /screen:\s*["']tiernight-live-prep["']/);
  });

  it("6 — select wiring guestFollow inclut live-prep", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /tiernight-live-prep/);
    assert.match(select, /prepGuestFollowOnSession/);
    assert.match(select, /enterTierNightLivePrep/);
  });
});
