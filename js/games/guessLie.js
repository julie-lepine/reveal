import {
  GUESS_LIE_DETECTIVE_POINTS,
  GUESS_LIE_LIAR_POINTS,
} from "../../data/guessLies.js";
import {
  commitGuessLieVote,
  getGuessLieRounds,
  simulateRoundVotes,
  getGuessLieSession,
} from "../core/guessLieSession.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  commitGuessLiePlay,
  getActiveMemberUserIds,
  nameForUserId,
  completeGameSession,
} from "../core/gameSync.js";
import { getLocalDisplayName, recordGuessLieRoundStats, recordGuessLiePlayed, setLastGame } from "../core/state.js";
import { awardGuessLieRound, guessLieLiarWins } from "../core/scoring.js";
import { gameCumulativeScoresHtml, refreshGameScoresBox } from "../core/gameScores.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
// FIL_ROUGE (Mot interdit) - pause soirée ; isEveningGameplayPaused() = false si désactivé
import { isEveningGameplayPaused } from "../core/filRougeSession.js";

function revealFeedbackTitle({ isSubject, myCorrect, liarBonus }) {
  if (isSubject) return liarBonus ? "Mensonge non trouvé 🥳" : "Mensonge trouvé 😭";
  return myCorrect ? "Mensonge trouvé 🥳" : "Mensonge non trouvé 😭";
}

