import { GAMES } from "../../data/games.js";
import { escapeHtml } from "./ui.js";
import { rulesButtonHtml } from "./gameRulesUi.js";

/**
 * En-tête d'écran de jeu (nouvelle DA) : ligne Règles à côté du bouton retour,
 * puis titre d'affichage (nom du jeu) avec son logo.
 * @param {string} gameNavId id du catalogue data/games.js (ex. "dilemma-prep")
 * @param {{ kicker?: string, rulesKey?: string, title?: string }} [opts]
 */
export function gameTitleHtml(gameNavId, { kicker = "", rulesKey = "", title = "" } = {}) {
  const game = GAMES.find((g) => g.id === gameNavId) || {};
  const name = title || game.title || "";
  const logo = game.logo
    ? `<img src="${escapeHtml(game.logo)}" alt="" class="game-title__logo" />`
    : "";
  return `
    <div class="game-head">${rulesKey ? rulesButtonHtml(rulesKey) : ""}</div>
    <div class="game-title">
      <div class="game-title__text">
        ${kicker ? `<p class="kicker">${escapeHtml(kicker)}</p>` : ""}
        <h2 class="title-display">${escapeHtml(name)}</h2>
      </div>
      ${logo}
    </div>`;
}
