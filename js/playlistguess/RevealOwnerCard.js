import { escapeHtml } from "../core/ui.js";
import { PLAYLIST_GUESS_POINTS } from "../../data/playlistGuess.js";

/**
 * Résultats d'une manche VibeCheck.
 * @param {{
 *   song: object,
 *   players: Array<{userId,name,emoji}>,
 *   counts: Record<string, number>,
 *   leaders: string[],
 *   votesByUid: Record<string, string>,
 *   localUid: string,
 *   nameForPlayerId: (uid:string)=>string,
 * }} props
 */
export function revealResultCardHtml({
  song = {},
  players = [],
  counts = {},
  leaders = [],
  votesByUid = {},
  localUid,
  nameForPlayerId,
}) {
  const nameFor = (uid) => (nameForPlayerId ? nameForPlayerId(uid) : uid);
  const leaderSet = new Set(leaders);
  const maxVotes = Math.max(1, ...players.map((p) => counts[p.userId] || 0));

  const myVote = votesByUid[localUid];
  const iAmLeader = leaderSet.has(localUid);
  const iVotedLeader = leaderSet.has(myVote);
  const myPoints =
    (iAmLeader ? PLAYLIST_GUESS_POINTS.MOST_VOTED : 0) +
    (iVotedLeader ? PLAYLIST_GUESS_POINTS.MAJORITY : 0);

  const ranked = [...players].sort(
    (a, b) => (counts[b.userId] || 0) - (counts[a.userId] || 0)
  );

  const bars = ranked
    .map((p) => {
      const n = counts[p.userId] || 0;
      const pct = Math.round((n / maxVotes) * 100);
      const isLeader = leaderSet.has(p.userId);
      const emoji = p.emoji ? `${escapeHtml(p.emoji)} ` : "";
      return `
        <div class="vibecheck-result-row ${isLeader ? "vibecheck-result-row--winner" : ""}">
          <div class="vibecheck-result-row__head">
            <span class="vibecheck-result-row__name">${isLeader ? "👑 " : ""}${emoji}${escapeHtml(p.name)}</span>
            <span class="vibecheck-result-row__votes">${n} vote${n > 1 ? "s" : ""}${isLeader && n > 0 ? ` · +${PLAYLIST_GUESS_POINTS.MOST_VOTED}` : ""}</span>
          </div>
          <div class="vibecheck-result-bar"><span style="width:${pct}%"></span></div>
        </div>`;
    })
    .join("");

  const winnerNames = leaders.map((uid) => nameFor(uid));
  const title =
    winnerNames.length === 0
      ? "Aucun vote"
      : winnerNames.length === 1
        ? `${winnerNames[0]} rafle la mise`
        : `Égalité : ${winnerNames.join(" & ")}`;

  const feedback =
    myPoints > 0
      ? `Tu gagnes <strong>+${myPoints} pts</strong>${
          iAmLeader && iVotedLeader
            ? " (le plus voté + dans la majorité)"
            : iAmLeader
              ? " (le plus voté)"
              : " (dans la majorité)"
        }`
      : "0 pt cette manche";

  const voteRows = Object.entries(votesByUid)
    .map(([voterUid, pickId]) => {
      const ok = leaderSet.has(pickId);
      return `
        <div class="player-row player-row--compact">
          <span>${escapeHtml(nameFor(voterUid))}</span>
          <span>${escapeHtml(nameFor(pickId))}${ok ? " ✓" : ""}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="liar-stage vibecheck-reveal-stage" aria-live="polite">
      <div class="liar-stage__pulse"></div>
      <p class="liar-stage__badge">Résultats</p>
      <p class="liar-stage__title">${escapeHtml(title)}</p>
    </div>
    <div class="card vibecheck-song-card vibecheck-song-card--mini">
      ${
        song.albumImage
          ? `<img src="${escapeHtml(song.albumImage)}" alt="" class="vibecheck-album vibecheck-album--mini" width="120" height="120" loading="lazy" />`
          : `<div class="vibecheck-album vibecheck-album--mini vibecheck-album--placeholder" aria-hidden="true">🎵</div>`
      }
      <p class="vibecheck-song-card__title">${escapeHtml(song.title || "")}</p>
      <p class="vibecheck-song-card__artist">${escapeHtml(song.artist || "")}</p>
    </div>
    <div class="card vibecheck-results">${bars}</div>
    <div class="card card--feedback ${myPoints > 0 ? "card--ok" : "card--fail"}">
      <p class="feedback-sub">${feedback}</p>
    </div>
    <div class="card card--votes">${voteRows}</div>`;
}
