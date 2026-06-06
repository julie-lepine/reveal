import { getSortedActivePlayers } from "./players.js";
import { getCurrentSessionScoreMap, getState } from "./state.js";
import { escapeHtml } from "./ui.js";

/** Scores cumulés d'une manche → map joueur (partie en cours). */
export function applyMatchScoreDeltas(scores = {}, deltas = {}) {
  const next = { ...scores };
  Object.entries(deltas).forEach(([name, pts]) => {
    if (typeof pts === "number" && Number.isFinite(pts) && pts > 0) {
      next[name] = (next[name] || 0) + pts;
    }
  });
  return next;
}

/** Fusion locale des matchScores (sync multijoueur, max par joueur). */
export function mergeMatchScoresLocal(local = {}, remote = {}) {
  const merged = { ...local };
  Object.entries(remote).forEach(([name, pts]) => {
    if (typeof pts === "number" && Number.isFinite(pts)) {
      merged[name] = Math.max(merged[name] || 0, pts);
    }
  });
  return merged;
}

function gameScoresBoxRowsHtml(players, scores) {
  return players
    .map((p, i) => {
      const pts = scores[p.name] || 0;
      return `
        <div class="game-scores-box__row">
          <span class="game-scores-box__rank">${i + 1}</span>
          <div class="avatar avatar--sm" style="background:${p.color}">${p.emoji}</div>
          <span class="player-name game-scores-box__name">${escapeHtml(p.name)}</span>
          <span class="player-score ${i === 0 ? "player-score--gold" : ""}">${pts}</span>
        </div>`;
    })
    .join("");
}

