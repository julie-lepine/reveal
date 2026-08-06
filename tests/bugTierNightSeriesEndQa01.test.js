/**
 * FEATURE-TIERNIGHT-03 — QA terrain post-F : fin de série, clivant, scoring UX, quit, customs.
 * Aucune SQL. Ne rouvre pas ready/custom/setupEpoch.
 */
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
  buildTierNightSeriesQueue,
  createTierNightSeriesState,
  isTierNightSeriesLastRound,
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
} = await import("../js/core/tierNightSeries.js");
const { TIER_NIGHT_ROSTER_TOPICS } = await import("../data/tierTopics.js");
const {
  normalizeControversialItemLabel,
  resolveControversialItemForDisplay,
} = await import("../js/core/tierNightControversialDisplay.js");
const {
  tierNightBetweenScoringExplainText,
  tierNightPointsHintText,
} = await import("../js/core/tierNightScoring.js");
const { EXIT_GAME_LABEL } = await import("../js/core/exitGame.js");
const {
  clearCustomRosterTopicsLocal,
  listCustomRosterTopics,
} = await import("../js/core/customRosterTopicSession.js");
const {
  getState,
  saveStatePatch,
  resetEveningState,
  resetGameSessionsOnly,
  addCustomRosterTopic,
  getCustomRosterTopics,
} = await import("../js/core/state.js");
const { buildSeriesExitLocalStatePatch } = await import(
  "../js/core/tierNightSeriesExitNav.js"
);
const {
  resolveTierNightSeriesScreenFromPhase,
  shouldPreferLocalSeriesOverSoftRefresh,
  resolvePostFinalizeNavigationPhase,
  assertCanFinalizeTierNightSeriesRound,
  applyAuthoritativeSeriesRpcState,
  applySoftRefreshSeriesRowIfNotRegression,
} = await import("../js/core/tierNightSeriesPlaySession.js");
const { applyRemoteEveningState } = await import("../js/core/gameSync.js");
const { CUSTOM_ROSTER_TOPIC_ID_PREFIX } = await import(
  "../js/core/customRosterTopics.js"
);

function makeRankingSeries(runId, roundCount = 3) {
  const built = buildTierNightSeriesQueue({
    runId,
    topics: TIER_NIGHT_ROSTER_TOPICS,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount,
    rng: () => 0,
  });
  assert.equal(built.ok, true);
  return createTierNightSeriesState({
    runId,
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount,
    queue: built.queue,
  }).series;
}

function makeLastRanking(runId, roundCount) {
  const series = makeRankingSeries(runId, roundCount);
  const lastIndex = roundCount - 1;
  const scored = [];
  for (let i = 0; i < lastIndex; i += 1) scored.push(`${runId}:${i}`);
  return {
    ...series,
    phase: "ranking",
    roundIndex: lastIndex,
    scoredRoundIds: scored,
    completedRoundIds: [...scored],
    roundHistory: scored.map((id, i) => ({
      roundId: id,
      roundIndex: i,
      topicSnapshot: series.queue[i].topicSnapshot,
      controversialItem: `Item${i}`,
      controversialSpread: 2,
    })),
  };
}

function renderControversialDom({ session, series, recaps, labelFn = (i) => i }) {
  const resolved = resolveControversialItemForDisplay({ session, series });
  if (!resolved.item) return "";
  const label = String(labelFn(resolved.item) ?? "").trim();
  if (!label || label === "undefined" || label === "null") return "";
  const votes = (recaps || []).filter(Boolean);
  if (votes.length < 2) return "";
  return `<div class="card tier-controversial-card"><p class="card-heading">🔥 L'item le plus clivant</p><p class="tier-controversial__item">« ${label} »</p></div>`;
}

