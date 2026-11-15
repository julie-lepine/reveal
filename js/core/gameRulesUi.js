import { escapeHtml } from "./ui.js";
import { showAppRichDialog } from "./dialog.js";
import { GAMES } from "../../data/games.js";
import { getGameRules, RULES_KEY_BY_NAV } from "../../data/gameRules.js";

/** Bouton « Règles » à poser dans l'en-tête d'un écran de paramétrage. */
export function rulesButtonHtml(key, { label = "Règles" } = {}) {
  if (!getGameRules(key)) return "";
  return `<button type="button" class="rules-btn" data-rules="${escapeHtml(key)}" aria-label="Voir les règles">
    <span class="rules-btn__icon" aria-hidden="true">ⓘ</span>${escapeHtml(label)}
  </button>`;
}

/** Petite icône Règles (sans label) pour les cartes de l'écran de sélection. */
export function rulesIconButtonHtml(key) {
  if (!getGameRules(key)) return "";
  return `<button type="button" class="rules-icon-btn" data-rules="${escapeHtml(key)}" aria-label="Voir les règles">ⓘ</button>`;
}

function rulesBodyHtml(rules) {
  const etapes = (rules.etapes || []).map((e) => `<li>${escapeHtml(e)}</li>`).join("");
  const points = (rules.points || []).map((p) => `<li>${escapeHtml(p)}</li>`).join("");

  return `
    <p class="rules-modal__but">${escapeHtml(rules.but || "")}</p>
    ${
      etapes
        ? `<p class="rules-modal__section">Comment jouer</p><ol class="rules-modal__list">${etapes}</ol>`
        : ""
    }
    ${
      points
        ? `<p class="rules-modal__section">Points</p><ul class="rules-modal__list">${points}</ul>`
        : ""
    }
    ${
      rules.exemple
        ? `<p class="rules-modal__section">Exemple</p><p class="rules-modal__example">${escapeHtml(rules.exemple)}</p>`
        : ""
    }`;
}

function gameForRulesKey(key) {
  const rulesKey = getGameRules(key) ? key : RULES_KEY_BY_NAV[key];
  if (!rulesKey) return null;
  return GAMES.find((game) => RULES_KEY_BY_NAV[game.id] === rulesKey) || null;
}

function rulesDialogIcon(rules, game) {
  const emoji = escapeHtml(rules.emoji || "📜");
  const logo = game?.logo ? escapeHtml(game.logo) : "";
  if (!logo) return emoji;
  return `<img src="${logo}" alt="" class="app-dialog__game-logo" width="72" height="72" data-rules-logo><span class="app-dialog__game-logo-fallback" hidden>${emoji}</span>`;
}

function bindRulesLogoFallback() {
  const img = document.querySelector(".app-dialog__panel--rich [data-rules-logo]");
  if (!img) return;
  const fallback = img.parentElement?.querySelector(".app-dialog__game-logo-fallback");
  const showEmoji = () => {
    img.hidden = true;
    if (fallback) fallback.hidden = false;
  };
  img.addEventListener("error", showEmoji);
  if (img.complete && !img.naturalWidth) showEmoji();
}

/** Ouvre la modale de règles pour une clé de jeu (ex. "consensus" ou un id de nav). */
export function openGameRules(key) {
  const rules = getGameRules(key) || getGameRules(RULES_KEY_BY_NAV[key]);
  if (!rules) return;
  void showAppRichDialog({
    title: rules.title,
    icon: rulesDialogIcon(rules, gameForRulesKey(key)),
    bodyHtml: rulesBodyHtml(rules),
  });
  bindRulesLogoFallback();
}

// Délégation globale : un seul écouteur ouvre les règles au clic sur tout [data-rules].
let globalBound = false;
function handleGlobalRulesClick(e) {
  const btn = e.target.closest("[data-rules]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  openGameRules(btn.getAttribute("data-rules"));
}

export function ensureRulesDelegation() {
  if (globalBound || typeof document === "undefined") return;
  globalBound = true;
  document.addEventListener("click", handleGlobalRulesClick);
}

ensureRulesDelegation();
