import { deleteCustomTierList, getAllTierLists, getTierListById } from "../core/tierLists.js";
import {
  setTierNightTopicId,
  setTierNightMode,
  setTierNightModifier,
} from "../core/state.js";
import {
  TIER_NIGHT_MODES,
  DEFAULT_TIER_NIGHT_MODE,
  normalizeTierNightMode,
} from "../../data/tierTopics.js";
import { getScreenParams } from "../core/router.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  getCachedGameSession,
  getEffectiveSessionScreen,
} from "../core/gameSync.js";
import { markTierNightLiveLobbyStarted } from "../core/tierNightLiveSession.js";
import { navigateAfterGameLaunch, prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { escapeHtml, pageShell, tierLogoHtml, bindTierLogos } from "../core/ui.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { bindNav } from "./nav.js";
import { showAppAlert, showAppConfirm } from "../core/dialog.js";
import { isTierNightSeriesUiEnabled } from "../core/tierNightSeriesGate.js";
import { enterTierNightSeriesPrep } from "../core/tierNightSeriesPrepSession.js";
import { enterTierNightLivePrep } from "../core/tierNightLivePrepSession.js";
import { navigate } from "../core/router.js";

/**
 * FEATURE-TIERNIGHT-03-F / 04D - select modes TierNight.
 *
 * Classe le groupe → tiernight-prep (série) uniquement.
 * Anciens steps wizard / grille mono → normalisation vers prep (ou mode si kill switch).
 * Rank Live → tiernight-live-prep (plus de step=list / mono launch depuis ce parcours).
 * Aucune nouvelle session classic.
 */

/** Anciens steps wizard SERIES-04 / grille - normalisés, jamais rendus. */
const LEGACY_SERIES_DEAD_STEPS = new Set([
  "topic",
  "roster-path",
  "series-category",
  "series-count",
  "series-review",
]);

/** Tous les modes sont jouables en solo comme en multijoueur. */
function isModeLocked() {
  return false;
}

function renderTierCard(list) {
  const logo = `
    <div class="tier-list-card__logo">
      ${tierLogoHtml(list)}
    </div>
    <span class="tier-list-card__name">${escapeHtml(list.name)}</span>
    <span class="tier-list-card__count">${list.items.length} items</span>`;

  if (list.custom) {
    return `
      <div class="tier-list-card tier-list-card--custom" data-tier-id="${escapeHtml(list.id)}">
        <button
          type="button"
          class="tier-list-card__delete"
          data-tier-delete="${escapeHtml(list.id)}"
          aria-label="Supprimer ${escapeHtml(list.name)}"
        >×</button>
        <div class="tier-list-card__body" data-tier-select tabindex="0">
          ${logo}
        </div>
      </div>`;
  }

  return `
    <button type="button" class="tier-list-card" data-tier-id="${escapeHtml(list.id)}" data-tier-select>
      ${logo}
    </button>`;
}

function renderTierGrid() {
  const lists = getAllTierLists();
  return lists.map(renderTierCard).join("");
}

function renderModeCard(mode) {
  return `
    <button type="button" class="tier-mode-card" data-mode="${escapeHtml(mode.id)}">
      <span class="tier-mode-card__emoji">${mode.emoji}</span>
      <span class="tier-mode-card__body">
        <span class="tier-mode-card__name">${escapeHtml(mode.name)}</span>
        <span class="tier-mode-card__tagline">${escapeHtml(mode.tagline)}</span>
        <span class="tier-mode-card__desc">${escapeHtml(mode.desc)}</span>
      </span>
      <span class="card-row__chevron">›</span>
    </button>`;
}

export function mountTierNightSelect(app) {
  const params = getScreenParams() || {};
  const seriesUi = isTierNightSeriesUiEnabled();
  let selectedMode = normalizeTierNightMode(params.mode || DEFAULT_TIER_NIGHT_MODE);
  let step =
    params.step === "list" || params.step === "mode" || LEGACY_SERIES_DEAD_STEPS.has(params.step)
      ? params.step
      : "mode";
  if (LEGACY_SERIES_DEAD_STEPS.has(step)) selectedMode = "roster";
  if (step === "list") selectedMode = "live";

  // Ancienne grille / wizard → prep série (jamais classic). Kill switch → modes sûrs.
  if (LEGACY_SERIES_DEAD_STEPS.has(step)) {
    if (seriesUi) {
      void enterTierNightSeriesPrep({ resetSettings: false });
      return () => {};
    }
    step = "mode";
  }

  // FEATURE-TIERNIGHT-04D - step=list mort : redirige vers live prep (pas de pick mono).
  if (step === "list") {
    void enterTierNightLivePrep({ resetSettings: false });
    return () => {};
  }

  async function ensureHost() {
    if (isGameSyncActive() && !isLobbyHost()) {
      await showAppAlert("Seul l'hôte choisit le mode et le thème pour le lobby.", {
        title: "Action réservée",
        icon: "👑",
      });
      return false;
    }
    return true;
  }

  async function openSeriesPrepFromRoster() {
    if (!(await ensureHost())) return;
    if (!isTierNightSeriesUiEnabled()) {
      await showAppAlert(
        "Le parcours Classe le groupe est temporairement indisponible.",
        { title: "TierNight", icon: "⚠️" }
      );
      return;
    }
    const res = await enterTierNightSeriesPrep({ resetSettings: true });
    if (res?.ok === false) {
      await showAppAlert(res.error || "Impossible d'ouvrir la préparation.", {
        title: "Préparation",
        icon: "⚠️",
      });
    }
  }

  /**
   * FEATURE-TIERNIGHT-04D - Rank Live → prep série (pas de pick list / mono launch).
   */
  async function openLivePrepFromSelect() {
    if (!(await ensureHost())) return;
    setTierNightMode("live");
    setTierNightModifier("normal");
    const res = await enterTierNightLivePrep({ resetSettings: true });
    if (res?.ok === false) {
      await showAppAlert(res.error || "Impossible d'ouvrir la préparation Rank Live.", {
        title: "Préparation",
        icon: "⚠️",
      });
    }
  }

  /**
   * Compat legacy : mono launch depuis une URL step=list encore en pile.
   * Le nouveau parcours mode→live n'appelle plus cette fonction.
   */
  async function startLiveGame(topicId) {
    if (!(await ensureHost())) return;
    setTierNightMode("live");
    setTierNightModifier("normal");
    setTierNightTopicId(topicId);

    const list = getTierListById(topicId);
    if (!list) return;
    const result = isGameSyncActive()
      ? await markTierNightLiveLobbyStarted({
          topicId,
          listName: list.name,
          items: list.items,
        })
      : null;
    if (isGameSyncActive()) {
      navigateAfterGameLaunch({ gameScreen: "tiernight-live", result });
    } else {
      navigate("tiernight-live");
    }
  }

  function modeStepHtml() {
    return `
      <p class="label-upper label-upper--gold">🏆 Tier Night</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Choisis un mode</h2>
        ${rulesButtonHtml("tiernight")}
      </div>
      <p class="game-intro">Classe le groupe en série de thèmes, ou vote en Rank live item par item.</p>
      <div class="tier-mode-list">
        ${TIER_NIGHT_MODES.map(renderModeCard).join("")}
      </div>`;
  }

  function listStepHtml() {
    return `
      <p class="label-upper label-upper--gold">Rank live · modes de jeu</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Choisis une tier list</h2>
        ${rulesButtonHtml("tiernight")}
      </div>

      <button type="button" class="card card--clickable card--highlight card--create-tier" data-nav="tiernight-create">
        <div class="card-row">
          <span class="card-row__icon">➕</span>
          <div class="card-row__text">
            <p class="card-row__title">Créer ma tier list</p>
            <p class="card-row__sub">Puis jouer en Rank live</p>
          </div>
          <span class="card-row__chevron">›</span>
        </div>
      </button>

      <div class="tier-list-grid">
        ${renderTierGrid()}
      </div>`;
  }

  function backTargetForStep() {
    if (step === "mode") return "back";
    return "tiernight-modes";
  }

  function render() {
    let content = "";
    if (step === "mode") content = modeStepHtml();
    else content = listStepHtml();

    const onModeLevel = step === "mode";
    app.innerHTML = pageShell({
      back: true,
      backTarget: onModeLevel ? "back" : backTargetForStep(),
      content,
    });

    bindNav(app, {
      "tiernight-modes": () => {
        step = "mode";
        render();
      },
    });
    bindStep();
  }

  function bindStep() {
    if (step === "mode") {
      app.querySelectorAll("[data-mode]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-mode");
          if (isModeLocked(id)) return;
          selectedMode = id;
          if (id === "roster") {
            void openSeriesPrepFromRoster();
            return;
          }
          if (id === "live") {
            void openLivePrepFromSelect();
            return;
          }
          step = "list";
          render();
        });
      });
      return;
    }

    // step === "list" ne doit plus être rendu (redirigé au mount).
  }

  // Conservé pour audit : aucun bind CTA mono depuis le nouveau parcours.
  void startLiveGame;

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "tiernight-select",
    getEntryScreen: () => {
      const effective = getEffectiveSessionScreen(getCachedGameSession());
      if (
        effective === "tiernight-prep" ||
        effective === "tiernight-live-prep" ||
        effective === "tiernight" ||
        effective === "tiernight-live" ||
        effective === "tiernight-between" ||
        effective === "tiernight-end"
      ) {
        return effective;
      }
      return effective || "tiernight-select";
    },
    buildNavStack: (entry) => {
      if (entry === "tiernight-prep") {
        return ["home", "lobby", "game-select", "tiernight-select", "tiernight-prep"];
      }
      if (entry === "tiernight-live-prep") {
        return ["home", "lobby", "game-select", "tiernight-select", "tiernight-live-prep"];
      }
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
      if (entry === "tiernight" || entry === "tiernight-between" || entry === "tiernight-end") {
        return [
          "home",
          "lobby",
          "game-select",
          "tiernight-select",
          "tiernight-prep",
          "tiernight",
          ...(entry === "tiernight-between" ? ["tiernight-between"] : []),
          ...(entry === "tiernight-end" ? ["tiernight-end"] : []),
        ];
      }
      return ["home", "lobby", "game-select", "tiernight-select"];
    },
  });

  const unsubSession = onGameSessionChange(() => {
    if (guestFollow()) return;
  });

  render();

  return () => {
    unsubSession?.();
  };
}

function bindTierGrid(app, onSelect) {
  const grid = app.querySelector(".tier-list-grid");
  if (!grid) return;

  bindTierLogos(grid);

  grid.querySelectorAll("[data-tier-select]").forEach((el) => {
    const card = el.closest("[data-tier-id]");
    const id = card?.getAttribute("data-tier-id");
    if (!id) return;

    const handler = () => onSelect(id);
    el.addEventListener("click", handler);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler();
      }
    });
  });

  grid.querySelectorAll("[data-tier-delete]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-tier-delete");
      const list = getTierListById(id);
      const name = list?.name || "cette tier list";
      const ok = await showAppConfirm(`Supprimer « ${name} » ? Cette action est irréversible.`, {
        title: "Supprimer la tier list",
        confirmLabel: "Supprimer",
        cancelLabel: "Annuler",
        icon: "🗑️",
      });
      if (!ok) return;
      deleteCustomTierList(id);
      grid.innerHTML = renderTierGrid();
      bindTierGrid(app, onSelect);
    });
  });
}
