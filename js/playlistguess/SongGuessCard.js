import { escapeHtml } from "../core/ui.js";

function albumHtml(song) {
  return song.albumImage
    ? `<img src="${escapeHtml(song.albumImage)}" alt="" class="vibecheck-album" width="280" height="280" loading="lazy" />`
    : `<div class="vibecheck-album vibecheck-album--placeholder" aria-hidden="true">🎵</div>`;
}

/**
 * Carte chanson + grille de vote (un bouton par joueur du lobby).
 * @param {{ song: object }} round
 * @param {{ players: Array<{userId,name,emoji,color}>, selectedPlayerId?: string|null, readonly?: boolean, heading?: string }} opts
 */
export function songGuessCardHtml(round, {
  players = [],
  selectedPlayerId = null,
  readonly = false,
  heading = "À qui correspond le mieux ce titre ?",
} = {}) {
  const song = round.song || round.track || {};

  const choiceButtons = players
    .map((p) => {
      const active = selectedPlayerId === p.userId;
      const avatar = p.emoji
        ? `<span class="vibecheck-vote__emoji" aria-hidden="true">${escapeHtml(p.emoji)}</span>`
        : "";
      const inner = `${avatar}<span>${escapeHtml(p.name)}</span>`;
      if (readonly) {
        return `
          <div class="statement statement--readonly ${active ? "statement--picked" : ""}">
            ${inner}
          </div>`;
      }
      return `
        <button type="button" class="statement ${active ? "statement--picked" : ""}" data-vote-id="${escapeHtml(p.userId)}">
          ${inner}
        </button>`;
    })
    .join("");

  return `
    <div class="card vibecheck-song-card">
      ${albumHtml(song)}
      <p class="vibecheck-song-card__title">${escapeHtml(song.title || "")}</p>
      <p class="vibecheck-song-card__artist">${escapeHtml(song.artist || "")}</p>
      <h3 class="section-title">${escapeHtml(heading)}</h3>
      <div class="statements">${choiceButtons}</div>
    </div>`;
}
