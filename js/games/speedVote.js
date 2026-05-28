import { SPEED_VOTE_TIMER_SEC, SPEED_VOTE_POINTS_WINNER } from "../../data/speedVote.js";
import {
  getSpeedVoteEntryScreen,
  getSpeedVoteSession,
  getSpeedVoteQuestions,
  getSpeedVoteModifier,
  getVoteTargets,
  commitSpeedVotePlay,
  allSpeedVoteVotesIn,
  simulateSpeedVoteLobbyVotes,
  countSpeedVoteResults,
  startSpeedVoteRound,
} from "../core/speedVoteSession.js";
import { awardSpeedVoteRound } from "../core/scoring.js";
import { gameCumulativeScoresHtml } from "../core/gameScores.js";
import { getLocalDisplayName, recordSpeedVotePlayed, setLastGame } from "../core/state.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { exitGameToLobbyButtonHtml, bindExitGameToLobby } from "../core/exitGame.js";
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import { onTimerSecond, primeTimerSound } from "../core/timerSound.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  completeGameSession,
  syncLobbyScores,
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
  let timer = SPEED_VOTE_TIMER_SEC;
  let myVote = null;
  let votes = {};
  let lastAward = null;
  let takeScored = false;
  let intervalId = null;
  let currentQuestion = QUESTIONS[0];
  let modifier = "normal";
  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();

  function clearTimer() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function secondsUntil(iso) {
    if (!iso) return null;
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
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
    if (phase === "voting" && s.voteEndsAt) {
      timer = secondsUntil(s.voteEndsAt) ?? timer;
    }
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
    return {
      winners: leaders,
      pointsAwarded: SPEED_VOTE_POINTS_WINNER * mod.multiplier,
    };
  }

  async function goToReveal() {
    if (!takeScored) {
      if (!mp || isLobbyHost()) {
        const mod = getSpeedVoteModifier({ modifier });
        lastAward = awardSpeedVoteRound(votes, { multiplier: mod.multiplier });
        if (mp) await syncLobbyScores();
      } else {
        lastAward = previewRoundAward();
      }
      takeScored = true;
    }
    if (mp) {
      await commitSpeedVotePlay({
        phase: "reveal",
        roundScored: true,
        votes,
        voteEndsAt: null,
      });
    } else {
      phase = "reveal";
      render();
    }
  }

  function startVoteTimer() {
    clearTimer();
    primeTimerSound();
    intervalId = setInterval(async () => {
      if (isEveningGameplayPaused()) return;
      const s = getSpeedVoteSession();
      if (phase !== "voting") {
        clearTimer();
        return;
      }
      if (mp && s.voteEndsAt) {
        timer = secondsUntil(s.voteEndsAt) ?? 0;
      } else {
        timer -= 1;
      }
      onTimerSecond({ remaining: timer, urgentAt: 3 });
      const progress = app.querySelector("#progress-el");
      const timerEl = app.querySelector("#timer-el");
      if (progress) {
        progress.style.width = `${(timer / SPEED_VOTE_TIMER_SEC) * 100}%`;
      }
      if (timerEl) timerEl.textContent = String(timer);

      if (timer <= 0) {
        clearTimer();
        if (!mp) {
          if (!myVote) {
            const targets = getVoteTargets();
            if (targets.length) {
              const pick = targets[Math.floor(Math.random() * targets.length)].name;
              myVote = pick;
              votes = simulateSpeedVoteLobbyVotes(pick);
            }
          } else if (Object.keys(votes).length < getLobbyParticipants().length) {
            votes = simulateSpeedVoteLobbyVotes(myVote);
          }
        }
        if (!mp || isLobbyHost()) await goToReveal();
      }
    }, 1000);
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
      ${gameCumulativeScoresHtml({ gameLabel: "SpeedVote", title: "Cumul des scores" })}
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
      }
      ${exitGameToLobbyButtonHtml()}`;
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
      phaseHtml = `
        ${modifierBadgeHtml()}
        <p class="label-upper label-upper--muted">Vote en ${SPEED_VOTE_TIMER_SEC}s</p>
        <div class="timer timer--speed" id="timer-el">${timer}</div>
        <div class="progress progress--timer">
          <div class="progress-fill" id="progress-el" style="width:${(timer / SPEED_VOTE_TIMER_SEC) * 100}%"></div>
        </div>
        ${voteButtonsHtml()}
        <p class="hint">${voteHint}</p>`;
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
      `,
    });

    bindNav(app);
    bindExitGameToLobby(app);

    app.querySelectorAll("[data-vote-player]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (phase !== "voting" || myVote || isEveningGameplayPaused()) return;
        const target = btn.getAttribute("data-vote-player");
        myVote = target;
        votes = { ...votes, [localName]: target };
        if (mp) {
          await commitSpeedVotePlay({ votes });
          if (allSpeedVoteVotesIn() && isLobbyHost()) await goToReveal();
        } else {
          render();
          if (!intervalId) startVoteTimer();
        }
        render();
      });
    });

    app.querySelector("#next-round")?.addEventListener("click", async () => {
      if (!takeScored) {
        const m = getSpeedVoteModifier({ modifier });
        lastAward = awardSpeedVoteRound(votes, { multiplier: m.multiplier });
        takeScored = true;
        if (mp && isLobbyHost()) await syncLobbyScores();
      }

      if (roundIdx < total - 1) {
        const nextIdx = roundIdx + 1;
        if (mp && isLobbyHost()) {
          await startSpeedVoteRound(nextIdx);
        } else {
          roundIdx = nextIdx;
          currentQuestion = QUESTIONS[roundIdx];
          phase = "voting";
          timer = SPEED_VOTE_TIMER_SEC;
          myVote = null;
          votes = {};
          lastAward = null;
          takeScored = false;
          modifier = Math.random() < 0.18 ? "double" : Math.random() < 0.32 ? "hidden" : "normal";
          render();
          startVoteTimer();
        }
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

    if (phase === "voting" && !intervalId && timer > 0) {
      startVoteTimer();
    }
  }

  const unsub = onGameSessionChange(() => {
    const prevPhase = phase;
    syncFromSession();
    if (!currentQuestion && QUESTIONS[roundIdx]) {
      currentQuestion = QUESTIONS[roundIdx];
    }
    if (phase === "voting" && prevPhase !== "voting") {
      clearTimer();
      timer = secondsUntil(getSpeedVoteSession().voteEndsAt) ?? SPEED_VOTE_TIMER_SEC;
      startVoteTimer();
    }
    if (phase === "reveal") {
      clearTimer();
    }
    render();
  });

  render();

  return () => {
    clearTimer();
    unsub();
  };
}
