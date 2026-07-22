import {
  HOT_TAKE_OPTIONS,
  HOT_TAKE_OPTION_COLORS,
  HOT_TAKE_TIMER_SEC,
  HOT_TAKE_POINTS_TIE,
} from "../../data/hotTakes.js";

import {
  getAllTakesForGame,
  getHotTakeEntryScreen,
  getHotTakeSession,
  simulateLobbyVotes,
  getMajorityOption,
  commitHotTakePlay,
  commitHotTakeVote,
  allHotTakeVotesIn,
  getHotTakeVotesForUi,
  resetHotTakeAfterGame,
} from "../core/hotTakeSession.js";
import { awardHotTakeVotes, EVENING_POINTS } from "../core/scoring.js";
import {
  applyMatchScoreDeltas,
  gameCumulativeScoresHtml,
  refreshGameScoresBox,
} from "../core/gameScores.js";
import { getActivePlayers, getActivePlayerNames } from "../core/players.js";
import { getLocalDisplayName, recordHotTakePlayed, setLastGame } from "../core/state.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { withClickLock } from "../core/actionLock.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
// FIL_ROUGE (Mot interdit) - pause soirée ; isEveningGameplayPaused() = false si désactivé
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import {
  isGameSyncActive,
  canActAsHost,
  onGameSessionChange,
  getActingHostUiRefreshToken,
  completeGameSession,
  hotTakeToRemote,
  stopGameSessionListenerOnPostGame,
  refreshGameSession,
} from "../core/gameSync.js";
import { voteConfirmChrome, pickForVoteConfirm } from "../core/voteConfirm.js";
import { arch03AhLogSkipDecision } from "../core/arch03ActingHostDebug.js";