describe("bugTierNightSeriesEndQa01 - dernière manche → series_end", () => {
  for (const roundCount of [3, 5, 8]) {
    it(`série ${roundCount} : index final ${roundCount - 1} → series_end`, () => {
      const runId = `run-${roundCount}`;
      const series = makeLastRanking(runId, roundCount);
      assert.equal(series.roundIndex, roundCount - 1);
      assert.equal(isTierNightSeriesLastRound(series), true);
      const guard = assertCanFinalizeTierNightSeriesRound({
        runId,
        series,
        force: true,
      });
      assert.equal(guard.ok, true);
      assert.equal(guard.isLast, true);

      const history = [
        ...series.roundHistory,
        {
          roundId: `${runId}:${series.roundIndex}`,
          roundIndex: series.roundIndex,
          topicSnapshot: series.queue[series.roundIndex].topicSnapshot,
        },
      ];
      const endSeries = {
        ...series,
        phase: "series_end",
        scoredRoundIds: [...series.scoredRoundIds, `${runId}:${series.roundIndex}`],
        completedRoundIds: [
          ...series.completedRoundIds,
          `${runId}:${series.roundIndex}`,
        ],
        roundHistory: history,
        roundRecap: history[history.length - 1],
      };
      assert.equal(endSeries.phase, "series_end");
      assert.equal(endSeries.roundHistory.length, roundCount);
      assert.equal(
        endSeries.scoredRoundIds.filter((id) => id === `${runId}:${series.roundIndex}`)
          .length,
        1
      );
      assert.equal(
        endSeries.completedRoundIds.filter((id) => id === `${runId}:${series.roundIndex}`)
          .length,
        1
      );
      assert.equal(resolveTierNightSeriesScreenFromPhase("series_end"), "tiernight-end");
      assert.equal(
        resolvePostFinalizeNavigationPhase({
          localApply: { ok: true, phase: "series_end" },
          resPhase: "series_end",
          isLast: true,
          series: endSeries,
        }),
        "series_end"
      );
    });
  }

  it("manche non finale → between_rounds", () => {
    const runId = "run-mid";
    const series = makeRankingSeries(runId, 5);
    assert.equal(isTierNightSeriesLastRound(series), false);
    assert.equal(
      resolvePostFinalizeNavigationPhase({
        localApply: { ok: true, phase: "between_rounds" },
        isLast: false,
        series: { ...series, phase: "between_rounds", roundIndex: 0 },
      }),
      "between_rounds"
    );
    assert.equal(
      resolveTierNightSeriesScreenFromPhase("between_rounds"),
      "tiernight-between"
    );
  });

  it("CTA Voir les résultats (force) utilise roundId/index actifs", () => {
    const runId = "run-force";
    const series = makeLastRanking(runId, 3);
    const guard = assertCanFinalizeTierNightSeriesRound({
      runId,
      series,
      force: true,
    });
    assert.equal(guard.ok, true);
    assert.equal(guard.roundId, `${runId}:2`);
    assert.equal(guard.roundIndex, 2);
    assert.equal(guard.isLast, true);
    const game = read("js/games/tierNight.js");
    assert.match(game, /hostFinalizeTierNightSeriesRound\(\{\s*\n\s*force:\s*true/s);
    assert.match(game, /Voir les résultats/);
  });

  it("force + auto finalize dernière manche → phase series_end (contrat nav)", () => {
    assert.equal(
      resolvePostFinalizeNavigationPhase({ isLast: true, resPhase: "series_end" }),
      "series_end"
    );
    assert.equal(
      resolvePostFinalizeNavigationPhase({
        isLast: true,
        localApply: { ok: true, phase: "series_end" },
      }),
      "series_end"
    );
  });

  it("double finalize → ALREADY_APPLIED / un seul scoring (ledger)", () => {
    const runId = "run-once";
    const series = makeLastRanking(runId, 3);
    const lastId = `${runId}:2`;
    const scored = {
      ...series,
      phase: "series_end",
      scoredRoundIds: [...series.scoredRoundIds, lastId],
      completedRoundIds: [...series.completedRoundIds, lastId],
    };
    const again = assertCanFinalizeTierNightSeriesRound({
      runId,
      series: scored,
      force: true,
    });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyApplied, true);
    assert.equal(again.phase, "series_end");
  });

  it("apply local result.state précède soft refresh ; soft refresh ne régresse pas series_end", () => {
    const play = read("js/core/tierNightSeriesPlaySession.js");
    const applyIdx = play.indexOf("applyAuthoritativeSeriesRpcState");
    const softIdx = play.indexOf("softRefreshAfterLocalApply");
    const navIdx = play.indexOf("navigateForTierNightSeriesPhase(phase)");
    assert.ok(applyIdx > 0 && softIdx > applyIdx && navIdx > softIdx);

    const local = {
      runId: "r1",
      series: {
        phase: "series_end",
        scoredRoundIds: ["r1:0", "r1:1", "r1:2"],
        roundHistory: [{}, {}, {}],
      },
    };
    const staleRemote = {
      runId: "r1",
      series: {
        phase: "between_rounds",
        scoredRoundIds: ["r1:0", "r1:1"],
        roundHistory: [{}, {}],
      },
    };
    assert.equal(shouldPreferLocalSeriesOverSoftRefresh(local, staleRemote), true);

    const phase = resolvePostFinalizeNavigationPhase({
      localApply: { ok: true, phase: "series_end" },
      resPhase: "series_end",
      isLast: true,
      series: local.series,
    });
    assert.equal(phase, "series_end");
  });

  it("soft-refresh inverse : remote series_end plus avancé gagne sur local between", () => {
    const runId = "r-remote-ahead";
    const localBetween = {
      runId,
      series: {
        phase: "between_rounds",
        roundIndex: 1,
        roundCount: 3,
        scoredRoundIds: [`${runId}:0`, `${runId}:1`],
        completedRoundIds: [`${runId}:0`, `${runId}:1`],
        roundHistory: [{ roundId: `${runId}:0` }, { roundId: `${runId}:1` }],
      },
    };
    const remoteEnd = {
      runId,
      series: {
        phase: "series_end",
        roundIndex: 2,
        roundCount: 3,
        scoredRoundIds: [`${runId}:0`, `${runId}:1`, `${runId}:2`],
        completedRoundIds: [`${runId}:0`, `${runId}:1`, `${runId}:2`],
        roundHistory: [
          { roundId: `${runId}:0` },
          { roundId: `${runId}:1` },
          { roundId: `${runId}:2`, controversialItem: "Zed", controversialSpread: 2 },
        ],
        roundRecap: {
          roundId: `${runId}:2`,
          controversialItem: "Zed",
          controversialSpread: 2,
        },
      },
      lobbyStarted: false,
    };

    assert.equal(
      shouldPreferLocalSeriesOverSoftRefresh(localBetween, remoteEnd),
      false,
      "remote plus avancé ne doit pas être traité comme régression"
    );

    saveStatePatch({ tierNightGame: { ...localBetween } });
    const soft = applySoftRefreshSeriesRowIfNotRegression({
      state: { tierNight: remoteEnd },
    });
    assert.equal(soft.applied, true);
    assert.equal(soft.skippedStale, undefined);
    assert.equal(getState().tierNightGame.series.phase, "series_end");
    assert.equal(getState().tierNightGame.series.scoredRoundIds.length, 3);
    assert.equal(getState().tierNightGame.series.roundHistory.length, 3);
    assert.equal(
      resolveTierNightSeriesScreenFromPhase(getState().tierNightGame.series.phase),
      "tiernight-end"
    );
    // Aucune clé locale stale ne réécrase : phase/ledgers = remote.
    assert.deepEqual(getState().tierNightGame.series.scoredRoundIds, remoteEnd.series.scoredRoundIds);
  });

  it("soft-refresh : phase identique mais ledger/history remote plus long → remote gagne", () => {
    const runId = "r-ledger";
    const local = {
      runId,
      series: {
        phase: "between_rounds",
        roundIndex: 1,
        scoredRoundIds: [`${runId}:0`],
        roundHistory: [{ roundId: `${runId}:0` }],
      },
    };
    const remote = {
      runId,
      series: {
        phase: "between_rounds",
        roundIndex: 1,
        scoredRoundIds: [`${runId}:0`, `${runId}:1`],
        completedRoundIds: [`${runId}:0`, `${runId}:1`],
        roundHistory: [{ roundId: `${runId}:0` }, { roundId: `${runId}:1` }],
        roundRecap: { roundId: `${runId}:1` },
      },
    };
    assert.equal(shouldPreferLocalSeriesOverSoftRefresh(local, remote), false);
    saveStatePatch({ tierNightGame: { ...local } });
    const soft = applySoftRefreshSeriesRowIfNotRegression({
      state: { tierNight: remote },
    });
    assert.equal(soft.applied, true);
    assert.equal(getState().tierNightGame.series.scoredRoundIds.length, 2);
    assert.equal(getState().tierNightGame.series.roundHistory.length, 2);
  });

  it("soft-refresh : runId différent → ne préfère pas local (pas de vérité permanente)", () => {
    const local = {
      runId: "run-A",
      series: {
        phase: "series_end",
        scoredRoundIds: ["run-A:0", "run-A:1", "run-A:2"],
        roundHistory: [{}, {}, {}],
      },
    };
    const remoteOtherRun = {
      runId: "run-B",
      series: {
        phase: "ranking",
        scoredRoundIds: [],
        roundHistory: [],
      },
    };
    assert.equal(shouldPreferLocalSeriesOverSoftRefresh(local, remoteOtherRun), false);
  });

  it("resolver series_end → tiernight-end ; between declared stale ne gagne pas", () => {
    assert.equal(resolveTierNightSeriesScreenFromPhase("series_end"), "tiernight-end");
    const cfg = read("js/core/tierNightConfig.js");
    assert.match(cfg, /series\?\.phase === "series_end"/);
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /phase === "series_end"\) return "tiernight-end"/);
    assert.match(sync, /shouldPreferTierNightEndRoute/);
  });

  it("aucun CTA next à end", () => {
    const end = read("js/screens/tierNightEnd.js");
    assert.doesNotMatch(end, /Thème suivant/);
    assert.doesNotMatch(end, /hostAdvanceTierNightSeriesRound/);
  });
});

