import {
  allSpeedVoteReady,
  getSpeedVotePrepSummary,
  getSpeedVoteSession,
  markSpeedVoteLobbyStarted,
  getSpeedVoteEntryScreen,
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
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession, runPrepGameLaunch } from "../core/mpLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import {
  playersReadySectionHtml,
  prepStartSlotHtml,
  refreshPrepReadyUi,
  updatePrepStartSlot,
} from "../core/prepScreen.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountSpeedVotePrep(app) {
  if (!requireLobbyPlay()) return null;

  let mounted = false;
  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getSpeedVoteSession().ready || {},
  });

  function refreshReadySection() {
    const session = getSpeedVoteSession();
    const members = getLobbyParticipants();
    const allReady = allSpeedVoteReady();
    const prep = getSpeedVotePrepSummary();

    refreshPrepReadyUi(app, {
      playersSelector: "#speed-vote-players",
      readyBtnSelector: "#btn-ready",
      members,
      readyMap: session.ready || {},
      localReady: prepLobby.localReadyState(),
    });

    updatePrepStartSlot(
      app.querySelector("#speed-vote-start-slot"),
      prepStartSlotHtml({
        poolEmpty: prep.effective === 0,
        poolEmptyLabel: "Aucune question disponible",
        allReady,
        isHost: isLobbyHost(),
        launchLabel: "Lancer SpeedVote →",
      }),
      onStartGame
    );
  }

  function refreshThemeAndRounds() {
    const session = getSpeedVoteSession();
    const themeId = session.selectedThemeId || SPEED_VOTE_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
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
    await runPrepGameLaunch({
      btn: app.querySelector("#btn-start-game"),
      launch: markSpeedVoteLobbyStarted,
      gameScreen: "speedvote",
      navStack: ["home", "lobby", "game-select", "speedvote-prep", "speedvote"],
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        await setSpeedVoteRoundCount(Number(btn.getAttribute("data-round")));
        render();
      });
    });

    app.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost()) return;
        await setSpeedVoteTheme(btn.getAttribute("data-theme"));
        render();
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setSpeedVoteReady,
        simulateReady: simulateSpeedVoteReady,
        render: refreshReadySection,
      });
    });
  }

  function render() {
    const session = getSpeedVoteSession();
    const members = getLobbyParticipants();
    const allReady = allSpeedVoteReady();
    const localReady = prepLobby.localReadyState();
    const themeId = session.selectedThemeId || SPEED_VOTE_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
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
          ${playersReadySectionHtml(members, session.ready || {})}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="speed-vote-start-slot">
          ${prepStartSlotHtml({
            poolEmpty: prep.effective === 0,
            poolEmptyLabel: "Aucune question disponible",
            allReady,
            isHost,
            launchLabel: "Lancer SpeedVote →",
          })}
        </div>
      `,
    });

    bindEvents();
    mounted = true;
  }

  render();

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "speedvote-prep",
    getEntryScreen: getSpeedVoteEntryScreen,
    buildNavStack: (entry) => ["home", "lobby", "game-select", "speedvote-prep", entry],
  });

  const unsub = onGameSessionChange(() => {
    if (guestFollow()) return;
    refreshFromSync();
  });

  return () => {
    prepLobby.dispose();
    unsub();
  };
}
