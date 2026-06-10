import { escapeHtml } from "../core/ui.js";

function medalForRank(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return "•";
}

export function renderTriviaResults({
  standings = [],
  themeLabel = "Trivia",
  showHostActions = true,
} = {}) {
  const winner = standings[0] || null;
  return `
    <div class="card card--highlight trivia-results">
      <p class="label-upper label-upper--gold">🧠 Trivia Quiz</p>
      <h3 class="section-title">Podium final</h3>
      <p class="hint">Theme joue : ${escapeHtml(themeLabel)}</p>
      ${
        winner
          ? `<p class="hint trivia-results__summary">👑 <strong>${escapeHtml(winner.name)}</strong> remporte la partie et gagne <strong>+${winner.lobbyBonus} pts lobby</strong>.</p>`
          : ""
      }
      <div class="trivia-results__podium">
        ${standings
          .map(
            (player) => `
          <div class="trivia-results__row ${player.rank <= 3 ? "trivia-results__row--winner" : ""} ${player.rank === 1 ? "trivia-results__row--champion" : ""}">
            ${
              player.rank === 1
                ? `<div class="trivia-results__confetti" aria-hidden="true">
                    <span></span><span></span><span></span><span></span><span></span><span></span>
                  </div>`
                : ""
            }
            <span class="trivia-results__medal">${medalForRank(player.rank)}</span>
            <div class="avatar avatar--sm" style="background:${player.color}">${player.emoji}</div>
            <span class="player-name trivia-results__name">${escapeHtml(player.name)}</span>
            <span class="trivia-results__score">${player.score} pts quiz</span>
            <span class="trivia-results__bonus">${
              player.rank === 1
                ? `👑 +${player.lobbyBonus} pts lobby`
                : player.lobbyBonus > 0
                  ? `+${player.lobbyBonus} pts lobby`
                  : "0 pt lobby"
            }</span>
          </div>`
          )
          .join("")}
      </div>
      ${
        showHostActions
          ? `<div class="btn-row trivia-results__actions">
        <button type="button" class="btn btn-primary" data-trivia-action="replay">Rejouer</button>
        <button type="button" class="btn btn-accent" data-trivia-action="change-theme">Changer theme</button>
      </div>`
          : `<p class="hint">En attente de l'hôte pour relancer…</p>`
      }
      <button type="button" class="btn btn-secondary btn--spaced" data-trivia-action="back-select">Retour au menu des jeux</button>
    </div>`;
}