describe("bugTierNightSeriesEndQa01 - item le plus clivant (matrice normalisation)", () => {
  const twoRecaps = [{ player: "A" }, { player: "B" }];

  it("1. nom valide → ligne affichée", () => {
    const r = resolveControversialItemForDisplay({
      session: { controversialItem: "Alice", controversialSpread: 2 },
    });
    assert.equal(r.item, "Alice");
    const html = renderControversialDom({
      session: { controversialItem: "Alice", controversialSpread: 2 },
      recaps: twoRecaps,
    });
    assert.match(html, /tier-controversial-card/);
    assert.match(html, /« Alice »/);
  });

  it("2–5. null / undefined / vide / littéral undefined → ligne absente", () => {
    for (const bad of [null, undefined, "", "   ", "undefined"]) {
      assert.equal(normalizeControversialItemLabel(bad), null, String(bad));
      const html = renderControversialDom({
        session: { controversialItem: bad, controversialSpread: 3 },
        recaps: twoRecaps,
      });
      assert.equal(html, "");
      assert.doesNotMatch(html, /tier-controversial/);
      assert.doesNotMatch(html, /undefined/);
    }
  });

  it("6. session absent → roundRecap valide", () => {
    const r = resolveControversialItemForDisplay({
      session: { controversialItem: null, controversialSpread: 0 },
      series: {
        roundRecap: { controversialItem: "RecapItem", controversialSpread: 2 },
      },
    });
    assert.equal(r.item, "RecapItem");
    assert.equal(r.source, "roundRecap");
  });

  it("7. roundRecap absent → roundHistory valide", () => {
    const r = resolveControversialItemForDisplay({
      session: {},
      series: {
        roundHistory: [
          { controversialItem: "HistItem", controversialSpread: 2, topicSnapshot: { name: "T" } },
        ],
      },
    });
    assert.equal(r.item, "HistItem");
    assert.equal(r.source, "roundHistory");
  });

  it("8. aucune source valide → aucun conteneur/label vide dans le DOM", () => {
    const html = renderControversialDom({
      session: { controversialItem: null },
      series: { roundRecap: null, roundHistory: [] },
      recaps: twoRecaps,
    });
    assert.equal(html, "");
    assert.doesNotMatch(html, /card-heading|tier-controversial|«\s*»/);
  });

  it("officiel / custom snapshot / custom supprimé restent lisibles via history", () => {
    const snap = { id: "roster:custom-x", name: "Qui amène le plus de drama ?", custom: true };
    const fromHistory = resolveControversialItemForDisplay({
      session: {},
      series: {
        phase: "series_end",
        roundHistory: [
          {
            controversialItem: "Bob",
            controversialSpread: 2,
            topicSnapshot: snap,
          },
        ],
      },
    });
    assert.equal(fromHistory.item, "Bob");
    assert.equal(
      fromHistory.source === "roundHistory" || fromHistory.item === "Bob",
      true
    );
  });
});

