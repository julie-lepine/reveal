import { CONSENSUS_REVEAL_PENDING_MS } from "../../data/consensus.js";
import {
  CONSENSUS_TIMER_SEC,
  formatConsensusScore,
} from "../core/consensusSession.js";
import { useConsensusGame } from "../core/useConsensusGame.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { getActivePlayers } from "../core/players.js";
import { goToGameSelect, setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import {
  getLocalDisplayName,
  recordConsensusPlayed,
  saveStatePatch,
  setLastGame,
} from "../core/state.js";
import { showAppAlert } from "../core/dialog.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import { onTimerSecond, primeTimerSound } from "../core/timerSound.js";
import {
  completeGameSession,
  consensusToRemote,
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  refreshGameSession,
  returnToGameSelect,
  startGameSession,
} from "../core/gameSync.js";
import { renderConsensusQuestion } from "../consensus/ConsensusQuestion.js";
import { renderConsensusResults } from "../consensus/ConsensusResults.js";
import { renderConsensusScoreboard } from "../consensus/ConsensusScoreboard.js";

function secondsUntil(iso) {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
}

function questionKeyOf(session) {
  return `${session.questionIdx ?? 0}:${session.currentQuestion?.id || "none"}`;
}

function hashQuestion(question) {
  const raw = `${question?.id || ""}:${question?.question || ""}`;
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) % 100000;
  }
  return hash;
}

function buildNpcConsensusAnswer(question, playerIndex = 0) {
  const seed = hashQuestion(question) + playerIndex * 17;
  const base = 18 + (seed % 65);
  const cluster = Math.random() < 0.45 ? Math.round(base / 5) * 5 : base;
  const noise = Math.floor(Math.random() * 19) - 9;
  return Math.max(0, Math.min(100, Math.round(cluster + noise)));
}

function bindConsensusSlider(app, { onInput } = {}) {
  const input = app.querySelector("#consensus-slider");
  const wrap = input?.closest(".truth-meter__slider-wrap");
  if (!input || !wrap) return;

  const pctEl = app.querySelector("#consensus-slider-pct");
  const update = () => {
    const value = Number(input.value);
    if (pctEl) pctEl.textContent = `${value}%`;
    onInput?.(value);
  };

  const setFromClientX = (clientX) => {
    const rect = input.getBoundingClientRect();
    if (!rect.width) return;
    const pct = Math.round(((clientX - rect.left) / rect.width) * 100);
    input.value = String(Math.max(0, Math.min(100, pct)));
    update();
  };

  if (input.dataset.bound !== "1") {
    input.dataset.bound = "1";
    input.addEventListener("input", update);
    input.addEventListener("change", update);
  }

  if (wrap.dataset.dragBound !== "1") {
    wrap.dataset.dragBound = "1";
    wrap.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      event.preventDefault();
      input.setPointerCapture?.(event.pointerId);
      setFromClientX(event.clientX);

      const onMove = (moveEvent) => {
        if (moveEvent.cancelable) moveEvent.preventDefault();
        setFromClientX(moveEvent.clientX);
      };
      const onUp = (upEvent) => {
        input.releasePointerCapture?.(upEvent.pointerId);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
      };

      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  }

  update();
}

