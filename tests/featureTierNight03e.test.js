/**
 * FEATURE-TIERNIGHT-03-E — navigation, CTA, replay, legacy, Rank Live isolation.
 */
import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  setTierNightSeriesUiEnabledForTests,
  TIER_NIGHT_SERIES_UI_GATE_KEY,
  isTierNightSeriesUiEnabled,
} from "../js/core/tierNightSeriesGate.js";
import { resolveTierNightRosterDestinationFromSharedState } from "../js/core/tierNightSeriesPrepContracts.js";
import { prepareTierNightSeriesLaunchAttempt } from "../js/core/tierNightSeriesLaunch.js";
import {
  mergeConsumedCustomTopicIds,
  listConsumedCustomTopicIdsFromSeries,
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
} from "../js/core/tierNightSeries.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

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

const {
  buildClearedTierNightSeriesLocalGame,
  buildClearedTierNightSeriesRemote,
  buildSeriesExitPrepReset,
  resolveChangeModeDestination,
  resolveReplayDestination,
  shouldReplayTierNightSeriesToPrep,
} = await import("../js/core/tierNightSeriesExitNav.js");
const { resolveTierNightSeriesScreenFromPhase } = await import(
  "../js/core/tierNightSeriesPlaySession.js"
);
const { markTierNightClassicStarted } = await import("../js/core/tierNightLiveSession.js");

const PARTICIPANTS = [
  { userId: "11111111-1111-4111-8111-111111111111", name: "Alice", emoji: "🙂" },
  { userId: "22222222-2222-4222-8222-222222222222", name: "Bob", emoji: "😎" },
];

describe("FEATURE-TIERNIGHT-03-E - between / end CTA (source)", () => {
  it("1. between → next round hôte (CTA + advance)", () => {
    const src = read("js/screens/tierNightBetween.js");
    assert.match(src, /btn-tiernight-next-theme/);
    assert.match(src, /▶ Thème suivant/);
    assert.match(src, /hostAdvanceTierNightSeriesRound/);
    assert.match(src, /canAdvanceTierNightSeriesFromPhase/);
  });

  it("2. between invité sans CTA autoritaire", () => {
    const src = read("js/screens/tierNightBetween.js");
    assert.match(src, /En attente de l’hôte/);
    assert.match(src, /hostOrAh/);
    assert.match(src, /realHost/);
    // Change mode derrière hostOrAh ; quit derrière realHost uniquement
    assert.match(src, /hostOrAh\s*\?\s*`[\s\S]*?btn-tiernight-change-mode/);
    assert.match(src, /realHost\s*\?\s*`[\s\S]*?btn-tiernight-quit-series/);
  });

  it("3. between → changer de mode → select (pas game-select exit)", () => {
    const src = read("js/screens/tierNightBetween.js");
    assert.match(src, /changeTierNightModeFromSeriesPlay/);
    assert.doesNotMatch(src, /data-nav="game-select"/);
    const dest = resolveChangeModeDestination();
    assert.equal(dest.screen, "tiernight-select");
    assert.equal(dest.params.step, "mode");
  });

  it("4. between → quitter (exitGame contrat)", () => {
    const src = read("js/screens/tierNightBetween.js");
    assert.match(src, /quitTierNightSeriesToGameSelect/);
    assert.match(src, /EXIT_GAME_LABEL/);
    assert.doesNotMatch(src, /Quitter TierNight/);
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /exitGameToGameSelect/);
    assert.match(read("js/core/exitGame.js"), /Arrêter la partie · Menu des jeux/);
  });

  it("5. end sans CTA next", () => {
    const src = read("js/screens/tierNightEnd.js");
    assert.doesNotMatch(src, /Thème suivant/);
    assert.doesNotMatch(src, /hostAdvanceTierNightSeriesRound/);
  });

  it("6. end → replay → prep (gate ON)", () => {
    const dest = resolveReplayDestination({ seriesUiEnabled: true });
    assert.equal(dest.screen, "tiernight-prep");
    const restart = read("js/core/restartGame.js");
    assert.match(restart, /shouldReplayTierNightSeriesToPrep/);
    assert.match(restart, /replayTierNightAfterSeriesEnd/);
    const end = read("js/screens/tierNightEnd.js");
    assert.match(end, /eveningRecapRestartButtonHtml/);
    assert.match(end, /changeTierNightModeFromSeriesPlay/);
  });
});

