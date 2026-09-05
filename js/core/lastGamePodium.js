import { escapeHtml } from "./ui.js";
import { playerAvatarHtml, playerNameHtml } from "./signatureUi.js";
import {
  formatNameList,
  medalForCompetitionRank,
  winnersAtRank,
} from "./competitionRank.js";

/** Snapshot sérialisable pour `lastGame.standings` (sync MP / localStorage). */
export function serializeLastGameStandings(standings = []) {
  return standings.map((player) => ({
    name: player.name,
    score: Number(player.score) || 0,
    rank: Number(player.rank) || 0,
    emoji: player.emoji || "🙂",
    color: player.color || "#888",
    nameColor: player.nameColor || null,
    signature: Boolean(player.signature),
    avatarPath: player.avatarPath || null,
    avatarRev: Number(player.avatarRev) || 0,
  }));
}

/**
 * Podium de la dernière partie (écran résultats).
 * Affiche le top 3 (rangs ≤ 3, ex æquo inclus).
 */
export function lastGamePodiumHtml(lastGame) {
  const standings = Array.isArray(lastGame?.standings) ? lastGame.standings : [];
  const podium = standings.filter((p) => Number(p.rank) > 0 && Number(p.rank) <= 3);
  if (!podium.length) return "";

  const winners = winnersAtRank(podium, 1);
  const winnerNames = formatNameList(winners.map((w) => w.name));
  const multi = winners.length > 1;
  const score = winners[0]?.score ?? 0;
  const summary = winnerNames
    ? multi
      ? `<p class="hint hottake-final__summary">👑 <strong>${escapeHtml(winnerNames)}</strong> remportent avec <strong>${score} pts</strong>.</p>`
      : `<p class="hint hottake-final__summary">👑 <strong>${escapeHtml(winnerNames)}</strong> remporte avec <strong>${score} pts</strong>.</p>`
    : "";

  return `
    <h3 class="section-title">Podium</h3>
    ${summary}
    <div class="trivia-results__podium">
      ${podium
        .map(
          (player) => `
        <div class="trivia-results__row ${player.rank <= 3 ? "trivia-results__row--winner" : ""} ${player.rank === 1 ? "trivia-results__row--champion" : ""}">
          <span class="trivia-results__medal">${medalForCompetitionRank(player.rank)}</span>
          ${playerAvatarHtml(player)}
          ${playerNameHtml(player, "player-name trivia-results__name")}
          <span class="trivia-results__score">${player.score} pts</span>
        </div>`
        )
        .join("")}
    </div>`;
}
