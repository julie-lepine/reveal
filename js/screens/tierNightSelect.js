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
import { getLobbyParticipants } from "../core/lobby.js";
import {
  markTierNightLiveLobbyStarted,
  markTierNightClassicStarted,
  prepareTierNightSeriesLaunchAttempt,
  markTierNightSeriesStarted,
} from "../core/tierNightLiveSession.js";
import { navigateAfterGameLaunch, prepGuestFollowOnSession, runLaunchButton } from "../core/mpLaunch.js";
import { escapeHtml, pageShell, tierLogoHtml, bindTierLogos } from "../core/ui.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { bindNav } from "./nav.js";
import { showAppAlert, showAppConfirm } from "../core/dialog.js";
import { isTierNightSeriesUiEnabled } from "../core/tierNightSeriesGate.js";
import { TIER_NIGHT_SERIES_ALL_CATEGORIES } from "../core/tierNightSeries.js";
import {
  createEmptyTierNightSeriesSetup,
  listTierNightSeriesCategoryOptions,
  getTierNightSeriesRoundCountAvailability,
  getTierNightSeriesPoolSize,
  validateTierNightSeriesSetupForLaunch,
  reconcileTierNightSeriesSetupAfterCategoryChange,
  formatTierNightSeriesCategorySummary,
  resolveTierNightSeriesSetupCategoryIds,
} from "../core/tierNightSeriesSetup.js";

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

const SERIES_STEPS = new Set([
  "roster-path",
  "series-category",
  "series-count",
  "series-review",
]);

