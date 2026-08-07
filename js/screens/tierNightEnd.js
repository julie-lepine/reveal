import { TIER_LEVELS, TIER_COLORS } from "../../data/tierTopics.js";
import {
  getTierNightRecaps,
  getTierNightSession,
  getTierNightScoreBreakdownForPlayer,
} from "../core/tierNightSession.js";
import { getTierListById } from "../core/tierLists.js";
import { getTierNightTopicId, getLocalDisplayName, setLastGame, getState } from "../core/state.js";
import { setLobbyWaiting } from "../core/lobby.js";
import {
  completeGameSession,
  isGameSyncActive,
  isLobbyHost,
  canActAsHost,
  onGameSessionChange,
  suppressSessionRoute,
  refreshEveningScoresFromSession,
  refreshGameSession,
  ensureTierNightRecapsFromRemote,
  getCachedGameSession,
  returnToGameSelect,
} from "../core/gameSync.js";
import {
  gameCumulativeScoresHtml,
  refreshGameScoresBox,
} from "../core/gameScores.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import {
  eveningRecapRestartButtonHtml,
  bindRestartGameButtons,
} from "../core/restartGame.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { createActionLock, withClickLock } from "../core/actionLock.js";
import {
  changeTierNightModeFromSeriesPlay,
  quitTierNightSeriesToGameSelect,
} from "../core/tierNightSeriesExitNav.js";
import { EXIT_GAME_LABEL } from "../core/exitGame.js";
import { resolveControversialItemForDisplay } from "../core/tierNightControversialDisplay.js";

function tierOfItemIn(placed, item) {
  for (const tier of TIER_LEVELS) {
    if ((placed?.[tier] || []).includes(item)) return tier;
  }
  return null;
}

/** Pour le mode roster : préfixe les noms de joueurs par leur emoji. */
function makeItemLabel(session, recaps) {
  const isRoster = String(session.topicId || "").startsWith("roster:");
  if (!isRoster) return (item) => item;
  const emojiByName = {};
  recaps.forEach((r) => {
    emojiByName[r.player] = r.emoji;
  });
  return (item) => (emojiByName[item] ? `${emojiByName[item]} ${item}` : item);
}

/** Board du consensus du groupe (moyennes), affiché dans le récap. */
function consensusBoardHtml(consensus, labelFn = (i) => i) {
  if (!consensus) return "";
  const hasItems = TIER_LEVELS.some((t) => (consensus[t] || []).length > 0);
  if (!hasItems) return "";
  return `
    <div class="card tier-consensus-card">
      <p class="card-heading">📊 Le classement du groupe</p>
      <div class="tier-board tier-board--recap">
        ${TIER_LEVELS.map(
          (tier) => `
          <div class="tier-row">
            <span class="tier-label" style="--tier-color:${TIER_COLORS[tier]}">${tier}</span>
            <div class="tier-items">
              ${(consensus[tier] || [])
                .map(
                  (item) => `
                <span class="tier-chip tier-chip--static" style="--tier-color:${TIER_COLORS[tier]}">${escapeHtml(labelFn(item))}</span>`
                )
                .join("")}
            </div>
          </div>`
        ).join("")}
      </div>
    </div>`;
}

/**
 * UX-TIERNIGHT-END-02 - détail scoring intégré à la carte récap locale uniquement.
 * Autres joueurs : tierlist compacte inchangée.
 */
