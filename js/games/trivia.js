import { getTriviaThemeLabel } from "../../data/trivia.js";
import { useTriviaGame } from "../core/useTriviaGame.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { getActivePlayers } from "../core/players.js";
import { goToGameSelect, setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { getLocalDisplayName, recordTriviaPlayed, saveStatePatch, setLastGame } from "../core/state.js";
import { showAppAlert } from "../core/dialog.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell, resetPageScroll } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import {
  completeGameSession,
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  returnToGameSelect,
  startGameSession,
  triviaToRemote,
} from "../core/gameSync.js";
import { renderTriviaQuestion } from "../trivia/TriviaQuestion.js";
import { renderTriviaResults } from "../trivia/TriviaResults.js";
import { renderTriviaScoreboard } from "../trivia/TriviaScoreboard.js";

export function mountTrivia(app) {
  if (!requireLobbyPlay()) return null;

  const trivia = useTriviaGame();
  const entry = trivia.getEntryScreen();
  if (entry !== "trivia") {
    navigate(entry);
    return null;
  }

  if (trivia.getSession().phase !== "final") {
    void setLobbyPlaying("trivia");
  }

  let phase = "question";
  let questionIdx = 0;
  let currentQuestion = null;
  let answers = {};
  let matchScores = {};
  let lastRound = null;
  let npcTimers = [];
  let npcRoundKey = "";
  let revealInFlight = false;

  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();

  function clearNpcTimers() {
    npcTimers.forEach((timerId) => clearTimeout(timerId));
    npcTimers = [];
    npcRoundKey = "";
  }

  function syncFromSession() {
    const session = trivia.getSession();
    phase = session.phase || "question";
    questionIdx = session.questionIdx ?? 0;
    currentQuestion = session.currentQuestion || null;
    answers = { ...(session.answers || {}) };
    matchScores = { ...(session.matchScores || {}) };
    lastRound = session.lastRound || null;
  }

  function myAnswerIndex() {
    return answers[localName]?.answerIndex ?? null;
  }

  function waitingMessage() {
    if (phase !== "question") return "";
    if (myAnswerIndex() != null) {
      return trivia.allAnswersIn()
        ? "Tout le monde a répondu. Révélation en cours…"
        : "En attente des autres joueurs… tu peux encore changer ta réponse.";
    }
    return "Choisis ta réponse. Tu peux la modifier tant que tout le monde n'a pas répondu.";
  }

  function pickNpcAnswerIndex(question) {
    const wrong = (question.answers || []).map((_, idx) => idx).filter((idx) => idx !== question.correct);
    if (Math.random() < 0.55 || !wrong.length) return question.correct;
    return wrong[Math.floor(Math.random() * wrong.length)];
  }

  async function fillMissingLocalAnswers() {
    const session = trivia.getSession();
    const nextAnswers = { ...(session.answers || {}) };
    getActivePlayers()
      .filter((player) => !player.isLocal)
      .forEach((player) => {
        if (nextAnswers[player.name]) return;
        nextAnswers[player.name] = {
          answerIndex: pickNpcAnswerIndex(session.currentQuestion),
          answeredAt: Date.now(),
        };
      });
    await trivia.commitPlay({ ...session, answers: nextAnswers });
  }

  function scheduleLocalNpcAnswers() {
    clearNpcTimers();
    const session = trivia.getSession();
    const roundKey = `${session.questionIdx}:${session.currentQuestion?.id || "none"}`;
    npcRoundKey = roundKey;
    getActivePlayers()
      .filter((player) => !player.isLocal)
      .forEach((player, idx) => {
        const delayMs = 1800 + idx * 650 + Math.floor(Math.random() * 2600);
        const timeoutId = setTimeout(async () => {
          const live = trivia.getSession();
          if (live.phase !== "question") return;
          if ((live.answers || {})[player.name]) return;
          const nextAnswers = {
            ...(live.answers || {}),
            [player.name]: {
              answerIndex: pickNpcAnswerIndex(live.currentQuestion),
              answeredAt: Date.now(),
            },
          };
          await trivia.commitPlay({ ...live, answers: nextAnswers });
          if (trivia.allAnswersIn()) {
            await goToReveal();
            return;
          }
          render();
        }, delayMs);
        npcTimers.push(timeoutId);
      });
  }

  async function goToReveal() {
    if (revealInFlight) return;
    const live = trivia.getSession();
    if (live.phase !== "question") return;
    revealInFlight = true;
    const session = trivia.scoreRound(live);
    clearNpcTimers();
    try {
      await trivia.commitPlay({
        ...session,
        phase: "reveal",
        questionEndsAt: null,
      });
    } finally {
      revealInFlight = false;
    }
  }

  /** Filet de sécurité hôte : clôt la manche même si un joueur (AFK/déconnecté) n'a pas répondu. */
  async function forceReveal() {
    if (mp && !isLobbyHost()) return;
    if (!mp) await fillMissingLocalAnswers();
    await goToReveal();
  }

  function localRevealFeedbackHtml() {
    const mine = myAnswerIndex();
    const correctIdx = lastRound?.correctIndex ?? currentQuestion?.correct;
    if (mine == null || !Number.isInteger(correctIdx)) {
      return `<p class="hint">Tu n'as pas répondu à cette question.</p>`;
    }

    const isCorrect = mine === correctIdx;
    const myLabel = currentQuestion?.answers?.[mine] || "-";
    const delta = lastRound?.deltas?.[localName] || 0;
    const isFastest = lastRound?.fastestPlayer === localName;

    let pointsLine = "";
    if (isCorrect && delta > 0) {
      pointsLine = isFastest
        ? `<p class="trivia-your-result__points">+${delta} pts <span class="muted">(bonne réponse + bonus vitesse)</span></p>`
        : `<p class="trivia-your-result__points">+${delta} pts</p>`;
    } else if (!isCorrect) {
      pointsLine = `<p class="trivia-your-result__points trivia-your-result__points--none">Aucun point cette manche</p>`;
    }

    return `
      <div class="trivia-your-result ${isCorrect ? "trivia-your-result--ok" : "trivia-your-result--ko"}">
        <p class="trivia-your-result__title">${isCorrect ? "Bonne réponse !" : "Mauvaise réponse"}</p>
        ${
          isCorrect
            ? `<p class="hint">Tu as trouvé : <strong>${escapeHtml(myLabel)}</strong></p>`
            : `<p class="hint">Tu as choisi <strong>${escapeHtml(myLabel)}</strong></p>`
        }
        ${pointsLine}
      </div>`;
  }

  function revealBlock() {
    const correctLabel = currentQuestion
      ? `${String.fromCharCode(65 + currentQuestion.correct)}. ${currentQuestion.answers[currentQuestion.correct]}`
      : "-";
    const deltas = lastRound?.deltas || {};
    const deltaRows = Object.entries(deltas).sort(([, a], [, b]) => b - a);

    return `
      ${localRevealFeedbackHtml()}
      <div class="card trivia-reveal-card">
        <p class="card-heading">Bonne réponse</p>
        <p class="trivia-reveal-card__answer">${escapeHtml(correctLabel)}</p>
        <p class="hint">
          ${
            lastRound?.fastestPlayer
              ? `Bonus vitesse : ${escapeHtml(lastRound.fastestPlayer)}`
              : "Personne n'a trouvé la bonne réponse à temps."
          }
        </p>
        ${
          deltaRows.length
            ? `<div class="trivia-delta-list">
              ${deltaRows
                .map(
                  ([name, delta]) => `
                <div class="trivia-delta-list__row">
                  <span>${escapeHtml(name)}</span>
                  <strong>+${delta}</strong>
                </div>`
                )
                .join("")}
            </div>`
            : '<p class="hint">Aucun point distribué sur cette question.</p>'
        }
      </div>`;
  }

  async function openTriviaSetup(configSession) {
    if (mp) {
      if (!isLobbyHost()) {
        await showAppAlert("Seul l'hote peut relancer le quiz.", {
          title: "Action reservee",
          icon: "👑",
        });
        return;
      }
      await startGameSession("trivia", "trivia-prep", {
        trivia: triviaToRemote(configSession),
      });
      navigate("trivia-prep", {
        navStack: ["home", "lobby", "game-select", "trivia-prep"],
      });
      return;
    }

    saveStatePatch({ triviaGame: configSession });
    navigate("trivia-prep", {
      navStack: ["home", "lobby", "game-select", "trivia-prep"],
    });
  }

  async function replayTrivia() {
    const replaySession = trivia.buildReplaySession(trivia.getSession());
    const started = trivia.createStartedSession(replaySession);
    if (!started.ok) {
      await showAppAlert(
        `Il manque ${started.missing} question(s) pour rejouer ${started.requested} manche(s) sur le theme ${started.themeLabel}.`,
        {
          title: "Banque insuffisante",
          icon: "🧠",
        }
      );
      return;
    }

    if (mp) {
      if (!isLobbyHost()) {
        await showAppAlert("Seul l'hote peut relancer le quiz.", {
          title: "Action reservee",
          icon: "👑",
        });
        return;
      }
      await startGameSession("trivia", "trivia", {
        trivia: triviaToRemote(started.session),
      });
    } else {
      saveStatePatch({ triviaGame: started.session });
      await setLobbyPlaying("trivia");
      navigate("trivia", {
        navStack: ["home", "lobby", "game-select", "trivia"],
      });
    }
  }

  async function finishTriviaGame() {
    const live = trivia.getSession();
    if (live.podiumApplied) {
      if (mp && isLobbyHost()) {
        await completeGameSession({
          gameId: "trivia",
          screen: "trivia",
          state: { trivia: triviaToRemote(live) },
        });
      }
      return;
    }

    let standings = trivia.getPodiumAwards(trivia.buildStandings(live.matchScores || {}));

    if (!mp || isLobbyHost()) {
      const claimed = {
        ...live,
        phase: "final",
        questionEndsAt: null,
        podiumApplied: true,
      };
      if (mp) {
        await trivia.commitPlay(claimed);
      } else {
        saveStatePatch({ triviaGame: claimed });
      }

      standings = trivia.applyLobbyPodium(trivia.getSession());
      recordTriviaPlayed();
      setLastGame({
        gameId: "trivia",
        title: "Trivia Quiz",
        summary: `${standings.length} joueur(s) · gagnant : ${standings[0]?.name || "-"}`,
      });
    }

    const finalSession = {
      ...trivia.getSession(),
      phase: "final",
      questionEndsAt: null,
      podiumApplied: true,
      results: { standings },
    };

    clearNpcTimers();

    if (mp && isLobbyHost()) {
      await completeGameSession({
        gameId: "trivia",
        screen: "trivia",
        state: { trivia: triviaToRemote(finalSession) },
      });
      return;
    }

    if (!mp) {
      await setLobbyWaiting();
      saveStatePatch({ triviaGame: finalSession });
      render();
    }
  }

  function render() {
    syncFromSession();
    const session = trivia.getSession();
    const totalQuestions = session.deck?.length || 0;
    const standings = session.results?.standings || trivia.getPodiumAwards(trivia.buildStandings(matchScores));
    const scoreTitle = phase === "reveal" ? "Classement en direct" : "Classement temps reel";

    let phaseHtml = "";
    if (phase === "question") {
      const answeredCount = Object.values(answers).filter(
        (a) => a && Number.isInteger(a.answerIndex)
      ).length;
      const totalPlayers = getActivePlayers().length;
      phaseHtml = `
        ${renderTriviaQuestion({
          question: {
            ...currentQuestion,
            themeLabel: getTriviaThemeLabel(currentQuestion?.theme),
          },
          questionIdx,
          totalQuestions,
          selectedAnswer: myAnswerIndex(),
          waitingMessage: waitingMessage(),
        })}
        ${renderTriviaScoreboard({
          standings,
          title: scoreTitle,
        })}
        ${
          !mp || isLobbyHost()
            ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-trivia-force">
                Révéler maintenant (${answeredCount}/${totalPlayers})
              </button>`
            : ""
        }`;
    } else if (phase === "reveal") {
      const correctIdx = lastRound?.correctIndex ?? currentQuestion?.correct;
      phaseHtml = `
        ${renderTriviaQuestion({
          question: {
            ...currentQuestion,
            themeLabel: getTriviaThemeLabel(currentQuestion?.theme),
          },
          questionIdx,
          totalQuestions,
          selectedAnswer: myAnswerIndex(),
          revealed: true,
          correctIndex: correctIdx,
        })}
        ${revealBlock()}
        ${renderTriviaScoreboard({
          standings,
          title: "Classement en direct",
          deltaMap: lastRound?.deltas || {},
        })}
        ${
          !mp || isLobbyHost()
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-trivia-next">
                ${questionIdx < totalQuestions - 1 ? "Question suivante →" : "Voir le podium →"}
              </button>`
            : `<p class="hint">En attente de l'hote pour la suite…</p>`
        }`;
    } else {
      phaseHtml = renderTriviaResults({
        standings,
        themeLabel: getTriviaThemeLabel(session.selectedThemeId),
      });
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      scroll: true,
      content: `
        <div class="game-header">
          <div class="dots">
            ${(session.deck || [])
              .map(
                (_, idx) => `
              <span class="dot ${idx === questionIdx ? "dot--active" : idx < questionIdx ? "dot--done" : ""}"></span>`
              )
              .join("")}
          </div>
          <span class="muted">${Math.min(questionIdx + 1, Math.max(totalQuestions, 1))}/${Math.max(totalQuestions, 1)}</span>
        </div>
        <div class="logo logo--sm"><h1>TRIVIA</h1></div>
        ${phaseHtml}
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);
    resetPageScroll(app);

    if (phase === "question") {
      app.querySelectorAll("[data-trivia-answer]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (trivia.getSession().phase !== "question" || isEveningGameplayPaused()) return;
          await trivia.commitAnswer(Number(btn.getAttribute("data-trivia-answer")));
          if (trivia.allAnswersIn() && (!mp || isLobbyHost())) {
            await goToReveal();
            return;
          }
          render();
        });
      });
      app.querySelector("#btn-trivia-force")?.addEventListener("click", () => {
        void forceReveal();
      });
    }

    app.querySelector("#btn-trivia-next")?.addEventListener("click", async () => {
      if (questionIdx < totalQuestions - 1) {
        await trivia.startQuestion(questionIdx + 1);
        return;
      }
      await finishTriviaGame();
    });

    app.querySelectorAll("[data-trivia-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-trivia-action");
        if (action === "replay") {
          await replayTrivia();
          return;
        }
        if (action === "change-theme") {
          await openTriviaSetup(trivia.buildReplaySession(trivia.getSession()));
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
      const roundKey = `${session.questionIdx}:${session.currentQuestion?.id || "none"}`;
      if (!mp && roundKey !== npcRoundKey) {
        scheduleLocalNpcAnswers();
      }
    } else {
      clearNpcTimers();
    }
  }

  const unsub = onGameSessionChange(() => {
    syncFromSession();
    if (phase === "question" && isLobbyHost() && trivia.allAnswersIn()) {
      void goToReveal();
      return;
    }
    render();
  });

  render();

  return () => {
    clearNpcTimers();
    unsub();
  };
}