describe("FEATURE-TIERNIGHT-03-E - replay / queue / runId / consumed", () => {
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("7. replay produit une nouvelle queue uniquement au launch", () => {
    const cleared = buildClearedTierNightSeriesLocalGame({
      series: { phase: "series_end", queue: [{ topicId: "x" }] },
      runId: "old-run",
    });
    assert.equal(cleared.series, undefined);
    assert.equal(cleared.runId, null);
    assert.doesNotMatch(JSON.stringify(cleared), /queue/);

    const launch = read("js/core/tierNightSeriesLaunch.js");
    assert.match(launch, /createTierNightRunId/);
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.doesNotMatch(exit, /prepareTierNightSeriesLaunchAttempt/);
    assert.doesNotMatch(exit, /buildTierNightSeriesQueue/);
  });

  it("8. nouveau runId au relaunch (pas au clear/replay)", () => {
    const remote = buildClearedTierNightSeriesRemote();
    assert.equal(remote.runId, null);
    assert.equal(remote.series, null);

    const a = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      participants: PARTICIPANTS,
      rng: () => 0.1,
    });
    const b = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      participants: PARTICIPANTS,
      rng: () => 0.9,
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.notEqual(a.attempt.runId, b.attempt.runId);
    assert.notEqual(
      JSON.stringify(a.attempt.series.queue.map((q) => q.topicId)),
      JSON.stringify(b.attempt.series.queue.map((q) => q.topicId))
    );
  });

  it("9–11. consumed ledger préservé ; customs vidés à la sortie série ; Rank Live intact", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.doesNotMatch(exit, /consumedCustomRosterTopicIds/);
    assert.match(exit, /customRosterTopics:\s*\[\]/);
    assert.doesNotMatch(exit, /customTierLists/);

    const customId = "roster:custom-abc";
    const seriesLike = {
      queue: [
        {
          topicId: customId,
          topicSnapshot: { id: customId, custom: true, name: "Custom A" },
        },
      ],
    };
    const fromSeries = listConsumedCustomTopicIdsFromSeries(seriesLike);
    assert.ok(fromSeries.includes(customId));

    const preserved = mergeConsumedCustomTopicIds(["roster:custom-old"], seriesLike);
    assert.ok(preserved.includes("roster:custom-old"));
    assert.ok(preserved.includes(customId));

    const attempt = prepareTierNightSeriesLaunchAttempt({
      categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
      roundCount: 3,
      participants: PARTICIPANTS,
      customTopics: [
        {
          id: customId,
          name: "Custom A",
          emoji: "✨",
          items: ["Alice", "Bob"],
        },
        {
          id: "roster:custom-free",
          name: "Custom Free",
          emoji: "🆓",
          items: ["Alice", "Bob"],
        },
      ],
      excludeCustomIds: [customId],
      rng: () => 0,
    });
    assert.equal(attempt.ok, true);
    const ids = attempt.attempt.series.queue.map((q) => q.topicId);
    assert.equal(ids.includes(customId), false);
  });

  it("shouldReplay : series_end + gate → prep ; Rank Live → false", () => {
    assert.equal(
      shouldReplayTierNightSeriesToPrep({
        seriesUiEnabled: true,
        tierNight: { mode: "roster", series: { phase: "series_end" } },
        tierNightLive: { lobbyStarted: false, finished: true },
        tierNightMode: "roster",
      }),
      true
    );
    assert.equal(
      shouldReplayTierNightSeriesToPrep({
        seriesUiEnabled: true,
        tierNight: { mode: "live", series: null },
        tierNightLive: { lobbyStarted: false, finished: true },
        tierNightMode: "live",
      }),
      false
    );
    assert.equal(
      shouldReplayTierNightSeriesToPrep({
        seriesUiEnabled: false,
        tierNight: { mode: "roster", series: { phase: "series_end" } },
      }),
      false
    );
  });
});

describe("FEATURE-TIERNIGHT-03-E - legacy / gate / stale / resume", () => {
  afterEach(() => {
    setTierNightSeriesUiEnabledForTests(false);
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });

  it("12. legacy actif sous gate ON", () => {
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: { lobbyStarted: true, items: ["A", "B"] },
      seriesUiEnabled: true,
    });
    assert.equal(r.screen, "tiernight");
    assert.equal(r.reason, "legacy_active");
    assert.equal(r.gateIgnored, true);
  });

  it("13. replay legacy → prep série (shouldReplay + mark classic bloqué)", async () => {
    setTierNightSeriesUiEnabledForTests(true);
    assert.equal(
      shouldReplayTierNightSeriesToPrep({
        seriesUiEnabled: true,
        tierNight: {
          mode: "roster",
          lobbyStarted: false,
          recaps: [{ player: "Alice", placed: { S: ["Bob"] } }],
        },
        tierNightMode: "roster",
      }),
      true
    );
    const blocked = await markTierNightClassicStarted({
      topicId: "roster:who-drinks",
      mode: "roster",
      modifier: "normal",
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "SERIES_GATE_BLOCKS_CLASSIC");
  });

  it("14. gate OFF + série active suivie", () => {
    const between = resolveTierNightRosterDestinationFromSharedState({
      tierNight: {
        lobbyStarted: true,
        series: { phase: "between_rounds", queue: [{}, {}] },
      },
      seriesUiEnabled: false,
    });
    assert.equal(between.screen, "tiernight-between");
    assert.equal(between.gateIgnored, true);

    const ranking = resolveTierNightRosterDestinationFromSharedState({
      tierNight: {
        lobbyStarted: true,
        series: { phase: "ranking", queue: [{}] },
      },
      seriesUiEnabled: false,
    });
    assert.equal(ranking.screen, "tiernight");
  });

  it("15. declared screen stale corrigé par shared state", () => {
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: {
        lobbyStarted: false,
        series: { phase: "between_rounds", queue: [{}, {}] },
      },
      seriesUiEnabled: true,
      declaredScreen: "tiernight-select",
    });
    assert.equal(r.screen, "tiernight-between");
    assert.equal(r.gateIgnored, true);
  });

  it("16–17. reload between / series_end (mapping phase)", () => {
    assert.equal(
      resolveTierNightSeriesScreenFromPhase("between_rounds"),
      "tiernight-between"
    );
    assert.equal(resolveTierNightSeriesScreenFromPhase("series_end"), "tiernight-end");
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /phase === "between_rounds"/);
    assert.match(sync, /phase === "series_end"/);
    assert.match(sync, /phase === "ranking"/);
  });
});

