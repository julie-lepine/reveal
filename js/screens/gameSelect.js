import { GAMES } from "../../data/games.js";
import { getEveningRecap } from "../core/eveningRecap.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { escapeHtml, pageShell, gameTileLogoHtml, bindGameTileLogos } from "../core/ui.js";
import { bindNav } from "./nav.js";

function eveningRecapHtml(recap) {
  if (!recap.hasActivity) {
    return `
      <div class="evening-recap evening-recap--empty card">
        <p class="evening-recap__title">📋 Récap de la soirée</p>
        <p class="evening-recap__empty">La soirée commence… lance un premier jeu !</p>
        <p class="evening-recap__meta">${recap.participantCount} joueur(s) dans le lobby</p>
      </div>`;
  }

  const chips = [
    recap.hotTakes > 0
      ? `<span class="evening-recap__chip">🔥 ${recap.hotTakes} hot take${recap.hotTakes > 1 ? "s" : ""}</span>`
      : "",
    recap.liesTotal > 0
      ? `<span class="evening-recap__chip">🕵️ ${recap.liesFound}/${recap.liesTotal} mensonges · ${recap.lieRate}</span>`
      : "",
    recap.tierNights > 0
      ? `<span class="evening-recap__chip">🏆 ${recap.tierNights} tier list${recap.tierNights > 1 ? "s" : ""}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const leader = recap.top[0]
    ? `<div class="evening-recap__leader">
        <span class="evening-recap__leader-avatar" style="background:${recap.top[0].color}">${recap.top[0].emoji}</span>
        <span>En tête : <strong>${escapeHtml(recap.top[0].name)}</strong> — ${recap.top[0].score} pts</span>
      </div>`
    : "";

  const lastTier = recap.lastTier
    ? `<p class="evening-recap__last">Dernière tier : « ${escapeHtml(recap.lastTier)} »</p>`
    : "";

  const moreLink = recap.top.length
    ? `<button type="button" class="evening-recap__link" data-nav="leaderboard">Voir le classement →</button>`
    : "";

  return `
    <div class="evening-recap card">
      <p class="evening-recap__title">📋 Récap de la soirée</p>
      <div class="evening-recap__chips">${chips}</div>
      ${leader}
      ${lastTier}
      ${moreLink}
    </div>`;
}

export function mountGameSelect(app) {
  if (!requireLobbyPlay()) return null;

  const recap = getEveningRecap();

  app.innerHTML = pageShell({
    backTarget: "lobby",
    content: `
      <p class="label-upper label-upper--gold">🎮 La soirée</p>
      <h2 class="screen-title">Choisir un jeu</h2>
      <p class="game-intro">Sélectionne une activité pour le lobby.</p>

      ${eveningRecapHtml(recap)}

      <div class="game-grid">
        ${GAMES.map((g) => {
          if (!g.enabled) {
            return `
              <div class="game-tile game-tile--disabled ${g.cssClass}">
                <span class="game-tile__emoji">${g.emoji}</span>
                <div class="game-tile__meta">
                  <span class="game-tile__title">${escapeHtml(g.title)}</span>
                  <span class="badge badge--soon">Soon</span>
                </div>
              </div>`;
          }
          return `
            <button type="button" class="game-tile ${g.cssClass}" data-nav="${g.id}">
              ${g.logo ? gameTileLogoHtml(g) : `<span class="game-tile__emoji">${g.emoji}</span>`}
              <div class="game-tile__text">
                <span class="game-tile__title">${escapeHtml(g.title)}</span>
                <span class="game-tile__desc">${escapeHtml(g.desc)}</span>
              </div>
            </button>`;
        }).join("")}
      </div>
    `,
  });

  bindNav(app);
  bindGameTileLogos(app);
  return null;
}
