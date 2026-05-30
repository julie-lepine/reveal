import {
  allSpeedVoteReady,
  getSpeedVotePrepSummary,
  getSpeedVoteSession,
  isLocalSpeedVoteHost,
  markSpeedVoteLobbyStarted,
  setSpeedVoteReady,
  setSpeedVoteRoundCount,
  setSpeedVoteTheme,
  simulateSpeedVoteReady,
  SPEED_VOTE_THEMES,
  SPEED_VOTE_ROUND_PRESETS,
  SPEED_VOTE_ROUND_ALL,
  SPEED_VOTE_CATALOG_ID,
} from "../core/speedVoteSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { isGameSyncActive, isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountSpeedVotePrep(app) {
  if (!requireLobbyPlay()) return null;

  let cleanupSim = null;
  let mounted = false;
  let readyCommitInFlight = null;
  const localName = getLocalDisplayName();

  function localReadyState() {
    if (readyCommitInFlight !== null) return readyCommitInFlight;
    return Boolean(getSpeedVoteSession().ready[localName]);
  }

  function refreshReadySection() {
    const session = getSpeedVoteSession();
    const members = getLobbyParticipants();
    const allReady = allSpeedVoteReady();
    const localReady = localReadyState();
    const prep = getSpeedVotePrepSummary();

    const playersCard = app.querySelector("#speed-vote-players");
    if (playersCard) {
      playersCard.innerHTML = `
        <p class="card-heading">Joueurs prêts</p>
        ${members
          .map(
            (m) => `
          <div class="lobby-player ${session.ready[m.name] ? "lobby-player--ready" : ""}">
            <span class="lobby-player__status">${session.ready[m.name] ? "✓" : "…"}</span>
            <span class="lobby-player__name">${escapeHtml(m.name)}</span>
          </div>`
          )
          .join("")}`;
    }

    const readyBtn = app.querySelector("#btn-ready");
    if (readyBtn) {
      readyBtn.classList.toggle("btn-ready--active", Boolean(localReady));
      readyBtn.textContent = localReady ? "Prêt ✓" : "Je suis prêt !";
    }

    const startSlot = app.querySelector("#speed-vote-start-slot");
    if (startSlot) {
      if (allReady && prep.effective > 0 && isLocalSpeedVoteHost()) {
        startSlot.innerHTML = `<button type="button" class="btn btn-primary btn--spaced" id="btn-start-game">Lancer SpeedVote →</button>`;
        startSlot.querySelector("#btn-start-game")?.addEventListener("click", onStartGame);
      } else {
        startSlot.innerHTML = `<button type="button" class="btn btn-secondary btn--spaced" disabled>${
          prep.effective === 0 ? "Aucune question disponible" : "En attente des joueurs…"
        }</button>`;
      }
    }
  }

  function refreshThemeAndRounds() {
    const session = getSpeedVoteSession();
    const themeId = session.selectedThemeId || SPEED_VOTE_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLocalSpeedVoteHost();
    const prep = getSpeedVotePrepSummary();

    app.querySelectorAll("[data-theme]").forEach((btn) => {
      const id = btn.getAttribute("data-theme");
      btn.classList.toggle("theme-chip--active", themeId === id);
      btn.disabled = !isHost;
    });

    const poolSize = prep.poolSize;
    app.querySelectorAll("[data-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-round"));
      const disabled =
        value === SPEED_VOTE_ROUND_ALL ? poolSize === 0 : poolSize < value;
      btn.classList.toggle("theme-chip--active", roundCount === value);
      btn.disabled = disabled || !isHost;
    });

    const dur = app.querySelector("#speed-vote-duration");
    if (dur) {
      dur.innerHTML = `
        <strong>${prep.effective}</strong> question${prep.effective > 1 ? "s" : ""}
        · ${escapeHtml(prep.durationLabel)}
        <span class="muted"> (estimation)</span>`;
    }
  }

  function refreshFromSync() {
    refreshThemeAndRounds();
    refreshReadySection();
  }

  async function onStartGame() {
    if (!isLobbyHost()) return;
    await markSpeedVoteLobbyStarted();
    navigate("speedvote", {
      navStack: ["home", "lobby", "game-select", "speedvote-prep", "speedvote"],
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLocalSpeedVoteHost() || btn.disabled) return;
        await setSpeedVoteRoundCount(Number(btn.getAttribute("data-round")));
        render();
      });
    });

    app.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLocalSpeedVoteHost()) return;
        await setSpeedVoteTheme(btn.getAttribute("data-theme"));
        render();
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", async () => {
      const nextReady = !localReadyState();
      readyCommitInFlight = nextReady;
      refreshReadySection();
      try {
        await setSpeedVoteReady(localName, nextReady);
        if (!isGameSyncActive() && nextReady) {
          if (cleanupSim) cleanupSim();
          cleanupSim = simulateSpeedVoteReady(refreshReadySection);
        }
      } finally {
        readyCommitInFlight = null;
        refreshReadySection();
      }
    });
  }

  function render() {
    const session = getSpeedVoteSession();
    const members = getLobbyParticipants();
    const allReady = allSpeedVoteReady();
    const localReady = localReadyState();
    const themeId = session.selectedThemeId || SPEED_VOTE_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLocalSpeedVoteHost();
    const prep = getSpeedVotePrepSummary();

    const roundChips = [
      ...SPEED_VOTE_ROUND_PRESETS.map((n) => ({
        value: n,
        label: String(n),
        disabled: prep.poolSize < n,
      })),
      {
        value: SPEED_VOTE_ROUND_ALL,
        label: "Tout",
        disabled: prep.poolSize === 0,
      },
    ];

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">⚡ SpeedVote</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("speedvote")}
        </div>
        <p class="game-intro">Vote éclair sur les joueurs de la soirée. La manche se clôture dès que tout le monde a voté.</p>

        <div class="card">
          <p class="card-heading">Thème des questions</p>
          <div class="theme-chips">
            ${SPEED_VOTE_THEMES.map(
              (th) => `
              <button type="button" class="theme-chip ${themeId === th.id ? "theme-chip--active" : ""}" data-theme="${th.id}"
                ${isHost ? "" : "disabled"}>
                ${escapeHtml(th.label)}
              </button>`
            ).join("")}
          </div>
          ${
            prep.poolSize > 0
              ? themeId === SPEED_VOTE_CATALOG_ID
                ? `<p class="hint">${prep.poolSize} question(s) - tous les thèmes fusionnés.</p>`
                : `<p class="hint">${prep.poolSize} question(s) dans ce thème.</p>`
              : `<p class="hint">Ajoute des questions dans data/speedVote.js.</p>`
          }
        </div>

        <div class="card">
          <p class="card-heading">Nombre de manches</p>
          <div class="theme-chips theme-chips--rounds">
            ${roundChips
              .map(
                ({ value, label, disabled }) => `
              <button type="button" class="theme-chip ${roundCount === value ? "theme-chip--active" : ""}"
                data-round="${value}" ${disabled || !isHost ? "disabled" : ""}>
                ${label}
              </button>`
              )
              .join("")}
          </div>
          <p class="hot-take-duration" id="speed-vote-duration" aria-live="polite">
            <strong>${prep.effective}</strong> question${prep.effective > 1 ? "s" : ""}
            · ${escapeHtml(prep.durationLabel)}
            <span class="muted"> (estimation)</span>
          </p>
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier les réglages.</p>` : ""}
        </div>

        <div class="card" id="speed-vote-players">
          <p class="card-heading">Joueurs prêts</p>
          ${members
            .map(
              (m) => `
            <div class="lobby-player ${session.ready[m.name] ? "lobby-player--ready" : ""}">
              <span class="lobby-player__status">${session.ready[m.name] ? "✓" : "…"}</span>
              <span class="lobby-player__name">${escapeHtml(m.name)}</span>
            </div>`
            )
            .join("")}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="speed-vote-start-slot">
        ${
          allReady && prep.effective > 0
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-start-game">Lancer SpeedVote →</button>`
            : `<button type="button" class="btn btn-secondary btn--spaced" disabled>${
                prep.effective === 0 ? "Aucune question disponible" : "En attente des joueurs…"
              }</button>`
        }
        </div>
      `,
    });

    bindEvents();
    mounted = true;
  }

  render();

  const unsub = onGameSessionChange(() => {
    refreshFromSync();
  });

  return () => {
    if (cleanupSim) cleanupSim();
    unsub();
  };
}