function recapCardHtml(r, { isLocal = false, breakdown = null, labelFn = (i) => i } = {}) {
  const scoreByItem = new Map(
    (breakdown?.rows || []).map((row) => [row.item, row])
  );
  const hasLocalScores = isLocal && scoreByItem.size > 0;

  const tiersHtml = hasLocalScores
    ? TIER_LEVELS.map((tier) => {
        const items = r.placed?.[tier] || [];
        if (!items.length) return "";
        return items
          .map((item) => {
            const row = scoreByItem.get(item);
            const pts = row?.pts ?? 0;
            const consensusTier = row?.consensusTier || "?";
            return `
                <div class="recap-tier recap-tier--scored">
                  <span class="recap-tier__label" style="color:${TIER_COLORS[tier]}">${tier}</span>
                  <span class="recap-tier__items">${escapeHtml(labelFn(item))}</span>
                  <span class="recap-tier__meta">groupe ${escapeHtml(consensusTier)} · <strong class="${pts > 0 ? "recap-tier__pts--gain" : ""}">${pts > 0 ? `+${pts}` : "0"}</strong></span>
                </div>`;
          })
          .join("");
      }).join("")
    : TIER_LEVELS.map((tier) => {
        const items = r.placed?.[tier] || [];
        if (!items.length) return "";
        return `
                <div class="recap-tier">
                  <span class="recap-tier__label" style="color:${TIER_COLORS[tier]}">${tier}</span>
                  <span class="recap-tier__items">${items.map((i) => escapeHtml(labelFn(i))).join(" · ")}</span>
                </div>`;
      }).join("");

  const outsiderHtml =
    hasLocalScores && breakdown.outsiderBonus > 0
      ? `
              <div class="recap-tier recap-tier--bonus">
                <span class="recap-tier__label">🎖️</span>
                <span class="recap-tier__items">Bonus outsider</span>
                <span class="recap-tier__meta"><strong class="recap-tier__pts--gain">+${breakdown.outsiderBonus}</strong></span>
              </div>`
      : "";

  const hintHtml = hasLocalScores
    ? `<p class="recap-card__hint">${
        breakdown.reverse
          ? "Mode à contre-courant"
          : "+15 même tier · +10 à 1 écart (moyenne)"
      }</p>`
    : "";

  return `
            <div class="card recap-card${isLocal ? " recap-card--local" : ""}">
              <div class="recap-card__head">
                <span class="recap-card__avatar" style="background:${escapeHtml(r.color || "rgba(255,255,255,.2)")}">${escapeHtml(r.emoji || "🙂")}</span>
                <span class="recap-card__name">${escapeHtml(r.player)}</span>
                <span class="recap-card__pts">+${r.consensusPoints ?? 0} pts</span>
              </div>
              ${hintHtml}
              ${tiersHtml}
              ${outsiderHtml}
            </div>`;
}

/** Mise en scène de l'item le plus clivant (#1) + bonus outsider (#3). */
function controversialHtml(session, recaps, labelFn = (i) => i, series = null) {
  const resolved = resolveControversialItemForDisplay({ session, series });
  const item = resolved.item;
  if (!item) return "";
  const label = normalizeLabel(labelFn(item));
  if (!label) return "";
  const votes = recaps
    .map((r) => ({ ...r, tier: tierOfItemIn(r.placed, item) }))
    .filter((r) => r.tier);
  if (votes.length < 2) return "";

  const outsiders = votes.filter((r) => (r.outsiderBonus ?? 0) > 0);
  const outsiderBonus = outsiders[0]?.outsiderBonus ?? 0;
  const outsiderLine = outsiders.length
    ? `<p class="tier-controversial__outsider">🎖️ Avis le plus tranché : ${outsiders
        .map((r) => escapeHtml(r.player))
        .join(", ")} · +${outsiderBonus} pts outsider</p>`
    : "";

  return `
    <div class="card tier-controversial-card">
      <p class="card-heading">🔥 L'item le plus clivant</p>
      <p class="tier-controversial__item">« ${escapeHtml(label)} »</p>
      <p class="hint tier-controversial__sub">Personne n'était d'accord sur celui-là.</p>
      <div class="tier-controversial__votes">
        ${votes
          .map(
            (r) => `
          <span class="tier-controversial__vote ${(r.outsiderBonus ?? 0) > 0 ? "tier-controversial__vote--outsider" : ""}" style="--tier-color:${TIER_COLORS[r.tier]}" title="${escapeHtml(r.player)}">
            <span class="recap-card__avatar" style="background:${escapeHtml(r.color || "rgba(255,255,255,.2)")}">${escapeHtml(r.emoji || "🙂")}</span>
            <span class="tier-controversial__badge">${r.tier}</span>
          </span>`
          )
          .join("")}
      </div>
      ${outsiderLine}
    </div>`;
}

function normalizeLabel(raw) {
  if (raw == null) return "";
  const t = String(raw).trim();
  if (!t || t === "undefined" || t === "null") return "";
  return t;
}

