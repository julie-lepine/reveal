import {
  allDrawItReady,
  getDrawItPrepSummary,
  getDrawItSession,
  markDrawItLobbyStarted,
  getDrawItEntryScreen,
  setDrawItReady,
  setDrawItRoundCount,
  setDrawItCategory,
  simulateDrawItReady,
  validateDrawItPrep,
  drawItPrepBlockLabel,
  DRAW_IT_CATEGORIES,
  DRAW_IT_ROUND_PRESETS,
  DRAW_IT_CATALOG_ID,
} from "../core/drawItSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { executePrepLaunch, prepLaunchSlotParams, DEFAULT_PREP_MIN_PLAYERS } from "../core/prepLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import {
  playersReadySectionHtml,
  prepStartSlotHtml,
  refreshPrepReadyUi,
  updatePrepStartSlot,
  bindPrepLaunchButtons,
} from "../core/prepScreen.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountDrawItPrep(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getDrawItEntryScreen();
  if (entry !== "drawit-prep") {
    navigate(entry);
    return null;
  }

  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getDrawItSession().ready || {},
  });

  function drawItStartSlotHtml(allReady, prep) {
    const session = getDrawItSession();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: DEFAULT_PREP_MIN_PLAYERS,
        poolEmpty: !prep?.valid,
        poolEmptyLabel: prep?.blockLabel || "Configuration invalide",
        launchLabel: "Lancer Draw it ! →",
      })
    );
  }

  function refreshReadySection() {
    const session = getDrawItSession();
    const members = getLobbyParticipants();
    const allReady = allDrawItReady();
    const prep = getDrawItPrepSummary();

    refreshPrepReadyUi(app, {
      playersSelector: "#draw-it-players",
      readyBtnSelector: "#btn-ready",
      members,
      readyMap: session.ready || {},
      localReady: prepLobby.localReadyState(),
    });

    updatePrepStartSlot(
      app.querySelector("#draw-it-start-slot"),
      drawItStartSlotHtml(allReady, prep),
      onLaunch
    );
  }

  function refreshCategoryAndRounds() {
    const session = getDrawItSession();
    const categoryId = session.selectedCategoryId || DRAW_IT_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
    const prep = getDrawItPrepSummary();

    app.querySelectorAll("[data-category]").forEach((btn) => {
      const id = btn.getAttribute("data-category");
      btn.classList.toggle("theme-chip--active", categoryId === id);
      btn.disabled = !isHost;
    });

    app.querySelectorAll("[data-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-round"));
      const disabled = prep.poolSize < value;
      btn.classList.toggle("theme-chip--active", roundCount === value);
      btn.disabled = disabled || !isHost;
    });

    const dur = app.querySelector("#draw-it-duration");
    if (dur) {
      const shown = isFinite(Number(roundCount)) && Number(roundCount) > 0 ? Number(roundCount) : 0;
      dur.innerHTML = `
        <strong>${shown}</strong> manche${shown > 1 ? "s" : ""}
        · ${escapeHtml(prep.durationLabel)}
        <span class="muted"> (estimation)</span>`;
    }
  }

  function refreshFromSync() {
    refreshCategoryAndRounds();
    refreshReadySection();
  }

  async function onLaunch({ force = false } = {}) {
    const session = getDrawItSession();
    const check = validateDrawItPrep({
      selectedCategoryId: session.selectedCategoryId,
      roundCount: session.roundCount,
    });
    await executePrepLaunch({
      force,
      btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-start-game"),
      getReadyMap: () => getDrawItSession().ready || {},
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      gameTitle: "Draw it !",
      gameScreen: "drawit",
      navStack: ["home", "lobby", "game-select", "drawit-prep", "drawit"],
      markStarted: markDrawItLobbyStarted,
      allReadyFn: allDrawItReady,
      poolEmpty: !check.valid,
      validateBeforeLaunch: async () => {
        const latest = validateDrawItPrep({
          selectedCategoryId: getDrawItSession().selectedCategoryId,
          roundCount: getDrawItSession().roundCount,
        });
        if (!latest.valid) {
          return {
            ok: false,
            message: drawItPrepBlockLabel(latest) || "Configuration invalide",
          };
        }
        return { ok: true };
      },
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        await setDrawItRoundCount(Number(btn.getAttribute("data-round")));
        render();
      });
    });

    app.querySelectorAll("[data-category]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost()) return;
        await setDrawItCategory(btn.getAttribute("data-category"));
        render();
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setDrawItReady,
        simulateReady: simulateDrawItReady,
        render: refreshReadySection,
      });
    });

    bindPrepLaunchButtons(app, { onLaunch });
  }

  function render() {
    const session = getDrawItSession();
    const members = getLobbyParticipants();
    const allReady = allDrawItReady();
    const localReady = prepLobby.localReadyState();
    const categoryId = session.selectedCategoryId || DRAW_IT_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
    const prep = getDrawItPrepSummary();

    const roundChips = DRAW_IT_ROUND_PRESETS.map((n) => ({
      value: n,
      label: String(n),
      disabled: prep.poolSize < n,
    }));

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">✏️ Draw it !</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("drawit")}
        </div>
        <p class="game-intro">Un joueur dessine, les autres devinent. Chaque manche dure 60 secondes.</p>

        <div class="card">
          <p class="card-heading">Catégorie</p>
          <div class="theme-chips">
            ${DRAW_IT_CATEGORIES.map(
              (cat) => `
              <button type="button" class="theme-chip ${categoryId === cat.id ? "theme-chip--active" : ""}" data-category="${cat.id}"
                ${isHost ? "" : "disabled"}>
                ${escapeHtml(cat.label)}
              </button>`
            ).join("")}
          </div>
          ${
            prep.reason === "invalid_category"
              ? `<p class="hint">Catégorie inconnue - l'hôte doit en choisir une valide.</p>`
              : categoryId === DRAW_IT_CATALOG_ID
                ? `<p class="hint">${prep.poolSize} mot(s) - tout le catalogue.</p>`
                : `<p class="hint">${prep.poolSize} mot(s) dans cette catégorie.</p>`
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
          <p class="hot-take-duration" id="draw-it-duration" aria-live="polite">
            <strong>${Number(roundCount) || 0}</strong> manche${Number(roundCount) > 1 ? "s" : ""}
            · ${escapeHtml(prep.durationLabel)}
            <span class="muted"> (estimation)</span>
          </p>
          ${
            !prep.valid && prep.blockLabel
              ? `<p class="hint">${escapeHtml(prep.blockLabel)}</p>`
              : ""
          }
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier les réglages.</p>` : ""}
        </div>

        <div class="card" id="draw-it-players">
          ${playersReadySectionHtml(members, session.ready || {})}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="draw-it-start-slot">
          ${drawItStartSlotHtml(allReady, prep)}
        </div>
      `,
    });

    bindEvents();
  }

  render();

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "drawit-prep",
    getEntryScreen: getDrawItEntryScreen,
    buildNavStack: (entry) => ["home", "lobby", "game-select", "drawit-prep", entry],
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