function finalConsensusResultsHtml({ standings = [] } = {}) {
  const winner = standings[0] || null;
  return `
    <div class="card card--highlight consensus-final">
      <p class="label-upper label-upper--gold">🤝 Consensus</p>
      <h3 class="section-title">Podium final</h3>
      ${
        winner
          ? `<p class="hint consensus-final__summary">👑 <strong>${escapeHtml(winner.name)}</strong> remporte la partie et gagne <strong>+${winner.lobbyBonus} pts lobby</strong>.</p>`
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
            <span class="trivia-results__score">${formatConsensusScore(player.score)} pts</span>
            <span class="trivia-results__bonus">${
              player.rank === 1
                ? `👑 +${player.lobbyBonus} pts lobby`
                : player.lobbyBonus > 0
                  ? `+${player.lobbyBonus} pts lobby`
                  : "0 pt lobby"
            }</span>
          </div>`
          )
          .join("")}
      </div>
      <div class="btn-row consensus-final__actions">
        <button type="button" class="btn btn-primary" data-consensus-action="replay">Rejouer</button>
        <button type="button" class="btn btn-accent" data-consensus-action="change-settings">Changer réglages</button>
      </div>
      <button type="button" class="btn btn-secondary btn--spaced" data-consensus-action="back-select">Retour au menu des jeux</button>
    </div>`;
}

export function mountConsensus(app) {
  if (!requireLobbyPlay()) return null;

  const consensus = useConsensusGame();
  const entry = consensus.getEntryScreen();
  if (entry !== "consensus") {
    navigate(entry);
    return null;
  }

  if (consensus.getSession().phase !== "final") {
    void setLobbyPlaying("consensus");
  }

  let phase = "question";
  let questionIdx = 0;
  let currentQuestion = null;
  let answers = {};
  let matchScores = {};
  let lastRound = null;
  let timer = CONSENSUS_TIMER_SEC;
  let intervalId = null;
  let npcTimers = [];
  let npcRoundKey = "";
  let revealInFlight = false;
  let revealPendingTimeoutId = null;
  let roundKey = "";
  let draftValue = 50;

  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();

  function clearTimer() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function clearNpcTimers() {
    npcTimers.forEach((timerId) => clearTimeout(timerId));
    npcTimers = [];
    npcRoundKey = "";
  }

  function clearRevealPending() {
    if (revealPendingTimeoutId) {
      clearTimeout(revealPendingTimeoutId);
      revealPendingTimeoutId = null;
    }
  }

  function captureDraftFromDom() {
    const slider = app.querySelector("#consensus-slider");
    if (slider && phase === "question") {
      draftValue = consensus.clampValue(slider.value);
    }
  }

  function syncFromSession() {
    const session = consensus.getSession();
    const nextRoundKey = questionKeyOf(session);
    phase = session.phase || "question";
    questionIdx = session.questionIdx ?? 0;
    currentQuestion = session.currentQuestion || null;
    answers = { ...(session.answers || {}) };
    matchScores = { ...(session.matchScores || {}) };
    lastRound = session.lastRound || null;
    if (phase === "question" && session.questionEndsAt) {
      timer = secondsUntil(session.questionEndsAt) ?? timer;
    }
    if (nextRoundKey !== roundKey) {
      draftValue = session.answers?.[localName]?.value ?? 50;
      roundKey = nextRoundKey;
    }
  }

  function myAnswer() {
    return answers[localName] || null;
  }

  function answerState() {
    return myAnswer()?.submittedAt ? "submitted" : "draft";
  }

  function waitingMessage() {
    if (phase !== "question") return "";
    const mine = myAnswer();
    if (mine?.submittedAt) {
      return consensus.allAnswersIn()
        ? "Tout le monde a répondu. Tu peux encore ajuster jusqu'à la fin du chrono."
        : "Réponse envoyée. Tu peux encore ajuster jusqu'à la fin du chrono.";
    }
    return "Choisis une valeur entre 0 et 100 puis valide. Jusqu'à la fin du chrono, tu peux encore ajuster.";
  }

  async function commitLocalDraft({ submitted = false } = {}) {
    const value = consensus.clampValue(draftValue);
    await consensus.commitAnswer(value, { submitted });
    answers = { ...(consensus.getSession().answers || {}) };
  }

  async function fillMissingLocalAnswers() {
    const session = consensus.getSession();
    const nextAnswers = { ...(session.answers || {}) };
    nextAnswers[localName] = {
      value: consensus.clampValue(draftValue),
      timestamp: Date.now(),
      submittedAt: nextAnswers[localName]?.submittedAt || Date.now(),
    };
    getActivePlayers()
      .filter((player) => !player.isLocal)
      .forEach((player, index) => {
        if (Number.isFinite(nextAnswers[player.name]?.value)) return;
        nextAnswers[player.name] = {
          value: buildNpcConsensusAnswer(session.currentQuestion, index),
          timestamp: Date.now(),
          submittedAt: Date.now(),
        };
      });
    await consensus.commitPlay({
      ...session,
      answers: nextAnswers,
    });
  }

  function scheduleLocalNpcAnswers() {
    clearNpcTimers();
    const session = consensus.getSession();
    const nextRoundKey = questionKeyOf(session);
    npcRoundKey = nextRoundKey;

    getActivePlayers()
      .filter((player) => !player.isLocal)
      .forEach((player, index) => {
        const delayMs = 1600 + index * 550 + Math.floor(Math.random() * 2200);
        const timeoutId = setTimeout(async () => {
          const live = consensus.getSession();
          if (live.phase !== "question") return;
          if (Number.isFinite((live.answers || {})[player.name]?.value)) return;
          const nextAnswers = {
            ...(live.answers || {}),
            [player.name]: {
              value: buildNpcConsensusAnswer(live.currentQuestion, index),
              timestamp: Date.now(),
              submittedAt: Date.now(),
            },
          };
          await consensus.commitPlay({
            ...live,
            answers: nextAnswers,
          });
        }, delayMs);
        npcTimers.push(timeoutId);
      });
  }

  async function goToRevealPending() {
    if (revealInFlight) return;
    clearTimer();
    clearRevealPending();
    if (mp) {
      await consensus.commitPlay({
        phase: "reveal-pending",
        questionEndsAt: null,
      });
    } else {
      await consensus.commitPlay({
        phase: "reveal-pending",
        questionEndsAt: null,
      });
      render();
      revealPendingTimeoutId = setTimeout(() => {
        revealPendingTimeoutId = null;
        void goToReveal();
      }, CONSENSUS_REVEAL_PENDING_MS);
    }
  }

  async function goToReveal() {
    if (revealInFlight) return;
    const live = consensus.getSession();
    if (live.phase !== "question" && live.phase !== "reveal-pending") return;
    revealInFlight = true;
    clearNpcTimers();
    clearTimer();
    try {
      if (mp) {
        await refreshGameSession();
      }
      const scored = consensus.scoreRound(consensus.getSession());
      await consensus.commitPlay({
        ...scored,
        phase: "reveal",
        questionEndsAt: null,
      });
      if (!mp) render();
    } finally {
      revealInFlight = false;
    }
  }

  async function startQuestionTimer() {
    clearTimer();
    primeTimerSound();
    intervalId = setInterval(async () => {
      if (isEveningGameplayPaused()) return;
      const live = consensus.getSession();
      if (live.phase !== "question") {
        clearTimer();
        return;
      }
      timer = secondsUntil(live.questionEndsAt) ?? 0;
      onTimerSecond({ remaining: timer, urgentAt: 3 });

      const timerEl = app.querySelector("#consensus-timer-el");
      if (timerEl) {
        timerEl.textContent = String(timer);
        timerEl.classList.toggle("timer--urgent", timer <= 3);
      }
      const progressEl = app.querySelector("#consensus-progress-el");
      if (progressEl) {
        progressEl.style.width = `${(timer / CONSENSUS_TIMER_SEC) * 100}%`;
      }

      if (timer > 0) return;
      clearTimer();
      if (!mp) {
        await fillMissingLocalAnswers();
        await goToRevealPending();
      } else {
        await commitLocalDraft({ submitted: true });
        if (isLobbyHost()) {
          await refreshGameSession();
          if (consensus.allAnswersIn()) {
            await goToRevealPending();
            return;
          }
          render();
        }
      }
    }, 1000);
  }

  async function openConsensusSetup(configSession) {
    if (mp) {
      if (!isLobbyHost()) {
        await showAppAlert("Seul l'hôte peut modifier les réglages.", {
          title: "Action réservée",
          icon: "👑",
        });
        return;
      }
      await startGameSession("consensus", "consensus-prep", {
        consensus: consensusToRemote(configSession),
      });
      navigate("consensus-prep", {
        navStack: ["home", "lobby", "game-select", "consensus-prep"],
      });
      return;
    }

    saveStatePatch({ consensusGame: configSession });
    navigate("consensus-prep", {
      navStack: ["home", "lobby", "game-select", "consensus-prep"],
    });
  }

  async function replayConsensus() {
    const replaySession = consensus.buildReplaySession(consensus.getSession());
    const started = consensus.createStartedSession(replaySession);
    if (!started.ok) {
      await showAppAlert(
        `Il manque ${started.missing} question(s) pour relancer ${started.requested} manche(s).`,
        {
          title: "Banque insuffisante",
          icon: "🤝",
        }
      );
      return;
    }

    if (mp) {
      if (!isLobbyHost()) {
        await showAppAlert("Seul l'hôte peut relancer la partie.", {
          title: "Action réservée",
          icon: "👑",
        });
        return;
      }
      await startGameSession("consensus", "consensus", {
        consensus: consensusToRemote(started.session),
      });
    } else {
      saveStatePatch({ consensusGame: started.session });
      await setLobbyPlaying("consensus");
      navigate("consensus", {
        navStack: ["home", "lobby", "game-select", "consensus"],
      });
    }
  }

  async function finishConsensusGame() {
    const live = consensus.getSession();
    let standings = consensus.getPodiumAwards(consensus.buildStandings(live.matchScores || {}));

    if (!live.podiumApplied && (!mp || isLobbyHost())) {
      standings = consensus.applyLobbyPodium(live);
      recordConsensusPlayed();
      setLastGame({
        gameId: "consensus",
        title: "Consensus",
        summary: `${standings.length} joueur(s) · gagnant : ${standings[0]?.name || "-"}`,
      });
    }

    const finalSession = {
      ...live,
      phase: "final",
      questionEndsAt: null,
      podiumApplied: true,
    };

    clearNpcTimers();
    clearTimer();
    clearRevealPending();

    if (mp && isLobbyHost()) {
      await completeGameSession({
        gameId: "consensus",
        screen: "consensus",
        state: { consensus: consensusToRemote(finalSession) },
      });
      return;
    }

    if (!mp) {
      await setLobbyWaiting();
      saveStatePatch({ consensusGame: finalSession });
      render();
    }
  }

  function render() {
    syncFromSession();
    const session = consensus.getSession();
    const totalQuestions = session.deck?.length || 0;
    const standings = consensus.getPodiumAwards(
      consensus.buildStandings(matchScores || session.matchScores || {})
    );

    let phaseHtml = "";
    if (phase === "question") {
      phaseHtml = `
        ${renderConsensusQuestion({
          question: currentQuestion,
          questionIdx,
          totalQuestions,
          value: draftValue,
          timer,
          totalTime: CONSENSUS_TIMER_SEC,
          answerState: answerState(),
          waitingMessage: waitingMessage(),
        })}
        ${renderConsensusScoreboard({
          standings,
          title: "Classement de la partie",
        })}`;
    } else if (phase === "reveal-pending") {
      phaseHtml = `
        <div class="truth-meter__suspense consensus-pending">
          <p class="truth-meter__suspense-title">Le groupe se révèle…</p>
          <p class="hint">On compare toutes les réponses pour faire émerger la perception collective.</p>
          <div class="truth-meter__suspense-pulse" aria-hidden="true"></div>
        </div>`;
    } else if (phase === "reveal") {
      phaseHtml = `
        ${renderConsensusResults({
          question: currentQuestion,
          answers,
          lastRound,
          players: getActivePlayers(),
        })}
        ${renderConsensusScoreboard({
          standings,
          title: "Classement en direct",
          deltaMap: lastRound?.deltas || {},
        })}
        ${
          !mp || isLobbyHost()
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-consensus-next">
                ${questionIdx < totalQuestions - 1 ? "Question suivante →" : "Voir le podium →"}
              </button>`
            : `<p class="hint">En attente de l'hôte pour la suite…</p>`
        }`;
    } else {
      phaseHtml = `
        ${finalConsensusResultsHtml({ standings })}
        ${renderConsensusScoreboard({
          standings,
          title: "Classement final Consensus",
        })}`;
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      scroll: true,
      content: `
        <div class="game-header">
          <div class="dots">
            ${(session.deck || [])
              .map(
                (_, index) => `
              <span class="dot ${index === questionIdx ? "dot--active" : index < questionIdx ? "dot--done" : ""}"></span>`
              )
              .join("")}
          </div>
          <span class="muted">${Math.min(questionIdx + 1, Math.max(totalQuestions, 1))}/${Math.max(totalQuestions, 1)}</span>
        </div>
        <div class="logo logo--sm"><h1>CONSENSUS</h1></div>
        ${phaseHtml}
      `,
    });

    bindNav(app);

    if (phase === "question") {
      bindConsensusSlider(app, {
        onInput: (value) => {
          draftValue = value;
        },
      });
      app.querySelector("#btn-consensus-submit")?.addEventListener("click", async () => {
        await commitLocalDraft({ submitted: true });
        render();
      });
    }

    app.querySelector("#btn-consensus-next")?.addEventListener("click", async () => {
      if (questionIdx < totalQuestions - 1) {
        await consensus.startQuestion(questionIdx + 1);
        if (!mp) render();
        return;
      }
      await finishConsensusGame();
    });

    app.querySelectorAll("[data-consensus-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-consensus-action");
        if (action === "replay") {
          await replayConsensus();
          return;
        }
        if (action === "change-settings") {
          await openConsensusSetup(consensus.buildReplaySession(consensus.getSession()));
          return;
        }
        if (action === "back-select") {
          if (mp) {
            await returnToGameSelect();
          } else {
            await goToGameSelect();
          }
        }
      });
    });

    if (phase === "question") {
      const nextRoundKey = questionKeyOf(session);
      if (!mp && nextRoundKey !== npcRoundKey) {
        scheduleLocalNpcAnswers();
      }
      if (!intervalId && timer > 0) {
        void startQuestionTimer();
      }
    } else {
      clearNpcTimers();
      clearTimer();
    }
  }

  const unsub = onGameSessionChange(() => {
    const prevPhase = phase;
    const prevRoundKey = roundKey;
    captureDraftFromDom();
    syncFromSession();
    if (
      phase === "question" &&
      isLobbyHost() &&
      timer <= 0 &&
      consensus.allAnswersIn()
    ) {
      void goToRevealPending();
      return;
    }
    if (phase === "question" && prevPhase !== "question") {
      clearTimer();
      timer = secondsUntil(consensus.getSession().questionEndsAt) ?? CONSENSUS_TIMER_SEC;
    }
    if (phase === "question" && prevPhase === "question" && prevRoundKey === roundKey) {
      return;
    }
    if (phase === "reveal-pending" && prevPhase !== "reveal-pending" && isLobbyHost()) {
      clearRevealPending();
      revealPendingTimeoutId = setTimeout(() => {
        revealPendingTimeoutId = null;
        void goToReveal();
      }, CONSENSUS_REVEAL_PENDING_MS);
    }
    render();
  });

  render();

  return () => {
    clearNpcTimers();
    clearTimer();
    clearRevealPending();
    unsub();
  };
}
