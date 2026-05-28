import { TIER_LEVELS, TIER_COLORS } from "../../data/tierTopics.js";
import {
  getTierNightRecaps,
  getTierNightSession,
  getTierNightRoundPointsSorted,
} from "../core/tierNightSession.js";
import { getTierListById } from "../core/tierLists.js";
import { getTierNightTopicId } from "../core/state.js";
import { exportTierBoardPng, downloadDataUrl } from "../core/tierExport.js";
import { getLocalDisplayName, setLastGame } from "../core/state.js";
import { setLobbyWaiting } from "../core/lobby.js";
import {
  completeGameSession,
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  suppressSessionRoute,
  refreshEveningScoresFromSession,
  refreshGameSession,
  ensureTierNightRecapsFromRemote,
} from "../core/gameSync.js";
import {
  gameCumulativeScoresHtml,
  tierNightRoundScoresHtml,
  refreshGameScoresBox,
} from "../core/gameScores.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import {
  eveningRecapRestartButtonHtml,
  bindRestartGameButtons,
} from "../core/restartGame.js";

export function mountTierNightEnd(app) {
  let phase = "recap";
  let session = getTierNightSession();
  let recaps = getTierNightRecaps();
  const localName = getLocalDisplayName();
  let localRecap = recaps.find((r) => r.player === localName);
  let bootstrapping = false;

  function reloadSession() {
    session = getTierNightSession();
    recaps = getTierNightRecaps();
    localRecap = recaps.find((r) => r.player === localName);
  }

  async function bootstrapRecaps() {
    if (bootstrapping) return;
    bootstrapping = true;
    try {
      const topicId = getTierNightTopicId();
      const list = topicId ? getTierListById(topicId) : null;
      if (!list) return;

      if (isGameSyncActive()) {
        const maxAttempts = isLobbyHost() ? 1 : 12;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          await ensureTierNightRecapsFromRemote(list);
          reloadSession();
          const ready =
            getTierNightRecaps().length > 0 &&
            getTierNightRecaps().some(
              (r) => Object.values(r.placed || {}).flat().length > 0
            );
          if (ready || isLobbyHost()) break;
          await new Promise((r) => setTimeout(r, 450));
        }
        if (!isLobbyHost()) {
          await refreshEveningScoresFromSession();
        }
      }
      reloadSession();
      render();
    } finally {
      bootstrapping = false;
    }
  }

  async function goToResults() {
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
          navigate("results", resultsNav);
        }
      } else {
        suppressSessionRoute(120000);
        navigate("results", resultsNav);
      }
      return;
    }

    await setLobbyWaiting();
    navigate("results", resultsNav);
  }

  function render() {
    reloadSession();
    const roundSorted = getTierNightRoundPointsSorted();
    let content = "";

    if (phase === "recap") {
      content = `
        <p class="label-upper label-upper--gold">🏆 Tier Night</p>
        <h2 class="screen-title">Récap des classements</h2>
        <p class="game-intro">« ${escapeHtml(session.listName || "Tier list")} » - +${session.localConsensusPoints ?? 0} pts consensus pour toi cette manche.</p>
        ${tierNightRoundScoresHtml(roundSorted)}
        ${gameCumulativeScoresHtml({ gameLabel: "Tier Night", title: "Cumul de la soirée" })}
        <div class="recap-list">
          ${recaps.length
            ? recaps
                .map(
                  (r) => `
            <div class="card recap-card">
              <div class="recap-card__head">
                <span class="recap-card__avatar" style="background:${r.color}">${r.emoji}</span>
                <span class="recap-card__name">${escapeHtml(r.player)}</span>
                <span class="recap-card__pts">+${r.consensusPoints ?? 0} pts</span>
              </div>
              ${TIER_LEVELS.map((tier) => {
                const items = r.placed[tier] || [];
                if (!items.length) return "";
                return `
                <div class="recap-tier">
                  <span class="recap-tier__label" style="color:${TIER_COLORS[tier]}">${tier}</span>
                  <span class="recap-tier__items">${items.map((i) => escapeHtml(i)).join(" · ")}</span>
                </div>`;
              }).join("")}
            </div>`
                )
                .join("")
            : `<p class="hint">Chargement des classements…</p>`}
        </div>
        ${eveningRecapRestartButtonHtml({ gameId: "tiernight", title: "TierNight" })}
        <button type="button" class="btn btn-primary" id="btn-export-phase">Continuer →</button>`;
    }

    if (phase === "export") {
      content = `
        <p class="label-upper label-upper--gold">📸 Export</p>
        <h2 class="screen-title">Ton board</h2>
        <p class="game-intro">Télécharge ton classement en PNG.</p>
        <button type="button" class="btn btn-primary" id="btn-download">Télécharger le board</button>
        ${eveningRecapRestartButtonHtml({ gameId: "tiernight", title: "TierNight" })}
        <button type="button" class="btn btn-secondary btn--spaced" data-nav="results">Voir les résultats →</button>`;
    }

    app.innerHTML = pageShell({
      back: phase === "recap" ? "back" : false,
      content,
    });

    bindNav(app, { results: goToResults });
    bindRestartGameButtons(app);

    app.querySelector("#btn-export-phase")?.addEventListener("click", () => {
      phase = "export";
      render();
    });

    app.querySelector("#btn-download")?.addEventListener("click", () => {
      if (!localRecap) return;
      const url = exportTierBoardPng({
        listName: session.listName || "Tier list",
        placed: localRecap.placed,
      });
      if (url) downloadDataUrl(url, `tier-${Date.now()}.png`);
    });

    if (phase === "recap" && isGameSyncActive()) {
      refreshGameScoresBox(app, { gameLabel: "Tier Night", title: "Cumul de la soirée" });
    }
  }

  const unsubSession = onGameSessionChange((row) => {
    if (row?.screen === "results") {
      navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
      return;
    }
    if (phase === "recap" && (row?.state?.scores || row?.state?.tierNight?.recap)) {
      void bootstrapRecaps();
    }
  });

  render();
  void bootstrapRecaps();

  return () => {
    unsubSession();
    setLobbyWaiting();
  };
}
