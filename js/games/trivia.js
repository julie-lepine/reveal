import { getTriviaThemeLabel } from "../../data/trivia.js";
import { useTriviaGame } from "../core/useTriviaGame.js";
import { deriveTriviaCurrentQuestion } from "../core/triviaPlayPatch.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { createActionLock, withClickLock } from "../core/actionLock.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { getActivePlayers } from "../core/players.js";
import { formatWinnersLabel } from "../core/competitionRank.js";
import { serializeLastGameStandings } from "../core/lastGamePodium.js";
import { triviaEveningPoints } from "../core/triviaScoring.js";
import { goToGameSelect, setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { getLocalDisplayName, recordTriviaPlayed, saveStatePatch, setLastGame } from "../core/state.js";
import { showAppAlert } from "../core/dialog.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell, resetPageScroll } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import {
  completeGameSession,
  isGameSyncActive,
  isLobbyHost,
  canActAsHost,
  onGameSessionChange,
  getActingHostUiRefreshToken,
  needsActingHostUiRefresh,
  returnToGameSelect,
  startGameSession,
  stopGameSessionListenerOnPostGame,
  triviaToRemote,
} from "../core/gameSync.js";
import { renderTriviaQuestion } from "../trivia/TriviaQuestion.js";
import { renderTriviaScoreboard } from "../trivia/TriviaScoreboard.js";
import { arch03AhLogSkipDecision } from "../core/arch03ActingHostDebug.js";
import {
  resolveLocalTriviaAnswerIndex,
  resolveConfirmedTriviaAnswerIndex,
  nextPendingAnswerAfterCommit,
  buildTriviaAnswerWaitingMessage,
} from "../core/triviaAnswerUi.js";
import { getSupabaseUserId } from "../core/supabaseAuth.js";
import { mapTriviaAnswerRpcError } from "../core/triviaRevealErrors.js";

