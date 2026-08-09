/**
 * AUDIT-010 — Contrat routing post-game vs active play.
 *
 * Conclusion (pas un bug) :
 * - Tant que `row.screen` est post-game, un client déjà sur Results (ou suppress)
 *   reste sur `declared` même si `state` contient déjà un active play.
 * - Convergence Guest : Event B (`row.screen` → prep/play).
 * - Ne jamais brancher `return skippedActivePlay` sans preuve de nouveau contrat.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

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
  getEffectiveSessionScreen,
  suppressSessionRoute,
  clearSessionRouteSuppress,
  isSessionRouteSuppressed,
  POST_GAME_SCREENS,
} = await import("../js/core/gameSync.js");
const {
  initRouter,
  registerScreen,
  navigate,
  getCurrentScreen,
  resetNav,
} = await import("../js/core/router.js");

const POST_GAME = new Set(["results", "leaderboard", "tiernight-end"]);
const GAME_SETUP = new Set([
  "hottake-prep",
  "speedvote-prep",
  "consensus-prep",
  "dilemma-prep",
]);

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
    "hottake-prep",
    "hottake",
    "consensus-prep",
  ]) {
    registerScreen(id, () => {});
  }
}

/** Miroir de resolveActivePlayScreen (sous-ensemble HotTake / Consensus). */
function resolveActivePlayScreenMirror(st) {
  if (st?.hotTake?.lobbyStarted) return "hottake";
  if (st?.consensus?.lobbyStarted) return "consensus";
  return null;
}

/**
 * Miroir fidèle de la branche post-game de getEffectiveSessionScreen (contrat actuel).
 * Documente que activePlay n'est PAS consommé sur cette branche.
 */
function getEffectivePostGameBranch(row, { local, suppressed = false, lobbyPrep = null }) {
  const declared = row.screen || null;
  const st = row.state || {};
  if (!declared || !POST_GAME.has(declared)) {
    const activePlay = resolveActivePlayScreenMirror(st);
    if (activePlay) return { effective: activePlay, branch: "active_play" };
    if (declared && GAME_SETUP.has(declared)) {
      return { effective: declared, branch: "declared_prep" };
    }
    return { effective: declared, branch: "declared_fallback" };
  }

  const skippedActivePlay = resolveActivePlayScreenMirror(st);
  if (POST_GAME.has(local) || suppressed) {
    return {
      effective: declared,
      skippedActivePlay,
      branch: "post_game_local_short_circuit",
    };
  }
  if (lobbyPrep) {
    return {
      effective: lobbyPrep,
      skippedActivePlay,
      branch: "lobby_prep_infer",
    };
  }
  return {
    effective: declared,
    skippedActivePlay,
    branch: "post_game_declared",
  };
}

function resultsRowWithActiveHotTake() {
  return {
    game_id: "menu",
    screen: "results",
    state: {
      hotTake: {
        lobbyStarted: true,
        phase: "voting",
        votes: { Alice: "Valide" },
      },
    },
  };
}

function prepRowHotTake() {
  return {
    game_id: "hottake",
    screen: "hottake-prep",
    state: {
      hotTake: {
        lobbyStarted: false,
        phase: null,
        ready: {},
      },
    },
  };
}

function playRowHotTake() {
  return {
    game_id: "hottake",
    screen: "hottake",
    state: {
      hotTake: {
        lobbyStarted: true,
        phase: "voting",
        votes: {},
      },
    },
  };
}