function buildHotTakeStandings(matchScores = {}) {
  return [...getActivePlayers()]
    .map((player) => ({
      ...player,
      score: Number(matchScores[player.name]) || 0,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((player, index) => ({
      ...player,
      rank: index + 1,
    }));
}

function finalHotTakeResultsHtml({
  standings = [],
  showContinueAction = true,
  continueAction = "show-results",
  continueLabel = "Voir les résultats",
  waitingText = "En attente de l'hôte pour afficher les résultats…",
} = {}) {
  const winner = standings[0] || null;
  return `
    <div class="card card--highlight hottake-final">
      <p class="label-upper label-upper--hot">🔥 Hot Take</p>
      <h3 class="section-title">Podium final</h3>
      ${
        winner
          ? `<p class="hint hottake-final__summary">👑 <strong>${escapeHtml(winner.name)}</strong> remporte la partie avec <strong>${winner.score} pts</strong>.</p>`
          : ""
      }
      <div class="trivia-results__podium">
        ${standings
          .map(
            (player) => `
          <div class="trivia-results__row ${player.rank <= 3 ? "trivia-results__row--winner" : ""} ${player.rank === 1 ? "trivia-results__row--champion" : ""}">
            <span class="trivia-results__medal">${player.rank === 1 ? "🥇" : player.rank === 2 ? "🥈" : player.rank === 3 ? "🥉" : "•"}</span>
            <div class="avatar avatar--sm" style="background:${player.color}">${player.emoji}</div>
            <span class="player-name trivia-results__name">${escapeHtml(player.name)}</span>
            <span class="trivia-results__score">${player.score} pts</span>
          </div>`
          )
          .join("")}
      </div>
      ${
        showContinueAction
          ? `<button type="button" class="btn btn-primary btn--spaced" data-hottake-action="${escapeHtml(continueAction)}">${escapeHtml(continueLabel)}</button>`
          : `<p class="hint">${escapeHtml(waitingText)}</p>`
      }
    </div>`;
}

export function mountHotTake(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getHotTakeEntryScreen();
  if (entry !== "hottake") {
    navigate(entry);
    return null;
  }

  const TAKES = getAllTakesForGame();
  if (!TAKES.length) {
    navigate("hottake-prep");
    return null;
  }

  if (getHotTakeSession().phase !== "final") {
    void setLobbyPlaying("hottake").catch(() => {});
  }

  let takeIdx = 0;
  let phase = "question";
  /** Vote validé (session). */
  let myVote = null;
  /** Choix local avant « Valider mon vote ». */
  let selected = null;
  let votes = {};
  let lastAward = null;
  let takeScored = false;
  /** Évite deux révélations / double scoring concurrentes. */
  let revealInFlight = false;
  /** Vote en cours d’envoi - évite que la synchro efface l’UI avant la réponse serveur. */
  let voteCommitInFlight = null;
  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();

  /** Votes complets pour le scoring (session sync), pas le snapshot local du clic. */
  function votesForAward() {
    const fromSession = { ...getHotTakeVotesForUi() };
    if (voteCommitInFlight != null && fromSession[localName] == null) {
      fromSession[localName] = voteCommitInFlight;
    }
    if (!mp && Object.keys(fromSession).length === 0 && Object.keys(votes).length > 0) {
      return { ...votes };
    }
    votes = fromSession;
    return fromSession;
  }

  function alreadyScoredThisTake() {
    if (phase !== "reveal") return false;
    return takeScored || Boolean(getHotTakeSession().takeScored);
  }

  function sessionInReveal() {
    const session = getHotTakeSession();
    return session.phase === "reveal" || Boolean(session.takeScored);
  }

  function enterRevealUi() {
    syncFromSession();
    if (!lastAward && hotTakeLastRoundFromSession()) {
      const lr = hotTakeLastRoundFromSession();
      lastAward = {
        majority: lr.majority,
        pointsAwarded: Boolean(lr.pointsAwarded),
        deltas: lr.deltas || {},
        dissenters: lr.dissenters || [],
        majorityWinners: lr.majorityWinners || [],
      };
    }
    render();
  }

  function canAwardThisTake() {
    return !alreadyScoredThisTake() && (!mp || canActAsHost());
  }

  function syncFromSession() {
    const s = getHotTakeSession();
    if (s.takeIdx != null) takeIdx = s.takeIdx;
    if (s.phase) phase = s.phase;
    votes = { ...getHotTakeVotesForUi() };

    if (phase !== "voting") {
      myVote = null;
      selected = null;
    } else if (voteCommitInFlight != null) {
      myVote = voteCommitInFlight;
    } else {
      myVote = votes[localName] ?? null;
    }
    takeScored = Boolean(s.takeScored);
    if (phase === "voting" && !takeScored) {
      lastAward = null;
    }
  }

  function takeLabel(take) {
    if (typeof take === "string") return { text: take, author: null, themeId: null };
    return {
      text: take.text,
      author: take.author || null,
      themeId: take.themeId || null,
    };
  }

  function takeAuthorLine(take) {
    if (take.themeId !== "custom" || !take.author) return "";
    return `<p class="hot-take-author">Hot take de ${escapeHtml(take.author)}</p>`;
  }

  /**
   * Auteur à exclure du verdict (majorité + points), comme TruthMeter exclut l'auteur.
   * Uniquement les takes custom (vraie paternité) : les takes du pool reçoivent un
   * `author` pseudo-aléatoire (round-robin) qui n'est pas une vraie paternité — l'exclure
   * supprimerait à tort le vote d'un joueur à presque chaque manche.
   */
  function currentTakeVerdictAuthor() {
    const take = takeLabel(TAKES[takeIdx]);
    return take.themeId === "custom" && take.author ? take.author : null;
  }

  function voteCounts(votesMap = votes) {
    return HOT_TAKE_OPTIONS.reduce((acc, opt) => {
      acc[opt] = Object.values(votesMap).filter((v) => v === opt).length;
      return acc;
    }, {});
  }

  function hotTakePlayerVotesHtml(votesMap, majority = null) {
    const players = getActivePlayers();
    if (!players.length) return "";

    const rows = players
      .map((p) => {
        const choice = votesMap[p.name];
        const isOutsider = Boolean(majority && choice && choice !== majority);
        const voteHtml = choice
          ? `<span class="hot-take-vote-pill ${isOutsider ? "hot-take-vote-pill--outsider" : ""}" style="color:${HOT_TAKE_OPTION_COLORS[choice]}">${escapeHtml(choice)}${isOutsider ? " 🔥" : ""}</span>`
          : `<span class="muted">Pas voté</span>`;
        return `
          <div class="player-row player-row--compact ${isOutsider ? "player-row--outsider" : ""}">
            <div class="avatar avatar--sm" style="background:${p.color}">${p.emoji}</div>
            <span class="player-name">${escapeHtml(p.name)}${isOutsider ? ` <span class="hot-take-outsider-tag">outsider</span>` : ""}</span>
            ${voteHtml}
          </div>`;
      })
      .join("");

    return `
      <h3 class="section-title section-title--sm">Votes des joueurs</h3>
      <div class="card card--votes">${rows}</div>`;
  }

  function canChangeVote() {
    return phase === "voting" && !isEveningGameplayPaused();
  }

  function hotTakeSessionScores() {
    return getHotTakeSession().matchScores || {};
  }

  function hotTakeLastRoundFromSession() {
    return getHotTakeSession().lastRound || null;
  }

  function buildHotTakeLastRound(award) {
    if (!award?.pointsAwarded) return null;
    return {
      majority: award.majority,
      tied: Boolean(award.tied),
      pointsAwarded: true,
      deltas: award.deltas || {},
      dissenters: award.dissenters || [],
      majorityWinners: award.majorityWinners || [],
      tieWinners: award.tieWinners || [],
    };
  }

  function hotTakePlayersByCamp(votesMap, majority) {
    if (!majority) {
      return { outsiders: [], troupeau: [] };
    }
    const outsiders = [];
    const troupeau = [];
    getActivePlayers().forEach((player) => {
      const choice = votesMap[player.name];
      if (!choice) return;
      if (choice === majority) troupeau.push(player.name);
      else outsiders.push(player.name);
    });
    return { outsiders, troupeau };
  }

  function hotTakeRevealSummaryHtml(voteResult, votesMap, { pointsAwarded = false } = {}) {
    if (!voteResult) return "";
    if (voteResult.tied || !voteResult.majority) {
      if (pointsAwarded) {
        return `<p class="hint">Égalité - <strong>+${HOT_TAKE_POINTS_TIE} pts</strong> pour tout le monde.</p>`;
      }
      return `<p class="hint">Égalité - <strong>aucun point</strong> (pas de troupeau ni d'outsider).</p>`;
    }

    const majority = voteResult.majority;
    const { outsiders, troupeau } = hotTakePlayersByCamp(votesMap, majority);
    const namesHtml = (list) => list.map((name) => escapeHtml(name)).join(", ");
    let banner = "";

    if (pointsAwarded && outsiders.length) {
      if (outsiders.length === 1) {
        banner = `
          <div class="hot-take-outsider-banner hot-take-outsider-banner--solo">
            <p class="hot-take-outsider-banner__kicker">🔥 Outsider de la manche</p>
            <p class="hot-take-outsider-banner__title">Seul·e face au monde</p>
            <p class="hot-take-outsider-banner__body"><strong>${namesHtml(outsiders)}</strong> - respect · +${EVENING_POINTS.BONUS} pts</p>
          </div>`;
      } else {
        banner = `
          <div class="hot-take-outsider-banner">
            <p class="hot-take-outsider-banner__kicker">🔥 Camp outsider</p>
            <p class="hot-take-outsider-banner__title">Contre le troupeau</p>
            <p class="hot-take-outsider-banner__body"><strong>${namesHtml(outsiders)}</strong> - +${EVENING_POINTS.BONUS} pts chacun·e</p>
          </div>`;
      }
    }

    const localIsOutsider = pointsAwarded && outsiders.includes(localName);
    const localIsTroupeau = pointsAwarded && troupeau.includes(localName);
    const localLine = localIsOutsider
      ? `<p class="hot-take-outsider-local">T'es pas dans le troupeau - et c'est mieux pour ton score (+${EVENING_POINTS.BONUS}).</p>`
      : localIsTroupeau
        ? `<p class="hot-take-troupeau-local hint">Tu suis le troupeau (+${EVENING_POINTS.WIN}). Les outsiders ont pris +${EVENING_POINTS.BONUS}…</p>`
        : "";

    const troupeauLine = `<p class="hint">Troupeau : <strong style="color:${HOT_TAKE_OPTION_COLORS[majority]}">${majority}</strong>${
      pointsAwarded ? ` - +${EVENING_POINTS.WIN} pts` : ""
    }</p>`;

    return `${banner}${localLine}${troupeauLine}`;
  }

  function hotTakeAwardSummaryHtml(voteResult, votesMap, options = {}) {
    return hotTakeRevealSummaryHtml(voteResult, votesMap, options);
  }

  async function finishHotTakeGame() {
    const live = getHotTakeSession();
    if (live.phase === "final") {
      render();
      return;
    }

    const standings = buildHotTakeStandings(live.matchScores || {});
    if (!mp || canActAsHost()) {
      recordHotTakePlayed();
      setLastGame({
        gameId: "hottake",
        title: "Hot Take",
        summary: `${TAKES.length} prises · gagnant : ${standings[0]?.name || "-"}`,
      });
    }

    const finalSession = {
      ...live,
      phase: "final",
    };

    if (mp && canActAsHost()) {
      await commitHotTakePlay(finalSession, { screen: "hottake" });
      render();
      return;
    }

    if (!mp) {
      await commitHotTakePlay(finalSession);
      render();
    }
  }

  async function showEveningResults() {
    if (mp && !canActAsHost()) return;

    const resetHt = await resetHotTakeAfterGame({ syncRemote: false });

    if (mp) {
      try {
        await completeGameSession({
          gameId: "hottake",
          screen: "results",
          state: { hotTake: hotTakeToRemote(resetHt) },
        });
      } catch (e) {
        console.warn("REVEAL completeGameSession:", e);
        navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
      }
      return;
    }

    await setLobbyWaiting();
    navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
  }

  async function goToReveal() {
    if (revealInFlight) return;
    if (mp && canActAsHost()) {
      await refreshGameSession();
      syncFromSession();
    }
    const votesToScore = votesForAward();

    if (alreadyScoredThisTake()) {
      if (mp && getHotTakeSession().phase !== "reveal") {
        await commitHotTakePlay({
          phase: "reveal",
          takeScored: true,
          votes: votesToScore,
          voteEndsAt: null,
        });
      }
      enterRevealUi();
      return;
    }

    if (!canAwardThisTake()) {
      if (mp) {
        await commitHotTakePlay({
          phase: "reveal",
          votes: votesToScore,
          voteEndsAt: null,
        });
      } else {
        phase = "reveal";
      }
      enterRevealUi();
      return;
    }

    revealInFlight = true;
    try {
      takeScored = true;
      let matchScores = getHotTakeSession().matchScores || {};
      let lastRound = getHotTakeSession().lastRound || null;
      if (canAwardThisTake()) {
        // Le vote de l'auteur (take custom) ne compte ni dans la majorité ni dans les
        // points. Les votes commités (votesToScore) restent intacts pour l'affichage.
        const verdictAuthor = currentTakeVerdictAuthor();
        const votesForVerdict = verdictAuthor
          ? Object.fromEntries(
              Object.entries(votesToScore).filter(([name]) => name !== verdictAuthor)
            )
          : votesToScore;
        lastAward = awardHotTakeVotes(votesForVerdict, HOT_TAKE_OPTIONS);
        matchScores = applyMatchScoreDeltas(matchScores, lastAward.deltas || {});
        lastRound = buildHotTakeLastRound(lastAward);
      }
      await commitHotTakePlay(
        {
          phase: "reveal",
          takeScored: true,
          votes: votesToScore,
          voteEndsAt: null,
          matchScores,
          lastRound,
        },
        {
          withEveningScores: mp && canActAsHost(),
          withPatchFeedback: mp && canActAsHost(),
        }
      );
      phase = "reveal";
      enterRevealUi();
    } finally {
      revealInFlight = false;
    }
  }

  async function startVotePhase() {
    if (mp && !canActAsHost()) return;
    const endsAt = new Date(Date.now() + HOT_TAKE_TIMER_SEC * 1000).toISOString();
    if (mp) {
      await commitHotTakePlay({
        phase: "voting",
        votes: {},
        takeScored: false,
        voteEndsAt: endsAt,
        intermissionEndsAt: null,
        pausedBy: null,
      });
    } else {
      phase = "voting";
      myVote = null;
      selected = null;
      votes = {};
      render();
    }
  }

  async function startNextTakeVote() {
    if (mp && !canActAsHost()) return;
    await commitHotTakePlay({
      phase: "voting",
      takeIdx,
      votes: {},
      takeScored: false,
      voteEndsAt: new Date(Date.now() + HOT_TAKE_TIMER_SEC * 1000).toISOString(),
      intermissionEndsAt: null,
      pausedBy: null,
    });
    selected = null;
    syncFromSession();
    render();
  }

  /** Filet de sécurité hôte : clôt le vote même si un joueur n'a pas voté. */
  async function forceReveal() {
    if (mp && !canActAsHost()) return;
    if (!mp && !myVote) {
      const pick = pickForVoteConfirm(selected, myVote) ?? HOT_TAKE_OPTIONS[0];
      myVote = pick;
      votes = simulateLobbyVotes(pick, HOT_TAKE_OPTIONS);
    }
    await goToReveal();
  }

  async function submitVote(pick) {
    if (pick == null || voteCommitInFlight != null) return;
    if (mp) {
      voteCommitInFlight = pick;
      render();
      try {
        await commitHotTakeVote(pick);
        selected = null;
        myVote = pick;
      } finally {
        voteCommitInFlight = null;
        syncFromSession();
      }
      if (allHotTakeVotesIn() && canActAsHost()) {
        await goToReveal();
        return;
      }
    } else {
      myVote = pick;
      selected = null;
      votes = simulateLobbyVotes(pick, HOT_TAKE_OPTIONS);
      render();
      await goToReveal();
      return;
    }
    render();
  }

  function countPlayersVoted() {
    const base = getHotTakeVotesForUi();
    if (voteCommitInFlight != null) {
      base[localName] = voteCommitInFlight;
    }
    const names = getActivePlayerNames();
    return names.filter((name) => base[name] != null && base[name] !== "").length;
  }

  function render() {
    syncFromSession();
    const take = takeLabel(TAKES[takeIdx]);
    const total = TAKES.length;
    const counts = voteCounts();
    const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
    const host = !mp || canActAsHost();
    const voteOptionsHint =
      "Valide = d'accord · Acceptable = bof · Criminel = pas d'accord";
    const outsiderTip = `<p class="hint hot-take-outsider-tip">💡 La minorité fait mieux que le troupeau (+${EVENING_POINTS.BONUS} vs +${EVENING_POINTS.WIN}). Ose le contre-pied ?</p>`;

    let phaseHtml = "";

    if (phase === "question") {
      phaseHtml = host
        ? `<p class="hint hot-take-outsider-tip">Ici, parfois c'est mieux d'être outsider (+${EVENING_POINTS.BONUS} pts).</p>
        <p class="hint">Vote simultané - lance le vote quand tout le monde est prêt.</p>
        <button type="button" class="btn btn-primary" id="start-vote">Lancer le vote →</button>`
        : `<p class="hint hot-take-outsider-tip">Ici, parfois c'est mieux d'être outsider (+${EVENING_POINTS.BONUS} pts).</p>
        <p class="hint">En attente que l'hôte lance le vote…</p>`;
    }

    if (phase === "voting") {
      const canVote = canChangeVote();
      const votedCount = countPlayersVoted();
      const totalPlayers = getActivePlayers().length;
      const allIn = allHotTakeVotesIn();
      const confirm = voteConfirmChrome({
        selected,
        committed: myVote,
        allIn,
        emptyHint: "Choisis ton camp !",
      });
      phaseHtml = `
        <p class="label-upper label-upper--muted">Vote simultané</p>
        <div class="vote-buttons">
          ${HOT_TAKE_OPTIONS.map(
            (opt) => `
            <button type="button" class="vote-btn ${confirm.displayPick === opt ? "vote-btn--active" : ""}"
              data-vote="${opt}" style="--vote-color:${HOT_TAKE_OPTION_COLORS[opt]}"
              ${canVote ? "" : "disabled"}>
              ${opt}${confirm.displayPick === opt ? " ✓" : ""}
            </button>`
          ).join("")}
        </div>
        <p class="hint">${voteOptionsHint}</p>
        ${outsiderTip}
        <p class="hint">${escapeHtml(confirm.hint)}</p>
        <button type="button" class="btn ${confirm.confirmClass} btn--spaced" id="hottake-confirm"
          ${confirm.confirmDisabled ? "disabled" : ""}>${escapeHtml(confirm.confirmLabel)}</button>
        ${
          host
            ? `<button type="button" class="btn btn-secondary btn--spaced" id="hottake-force">
                Révéler maintenant (${votedCount}/${totalPlayers})
              </button>`
            : ""
        }`;
    }

    if (phase === "reveal") {
      const revealVotes = votesForAward();
      const revealCounts = voteCounts(revealVotes);
      const revealTotal = Object.values(revealCounts).reduce((a, b) => a + b, 0);
      const voteResult = getMajorityOption(revealVotes, HOT_TAKE_OPTIONS);
      const crownOpt = voteResult.majority;
      const pointsAwarded = Boolean(
        lastAward?.pointsAwarded || hotTakeLastRoundFromSession()?.pointsAwarded
      );
      const awardHtml = hotTakeAwardSummaryHtml(voteResult, revealVotes, { pointsAwarded });
      phaseHtml = `
        <h3 class="section-title">Résultats du vote</h3>
        ${awardHtml}
        ${HOT_TAKE_OPTIONS.map((opt) => {
          const n = revealCounts[opt] || 0;
          const pct = revealTotal ? Math.round((n / revealTotal) * 100) : 0;
          const isTroupeau = crownOpt && opt === crownOpt;
          const isOutsiderCamp = crownOpt && opt !== crownOpt && n > 0;
          const campLabel = isTroupeau ? " 👑" : isOutsiderCamp ? " 🔥" : "";
          return `
            <div class="result-row ${isOutsiderCamp ? "result-row--outsider" : ""}">
              <div class="result-row__head">
                <span style="color:${HOT_TAKE_OPTION_COLORS[opt]}">${opt}${campLabel}${isOutsiderCamp ? ` <span class="hot-take-outsider-tag">outsider</span>` : ""}</span>
                <span class="muted">${n} vote${n > 1 ? "s" : ""} · ${pct}%</span>
              </div>
              <div class="progress">
                <div class="progress-fill" style="width:${pct}%;background:${HOT_TAKE_OPTION_COLORS[opt]}"></div>
              </div>
            </div>`;
        }).join("")}
        ${hotTakePlayerVotesHtml(revealVotes, crownOpt)}
        ${gameCumulativeScoresHtml({
          gameLabel: "Hot Take",
          title: "Cumul des scores",
          scores: hotTakeSessionScores(),
        })}
        ${
          host
            ? `<button type="button" class="btn btn-primary btn--spaced" id="next-take">
          ${takeIdx < total - 1 ? "Prochain Hot Take →" : "Voir le podium →"}
        </button>`
            : `<p class="hint">En attente de l'hôte pour la suite…</p>`
        }`;
    }

    if (phase === "final") {
      phaseHtml = finalHotTakeResultsHtml({
        standings: buildHotTakeStandings(hotTakeSessionScores()),
        showContinueAction: !mp || canActAsHost(),
        continueAction: "show-results",
        continueLabel: "Voir les résultats",
        waitingText: "En attente de l'hôte pour afficher les résultats…",
      });
    }

    const mainContent =
      phase === "final"
        ? `
        <div class="game-header">
          <div class="dots">${TAKES.map((_, i) =>
            `<span class="dot ${i === takeIdx ? "dot--active" : i < takeIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${Math.min(takeIdx + 1, total)}/${total}</span>
        </div>
        <div class="logo logo--sm"><h1>HOT TAKE</h1></div>
        ${phaseHtml}
        ${gameExitBarHtml()}`
        : `
        <div class="game-header">
          <div class="dots">${TAKES.map((_, i) =>
            `<span class="dot ${i === takeIdx ? "dot--active" : i < takeIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${takeIdx + 1}/${total}</span>
        </div>
        <div class="logo logo--sm"><h1>HOT TAKE</h1></div>
        <div class="card card--hot">
          <p class="label-upper label-upper--hot">🔥 Hot Take #${takeIdx + 1}</p>
          ${takeAuthorLine(take)}
          <p class="hot-take-text">"${escapeHtml(take.text)}"</p>
        </div>
        ${phaseHtml}
        ${gameExitBarHtml()}`;

    app.innerHTML = pageShell({
      backTarget: "back",
      content: mainContent,
    });

    bindNav(app);
    bindExitGame(app);

    app.querySelector("#start-vote")?.addEventListener("click", () => startVotePhase());

    app.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!canChangeVote()) return;
        selected = btn.getAttribute("data-vote");
        render();
      });
    });

    app.querySelector("#hottake-confirm")?.addEventListener("click", () => {
      void submitVote(pickForVoteConfirm(selected, myVote));
    });

    app.querySelector("#hottake-force")?.addEventListener("click", () => {
      void forceReveal();
    });

    app.querySelector("#next-take")?.addEventListener("click", withClickLock(async () => {
      if (takeIdx < total - 1) {
        const nextIdx = takeIdx + 1;
        takeIdx = nextIdx;
        myVote = null;
        selected = null;
        votes = {};
        lastAward = null;
        takeScored = false;
        await startNextTakeVote();
        render();
      } else {
        await finishHotTakeGame();
      }
    }));

    app.querySelectorAll("[data-hottake-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-hottake-action");
        if (action === "show-results") {
          await showEveningResults();
        }
      });
    });
  }

  function shouldSkipFullRender(prevPhase, prevTake, prevVotesJson) {
    if (phase !== prevPhase || takeIdx !== prevTake) return false;
    if (phase !== "voting") return false;
    const votesNow = JSON.stringify(getHotTakeSession().votes || {});
    if (votesNow !== prevVotesJson) return false;
    return true;
  }

  function patchVotingChrome() {
    const votedCount = countPlayersVoted();
    const totalPlayers = getActivePlayers().length;
    const forceBtn = app.querySelector("#hottake-force");
    if (forceBtn) {
      forceBtn.textContent = `Révéler maintenant (${votedCount}/${totalPlayers})`;
    }
  }

  const unsubGame = onGameSessionChange((row) => {
    if (stopGameSessionListenerOnPostGame(row)) return;

    const prevPhase = phase;
    const prevTake = takeIdx;
    const prevVotesJson = JSON.stringify(getHotTakeSession().votes || {});
    const ahTokenBefore = getActingHostUiRefreshToken();
    syncFromSession();

    if (phase === "voting" && sessionInReveal()) {
      enterRevealUi();
      return;
    }

    if (phase === "voting" && canActAsHost() && allHotTakeVotesIn()) {
      void goToReveal();
      return;
    }

    if (phase === "reveal" && prevPhase !== "reveal") {
      enterRevealUi();
      return;
    }

    const actingHostUiRefresh =
      getActingHostUiRefreshToken() !== ahTokenBefore;
    const skipFull = shouldSkipFullRender(prevPhase, prevTake, prevVotesJson);
    const canAct = canActAsHost();

    if (phase === "reveal" && prevPhase === "reveal" && !actingHostUiRefresh) {
      arch03AhLogSkipDecision("hotTake", {
        decision: "early-return-reveal-scores-only",
        skipFull,
        actingHostUiRefresh,
        ahTokenBefore,
        ahTokenNow: getActingHostUiRefreshToken(),
        canActAsHost: canAct,
        phase,
      });
      refreshGameScoresBox(app, {
        gameLabel: "Hot Take",
        title: "Cumul des scores",
        scores: hotTakeSessionScores(),
      });
      return;
    }

    if (skipFull && !actingHostUiRefresh) {
      arch03AhLogSkipDecision("hotTake", {
        decision: "skip-full-render",
        skipFull,
        actingHostUiRefresh,
        ahTokenBefore,
        ahTokenNow: getActingHostUiRefreshToken(),
        canActAsHost: canAct,
        phase,
      });
      patchVotingChrome();
      return;
    }
    arch03AhLogSkipDecision("hotTake", {
      decision: "full-render",
      skipFull,
      actingHostUiRefresh,
      ahTokenBefore,
      ahTokenNow: getActingHostUiRefreshToken(),
      canActAsHost: canAct,
      phase,
    });
    render();
  });

  syncFromSession();
  render();

  return () => {
    unsubGame();
    if (!mp) setLobbyWaiting();
  };
}