export function mountTrivia(app) {
  if (!requireLobbyPlay()) return null;

  const trivia = useTriviaGame();
  const entry = trivia.getEntryScreen();
  if (entry !== "trivia") {
    navigate(entry);
    return null;
  }

  if (trivia.getSession().phase !== "final") {
    void setLobbyPlaying("trivia").catch(() => {});
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
  let finishInFlight = false;
  let eveningPodiumApplied = false;
  let answerCommitInFlight = false;
  let pendingAnswerIndex = null;
  /** Dernier envoi a échoué - pending conservé, hint honnête (01C). */
  let answerCommitFailed = false;
  let sessionRunId = trivia.getSession().runId || null;
  const replayLaunchLock = createActionLock();

  const mount = createMountGuard();
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
    currentQuestion = deriveTriviaCurrentQuestion(
      session.deck,
      questionIdx,
      session.currentQuestion || null
    );
    answers = { ...(session.answers || {}) };
    matchScores = { ...(session.matchScores || {}) };
    lastRound = session.lastRound || null;
  }

  function myAnswerIndex() {
    return resolveLocalTriviaAnswerIndex({
      pendingAnswerIndex,
      answers,
      localName,
      localUid: getSupabaseUserId() || null,
    });
  }

  function myConfirmedAnswerIndex() {
    return resolveConfirmedTriviaAnswerIndex({
      answers,
      localName,
      localUid: getSupabaseUserId() || null,
    });
  }

  function clearAnswerCommitUi({ keepPending = false } = {}) {
    answerCommitFailed = false;
    answerCommitInFlight = false;
    if (!keepPending) pendingAnswerIndex = null;
  }

  function waitingMessage() {
    return buildTriviaAnswerWaitingMessage({
      phase,
      answerCommitInFlight,
      confirmedIndex: myConfirmedAnswerIndex(),
      pendingAnswerIndex,
      answerCommitFailed,
      allAnswersIn: trivia.allAnswersIn(),
    });
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
          if (!mount.isMounted()) return;
          if (!mount.isCurrentMount()) return;
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
          if (!mount.isMounted()) return;
          if (!mount.isCurrentMount()) return;
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
    const initial = trivia.getSession();
    if (initial.phase !== "question") return;
    revealInFlight = true;
    clearNpcTimers();
    try {
      if (mp && canActAsHost()) {
        await trivia.commitRevealPlay();
      } else if (!mp) {
        const scored = trivia.scoreRound(initial);
        saveStatePatch({
          triviaGame: { ...scored, phase: "reveal" },
        });
      }
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      syncFromSession();
      render();
    } catch (err) {
      console.warn("REVEAL trivia goToReveal:", err);
      syncFromSession();
      await showAppAlert(err?.message || "Révélation impossible. Réessaie.", {
        title: "Trivia",
        icon: "🧠",
      });
      if (mount.isMounted() && mount.isCurrentMount()) render();
    } finally {
      revealInFlight = false;
    }
  }

  /** Filet de sécurité hôte : clôt la manche même si un joueur (AFK/déconnecté) n'a pas répondu. */
  async function forceReveal() {
    if (mp && !canActAsHost()) return;
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
    const correctLabel = currentQuestion?.answers?.[currentQuestion.correct] != null
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

  /**
   * Relance MP via startGameSession - alerte hôte si échec, pas de patch local anticipé.
   * @returns {Promise<boolean>} true si la session distante a démarré
   */
  async function startTriviaRemoteRestart(screen, triviaSession) {
    try {
      await startGameSession("trivia", screen, {
        trivia: triviaToRemote(triviaSession),
      });
      clearAnswerCommitUi();
      return true;
    } catch (err) {
      console.warn("REVEAL trivia restart session:", err);
      await showAppAlert("Impossible de relancer Trivia pour le moment. Réessaie.", {
        title: "Trivia",
        icon: "🧠",
      });
      return false;
    }
  }

  async function openTriviaSetup(configSession) {
    const outcome = await replayLaunchLock.run(async () => {
      if (mp) {
        if (!isLobbyHost()) {
          await showAppAlert("Seul l'hote peut relancer le quiz.", {
            title: "Action reservee",
            icon: "👑",
          });
          return;
        }
        const ok = await startTriviaRemoteRestart("trivia-prep", configSession);
        if (!ok) return;
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
        navigate("trivia-prep", {
          navStack: ["home", "lobby", "game-select", "trivia-prep"],
        });
        return;
      }

      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      saveStatePatch({ triviaGame: configSession });
      clearAnswerCommitUi();
      navigate("trivia-prep", {
        navStack: ["home", "lobby", "game-select", "trivia-prep"],
      });
    });
    return outcome;
  }

  async function replayTrivia() {
    const outcome = await replayLaunchLock.run(async () => {
      const replaySession = trivia.buildReplaySession(trivia.getSession());
      // MP : ne pas persister le deck local avant confirmation startGameSession (01C).
      const started = trivia.createStartedSession(replaySession, {
        persistDeck: !mp,
      });
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
        await startTriviaRemoteRestart("trivia", started.session);
        return;
      }

      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      saveStatePatch({ triviaGame: started.session });
      clearAnswerCommitUi();
      await setLobbyPlaying("trivia");
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      navigate("trivia", {
        navStack: ["home", "lobby", "game-select", "trivia"],
      });
    });
    return outcome;
  }

  async function finishTriviaGame() {
    if (finishInFlight) return;
    if (mp && !canActAsHost()) return;

    finishInFlight = true;
    clearNpcTimers();
    try {
      // Scoring podium conservé ; affichage podium déplacé vers l'écran résultats.
      if (mp) {
        const live = trivia.getSession();
        if (!live.podiumApplied) {
          await trivia.commitFinalPlay();
        }
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
        syncFromSession();
        if (!eveningPodiumApplied) {
          const standings = trivia.applyLobbyPodium(trivia.getSession());
          recordTriviaPlayed();
          setLastGame({
            gameId: "trivia",
            title: "Trivia Quiz",
            summary: `${standings.length} joueur(s) · ${formatWinnersLabel(standings)}`,
            standings: serializeLastGameStandings(
              standings.map((p) => ({
                ...p,
                score: triviaEveningPoints(p),
              }))
            ),
          });
          eveningPodiumApplied = true;
        }
      } else if (!eveningPodiumApplied) {
        const live = trivia.getSession();
        const scoredSession = {
          ...live,
          phase: "final",
          podiumApplied: true,
        };
        saveStatePatch({ triviaGame: scoredSession });
        const standings = trivia.applyLobbyPodium(scoredSession);
        recordTriviaPlayed();
        setLastGame({
          gameId: "trivia",
          title: "Trivia Quiz",
          summary: `${standings.length} joueur(s) · ${formatWinnersLabel(standings)}`,
          standings: serializeLastGameStandings(
            standings.map((p) => ({
              ...p,
              score: triviaEveningPoints(p),
            }))
          ),
        });
        eveningPodiumApplied = true;
      }

      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      await showEveningResults();
    } catch (err) {
      console.warn("REVEAL trivia finishTriviaGame:", err);
      syncFromSession();
      await showAppAlert("Impossible de terminer la partie. Réessaie.", {
        title: "Trivia",
        icon: "🧠",
      });
      if (mount.isMounted() && mount.isCurrentMount()) render();
    } finally {
      finishInFlight = false;
    }
  }

  async function showEveningResults() {
    const finalSession = {
      ...trivia.getSession(),
      phase: "final",
      podiumApplied: true,
    };

    clearNpcTimers();

    if (mp) {
      if (!canActAsHost()) return;
      try {
        await completeGameSession({
          gameId: "trivia",
          screen: "results",
          state: { trivia: triviaToRemote(finalSession) },
        });
      } catch (e) {
        console.warn("REVEAL completeGameSession:", e);
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
        navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
      }
      return;
    }

    await setLobbyWaiting();
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    saveStatePatch({ triviaGame: finalSession });
    navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
  }

  function render() {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    syncFromSession();
    if (Number.isInteger(myConfirmedAnswerIndex())) {
      answerCommitFailed = false;
    }
    const session = trivia.getSession();
    const totalQuestions = session.deck?.length || 0;
    const standings = session.results?.standings || trivia.getPodiumAwards(trivia.buildStandings(matchScores));
    const scoreTitle = phase === "reveal" ? "Classement en direct" : "Classement temps reel";

    let phaseHtml = "";
    if (phase === "question") {
      const answeredCount = trivia.countAnswersIn();
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
          locked: answerCommitInFlight,
          waitingMessage: waitingMessage(),
        })}
        <div data-trivia-live-board>
          ${renderTriviaScoreboard({
            standings,
            title: scoreTitle,
          })}
        </div>
        ${
          !mp || canActAsHost()
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
        <div class="reveal-mid-action">
        ${
          !mp || canActAsHost()
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-trivia-next">
                ${questionIdx < totalQuestions - 1 ? "Question suivante →" : "Voir les résultats →"}
              </button>`
            : `<p class="hint">En attente de l'hote pour la suite…</p>`
        }
        </div>
        ${renderTriviaScoreboard({
          standings,
          title: "Classement en direct",
          deltaMap: lastRound?.deltas || {},
        })}`;
    } else {
      // Legacy : session encore en phase final → bascule vers résultats.
      phaseHtml = `
        <div class="card card--highlight trivia-results">
          <p class="label-upper label-upper--gold">🧠 Trivia Quiz</p>
          <h3 class="section-title">Partie terminée</h3>
          <p class="hint">Le podium s'affiche dans les résultats de la soirée.</p>
          ${
            !mp || canActAsHost()
              ? `<button type="button" class="btn btn-primary btn--spaced" data-trivia-action="show-results">Voir les résultats</button>`
              : `<p class="hint">En attente de l'hote pour afficher les resultats...</p>`
          }
          ${
            !mp || isLobbyHost()
              ? `<div class="btn-row trivia-results__actions">
                  <button type="button" class="btn btn-secondary" data-trivia-action="replay">Rejouer</button>
                  <button type="button" class="btn btn-accent" data-trivia-action="change-theme">Changer theme</button>
                </div>`
              : ""
          }
        </div>`;
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
          if (trivia.getSession().phase !== "question") return;
          if (answerCommitInFlight) return;
          const choice = Number(btn.getAttribute("data-trivia-answer"));
          if (!Number.isInteger(choice)) return;
          console.info("[TRIVIA_ANSWER_CLICK]", {
            choice,
            phase: trivia.getSession().phase,
            inFlight: answerCommitInFlight,
            pending: pendingAnswerIndex,
            selected: myAnswerIndex(),
          });
          const confirmedRemote = resolveLocalTriviaAnswerIndex({
            pendingAnswerIndex: null,
            answers: trivia.getSession().answers || {},
            localName,
            localUid: getSupabaseUserId() || null,
          });
          if (confirmedRemote === choice) return;

          answerCommitFailed = false;
          pendingAnswerIndex = choice;
          answerCommitInFlight = true;
          render();

          let commitOk = false;
          try {
            console.info("[TRIVIA_ANSWER_SUBMIT_START]", {
              choice,
              phase: trivia.getSession().phase,
              runId: trivia.getSession().runId,
              questionIdx: trivia.getSession().questionIdx,
            });
            await trivia.commitAnswer(choice);
            commitOk = true;
            answerCommitFailed = false;
            console.info("[TRIVIA_ANSWER_RPC_SUCCESS]", { choice });
            if (!mount.isMounted()) return;
            if (!mount.isCurrentMount()) return;
            syncFromSession();
          } catch (err) {
            console.warn("[TRIVIA_ANSWER_RPC_ERROR]", err?.code || err?.message || err);
            answerCommitFailed = true;
            if (mount.isMounted() && mount.isCurrentMount()) syncFromSession();
            const mapped = mapTriviaAnswerRpcError(err);
            const message =
              mapped?.message ||
              "Impossible d'enregistrer ta réponse. Réessaie.";
            await showAppAlert(message, { title: "Trivia", icon: "🧠" });
          } finally {
            if (mount.isMounted() && mount.isCurrentMount()) {
              syncFromSession();
              const confirmed = resolveConfirmedTriviaAnswerIndex({
                answers,
                localName,
                localUid: getSupabaseUserId() || null,
              });
              pendingAnswerIndex = nextPendingAnswerAfterCommit({
                commitOk,
                pendingAnswerIndex: choice,
                confirmedIndex: confirmed,
              });
              if (commitOk) answerCommitFailed = false;
              answerCommitInFlight = false;
              render();
            } else {
              answerCommitInFlight = false;
            }
          }
        });
      });      app.querySelector("#btn-trivia-force")?.addEventListener("click", () => {
        void forceReveal().catch((err) => {
          console.warn("REVEAL trivia forceReveal:", err);
        });
      });
    }

    app.querySelector("#btn-trivia-next")?.addEventListener("click", withClickLock(async () => {
      try {
        if (questionIdx < totalQuestions - 1) {
          await trivia.startQuestion(questionIdx + 1);
          if (!mount.isMounted()) return;
          if (!mount.isCurrentMount()) return;
          syncFromSession();
          render();
          return;
        }
        await finishTriviaGame();
      } catch (err) {
        console.warn("REVEAL trivia next question:", err);
        syncFromSession();
        await showAppAlert("Impossible de passer à la question suivante. Réessaie.", {
          title: "Trivia",
          icon: "🧠",
        });
        if (mount.isMounted() && mount.isCurrentMount()) render();
      }
    }));

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
          return;
        }
        if (action === "show-results") {
          await showEveningResults();
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

  function shouldSkipFullRender(prevPhase, prevQuestion) {
    if (phase !== prevPhase || questionIdx !== prevQuestion) return false;
    return phase === "question" || phase === "reveal";
  }

  function patchQuestionChrome() {
    const session = trivia.getSession();
    const standings = trivia.getPodiumAwards(
      trivia.buildStandings(matchScores || session.matchScores || {})
    );
    const board = app.querySelector("[data-trivia-live-board]");
    if (board) {
      board.innerHTML = renderTriviaScoreboard({
        standings,
        title: phase === "reveal" ? "Classement en direct" : "Classement temps reel",
        deltaMap: phase === "reveal" ? lastRound?.deltas || {} : {},
      });
    }
    const answeredCount = trivia.countAnswersIn();
    const forceBtn = app.querySelector("#btn-trivia-force");
    if (forceBtn) {
      forceBtn.textContent = `Révéler maintenant (${answeredCount}/${getActivePlayers().length})`;
    }
  }

  let lastAckedActingHostToken = getActingHostUiRefreshToken();

  const unsub = onGameSessionChange((row) => {
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    if (stopGameSessionListenerOnPostGame(row, { cleanup: clearNpcTimers })) return;

    const prevPhase = phase;
    const prevQuestion = questionIdx;
    const prevRunId = sessionRunId;
    const ahTokenNow = getActingHostUiRefreshToken();
    const actingHostUiRefresh = needsActingHostUiRefresh(
      lastAckedActingHostToken,
      ahTokenNow
    );
    syncFromSession();
    sessionRunId = trivia.getSession().runId || null;
    if (
      prevQuestion !== questionIdx ||
      prevPhase !== phase ||
      prevRunId !== sessionRunId
    ) {
      clearAnswerCommitUi();
    }
    const skipFull = shouldSkipFullRender(prevPhase, prevQuestion);
    arch03AhLogSkipDecision("trivia", {
      decision: skipFull && !actingHostUiRefresh ? "skip-full-render" : "full-render",
      skipFull,
      actingHostUiRefresh,
      canActAsHost: canActAsHost(),
      phase,
    });
    if (skipFull && !actingHostUiRefresh) {
      patchQuestionChrome();
      return;
    }
    render();
    lastAckedActingHostToken = ahTokenNow;
  });

  render();
  lastAckedActingHostToken = getActingHostUiRefreshToken();

  return () => {
    mount.dispose();
    clearNpcTimers();
    clearAnswerCommitUi();
    unsub();
  };
}
