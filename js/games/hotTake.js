import {
  HOT_TAKE_OPTIONS,
  HOT_TAKE_OPTION_COLORS,
  HOT_TAKE_TIMER_SEC,
} from "../../data/hotTakes.js";

import {
  getAllTakesForGame,
  getHotTakeEntryScreen,
  getHotTakeSession,
  simulateLobbyVotes,
  getMajorityOption,
  commitHotTakePlay,
  allHotTakeVotesIn,
} from "../core/hotTakeSession.js";
import { awardHotTakeVotes, EVENING_POINTS } from "../core/scoring.js";
import { gameCumulativeScoresHtml } from "../core/gameScores.js";
import { getActivePlayers } from "../core/players.js";
import { getLocalDisplayName, recordHotTakePlayed, setLastGame } from "../core/state.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  completeGameSession,
  syncLobbyScores,
} from "../core/gameSync.js";

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

  setLobbyPlaying("hottake");

  let takeIdx = 0;
  let phase = "question";
  let myVote = null;
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
    const fromSession = { ...(getHotTakeSession().votes || {}) };
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
    return takeScored || Boolean(getHotTakeSession().takeScored);
  }

  function canAwardThisTake() {
    return !alreadyScoredThisTake() && (!mp || isLobbyHost());
  }

  function syncFromSession() {
    const s = getHotTakeSession();
    if (s.takeIdx != null) takeIdx = s.takeIdx;
    if (s.phase) phase = s.phase;
    votes = { ...(s.votes || {}) };

    if (phase !== "voting") {
      myVote = null;
    } else {
      if (voteCommitInFlight != null) {
        myVote = voteCommitInFlight;
        votes = { ...votes, [localName]: voteCommitInFlight };
      } else {
        myVote = votes[localName] ?? null;
      }
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

  function voteCounts(votesMap = votes) {
    return HOT_TAKE_OPTIONS.reduce((acc, opt) => {
      acc[opt] = Object.values(votesMap).filter((v) => v === opt).length;
      return acc;
    }, {});
  }

  function hotTakePlayerVotesHtml(votesMap) {
    const players = getActivePlayers();
    if (!players.length) return "";

    const rows = players
      .map((p) => {
        const choice = votesMap[p.name];
        const voteHtml = choice
          ? `<span class="hot-take-vote-pill" style="color:${HOT_TAKE_OPTION_COLORS[choice]}">${escapeHtml(choice)}</span>`
          : `<span class="muted">Pas voté</span>`;
        return `
          <div class="player-row player-row--compact">
            <div class="avatar avatar--sm" style="background:${p.color}">${p.emoji}</div>
            <span class="player-name">${escapeHtml(p.name)}</span>
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

  function hotTakeAwardSummaryHtml(voteResult, { pointsAwarded = false } = {}) {
    if (!voteResult) return "";
    if (voteResult.tied || !voteResult.majority) {
      return `<p class="hint">Égalité - <strong>aucun point</strong> (pas de majorité ni de minorité).</p>`;
    }
    const ptsLine = pointsAwarded
      ? ` - majorité +${EVENING_POINTS.WIN} pts, minorité +${EVENING_POINTS.BONUS} pts`
      : "";
    return `<p class="hint">Majorité : <strong style="color:${HOT_TAKE_OPTION_COLORS[voteResult.majority]}">${voteResult.majority}</strong>${ptsLine}</p>`;
  }

  async function goToReveal() {
    if (revealInFlight) return;
    const votesToScore = votesForAward();

    if (alreadyScoredThisTake()) {
      if (phase !== "reveal") {
        phase = "reveal";
        if (!mp) {
          await commitHotTakePlay({
            phase: "reveal",
            takeScored: true,
            votes: votesToScore,
            voteEndsAt: null,
          });
        }
        render();
      }
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
        render();
      }
      return;
    }

    revealInFlight = true;
    try {
      takeScored = true;
      await commitHotTakePlay({
        phase: "reveal",
        takeScored: true,
        votes: votesToScore,
        voteEndsAt: null,
      });
      lastAward = awardHotTakeVotes(votesToScore, HOT_TAKE_OPTIONS);
      if (mp) await syncLobbyScores();
      if (!mp) {
        phase = "reveal";
        render();
      }
    } finally {
      revealInFlight = false;
    }
  }

  async function startVotePhase() {
    if (mp && !isLobbyHost()) return;
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
      votes = {};
      render();
    }
  }

  async function startNextTakeVote() {
    if (mp && !isLobbyHost()) return;
    if (mp) {
      await commitHotTakePlay({
        phase: "voting",
        takeIdx,
        votes: {},
        takeScored: false,
        voteEndsAt: new Date(Date.now() + HOT_TAKE_TIMER_SEC * 1000).toISOString(),
        intermissionEndsAt: null,
        pausedBy: null,
      });
    } else {
      phase = "voting";
      myVote = null;
      votes = {};
      render();
    }
  }

  /** Filet de sécurité hôte : clôt le vote même si un joueur n'a pas voté. */
  async function forceReveal() {
    if (mp && !isLobbyHost()) return;
    if (!mp && !myVote) {
      myVote = HOT_TAKE_OPTIONS[0];
      votes = simulateLobbyVotes(myVote, HOT_TAKE_OPTIONS);
    }
    await goToReveal();
  }

  function render() {
    syncFromSession();
    const take = takeLabel(TAKES[takeIdx]);
    const total = TAKES.length;
    const counts = voteCounts();
    const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
    const host = !mp || isLobbyHost();
    const voteHint = mp
      ? myVote
        ? allHotTakeVotesIn()
          ? "Tout le monde a voté !"
          : "En attente des autres joueurs…"
        : "Choisis ton camp !"
      : myVote
        ? "Les autres votent en même temps (NPC)."
        : "Choisis ton camp !";
    const voteOptionsHint =
      "Valide = d'accord · Acceptable = bof · Criminel = pas d'accord";
    const voteHintExtra =
      phase === "voting" && canChangeVote()
        ? " · Tu peux changer ton vote tant que le vote est ouvert."
        : "";

    let phaseHtml = "";

    if (phase === "question") {
      phaseHtml = host
        ? `<p class="hint">Vote simultané - lance le vote quand tout le monde est prêt.</p>
        <button type="button" class="btn btn-primary" id="start-vote">Lancer le vote →</button>`
        : `<p class="hint">En attente que l'hôte lance le vote…</p>`;
    }

    if (phase === "voting") {
      const canVote = canChangeVote();
      const votedCount = Object.keys(votes).length;
      const totalPlayers = getActivePlayers().length;
      phaseHtml = `
        <p class="label-upper label-upper--muted">Vote simultané</p>
        <div class="vote-buttons">
          ${HOT_TAKE_OPTIONS.map(
            (opt) => `
            <button type="button" class="vote-btn ${myVote === opt ? "vote-btn--active" : ""}"
              data-vote="${opt}" style="--vote-color:${HOT_TAKE_OPTION_COLORS[opt]}"
              ${canVote ? "" : "disabled"}>
              ${opt}${myVote === opt ? " ✓" : ""}
            </button>`
          ).join("")}
        </div>
        <p class="hint">${voteOptionsHint}</p>
        <p class="hint">${voteHint}${voteHintExtra}</p>
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
      const awardHtml = hotTakeAwardSummaryHtml(voteResult, {
        pointsAwarded: Boolean(lastAward?.pointsAwarded),
      });
      phaseHtml = `
        <h3 class="section-title">Résultats du vote</h3>
        ${awardHtml}
        ${HOT_TAKE_OPTIONS.map((opt) => {
          const n = revealCounts[opt] || 0;
          const pct = revealTotal ? Math.round((n / revealTotal) * 100) : 0;
          return `
            <div class="result-row">
              <div class="result-row__head">
                <span style="color:${HOT_TAKE_OPTION_COLORS[opt]}">${opt}${crownOpt && opt === crownOpt ? " 👑" : ""}</span>
                <span class="muted">${n} vote${n > 1 ? "s" : ""} · ${pct}%</span>
              </div>
              <div class="progress">
                <div class="progress-fill" style="width:${pct}%;background:${HOT_TAKE_OPTION_COLORS[opt]}"></div>
              </div>
            </div>`;
        }).join("")}
        ${hotTakePlayerVotesHtml(revealVotes)}
        ${gameCumulativeScoresHtml({ gameLabel: "Hot Take", title: "Cumul des scores" })}
        ${
          host
            ? `<button type="button" class="btn btn-primary btn--spaced" id="next-take">
          ${takeIdx < total - 1 ? "Prochain Hot Take →" : "Voir les résultats →"}
        </button>`
            : `<p class="hint">En attente de l'hôte pour la suite…</p>`
        }`;
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
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
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);

    app.querySelector("#start-vote")?.addEventListener("click", () => startVotePhase());

    app.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!canChangeVote()) return;
        const choice = btn.getAttribute("data-vote");
        if (choice === myVote && votes[localName] === choice) return;
        myVote = choice;
        votes = { ...votes, [localName]: choice };
        if (mp) {
          voteCommitInFlight = choice;
          render();
          try {
            await commitHotTakePlay({ votes: { ...votes } });
          } finally {
            voteCommitInFlight = null;
            syncFromSession();
          }
          if (allHotTakeVotesIn() && isLobbyHost()) {
            await goToReveal();
            return;
          }
        } else {
          votes = simulateLobbyVotes(choice, HOT_TAKE_OPTIONS);
          render();
          await goToReveal();
          return;
        }
        render();
      });
    });

    app.querySelector("#hottake-force")?.addEventListener("click", () => {
      void forceReveal();
    });

    app.querySelector("#next-take")?.addEventListener("click", async () => {
      if (takeIdx < total - 1) {
        const nextIdx = takeIdx + 1;
        takeIdx = nextIdx;
        myVote = null;
        votes = {};
        lastAward = null;
        takeScored = false;
        await startNextTakeVote();
        render();
      } else {
        recordHotTakePlayed();
        setLastGame({
          gameId: "hottake",
          title: "Hot Take",
          summary: `${total} prises · dernière majorité : ${lastAward?.majority || "-"}`,
        });
        if (mp) {
          try {
            await completeGameSession({ gameId: "hottake", screen: "results", state: {} });
          } catch (e) {
            console.warn("REVEAL completeGameSession:", e);
            navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
          }
        } else {
          setLobbyWaiting();
        }
        navigate("results");
      }
    });
  }

  const unsubGame = onGameSessionChange(() => {
    syncFromSession();
    if (phase === "voting" && isLobbyHost() && allHotTakeVotesIn()) {
      void goToReveal();
      return;
    }
    render();
  });

  syncFromSession();
  render();

  return () => {
    unsubGame();
    if (!mp) setLobbyWaiting();
  };
}