describe("bugTierNightSeriesEndQa01 - explication scoring + quit", () => {
  it("explication visible sur between, conforme barème proximité", () => {
    const text = tierNightBetweenScoringExplainText({ reverse: false });
    assert.match(text, /rapproche/);
    assert.match(text, /groupe/);
    const between = read("js/screens/tierNightBetween.js");
    assert.match(between, /tierNightBetweenScoringExplainText/);
    assert.match(between, /tier-between-scoring-explain/);
    assert.match(tierNightPointsHintText({ reverse: false }), /\+15/);
  });

  it("explication absente de Rank Live", () => {
    const live = read("js/games/tierNightLive.js");
    assert.doesNotMatch(live, /tierNightBetweenScoringExplainText/);
    const end = read("js/screens/tierNightEnd.js");
    assert.doesNotMatch(end, /tierNightBetweenScoringExplainText/);
  });

  it("libellé quitter = EXIT_GAME_LABEL ; autorité hôte réel inchangée", () => {
    assert.equal(EXIT_GAME_LABEL, "Arrêter la partie · Menu des jeux");
    const between = read("js/screens/tierNightBetween.js");
    const end = read("js/screens/tierNightEnd.js");
    assert.match(between, /EXIT_GAME_LABEL/);
    assert.match(end, /EXIT_GAME_LABEL/);
    assert.doesNotMatch(between, /Quitter TierNight/);
    assert.doesNotMatch(end, /Quitter TierNight/);
    const exitNav = read("js/core/tierNightSeriesExitNav.js");
    assert.match(exitNav, /canAuthorSeriesQuit/);
    assert.match(exitNav, /isLobbyHost\(\)/);
  });
});

