import {
  PLAYLIST_GUESS_MIN_PLAYERS,
  PLAYLIST_GUESS_ROUND_PRESETS,
  PLAYLIST_GUESS_ROUND_DEFAULT,
  allPlaylistGuessReady,
  getLocalParticipantId,
  getPlaylistGuessPrepSummary,
  getPlaylistGuessSession,
  isLocalPlaylistGuessHost,
  lobbyPlayersWithIds,
  markPlaylistGuessLobbyStarted,
  setPlaylistGuessReady,
  setPlaylistGuessRoundCount,
  simulatePlaylistGuessReady,
} from "../core/playlistGuessSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { isGameSyncActive, isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountPlaylistGuessPrep(app) {
  if (!requireLobbyPlay()) return null;

  let cleanupSim = null;
  let readyCommitInFlight = null;
  const localUid = getLocalParticipantId();

  function localReadyState() {
    if (readyCommitInFlight !== null) return readyCommitInFlight;
    return Boolean(getPlaylistGuessSession().ready[localUid]);
  }

  function refreshReadySection() {
    const session = getPlaylistGuessSession();
    const members = lobbyPlayersWithIds();
    const allReady = allPlaylistGuessReady();
    const localReady = localReadyState();
    const prep = getPlaylistGuessPrepSummary();
    const isHost = isLocalPlaylistGuessHost();

    const playersCard = app.querySelector("#pg-players");
    if (playersCard) {
      playersCard.innerHTML = `
        <p class="card-heading">Joueurs prêts</p>
        ${members
          .map(
            (m) => `
          <div class="lobby-player ${session.ready[m.userId] ? "lobby-player--ready" : ""}">
            <span class="lobby-player__status">${session.ready[m.userId] ? "✓" : "…"}</span>
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

    const minCard = app.querySelector("#pg-min-players");
    if (minCard) {
      const playerCount = members.length;
      const minPlayersMet = playerCount >= PLAYLIST_GUESS_MIN_PLAYERS;
      minCard.innerHTML = `
        <div class="fil-rouge-setup__req ${minPlayersMet ? "fil-rouge-setup__req--ok" : "fil-rouge-setup__req--warn"}" role="status">
          <span class="fil-rouge-setup__req-icon" aria-hidden="true">👥</span>
          <div class="fil-rouge-setup__req-body">
            <p class="fil-rouge-setup__req-title">Minimum ${PLAYLIST_GUESS_MIN_PLAYERS} joueurs</p>
            <p class="fil-rouge-setup__req-detail">
              ${
                minPlayersMet
                  ? `${playerCount} joueurs dans le lobby - c'est bon.`
                  : `<strong>${playerCount} / ${PLAYLIST_GUESS_MIN_PLAYERS}</strong> joueurs - invite encore <strong>${PLAYLIST_GUESS_MIN_PLAYERS - playerCount}</strong> personne${PLAYLIST_GUESS_MIN_PLAYERS - playerCount > 1 ? "s" : ""}.`
              }
            </p>
          </div>
        </div>`;
    }

    const startSlot = app.querySelector("#pg-start-slot");
    if (startSlot) {
      const canStart = allReady && prep.minPlayersMet && prep.effective > 0;
      if (canStart && isHost && isLobbyHost()) {
        startSlot.innerHTML = `<button type="button" class="btn btn-primary btn--spaced" id="btn-start-game">Lancer la partie →</button>`;
        startSlot.querySelector("#btn-start-game")?.addEventListener("click", onStartGame);
      } else {
        startSlot.innerHTML = `<button type="button" class="btn btn-secondary btn--spaced" disabled>${
          !prep.minPlayersMet ? `Il faut au moins ${PLAYLIST_GUESS_MIN_PLAYERS} joueurs` : "En attente des joueurs…"
        }</button>`;
      }
    }
  }

  function refreshRoundChips() {
    const session = getPlaylistGuessSession();
    const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
    const isHost = isLocalPlaylistGuessHost();
    app.querySelectorAll("[data-pg-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-pg-round"));
      btn.classList.toggle("theme-chip--active", roundCount === value);
      btn.disabled = !isHost;
    });
    const hint = app.querySelector("#pg-pool-hint");
    if (hint) {
      const prep = getPlaylistGuessPrepSummary();
      hint.textContent = `${prep.effective} manche(s) · ${prep.poolSize} chansons disponibles`;
    }
  }

  async function onStartGame() {
    if (!isLobbyHost()) return;
    if (getLobbyParticipants().length < PLAYLIST_GUESS_MIN_PLAYERS) {
      const { showAppAlert } = await import("../core/dialog.js");
      await showAppAlert(
        `VibeCheck se joue à au moins ${PLAYLIST_GUESS_MIN_PLAYERS} : chaque manche, on vote à qui une chanson correspond le mieux.`,
        { title: `${PLAYLIST_GUESS_MIN_PLAYERS} joueurs minimum`, icon: "👥" }
      );
      return;
    }
    try {
      await markPlaylistGuessLobbyStarted();
      navigate("playlistguess", {
        navStack: ["home", "lobby", "game-select", "playlistguess-prep", "playlistguess"],
      });
    } catch (e) {
      const { showAppAlert } = await import("../core/dialog.js");
      await showAppAlert(e.message || "Impossible de lancer.", {
        title: "VibeCheck",
        icon: "⚠️",
      });
    }
  }

  async function onReadyClick() {
    const nextReady = !localReadyState();
    readyCommitInFlight = nextReady;
    refreshReadySection();
    try {
      await setPlaylistGuessReady(localUid, nextReady);
      if (!isGameSyncActive() && nextReady) {
        if (cleanupSim) cleanupSim();
        cleanupSim = simulatePlaylistGuessReady(refreshReadySection);
      }
    } finally {
      readyCommitInFlight = null;
      refreshReadySection();
    }
  }

  function render() {
    const session = getPlaylistGuessSession();
    const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
    const isHost = isLocalPlaylistGuessHost();
    const localReady = localReadyState();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--purple">🎵 VibeCheck</p>
        <h2 class="screen-title">Préparation</h2>
        <p class="game-intro">Une chanson tirée au sort - votez à qui elle correspond le mieux. Le plus voté marque, la majorité aussi. <span class="muted">${PLAYLIST_GUESS_MIN_PLAYERS} joueurs minimum.</span></p>

        <div id="pg-min-players"></div>

        <div class="card">
          <p class="card-heading">Nombre de manches</p>
          <div class="theme-chips theme-chips--rounds">
            ${PLAYLIST_GUESS_ROUND_PRESETS.map(
              (n) => `
              <button type="button" class="theme-chip ${roundCount === n ? "theme-chip--active" : ""}"
                data-pg-round="${n}" ${!isHost ? "disabled" : ""}>${n}</button>`
            ).join("")}
          </div>
          <p class="hint" id="pg-pool-hint" aria-live="polite"></p>
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier les réglages.</p>` : ""}
        </div>

        <div class="card" id="pg-players"></div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="pg-start-slot"></div>
      `,
    });

    bindNav(app);
    refreshRoundChips();
    refreshReadySection();

    app.querySelectorAll("[data-pg-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLocalPlaylistGuessHost()) return;
        await setPlaylistGuessRoundCount(Number(btn.getAttribute("data-pg-round")));
        render();
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", onReadyClick);
  }

  render();

  const unsub = onGameSessionChange(() => {
    refreshRoundChips();
    refreshReadySection();
  });

  return () => {
    if (cleanupSim) cleanupSim();
    unsub();
  };
}
