import { CONSENSUS_DEFAULT_SLIDER_VALUE, CONSENSUS_REVEAL_PENDING_MS } from "../../data/consensus.js";
import { formatConsensusScore } from "../core/consensusSession.js";
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
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
// FIL_ROUGE (Mot interdit) — pause soirée ; isEveningGameplayPaused() = false si désactivé
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
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

function bindConsensusSlider(app, { onInput, disabled = false } = {}) {
  const input = app.querySelector("#consensus-slider");
  const wrap = input?.closest(".truth-meter__slider-wrap");
  if (!input || !wrap) return;
  input.disabled = disabled;
  if (disabled) {
    wrap.classList.add("consensus-slider--locked");
    return;
  }
  wrap.classList.remove("consensus-slider--locked");

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
      // On ne capture pas tout de suite : on attend de savoir si le geste est
      // horizontal (réglage du slider) ou vertical (scroll de la page).
      const startX = event.clientX;
      const startY = event.clientY;
      const DRAG_THRESHOLD = 6;
      let mode = "pending";

      function cleanup() {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
      }

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (mode === "pending") {
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
          if (Math.abs(dy) > Math.abs(dx)) {
            mode = "scroll";
            cleanup();
            return;
          }
          mode = "drag";
          input.setPointerCapture?.(moveEvent.pointerId);
        }
        if (moveEvent.cancelable) moveEvent.preventDefault();
        setFromClientX(moveEvent.clientX);
      };
      const onUp = (upEvent) => {
        if (mode === "drag") input.releasePointerCapture?.(upEvent.pointerId);
        else if (mode === "pending") setFromClientX(upEvent.clientX);
        cleanup();
      };
      const onCancel = () => cleanup();

      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
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
  let npcTimers = [];
  let npcRoundKey = "";
  let revealInFlight = false;
  let revealPendingInFlight = false;
  let revealPendingTimeoutId = null;
  let roundKey = "";
  let draftValue = CONSENSUS_DEFAULT_SLIDER_VALUE;
  let renderTimer = null;
  let lastQuestionRenderKey = "";
  let lastRenderedPhase = "";
  let lastRenderedQuestionIdx = -1;

  const localName = getLocalDisplayName();
  const mp = isGameSyncActive();

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

  async function beginReveal() {
    const livePhase = consensus.getSession().phase;
    if (livePhase !== "question") return;
    if (!mp) {
      clearRevealPending();
      await goToReveal();
      return;
    }
    await goToRevealPending();
  }

  function scheduleRevealFromPending() {
    if (revealPendingTimeoutId || revealInFlight || phase !== "reveal-pending") return;
    if (mp && !isLobbyHost()) return;
    revealPendingTimeoutId = setTimeout(() => {
      revealPendingTimeoutId = null;
      void goToReveal();
    }, CONSENSUS_REVEAL_PENDING_MS);
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
    const questionIdxNow = session.questionIdx ?? 0;
    const roundChanged = nextRoundKey !== roundKey;
    phase = session.phase || "question";
    questionIdx = questionIdxNow;
    currentQuestion = session.currentQuestion || null;
    answers = { ...(session.answers || {}) };
    matchScores = { ...(session.matchScores || {}) };
    lastRound = session.lastRound || null;
    if (roundChanged) {
      const mine = session.answers?.[localName];
      draftValue = consensus.isAnswerForRound(mine, questionIdxNow)
        ? consensus.clampValue(mine.value)
        : CONSENSUS_DEFAULT_SLIDER_VALUE;
      roundKey = nextRoundKey;
      lastQuestionRenderKey = "";
    }
    return roundChanged;
  }

  function shouldScrollToTop() {
    return (
      phase !== lastRenderedPhase ||
      (phase === "question" && questionIdx !== lastRenderedQuestionIdx)
    );
  }

  function scrollPageToTop() {
    const scrollEl = app.querySelector(".page--scroll");
    if (scrollEl) scrollEl.scrollTop = 0;
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
      app.scrollTop = 0;
    }
  }

  function questionRenderKey(session) {
    const qIdx = session.questionIdx ?? 0;
    const answeredCount = getActivePlayers().filter((p) =>
      consensus.isAnswerForRound(session.answers?.[p.name], qIdx)
    ).length;
    return [
      phase,
      questionIdx,
      session.currentQuestion?.id || "",
      answerState(),
      answeredCount,
    ].join("|");
  }

  function patchQuestionPhaseChrome(session) {
    const qIdx = session.questionIdx ?? 0;
    const answeredCount = getActivePlayers().filter((p) =>
      consensus.isAnswerForRound(session.answers?.[p.name], qIdx)
    ).length;
    const totalPlayers = getActivePlayers().length;
    const forceBtn = app.querySelector("#btn-consensus-force");
    if (forceBtn) {
      forceBtn.textContent = `Révéler maintenant (${answeredCount}/${totalPlayers})`;
    }
    const boardHost = app.querySelector("[data-consensus-live-board]");
    if (boardHost) {
      const standings = consensus.getPodiumAwards(
        consensus.buildStandings(matchScores || session.matchScores || {})
      );
      boardHost.innerHTML = renderConsensusScoreboard({
        standings,
        title: "Classement de la partie",
      });
    }
  }

  function scheduleRender({ force = false, scrollTop = false } = {}) {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    if (force) {
      if (scrollTop) {
        lastRenderedPhase = "";
        lastRenderedQuestionIdx = -1;
      }
      render();
      return;
    }
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render();
    }, 100);
  }

  function myAnswer() {
    return answers[localName] || null;
  }

  function answerState() {
    return consensus.isAnswerForRound(myAnswer(), questionIdx) ? "submitted" : "draft";
  }

  function waitingMessage() {
    if (phase !== "question") return "";
    const mine = myAnswer();
    if (consensus.isAnswerForRound(mine, questionIdx)) {
      return consensus.allAnswersIn()
        ? "Tout le monde a répondu. Révélation en cours…"
        : "Réponse enregistrée — en attente des autres joueurs…";
    }
    return "Choisis une valeur entre 0 et 100 puis valide.";
  }

  async function commitLocalDraft({ submitted = false } = {}) {
    const value = consensus.clampValue(draftValue);
    await consensus.commitAnswer(value, { submitted });
    answers = { ...(consensus.getSession().answers || {}) };
  }

  async function fillMissingLocalAnswers() {
    const session = consensus.getSession();
    const questionIdxNow = session.questionIdx ?? 0;
    const nextAnswers = { ...(session.answers || {}) };
    if (!consensus.isAnswerForRound(nextAnswers[localName], questionIdxNow)) {
      nextAnswers[localName] = {
        value: consensus.clampValue(draftValue),
        timestamp: Date.now(),
        submittedAt: Date.now(),
        questionIdx: questionIdxNow,
        imputed: false,
      };
    }
    getActivePlayers()
      .filter((player) => !player.isLocal)
      .forEach((player, index) => {
        if (consensus.isAnswerForRound(nextAnswers[player.name], questionIdxNow)) return;
        nextAnswers[player.name] = {
          value: buildNpcConsensusAnswer(session.currentQuestion, index),
          timestamp: Date.now(),
          submittedAt: Date.now(),
          questionIdx: questionIdxNow,
          imputed: false,
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
          const qIdx = live.questionIdx ?? 0;
          if (consensus.isAnswerForRound((live.answers || {})[player.name], qIdx)) return;
          const nextAnswers = {
            ...(live.answers || {}),
            [player.name]: {
              value: buildNpcConsensusAnswer(live.currentQuestion, index),
              timestamp: Date.now(),
              submittedAt: Date.now(),
              questionIdx: qIdx,
              imputed: false,
            },
          };
          await consensus.commitPlay({
            ...live,
            answers: nextAnswers,
          });
          if (consensus.allAnswersIn()) {
            await beginReveal();
          } else {
            render();
          }
        }, delayMs);
        npcTimers.push(timeoutId);
      });
  }

  async function syncRevealToRemote(revealSession) {
    if (!mp) {
      saveStatePatch({ consensusGame: revealSession });
      return;
    }
    await consensus.commitReveal(revealSession);
  }

  async function goToRevealPending() {
    const live = consensus.getSession();
    if (live.phase === "reveal" || live.phase === "final") return;
    if (live.phase === "reveal-pending") {
      scheduleRevealFromPending();
      return;
    }
    if (revealInFlight || revealPendingInFlight) return;
    revealPendingInFlight = true;
    try {
      if (mp) {
        await consensus.commitPhase("reveal-pending");
      } else {
        saveStatePatch({
          consensusGame: { ...consensus.getSession(), phase: "reveal-pending" },
        });
      }
    } catch (err) {
      console.warn("Consensus reveal-pending:", err);
      saveStatePatch({
        consensusGame: { ...consensus.getSession(), phase: "reveal-pending" },
      });
      if (mp && isLobbyHost()) {
        void consensus.commitPhase("reveal-pending").catch(() => {});
        await showAppAlert(
          "La sync est lente — la révélation continue chez toi. Les autres peuvent avoir un léger retard.",
          { title: "Connexion", icon: "📡" }
        );
      }
    } finally {
      revealPendingInFlight = false;
    }
    syncFromSession();
    render();
    scheduleRevealFromPending();
  }

  /** Filet de sécurité hôte : clôt la manche même si un joueur n'a pas validé sa réponse. */
  async function forceReveal() {
    if (mp && !isLobbyHost()) return;
    if (!mp) {
      await fillMissingLocalAnswers();
    } else {
      await commitLocalDraft({ submitted: true });
    }
    await beginReveal();
  }

  async function goToReveal() {
    if (revealInFlight) return;
    const live = consensus.getSession();
    if (live.phase !== "question" && live.phase !== "reveal-pending") return;
    revealInFlight = true;
    clearNpcTimers();
    clearRevealPending();
    let syncFailed = false;
    try {
      if (mp) {
        await refreshGameSession().catch(() => null);
      }
      const scored = consensus.scoreRound(consensus.getSession());
      const revealSession = { ...scored, phase: "reveal" };
      saveStatePatch({ consensusGame: revealSession });
      syncFromSession();
      try {
        await syncRevealToRemote(revealSession);
      } catch (err) {
        syncFailed = true;
        console.warn("Consensus reveal sync:", err);
        if (mp && isLobbyHost()) {
          void syncRevealToRemote(revealSession).catch(() => {});
        }
      }
    } catch (err) {
      syncFailed = true;
      console.warn("Consensus reveal:", err);
      const fallback = consensus.scoreRound(consensus.getSession());
      saveStatePatch({ consensusGame: { ...fallback, phase: "reveal" } });
      syncFromSession();
      if (mp && isLobbyHost()) {
        void syncRevealToRemote(consensus.getSession()).catch(() => {});
      }
    } finally {
      revealInFlight = false;
      if (syncFailed && mp && isLobbyHost()) {
        await showAppAlert(
          "Les résultats s'affichent chez toi. Si les autres sont bloqués, vérifiez la connexion puis relancez une manche.",
          { title: "Sync révélation", icon: "📡" }
        );
      }
      render();
    }
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
    if (live.podiumApplied) {
      if (mp && isLobbyHost()) {
        await completeGameSession({
          gameId: "consensus",
          screen: "consensus",
          state: { consensus: consensusToRemote(live) },
        });
      }
      return;
    }

    let standings = consensus.getPodiumAwards(consensus.buildStandings(live.matchScores || {}));

    if (!mp || isLobbyHost()) {
      const claimed = {
        ...live,
        phase: "final",
        podiumApplied: true,
      };
      if (mp) {
        await consensus.commitPlay(claimed);
      } else {
        saveStatePatch({ consensusGame: claimed });
      }

      standings = consensus.applyLobbyPodium(consensus.getSession());
      recordConsensusPlayed();
      setLastGame({
        gameId: "consensus",
        title: "Consensus",
        summary: `${standings.length} joueur(s) · gagnant : ${standings[0]?.name || "-"}`,
      });
    }

    const finalSession = {
      ...consensus.getSession(),
      phase: "final",
      podiumApplied: true,
    };

    clearNpcTimers();
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
    const roundChanged = syncFromSession();
    if (!roundChanged) captureDraftFromDom();
    const session = consensus.getSession();
    const totalQuestions = session.deck?.length || 0;
    const standings = consensus.getPodiumAwards(
      consensus.buildStandings(matchScores || session.matchScores || {})
    );

    if (phase === "question") {
      const qKey = questionRenderKey(session);
      if (qKey === lastQuestionRenderKey && app.querySelector("#consensus-slider")) {
        patchQuestionPhaseChrome(session);
        return;
      }
      lastQuestionRenderKey = qKey;
    } else {
      lastQuestionRenderKey = "";
    }

    const scrollEl = app.querySelector(".page--scroll");
    const scrollToTop = shouldScrollToTop();
    const scrollTop = scrollToTop ? 0 : scrollEl?.scrollTop ?? 0;

    let phaseHtml = "";
    if (phase === "question") {
      const qIdx = session.questionIdx ?? 0;
      const answeredCount = getActivePlayers().filter((p) =>
        consensus.isAnswerForRound(session.answers?.[p.name], qIdx)
      ).length;
      const totalPlayers = getActivePlayers().length;
      phaseHtml = `
        ${renderConsensusQuestion({
          question: currentQuestion,
          questionIdx,
          totalQuestions,
          value: draftValue,
          answerState: answerState(),
          answerLocked: answerState() === "submitted",
          waitingMessage: waitingMessage(),
        })}
        <div data-consensus-live-board>
          ${renderConsensusScoreboard({
            standings,
            title: "Classement de la partie",
          })}
        </div>
        ${
          !mp || isLobbyHost()
            ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-consensus-force">
                Révéler maintenant (${answeredCount}/${totalPlayers})
              </button>`
            : ""
        }`;
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
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);

    const newScrollEl = app.querySelector(".page--scroll");
    if (newScrollEl) newScrollEl.scrollTop = scrollTop;
    if (scrollToTop) {
      requestAnimationFrame(() => scrollPageToTop());
    }
    lastRenderedPhase = phase;
    lastRenderedQuestionIdx = questionIdx;

    if (phase === "question") {
      const answerLocked = answerState() === "submitted";
      bindConsensusSlider(app, {
        disabled: answerLocked,
        onInput: (value) => {
          draftValue = value;
        },
      });
      app.querySelector("#btn-consensus-submit")?.addEventListener("click", async () => {
        if (answerState() === "submitted") return;
        await commitLocalDraft({ submitted: true });
        if (consensus.allAnswersIn() && (!mp || isLobbyHost())) {
          await beginReveal();
        } else {
          render();
        }
      });
      app.querySelector("#btn-consensus-force")?.addEventListener("click", () => {
        void forceReveal();
      });
    }

    app.querySelector("#btn-consensus-next")?.addEventListener("click", async () => {
      if (questionIdx < totalQuestions - 1) {
        await consensus.startQuestion(questionIdx + 1);
        render();
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
    } else {
      clearNpcTimers();
    }
  }

  function shouldSkipFullRender(prevPhase, prevQuestion) {
    if (phase !== prevPhase || questionIdx !== prevQuestion) return false;
    if (phase === "reveal-pending") return true;
    if (phase === "question") {
      const session = consensus.getSession();
      return questionRenderKey(session) === lastQuestionRenderKey;
    }
    return false;
  }

  const unsub = onGameSessionChange(() => {
    const prevPhase = phase;
    const prevQuestion = questionIdx;
    const roundChanged = syncFromSession();
    if (!roundChanged) captureDraftFromDom();
    if (
      phase === "question" &&
      isLobbyHost() &&
      consensus.allAnswersIn() &&
      !revealInFlight &&
      !revealPendingInFlight &&
      !revealPendingTimeoutId
    ) {
      void beginReveal();
    }
    if (phase === "reveal-pending") {
      scheduleRevealFromPending();
    }
    if (shouldSkipFullRender(prevPhase, prevQuestion)) {
      if (phase === "question") patchQuestionPhaseChrome(consensus.getSession());
      return;
    }
    const phaseChanged = prevPhase !== phase;
    const questionChanged =
      phase === "question" && questionIdx !== lastRenderedQuestionIdx;
    scheduleRender({
      force: phaseChanged || phase !== "question",
      scrollTop: phaseChanged || questionChanged,
    });
  });

  render();

  if (mp && isLobbyHost() && consensus.getSession().phase === "reveal-pending") {
    scheduleRevealFromPending();
  }

  return () => {
    clearNpcTimers();
    clearRevealPending();
    if (renderTimer) clearTimeout(renderTimer);
    unsub();
  };
}
