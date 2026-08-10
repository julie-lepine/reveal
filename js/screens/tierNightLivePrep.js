/**
 * FEATURE-TIERNIGHT-04D/04E — prep Rank Live = adapter mince du shell game-prep partagé.
 * Domaine local : roundCount 3/5/7, customLiveTierLists, launch Rank Live.
 * Ready / CTA / sync / launch slot = primitives Hot Take / roster (prepScreen + usePrepLobby).
 */
import {
  allTierNightLivePrepReady,
  getTierNightLivePrepSession,
  getTierNightLivePrepSummary,
  getTierNightLivePrepEntryScreen,
  getModerationNotice,
  listSharedCustomLiveTierListsForPrep,
  isOwnCustomLiveTierList,
  markTierNightLiveSeriesPrepStarted,
  removeCustomLiveTierListFromPrep,
  setTierNightLivePrepReady,
  setTierNightLivePrepRoundCount,
  setTierNightLivePrepCategories,
  simulateTierNightLivePrepReady,
  validateTierNightLivePrepForLaunch,
} from "../core/tierNightLivePrepSession.js";
import {
  TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS,
  TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES,
  listTierNightLiveCategoryOptions,
  getTierNightLivePoolSize,
} from "../core/tierNightLiveSeriesDomain.js";
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
  getEffectiveSessionScreen,
  getCachedGameSession,
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
  playersReadySectionHtml,
  prepStartSlotHtml,
  updatePlayersReadyCard,
  updateReadyButton,
  updatePrepStartSlot,
  bindPrepLaunchButtons,
  syncPrepOnMount,
  runPrepRefreshOnLobbyChange,
} from "../core/prepScreen.js";
import {
  leaveTierNightLivePrepToModes,
  TIER_NIGHT_PREP_MODES_EXIT_NAV,
  leaveLivePrepToSelect,
} from "../core/tierNightNav.js";
import { showAppAlert } from "../core/dialog.js";
import { bindNav } from "./nav.js";

export { leaveLivePrepToSelect };

function customListsHtml() {
  const lists = listSharedCustomLiveTierListsForPrep();
  if (!lists.length) {
    return `<p class="hint muted" id="live-customs-empty">Aucune liste custom pour l'instant.</p>`;
  }
  return `
    <ul class="take-list" id="live-customs-list">
      ${lists
        .map((list) => {
          const own = isOwnCustomLiveTierList(list);
          const count = Array.isArray(list.items) ? list.items.length : 0;
          const emoji = escapeHtml(list.emoji || "✨");
          const name = escapeHtml(list.name || "");
          const author = escapeHtml(list.author || "Joueur");
          return `
            <li class="take-list__item">
              <span class="take-list__text">
                <span aria-hidden="true">${emoji}</span>
                <strong>${name}</strong>
                <span class="muted"> · ${author} · ${count} item${count > 1 ? "s" : ""}</span>
              </span>
              ${
                own
                  ? `<button type="button" class="btn-icon" data-remove-live-custom="${escapeHtml(
                      list.id
                    )}" aria-label="Supprimer ${name}">×</button>`
                  : ""
              }
            </li>`;
        })
        .join("")}
    </ul>`;
}

