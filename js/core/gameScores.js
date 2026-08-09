import { getSortedActivePlayers, getEveningStandingPlayers } from "./players.js";
import { getCurrentSessionScoreMap, getState, resolveGameScoreSessionDisplay } from "./state.js";
import { escapeHtml } from "./ui.js";
import {
  sortAndRankByScore,
} from "./competitionRank.js";
import { resolveEveningGameScoreOrder } from "./gameScoreOrder.js";

export { mergeGameScoreOrder, resolveEveningGameScoreOrder } from "./gameScoreOrder.js";

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

export {
  mergeMatchScoresLocal,
  shouldReplaceMatchScoresOnFullHydrate,
  mergeMatchScoresForFullHydrate,
  mergeMatchScoresPatchUid,
} from "./matchScoresMerge.js";

/** @internal exporté pour tests - rangs compétition d’une score box. */
export function rankPlayersByScoreMap(players, scores) {
  return sortAndRankByScore(players, (p) => scores[p.name] || 0);
}

function gameScoresBoxRowsHtml(players, scores) {
  const ranked = rankPlayersByScoreMap(players, scores);
  return ranked
    .map((p) => {
      const pts = scores[p.name] || 0;
      return `
        <div class="game-scores-box__row">
          <span class="game-scores-box__rank">${p.rank}</span>
          <div class="avatar avatar--sm" style="background:${p.color}">${p.emoji}</div>
          <span class="player-name game-scores-box__name">${escapeHtml(p.name)}</span>
          <span class="player-score ${p.rank === 1 && pts > 0 ? "player-score--gold" : ""}">${pts}</span>
        </div>`;
    })
    .join("");
}

const GAME_LABELS = {
  traitre: { title: "Spot the fake", emoji: "🎭", statKey: "traitreGamesPlayed" },
  consensus: { title: "Consensus", emoji: "🤝", statKey: "consensusGamesPlayed" },
  hottake: { title: "HotTake", emoji: "🔥", statKey: "hotTakesPlayed" },
  guesslie: { title: "Guess The Lie", emoji: "🕵️", statKey: "guessLieGamesPlayed" },
  speedvote: { title: "SpeedVote", emoji: "⚡", statKey: "speedVotesPlayed" },
  clutch: { title: "Clutch", emoji: "🎯", statKey: "clutchesPlayed" },
  wronganswer: { title: "Wrong Answer Only", emoji: "↩️", statKey: "wrongAnswersPlayed" },
  dilemma: { title: "Dilemma", emoji: "⚖️", statKey: "dilemmasPlayed" },
  truthmeter: { title: "TruthMeter", emoji: "📏", statKey: "truthMetersPlayed" },
  tiernight: { title: "TierNight", emoji: "🏆", statKey: "tierNightsPlayed" },
  trivia: { title: "Trivia Quiz", emoji: "🧠", statKey: "triviaGamesPlayed" },
};

function gameLeaderboardRowsHtml(players, scoreMap) {
  const ranked = rankPlayersByScoreMap(players, scoreMap);
  return ranked
    .map((p) => {
      const pts = scoreMap[p.name] || 0;
      const gold = p.rank === 1 && pts > 0 ? "player-score--gold" : "";
      return `
        <div class="game-scores-box__row">
          <span class="game-scores-box__rank">${p.rank}</span>
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

/** Classement de chaque jeu joué dans la soirée. */
export function eveningGameLeaderboardsHtml() {
  const {
    gameScores = {},
    gameScoreOrder = [],
    eveningGamesRecorded = {},
  } = getState();
  const order = resolveEveningGameScoreOrder({
    gameScoreOrder,
    gameScores,
    eveningGamesRecorded,
  });
  if (!order.length && !getEveningStandingPlayers().length) return "";

  const blocks = [];
  order.forEach((gid) => {
    const meta = GAME_LABELS[gid];
    if (!meta) return;
    // Actifs + contributeurs de CE jeu (pas tous les historiques de la soirée).
    const players = getEveningStandingPlayers({ gameId: gid });
    if (!players.length) return;
    const titleHtml = `${meta.emoji} ${escapeHtml(meta.title)}`;
    blocks.push(gameLeaderboardCardHtml(titleHtml, players, gameScores[gid] || {}));
  });

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
  const players = getSortedActivePlayers();
  if (!players.length) return "";

  if (scoresOverride == null && gameId === "tiernight") {
    const view = resolveGameScoreSessionDisplay("tiernight");
    if (!view.ready) {
      return `
    <div class="card game-scores-box" data-scores="session" data-scores-pending="1">
      <p class="card-heading game-scores-box__title">${escapeHtml(title)}</p>
      ${gameLabel ? `<p class="game-scores-box__game">${escapeHtml(gameLabel)}</p>` : ""}
      <p class="hint">Synchronisation des scores…</p>
    </div>`;
    }
  }

  const scores =
    scoresOverride && typeof scoresOverride === "object"
      ? scoresOverride
      : getCurrentSessionScoreMap(gameId);

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
  const players = getSortedActivePlayers();
  if (!players.length) return;

  const box = app.querySelector('[data-scores="session"]');
  if (!box) return;

  if (scoresOverride == null && gameId === "tiernight") {
    const view = resolveGameScoreSessionDisplay("tiernight");
    if (!view.ready) {
      box.setAttribute("data-scores-pending", "1");
      const titleEl = box.querySelector(".game-scores-box__title");
      if (titleEl) titleEl.textContent = title;
      const gameEl = box.querySelector(".game-scores-box__game");
      if (gameEl && gameLabel) gameEl.textContent = gameLabel;
      const rows = box.querySelectorAll(".game-scores-box__row");
      rows.forEach((el) => el.remove());
      let hint = box.querySelector(".hint");
      if (!hint) {
        hint = document.createElement("p");
        hint.className = "hint";
        box.appendChild(hint);
      }
      hint.textContent = "Synchronisation des scores…";
      return;
    }
    box.removeAttribute("data-scores-pending");
    box.querySelector(".hint")?.remove();
  }

  const scores =
    scoresOverride && typeof scoresOverride === "object"
      ? scoresOverride
      : getCurrentSessionScoreMap(gameId);

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