export function mountTierNightSelect(app) {
  const params = getScreenParams() || {};
  const seriesUi = isTierNightSeriesUiEnabled();
  let selectedMode = normalizeTierNightMode(params.mode || DEFAULT_TIER_NIGHT_MODE);
  let step =
    params.step === "topic" ||
    params.step === "list" ||
    params.step === "mode" ||
    (seriesUi && SERIES_STEPS.has(params.step))
      ? params.step
      : "mode";
  if (step === "topic") selectedMode = "roster";
  if (step === "list") selectedMode = "live";
  if (!seriesUi && SERIES_STEPS.has(step)) step = "mode";

  /** Setup temporaire — jamais sérialisé. */
  let seriesSetup = createEmptyTierNightSeriesSetup();
  /** Tentative de launch (runId+queue) réutilisée après échec ambigu. */
  let seriesLaunchAttempt = null;
  let seriesLaunching = false;

  function resetSeriesSetup() {
    seriesSetup = createEmptyTierNightSeriesSetup();
    seriesLaunchAttempt = null;
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

    // roster → plateau partagé (state.tierNight / écran tiernight) — mono-thème, sans series
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

  async function launchSeriesFromReview(btn) {
    if (seriesLaunching) return;
    if (!(await ensureHost())) return;

    const check = validateTierNightSeriesSetupForLaunch(seriesSetup);
    if (!check.ok) {
      await showAppAlert(check.message, { title: "Setup incomplet", icon: "⚠️" });
      return;
    }

    const run = async () => {
      seriesLaunching = true;
      try {
        if (!seriesLaunchAttempt?.ok) {
          seriesLaunchAttempt = prepareTierNightSeriesLaunchAttempt({
            categoryIds: resolveTierNightSeriesSetupCategoryIds(seriesSetup.categoryIds),
            roundCount: seriesSetup.roundCount,
            modifier: "normal",
            participants: getLobbyParticipants(),
          });
        }
        if (!seriesLaunchAttempt?.ok) {
          await showAppAlert(seriesLaunchAttempt?.error || "Impossible de préparer la série.", {
            title: "Lancement impossible",
            icon: "⚠️",
          });
          seriesLaunchAttempt = null;
          return;
        }

        const result = await markTierNightSeriesStarted({
          attempt: seriesLaunchAttempt.attempt,
        });

        if (result?.ok === false) {
          // Échec clair + rollback : autoriser une nouvelle queue au prochain essai.
          // Incertitude (timeout) : conserver attempt pour retry sans nouveau RNG.
          if (!result.uncertain) {
            seriesLaunchAttempt = null;
          }
          await showAppAlert(result.error || "Impossible de lancer la série.", {
            title: "Lancement impossible",
            icon: "⚠️",
          });
          return;
        }

        seriesLaunchAttempt = null;
        resetSeriesSetup();
        if (isGameSyncActive()) {
          navigateAfterGameLaunch({ gameScreen: "tiernight", result });
        } else {
          navigate("tiernight");
        }
      } finally {
        seriesLaunching = false;
      }
    };

    if (btn) {
      await runLaunchButton(btn, run, { loadingLabel: "Lancement…" });
    } else {
      await run();
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

  function rosterPathStepHtml() {
    return `
      <p class="label-upper label-upper--gold">Classe le groupe</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Comment voulez-vous jouer ?</h2>
        ${rulesButtonHtml("tiernight")}
      </div>
      <p class="game-intro">Un thème unique, ou une série de classements enchaînés.</p>
      <div class="tier-mode-list">
        <button type="button" class="tier-mode-card" data-roster-path="single">
          <span class="tier-mode-card__emoji">1️⃣</span>
          <span class="tier-mode-card__body">
            <span class="tier-mode-card__name">Un seul classement</span>
            <span class="tier-mode-card__tagline">Parcours classique</span>
            <span class="tier-mode-card__desc">Choisis un thème et classe le groupe une fois.</span>
          </span>
          <span class="card-row__chevron">›</span>
        </button>
        <button type="button" class="tier-mode-card" data-roster-path="series">
          <span class="tier-mode-card__emoji">📚</span>
          <span class="tier-mode-card__body">
            <span class="tier-mode-card__name">Une série</span>
            <span class="tier-mode-card__tagline">3, 5 ou 7 manches</span>
            <span class="tier-mode-card__desc">Enchaîne plusieurs thèmes tirés dans une catégorie.</span>
          </span>
          <span class="card-row__chevron">›</span>
        </button>
      </div>`;
  }

  function seriesCategoryStepHtml() {
    const options = listTierNightSeriesCategoryOptions();
    const allCount = getTierNightSeriesPoolSize([TIER_NIGHT_SERIES_ALL_CATEGORIES]);
    const selected = seriesSetup.categoryIds;
    const isAll =
      Array.isArray(selected) && selected.includes(TIER_NIGHT_SERIES_ALL_CATEGORIES);
    const selectedId =
      !isAll && Array.isArray(selected) && selected.length === 1 ? selected[0] : null;

    const catCards = options
      .map((c) => {
        const active = selectedId === c.id;
        const disabled = c.eligibleCount < 3;
        return `
        <button type="button" class="tier-mode-card${active ? " tier-mode-card--active" : ""}"
          data-series-cat="${escapeHtml(c.id)}" ${disabled ? "disabled" : ""}>
          <span class="tier-mode-card__emoji">🏷️</span>
          <span class="tier-mode-card__body">
            <span class="tier-mode-card__name">${escapeHtml(c.label)}</span>
            <span class="tier-mode-card__tagline">${c.eligibleCount} thème${c.eligibleCount > 1 ? "s" : ""} éligible${c.eligibleCount > 1 ? "s" : ""}</span>
            <span class="tier-mode-card__desc">${
              disabled ? "Moins de 3 thèmes - indisponible pour une série." : "Sélectionner cette catégorie."
            }</span>
          </span>
        </button>`;
      })
      .join("");

    return `
      <p class="label-upper label-upper--gold">Série · catégories</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Choisis une catégorie</h2>
        ${rulesButtonHtml("tiernight")}
      </div>
      <p class="game-intro">Les thèmes personnalisés ne sont pas inclus dans les packs.</p>
      <div class="tier-mode-list">
        <button type="button" class="tier-mode-card${isAll ? " tier-mode-card--active" : ""}"
          data-series-cat="*">
          <span class="tier-mode-card__emoji">✨</span>
          <span class="tier-mode-card__body">
            <span class="tier-mode-card__name">Toutes les catégories</span>
            <span class="tier-mode-card__tagline">${allCount} thèmes éligibles</span>
            <span class="tier-mode-card__desc">Tirage dans tout le catalogue activé.</span>
          </span>
        </button>
        ${catCards}
      </div>
      ${
        selected
          ? `<button type="button" class="btn btn-primary btn--spaced" data-series-next="count">Continuer</button>`
          : ""
      }`;
  }

  function seriesCountStepHtml() {
    const avail = getTierNightSeriesRoundCountAvailability(seriesSetup.categoryIds);
    const pool = avail[0]?.poolSize ?? 0;
    const catLabel = formatTierNightSeriesCategorySummary(seriesSetup.categoryIds);
    const cards = avail
      .map((r) => {
        const active = Number(seriesSetup.roundCount) === r.roundCount;
        return `
        <button type="button" class="tier-mode-card${active ? " tier-mode-card--active" : ""}"
          data-series-count="${r.roundCount}" ${r.available ? "" : "disabled"}>
          <span class="tier-mode-card__emoji">${r.roundCount}</span>
          <span class="tier-mode-card__body">
            <span class="tier-mode-card__name">${r.roundCount} manches</span>
            <span class="tier-mode-card__tagline">${
              r.available ? "Disponible" : "Indisponible"
            }</span>
            <span class="tier-mode-card__desc">${
              r.available
                ? `Pool : ${r.poolSize} thèmes.`
                : `Il faut au moins ${r.roundCount} thèmes (pool : ${r.poolSize}).`
            }</span>
          </span>
        </button>`;
      })
      .join("");

    return `
      <p class="label-upper label-upper--gold">Série · manches</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Combien de manches ?</h2>
        ${rulesButtonHtml("tiernight")}
      </div>
      <p class="game-intro">${escapeHtml(catLabel)} - ${pool} thème${pool > 1 ? "s" : ""} disponible${pool > 1 ? "s" : ""}.</p>
      <div class="tier-mode-list">${cards}</div>
      ${
        seriesSetup.roundCount
          ? `<button type="button" class="btn btn-primary btn--spaced" data-series-next="review">Continuer</button>`
          : ""
      }`;
  }

  function seriesReviewStepHtml() {
    const catLabel = formatTierNightSeriesCategorySummary(seriesSetup.categoryIds);
    const pool = getTierNightSeriesPoolSize(seriesSetup.categoryIds);
    const host = !isGameSyncActive() || isLobbyHost();
    return `
      <p class="label-upper label-upper--gold">Série · récap</p>
      <div class="screen-title-row">
        <h2 class="screen-title">Prêt à lancer</h2>
        ${rulesButtonHtml("tiernight")}
      </div>
      <p class="game-intro">La queue sera tirée une seule fois au lancement.</p>
      <div class="card card--static">
        <p><strong>Catégorie</strong> — ${escapeHtml(catLabel)}</p>
        <p><strong>Manches</strong> — ${escapeHtml(String(seriesSetup.roundCount))}</p>
        <p><strong>Thèmes éligibles</strong> — ${pool}</p>
        <p><strong>Modificateur</strong> — normal</p>
      </div>
      ${
        host
          ? `<button type="button" class="btn btn-primary btn--spaced" data-series-launch>Lancer la série</button>`
          : `<p class="hint">En attente de l'hôte…</p>`
      }`;
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

  function backTargetForStep() {
    if (step === "mode") return "back";
    if (!seriesUi) return "tiernight-modes";
    if (step === "roster-path") return "tiernight-modes";
    if (step === "topic") return "tiernight-roster-path";
    if (step === "list") return "tiernight-modes";
    if (step === "series-category") return "tiernight-roster-path";
    if (step === "series-count") return "tiernight-series-category";
    if (step === "series-review") return "tiernight-series-count";
    return "tiernight-modes";
  }

  function render() {
    let content = "";
    if (step === "mode") content = modeStepHtml();
    else if (step === "roster-path") content = rosterPathStepHtml();
    else if (step === "series-category") content = seriesCategoryStepHtml();
    else if (step === "series-count") content = seriesCountStepHtml();
    else if (step === "series-review") content = seriesReviewStepHtml();
    else if (step === "topic") content = topicStepHtml();
    else content = listStepHtml();

    // UX-TIERNIGHT-NAV-01 : un seul chevron classique.
    const onModeLevel = step === "mode";
    app.innerHTML = pageShell({
      back: true,
      backTarget: onModeLevel ? "back" : backTargetForStep(),
      content,
    });

    bindNav(app, {
      "tiernight-modes": () => {
        step = "mode";
        resetSeriesSetup();
        render();
      },
      "tiernight-roster-path": () => {
        step = "roster-path";
        seriesSetup = { ...seriesSetup, path: null, categoryIds: null, roundCount: null };
        seriesLaunchAttempt = null;
        render();
      },
      "tiernight-series-category": () => {
        step = "series-category";
        seriesSetup = { ...seriesSetup, roundCount: null };
        seriesLaunchAttempt = null;
        render();
      },
      "tiernight-series-count": () => {
        step = "series-count";
        seriesLaunchAttempt = null;
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
          resetSeriesSetup();
          if (id === "roster") {
            step = seriesUi ? "roster-path" : "topic";
          } else {
            step = "list";
          }
          render();
        });
      });
      return;
    }

    if (step === "roster-path") {
      app.querySelectorAll("[data-roster-path]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const path = btn.getAttribute("data-roster-path");
          seriesLaunchAttempt = null;
          if (path === "series") {
            seriesSetup = {
              path: "series",
              categoryIds: null,
              roundCount: null,
            };
            step = "series-category";
          } else {
            seriesSetup = { path: "single", categoryIds: null, roundCount: null };
            step = "topic";
          }
          render();
        });
      });
      return;
    }

    if (step === "series-category") {
      app.querySelectorAll("[data-series-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-series-cat");
          seriesLaunchAttempt = null;
          const categoryIds =
            id === "*" ? [TIER_NIGHT_SERIES_ALL_CATEGORIES] : [id];
          seriesSetup = reconcileTierNightSeriesSetupAfterCategoryChange({
            ...seriesSetup,
            path: "series",
            categoryIds,
          });
          render();
        });
      });
      app.querySelector("[data-series-next='count']")?.addEventListener("click", () => {
        if (!seriesSetup.categoryIds) return;
        step = "series-count";
        render();
      });
      return;
    }

    if (step === "series-count") {
      app.querySelectorAll("[data-series-count]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          const n = Number(btn.getAttribute("data-series-count"));
          seriesLaunchAttempt = null;
          seriesSetup = { ...seriesSetup, path: "series", roundCount: n };
          render();
        });
      });
      app.querySelector("[data-series-next='review']")?.addEventListener("click", () => {
        const check = validateTierNightSeriesSetupForLaunch(seriesSetup);
        if (!check.ok) {
          void showAppAlert(check.message, { title: "Choix invalide", icon: "⚠️" });
          return;
        }
        step = "series-review";
        render();
      });
      return;
    }

    if (step === "series-review") {
      const launchBtn = app.querySelector("[data-series-launch]");
      launchBtn?.addEventListener("click", () => {
        void launchSeriesFromReview(launchBtn);
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
