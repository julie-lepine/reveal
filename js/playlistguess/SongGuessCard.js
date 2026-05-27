import { escapeHtml } from "../core/ui.js";

export function songGuessCardHtml(round, { selectedPlayerId = null, readonly = false } = {}) {
  const { track, choices } = round;
  const art = track.albumImage
    ? `<img src="${escapeHtml(track.albumImage)}" alt="" class="vibecheck-album" width="280" height="280" loading="lazy" />`
    : `<div class="vibecheck-album vibecheck-album--placeholder" aria-hidden="true">🎵</div>`;

  const choiceButtons = choices
    .map((c, i) => {
      const letter = String.fromCharCode(65 + i);
      const active = selectedPlayerId === c.playerId;
      if (readonly) {
        const cls = active
          ? "statement statement--readonly statement--picked"
          : "statement statement--readonly";
        return `
          <div class="${cls}">
            <span class="statement__letter">${letter}</span>
            <span>${escapeHtml(c.label)}</span>
          </div>`;
      }
      return `
        <button type="button" class="statement ${active ? "statement--picked" : ""}" data-vote-id="${escapeHtml(c.playerId)}">
          <span class="statement__letter">${letter}</span>
          <span>${escapeHtml(c.label)}</span>
        </button>`;
    })
    .join("");

  return `
    <div class="card vibecheck-song-card">
      ${art}
      <p class="vibecheck-song-card__title">${escapeHtml(track.title)}</p>
      <p class="vibecheck-song-card__artist">${escapeHtml(track.artist)}</p>
      <h3 class="section-title">Qui a aimé ce titre ?</h3>
      <div class="statements">${choiceButtons}</div>
    </div>`;
}

export function ownerWaitingStageHtml(round, timer) {
  const { track } = round;
  const art = track.albumImage
    ? `<img src="${escapeHtml(track.albumImage)}" alt="" class="vibecheck-album" width="280" height="280" loading="lazy" />`
    : `<div class="vibecheck-album vibecheck-album--placeholder" aria-hidden="true">🎵</div>`;

  return `
    <div class="card vibecheck-song-card">
      ${art}
      <p class="vibecheck-song-card__title">${escapeHtml(track.title)}</p>
      <p class="vibecheck-song-card__artist">${escapeHtml(track.artist)}</p>
    </div>
    <div class="liar-stage" aria-live="polite">
      <div class="liar-stage__pulse"></div>
      <p class="liar-stage__badge">🎵 C'est ton like</p>
      <p class="liar-stage__title">Les autres devinent…</p>
      <div class="timer timer--liar" id="timer-el">${timer}</div>
      <div class="liar-stage__scan"></div>
    </div>`;
}
