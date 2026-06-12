import { SPEED_VOTE_POINTS_WINNER } from "../../data/speedVote.js";
import {
  getSpeedVoteEntryScreen,
  getSpeedVoteSession,
  getSpeedVoteQuestions,
  getSpeedVoteModifier,
  getVoteTargets,
  commitSpeedVotePlay,
  commitSpeedVoteVote,
  allSpeedVoteVotesIn,
  simulateSpeedVoteLobbyVotes,
  countSpeedVoteResults,
  startSpeedVoteRound,
} from "../core/speedVoteSession.js";
import { awardSpeedVoteRound } from "../core/scoring.js";
import { applyMatchScoreDeltas, gameCumulativeScoresHtml, refreshGameScoresBox } from "../core/gameScores.js";
import { getLocalDisplayName, recordSpeedVotePlayed, setLastGame } from "../core/state.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getActivePlayers } from "../core/players.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
// FIL_ROUGE (Mot interdit) - pause soirée ; isEveningGameplayPaused() = false si désactivé
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  completeGameSession,
} from "../core/gameSync.js";

export function mountSpeedVote(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getSpeedVoteEntryScreen();
  if (entry !== "speedvote") {
    navigate(entry);
    return null;
  }

  const QUESTIONS = getSpeedVoteQuestions();
  if (!QUESTIONS.length) {
    navigate("speedvote-prep");
    return null;
  }

  setLobbyPlaying("speedvote");

  let roundIdx = 0;
  let phase = "voting";
  let myVote = null;
  let votes = {};
  let lastAward = null;
  let takeScored = false;
  let revealInFlight = false;
  let currentQuestion = QUESTIONS[0];
  let modifier = "normal";
  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();

  function alreadyScoredThisRound() {
    if (phase !== "reveal") return false;
    return takeScored || Boolean(getSpeedVoteSession().roundScored);
  }

  function syncFromSession() {
    const s = getSpeedVoteSession();
    const prevRound = roundIdx;
    if (s.roundIdx != null) roundIdx = s.roundIdx;
    if (s.phase) phase = s.phase;
    if (s.currentQuestion) currentQuestion = s.currentQuestion;
    if (s.modifier) modifier = s.modifier;
    votes = { ...(s.votes || {}) };
    myVote = votes[localName] ?? null;
    if (roundIdx !== prevRound || phase !== "reveal") {
      lastAward = null;
    }
    takeScored = Boolean(s.roundScored);
  }

  function playerMeta(name) {
    const p = getLobbyParticipants().find((x) => x.name === name);
    return { color: p?.color || "#A78BFA", emoji: p?.emoji || "🎭" };
  }

  function modifierBadgeHtml() {
    const mod = getSpeedVoteModifier({ modifier });
    if (mod.id === "normal") return "";
    return `<p class="speedvote-modifier speedvote-modifier--${mod.id}">${mod.emoji} ${escapeHtml(mod.label)}</p>`;
  }

  function previewRoundAward() {
    const mod = getSpeedVoteModifier({ modifier });
    const { leaders } = countSpeedVoteResults(votes);
    const pointsAwarded = SPEED_VOTE_POINTS_WINNER * mod.multiplier;
    const deltas = {};
    leaders.forEach((name) => {
      deltas[name] = pointsAwarded;
    });
    return {
      winners: leaders,
      pointsAwarded,
      deltas,
    };
  }

  function speedVoteSessionScores() {
    return getSpeedVoteSession().matchScores || {};
  }

  async function transitionToReveal() {
    if (alreadyScoredThisRound()) return;
    if (mp && !isLobbyHost()) return;
    if (revealInFlight) return;

    revealInFlight = true;
    try {
      takeScored = true;
      let matchScores = getSpeedVoteSession().matchScores || {};
      if (!mp || isLobbyHost()) {
        const mod = getSpeedVoteModifier({ modifier });
        lastAward = awardSpeedVoteRound(votes, { multiplier: mod.multiplier });
        matchScores = applyMatchScoreDeltas(matchScores, lastAward.deltas || {});
      } else {
        lastAward = previewRoundAward();
      }
      await commitSpeedVotePlay(
        {
          phase: "reveal",
          roundScored: true,
          votes,
          voteEndsAt: null,
          matchScores,
        },
        { withEveningScores: mp && isLobbyHost() }
      );

      if (!mp) {
        phase = "reveal";
        render();
      }
    } finally {
      revealInFlight = false;
    }
  }

  async function goToReveal() {
    await transitionToReveal();
  }

  /** Filet de sécurité hôte : clôt la manche même si un joueur n'a pas voté. */
  async function forceReveal() {
    if (mp && !isLobbyHost()) return;
    await goToReveal();
  }

  function voteButtonsHtml() {
    const targets = getVoteTargets();
    if (!targets.length) {
      return `<p class="hint">Aucun joueur dans le lobby.</p>`;
    }
    return `
      <div class="speedvote-vote-grid">
        ${targets
          .map((p) => {
            const active = myVote === p.name;
            const selfLabel = p.isLocal || p.name === localName ? ' <span class="muted">(toi)</span>' : "";
            return `
          <button type="button" class="speedvote-vote-btn ${active ? "speedvote-vote-btn--active" : ""}"
            data-vote-player="${escapeHtml(p.name)}" style="--vote-color:${p.color}">
            <span class="speedvote-vote-btn__avatar" style="background:${p.color}">${p.emoji}</span>
            <span class="speedvote-vote-btn__name">${escapeHtml(p.name)}${selfLabel}</span>
            ${active ? '<span class="speedvote-vote-btn__check">✓</span>' : ""}
          </button>`;
          })
          .join("")}
      </div>`;
  }

  function revealHtml() {
    const { counts, leaders, totalVotes } = countSpeedVoteResults(votes);
    const mod = getSpeedVoteModifier({ modifier });
    const names = Object.keys(counts).sort(
      (a, b) => (counts[b] || 0) - (counts[a] || 0)
    );
    const host = !mp || isLobbyHost();

    const points = SPEED_VOTE_POINTS_WINNER * mod.multiplier;
    const awardHtml = leaders.length
      ? `<p class="hint">👑 ${leaders.map((n) => escapeHtml(n)).join(", ")} - <strong>+${points} pts</strong>${mod.multiplier > 1 ? " (×2)" : ""}</p>`
      : `<p class="hint">Aucun vote enregistré pour cette manche.</p>`;

    const bars = names.length
      ? names
          .map((name) => {
            const n = counts[name] || 0;
            const pct = totalVotes ? Math.round((n / totalVotes) * 100) : 0;
            const meta = playerMeta(name);
            const crown = leaders.includes(name) ? " 👑" : "";
            return `
            <div class="result-row">
              <div class="result-row__head">
                <span style="color:${meta.color}">${escapeHtml(name)}${crown}</span>
                <span class="muted">${n} vote${n > 1 ? "s" : ""} · ${pct}%</span>
              </div>
              <div class="progress">
                <div class="progress-fill" style="width:${pct}%;background:${meta.color}"></div>
              </div>
            </div>`;
          })
          .join("")
      : `<p class="hint muted">Pas de votes.</p>`;

    return `
      <h3 class="section-title">Résultats du vote</h3>
      ${awardHtml}
      ${gameCumulativeScoresHtml({
        gameLabel: "SpeedVote",
        title: "Cumul des scores",
        scores: speedVoteSessionScores(),
      })}
      ${bars}
      <div class="card card--votes">
        ${Object.entries(votes)
          .map(([voter, target]) => {
            const t = playerMeta(target);
            return `
            <div class="player-row player-row--compact">
              <span class="player-name">${escapeHtml(voter)}</span>
              <span style="color:${t.color};font-weight:800">→ ${escapeHtml(target)}</span>
            </div>`;
          })
          .join("")}
      </div>
      ${
        host
          ? `<button type="button" class="btn btn-primary btn--spaced" id="next-round">
          ${roundIdx < QUESTIONS.length - 1 ? "Prochaine question →" : "Voir les résultats →"}
        </button>`
          : `<p class="hint">En attente de l'hôte pour la suite…</p>`
      }`;
  }

  function render() {
    syncFromSession();
    const total = QUESTIONS.length;
    const host = !mp || isLobbyHost();
    const mod = getSpeedVoteModifier({ modifier });

    const voteHint = mp
      ? myVote
        ? allSpeedVoteVotesIn()
          ? "Tout le monde a voté !"
          : "En attente des autres joueurs…"
        : "Choisis un joueur !"
      : myVote
        ? "Les autres votent…"
        : "Choisis un joueur !";

    let phaseHtml = "";

    if (phase === "voting") {
      const votedCount = Object.keys(votes).length;
      const totalPlayers = getVoteTargets().length;
      phaseHtml = `
        ${modifierBadgeHtml()}
        <p class="label-upper label-upper--muted">Vote simultané</p>
        ${voteButtonsHtml()}
        <p class="hint">${voteHint}</p>
        ${
          host
            ? `<button type="button" class="btn btn-secondary btn--spaced" id="speedvote-force">
                Révéler maintenant (${votedCount}/${totalPlayers})
              </button>`
            : ""
        }`;
    }

    if (phase === "reveal") {
      phaseHtml = revealHtml();
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <div class="game-header">
          <div class="dots">${QUESTIONS.map((_, i) =>
            `<span class="dot ${i === roundIdx ? "dot--active" : i < roundIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${roundIdx + 1}/${total}</span>
        </div>
        <div class="logo logo--sm"><h1>SPEED VOTE</h1></div>
        <div class="card card--speed">
          <p class="label-upper label-upper--gold">⚡ Question #${roundIdx + 1}</p>
          <p class="hot-take-text">${escapeHtml(currentQuestion)}</p>
        </div>
        ${phaseHtml}
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);

    app.querySelectorAll("[data-vote-player]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (phase !== "voting" || myVote || isEveningGameplayPaused()) return;
        const target = btn.getAttribute("data-vote-player");
        myVote = target;
        votes = { ...votes, [localName]: target };
        if (mp) {
          await commitSpeedVoteVote(target);
          if (allSpeedVoteVotesIn() && isLobbyHost()) await goToReveal();
          render();
        } else {
          votes = simulateSpeedVoteLobbyVotes(target);
          await goToReveal();
        }
      });
    });

    app.querySelector("#speedvote-force")?.addEventListener("click", () => {
      void forceReveal();
    });

    app.querySelector("#next-round")?.addEventListener("click", async () => {
      if (roundIdx < total - 1) {
        const nextIdx = roundIdx + 1;
        if (mp && isLobbyHost()) {
          await startSpeedVoteRound(nextIdx);
        } else {
          await startSpeedVoteRound(nextIdx);
          syncFromSession();
        }
        render();
      } else {
        recordSpeedVotePlayed();
        const winners = lastAward?.winners?.join(", ") || "-";
        setLastGame({
          gameId: "speedvote",
          title: "SpeedVote",
          summary: `${total} manches · derniers gagnants : ${winners}`,
        });
        if (mp) {
          try {
            await completeGameSession({ gameId: "speedvote", screen: "results", state: {} });
          } catch (e) {
            console.warn("REVEAL completeGameSession:", e);
            navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
          }
        } else {
          setLobbyWaiting();
          navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
        }
      }
    });

  }

  function shouldSkipFullRender(prevPhase, prevRound) {
    if (phase !== prevPhase || roundIdx !== prevRound) return false;
    return phase === "voting" || phase === "reveal";
  }

  function patchVotingChrome() {
    const votedCount = Object.keys(votes).length;
    const totalPlayers = getActivePlayers().length;
    const forceBtn = app.querySelector("#speedvote-force");
    if (forceBtn) {
      forceBtn.textContent = `Révéler maintenant (${votedCount}/${totalPlayers})`;
    }
  }

  const unsub = onGameSessionChange(() => {
    const prevPhase = phase;
    const prevRound = roundIdx;
    syncFromSession();
    if (!currentQuestion && QUESTIONS[roundIdx]) {
      currentQuestion = QUESTIONS[roundIdx];
    }
    if (phase === "voting" && isLobbyHost() && allSpeedVoteVotesIn()) {
      void goToReveal();
      return;
    }
    if (shouldSkipFullRender(prevPhase, prevRound)) {
      if (phase === "voting") patchVotingChrome();
      if (phase === "reveal") {
        refreshGameScoresBox(app, {
          gameLabel: "SpeedVote",
          title: "Cumul des scores",
          scores: speedVoteSessionScores(),
        });
      }
      return;
    }
    render();
  });

  render();

  return () => {
    unsub();
  };
}
