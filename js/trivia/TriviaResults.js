import { escapeHtml } from "../core/ui.js";
import {
  formatNameList,
  medalForCompetitionRank,
  winnersAtRank,
} from "../core/competitionRank.js";
import { triviaEveningPoints } from "../core/triviaScoring.js";

export function renderTriviaResults({
  standings = [],
  themeLabel = "Trivia",
  showHostActions = true,
  showContinueAction = true,
  continueAction = "back-select",
  continueLabel = "Retour au menu des jeux",
  waitingText = "En attente de l'hote pour relancer...",
} = {}) {
  const winners = winnersAtRank(standings, 1);
  const winnerNames = formatNameList(winners.map((w) => w.name));
  const multi = winners.length > 1;
  const eveningTotal = winners[0] ? triviaEveningPoints(winners[0]) : 0;
  const summary = winnerNames
    ? multi
      ? `<p class="hint trivia-results__summary">👑 <strong>${escapeHtml(winnerNames)}</strong> remportent la partie - <strong>+${eveningTotal} pts</strong> soirée chacun (quiz + bonus podium).</p>`
      : `<p class="hint trivia-results__summary">👑 <strong>${escapeHtml(winnerNames)}</strong> remporte la partie - <strong>+${eveningTotal} pts</strong> soirée (quiz + bonus podium).</p>`
    : "";

  return `
    <div class="card card--highlight trivia-results">
      <p class="label-upper label-upper--gold">🧠 Trivia Quiz</p>
      <h3 class="section-title">Podium final</h3>
      <p class="hint">Theme joue : ${escapeHtml(themeLabel)}</p>
      ${summary}
      <div class="trivia-results__podium">
        ${standings
          .map((player) => {
            const eveningPts = triviaEveningPoints(player);
            return `
          <div class="trivia-results__row ${player.rank <= 3 ? "trivia-results__row--winner" : ""} ${player.rank === 1 ? "trivia-results__row--champion" : ""}">
            ${
              player.rank === 1
                ? `<div class="trivia-results__confetti" aria-hidden="true">
                    <span></span><span></span><span></span><span></span><span></span><span></span>
                  </div>`
                : ""
            }
            <span class="trivia-results__medal">${medalForCompetitionRank(player.rank)}</span>
            <div class="avatar avatar--sm" style="background:${player.color}">${player.emoji}</div>
            <span class="player-name trivia-results__name">${escapeHtml(player.name)}</span>
            <span class="trivia-results__score">${player.score} pts quiz</span>
            <span class="trivia-results__bonus">${
              player.lobbyBonus > 0
                ? `${player.rank === 1 ? "👑 " : ""}+${player.lobbyBonus} bonus → +${eveningPts} soirée`
                : `→ +${eveningPts} soirée`
            }</span>
          </div>`;
          })
          .join("")}
      </div>
      ${
        showHostActions
          ? `<div class="btn-row trivia-results__actions">
        <button type="button" class="btn btn-primary" data-trivia-action="replay">Rejouer</button>
        <button type="button" class="btn btn-accent" data-trivia-action="change-theme">Changer theme</button>
      </div>`
          : `<p class="hint">${escapeHtml(waitingText)}</p>`
      }
      ${
        showContinueAction
          ? `<button type="button" class="btn btn-secondary btn--spaced" data-trivia-action="${escapeHtml(continueAction)}">${escapeHtml(continueLabel)}</button>`
          : ""
      }
    </div>`;
}
