/**
 * FEATURE-TIERNIGHT-03-B - game-prep série « Classe le groupe » (UX Hot Take).
 * Queue uniquement au launch ; customs one-shot après succès.
 */
import {
  addCustomRosterTopicFromPrep,
  removeCustomRosterTopicFromPrep,
  allTierNightSeriesPrepReady,
  countOtherPlayersCustomRosterTopics,
  getTierNightSeriesPrepSession,
  getMyCustomRosterTopicsForPrep,
  getTierNightSeriesPrepSummary,
  getTierNightSeriesPrepPoolOpts,
  getModerationNotice,
  markTierNightSeriesPrepStarted,
  getTierNightSeriesPrepEntryScreen,
  setTierNightSeriesPrepReady,
  simulateTierNightSeriesPrepReady,
  setTierNightSeriesPrepCategories,
  setTierNightSeriesPrepRoundCount,
} from "../core/tierNightSeriesPrepSession.js";
import {
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  TIER_NIGHT_SERIES_ROUND_COUNTS,
} from "../core/tierNightSeries.js";
import {
  getTierNightSeriesPoolSize,
  listTierNightSeriesCategoryOptions,
  formatTierNightSeriesCategorySummary,
} from "../core/tierNightSeriesSetup.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { onLobbyBundleUpdated } from "../core/supabaseLobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import {
  isLobbyHost,
  onGameSessionChange,
  refreshGameSession,
  isGameSyncActive,
} from "../core/gameSync.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import {
  executePrepLaunch,
  prepLaunchSlotParams,
  DEFAULT_PREP_MIN_PLAYERS,
} from "../core/prepLaunch.js";
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
  charCountHtml,
  bindCharCounter,
  updateCharCount,
  prepOthersCustomEntriesHintHtml,
  runPrepRefreshOnLobbyChange,
} from "../core/prepScreen.js";
import { PLAYER_TEXT_MAX_LEN } from "../../data/playerTextLimits.js";
import { bindNav } from "./nav.js";

function poolSizeForCategories(categoryIds) {
  return getTierNightSeriesPoolSize(categoryIds, getTierNightSeriesPrepPoolOpts());
}

