import { TIER_LEVELS, TIER_COLORS } from "../../data/tierTopics.js";
import {
  getTierNightRecaps,
  getTierNightSession,
} from "../core/tierNightSession.js";
import { exportTierBoardPng, downloadDataUrl } from "../core/tierExport.js";
import { getLocalDisplayName, setLastGame } from "../core/state.js";
import { setLobbyWaiting } from "../core/lobby.js";
import {
  completeGameSession,
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  suppressSessionRoute,
} from "../core/gameSync.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import {
  eveningRecapRestartButtonHtml,
  bindRestartGameButtons,
} from "../core/restartGame.js";

export function mountTierNightEnd(app) {
  let phase = "recap";
  const session = getTierNightSession();
  const recaps = getTierNightRecaps();
  const localName = getLocalDisplayName();
  const localRecap = recaps.find((r) => r.player === localName);
  const controversial = session.controversialItem;

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
    let content = "";

    if (phase === "recap") {
      content = `
        <p class="label-upper label-upper--gold">🏆 Tier Night</p>
        <h2 class="screen-title">Récap des classements</h2>
        <p class="game-intro">« ${escapeHtml(session.listName || "Tier list")} » — consensus +${session.localConsensusPoints || 0} pts pour toi.</p>
        <div class="recap-list">
          ${recaps
            .map(
              (r) => `
            <div class="card recap-card">
              <div class="recap-card__head">
                <span class="recap-card__avatar" style="background:${r.color}">${r.emoji}</span>
                <span class="recap-card__name">${escapeHtml(r.player)}</span>
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
            .join("")}
        </div>
        ${eveningRecapRestartButtonHtml({ gameId: "tiernight", title: "TierNight" })}
        <button type="button" class="btn btn-primary" id="btn-contro">Controverse →</button>`;
    }

    if (phase === "controversial") {
      const item = controversial || "—";
      content = `
        <p class="label-upper label-upper--gold">🌶️ Controverse</p>
        <h2 class="screen-title">Le plus clivant</h2>
        <p class="game-intro">Celui dont les classements divergent le plus dans le lobby.</p>
        <div class="card card--controversial">
          <p class="controversial-item">${escapeHtml(item)}</p>
        </div>
        ${eveningRecapRestartButtonHtml({ gameId: "tiernight", title: "TierNight" })}
        <button type="button" class="btn btn-primary btn--spaced" id="btn-export-phase">Continuer</button>`;
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

    app.querySelector("#btn-contro")?.addEventListener("click", () => {
      phase = "controversial";
      render();
    });

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

  }

  const unsubSession = onGameSessionChange((row) => {
    if (row?.screen === "results") {
      navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
    }
  });

  render();

  return () => {
    unsubSession();
    setLobbyWaiting();
  };
}
