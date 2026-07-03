import {
  addCustomTake,
  removeCustomTake,
  allHotTakeReady,
  countOtherPlayersCustomTakes,
  getHotTakeSession,
  getMyCustomTakes,
  getHotTakePrepSummary,
  getModerationNotice,
  markHotTakeLobbyStarted,
  getHotTakeEntryScreen,
  setHotTakeReady,
  simulateHotTakeReady,
  setHotTakeTheme,
  setHotTakeRoundCount,
  HOT_TAKE_THEMES,
  HOT_TAKE_ROUND_PRESETS,
  HOT_TAKE_ROUND_ALL,
  HOT_TAKE_CATALOG_ID,
  HOT_TAKE_MIX_ID,
} from "../core/hotTakeSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { onLobbyBundleUpdated } from "../core/supabaseLobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { executePrepLaunch, prepLaunchSlotParams, DEFAULT_PREP_MIN_PLAYERS } from "../core/prepLaunch.js";
import { createPrepLobbyController } from "../core/usePrepLobby.js";
import { navigate } from "../core/router.js";
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
  bindPrepLaunchButtons,
  syncPrepOnMount,
} from "../core/prepScreen.js";
import { bindNav } from "./nav.js";

export function mountHotTakePrep(app) {
  if (!requireLobbyPlay()) return null;

  let mounted = false;
  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getHotTakeSession().ready || {},
  });
  const moderationNotice = getModerationNotice();

  function captureDraft() {
    const input = app.querySelector("#new-take");
    return {
      value: input?.value ?? "",
      focused: document.activeElement === input,
      selStart: input?.selectionStart ?? 0,
      selEnd: input?.selectionEnd ?? 0,
    };
  }

  function restoreDraft(state) {
    const input = app.querySelector("#new-take");
    if (!input || !state) return;
    input.value = state.value;
    if (state.focused) {
      input.focus();
      try {
        input.setSelectionRange(state.selStart, state.selEnd);
      } catch {
        /* ignore */
      }
    }
  }

  function customTakesListHtml() {
    return customEntryListHtml(getMyCustomTakes(), {
      listClass: "take-list",
      removeAttr: "data-remove-take",
      renderItem: (t) => `<span class="take-list__text">${escapeHtml(t.text)}</span>`,
    });
  }

  function othersTakesHintHtml() {
    const n = countOtherPlayersCustomTakes();
    if (!n) return "";
    return `<p class="hint" id="hot-take-others-hint">${n} hot take${n > 1 ? "s" : ""} d'autres joueurs - révélée${n > 1 ? "s" : ""} en manche.</p>`;
  }

  function renderCustomTakesList() {
    const card = app.querySelector("#new-take")?.closest(".card");
    patchDynamicListInCard(card, {
      listSelector: ".take-list",
      listHtml: customTakesListHtml(),
      hintSelector: "#hot-take-others-hint",
      hintHtml: othersTakesHintHtml(),
      insertAfterSelectors: ["#take-error", ".moderation-notice"],
    });
  }

  function hotTakeStartSlotHtml(allReady, prep) {
    const session = getHotTakeSession();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: DEFAULT_PREP_MIN_PLAYERS,
        poolEmpty: prep.effective === 0,
        poolEmptyLabel: "Aucune take disponible",
        launchLabel: "Lancer Hot Take →",
      })
    );
  }

  function refreshReadySection() {
    const session = getHotTakeSession();
    const members = getLobbyParticipants();
    const allReady = allHotTakeReady();
    const prep = getHotTakePrepSummary();

    updatePlayersReadyCard(app.querySelector("#hot-take-players"), members, session.ready);
    updateReadyButton(app.querySelector("#btn-ready"), prepLobby.localReadyState());

    updatePrepStartSlot(
      app.querySelector("#hot-take-start-slot"),
      hotTakeStartSlotHtml(allReady, prep),
      onLaunch
    );

    if (document.activeElement?.id !== "new-take") {
      renderCustomTakesList();
    }
  }

  function refreshThemeAndRounds() {
    const session = getHotTakeSession();
    const themeId = session.selectedThemeId || HOT_TAKE_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
    const prep = getHotTakePrepSummary();

    app.querySelectorAll("[data-theme]").forEach((btn) => {
      const id = btn.getAttribute("data-theme");
      btn.classList.toggle("theme-chip--active", themeId === id);
      btn.disabled = !isHost;
    });

    const poolSize = prep.poolSize;
    app.querySelectorAll("[data-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-round"));
      const disabled =
        value === HOT_TAKE_ROUND_ALL ? poolSize === 0 : poolSize < value;
      btn.classList.toggle("theme-chip--active", roundCount === value);
      btn.disabled = disabled || !isHost;
    });

    const dur = app.querySelector("#hot-take-duration");
    if (dur) {
      dur.innerHTML = `
        <strong>${prep.effective}</strong> hot take${prep.effective > 1 ? "s" : ""}
        · ${escapeHtml(prep.durationLabel)}
        <span class="muted"> (estimation)</span>`;
    }
  }

  function refreshFromSync() {
    const draft = captureDraft();
    refreshThemeAndRounds();
    refreshReadySection();
    restoreDraft(draft);
  }

  async function onLaunch({ force = false } = {}) {
    const prep = getHotTakePrepSummary();
    await executePrepLaunch({
      force,
      btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-start-game"),
      getReadyMap: () => getHotTakeSession().ready || {},
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      gameTitle: "Hot Take",
      gameScreen: "hottake",
      navStack: ["home", "lobby", "game-select", "hottake-prep", "hottake"],
      markStarted: markHotTakeLobbyStarted,
      allReadyFn: allHotTakeReady,
      poolEmpty: prep.effective === 0,
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        const draft = captureDraft();
        await setHotTakeRoundCount(Number(btn.getAttribute("data-round")));
        render(draft);
      });
    });

    app.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost()) return;
        const draft = captureDraft();
        await setHotTakeTheme(btn.getAttribute("data-theme"));
        render(draft);
      });
    });

    app.querySelector("#add-take")?.addEventListener("click", async () => {
      const err = app.querySelector("#take-error");
      const res = await addCustomTake(app.querySelector("#new-take").value);
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      render(captureDraft());
      const input = app.querySelector("#new-take");
      if (input) input.value = "";
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setHotTakeReady,
        simulateReady: simulateHotTakeReady,
        render: refreshReadySection,
      });
    });

    bindPrepLaunchButtons(app, { onLaunch });
  }

  function render(preserveDraft = null) {
    const draft = preserveDraft ?? (mounted ? captureDraft() : null);

    const session = getHotTakeSession();
    const members = getLobbyParticipants();
    const allReady = allHotTakeReady();
    const localReady = prepLobby.localReadyState();
    const themeId = session.selectedThemeId || HOT_TAKE_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLobbyHost();
    const prep = getHotTakePrepSummary();

    const roundChips = [
      ...HOT_TAKE_ROUND_PRESETS.map((n) => ({
        value: n,
        label: String(n),
        disabled: prep.poolSize < n,
      })),
      {
        value: HOT_TAKE_ROUND_ALL,
        label: "Tout",
        disabled: prep.poolSize === 0,
      },
    ];

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--hot">🔥 Hot Take</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("hottake")}
        </div>
        <p class="game-intro">Opinions clivantes : suis le troupeau (+10) ou assume ton côté <strong>outsider</strong> (+15). L'admin choisit d'abord un thème, puis le nombre de manches. Ajoute tes takes si tu veux.</p>

        <div class="card">
          <p class="card-heading">Banque par thème</p>
          <div class="theme-chips">
            ${HOT_TAKE_THEMES.map(
              (th) => `
              <button type="button" class="theme-chip ${themeId === th.id ? "theme-chip--active" : ""}" data-theme="${th.id}"
                ${isHost ? "" : "disabled"}>
                ${escapeHtml(th.label)}
              </button>`
            ).join("")}
          </div>
          ${
            prep.poolSize > 0
              ? themeId === HOT_TAKE_CATALOG_ID
                ? `<p class="hint">${prep.poolSize} take(s) dans le deck - tous les thèmes fusionnés.</p>`
                : themeId === HOT_TAKE_MIX_ID
                  ? `<p class="hint">${prep.poolSize} take(s) tirées au hasard parmi tous les thèmes (+ customs).</p>`
                  : `<p class="hint">${prep.poolSize} take(s) dans ce thème (+ customs si ajoutées).</p>`
              : `<p class="hint">Ajoute un thème dans hotTakes.js pour commencer.</p>`
          }
        </div>

        <div class="card">
          <p class="card-heading">Nombre de hot takes</p>
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
          <p class="hot-take-duration" id="hot-take-duration" aria-live="polite">
            <strong>${prep.effective}</strong> hot take${prep.effective > 1 ? "s" : ""}
            · ${escapeHtml(prep.durationLabel)}
            <span class="muted"> (estimation)</span>
          </p>
          ${
            prep.capped
              ? `<p class="hint">Seulement ${prep.poolSize} take(s) dans le deck - toutes seront jouées.</p>`
              : ""
          }
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier le nombre de manches.</p>` : ""}
        </div>

        <div class="card">
          <label class="field-label" for="new-take">Ta hot take</label>
          <div class="join-row">
            <input type="text" class="field-input join-input" id="new-take" maxlength="120" placeholder="Ton opinion impopulaire…" />
            <button type="button" class="btn btn-secondary join-btn" id="add-take">+</button>
          </div>
          <p class="moderation-notice">${escapeHtml(moderationNotice)}</p>
          <p class="auth-error hidden" id="take-error"></p>
          ${customTakesListHtml()}
          ${othersTakesHintHtml()}
        </div>

        <div class="card" id="hot-take-players">${playersReadySectionHtml(members, session.ready)}</div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="hot-take-start-slot">${hotTakeStartSlotHtml(allReady, prep)}</div>
      `,
    });

    bindEvents();
    restoreDraft(draft);
    mounted = true;
  }

  const unbindRemove = bindPrepRemoveDelegation(app, {
    screenId: "hottake-prep",
    attr: "data-remove-take",
    onRemove: async (id) => {
      await removeCustomTake(id);
      refreshFromSync();
    },
  });

  render();
  syncPrepOnMount(refreshFromSync);

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "hottake-prep",
    getEntryScreen: getHotTakeEntryScreen,
    buildNavStack: (entry) => ["home", "lobby", "game-select", "hottake-prep", entry],
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
