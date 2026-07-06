import { deleteCustomTierList, getAllTierLists, getTierListById, ROSTER_PREFIX } from "../core/tierLists.js";
import {
  setTierNightTopicId,
  setTierNightMode,
  setTierNightModifier,
} from "../core/state.js";
import {
  TIER_NIGHT_MODES,
  TIER_NIGHT_MODIFIERS,
  TIER_NIGHT_ROSTER_TOPICS,
  DEFAULT_TIER_NIGHT_MODIFIER,
} from "../../data/tierTopics.js";
import { navigate } from "../core/router.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  getCachedGameSession,
  getEffectiveSessionScreen,
} from "../core/gameSync.js";
import {
  markTierNightLiveLobbyStarted,
  markTierNightClassicStarted,
} from "../core/tierNightLiveSession.js";
import { navigateAfterGameLaunch, prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { escapeHtml, pageShell, tierLogoHtml, bindTierLogos } from "../core/ui.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { bindNav } from "./nav.js";
import { showAppAlert, showAppConfirm } from "../core/dialog.js";

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

function renderModifierChips(selected) {
  return TIER_NIGHT_MODIFIERS.map(
    (m) => `
    <button type="button" class="tier-mod-chip ${m.id === selected ? "tier-mod-chip--active" : ""}"
      data-modifier="${escapeHtml(m.id)}" title="${escapeHtml(m.desc)}">
      <span class="tier-mod-chip__emoji">${m.emoji}</span>
      <span class="tier-mod-chip__name">${escapeHtml(m.name)}</span>
    </button>`
  ).join("");
}

function renderRosterCard(topic) {
  return `
    <button type="button" class="tier-roster-card" data-roster="${escapeHtml(topic.id)}">
      <span class="tier-roster-card__emoji">${topic.emoji}</span>
      <span class="tier-roster-card__name">${escapeHtml(topic.name)}</span>
    </button>`;
}

export function mountTierNightSelect(app) {
  let step = "mode";
  let selectedMode = "consensus";
  let selectedModifier = DEFAULT_TIER_NIGHT_MODIFIER;

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

  async function startGame(topicId, modeId) {
    if (!(await ensureHost())) return;
    const mode = modeId || selectedMode;
    const modifier = mode === "consensus" ? selectedModifier : "normal";

    setTierNightMode(mode);
    setTierNightModifier(modifier);
    setTierNightTopicId(topicId);

    if (mode === "live") {
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
      return;
    }

    if (isGameSyncActive()) {
      const result = await markTierNightClassicStarted({ topicId, mode, modifier });
      navigateAfterGameLaunch({ gameScreen: "tiernight", result });
    } else {
      navigate("tiernight");
    }
  }

  function modeStepHtml() {
    return `
      <p class="label-upper label-upper--gold">🏆 Tier Night</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Choisis un mode</h2>
        ${rulesButtonHtml("tiernight")}
      </div>
      <p class="game-intro">Deux façons de jouer : classer des items ou classer le groupe.</p>
      <div class="tier-mode-list">
        ${TIER_NIGHT_MODES.map(renderModeCard).join("")}
      </div>`;
  }

  function listStepHtml() {
    const live = selectedMode === "live";
    const header = live ? "⚡ Mode En direct" : "📊 Mode Rank it";
    const modifiersHtml = live
      ? ""
      : `<p class="field-label">Variante de manche</p>
      <div class="tier-mod-row">${renderModifierChips(selectedModifier)}</div>`;
    return `
      <p class="label-upper label-upper--gold">${header}</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Choisis une tier list</h2>
        ${rulesButtonHtml("tiernight")}
      </div>

      ${modifiersHtml}

      <button type="button" class="card card--clickable card--highlight card--create-tier" data-nav="tiernight-create">
        <div class="card-row">
          <span class="card-row__icon">➕</span>
          <div class="card-row__text">
            <p class="card-row__title">Créer ma tier list</p>
            <p class="card-row__sub">Nom + items personnalisés</p>
          </div>
          <span class="card-row__chevron">›</span>
        </div>
      </button>

      <div class="tier-list-grid">
        ${renderTierGrid()}
      </div>`;
  }

  function topicStepHtml() {
    return `
      <p class="label-upper label-upper--gold">👥 Classe le groupe</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Choisis un thème</h2>
        ${rulesButtonHtml("tiernight")}
      </div>
      <p class="game-intro">Les items à classer seront les joueurs du lobby.</p>
      <div class="tier-roster-grid">
        ${TIER_NIGHT_ROSTER_TOPICS.map(renderRosterCard).join("")}
      </div>`;
  }

  function render() {
    let content = "";
    if (step === "mode") content = modeStepHtml();
    else if (step === "topic") content = topicStepHtml();
    else content = listStepHtml();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        ${step !== "mode" ? `<button type="button" class="btn-back-inline" data-tier-back>‹ Modes</button>` : ""}
        ${content}
      `,
    });

    bindNav(app);
    bindStep();
  }

  function bindStep() {
    app.querySelector("[data-tier-back]")?.addEventListener("click", () => {
      step = "mode";
      render();
    });

    if (step === "mode") {
      app.querySelectorAll("[data-mode]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-mode");
          if (isModeLocked(id)) return;
          selectedMode = id;
          step = id === "roster" ? "topic" : "list";
          render();
        });
      });
      return;
    }

    if (step === "topic") {
      app.querySelectorAll("[data-roster]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-roster");
          void startGame(`${ROSTER_PREFIX}${id}`, "roster");
        });
      });
      return;
    }

    // step === "list" (Rank it ou live)
    app.querySelectorAll("[data-modifier]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedModifier = btn.getAttribute("data-modifier");
        render();
      });
    });
    bindTierGrid(app, (id) => startGame(id, selectedMode));
  }

  const unsubSession = onGameSessionChange(
    prepGuestFollowOnSession({
      prepScreen: "tiernight-select",
      getEntryScreen: () => getEffectiveSessionScreen(getCachedGameSession()),
    })
  );

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
