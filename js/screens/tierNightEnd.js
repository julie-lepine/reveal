import { TIER_LEVELS, TIER_COLORS } from "../../data/tierTopics.js";
import {
  getTierNightRecaps,
  getTierNightSession,
  getTierConsensus,
} from "../core/tierNightSession.js";
import { exportTierBoardPng, downloadDataUrl } from "../core/tierExport.js";
import { getLocalDisplayName, setLastGame } from "../core/state.js";
import { setLobbyWaiting } from "../core/lobby.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { onTimerSecond, primeTimerSound } from "../core/timerSound.js";

const DISCUSS_SEC = 25;

export function mountTierNightEnd(app) {
  let phase = "recap";
  let discussTimer = DISCUSS_SEC;
  let intervalId = null;
  const session = getTierNightSession();
  const recaps = getTierNightRecaps();
  const consensus = getTierConsensus();
  const localName = getLocalDisplayName();
  const localRecap = recaps.find((r) => r.player === localName);
  const controversial = session.controversialItem;

  function clearTimer() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
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
        <button type="button" class="btn btn-primary" id="btn-discuss">Phase discussion →</button>`;
    }

    if (phase === "discuss") {
      content = `
        <p class="label-upper label-upper--gold">💬 Discussion</p>
        <h2 class="screen-title">Débattez vos choix</h2>
        <p class="hint">Timer ${discussTimer}s — comparez avec le consensus (simulé).</p>
        ${
          consensus
            ? `<div class="card">
            <p class="card-heading">Consensus du lobby</p>
            ${TIER_LEVELS.map((tier) => {
              const items = consensus[tier] || [];
              if (!items.length) return "";
              return `<p><span style="color:${TIER_COLORS[tier]}">${tier}</span> : ${items.map(escapeHtml).join(", ")}</p>`;
            }).join("")}
          </div>`
            : ""
        }
        <button type="button" class="btn btn-primary" id="btn-vote-contro">Controverse →</button>`;
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
        <button type="button" class="btn btn-primary btn--spaced" id="btn-export-phase">Continuer</button>`;
    }

    if (phase === "export") {
      content = `
        <p class="label-upper label-upper--gold">📸 Export</p>
        <h2 class="screen-title">Ton board</h2>
        <p class="game-intro">Télécharge ton classement en PNG.</p>
        <button type="button" class="btn btn-primary" id="btn-download">Télécharger le board</button>
        <button type="button" class="btn btn-secondary btn--spaced" data-nav="results">Voir les résultats →</button>`;
    }

    app.innerHTML = pageShell({
      back: phase === "recap" ? "back" : false,
      content,
    });

    bindNav(app);

    app.querySelector("#btn-discuss")?.addEventListener("click", () => {
      phase = "discuss";
      discussTimer = DISCUSS_SEC;
      render();
      startDiscussTimer();
    });

    app.querySelector("#btn-vote-contro")?.addEventListener("click", () => {
      clearTimer();
      phase = "controversial";
      render();
    });

    app.querySelector("#btn-export-phase")?.addEventListener("click", () => {
      clearTimer();
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

    app.querySelector('[data-nav="results"]')?.addEventListener("click", () => {
      setLastGame({
        gameId: "tiernight",
        title: "Tier Night",
        summary: `« ${session.listName || "Tier list"} » · +${session.localConsensusPoints || 0} pts consensus`,
      });
    });
  }

  function startDiscussTimer() {
    clearTimer();
    primeTimerSound();
    intervalId = setInterval(() => {
      discussTimer -= 1;
      onTimerSecond({ remaining: discussTimer, urgentAt: 5 });
      if (discussTimer <= 0) {
        clearTimer();
        phase = "controversial";
        render();
        return;
      }
      const hint = app.querySelector(".hint");
      if (hint) hint.textContent = `Timer ${discussTimer}s — comparez avec le consensus (simulé).`;
    }, 1000);
  }

  render();

  return () => {
    clearTimer();
    setLobbyWaiting();
  };
}