export function mountTierNightPrep(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getTierNightSeriesPrepEntryScreen();
  if (entry !== "tiernight-prep") {
    navigate(entry);
    return null;
  }

  let mounted = false;
  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getTierNightSeriesPrepSession().ready || {},
  });
  const moderationNotice = getModerationNotice();

  let unbindCharCounter = () => {};

  function captureDraft() {
    const input = app.querySelector("#new-roster-topic");
    return {
      value: input?.value ?? "",
      focused: document.activeElement === input,
      selStart: input?.selectionStart ?? 0,
      selEnd: input?.selectionEnd ?? 0,
    };
  }

  function restoreDraft(state) {
    const input = app.querySelector("#new-roster-topic");
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

  function customTopicsListHtml() {
    return customEntryListHtml(getMyCustomRosterTopicsForPrep(), {
      listClass: "take-list",
      removeAttr: "data-remove-roster-topic",
      renderItem: (t) => `<span class="take-list__text">${escapeHtml(t.name)}</span>`,
    });
  }

  function othersTopicsHintHtml() {
    return prepOthersCustomEntriesHintHtml({
      count: countOtherPlayersCustomRosterTopics(),
      hintId: "tier-night-others-hint",
      itemLabel: "thème",
      revealedPast: "ajouté",
    });
  }

  function renderCustomTopicsList() {
    const card = app.querySelector("#new-roster-topic")?.closest(".card");
    patchDynamicListInCard(card, {
      listSelector: ".take-list",
      listHtml: customTopicsListHtml(),
      hintSelector: "#tier-night-others-hint",
      hintHtml: othersTopicsHintHtml(),
      insertAfterSelectors: ["#roster-topic-error", ".moderation-notice"],
    });
  }

  function seriesStartSlotHtml(allReady, prep) {
    const session = getTierNightSeriesPrepSession();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: DEFAULT_PREP_MIN_PLAYERS,
        poolEmpty: !prep.available || prep.effective === 0,
        poolEmptyLabel: prep.requested
          ? "Pas assez de thèmes pour cette longueur"
          : "Choisis une longueur de série",
        launchLabel: "Lancer la série →",
      })
    );
  }

  function refreshReadySection() {
    const session = getTierNightSeriesPrepSession();
    const members = getLobbyParticipants();
    const allReady = allTierNightSeriesPrepReady();
    const prep = getTierNightSeriesPrepSummary();

    updatePlayersReadyCard(
      app.querySelector("#tier-night-prep-players"),
      members,
      session.ready
    );
    updateReadyButton(app.querySelector("#btn-ready"), prepLobby.localReadyState());

    updatePrepStartSlot(
      app.querySelector("#tier-night-start-slot"),
      seriesStartSlotHtml(allReady, prep),
      onLaunch
    );

    if (document.activeElement?.id !== "new-roster-topic") {
      renderCustomTopicsList();
    }
  }

  function refreshCategoriesAndCounts() {
    const session = getTierNightSeriesPrepSession();
    const isHost = isLobbyHost();
    const prep = getTierNightSeriesPrepSummary();
    const cats = session.categoryIds || [TIER_NIGHT_SERIES_ALL_CATEGORIES];
    const isAll = cats.includes(TIER_NIGHT_SERIES_ALL_CATEGORIES);
    const selectedId = !isAll && cats.length === 1 ? cats[0] : null;

    app.querySelectorAll("[data-series-cat]").forEach((btn) => {
      const id = btn.getAttribute("data-series-cat");
      const active =
        id === TIER_NIGHT_SERIES_ALL_CATEGORIES ? isAll : selectedId === id;
      btn.classList.toggle("theme-chip--active", active);
      const catDisabled = btn.hasAttribute("data-cat-disabled");
      btn.disabled = !isHost || catDisabled;
    });

    app.querySelectorAll("[data-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-round"));
      const avail = prep.roundCountAvailability.find((a) => a.roundCount === value);
      btn.classList.toggle("theme-chip--active", session.roundCount === value);
      btn.disabled = !avail?.available || !isHost;
    });

    const dur = app.querySelector("#tier-night-duration");
    if (dur) {
      if (prep.available) {
        dur.innerHTML = `
          <strong>${prep.effective}</strong> thème${prep.effective > 1 ? "s" : ""}
          · ${escapeHtml(prep.durationLabel)}
          <span class="muted"> (estimation)</span>`;
      } else {
        dur.innerHTML = `<span class="muted">Choisis une longueur disponible</span>`;
      }
    }

    const poolHint = app.querySelector("#tier-night-pool-hint");
    if (poolHint) {
      const catLabel = formatTierNightSeriesCategorySummary(cats);
      poolHint.textContent = `${catLabel} - ${prep.poolSize} thème${
        prep.poolSize > 1 ? "s" : ""
      } disponible${prep.poolSize > 1 ? "s" : ""} (catalogue + customs).`;
    }
  }

  function refreshFromSync() {
    const draft = captureDraft();
    refreshCategoriesAndCounts();
    refreshReadySection();
    restoreDraft(draft);
  }

  async function onLaunch({ force = false } = {}) {
    const prep = getTierNightSeriesPrepSummary();
    await executePrepLaunch({
      force,
      btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-start-game"),
      getReadyMap: () => getTierNightSeriesPrepSession().ready || {},
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      gameTitle: "Classe le groupe",
      gameScreen: "tiernight",
      navStack: [
        "home",
        "lobby",
        "game-select",
        "tiernight-select",
        "tiernight-prep",
        "tiernight",
      ],
      markStarted: markTierNightSeriesPrepStarted,
      allReadyFn: allTierNightSeriesPrepReady,
      poolEmpty: !prep.available || prep.effective === 0,
      validateBeforeLaunch: async () => {
        const s = getTierNightSeriesPrepSummary();
        if (!s.available) {
          return {
            ok: false,
            message: s.requested
              ? `Seulement ${s.poolSize} thème(s) pour ${s.requested} manches.`
              : "Choisis 3, 5 ou 8 manches.",
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
        const draft = captureDraft();
        await setTierNightSeriesPrepRoundCount(Number(btn.getAttribute("data-round")));
        render(draft);
      });
    });

    app.querySelectorAll("[data-series-cat]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        const id = btn.getAttribute("data-series-cat");
        const categoryIds =
          id === TIER_NIGHT_SERIES_ALL_CATEGORIES
            ? [TIER_NIGHT_SERIES_ALL_CATEGORIES]
            : [id];
        const draft = captureDraft();
        await setTierNightSeriesPrepCategories(categoryIds);
        render(draft);
      });
    });

    app.querySelector("#add-roster-topic")?.addEventListener("click", async () => {
      const err = app.querySelector("#roster-topic-error");
      const res = await addCustomRosterTopicFromPrep(
        app.querySelector("#new-roster-topic").value
      );
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      render(captureDraft());
      const input = app.querySelector("#new-roster-topic");
      if (input) input.value = "";
      updateCharCount(input, app.querySelector("#new-roster-topic-count"));
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setTierNightSeriesPrepReady,
        simulateReady: simulateTierNightSeriesPrepReady,
        render: refreshReadySection,
      });
    });

    bindPrepLaunchButtons(app, { onLaunch });

    unbindCharCounter();
    unbindCharCounter = bindCharCounter(
      app.querySelector("#new-roster-topic"),
      app.querySelector("#new-roster-topic-count")
    );
  }

  function render(preserveDraft = null) {
    const draft = preserveDraft ?? (mounted ? captureDraft() : null);

    const session = getTierNightSeriesPrepSession();
    const members = getLobbyParticipants();
    const allReady = allTierNightSeriesPrepReady();
    const localReady = prepLobby.localReadyState();
    const isHost = isLobbyHost();
    const prep = getTierNightSeriesPrepSummary();
    const cats = session.categoryIds || [TIER_NIGHT_SERIES_ALL_CATEGORIES];
    const isAll = cats.includes(TIER_NIGHT_SERIES_ALL_CATEGORIES);
    const selectedId = !isAll && cats.length === 1 ? cats[0] : null;
    const catOptions = listTierNightSeriesCategoryOptions();

    const categoryChips = [
      {
        id: TIER_NIGHT_SERIES_ALL_CATEGORIES,
        label: "Tout",
        disabled: poolSizeForCategories([TIER_NIGHT_SERIES_ALL_CATEGORIES]) < 3,
      },
      ...catOptions.map((c) => ({
        id: c.id,
        label: c.label,
        disabled: poolSizeForCategories([c.id]) < 3,
      })),
    ];

    const roundChips = TIER_NIGHT_SERIES_ROUND_COUNTS.map((n) => {
      const avail = prep.roundCountAvailability.find((a) => a.roundCount === n);
      return {
        value: n,
        label: String(n),
        disabled: !avail?.available,
      };
    });

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">🏅 Classe le groupe</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation série</h2>
          ${rulesButtonHtml("tiernight")}
        </div>
        <p class="game-intro">Enchaîne plusieurs thèmes d'affilée. L'hôte choisit les catégories et la longueur (3, 5 ou 8). Ajoute tes thèmes personnalisés si tu veux. <span class="muted">(${PLAYER_TEXT_MAX_LEN} caractères max.)</span></p>

        <div class="card">
          <p class="card-heading">Catégories</p>
          <div class="theme-chips">
            ${categoryChips
              .map((c) => {
                const active =
                  c.id === TIER_NIGHT_SERIES_ALL_CATEGORIES
                    ? isAll
                    : selectedId === c.id;
                return `
              <button type="button" class="theme-chip ${active ? "theme-chip--active" : ""}"
                data-series-cat="${escapeHtml(c.id)}"
                ${c.disabled ? "data-cat-disabled" : ""}
                ${c.disabled || !isHost ? "disabled" : ""}>
                ${escapeHtml(c.label)}
              </button>`;
              })
              .join("")}
          </div>
          <p class="hint" id="tier-night-pool-hint">${escapeHtml(
            `${formatTierNightSeriesCategorySummary(cats)} - ${prep.poolSize} thème${
              prep.poolSize > 1 ? "s" : ""
            } disponible${prep.poolSize > 1 ? "s" : ""} (catalogue + customs).`
          )}</p>
        </div>

        <div class="card">
          <p class="card-heading">Longueur de série</p>
          <div class="theme-chips theme-chips--rounds">
            ${roundChips
              .map(
                ({ value, label, disabled }) => `
              <button type="button" class="theme-chip ${
                session.roundCount === value ? "theme-chip--active" : ""
              }"
                data-round="${value}" ${disabled || !isHost ? "disabled" : ""}>
                ${label}
              </button>`
              )
              .join("")}
          </div>
          <p class="hot-take-duration" id="tier-night-duration" aria-live="polite">
            ${
              prep.available
                ? `<strong>${prep.effective}</strong> thème${prep.effective > 1 ? "s" : ""}
            · ${escapeHtml(prep.durationLabel)}
            <span class="muted"> (estimation)</span>`
                : `<span class="muted">Choisis une longueur disponible</span>`
            }
          </p>
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier les réglages.</p>` : ""}
        </div>

        <div class="card">
          <label class="field-label" for="new-roster-topic">Ton thème personnalisé</label>
          <div class="join-row">
            <input type="text" class="field-input join-input" id="new-roster-topic" maxlength="${PLAYER_TEXT_MAX_LEN}" placeholder="Ex. Qui panique en premier ?" />
            <button type="button" class="btn btn-secondary join-btn" id="add-roster-topic">+</button>
          </div>
          ${charCountHtml("new-roster-topic-count")}
          <p class="moderation-notice">${escapeHtml(moderationNotice)}</p>
          <p class="auth-error hidden" id="roster-topic-error"></p>
          ${customTopicsListHtml()}
          ${othersTopicsHintHtml()}
        </div>

        <div class="card" id="tier-night-prep-players">${playersReadySectionHtml(
          members,
          session.ready
        )}</div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="tier-night-start-slot">${seriesStartSlotHtml(allReady, prep)}</div>
      `,
    });

    bindEvents();
    restoreDraft(draft);
    updateCharCount(
      app.querySelector("#new-roster-topic"),
      app.querySelector("#new-roster-topic-count")
    );
    mounted = true;
  }

  const unbindRemove = bindPrepRemoveDelegation(app, {
    screenId: "tiernight-prep",
    attr: "data-remove-roster-topic",
    onRemove: async (id) => {
      await removeCustomRosterTopicFromPrep(id);
      refreshFromSync();
    },
  });

  render();
  syncPrepOnMount(refreshFromSync);

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "tiernight-prep",
    getEntryScreen: getTierNightSeriesPrepEntryScreen,
    buildNavStack: (entry) => [
      "home",
      "lobby",
      "game-select",
      "tiernight-select",
      "tiernight-prep",
      entry,
    ],
  });

  const unsub = onGameSessionChange(() => {
    if (guestFollow()) return;
    refreshFromSync();
  });

  const unsubLobby = onLobbyBundleUpdated(() => {
    if (!mounted) return;
    void runPrepRefreshOnLobbyChange({
      isActive: isGameSyncActive,
      refresh: refreshGameSession,
      refreshFromSync,
    });
  });

  return () => {
    unbindCharCounter();
    unbindRemove();
    prepLobby.dispose();
    unsub();
    unsubLobby();
  };
}