export function mountTierNightLivePrep(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getTierNightLivePrepEntryScreen();
  if (entry !== "tiernight-live-prep") {
    navigate(entry);
    return null;
  }

  let mounted = false;
  const localName = getLocalDisplayName();
  const prepLobby = createPrepLobbyController({
    localKey: localName,
    getReadyMap: () => getTierNightLivePrepSession().ready || {},
  });
  const moderationNotice = getModerationNotice();

  function seriesStartSlotHtml(allReady) {
    const session = getTierNightLivePrepSession();
    const prep = getTierNightLivePrepSummary();
    return prepStartSlotHtml(
      prepLaunchSlotParams({
        readyMap: session.ready || {},
        allReady,
        isHost: isLobbyHost(),
        minPlayers: DEFAULT_PREP_MIN_PLAYERS,
        poolEmpty: !prep.available,
        poolEmptyLabel: "Choisis une longueur disponible",
        launchLabel: "Lancer la série Rank Live →",
      })
    );
  }

  function refreshReadySection() {
    const session = getTierNightLivePrepSession();
    const members = getLobbyParticipants();
    const allReady = allTierNightLivePrepReady();

    updatePlayersReadyCard(
      app.querySelector("#tier-night-live-prep-players"),
      members,
      session.ready
    );
    updateReadyButton(app.querySelector("#btn-ready"), prepLobby.localReadyState());

    updatePrepStartSlot(
      app.querySelector("#tier-night-live-start-slot"),
      seriesStartSlotHtml(allReady),
      onLaunch
    );

    const customsHost = app.querySelector("#live-customs-host");
    if (customsHost) customsHost.innerHTML = customListsHtml();
  }

  function refreshCategoriesAndRounds() {
    const session = getTierNightLivePrepSession();
    const isHost = isLobbyHost();
    const prep = getTierNightLivePrepSummary();
    const cats = session.categoryIds || [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES];
    const isAll = cats.includes(TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES);
    const selectedId = !isAll && cats.length === 1 ? cats[0] : null;

    app.querySelectorAll("[data-live-cat]").forEach((btn) => {
      const id = btn.getAttribute("data-live-cat");
      const active =
        id === TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES ? isAll : selectedId === id;
      btn.classList.toggle("theme-chip--active", active);
      const minPool = Number(btn.getAttribute("data-cat-min-pool")) || 3;
      const disabledByPool = Number(btn.getAttribute("data-cat-pool")) < minPool;
      btn.disabled = disabledByPool || !isHost;
    });

    app.querySelectorAll("[data-live-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-live-round"));
      const avail = prep.roundCountAvailability?.find((a) => a.roundCount === value);
      btn.classList.toggle("theme-chip--active", session.roundCount === value);
      btn.disabled = !avail?.available || !isHost;
    });

    const poolHint = app.querySelector("#tier-night-live-pool-hint");
    if (poolHint) {
      poolHint.textContent = `${prep.categorySummary} - ${prep.poolSize} liste${
        prep.poolSize > 1 ? "s" : ""
      } disponible${prep.poolSize > 1 ? "s" : ""} (catalogue + customs).`;
    }

    const dur = app.querySelector("#tier-night-live-duration");
    if (dur) {
      dur.innerHTML = prep.available
        ? `<strong>${prep.effective}</strong> liste${prep.effective > 1 ? "s" : ""}
            · ${escapeHtml(prep.durationLabel)}
            <span class="muted"> (estimation)</span>`
        : `<span class="muted">Choisis une longueur disponible</span>`;
    }
  }

  function refreshFromSync() {
    refreshCategoriesAndRounds();
    refreshReadySection();
  }

  async function onLaunch({ force = false } = {}) {
    const result = await executePrepLaunch({
      force,
      btn: app.querySelector(force ? "#btn-force-start-game" : "#btn-start-game"),
      getReadyMap: () => getTierNightLivePrepSession().ready || {},
      minPlayers: DEFAULT_PREP_MIN_PLAYERS,
      gameTitle: "Rank Live",
      gameScreen: "tiernight-live",
      navStack: [
        "home",
        "lobby",
        "game-select",
        "tiernight-select",
        "tiernight-live-prep",
        "tiernight-live",
      ],
      markStarted: markTierNightLiveSeriesPrepStarted,
      allReadyFn: allTierNightLivePrepReady,
      poolEmpty: false,
      validateBeforeLaunch: async () => validateTierNightLivePrepForLaunch(),
    });
    if (result?.ok === false && result?.error) {
      await showAppAlert(result.error, {
        title: "Rank Live",
        icon: "⚠️",
      });
    }
  }

  function bindEvents() {
    bindNav(app, {
      [TIER_NIGHT_PREP_MODES_EXIT_NAV]: () => {
        void (async () => {
          const res = await leaveTierNightLivePrepToModes();
          if (res?.ok === false && res.error) {
            await showAppAlert(res.error, {
              title: "Retour",
              icon: "⚠️",
            });
          }
        })();
      },
    });

    app.querySelectorAll("[data-live-cat]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        const id = btn.getAttribute("data-live-cat");
        if (!id) return;
        await setTierNightLivePrepCategories([id]);
        render();
      });
    });

    app.querySelectorAll("[data-live-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLobbyHost() || btn.disabled) return;
        await setTierNightLivePrepRoundCount(Number(btn.getAttribute("data-live-round")));
        // Même cycle Hot Take/roster : re-render shell (Ready préservé côté session).
        render();
      });
    });

    app.querySelector("#btn-add-live-custom")?.addEventListener("click", () => {
      navigate("tiernight-create", {
        params: { from: "live-prep" },
        navStack: [
          "home",
          "lobby",
          "game-select",
          "tiernight-select",
          "tiernight-live-prep",
          "tiernight-create",
        ],
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      void prepLobby.toggleReady({
        setReady: setTierNightLivePrepReady,
        simulateReady: simulateTierNightLivePrepReady,
        render: refreshReadySection,
      });
    });

    app.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-remove-live-custom]");
      if (!btn || !app.contains(btn) || btn.disabled) return;
      const id = btn.getAttribute("data-remove-live-custom");
      if (!id) return;
      btn.disabled = true;
      void (async () => {
        const err = app.querySelector("#live-custom-error");
        const res = await removeCustomLiveTierListFromPrep(id);
        if (!res?.ok) {
          if (err) {
            err.textContent = res?.error || "Suppression impossible.";
            err.classList.remove("hidden");
          }
          btn.disabled = false;
          return;
        }
        if (err) {
          err.textContent = "";
          err.classList.add("hidden");
        }
        refreshReadySection();
      })();
    });

    bindPrepLaunchButtons(app, { onLaunch });
  }

  function render() {
    const session = getTierNightLivePrepSession();
    const members = getLobbyParticipants();
    const allReady = allTierNightLivePrepReady();
    const localReady = prepLobby.localReadyState();
    const isHost = isLobbyHost();
    const prep = getTierNightLivePrepSummary();
    const cats = session.categoryIds || [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES];
    const isAll = cats.includes(TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES);
    const selectedId = !isAll && cats.length === 1 ? cats[0] : null;
    const catOptions = listTierNightLiveCategoryOptions();
    const customs = listSharedCustomLiveTierListsForPrep();
    const poolOpts = { customLists: customs };

    const categoryChips = [
      {
        id: TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES,
        label: "Tout",
        pool: getTierNightLivePoolSize([TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES], poolOpts),
      },
      ...catOptions.map((c) => ({
        id: c.id,
        label: c.label,
        pool: getTierNightLivePoolSize([c.id], poolOpts),
      })),
    ];

    const roundChipsHtml = TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS.map((n) => {
      const avail = prep.roundCountAvailability.find((a) => a.roundCount === n);
      const disabled = !avail?.available || !isHost;
      return `
        <button type="button" class="theme-chip${
          session.roundCount === n ? " theme-chip--active" : ""
        }" data-live-round="${n}" ${disabled ? "disabled" : ""}>
          ${n}
        </button>`;
    }).join("");

    const categoryChipsHtml = categoryChips
      .map((c) => {
        const active =
          c.id === TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES
            ? isAll
            : selectedId === c.id;
        const disabled = c.pool < 3 || !isHost;
        return `
              <button type="button" class="theme-chip ${active ? "theme-chip--active" : ""}"
                data-live-cat="${escapeHtml(c.id)}"
                data-cat-pool="${c.pool}"
                data-cat-min-pool="3"
                ${disabled ? "disabled" : ""}>
                ${escapeHtml(c.label)}
              </button>`;
      })
      .join("");

    app.innerHTML = pageShell({
      backTarget: TIER_NIGHT_PREP_MODES_EXIT_NAV,
      content: `
        <p class="label-upper label-upper--gold">⚡ Rank Live</p>
        <div class="screen-title-row">
          <h2 class="screen-title">Préparation</h2>
          ${rulesButtonHtml("tiernight")}
        </div>
        <p class="game-intro">Choisis les catégories et la longueur, ajoute des listes custom, puis lance quand tout le monde est prêt.</p>

        <div class="card">
          <p class="card-heading">Catégories</p>
          <div class="theme-chips">${categoryChipsHtml}</div>
          <p class="hint" id="tier-night-live-pool-hint">${escapeHtml(
            `${prep.categorySummary} - ${prep.poolSize} liste${
              prep.poolSize > 1 ? "s" : ""
            } disponible${prep.poolSize > 1 ? "s" : ""} (catalogue + customs).`
          )}</p>
        </div>

        <div class="card">
          <p class="card-heading">Longueur de série</p>
          <div class="theme-chips theme-chips--rounds">${roundChipsHtml}</div>
          <p class="hot-take-duration" id="tier-night-live-duration" aria-live="polite">
            ${
              prep.available
                ? `<strong>${prep.effective}</strong> liste${prep.effective > 1 ? "s" : ""}
            · ${escapeHtml(prep.durationLabel)}
            <span class="muted"> (estimation)</span>`
                : `<span class="muted">Choisis une longueur disponible</span>`
            }
          </p>
          ${
            isHost
              ? ""
              : `<p class="hint">Seul l'hôte peut modifier les réglages.</p>`
          }
        </div>

        <div class="card">
          <p class="card-heading">Listes custom partagées</p>
          <p class="hint muted">Nom, emoji, auteur et nombre d'items - visibles par tous.</p>
          <div id="live-customs-host">${customListsHtml()}</div>
          <p class="auth-error hidden" id="live-custom-error"></p>
          <button type="button" class="btn btn-secondary btn--spaced" id="btn-add-live-custom">
            Ajouter une liste custom →
          </button>
          <p class="moderation-notice">${moderationNotice}</p>
        </div>

        <div class="card" id="tier-night-live-prep-players">
          ${playersReadySectionHtml(members, session.ready)}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="tier-night-live-start-slot">
          ${seriesStartSlotHtml(allReady)}
        </div>
      `,
    });

    bindEvents();
  }

  render();
  mounted = true;

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "tiernight-live-prep",
    getEntryScreen: () => {
      const effective = getEffectiveSessionScreen(getCachedGameSession());
      if (effective === "tiernight-select") return "tiernight-select";
      return getTierNightLivePrepEntryScreen();
    },
    buildNavStack: (entry) => {
      if (entry === "tiernight-live") {
        return [
          "home",
          "lobby",
          "game-select",
          "tiernight-select",
          "tiernight-live-prep",
          "tiernight-live",
        ];
      }
      return ["home", "lobby", "game-select", "tiernight-select", "tiernight-live-prep"];
    },
    buildNavigateOpts: (entry) => {
      if (entry === "tiernight-select") {
        return {
          params: { step: "mode", mode: "live" },
          navStack: ["home", "lobby", "game-select", "tiernight-select"],
        };
      }
      if (entry === "tiernight-live") {
        return {
          navStack: [
            "home",
            "lobby",
            "game-select",
            "tiernight-select",
            "tiernight-live-prep",
            "tiernight-live",
          ],
        };
      }
      return {
        navStack: ["home", "lobby", "game-select", "tiernight-select", "tiernight-live-prep"],
      };
    },
  });

  const unsubSession = onGameSessionChange(() => {
    if (!mounted) return;
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

  syncPrepOnMount(refreshFromSync);

  return () => {
    mounted = false;
    prepLobby.dispose();
    unsubSession?.();
    unsubLobby?.();
    // Pas de reset ici : navigation vers create conserve settings/ready.
    // Reset = enter(resetSettings) / leaveTierNightLivePrepToModes / reset evening|game.
  };
}
