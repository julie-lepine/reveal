/**
 * FEATURE-TIERNIGHT-03-D — intermanches série (between_rounds).
 *
 * Données dérivées de l’état partagé (roundRecap / roundHistory / queue).
 * Hôte : CTA « Thème suivant » → commitTierNightSeriesNextRound.
 * Invités : attente.
 */
import { getState, setLastGame } from "../core/state.js";
import {
  isGameSyncActive,
  isLobbyHost,
  canActAsHost,
  onGameSessionChange,
  getCachedGameSession,
  refreshGameSession,
  getEffectiveSessionScreen,
} from "../core/gameSync.js";
import {
  getActiveTierNightSeriesRound,
  getTierNightSeriesProgress,
  isTierNightSeriesLastRound,
} from "../core/tierNightSeries.js";
import {
  canAdvanceTierNightSeriesFromPhase,
  hostAdvanceTierNightSeriesRound,
  mapTierNightSeriesRpcErrorToUx,
  navigateForTierNightSeriesPhase,
  resolveTierNightSeriesScreenFromPhase,
  TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY,
} from "../core/tierNightSeriesPlaySession.js";
import { createActionLock, withClickLock } from "../core/actionLock.js";
import { gameCumulativeScoresHtml, refreshGameScoresBox } from "../core/gameScores.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { showAppAlert } from "../core/dialog.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { TIER_LEVELS, TIER_COLORS } from "../../data/tierTopics.js";
import {
  changeTierNightModeFromSeriesPlay,
  quitTierNightSeriesToGameSelect,
} from "../core/tierNightSeriesExitNav.js";

export { TIER_NIGHT_SERIES_ADVANCE_FIELD_POLICY };

function getSeriesTn() {
  return (
    getCachedGameSession()?.state?.tierNight ||
    getState().tierNightGame ||
    null
  );
}

function consensusBoardHtml(consensus) {
  if (!consensus) return "";
  const hasItems = TIER_LEVELS.some((t) => (consensus[t] || []).length > 0);
  if (!hasItems) return "";
  return `
    <div class="card tier-consensus-card">
      <p class="card-heading">📊 Classement du groupe</p>
      <div class="tier-board tier-board--recap">
        ${TIER_LEVELS.map(
          (tier) => `
          <div class="tier-row">
            <span class="tier-label" style="--tier-color:${TIER_COLORS[tier]}">${tier}</span>
            <div class="tier-items">
              ${(consensus[tier] || [])
                .map(
                  (item) => `
                <span class="tier-chip tier-chip--static" style="--tier-color:${TIER_COLORS[tier]}">${escapeHtml(item)}</span>`
                )
                .join("")}
            </div>
          </div>`
        ).join("")}
      </div>
    </div>`;
}