/**
 * Cycle de vie customs (contrat terrain consolidé) :
 *
 * Clear distant autoritatif : clearTierNightCustomRosterTopicsAtExitBoundary
 *   → RPC clear_tiernight_custom_roster_topics (hôte réel).
 * Pendant series_end : catalogue peut rester ; snapshots history lisibles.
 * Frontière clear : quit / change mode / replay / menu (pas à series_end).
 */
describe("bugTierNightSeriesEndQa01 - customs fin de partie (cycle de vie)", () => {
  beforeEach(() => {
    resetEveningState();
    saveStatePatch({ customRosterTopics: [], customTierLists: [] });
  });
  afterEach(() => {
    resetEveningState();
  });

  it("1. customs présents pendant la série (catalogue session)", () => {
    assert.equal(addCustomRosterTopic({ name: "Thème A" }).ok, true);
    assert.equal(addCustomRosterTopic({ name: "Thème B" }).ok, true);
    assert.equal(getCustomRosterTopics().length, 2);
  });

  it("2. à series_end les snapshots history restent lisibles même si catalogue vidé", () => {
    const snap = {
      id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}drama`,
      name: "Custom drama",
      custom: true,
    };
    assert.equal(addCustomRosterTopic({ name: "Custom drama" }).ok, true);
    clearCustomRosterTopicsLocal();
    assert.equal(getCustomRosterTopics().length, 0);
    const label = snap.name;
    assert.equal(label, "Custom drama");
    const histName =
      resolveControversialItemForDisplay({
        session: {},
        series: {
          roundHistory: [
            {
              controversialItem: "PlayerX",
              controversialSpread: 2,
              topicSnapshot: snap,
            },
          ],
        },
      }).item;
    assert.equal(histName, "PlayerX");
  });

  it("3–4. hydrate epoch clear accepte catalogue vide (follow invité)", () => {
    saveStatePatch({
      customRosterTopics: [
        {
          id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}guest`,
          name: "Guest theme",
          custom: true,
          authorUid: "uid-guest",
          author: "Guest",
        },
      ],
      customRosterTopicsEpoch: 1,
    });
    assert.equal(getCustomRosterTopics().length, 1);
    applyRemoteEveningState({
      customRosterTopics: [],
      customRosterTopicsEpoch: 2,
      customRosterTopicsWritable: false,
      tierNight: {
        series: { phase: "between_rounds", roundHistory: [{ topicSnapshot: { name: "Snap" } }] },
      },
    });
    assert.deepEqual(getCustomRosterTopics(), []);
    assert.equal(getState().customRosterTopicsEpoch, 2);
  });

  it("5. sortie série / menu → local vide ; nouvelle entrée prep sans résidu", () => {
    assert.equal(addCustomRosterTopic({ name: "Survit sessions only" }).ok, true);
    resetGameSessionsOnly();
    assert.equal(getCustomRosterTopics().length, 1, "resetGameSessionsOnly préserve encore");
    const patch = buildSeriesExitLocalStatePatch({ previousSetupEpoch: 0 }).statePatch;
    assert.deepEqual(patch.customRosterTopics, []);
    saveStatePatch(patch);
    assert.equal(getCustomRosterTopics().length, 0);
    // Simule nouvelle entrée prep
    assert.equal(listCustomRosterTopics().length, 0);
  });

  it("6. clear local idempotent", () => {
    assert.equal(addCustomRosterTopic({ name: "Theme X" }).ok, true);
    assert.equal(clearCustomRosterTopicsLocal().cleared, true);
    assert.equal(clearCustomRosterTopicsLocal().alreadyEmpty, true);
    assert.equal(getCustomRosterTopics().length, 0);
  });

  it("7–8. clear distant host-only (plus ownership-only seul)", () => {
    const sql = read("supabase/feature-tiernight-03-clear-custom-roster-topics.sql");
    assert.match(sql, /clear_tiernight_custom_roster_topics/);
    assert.match(sql, /is_lobby_host/);
    const clear = read("js/core/tierNightCustomRosterClear.js");
    assert.match(clear, /clearTierNightCustomRosterTopicsAtExitBoundary/);
    assert.match(clear, /isLobbyHost/);
  });

  it("9. customTierLists Rank Live préservé", () => {
    assert.equal(addCustomRosterTopic({ name: "Soirée" }).ok, true);
    saveStatePatch({
      customTierLists: [{ id: "live-1", name: "Live", items: ["a", "b"] }],
    });
    clearCustomRosterTopicsLocal();
    assert.equal(getCustomRosterTopics().length, 0);
    assert.equal(getState().customTierLists[0].id, "live-1");
    resetEveningState();
    assert.equal(getCustomRosterTopics().length, 0);
    // resetEveningState ne touche pas customTierLists
    assert.equal(getState().customTierLists?.[0]?.id, "live-1");
  });

  it("10. history/queue snapshots préservés après clear catalogue", () => {
    const queueSnap = { id: "roster:custom-keep", name: "Keep me", custom: true };
    saveStatePatch({
      tierNightGame: {
        runId: "run-snap",
        series: {
          phase: "series_end",
          queue: [{ topicId: queueSnap.id, topicSnapshot: queueSnap }],
          roundHistory: [
            {
              topicSnapshot: queueSnap,
              controversialItem: "P1",
              controversialSpread: 1,
            },
          ],
        },
        customRosterTopics: undefined,
      },
      customRosterTopics: [
        { id: `${CUSTOM_ROSTER_TOPIC_ID_PREFIX}keep`, name: queueSnap.name, custom: true },
      ],
    });
    clearCustomRosterTopicsLocal();
    assert.equal(getCustomRosterTopics().length, 0);
    assert.equal(
      getState().tierNightGame.series.roundHistory[0].topicSnapshot.name,
      "Keep me"
    );
    assert.equal(getState().tierNightGame.series.queue[0].topicSnapshot.name, "Keep me");
  });

  it("11. chemins source : frontière clear câblée ; consumed hors clear customs", () => {
    assert.match(
      read("js/core/tierNightSeriesExitNav.js"),
      /clearTierNightCustomRosterTopicsAtExitBoundary/
    );
    assert.match(read("js/core/gameSync.js"), /clearTierNightCustomRosterTopicsAtExitBoundary/);
    assert.match(read("js/core/exitGame.js"), /clearTierNightCustomRosterTopicsAtExitBoundary/);
    assert.match(read("js/core/tierNightSeriesExitNav.js"), /customRosterTopics:\s*\[\]/);
    const clearLocal = read("js/core/customRosterTopicSession.js").match(
      /export function clearCustomRosterTopicsLocal\(\) \{[\s\S]*?\n\}/
    )?.[0];
    assert.ok(clearLocal);
    assert.doesNotMatch(clearLocal, /consumedCustomRosterTopicIds/);
  });

  it("preuve : aucune SQL nouvelle / ready guest / D1-bis non touchés", () => {
    const play = read("js/core/tierNightSeriesPlaySession.js");
    assert.doesNotMatch(play, /CREATE OR REPLACE FUNCTION/);
    assert.match(
      read("supabase/feature-tiernight-03-prep-guest-contribute.sql"),
      /expectedSetupEpoch|pool_invalidate/i
    );
    const guestBug = read("tests/bugTierNightPrepGuest01.test.js");
    assert.match(guestBug, /setupEpoch|expectedSetupEpoch|poolInvalidate/i);
  });
});