describe("AUDIT-010 - contrat miroir post-game vs active play", () => {
  it("stale screen=results + state active play + local Results → declared (pas play)", () => {
    const row = resultsRowWithActiveHotTake();
    const out = getEffectivePostGameBranch(row, { local: "results" });
    assert.equal(out.skippedActivePlay, "hottake", "active play détectable");
    assert.equal(out.effective, "results");
    assert.equal(out.branch, "post_game_local_short_circuit");
    assert.notEqual(out.effective, out.skippedActivePlay);
  });

  it("nominal Event B : screen=prep → Guest suit prep", () => {
    const out = getEffectivePostGameBranch(prepRowHotTake(), { local: "results" });
    assert.equal(out.effective, "hottake-prep");
    assert.equal(out.branch, "declared_prep");
  });

  it("nominal Event C : screen=play → Guest suit play", () => {
    const out = getEffectivePostGameBranch(playRowHotTake(), { local: "hottake-prep" });
    assert.equal(out.effective, "hottake");
    assert.equal(out.branch, "active_play");
  });

  it("A local+remote Results sans play → results", () => {
    const row = {
      screen: "results",
      game_id: "menu",
      state: { hotTake: { lobbyStarted: false, phase: "final" } },
    };
    const out = getEffectivePostGameBranch(row, { local: "results" });
    assert.equal(out.effective, "results");
    assert.equal(out.skippedActivePlay, null);
  });

  it("B local Results + remote Results + active play state → reste results", () => {
    const out = getEffectivePostGameBranch(resultsRowWithActiveHotTake(), {
      local: "results",
    });
    assert.equal(out.effective, "results");
  });

  it("C suppress + active play → reste declared results", () => {
    const out = getEffectivePostGameBranch(resultsRowWithActiveHotTake(), {
      local: "leaderboard",
      suppressed: true,
    });
    assert.equal(out.effective, "results");
    assert.equal(out.branch, "post_game_local_short_circuit");
  });

  it("D suppress retiré + screen prep → prep (convergence)", () => {
    const out = getEffectivePostGameBranch(prepRowHotTake(), {
      local: "results",
      suppressed: false,
    });
    assert.equal(out.effective, "hottake-prep");
  });

  it("restart Host/Guest : Results → Prep → Play sans blocage durable", () => {
    const timeline = [];
    timeline.push(
      getEffectivePostGameBranch(resultsRowWithActiveHotTake(), { local: "results" })
    );
    timeline.push(getEffectivePostGameBranch(prepRowHotTake(), { local: "results" }));
    timeline.push(getEffectivePostGameBranch(playRowHotTake(), { local: "hottake-prep" }));

    assert.equal(timeline[0].effective, "results");
    assert.equal(timeline[1].effective, "hottake-prep");
    assert.equal(timeline[2].effective, "hottake");
  });

  it("cas stale puis update screen=prep → convergence", () => {
    const stale = getEffectivePostGameBranch(resultsRowWithActiveHotTake(), {
      local: "results",
    });
    assert.equal(stale.effective, "results");
    assert.equal(stale.skippedActivePlay, "hottake");

    const next = getEffectivePostGameBranch(prepRowHotTake(), { local: "results" });
    assert.equal(next.effective, "hottake-prep");
  });

  it("lobbyPrep infer seulement hors short-circuit local post-game", () => {
    const blocked = getEffectivePostGameBranch(resultsRowWithActiveHotTake(), {
      local: "results",
      lobbyPrep: "hottake-prep",
    });
    assert.equal(blocked.effective, "results");

    const inferred = getEffectivePostGameBranch(resultsRowWithActiveHotTake(), {
      local: "game-select",
      lobbyPrep: "hottake-prep",
    });
    assert.equal(inferred.effective, "hottake-prep");
    assert.equal(inferred.branch, "lobby_prep_infer");
  });
});

describe("AUDIT-010 - getEffectiveSessionScreen réel", () => {
  beforeEach(() => {
    globalThis.requestAnimationFrame = (fn) => {
      fn(0);
      return 0;
    };
    ensureScreens();
    resetNav();
    clearSessionRouteSuppress();
    navigate("results");
    assert.equal(getCurrentScreen(), "results");
  });

  afterEach(() => {
    clearSessionRouteSuppress();
  });

  it("POST_GAME inclut results/leaderboard/tiernight-end", () => {
    assert.equal(POST_GAME_SCREENS.has("results"), true);
    assert.equal(POST_GAME_SCREENS.has("leaderboard"), true);
    assert.equal(POST_GAME_SCREENS.has("tiernight-end"), true);
  });

  it("Guest Results + screen results + hotTake lobbyStarted → results (contrat)", () => {
    assert.equal(
      getEffectiveSessionScreen(resultsRowWithActiveHotTake()),
      "results"
    );
  });

  it("Guest Results + screen hottake-prep → prep", () => {
    assert.equal(getEffectiveSessionScreen(prepRowHotTake()), "hottake-prep");
  });

  it("Guest Results + screen hottake + lobbyStarted → hottake", () => {
    assert.equal(getEffectiveSessionScreen(playRowHotTake()), "hottake");
  });

  it("isSessionRouteSuppressed protège le browsing Results", () => {
    suppressSessionRoute(60_000, "results");
    assert.equal(isSessionRouteSuppressed(), true);
    assert.equal(
      getEffectiveSessionScreen(resultsRowWithActiveHotTake()),
      "results"
    );
  });

  it("après clear suppress + Event B prep → prep", () => {
    suppressSessionRoute(60_000, "results");
    clearSessionRouteSuppress();
    assert.equal(isSessionRouteSuppressed(), false);
    assert.equal(getEffectiveSessionScreen(prepRowHotTake()), "hottake-prep");
  });
});

describe("AUDIT-010 - contrats source gameSync", () => {
  it("branche post-game ne consomme pas resolveActivePlayScreen pour le return", () => {
    const src = read("js/core/gameSync.js");
    const start = src.indexOf("export function getEffectiveSessionScreen");
    assert.ok(start >= 0);
    const block = src.slice(start, start + 2800);
    const postGameIdx = block.indexOf("POST_GAME_SCREENS.has(declared)");
    assert.ok(postGameIdx >= 0);
    const branch = block.slice(postGameIdx, postGameIdx + 900);
    assert.match(branch, /return declared/);
    assert.equal(/return\s+skippedActivePlay/.test(branch), false);
    assert.equal(/const skippedActivePlay\s*=/.test(branch), false);
    assert.match(branch, /AUDIT-010/);
  });

  it("sessionRouteRestartDecision documente le short-circuit Event A→B", () => {
    const src = read("tests/sessionRouteRestartDecision.test.js");
    assert.match(src, /post_game_local_short_circuit/);
    assert.match(src, /Event B/);
  });
});