export function mountTierNightBetween(app) {
  const mount = createMountGuard("tiernight-between");
  const advanceLock = createActionLock();
  const exitLock = createActionLock();
  let advancing = false;

  function syncPhaseOrLeave() {
    const tn = getSeriesTn();
    const phase = tn?.series?.phase;
    if (phase === "round_result") {
      // Option A D1-bis : phase retirée — pas d’écran between / pas d’impasse sync.
      navigate("tiernight-prep");
      return false;
    }
    const target = resolveTierNightSeriesScreenFromPhase(phase);
    if (target && target !== "tiernight-between") {
      navigateForTierNightSeriesPhase(phase);
      return false;
    }
    if (!phase || phase !== "between_rounds") {
      if (phase === "series_end") navigateForTierNightSeriesPhase("series_end");
      else if (phase === "ranking") navigateForTierNightSeriesPhase("ranking");
      else navigate("tiernight-select");
      return false;
    }
    return true;
  }

  async function onNextTheme() {
    if (advancing) return;
    if (!(isLobbyHost() || canActAsHost())) return;
    const tn = getSeriesTn();
    if (isTierNightSeriesLastRound(tn?.series)) return;
    // SQL n’accepte que between_rounds.
    if (!canAdvanceTierNightSeriesFromPhase(tn?.series?.phase)) return;

    advancing = true;
    try {
      const res = await hostAdvanceTierNightSeriesRound({
        shouldContinue: () => mount.isMounted() && mount.isCurrentMount(),
      });
      if (!mount.isMounted()) return;
      if (res?.skipped) return;
      if (res?.ok === false && !res?.stale) {
        const ux = res.ux || mapTierNightSeriesRpcErrorToUx(res.code, "advance");
        if (ux.message) {
          await showAppAlert(ux.message, {
            title: "Manche suivante",
            icon: "⚠️",
          });
        }
        if (mount.isMounted()) render();
      }
    } finally {
      advancing = false;
    }
  }

  async function onChangeMode() {
    if (!(isLobbyHost() || canActAsHost())) return;
    await changeTierNightModeFromSeriesPlay({
      shouldContinue: () => mount.isMounted() && mount.isCurrentMount(),
    });
  }

  async function onQuit() {
    // Quit = end session pour tous → hôte réel uniquement (pas acting host).
    if (isGameSyncActive() && !isLobbyHost()) return;
    await quitTierNightSeriesToGameSelect({
      shouldContinue: () => mount.isMounted() && mount.isCurrentMount(),
    });
  }

  function render() {
    if (!mount.isMounted()) return;
    if (!syncPhaseOrLeave()) return;

    const tn = getSeriesTn();
    const series = tn?.series;
    const progress = getTierNightSeriesProgress(series);
    const active = getActiveTierNightSeriesRound(series);
    const recap = series?.roundRecap || null;
    const snap = recap?.topicSnapshot || (active.ok ? active.round?.topicSnapshot : null);
    const topicName =
      recap?.topicSnapshot?.name ||
      snap?.name ||
      tn?.listName ||
      "Thème";
    const topicEmoji = recap?.topicSnapshot?.emoji || snap?.emoji || "🏆";
    const roundLabel =
      progress.ok && progress.roundIndex != null && progress.roundCount != null
        ? `Thème ${progress.roundIndex + 1} sur ${progress.roundCount}`
        : "";
    const hostOrAh = !isGameSyncActive() || isLobbyHost() || canActAsHost();
    const realHost = !isGameSyncActive() || isLobbyHost();
    const isLast = isTierNightSeriesLastRound(series);
    const phaseOk = canAdvanceTierNightSeriesFromPhase(series?.phase);
    const showNext = hostOrAh && !isLast && !advancing && phaseOk;

    setLastGame("tiernight");

    app.innerHTML = pageShell({
      backTarget: "back",
      scroll: true,
      content: `
        <p class="label-upper label-upper--gold">🏆 Tier Night · Série</p>
        <h2 class="screen-title">Résultat de manche</h2>
        <p class="game-intro">${escapeHtml(topicEmoji)} ${escapeHtml(topicName)}${
        roundLabel ? ` · ${escapeHtml(roundLabel)}` : ""
      }</p>

        ${consensusBoardHtml(recap?.consensus)}

        ${
          Array.isArray(recap?.recaps) && recap.recaps.length
            ? `<div class="card">
                <p class="card-heading">Scores de la manche</p>
                <ul class="score-list">
                  ${recap.recaps
                    .slice()
                    .sort(
                      (a, b) =>
                        (Number(b.consensusPoints) || 0) + (Number(b.outsiderBonus) || 0) -
                        ((Number(a.consensusPoints) || 0) + (Number(a.outsiderBonus) || 0))
                    )
                    .map((r) => {
                      const pts =
                        (Number(r.consensusPoints) || 0) + (Number(r.outsiderBonus) || 0);
                      return `<li><strong>${escapeHtml(r.player || "?")}</strong> · +${pts}</li>`;
                    })
                    .join("")}
                </ul>
              </div>`
            : ""
        }

        ${gameCumulativeScoresHtml({
          gameId: "tiernight",
          gameLabel: "Tier Night",
          title: "Cumul des scores",
        })}

        <div class="tier-between-actions">
          ${
            showNext
              ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-tiernight-next-theme">▶ Thème suivant</button>`
              : hostOrAh && isLast
                ? `<p class="hint">Fin de série…</p>`
                : `<p class="hint">En attente de l’hôte…</p>`
          }
          ${
            hostOrAh
              ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-tiernight-change-mode">⇄ Changer de mode</button>`
              : ""
          }
          ${
            realHost
              ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-tiernight-quit-series">✕ Quitter TierNight</button>`
              : ""
          }
        </div>
      `,
    });

    bindNav(app);
    const nextBtn = app.querySelector("#btn-tiernight-next-theme");
    if (nextBtn) {
      nextBtn.addEventListener(
        "click",
        withClickLock(() => onNextTheme(), { lock: advanceLock })
      );
    }
    const changeBtn = app.querySelector("#btn-tiernight-change-mode");
    if (changeBtn) {
      changeBtn.addEventListener(
        "click",
        withClickLock(() => onChangeMode(), { lock: exitLock })
      );
    }
    const quitBtn = app.querySelector("#btn-tiernight-quit-series");
    if (quitBtn) {
      quitBtn.addEventListener(
        "click",
        withClickLock(() => onQuit(), { lock: exitLock })
      );
    }
    if (isGameSyncActive()) {
      refreshGameScoresBox(app, {
        gameId: "tiernight",
        gameLabel: "Tier Night",
        title: "Cumul des scores",
      });
    }
  }

  const unsub = onGameSessionChange((row) => {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    const effective = getEffectiveSessionScreen(row);
    if (effective && effective !== "tiernight-between") {
      const phase = row?.state?.tierNight?.series?.phase;
      if (phase) navigateForTierNightSeriesPhase(phase);
      else navigate(effective);
      return;
    }
    render();
  });

  void refreshGameSession().finally(() => {
    if (mount.isMounted()) render();
  });
  render();

  return () => {
    mount.dispose();
    unsub?.();
  };
}
