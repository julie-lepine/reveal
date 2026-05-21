import {
  DILEMMA_VOTE_TIMER_SEC,
  DILEMMA_POINTS_MAJORITY_WIN,
} from "../../data/dilemma.js";
import {
  getDilemmaEntryScreen,
  getDilemmaSession,
  getDilemmaRounds,
  commitDilemmaPlay,
  allDilemmaVotesIn,
  simulateDilemmaLobbyVotes,
  countDilemmaResults,
  startDilemmaRound,
  setDilemmaPausedBy,
  clearDilemmaPause,
} from "../core/dilemmaSession.js";
import { awardDilemmaRound } from "../core/scoring.js";
import { gameCumulativeScoresHtml } from "../core/gameScores.js";
import { getLocalDisplayName, recordDilemmaPlayed, setLastGame } from "../core/state.js";
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

const DILEMMA_VS_SRC = "js/games/dilemma-vs.svg";

export function mountDilemma(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getDilemmaEntryScreen();
  if (entry !== "dilemma") {
    navigate(entry);
    return null;
  }

  const ROUNDS = getDilemmaRounds();
  if (!ROUNDS.length) {
    navigate("dilemma-prep");
    return null;
  }

  setLobbyPlaying("dilemma");

  let roundIdx = 0;
  let phase = "voting";
  let timer = DILEMMA_VOTE_TIMER_SEC;
  let myVote = null;
  let votes = {};
  let voteCommitInFlight = null;
  let lastAward = null;
  let roundScored = false;
  let currentDilemma = ROUNDS[0];
  let intervalId = null;
  let revealPctA = 0;
  let revealPctB = 0;
  let revealAnimDone = false;
  let paused = false;
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
    const s = getDilemmaSession();
    if (s.roundIdx != null) roundIdx = s.roundIdx;
    if (s.phase) phase = s.phase;
    if (s.currentDilemma) currentDilemma = s.currentDilemma;
    votes = { ...(s.votes || {}) };
    if (voteCommitInFlight != null) {
      myVote = voteCommitInFlight;
      votes = { ...votes, [localName]: voteCommitInFlight };
    } else {
      myVote = votes[localName] ?? null;
    }
    roundScored = Boolean(s.roundScored);
    if (phase === "voting" && s.voteEndsAt) {
      timer = secondsUntil(s.voteEndsAt) ?? timer;
    }
    paused = Boolean(s.pausedBy);
  }

  function pauseBanner() {
    const who = getDilemmaSession().pausedBy;
    if (!who) return "";
    return `<p class="pause-banner">⏸ Pause — ${escapeHtml(who)} a mis la partie en pause</p>`;
  }

  function playerMeta(name) {
    const p = getLobbyParticipants().find((x) => x.name === name);
    return { color: p?.color || "#A78BFA", emoji: p?.emoji || "🎭" };
  }

  function animateRevealBars(targetA, targetB) {
    revealAnimDone = false;
    const start = performance.now();
    const duration = 900;

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - (1 - t) ** 3;
      revealPctA = Math.round(targetA * ease);
      revealPctB = Math.round(targetB * ease);
      const barA = app.querySelector("#dilemma-bar-a");
      const barB = app.querySelector("#dilemma-bar-b");
      const labelA = app.querySelector("#dilemma-pct-a");
      const labelB = app.querySelector("#dilemma-pct-b");
      if (barA) barA.style.width = `${revealPctA}%`;
      if (barB) barB.style.width = `${revealPctB}%`;
      if (labelA) labelA.textContent = `${revealPctA}%`;
      if (labelB) labelB.textContent = `${revealPctB}%`;
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        revealAnimDone = true;
        render();
      }
    }
    requestAnimationFrame(frame);
  }

  async function goToReveal() {
    if (!roundScored) {
      if (!mp || isLobbyHost()) {
        lastAward = awardDilemmaRound(votes);
        if (mp) await syncLobbyScores();
      } else {
        lastAward = { ...countDilemmaResults(votes), majorityWinners: [] };
      }
      roundScored = true;
    }
    const { pctA, pctB } = countDilemmaResults(votes);
    revealPctA = 0;
    revealPctB = 0;
    if (mp) {
      await commitDilemmaPlay({
        phase: "reveal",
        roundScored: true,
        votes,
        voteEndsAt: null,
      });
    } else {
      phase = "reveal";
      render();
      animateRevealBars(pctA, pctB);
    }
  }

  async function advanceRound() {
    if (mp && !isLobbyHost()) return;
    const total = ROUNDS.length;
    if (roundIdx < total - 1) {
      const nextIdx = roundIdx + 1;
      if (mp && isLobbyHost()) {
        await startDilemmaRound(nextIdx);
      } else {
        roundIdx = nextIdx;
        currentDilemma = ROUNDS[roundIdx];
        phase = "voting";
        timer = DILEMMA_VOTE_TIMER_SEC;
        myVote = null;
        votes = {};
        lastAward = null;
        roundScored = false;
        render();
        startVoteTimer();
      }
    } else {
      recordDilemmaPlayed();
      const { majority, pctA } = countDilemmaResults(votes);
      setLastGame({
        gameId: "dilemma",
        title: "Dilemma",
        summary: `${total} dilemmes · dernière manche ${pctA}% option A`,
      });
      if (mp) {
        try {
          await completeGameSession({ gameId: "dilemma", screen: "results", state: {} });
        } catch (e) {
          console.warn("REVEAL completeGameSession:", e);
          navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
        }
      } else {
        setLobbyWaiting();
        navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
      }
    }
  }

  function startVoteTimer() {
    clearTimer();
    if (mp && !getDilemmaSession().voteEndsAt) return;
    primeTimerSound();
    intervalId = setInterval(async () => {
      if (paused || isEveningGameplayPaused()) return;
      const s = getDilemmaSession();
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
        progress.style.width = `${(timer / DILEMMA_VOTE_TIMER_SEC) * 100}%`;
      }
      if (timerEl) timerEl.textContent = String(timer);

      if (timer <= 0) {
        clearTimer();
        if (!mp) {
          if (!myVote) {
            const pick = Math.random() < 0.5 ? "A" : "B";
            myVote = pick;
            votes = simulateDilemmaLobbyVotes(pick);
          } else if (!allDilemmaVotesIn()) {
            votes = simulateDilemmaLobbyVotes(myVote);
          }
        }
        if (!mp || isLobbyHost()) await goToReveal();
      }
    }, 1000);
  }

  function dilemmaCardHtml() {
    const a = escapeHtml(currentDilemma?.optionA || "—");
    const b = escapeHtml(currentDilemma?.optionB || "—");
    return `
      <div class="dilemma__card card">
        <p class="dilemma__label">OPTION A</p>
        <p class="dilemma__option dilemma__option--a">${a}</p>
        <img src="${DILEMMA_VS_SRC}" class="dilemma__vs" width="45" height="45" alt="" />
        <p class="dilemma__label">OPTION B</p>
        <p class="dilemma__option dilemma__option--b">${b}</p>
      </div>`;
  }

  function voteTapHtml() {
    return `
      <div class="dilemma__taps">
        <button type="button" class="dilemma__tap dilemma__tap--a ${myVote === "A" ? "dilemma__tap--picked" : ""}"
          data-vote="A">
          <span class="dilemma__tap-label">Option A</span>
          ${myVote === "A" ? '<span class="dilemma__tap-check">✓</span>' : ""}
        </button>
        <button type="button" class="dilemma__tap dilemma__tap--b ${myVote === "B" ? "dilemma__tap--picked" : ""}"
          data-vote="B">
          <span class="dilemma__tap-label">Option B</span>
          ${myVote === "B" ? '<span class="dilemma__tap-check">✓</span>' : ""}
        </button>
      </div>`;
  }

  function revealHtml() {
    const totalRounds = ROUNDS.length;
    const host = !mp || isLobbyHost();
    const { pctA, pctB, majority, divided, total } = countDilemmaResults(votes);
    const pctADisplay = revealAnimDone ? pctA : revealPctA;
    const pctBDisplay = revealAnimDone ? pctB : revealPctB;
    const widthA = revealAnimDone ? pctA : revealPctA;
    const widthB = revealAnimDone ? pctB : revealPctB;

    const awardLine = lastAward?.majorityWinners?.length
      ? `<p class="hint">🏆 Victoire (majorité) — <strong>+${DILEMMA_POINTS_MAJORITY_WIN} pts</strong> : ${lastAward.majorityWinners.map((n) => escapeHtml(n)).join(", ")}</p>`
      : "";

    const dividedBanner = divided
      ? `<p class="dilemma__divided">⚡ MANCHE LA PLUS DIVISÉE</p>`
      : "";

    return `
      <h3 class="section-title">Résultats</h3>
      ${dividedBanner}
      ${awardLine}
      ${gameCumulativeScoresHtml({ gameLabel: "Dilemma", title: "Cumul des scores" })}
      <div class="dilemma__result-row ${majority === "A" ? "dilemma__result-row--winner" : ""}">
        <div class="dilemma__result-head">
          <span>Option A</span>
          <span id="dilemma-pct-a" class="dilemma__pct">${pctADisplay}%</span>
        </div>
        <div class="progress">
          <div class="progress-fill dilemma__bar-a" id="dilemma-bar-a" style="width:${widthA}%"></div>
        </div>
      </div>
      <div class="dilemma__result-row ${majority === "B" ? "dilemma__result-row--winner" : ""}">
        <div class="dilemma__result-head">
          <span>Option B</span>
          <span id="dilemma-pct-b" class="dilemma__pct">${pctBDisplay}%</span>
        </div>
        <div class="progress">
          <div class="progress-fill dilemma__bar-b" id="dilemma-bar-b" style="width:${widthB}%"></div>
        </div>
      </div>
      <p class="hint muted">${total} vote${total > 1 ? "s" : ""}</p>
      <div class="card card--votes">
        ${Object.entries(votes)
          .map(([voter, choice]) => {
            const meta = playerMeta(voter);
            const label = choice === "A" ? currentDilemma?.optionA : currentDilemma?.optionB;
            return `
            <div class="player-row player-row--compact">
              <span class="player-avatar" style="background:${meta.color}">${meta.emoji}</span>
              <span class="player-name">${escapeHtml(voter)}</span>
              <span class="dilemma__choice-tag dilemma__choice-tag--${choice}">${choice}</span>
              <span class="muted dilemma__choice-short">${escapeHtml((label || "").slice(0, 28))}${(label || "").length > 28 ? "…" : ""}</span>
            </div>`;
          })
          .join("")}
      </div>
      ${
        host
          ? `<button type="button" class="btn btn-primary btn--spaced" id="next-round">
          ${roundIdx < totalRounds - 1 ? "Manche suivante →" : "Voir les résultats →"}
        </button>`
          : `<p class="hint">En attente de l'hôte pour la suite…</p>`
      }
      ${exitGameToLobbyButtonHtml()}`;
  }

  function votingPhaseHtml() {
    const host = !mp || isLobbyHost();
    const voteHint = mp
      ? myVote
        ? allDilemmaVotesIn()
          ? "Tout le monde a voté !"
          : "En attente des autres…"
        : "Choisis ton camp !"
      : myVote
        ? "Les autres votent…"
        : "Choisis ton camp !";

    return `
      ${pauseBanner()}
      <p class="label-upper label-upper--muted">Vote en ${DILEMMA_VOTE_TIMER_SEC}s</p>
      <div class="timer timer--dilemma" id="timer-el">${timer}</div>
      <div class="progress progress--timer">
        <div class="progress-fill" id="progress-el" style="width:${(timer / DILEMMA_VOTE_TIMER_SEC) * 100}%"></div>
      </div>
      ${voteTapHtml()}
      ${host ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-pause">${paused ? "Reprendre" : "Pause"}</button>` : ""}
      <p class="hint">${voteHint}${canChangeVote() ? " · Tu peux changer ton vote avant la fin du chrono." : ""}</p>`;
  }

  function canChangeVote() {
    return phase === "voting" && timer > 0 && !paused && !isEveningGameplayPaused();
  }

  function render() {
    syncFromSession();
    const total = ROUNDS.length;
    let phaseHtml = "";

    if (phase === "voting") phaseHtml = votingPhaseHtml();
    if (phase === "reveal") phaseHtml = revealHtml();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <div class="game-header">
          <div class="dots">${ROUNDS.map((_, i) =>
            `<span class="dot ${i === roundIdx ? "dot--active" : i < roundIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${roundIdx + 1}/${total}</span>
        </div>
        <div class="logo logo--sm"><h1>DILEMMA</h1></div>
        ${dilemmaCardHtml()}
        ${phaseHtml}
      `,
    });

    bindNav(app);
    bindExitGameToLobby(app);

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
            await commitDilemmaPlay({ votes: { ...votes } });
          } finally {
            voteCommitInFlight = null;
            syncFromSession();
          }
        } else {
          if (!intervalId) startVoteTimer();
        }
        render();
      });
    });

    app.querySelector("#btn-pause")?.addEventListener("click", async () => {
      if (!paused) {
        paused = true;
        clearTimer();
        await setDilemmaPausedBy(localName);
      } else {
        paused = false;
        await clearDilemmaPause();
        if (phase === "voting") startVoteTimer();
      }
      render();
    });

    app.querySelector("#next-round")?.addEventListener("click", () => {
      void advanceRound();
    });

    if (phase === "voting" && !intervalId && timer > 0 && !paused) startVoteTimer();

    if (phase === "reveal" && !revealAnimDone && revealPctA === 0 && revealPctB === 0) {
      const { pctA, pctB } = countDilemmaResults(votes);
      animateRevealBars(pctA, pctB);
    }
  }

  const unsub = onGameSessionChange(() => {
    const prevPhase = phase;
    syncFromSession();
    if (!currentDilemma && ROUNDS[roundIdx]) currentDilemma = ROUNDS[roundIdx];
    if (phase === "voting" && prevPhase !== "voting") {
      clearTimer();
      revealAnimDone = false;
      timer = secondsUntil(getDilemmaSession().voteEndsAt) ?? DILEMMA_VOTE_TIMER_SEC;
      if (!paused) startVoteTimer();
    }
    if (phase === "reveal" && prevPhase !== "reveal") {
      clearTimer();
      revealAnimDone = false;
      revealPctA = 0;
      revealPctB = 0;
      if (!lastAward) lastAward = { ...countDilemmaResults(votes) };
      render();
      const { pctA, pctB } = countDilemmaResults(votes);
      animateRevealBars(pctA, pctB);
    }
    render();
  });

  render();

  return () => {
    clearTimer();
    unsub();
  };
}
