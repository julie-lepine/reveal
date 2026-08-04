import { deleteCustomTierList, getAllTierLists, getTierListById } from "../core/tierLists.js";
import { getCustomRosterTopics, getLocalDisplayName } from "../core/state.js";
import { deleteCustomRosterTopicAndSync } from "../core/customRosterTopicSession.js";
import { isCustomRosterTopicOwnedBy } from "../core/sessionMerge.js";
import { getSupabaseUserId } from "../core/supabaseAuth.js";
import { resolveRosterTopicConfig, ROSTER_TOPIC_PREFIX } from "../core/rosterTopic.js";
import {
  setTierNightTopicId,
  setTierNightMode,
  setTierNightModifier,
} from "../core/state.js";
import {
  TIER_NIGHT_MODES,
  TIER_NIGHT_ROSTER_TOPICS,
  DEFAULT_TIER_NIGHT_MODE,
  normalizeTierNightMode,
} from "../../data/tierTopics.js";
import { navigate, getScreenParams } from "../core/router.js";
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

function renderRosterCard(topic, { custom = false, canDelete = false } = {}) {
  const cardEmoji = custom ? "✏️" : topic.emoji || "👥";
  const deleteBtn = custom && canDelete
    ? `<button
          type="button"
          class="tier-roster-card__delete"
          data-roster-delete="${escapeHtml(topic.id)}"
          aria-label="Supprimer ${escapeHtml(topic.name)}"
        >×</button>`
    : "";
  return `
    <div class="tier-roster-card${custom ? " tier-roster-card--custom" : ""}" data-roster-id="${escapeHtml(topic.id)}">
      ${deleteBtn}
      <button type="button" class="tier-roster-card__body" data-roster="${escapeHtml(topic.id)}">
        <span class="tier-roster-card__emoji">${cardEmoji}</span>
        <span class="tier-roster-card__name">${escapeHtml(topic.name)}</span>
      </button>
    </div>`;
}

export function mountTierNightSelect(app) {
  const params = getScreenParams() || {};
  let selectedMode = normalizeTierNightMode(params.mode || DEFAULT_TIER_NIGHT_MODE);
  let step =
    params.step === "topic" || params.step === "list" || params.step === "mode"
      ? params.step
      : "mode";
  if (step === "topic") selectedMode = "roster";
  if (step === "list") selectedMode = "live";

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
    // Variantes de manche retirées de l'UI : toujours normal.
    const modifier = "normal";

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

    const rosterConfig = resolveRosterTopicConfig(topicId);
    if (!rosterConfig.found) {
      await showAppAlert("Ce thème est introuvable ou invalide.", {
        title: "Thème indisponible",
        icon: "⚠️",
      });
      return;
    }

    // roster → plateau partagé (state.tierNight / écran tiernight)
    if (isGameSyncActive()) {
      const result = await markTierNightClassicStarted({ topicId, mode, modifier });
      if (result?.ok === false) {
        await showAppAlert(result.error || "Impossible de lancer la partie.", {
          title: "Lancement impossible",
          icon: "⚠️",
        });
        return;
      }
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
      <p class="game-intro">Classe le groupe, ou vote en Rank live item par item.</p>
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

  function topicStepHtml() {
    const me = getLocalDisplayName();
    const localUid = getSupabaseUserId();
    const customs = getCustomRosterTopics();
    if (typeof globalThis !== "undefined" && globalThis.__REVEAL_DEBUG_ROSTER__) {
      console.debug("REVEAL roster render topicStep", {
        topics: customs.map((t) => ({
          id: t.id,
          name: t.name,
          authorUid: t.authorUid ?? null,
          author: t.author ?? null,
        })),
        localUid,
        me,
      });
    }
    const customSection =
      customs.length > 0
        ? `
      <p class="label-upper label-upper--muted">Thèmes personnalisés</p>
      <div class="tier-roster-grid tier-roster-grid--custom">
        ${customs
          .map((t) =>
            renderRosterCard(t, {
              custom: true,
              canDelete: isCustomRosterTopicOwnedBy(t, me, localUid),
            })
          )
          .join("")}
      </div>`
        : "";

    return `
      <p class="label-upper label-upper--gold">Classe le groupe · modes de jeu</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Choisis un thème</h2>
        ${rulesButtonHtml("tiernight")}
      </div>
      <p class="game-intro">Les items à classer seront les joueurs du lobby.</p>

      <button type="button" class="card card--clickable card--highlight card--create-tier" data-nav="tiernight-create-roster">
        <div class="card-row">
          <span class="card-row__icon">➕</span>
          <div class="card-row__text">
            <p class="card-row__title">Créer mon thème</p>
            <p class="card-row__sub">Question personnalisée pour classer le groupe</p>
          </div>
          <span class="card-row__chevron">›</span>
        </div>
      </button>

      ${customSection}

      <p class="label-upper label-upper--muted">Thèmes proposés</p>
      <div class="tier-roster-grid tier-roster-grid--catalog">
        ${TIER_NIGHT_ROSTER_TOPICS.map((t) => renderRosterCard(t)).join("")}
      </div>`;
  }

  function render() {
    let content = "";
    if (step === "mode") content = modeStepHtml();
    else if (step === "topic") content = topicStepHtml();
    else content = listStepHtml();

    // UX-TIERNIGHT-NAV-01 : un seul chevron classique.
    // Niveau mode → retour jeux. Niveau topic/list → retour choix des modes.
    const onModeLevel = step === "mode";
    app.innerHTML = pageShell({
      back: true,
      backTarget: onModeLevel ? "back" : "tiernight-modes",
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
          void startGame(`${ROSTER_TOPIC_PREFIX}${id}`, "roster");
        });
      });
      app.querySelectorAll("[data-roster-delete]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute("data-roster-delete");
          const topic = getCustomRosterTopics().find((t) => t.id === id);
          const name = topic?.name || "ce thème";
          const ok = await showAppConfirm(`Supprimer « ${name} » ? Cette action est irréversible.`, {
            title: "Supprimer le thème",
            confirmLabel: "Supprimer",
            cancelLabel: "Annuler",
            icon: "🗑️",
          });
          if (!ok) return;
          const res = await deleteCustomRosterTopicAndSync(id);
          if (!res?.ok) {
            await showAppAlert(res?.error || "Impossible de supprimer le thème.", {
              title: "Suppression impossible",
              icon: "⚠️",
            });
          }
          render();
        });
      });
      return;
    }

    // step === "list" (Rank live uniquement)
    bindTierGrid(app, (id) => startGame(id, "live"));
  }

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "tiernight-select",
    getEntryScreen: () => getEffectiveSessionScreen(getCachedGameSession()),
  });

  const unsubSession = onGameSessionChange(() => {
    if (guestFollow()) return;
    // FEATURE-TIERNIGHT-02 : rafraîchir la liste quand un invité publie un thème.
    if (step === "topic") render();
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