describe("FEATURE-TIERNIGHT-03-E - Rank Live isolation", () => {
  it("18–19. Rank Live list / create / restart / reprise inchangés", () => {
    const nav = read("js/core/tierNightNav.js");
    assert.match(nav, /resolvedStep === "list"/);
    assert.match(nav, /resolvedMode = "live"/);

    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /step === "list"/);
    assert.match(select, /markTierNightLiveLobbyStarted/);

    const create = read("js/screens/tierNightCreate.js");
    assert.match(create, /step:\s*"list"/);
    assert.match(create, /mode:\s*"live"/);

    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.doesNotMatch(exit, /customTierLists/);
    assert.doesNotMatch(exit, /tiernight-live/);
    assert.doesNotMatch(exit, /markTierNightLive/);

    assert.equal(
      shouldReplayTierNightSeriesToPrep({
        seriesUiEnabled: true,
        tierNight: { mode: "live" },
        tierNightMode: "live",
      }),
      false
    );
  });

  it("20. aucun classic start sous gate ON", async () => {
    setTierNightSeriesUiEnabledForTests(true);
    assert.equal(isTierNightSeriesUiEnabled(), true);
    const res = await markTierNightClassicStarted({
      topicId: "roster:who-drinks",
      mode: "roster",
      modifier: "normal",
    });
    assert.equal(res.ok, false);
    assert.equal(res.code, "SERIES_GATE_BLOCKS_CLASSIC");
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
  });
});

describe("FEATURE-TIERNIGHT-03-E - phases / anti-double / rollback / preserve", () => {
  it("21. phase round_result retirée sans impasse", () => {
    assert.equal(resolveTierNightSeriesScreenFromPhase("round_result"), null);
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /phase === "round_result"/);
    assert.match(between, /navigate\("tiernight-prep"\)/);
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /phase === "ranking"\) return "tiernight"/);
    assert.doesNotMatch(
      sync,
      /if \(phase && phase !== "series_end"\) return "tiernight"/
    );
  });

  it("22. shape invalide sans navigation jouable incorrecte", () => {
    assert.equal(resolveTierNightSeriesScreenFromPhase("nope"), null);
    const r = resolveTierNightRosterDestinationFromSharedState({
      tierNight: { series: { phase: "round_result" } },
      seriesUiEnabled: true,
    });
    assert.equal(r.screen, "tiernight-prep");
    assert.equal(r.reason, "series_phase_invalid");
  });

  it("23. anti-double replay/change/quit", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /createActionLock/);
    assert.match(exit, /exitNavLock\.run/);
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /withClickLock/);
    assert.match(between, /exitLock/);
    const end = read("js/screens/tierNightEnd.js");
    assert.match(end, /withClickLock/);
    assert.match(end, /exitLock/);
  });

  it("24. rollback réseau des sorties autoritaires", () => {
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exit, /snapshotStatePatch/);
    assert.match(exit, /saveStatePatch\(previousPatch\)/);
    assert.match(exit, /rolledBack:\s*true/);
  });

  it("25. sortie série : clear customs session ; consumed/Rank Live hors patch", () => {
    delete globalThis[TIER_NIGHT_SERIES_UI_GATE_KEY];
    const exit = read("js/core/tierNightSeriesExitNav.js");
    assert.doesNotMatch(exit, /consumedCustomRosterTopicIds\s*:/);
    assert.match(exit, /customRosterTopics:\s*\[\]/);
    assert.doesNotMatch(exit, /customTierLists\s*:/);
    const prep = buildSeriesExitPrepReset(3);
    assert.equal(prep.setupEpoch, 4);
    assert.deepEqual(prep.ready, {});
    assert.equal(isTierNightSeriesUiEnabled(), true);
  });
});

describe("FEATURE-TIERNIGHT-03-E - parcours canonique (source)", () => {
  it("pas de Créer un thème en intermanche", () => {
    const between = read("js/screens/tierNightBetween.js");
    assert.doesNotMatch(between, /Créer un thème/);
    assert.doesNotMatch(between, /tiernight-create-roster/);
  });

  it("wizard steps morts — normalisés vers prep (F)", () => {
    const select = read("js/screens/tierNightSelect.js");
    assert.match(select, /LEGACY_SERIES_DEAD_STEPS/);
    assert.doesNotMatch(select, /topicStepHtml/);
  });
});
