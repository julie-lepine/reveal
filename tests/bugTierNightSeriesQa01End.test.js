/**
 * BUG-TIERNIGHT-SERIES-QA-01 — fin de série = session clôturée (contrats purs / source).
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("BUG-TIERNIGHT-SERIES-QA-01 - contrats fin", () => {
  it("isSessionInProgressPlay exclut tiernight-end (POST_GAME)", async () => {
    mock.module("../js/core/supabaseClient.js", {
      namedExports: {
        supabase: {},
        getSupabaseUserId: () => null,
        isSupabaseConfigured: () => false,
      },
    });
    const { POST_GAME_SCREENS, isSessionInProgressPlay, isOnPostGameScreen } = await import(
      "../js/core/gameSync.js"
    );
    assert.equal(POST_GAME_SCREENS.has("tiernight-end"), true);
    assert.equal(isOnPostGameScreen("tiernight-end"), true);
    assert.equal(isSessionInProgressPlay("tiernight-end"), false);
  });

  it("Rank Live : écran end partagé inchangé (mount + classic)", () => {
    const live = read("js/games/tierNightLive.js");
    const classic = read("js/games/tierNight.js");
    const end = read("js/screens/tierNightEnd.js");
    assert.match(live, /tiernight-end/);
    assert.match(classic, /tiernight-end/);
    assert.match(end, /mountTierNightEnd/);
    // Rank Live (hors série) conserve Voir les résultats
    assert.match(end, /Voir les résultats/);
  });

  it("finalize dernière manche enchaîne complete session", () => {
    const play = read("js/core/tierNightSeriesPlaySession.js");
    const idx = play.indexOf("export async function hostFinalizeTierNightSeriesRound");
    const body = play.slice(idx, idx + 4500);
    assert.match(body, /ensureTierNightSeriesSessionCompleted/);
    assert.match(body, /ALREADY_APPLIED/);
    assert.match(body, /series_end/);
  });
});
