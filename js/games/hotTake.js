import {
  HOT_TAKE_OPTIONS,
  HOT_TAKE_OPTION_COLORS,
  HOT_TAKE_TIMER_SEC,
} from "../../data/hotTakes.js";

/** Pause entre deux hot takes — source unique pour le jeu */
const HOT_TAKE_INTERMISSION_SEC = 5;
import {
  getAllTakesForGame,
  getHotTakeEntryScreen,
  getHotTakeSession,
  setHotTakePausedBy,
  clearHotTakePause,
  simulateLobbyVotes,
  getMajorityOption,
} from "../core/hotTakeSession.js";
import { awardHotTakeVotes } from "../core/scoring.js";
import { getLocalDisplayName, recordHotTakePlayed, setLastGame } from "../core/state.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { onTimerSecond, primeTimerSound } from "../core/timerSound.js";

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
  let timer = HOT_TAKE_TIMER_SEC;
  let intermissionTimer = HOT_TAKE_INTERMISSION_SEC;
  let myVote = null;
  let votes = {};
  let lastAward = null;
  let takeScored = false;
  let intervalId = null;
  let paused = false;
  const localName = getLocalDisplayName();

  function clearTimer() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function takeLabel(take) {
    const text = typeof take === "string" ? take : take.text;
    const author = typeof take === "object" && take.author ? take.author : null;
    return { text, author };
  }

  function voteCounts() {
    return HOT_TAKE_OPTIONS.reduce((acc, opt) => {
      acc[opt] = Object.values(votes).filter((v) => v === opt).length;
      return acc;
    }, {});
  }

  function pauseBanner() {
    const who = getHotTakeSession().pausedBy;
    if (!who) return "";
    return `<p class="pause-banner">⏸ Pause — ${escapeHtml(who)} a mis la partie en pause</p>`;
  }

  function intermissionRing(sec) {
    const pct = sec / HOT_TAKE_INTERMISSION_SEC;
    const r = 40;
    const c = 2 * Math.PI * r;
    return `
      <div class="intermission-wrap intermission-wrap--hot">
        <svg class="intermission-ring" width="100" height="100" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="6"/>
          <circle class="intermission-arc" cx="50" cy="50" r="${r}" fill="none" stroke="#FF6B6B" stroke-width="6" stroke-linecap="round"
            stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 50 50)"/>
          <text class="intermission-sec" x="50" y="56" text-anchor="middle" fill="#fff" font-size="26" font-weight="800">${sec}</text>
        </svg>
        <p class="intermission-wrap__title">Prochaine manche</p>
        <p class="hint" id="intermission-hint">Lancement du vote dans ${sec} s…</p>
      </div>`;
  }

  function updateIntermissionUi() {
    const pct = intermissionTimer / HOT_TAKE_INTERMISSION_SEC;
    const r = 40;
    const c = 2 * Math.PI * r;
    const ring = app.querySelector(".intermission-sec");
    const arc = app.querySelector(".intermission-arc");
    const hint = app.querySelector("#intermission-hint");
    if (ring) ring.textContent = String(intermissionTimer);
    if (arc) arc.setAttribute("stroke-dashoffset", String(c * (1 - pct)));
    if (hint) hint.textContent = `Lancement du vote dans ${intermissionTimer} s…`;
  }

  function startNextTakeVote() {
    phase = "voting";
    timer = HOT_TAKE_TIMER_SEC;
    myVote = null;
    votes = {};
    paused = false;
    clearHotTakePause();
    render();
    startVoteTimer();
  }

  function render() {
    const take = takeLabel(TAKES[takeIdx]);
    const total = TAKES.length;
    const counts = voteCounts();
    const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
    const { majority } = getMajorityOption(votes, HOT_TAKE_OPTIONS);

    let phaseHtml = "";

    if (phase === "question") {
      phaseHtml = `
        <p class="hint">Vote simultané du lobby — lance le chrono quand tout le monde est prêt.</p>
        <button type="button" class="btn btn-primary" id="start-vote">Lancer le vote →</button>`;
    }

    if (phase === "voting") {
      phaseHtml = `
        ${pauseBanner()}
        <p class="label-upper label-upper--muted">Vote simultané</p>
        <div class="timer" id="timer-el">${timer}</div>
        <div class="progress progress--timer">
          <div class="progress-fill" id="progress-el" style="width:${(timer / HOT_TAKE_TIMER_SEC) * 100}%"></div>
        </div>
        <div class="vote-buttons">
          ${HOT_TAKE_OPTIONS.map(
            (opt) => `
            <button type="button" class="vote-btn ${myVote === opt ? "vote-btn--active" : ""}"
              data-vote="${opt}" style="--vote-color:${HOT_TAKE_OPTION_COLORS[opt]}">
              ${opt}${myVote === opt ? " ✓" : ""}
            </button>`
          ).join("")}
        </div>
        <button type="button" class="btn btn-secondary btn--spaced" id="btn-pause">${paused ? "Reprendre" : "Pause"}</button>
        <p class="hint">${myVote ? "Les autres votent en même temps (NPC)." : "Choisis ton camp !"}</p>`;
    }

    if (phase === "reveal") {
      const awardHtml = lastAward
        ? `<p class="hint">Majorité : <strong style="color:${HOT_TAKE_OPTION_COLORS[lastAward.majority]}">${lastAward.majority}</strong> — camp majoritaire +${12} pts, dissent +${18} pts</p>`
        : "";
      phaseHtml = `
        <h3 class="section-title">Résultats du vote</h3>
        ${awardHtml}
        ${HOT_TAKE_OPTIONS.map((opt) => {
          const n = counts[opt] || 0;
          const pct = totalVotes ? Math.round((n / totalVotes) * 100) : 0;
          return `
            <div class="result-row">
              <div class="result-row__head">
                <span style="color:${HOT_TAKE_OPTION_COLORS[opt]}">${opt}${opt === majority ? " 👑" : ""}</span>
                <span class="muted">${n} votes · ${pct}%</span>
              </div>
              <div class="progress">
                <div class="progress-fill" style="width:${pct}%;background:${HOT_TAKE_OPTION_COLORS[opt]}"></div>
              </div>
            </div>`;
        }).join("")}
        <div class="card card--votes">
          ${Object.entries(votes)
            .map(
              ([name, v]) => `
            <div class="player-row player-row--compact">
              <span class="player-name">${escapeHtml(name)}</span>
              <span style="color:${HOT_TAKE_OPTION_COLORS[v]};font-weight:800">${v}</span>
            </div>`
            )
            .join("")}
        </div>
        <button type="button" class="btn btn-primary btn--spaced" id="next-take">
          ${takeIdx < total - 1 ? "Prochain Hot Take →" : "Voir les résultats →"}
        </button>`;
    }

    if (phase === "intermission") {
      phaseHtml = intermissionRing(intermissionTimer);
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
        ${
          phase === "intermission"
            ? `<p class="intermission-label">Pause avant la suite…</p>`
            : `<div class="card card--hot">
          <p class="label-upper label-upper--hot">🔥 Hot Take #${takeIdx + 1}</p>
          ${take.author ? `<p class="hot-take-author">Par ${escapeHtml(take.author)}</p>` : ""}
          <p class="hot-take-text">"${escapeHtml(take.text)}"</p>
        </div>`
        }
        ${phaseHtml}
      `,
    });

    bindNav(app);

    app.querySelector("#start-vote")?.addEventListener("click", () => {
      phase = "voting";
      timer = HOT_TAKE_TIMER_SEC;
      myVote = null;
      votes = {};
      paused = false;
      clearHotTakePause();
      render();
      startVoteTimer();
    });

    app.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (paused) return;
        myVote = btn.getAttribute("data-vote");
        votes = simulateLobbyVotes(myVote, HOT_TAKE_OPTIONS);
        render();
        if (!intervalId) startVoteTimer();
      });
    });

    app.querySelector("#btn-pause")?.addEventListener("click", () => {
      if (!paused) {
        paused = true;
        clearTimer();
        setHotTakePausedBy(localName);
      } else {
        paused = false;
        clearHotTakePause();
        if (phase === "voting") startVoteTimer();
      }
      render();
    });

    app.querySelector("#next-take")?.addEventListener("click", () => {
      if (!takeScored) {
        lastAward = awardHotTakeVotes(votes, HOT_TAKE_OPTIONS);
        takeScored = true;
      }

      if (takeIdx < total - 1) {
        takeIdx += 1;
        phase = "intermission";
        intermissionTimer = HOT_TAKE_INTERMISSION_SEC;
        myVote = null;
        votes = {};
        lastAward = null;
        takeScored = false;
        render();
        startIntermission();
      } else {
        recordHotTakePlayed();
        setLastGame({
          gameId: "hottake",
          title: "Hot Take",
          summary: `${total} prises · dernière majorité : ${lastAward.majority}`,
        });
        setLobbyWaiting();
        navigate("results");
      }
    });
  }

  function startVoteTimer() {
    clearTimer();
    primeTimerSound();
    intervalId = setInterval(() => {
      if (paused) return;
      timer -= 1;
      onTimerSecond({ remaining: timer, urgentAt: 3 });
      const timerEl = app.querySelector("#timer-el");
      const progressEl = app.querySelector("#progress-el");
      if (timerEl) timerEl.textContent = String(timer);
      if (progressEl) {
        progressEl.style.width = `${(timer / HOT_TAKE_TIMER_SEC) * 100}%`;
      }
      if (timer <= 0) {
        clearTimer();
        if (!myVote) {
          myVote = HOT_TAKE_OPTIONS[0];
          votes = simulateLobbyVotes(myVote, HOT_TAKE_OPTIONS);
        }
        phase = "reveal";
        if (!takeScored) {
          lastAward = awardHotTakeVotes(votes, HOT_TAKE_OPTIONS);
          takeScored = true;
        }
        clearHotTakePause();
        render();
      }
    }, 1000);
  }

  function startIntermission() {
    clearTimer();
    primeTimerSound();
    intermissionTimer = HOT_TAKE_INTERMISSION_SEC;
    updateIntermissionUi();
    intervalId = setInterval(() => {
      intermissionTimer -= 1;
      onTimerSecond({ remaining: intermissionTimer, urgentAt: 3 });
      if (intermissionTimer <= 0) {
        clearTimer();
        startNextTakeVote();
        return;
      }
      updateIntermissionUi();
    }, 1000);
  }

  render();
  return () => {
    clearTimer();
    setLobbyWaiting();
  };
}
