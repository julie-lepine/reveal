import {
  PLAYLIST_GUESS_MIN_PLAYERS,
  PLAYLIST_GUESS_ROUND_PRESETS,
  PLAYLIST_GUESS_ROUND_DEFAULT,
  allPlaylistGuessReady,
  getLocalParticipantId,
  getPlaylistGuessPrepSummary,
  getPlaylistGuessSession,
  lobbyPlayersWithIds,
  markPlaylistGuessLobbyStarted,
  getPlaylistGuessEntryScreen,
  setPlaylistGuessReady,
  setPlaylistGuessRoundCount,
  simulatePlaylistGuessReady,
} from "../core/playlistGuessSession.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { executePrepLaunch } from "../core/prepLaunch.js";
import { prepLaunchSlotParams } from "../core/prepLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import {
  prepStartSlotHtml,
  refreshPrepReadyUi,
  updatePrepStartSlot,
} from "../core/prepScreen.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountPlaylistGuessPrep(app) {
  if (!requireLobbyPlay()) return null;

  const localUid = getLocalParticipantId();
  const prepLobby = createPrepLobbyController({
    localKey: localUid,
    getReadyMap: () => getPlaylistGuessSession().ready || {},
  });

  function refreshReadySection() {
    const session = getPlaylistGuessSession();
    const members = lobbyPlayersWithIds();
    const allReady = allPlaylistGuessReady();
    const prep = getPlaylistGuessPrepSummary();

    refreshPrepReadyUi(app, {
      playersSelector: "#pg-players",
      readyBtnSelector: "#btn-ready",
      members,
      readyMap: session.ready || {},
      readyKey: (m) => m.userId,
      localReady: prepLobby.localReadyState(),
    });

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
      updatePrepStartSlot(startSlot, pgStartSlotHtml(allReady, prep), onLaunch);
    }
  }

  function refreshRoundChips() {
    const session = getPlaylistGuessSession();
    const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
    const isHost = isLobbyHost();
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

  function pgStartSlotHtml(allReady, prep) {
    const session = getPlaylistGuessSession();
    const members = lobbyPlayersWithIds();
    const canStart = allReady && prep.minPlayersMet && prep.effective > 0;
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        participants: members,
        readyMap: session.ready || {},
        readyKey: (m) => m.userId,
        allReady: canStart,
        isHost: isLobbyHost(),
        minPlayers: PLAYLIST_GUESS_MIN_PLAYERS,
        poolEmpty: !prep.minPlayersMet || prep.effective === 0,
        poolEmptyLabel: !prep.minPlayersMet
          ? `Il faut au moins ${PLAYLIST_GUESS_MIN_PLAYERS} joueurs`
          : "Aucune manche disponible",
        launchLabel: "Lancer la partie →",
      })
    );
  }

  async function onLaunch({ force = false } = {}) {
    const prep = getPlaylistGuessPrepSummary();
    try {
      await executePrepLaunch({
        force,
        btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-start-game"),
        getReadyMap: () => getPlaylistGuessSession().ready || {},
        participants: lobbyPlayersWithIds(),
        readyKey: (m) => m.userId,
        minPlayers: PLAYLIST_GUESS_MIN_PLAYERS,
        gameTitle: "VibeCheck",
        gameScreen: "playlistguess",
        navStack: ["home", "lobby", "game-select", "playlistguess-prep", "playlistguess"],
        markStarted: markPlaylistGuessLobbyStarted,
        allReadyFn: () =>
          allPlaylistGuessReady() && prep.minPlayersMet && prep.effective > 0,
        poolEmpty: !prep.minPlayersMet || prep.effective === 0,
        validateBeforeLaunch: (roster) => {
          if (roster.length < PLAYLIST_GUESS_MIN_PLAYERS) {
            return {
              ok: false,
              message: `VibeCheck se joue à au moins ${PLAYLIST_GUESS_MIN_PLAYERS} : chaque manche, on vote à qui une chanson correspond le mieux.`,
              icon: "👥",
            };
          }
          return { ok: true };
        },
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
    await prepLobby.toggleReady({
      setReady: setPlaylistGuessReady,
      simulateReady: simulatePlaylistGuessReady,
      render: refreshReadySection,
    });
  }

  function render() {
    const session = getPlaylistGuessSession();
    const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
    const isHost = isLobbyHost();
    const localReady = prepLobby.localReadyState();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--purple">🎵 VibeCheck</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("playlistguess")}
        </div>
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
        if (!isLobbyHost()) return;
        await setPlaylistGuessRoundCount(Number(btn.getAttribute("data-pg-round")));
        render();
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", onReadyClick);
  }

  render();

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "playlistguess-prep",
    getEntryScreen: getPlaylistGuessEntryScreen,
    buildNavStack: (entry) => ["home", "lobby", "game-select", "playlistguess-prep", entry],
  });

  const unsub = onGameSessionChange(() => {
    if (guestFollow()) return;
    refreshRoundChips();
    refreshReadySection();
  });

  return () => {
    prepLobby.dispose();
    unsub();
  };
}
