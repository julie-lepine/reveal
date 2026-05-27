import { escapeHtml } from "../core/ui.js";
import { PLAYLIST_GUESS_POINTS } from "../../data/playlistGuess.js";
import { songGuessCardHtml } from "./SongGuessCard.js";

export function revealOwnerCardHtml({
  round,
  correctVoters,
  ownerStealth,
  myCorrect,
  isOwner,
  votesByUid,
  nameForPlayerId,
}) {
  const ownerLabel = round.ownerName;
  const feedbackTitle = isOwner
    ? ownerStealth
      ? "Like discret 🥳"
      : "Tout le monde t'a trouvé 😭"
    : myCorrect
      ? "Bien joué ! 🥳"
      : "Raté cette fois 😅";

  const feedbackSub = isOwner
    ? ownerStealth
      ? `+${PLAYLIST_GUESS_POINTS.OWNER_STEALTH} pts — pas tout le monde t'a identifié`
      : "0 pt — tout le monde a deviné"
    : myCorrect
      ? `+${PLAYLIST_GUESS_POINTS.CORRECT_GUESS} pts`
      : `${correctVoters.length} bonne(s) réponse(s) sur cette manche`;

  const voteRows = Object.entries(votesByUid || {})
    .map(([voterUid, pickId]) => {
      const voterName = nameForPlayerId(voterUid) || voterUid;
      const pickName = nameForPlayerId(pickId) || pickId;
      const ok = pickId === round.ownerPlayerId;
      return `
        <div class="player-row player-row--compact">
          <span>${escapeHtml(voterName)}</span>
          <span>${escapeHtml(pickName)}${ok ? " ✓" : ""}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="liar-stage vibecheck-reveal-stage" aria-live="polite">
      <div class="liar-stage__pulse"></div>
      <p class="liar-stage__badge">Révélation</p>
      <p class="liar-stage__title"><strong>${escapeHtml(ownerLabel)}</strong> a aimé ce titre</p>
    </div>
    ${songGuessCardHtml(round, {
      selectedPlayerId: round.ownerPlayerId,
      readonly: true,
    })}
    <div class="card card--feedback ${myCorrect || (isOwner && ownerStealth) ? "card--ok" : isOwner ? "card--fail" : myCorrect ? "card--ok" : "card--fail"}">
      <p class="feedback-title">${escapeHtml(feedbackTitle)}</p>
      <p class="feedback-sub">${escapeHtml(feedbackSub)}</p>
    </div>
    <div class="card card--votes">${voteRows}</div>`;
}
