import {
  GUESS_LIE_DETECTIVE_POINTS,
  GUESS_LIE_LIAR_POINTS,
  GUESS_LIE_VOTE_TIMER_SEC,
  GUESS_LIE_LIAR_BONUS_THRESHOLD,
} from "../../data/guessLies.js";
import {
  getGuessLieEntryScreen,
  getGuessLieRounds,
  simulateRoundVotes,
} from "../core/guessLieSession.js";
import {
  getLocalDisplayName,
  addScore,
  bumpPlayerStat,
  recordLieGuess,
  setLastGame,
} from "../core/state.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";

export function mountGuessLie(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getGuessLieEntryScreen();
  if (entry !== "guesslie") {
    navigate(entry);
    return null;
  }

  const rounds = getGuessLieRounds();
  if (!rounds.length) {
    navigate("guesslie-menu");
    return null;
  }

  setLobbyPlaying("guesslie");

  let roundIdx = 0;
  let phase = "voting";
  let selected = null;
  let timer = GUESS_LIE_VOTE_TIMER_SEC;
  let roundScored = false;
  let revealResult = null;
  let intervalId = null;
  const localName = getLocalDisplayName();

  function clearTimer() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function currentRound() {
    return rounds[roundIdx];
  }

  function computeReveal() {
    const round = currentRound();
    const all = { ...simulateRoundVotes(round, round.player) };
    if (selected !== null && localName !== round.player) all[localName] = selected;
    const voters = Object.keys(all).filter((n) => n !== round.player);
    const correct = voters.filter((n) => all[n] === round.lie);
    const ratio = voters.length ? correct.length / voters.length : 0;
    return { all, correct, ratio, round, liarBonus: ratio < GUESS_LIE_LIAR_BONUS_THRESHOLD };
  }

  function applyRoundScore(result) {
    if (roundScored) return;
    roundScored = true;
    const { correct, round, liarBonus } = result;

    correct.forEach((name) => {
      addScore(name, GUESS_LIE_DETECTIVE_POINTS);
      bumpPlayerStat(name, "liesDetected", 1);
    });

    if (localName !== round.player) {
      recordLieGuess(correct.includes(localName));
    }

    if (liarBonus) {
      addScore(round.player, GUESS_LIE_LIAR_POINTS);
      bumpPlayerStat(round.player, "liesFooled", 1);
    }

    revealResult = { ...result, all: result.all };
  }

  function startVotingTimer() {
    const round = currentRound();
    const isSubject = round.player === localName;
    clearTimer();
    intervalId = setInterval(() => {
      timer -= 1;
      const el = app.querySelector("#timer-el");
      if (el) {
        el.textContent = String(timer);
        if (timer <= 5) el.classList.add("timer--urgent");
      }
      const progressEl = app.querySelector("#progress-el");
      if (progressEl) {
        progressEl.style.width = `${(timer / GUESS_LIE_VOTE_TIMER_SEC) * 100}%`;
      }
      if (timer <= 0) {
        clearTimer();
        if (!isSubject && selected === null) selected = 0;
        phase = "reveal";
        render();
      }
    }, 1000);
  }

  function beginRound() {
    phase = "voting";
    selected = null;
    roundScored = false;
    revealResult = null;
    timer = GUESS_LIE_VOTE_TIMER_SEC;
    render();
    startVotingTimer();
  }

  function nextRound() {
    if (roundIdx >= rounds.length - 1) {
      setLastGame({
        gameId: "guesslie",
        title: "Guess The Lie",
        summary: `${rounds.length} manches jouées`,
      });
      setLobbyWaiting();
      navigate("results");
      return;
    }
    roundIdx += 1;
    beginRound();
  }

  function render() {
    const round = currentRound();
    const total = rounds.length;
    const isSubject = round.player === localName;

    if (phase === "reveal" && !roundScored) {
      applyRoundScore(computeReveal());
    }

    let body = "";

    if (phase === "voting") {
      const statementsBlock = `
        <p class="game-intro">Manche de <strong>${escapeHtml(round.player)}</strong></p>
        <p class="hint">${isSubject ? "🎭 Tu es le menteur — les détectives ont 30 s." : "Quelle affirmation est le mensonge ?"}</p>`;

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
            <div class="timer timer--liar" id="timer-el">${timer}</div>
            <p class="liar-stage__secret">Ton mensonge : <strong>lettre ${lieLetter}</strong></p>
            <div class="liar-stage__detectives">
              <span class="liar-detective liar-detective--1">🕵️</span>
              <span class="liar-detective liar-detective--2">🔍</span>
              <span class="liar-detective liar-detective--3">👀</span>
            </div>
            <div class="liar-stage__scan"></div>
          </div>`;
      } else {
        body = `
          ${statementsBlock}
          <div class="timer" id="timer-el">${timer}</div>
          <div class="progress progress--timer">
            <div class="progress-fill" id="progress-el" style="width:${(timer / GUESS_LIE_VOTE_TIMER_SEC) * 100}%"></div>
          </div>
          <div class="statements">
            ${round.statements
              .map((text, i) => {
                const cls = selected === i ? "statement statement--picked" : "statement";
                return `
              <button type="button" class="${cls}" data-pick="${i}">
                <span class="statement__letter">${String.fromCharCode(65 + i)}</span>
                <span>${escapeHtml(text)}</span>
              </button>`;
              })
              .join("")}
          </div>
          <button type="button" class="btn btn-primary" id="confirm" ${selected === null ? "disabled" : ""}>Valider mon vote</button>`;
      }
    }

    if (phase === "reveal" && revealResult) {
      const { all, correct, liarBonus } = revealResult;
      const myCorrect = correct.includes(localName);

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
              <span class="statement__letter">${i === round.lie ? "✗" : String.fromCharCode(65 + i)}</span>
              <span>${escapeHtml(text)}</span>
            </div>`;
            })
            .join("")}
        </div>
        <div class="card card--feedback ${myCorrect && localName !== round.player ? "card--ok" : localName === round.player ? "card--ok" : "card--fail"}">
          <p class="feedback-title">Mensonge : lettre ${String.fromCharCode(65 + round.lie)}</p>
          <p class="feedback-sub">${correct.length} détective(s) sur ${Object.keys(all).length}${liarBonus ? ` · ${escapeHtml(round.player)} +${GUESS_LIE_LIAR_POINTS} pts` : ""}</p>
        </div>
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
        <button type="button" class="btn btn-primary btn--spaced" id="next-round">
          ${roundIdx >= total - 1 ? "Voir les résultats →" : "Manche suivante →"}
        </button>`;
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--green">🕵️ Manche ${roundIdx + 1}/${total}</p>
        <div class="logo logo--sm"><h1>GUESS THE LIE</h1></div>
        ${body}
      `,
    });

    bindNav(app);

    app.querySelectorAll("[data-pick]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selected = Number(btn.getAttribute("data-pick"));
        render();
      });
    });

    app.querySelector("#confirm")?.addEventListener("click", () => {
      if (selected === null) return;
      clearTimer();
      phase = "reveal";
      render();
    });

    app.querySelector("#next-round")?.addEventListener("click", nextRound);
  }

  beginRound();

  return () => {
    clearTimer();
    setLobbyWaiting();
  };
}