describe("bugTierNightSeriesEndQa01 - apply series_end avec recap", () => {
  it("applyAuthoritativeSeriesRpcState conserve phase series_end", () => {
    const runId = "run-end-apply";
    const base = makeLastRanking(runId, 3);
    const lastId = `${runId}:2`;
    const endSeries = {
      ...base,
      phase: "series_end",
      scoredRoundIds: [...base.scoredRoundIds, lastId],
      completedRoundIds: [...base.completedRoundIds, lastId],
      roundHistory: [
        ...base.roundHistory,
        {
          roundId: lastId,
          controversialItem: "Eve",
          controversialSpread: 2,
          topicSnapshot: base.queue[2].topicSnapshot,
          recaps: [
            { player: "A", placed: { S: ["Eve"], A: [], B: [], C: [], D: [] } },
            { player: "B", placed: { S: [], A: ["Eve"], B: [], C: [], D: [] } },
          ],
        },
      ],
      roundRecap: {
        roundId: lastId,
        controversialItem: "Eve",
        controversialSpread: 2,
        topicSnapshot: base.queue[2].topicSnapshot,
        recaps: [
          { player: "A", placed: { S: ["Eve"], A: [], B: [], C: [], D: [] } },
          { player: "B", placed: { S: [], A: ["Eve"], B: [], C: [], D: [] } },
        ],
      },
    };
    const res = applyAuthoritativeSeriesRpcState(
      {
        tierNight: {
          runId,
          lobbyStarted: false,
          series: endSeries,
          recap: {
            runId,
            listName: endSeries.queue[2].topicSnapshot.name,
            controversialItem: "Eve",
            controversialSpread: 2,
            recaps: endSeries.roundRecap.recaps,
            consensus: { S: [], A: ["Eve"], B: [], C: [], D: [] },
          },
        },
      },
      { runId, expectScoredRoundId: lastId }
    );
    assert.equal(res.ok, true);
    assert.equal(res.phase, "series_end");
    const resolved = resolveControversialItemForDisplay({
      session: getState().tierNightGame,
      series: getState().tierNightGame?.series,
    });
    assert.equal(resolved.item, "Eve");
  });
});