/** Points consensus de la manche Tier Night (tous les joueurs). */
export function tierNightRoundScoresHtml(recaps, { title = "Points de la manche" } = {}) {
  if (!recaps?.length) return "";
  const sorted = [...recaps].sort((a, b) => (b.consensusPoints ?? 0) - (a.consensusPoints ?? 0));
  const rows = sorted
    .map((r, i) => {
      const pts = r.consensusPoints ?? 0;
      return `
        <div class="game-scores-box__row">
          <span class="game-scores-box__rank">${i + 1}</span>
          <div class="avatar avatar--sm" style="background:${r.color}">${r.emoji}</div>
          <span class="player-name game-scores-box__name">${escapeHtml(r.player)}</span>
          <span class="player-score ${i === 0 ? "player-score--gold" : ""}">+${pts}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="card game-scores-box game-scores-box--round" data-scores="round">
      <p class="card-heading game-scores-box__title">${escapeHtml(title)}</p>
      <p class="game-scores-box__game">Proximité au consensus du groupe</p>
      ${rows}
    </div>`;
}

const GAME_LABELS = {
  playlistguess: { title: "VibeCheck", emoji: "🎵", statKey: "playlistGuessesPlayed" },
  consensus: { title: "Consensus", emoji: "🤝", statKey: "consensusGamesPlayed" },
  hottake: { title: "HotTake", emoji: "🔥", statKey: "hotTakesPlayed" },
  guesslie: { title: "Guess The Lie", emoji: "🕵️", statKey: null },
  speedvote: { title: "SpeedVote", emoji: "⚡", statKey: "speedVotesPlayed" },
  dilemma: { title: "Dilemma", emoji: "⚖️", statKey: "dilemmasPlayed" },
  truthmeter: { title: "TruthMeter", emoji: "📏", statKey: "truthMetersPlayed" },
  tiernight: { title: "TierNight", emoji: "🏆", statKey: "tierNightsPlayed" },
  trivia: { title: "Trivia Quiz", emoji: "🧠", statKey: "triviaGamesPlayed" },
};

function gameLeaderboardRowsHtml(players, scoreMap) {
  const sorted = [...players].sort(
    (a, b) => (scoreMap[b.name] || 0) - (scoreMap[a.name] || 0)
  );
  return sorted
    .map((p, i) => {
      const pts = scoreMap[p.name] || 0;
      const gold = i === 0 && pts > 0 ? "player-score--gold" : "";
      return `
        <div class="game-scores-box__row">
          <span class="game-scores-box__rank">${i + 1}</span>
          <div class="avatar avatar--sm" style="background:${p.color}">${p.emoji}</div>
          <span class="player-name game-scores-box__name">${escapeHtml(p.name)}</span>
          <span class="player-score ${gold}">${pts}</span>
        </div>`;
    })
    .join("");
}

function gameLeaderboardCardHtml(titleHtml, players, scoreMap) {
  return `
    <div class="card game-scores-box">
      <p class="card-heading game-scores-box__title">${titleHtml}</p>
      ${gameLeaderboardRowsHtml(players, scoreMap)}
    </div>`;
}

/** Classement de chaque jeu joué dans la soirée (+ bloc Fil Rouge). */
export function eveningGameLeaderboardsHtml() {
  const { gameScores = {}, gameScoreOrder = [], stats = {}, filRougeScores = {} } = getState();
  const players = getSortedActivePlayers();
  if (!players.length) return "";

  const blocks = [];
  gameScoreOrder.forEach((gid) => {
    const meta = GAME_LABELS[gid];
    if (!meta) return;
    const count = meta.statKey ? stats[meta.statKey] || 0 : 0;
    const countLabel = count > 1 ? ` · ${count} parties` : "";
    const titleHtml = `${meta.emoji} ${escapeHtml(meta.title)}${countLabel}`;
    blocks.push(gameLeaderboardCardHtml(titleHtml, players, gameScores[gid] || {}));
  });

  // FIL_ROUGE (Mot interdit) — bloc classement désactivé
  // const hasFilRouge = Object.values(filRougeScores).some((v) => Number(v) !== 0);
  // if (hasFilRouge) {
  //   blocks.push(gameLeaderboardCardHtml("🧵 Fil Rouge", players, filRougeScores));
  // }
  void filRougeScores;

  if (!blocks.length) return "";
  return `
    <p class="card-heading game-leaderboards__heading">Classement par jeu</p>
    ${blocks.join("")}`;
}

/** Boîte de cumul des scores de la partie en cours (pas la soirée). */
export function gameCumulativeScoresHtml({
  gameId = null,
  gameLabel = null,
  title = "Cumul des scores",
  scores: scoresOverride = null,
} = {}) {
  const scores =
    scoresOverride && typeof scoresOverride === "object"
      ? scoresOverride
      : getCurrentSessionScoreMap(gameId);
  const players = getSortedActivePlayers();
  if (!players.length) return "";

  return `
    <div class="card game-scores-box" data-scores="session">
      <p class="card-heading game-scores-box__title">${escapeHtml(title)}</p>
      ${gameLabel ? `<p class="game-scores-box__game">${escapeHtml(gameLabel)}</p>` : ""}
      ${gameScoresBoxRowsHtml(players, scores)}
    </div>`;
}

/** Met à jour le cumul des scores sans re-render tout l’écran (sync multijoueur). */
export function refreshGameScoresBox(app, {
  gameId = null,
  gameLabel = null,
  title = "Cumul des scores",
  scores: scoresOverride = null,
} = {}) {
  if (!app) return;
  const scores =
    scoresOverride && typeof scoresOverride === "object"
      ? scoresOverride
      : getCurrentSessionScoreMap(gameId);
  const players = getSortedActivePlayers();
  if (!players.length) return;

  const box = app.querySelector('[data-scores="session"]');
  if (!box) return;

  const titleEl = box.querySelector(".game-scores-box__title");
  const gameEl = box.querySelector(".game-scores-box__game");
  if (titleEl) titleEl.textContent = title;
  if (gameEl) gameEl.textContent = gameLabel || "";
  else if (gameLabel) {
    box.insertAdjacentHTML(
      "afterbegin",
      `<p class="game-scores-box__game">${escapeHtml(gameLabel)}</p>`
    );
  }

  const oldRows = box.querySelectorAll(".game-scores-box__row");
  oldRows.forEach((el) => el.remove());
  const anchor = box.querySelector(".game-scores-box__game") || titleEl;
  if (anchor) {
    anchor.insertAdjacentHTML("afterend", gameScoresBoxRowsHtml(players, scores));
  } else {
    box.insertAdjacentHTML("beforeend", gameScoresBoxRowsHtml(players, scores));
  }
}