export function mountGuessLie(app) {
  if (!requireLobbyPlay()) return null;

  const rounds = getGuessLieRounds();
  if (!rounds.length) {
    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--green">🕵️ Guess The Lie</p>
        <h2 class="screen-title">Partie indisponible</h2>
        <p class="hint">Les affirmations du lobby ne sont pas encore prêtes.</p>
        <button type="button" class="btn btn-secondary btn--spaced" data-nav="guesslie-wait">Retour au salon</button>
      `,
    });
    bindNav(app);
    return null;
  }

  setLobbyPlaying("guesslie");

  const mp = isGameSyncActive();

  let roundIdx = 0;
  let phase = "voting";
  let selected = null;
  let roundScored = false;
  let revealResult = null;
  let revealAdvancing = false;
  const localName = getLocalDisplayName();

  function currentRound() {
    return rounds[roundIdx] ?? rounds[0];
  }

  function detectiveNamesForRound(round) {
    return getActiveMemberUserIds()
      .map((uid) => nameForUserId(uid))
      .filter((n) => n && n !== round.player);
  }

  function allDetectivesVoted(votes, round) {
    const detectives = detectiveNamesForRound(round);
    return detectives.length > 0 && detectives.every((n) => votes[n] != null);
  }

  function countDetectiveVotes(votes, round) {
    return detectiveNamesForRound(round).filter((n) => votes[n] != null).length;
  }

  async function transitionToReveal() {
    const gl = getGuessLieSession();
    if (roundScored || gl.roundScored) {
      if (!revealResult) setRevealDisplay(computeReveal());
      return;
    }
    if (mp && !isLobbyHost()) return;

    const result = computeReveal();
    const { correct, round, liarBonus } = result;
    const lieDetected = correct.length > 0;
    const recordStats = gl.statsRecordedRoundIdx !== roundIdx;

    roundScored = true;

    awardGuessLieRound({
      correct,
      liarName: round.player,
      liarBonus,
    });

    if (recordStats && (!mp || isLobbyHost())) {
      recordGuessLieRoundStats(lieDetected);
    }

    await commitGuessLiePlay(
      {
        phase: "reveal",
        roundScored: true,
        ...(recordStats ? { statsRecordedRoundIdx: roundIdx } : {}),
      },
      { withEveningScores: mp && isLobbyHost() }
    );

    setRevealDisplay(result);
  }

  async function tryAdvanceToReveal() {
    if (!mp || phase !== "voting" || revealAdvancing) return;
    const gl = getGuessLieSession();
    const votes = gl.votes || {};
    const round = currentRound();
    if (!allDetectivesVoted(votes, round) || !isLobbyHost()) return;
    if (gl.roundScored || roundScored) return;
    revealAdvancing = true;
    try {
      await transitionToReveal();
      render();
    } finally {
      revealAdvancing = false;
    }
  }

  function ensureRevealDisplay() {
    if (phase !== "reveal") return;
    if (!revealResult) setRevealDisplay(computeReveal());
  }

  function syncFromGl() {
    const gl = getGuessLieSession();
    if (gl.roundIdx != null) roundIdx = gl.roundIdx;
    if (gl.phase) phase = gl.phase;
    if (gl.votes && gl.votes[localName] != null) selected = gl.votes[localName];
    roundScored = Boolean(gl.roundScored);
  }

  function computeReveal() {
    const round = currentRound();
    const gl = getGuessLieSession();
    const all = mp
      ? { ...(gl.votes || {}) }
      : { ...simulateRoundVotes(round, round.player) };
    if (selected !== null && localName !== round.player) all[localName] = selected;
    const voters = Object.keys(all).filter((n) => n !== round.player);
    const correct = voters.filter((n) => all[n] === round.lie);
    const ratio = voters.length ? correct.length / voters.length : 0;
    const liarBonus = guessLieLiarWins(correct.length, voters.length);
    return { all, correct, ratio, round, liarBonus };
  }

  function setRevealDisplay(result) {
    revealResult = { ...result, all: result.all };
  }

  /** Filet de sécurité hôte : clôt la manche même si un détective n'a pas voté. */
  async function forceReveal() {
    if (mp && !isLobbyHost()) return;
    if (getGuessLieSession().roundScored || roundScored) return;
    if (mp) {
      if (revealAdvancing || phase !== "voting") return;
      revealAdvancing = true;
      try {
        await transitionToReveal();
        render();
      } finally {
        revealAdvancing = false;
      }
    } else {
      phase = "reveal";
      await transitionToReveal();
      render();
    }
  }

  function beginRound() {
    phase = "voting";
    selected = null;
    roundScored = false;
    revealResult = null;
    render();
  }

  async function nextRound() {
    if (mp && !isLobbyHost()) return;

    if (roundIdx >= rounds.length - 1) {
      if (!mp || isLobbyHost()) {
        recordGuessLiePlayed();
      }
      setLastGame({
        gameId: "guesslie",
        title: "Guess The Lie",
        summary: `${rounds.length} manches jouées`,
      });
      if (mp) {
        try {
          await completeGameSession({ gameId: "guesslie", screen: "results", state: {} });
        } catch (e) {
          console.warn("REVEAL completeGameSession:", e);
          navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
        }
      } else {
        setLobbyWaiting();
        navigate("results");
      }
      return;
    }
    const next = roundIdx + 1;
    if (mp) {
      roundIdx = next;
      phase = "voting";
      selected = null;
      roundScored = false;
      revealResult = null;
      await commitGuessLiePlay(
        { roundIdx: next, phase: "voting", votes: {}, roundScored: false },
        { screen: "guesslie" }
      );
      render();
    } else {
      roundIdx = next;
      beginRound();
    }
  }

  function render() {
    syncFromGl();
    ensureRevealDisplay();

    const round = currentRound();
    const total = rounds.length;
    if (!round) {
      app.innerHTML = pageShell({
        backTarget: "back",
        content: `
          <p class="label-upper label-upper--green">🕵️ Guess The Lie</p>
          <p class="hint">Chargement de la manche…</p>`,
      });
      bindNav(app);
      return;
    }

    const isSubject = round.player === localName;
    let body = "";

    if (phase === "voting") {
      const statementsBlock = `
        <p class="game-intro">Manche de <strong>${escapeHtml(round.player)}</strong></p>
        <p class="hint">${isSubject ? "🎭 Tu es le menteur - les détectives votent." : "Quelle affirmation est le mensonge ?"}</p>`;

      if (isSubject) {
        const lieLetter = String.fromCharCode(65 + round.lie);
        body = `
          ${statementsBlock}
          <div class="statements statements--readonly">
            ${round.statements
              .map(
                (text, i) => `
              <div class="statement statement--readonly">
                <span class="statement__letter">${String.fromCharCode(65 + i)}</span>
                <span>${escapeHtml(text)}</span>
              </div>`
              )
              .join("")}
          </div>
          <div class="liar-stage" aria-live="polite">
            <div class="liar-stage__pulse"></div>
            <p class="liar-stage__badge">🎭 Tu es le menteur</p>
            <p class="liar-stage__title">Les détectives votent…</p>
            <p class="liar-stage__secret">Ton mensonge : <strong>lettre ${lieLetter}</strong></p>
            <div class="liar-stage__detectives">
              <span class="liar-detective liar-detective--1">🕵️</span>
              <span class="liar-detective liar-detective--2">🔍</span>
              <span class="liar-detective liar-detective--3">👀</span>
            </div>
            <div class="liar-stage__scan"></div>
          </div>`;
      } else {
        const votes = getGuessLieSession().votes || {};
        const committedVote = votes[localName];
        const displayPick = selected !== null ? selected : committedVote;
        const detectivesDone = allDetectivesVoted(votes, round);
        const hasPendingChange = selected !== null && selected !== committedVote;
        const voteHint = !committedVote && selected == null
          ? "Choisis la lettre du mensonge."
          : detectivesDone
            ? "Tout le monde a voté !"
            : committedVote != null && !hasPendingChange
              ? "Vote enregistré — en attente des autres joueurs…"
              : "Tu peux modifier ton vote avant de valider.";
        const confirmDisabled =
          displayPick == null || (committedVote != null && !hasPendingChange && !detectivesDone);
        const confirmLabel = detectivesDone && committedVote != null && !hasPendingChange
          ? "Tout le monde a voté !"
          : committedVote != null && !hasPendingChange
            ? "En attente des autres joueurs…"
            : "Valider mon vote";
        body = `
          ${statementsBlock}
          <p class="hint">${voteHint}</p>
          <div class="statements">
            ${round.statements
              .map((text, i) => {
                const cls = displayPick === i ? "statement statement--picked" : "statement";
                return `
              <button type="button" class="${cls}" data-pick="${i}">
                <span class="statement__letter">${String.fromCharCode(65 + i)}</span>
                <span>${escapeHtml(text)}</span>
              </button>`;
              })
              .join("")}
          </div>
          <button type="button" class="btn ${confirmDisabled ? "btn-secondary" : "btn-primary"}" id="confirm" ${confirmDisabled ? "disabled" : ""}>
            ${confirmLabel}
          </button>`;
      }
      if (!mp || isLobbyHost()) {
        const votes = getGuessLieSession().votes || {};
        const votedCount = countDetectiveVotes(votes, round);
        const totalDetectives = detectiveNamesForRound(round).length;
        body += `
          <button type="button" class="btn btn-secondary btn--spaced" id="guesslie-force">
            Révéler maintenant (${votedCount}/${totalDetectives})
          </button>`;
      }
    }

    if (phase === "reveal" && revealResult) {
      const { all, correct, liarBonus } = revealResult;
      const myCorrect = correct.includes(localName);
      const voterNames = Object.keys(all).filter((n) => n !== round.player);

      body = `
        <p class="game-intro">Manche de <strong>${escapeHtml(round.player)}</strong></p>
        <h3 class="section-title">Révélation</h3>
        <div class="statements">
          ${round.statements
            .map((text, i) => {
              let cls = "statement statement--readonly";
              if (i === round.lie) cls += " statement--lie";
              return `
            <div class="${cls}">
              <span class="statement__letter">${i === round.lie ? "✓" : String.fromCharCode(65 + i)}</span>
              <span>${escapeHtml(text)}</span>
            </div>`;
            })
            .join("")}
        </div>
        <div class="card card--feedback ${myCorrect && localName !== round.player ? "card--ok" : localName === round.player ? "card--ok" : "card--fail"}">
          <p class="feedback-title">${revealFeedbackTitle({ isSubject: localName === round.player, myCorrect, liarBonus })}</p>
          <p class="feedback-sub">${correct.length} détective(s) sur ${voterNames.length}${liarBonus ? ` · ${escapeHtml(round.player)} +${GUESS_LIE_LIAR_POINTS} pts` : ""}</p>
        </div>
        ${gameCumulativeScoresHtml({ gameId: "guesslie", gameLabel: "Guess The Lie", title: "Cumul des scores" })}
        <div class="card card--votes">
          ${Object.entries(all)
            .map(
              ([name, pick]) => `
            <div class="player-row player-row--compact">
              <span>${escapeHtml(name)}</span>
              <span>${String.fromCharCode(65 + pick)}${pick === round.lie ? " ✓" : ""}</span>
            </div>`
            )
            .join("")}
        </div>
        ${
          !mp || isLobbyHost()
            ? `<button type="button" class="btn btn-primary btn--spaced" id="next-round">
          ${roundIdx >= total - 1 ? "Voir les résultats →" : "Manche suivante →"}
        </button>`
            : `<p class="hint">En attente de l'hôte pour la suite…</p>`
        }`;
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <div class="game-header">
          <div class="dots">${Array.from({ length: total }, (_, i) =>
            `<span class="dot ${i === roundIdx ? "dot--active" : i < roundIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${roundIdx + 1}/${total}</span>
        </div>
        <div class="logo logo--sm"><h1>GUESS THE LIE</h1></div>
        ${body}
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);

    app.querySelectorAll("[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (isEveningGameplayPaused()) return;
        selected = Number(btn.getAttribute("data-pick"));
        render();
      });
    });

    app.querySelector("#confirm")?.addEventListener("click", async () => {
      const pick = selected ?? (getGuessLieSession().votes || {})[localName];
      if (pick == null) return;
      if (mp) {
        selected = pick;
        await commitGuessLieVote(pick);
        render();
        await tryAdvanceToReveal();
      } else {
        phase = "reveal";
        await transitionToReveal();
        render();
      }
    });

    app.querySelector("#guesslie-force")?.addEventListener("click", () => void forceReveal());

    app.querySelector("#next-round")?.addEventListener("click", nextRound);
  }

  function shouldSkipFullRender(prevIdx, prevPhase) {
    if (roundIdx !== prevIdx || phase !== prevPhase) return false;
    return phase === "voting" || phase === "reveal";
  }

  function patchVotingChrome() {
    const round = currentRound();
    const votes = getGuessLieSession().votes || {};
    const votedCount = countDetectiveVotes(votes, round);
    const totalDetectives = detectiveNamesForRound(round).length;
    const forceBtn = app.querySelector("#guesslie-force");
    if (forceBtn) {
      forceBtn.textContent = `Révéler maintenant (${votedCount}/${totalDetectives})`;
    }
  }

  function onSyncUpdate() {
    const prevIdx = roundIdx;
    const prevPhase = phase;
    const prevVotes = JSON.stringify(getGuessLieSession().votes || {});
    syncFromGl();
    const votesChanged = JSON.stringify(getGuessLieSession().votes || {}) !== prevVotes;
    const advanced =
      mp && (roundIdx !== prevIdx || (phase === "voting" && prevPhase === "reveal"));
    if (phase === "reveal" && prevPhase === "voting") {
      ensureRevealDisplay();
      render();
      return;
    }
    if (advanced) {
      revealResult = null;
      selected = phase === "voting" ? null : selected;
      render();
      void tryAdvanceToReveal();
      return;
    }
    void tryAdvanceToReveal();
    if (shouldSkipFullRender(prevIdx, prevPhase) && !votesChanged) {
      if (phase === "voting") patchVotingChrome();
      if (phase === "reveal") {
        refreshGameScoresBox(app, {
          gameId: "guesslie",
          gameLabel: "Guess The Lie",
          title: "Cumul des scores",
        });
      }
      return;
    }
    render();
  }

  const unsub = onGameSessionChange(onSyncUpdate);

  if (mp) {
    render();
    onSyncUpdate();
  } else {
    beginRound();
  }

  return () => {
    unsub();
    if (!mp) setLobbyWaiting();
  };
}
