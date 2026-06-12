import {
  addCustomDilemma,
  removeCustomDilemma,
  allDilemmaReady,
  countOtherPlayersCustomDilemmas,
  getDilemmaPrepSummary,
  getDilemmaSession,
  getMyCustomDilemmas,
  getModerationNotice,
  markDilemmaLobbyStarted,
  getDilemmaEntryScreen,
  setDilemmaReady,
  setDilemmaRoundCount,
  setDilemmaDeck,
  simulateDilemmaReady,
  DILEMMA_DECKS,
  DILEMMA_ROUND_PRESETS,
  DILEMMA_ROUND_ALL,
  DILEMMA_CATALOG_ID,
} from "../core/dilemmaSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { onLobbyBundleUpdated } from "../core/supabaseLobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  refreshGameSession,
} from "../core/gameSync.js";
import { prepGuestFollowOnSession, runPrepGameLaunch } from "../core/mpLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import {
  bindPrepRemoveDelegation,
  customEntryListHtml,
  patchDynamicListInCard,
  playersReadySectionHtml,
  prepStartSlotHtml,
  updatePlayersReadyCard,
  updateReadyButton,
  updatePrepStartSlot,
} from "../core/prepScreen.js";
import { bindNav } from "./nav.js";

export function mountDilemmaPrep(app) {
  if (!requireLobbyPlay()) return null;

  let mounted = false;
  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getDilemmaSession().ready || {},
  });
  const moderationNotice = getModerationNotice();

  function captureDraft() {
    return {
      optionA: app.querySelector("#dilemma-option-a")?.value ?? "",
      optionB: app.querySelector("#dilemma-option-b")?.value ?? "",
      focusedId: document.activeElement?.id || null,
    };
  }

  function restoreDraft(state) {
    if (!state) return;
    const inputA = app.querySelector("#dilemma-option-a");
    const inputB = app.querySelector("#dilemma-option-b");
    if (inputA) inputA.value = state.optionA;
    if (inputB) inputB.value = state.optionB;
    if (state.focusedId === "dilemma-option-a") inputA?.focus();
    if (state.focusedId === "dilemma-option-b") inputB?.focus();
  }

  function customDilemmasListHtml() {
    return customEntryListHtml(getMyCustomDilemmas(), {
      listClass: "take-list dilemma-custom-list",
      itemClass: "dilemma-custom-list__item",
      removeClass: "dilemma-custom-list__remove",
      removeAttr: "data-remove-dilemma",
      renderItem: (d) =>
        `<span class="dilemma-custom-list__a">${escapeHtml(d.optionA)}</span>
         <span class="dilemma-custom-list__vs">VS</span>
         <span class="dilemma-custom-list__b">${escapeHtml(d.optionB)}</span>`,
    });
  }

  function othersDilemmasHintHtml() {
    const n = countOtherPlayersCustomDilemmas();
    if (!n) return "";
    return `<p class="hint" id="dilemma-others-hint">${n} dilemme${n > 1 ? "s" : ""} d'autres joueurs - révélé${n > 1 ? "s" : ""} en manche.</p>`;
  }

  function renderCustomDilemmasList() {
    patchDynamicListInCard(app.querySelector("#dilemma-option-a")?.closest(".card"), {
      listSelector: ".dilemma-custom-list",
      listHtml: customDilemmasListHtml(),
      hintSelector: "#dilemma-others-hint",
      hintHtml: othersDilemmasHintHtml(),
      insertAfterSelectors: ["#dilemma-error", ".moderation-notice"],
    });
  }

  function localReadyState() {
    return prepLobby.localReadyState();
  }

  function dilemmaStartSlotHtml(allReady, prep) {
    return prepStartSlotHtml({
      poolEmpty: prep.effective === 0,
      poolEmptyLabel: "Aucun dilemme disponible",
      allReady,
      isHost: isLobbyHost(),
      launchLabel: "Lancer Dilemma →",
    });
  }

  function refreshReadySection() {
    const session = getDilemmaSession();
    const members = getLobbyParticipants();
    const allReady = allDilemmaReady();
    const localReady = localReadyState();
    const prep = getDilemmaPrepSummary();

    updatePlayersReadyCard(app.querySelector("#dilemma-players"), members, session.ready);
    updateReadyButton(app.querySelector("#btn-ready"), localReady);

    updatePrepStartSlot(
      app.querySelector("#dilemma-start-slot"),
      dilemmaStartSlotHtml(allReady, prep),
      onStartGame
    );
  }

  function refreshDeckAndRounds() {
    const session = getDilemmaSession();
    const deckId = session.selectedDeckId || DILEMMA_CATALOG_ID;
    const roundCount = session.roundCount ?? 8;
    const isHost = isLobbyHost();
    const prep = getDilemmaPrepSummary();
    app.querySelectorAll("[data-deck]").forEach((btn) => {
      const id = btn.getAttribute("data-deck");
      btn.classList.toggle("theme-chip--active", deckId === id);
      btn.disabled = !isHost;
    });

    const poolHint = app.querySelector("#dilemma-pool-hint");
    if (poolHint) {
      poolHint.textContent =
        prep.poolSize > 0
          ? `${prep.poolSize} dilemme(s) dans le deck (+ customs si ajoutés).`
          : "Ajoute des dilemmes dans data/dilemma.js ou crée les tiens ci-dessous.";
    }

    app.querySelectorAll("[data-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-round"));
      const disabled =
        value === DILEMMA_ROUND_ALL ? prep.poolSize === 0 : prep.poolSize < value;
      btn.classList.toggle("theme-chip--active", roundCount === value);
      btn.disabled = disabled || !isHost;
    });

    const dur = app.querySelector("#dilemma-duration");
    if (dur) {
      dur.innerHTML = `
        <strong>${prep.effective}</strong> dilemme${prep.effective > 1 ? "s" : ""}
        · ${escapeHtml(prep.durationLabel)}
        <span class="muted"> (estimation)</span>`;
    }

    renderCustomDilemmasList();
  }

  function refreshFromSync() {
    refreshDeckAndRounds();
    refreshReadySection();
  }

  async function onStartGame() {
    await runPrepGameLaunch({
      btn: app.querySelector("#btn-start-game"),
      launch: markDilemmaLobbyStarted,
      gameScreen: "dilemma",
      navStack: ["home", "lobby", "game-select", "dilemma-prep", "dilemma"],
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        const draft = captureDraft();
        await setDilemmaRoundCount(Number(btn.getAttribute("data-round")));
        render(draft);
      });
    });

    app.querySelectorAll("[data-deck]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost()) return;
        const draft = captureDraft();
        await setDilemmaDeck(btn.getAttribute("data-deck"));
        render(draft);
      });
    });

    app.querySelector("#add-dilemma")?.addEventListener("click", async () => {
      const err = app.querySelector("#dilemma-error");
      const res = await addCustomDilemma(
        app.querySelector("#dilemma-option-a")?.value,
        app.querySelector("#dilemma-option-b")?.value
      );
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      render(captureDraft());
      const inputA = app.querySelector("#dilemma-option-a");
      const inputB = app.querySelector("#dilemma-option-b");
      if (inputA) inputA.value = "";
      if (inputB) inputB.value = "";
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setDilemmaReady,
        simulateReady: simulateDilemmaReady,
        render: refreshReadySection,
      });
    });

    app.querySelector("#btn-start-game")?.addEventListener("click", onStartGame);
  }

  function customDilemmaCardHtml() {
    const myCustoms = getMyCustomDilemmas();
    if (myCustoms.length > 0) {
      return `
        <div class="card">
          <p class="card-heading">Ton dilemme</p>
          <p class="hint">Ton dilemme sera joué en priorité. Tu pourras en proposer un autre à la prochaine partie.</p>
          ${customDilemmasListHtml()}
          ${othersDilemmasHintHtml()}
        </div>`;
    }
    return `
        <div class="card">
          <p class="card-heading">Ton dilemme</p>
          <label class="field-label" for="dilemma-option-a">Option A</label>
          <input type="text" class="field-input" id="dilemma-option-a" maxlength="120" placeholder="Ex : Ne plus jamais dormir" />
          <label class="field-label" for="dilemma-option-b">Option B</label>
          <div class="join-row">
            <input type="text" class="field-input join-input" id="dilemma-option-b" maxlength="120" placeholder="Ex : Ne plus jamais manger chaud" />
            <button type="button" class="btn btn-secondary join-btn" id="add-dilemma">+</button>
          </div>
          <p class="moderation-notice">${escapeHtml(moderationNotice)}</p>
          <p class="auth-error hidden" id="dilemma-error"></p>
          ${othersDilemmasHintHtml()}
        </div>`;
  }

  function render(preserveDraft = null) {
    const draft = preserveDraft ?? (mounted ? captureDraft() : null);

    const session = getDilemmaSession();
    const localReady = localReadyState();
    const deckId = session.selectedDeckId || DILEMMA_CATALOG_ID;
    const roundCount = session.roundCount ?? 8;
    const isHost = isLobbyHost();
    const prep = getDilemmaPrepSummary();
    const members = getLobbyParticipants();
    const allReady = allDilemmaReady();

    const roundChips = [
      ...DILEMMA_ROUND_PRESETS.map((n) => ({
        value: n,
        label: String(n),
        disabled: prep.poolSize < n,
      })),
      {
        value: DILEMMA_ROUND_ALL,
        label: "Tout",
        disabled: prep.poolSize === 0,
      },
    ];

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">⚖️ Dilemma</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("dilemma")}
        </div>
        <p class="game-intro">Choix impossible A vs B, reveal dès que tout le monde a choisi. Ajoute tes dilemmes si tu veux.</p>

        <div class="card">
          <p class="card-heading">Deck de dilemmes</p>
          <div class="theme-chips">
            ${DILEMMA_DECKS.map(
              (d) => `
              <button type="button" class="theme-chip ${deckId === d.id ? "theme-chip--active" : ""}" data-deck="${d.id}"
                ${isHost ? "" : "disabled"}>
                ${escapeHtml(d.label)}
              </button>`
            ).join("")}
          </div>
          <p class="hint" id="dilemma-pool-hint"></p>
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
          <p class="hot-take-duration" id="dilemma-duration" aria-live="polite"></p>
          ${
            prep.capped
              ? `<p class="hint">Seulement ${prep.poolSize} dilemme(s) - toutes les manches seront jouées.</p>`
              : ""
          }
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier les réglages.</p>` : ""}
        </div>

        ${customDilemmaCardHtml()}

        <div class="card" id="dilemma-players">${playersReadySectionHtml(members, session.ready)}</div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="dilemma-start-slot">${dilemmaStartSlotHtml(allReady, prep)}</div>
      `,
    });

    bindEvents();
    restoreDraft(draft);
    refreshDeckAndRounds();
    refreshReadySection();
    mounted = true;
  }

  const unbindRemove = bindPrepRemoveDelegation(app, {
    screenId: "dilemma-prep",
    attr: "data-remove-dilemma",
    onRemove: async (id) => {
      await removeCustomDilemma(id);
      render(captureDraft());
    },
  });

  render();

  if (isGameSyncActive()) {
    void refreshGameSession().then(() => refreshFromSync());
  }

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "dilemma-prep",
    getEntryScreen: getDilemmaEntryScreen,
    buildNavStack: (entry) => ["home", "lobby", "game-select", "dilemma-prep", entry],
  });

  const unsub = onGameSessionChange(() => {
    if (guestFollow()) return;
    refreshFromSync();
  });

  const unsubLobby = onLobbyBundleUpdated(() => {
    if (!mounted) return;
    refreshFromSync();
  });

  return () => {
    unbindRemove();
    prepLobby.dispose();
    unsub();
    unsubLobby();
  };
}