export function mountTierNightEnd(app) {
  const mount = createMountGuard();
  const exitLock = createActionLock();
  let session = getTierNightSession();
  let recaps = getTierNightRecaps();
  const localName = getLocalDisplayName();
  let bootstrapping = false;

  function reloadSession() {
    session = getTierNightSession();
    recaps = getTierNightRecaps();
  }

  async function onChangeMode() {
    // BUG-MP-NAV-01B CAS A : frontière soirée = hôte réel (pas AH).
    if (isGameSyncActive() && !isLobbyHost()) return;
    await changeTierNightModeFromSeriesPlay({
      shouldContinue: () => mount.isMounted() && mount.isCurrentMount(),
    });
  }

  async function onQuit() {
    if (isGameSyncActive() && !isLobbyHost()) return;
    await quitTierNightSeriesToGameSelect({
      shouldContinue: () => mount.isMounted() && mount.isCurrentMount(),
    });
  }

  async function bootstrapRecaps() {
    if (bootstrapping) return;
    bootstrapping = true;
    try {
      const topicId = getTierNightTopicId();
      const list = topicId ? getTierListById(topicId) : null;

      if (isGameSyncActive()) {
        const maxAttempts = 12;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          if (!mount.isMounted()) return;
          if (!mount.isCurrentMount()) return;
          await ensureTierNightRecapsFromRemote(list);
          if (!mount.isMounted()) return;
          if (!mount.isCurrentMount()) return;
          reloadSession();
          const ready =
            getTierNightRecaps().length > 0 &&
            getTierNightRecaps().some(
              (r) => Object.values(r.placed || {}).flat().length > 0
            );
          if (ready) break;
          await new Promise((r) => setTimeout(r, 450));
        }
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
        if (!isLobbyHost()) {
          await refreshEveningScoresFromSession();
        }
      }
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      reloadSession();
      render();
    } finally {
      bootstrapping = false;
    }
  }

  async function goToResults() {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    setLastGame({
      gameId: "tiernight",
      title: "Tier Night",
      summary: `« ${session.listName || "Tier list"} » · +${session.localConsensusPoints || 0} pts consensus`,
    });

    const resultsNav = { navStack: ["home", "lobby", "game-select", "results"] };

    if (isGameSyncActive()) {
      if (isLobbyHost()) {
        try {
          await completeGameSession({ gameId: "tiernight", screen: "results", state: {} });
        } catch (e) {
          console.warn("REVEAL completeGameSession:", e);
          if (!mount.isMounted()) return;
          if (!mount.isCurrentMount()) return;
          navigate("results", resultsNav);
        }
      } else {
        suppressSessionRoute(120000);
        navigate("results", resultsNav);
      }
      return;
    }

    await setLobbyWaiting();
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    navigate("results", resultsNav);
  }

  /** Série déjà clôturée : sortie soirée / menu jeux (pas de 2ᵉ complete). */
  async function continueEvening() {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    setLastGame({
      gameId: "tiernight",
      title: "Tier Night",
      summary: `Série terminée · +${session.localConsensusPoints || 0} pts dernière manche`,
    });
    const stack = { navStack: ["home", "lobby", "game-select"] };
    if (isGameSyncActive()) {
      if (isLobbyHost() || canActAsHost()) {
        try {
          await returnToGameSelect({
            shouldContinue: () => mount.isMounted() && mount.isCurrentMount(),
          });
        } catch (e) {
          console.warn("REVEAL returnToGameSelect:", e);
          if (!mount.isMounted()) return;
          suppressSessionRoute(120000);
          navigate("game-select", stack);
        }
      } else {
        suppressSessionRoute(120000);
        navigate("game-select", stack);
      }
      return;
    }
    await setLobbyWaiting();
    if (!mount.isMounted()) return;
    navigate("game-select", stack);
  }

  function render() {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    reloadSession();
    const labelFn = makeItemLabel(session, recaps);
    const localBreakdown = getTierNightScoreBreakdownForPlayer(localName, session);
    const series = getState().tierNightGame?.series || getCachedGameSession()?.state?.tierNight?.series;
    const isSeriesEnd = series?.phase === "series_end";
    const realHost = !isGameSyncActive() || isLobbyHost();
    const history = Array.isArray(series?.roundHistory) ? series.roundHistory : [];
    const seriesHistoryHtml =
      isSeriesEnd && history.length
        ? `<div class="card tier-series-history">
            <p class="card-heading">Thèmes de la série</p>
            <div class="tier-series-history__list" role="list">
              ${history
                .map((h, i) => {
                  const name = h?.topicSnapshot?.name || h?.topicId || `Manche ${i + 1}`;
                  const emoji = h?.topicSnapshot?.emoji || "🏷️";
                  return `
                <div class="tier-series-history__row" role="listitem">
                  <span class="tier-series-history__rank">${i + 1}</span>
                  <span class="tier-series-history__emoji" aria-hidden="true">${escapeHtml(emoji)}</span>
                  <span class="tier-series-history__name">${escapeHtml(name)}</span>
                </div>`;
                })
                .join("")}
            </div>
          </div>`
        : "";
    const primaryCta = isSeriesEnd
      ? `<button type="button" class="btn btn-primary" id="btn-tiernight-end-continue">Autre jeu</button>`
      : `<button type="button" class="btn btn-primary" data-nav="results">Voir les résultats →</button>`;
    const content = `
        <p class="label-upper label-upper--gold">🏆 Tier Night${isSeriesEnd ? " · Fin de série" : ""}</p>
        <h2 class="screen-title">${isSeriesEnd ? "Classement de la série" : "Récap des classements"}</h2>
        <p class="game-intro">${
          isSeriesEnd
            ? `Série terminée${history.length ? ` · ${history.length} thème${history.length > 1 ? "s" : ""}` : ""}.`
            : `« ${escapeHtml(session.listName || "Tier list")} » - +${session.localConsensusPoints ?? 0} pts consensus pour toi cette manche.`
        }</p>
        ${seriesHistoryHtml}
        ${consensusBoardHtml(session.consensus, labelFn)}
        ${controversialHtml(session, recaps, labelFn, series)}
        <div class="recap-list">
          ${recaps.length
            ? recaps
                .map((r) =>
                  recapCardHtml(r, {
                    isLocal: r.player === localName,
                    breakdown: r.player === localName ? localBreakdown : null,
                    labelFn,
                  })
                )
                .join("")
            : `<p class="hint">Chargement des classements…</p>`}
        </div>
        ${gameCumulativeScoresHtml({ gameId: "tiernight", gameLabel: "Tier Night", title: "Cumul des scores" })}
        ${
          realHost
            ? `${eveningRecapRestartButtonHtml({ gameId: "tiernight", title: "TierNight" })}
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-tiernight-end-change-mode">Changer de mode</button>`
            : isSeriesEnd
              ? ""
              : `<p class="hint">En attente de l’hôte…</p>`
        }
        ${
          realHost && !isSeriesEnd
            ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-tiernight-end-quit">${escapeHtml(EXIT_GAME_LABEL)}</button>`
            : ""
        }
        ${primaryCta}`;

    app.innerHTML = pageShell({
      backTarget: "back",
      content,
    });

    if (isSeriesEnd) {
      const cont = app.querySelector("#btn-tiernight-end-continue");
      if (cont) {
        cont.addEventListener(
          "click",
          withClickLock(() => continueEvening(), { lock: exitLock })
        );
      }
    } else {
      bindNav(app, { results: goToResults });
    }
    if (realHost) {
      bindRestartGameButtons(app);
      const changeBtn = app.querySelector("#btn-tiernight-end-change-mode");
      if (changeBtn) {
        changeBtn.addEventListener(
          "click",
          withClickLock(() => onChangeMode(), { lock: exitLock })
        );
      }
    }
    if (realHost && !isSeriesEnd) {
      const quitBtn = app.querySelector("#btn-tiernight-end-quit");
      if (quitBtn) {
        quitBtn.addEventListener(
          "click",
          withClickLock(() => onQuit(), { lock: exitLock })
        );
      }
    }

    if (isGameSyncActive()) {
      refreshGameScoresBox(app, {
        gameId: "tiernight",
        gameLabel: "Tier Night",
        title: "Cumul des scores",
      });
    }
  }

  const unsubSession = onGameSessionChange((row) => {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    const seriesPhase = row?.state?.tierNight?.series?.phase;
    // Série terminale : ne pas basculer vers results génériques.
    if (row?.screen === "results" && seriesPhase !== "series_end") {
      navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
      return;
    }
    // Restart / prep : ne pas recharger un ancien récap hors écran end.
    if (
      row?.screen &&
      row.screen !== "tiernight-end" &&
      seriesPhase !== "series_end"
    ) {
      return;
    }
    if (row?.state?.scores || row?.state?.tierNight?.recap || seriesPhase === "series_end") {
      void bootstrapRecaps();
    }
  });

  render();
  void bootstrapRecaps();

  return () => {
    mount.dispose();
    unsubSession();
    // En MP, la fin de partie passe par completeGameSession (setLobbyBetweenGames) : ne pas
    // repasser le lobby en "waiting" ici, sinon on annule l'état "en soirée" et on reset les prêt.
    if (!isGameSyncActive()) setLobbyWaiting();
  };
}
