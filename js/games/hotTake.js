import {
  HOT_TAKE_OPTIONS,
  HOT_TAKE_OPTION_COLORS,
  HOT_TAKE_TIMER_SEC,
} from "../../data/hotTakes.js";

const HOT_TAKE_INTERMISSION_SEC = 5;
import {
  getAllTakesForGame,
  getHotTakeEntryScreen,
  getHotTakeSession,
  setHotTakePausedBy,
  clearHotTakePause,
  simulateLobbyVotes,
  getMajorityOption,
  commitHotTakePlay,
  allHotTakeVotesIn,
} from "../core/hotTakeSession.js";
import { awardHotTakeVotes } from "../core/scoring.js";
import { gameCumulativeScoresHtml } from "../core/gameScores.js";
import { getLocalDisplayName, recordHotTakePlayed, setLastGame } from "../core/state.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { onTimerSecond, primeTimerSound } from "../core/timerSound.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  completeGameSession,
  syncLobbyScores,
} from "../core/gameSync.js";

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
  /** Vote en cours d’envoi — évite que la synchro efface l’UI avant la réponse serveur. */
  let voteCommitInFlight = null;
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

  /** Votes complets pour le scoring (session sync), pas le snapshot local du clic. */
  function votesForAward() {
    const fromSession = { ...(getHotTakeSession().votes || {}) };
    if (voteCommitInFlight != null && fromSession[localName] == null) {
      fromSession[localName] = voteCommitInFlight;
    }
    if (!mp && Object.keys(fromSession).length === 0 && Object.keys(votes).length > 0) {
      return { ...votes };
    }
    votes = fromSession;
    return fromSession;
  }

  function alreadyScoredThisTake() {
    return takeScored || Boolean(getHotTakeSession().takeScored);
  }

  function canAwardThisTake() {
    return !alreadyScoredThisTake() && (!mp || isLobbyHost());
  }

  function syncFromSession() {
    const s = getHotTakeSession();
    if (s.takeIdx != null) takeIdx = s.takeIdx;
    if (s.phase) phase = s.phase;
    votes = { ...(s.votes || {}) };
    myVote = votes[localName] ?? null;
    if (voteCommitInFlight && phase === "voting" && myVote == null) {
      myVote = voteCommitInFlight;
      votes = { ...votes, [localName]: voteCommitInFlight };
    }
    paused = Boolean(s.pausedBy);
    takeScored = Boolean(s.takeScored);
    if (phase === "voting" && s.voteEndsAt) {
      timer = secondsUntil(s.voteEndsAt) ?? timer;
    }
    if (phase === "intermission" && s.intermissionEndsAt) {
      intermissionTimer = secondsUntil(s.intermissionEndsAt) ?? intermissionTimer;
    }
    if (phase === "reveal" && takeScored && !lastAward) {
      lastAward = getMajorityOption(votes, HOT_TAKE_OPTIONS);
    }
  }

  function takeLabel(take) {
    if (typeof take === "string") return { text: take, author: null, themeId: null };
    return {
      text: take.text,
      author: take.author || null,
      themeId: take.themeId || null,
    };
  }

  function takeAuthorLine(take) {
    if (take.themeId !== "custom" || !take.author) return "";
    return `<p class="hot-take-author">Hot take de ${escapeHtml(take.author)}</p>`;
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

  async function goToReveal() {
    const votesToScore = votesForAward();
    if (canAwardThisTake()) {
      lastAward = awardHotTakeVotes(votesToScore, HOT_TAKE_OPTIONS);
      takeScored = true;
      if (mp) await syncLobbyScores();
    }
    if (mp) {
      await commitHotTakePlay({
        phase: "reveal",
        takeScored: true,
        votes: votesToScore,
        voteEndsAt: null,
      });
    } else {
      phase = "reveal";
      render();
    }
  }

  async function startVotePhase() {
    if (mp && !isLobbyHost()) return;
    const endsAt = new Date(Date.now() + HOT_TAKE_TIMER_SEC * 1000).toISOString();
    if (mp) {
      await commitHotTakePlay({
        phase: "voting",
        votes: {},
        takeScored: false,
        voteEndsAt: endsAt,
        intermissionEndsAt: null,
        pausedBy: null,
      });
    } else {
      phase = "voting";
      timer = HOT_TAKE_TIMER_SEC;
      myVote = null;
      votes = {};
      paused = false;
      clearHotTakePause();
      render();
      startVoteTimer();
    }
  }

  async function startNextTakeVote() {
    if (mp && !isLobbyHost()) return;
    if (mp) {
      await commitHotTakePlay({
        phase: "voting",
        takeIdx,
        votes: {},
        takeScored: false,
        voteEndsAt: new Date(Date.now() + HOT_TAKE_TIMER_SEC * 1000).toISOString(),
        intermissionEndsAt: null,
        pausedBy: null,
      });
    } else {
      phase = "voting";
      timer = HOT_TAKE_TIMER_SEC;
      myVote = null;
      votes = {};
      paused = false;
      clearHotTakePause();
      render();
      startVoteTimer();
    }
  }

  function render() {
    syncFromSession();
    const take = takeLabel(TAKES[takeIdx]);
    const total = TAKES.length;
    const counts = voteCounts();
    const totalVotes = Object.values(counts).reduce((a, b) => a + b, 0);
    const { majority } = getMajorityOption(votes, HOT_TAKE_OPTIONS);
    const host = !mp || isLobbyHost();
    const voteHint = mp
      ? myVote
        ? allHotTakeVotesIn()
          ? "Tout le monde a voté !"
          : "En attente des autres joueurs…"
        : "Choisis ton camp !"
      : myVote
        ? "Les autres votent en même temps (NPC)."
        : "Choisis ton camp !";

    let phaseHtml = "";

    if (phase === "question") {
      phaseHtml = host
        ? `<p class="hint">Vote simultané — lance le chrono quand tout le monde est prêt.</p>
        <button type="button" class="btn btn-primary" id="start-vote">Lancer le vote →</button>`
        : `<p class="hint">En attente que l'hôte lance le vote…</p>`;
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
        ${host ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-pause">${paused ? "Reprendre" : "Pause"}</button>` : ""}
        <p class="hint">${voteHint}</p>`;
    }

    if (phase === "reveal") {
      const awardHtml = lastAward
        ? `<p class="hint">Majorité : <strong style="color:${HOT_TAKE_OPTION_COLORS[lastAward.majority]}">${lastAward.majority}</strong> — camp majoritaire +12 pts, dissent +18 pts</p>`
        : "";
      phaseHtml = `
        <h3 class="section-title">Résultats du vote</h3>
        ${awardHtml}
        ${gameCumulativeScoresHtml({ gameLabel: "Hot Take", title: "Cumul des scores" })}
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
        ${
          host
            ? `<button type="button" class="btn btn-primary btn--spaced" id="next-take">
          ${takeIdx < total - 1 ? "Prochain Hot Take →" : "Voir les résultats →"}
        </button>`
            : `<p class="hint">En attente de l'hôte pour la suite…</p>`
        }`;
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
          ${takeAuthorLine(take)}
          <p class="hot-take-text">"${escapeHtml(take.text)}"</p>
        </div>`
        }
        ${phaseHtml}
      `,
    });

    bindNav(app);

    app.querySelector("#start-vote")?.addEventListener("click", () => startVotePhase());

    app.querySelectorAll("[data-vote]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (paused || myVote) return;
        const choice = btn.getAttribute("data-vote");
        myVote = choice;
        votes = { ...votes, [localName]: choice };
        if (mp) {
          voteCommitInFlight = choice;
          render();
          try {
            await commitHotTakePlay({ votes });
            if (allHotTakeVotesIn() && isLobbyHost()) await goToReveal();
          } finally {
            voteCommitInFlight = null;
          }
        } else {
          votes = simulateLobbyVotes(choice, HOT_TAKE_OPTIONS);
          render();
          if (!intervalId) startVoteTimer();
        }
        render();
      });
    });

    app.querySelector("#btn-pause")?.addEventListener("click", async () => {
      if (!paused) {
        paused = true;
        clearTimer();
        await setHotTakePausedBy(localName);
      } else {
        paused = false;
        await clearHotTakePause();
        if (phase === "voting") startVoteTimer();
      }
      render();
    });

    app.querySelector("#next-take")?.addEventListener("click", async () => {
      if (canAwardThisTake()) {
        const votesToScore = votesForAward();
        lastAward = awardHotTakeVotes(votesToScore, HOT_TAKE_OPTIONS);
        takeScored = true;
        if (mp) await syncLobbyScores();
      }

      if (takeIdx < total - 1) {
        const nextIdx = takeIdx + 1;
        if (mp) {
          const intermissionEndsAt = new Date(
            Date.now() + HOT_TAKE_INTERMISSION_SEC * 1000
          ).toISOString();
          await commitHotTakePlay({
            takeIdx: nextIdx,
            phase: "intermission",
            votes: {},
            takeScored: false,
            voteEndsAt: null,
            intermissionEndsAt,
          });
          takeIdx = nextIdx;
          phase = "intermission";
          intermissionTimer = HOT_TAKE_INTERMISSION_SEC;
          myVote = null;
          votes = {};
          lastAward = null;
          takeScored = false;
          render();
          if (isLobbyHost()) startIntermission();
        } else {
          takeIdx = nextIdx;
          phase = "intermission";
          intermissionTimer = HOT_TAKE_INTERMISSION_SEC;
          myVote = null;
          votes = {};
          lastAward = null;
          takeScored = false;
          render();
          startIntermission();
        }
      } else {
        recordHotTakePlayed();
        setLastGame({
          gameId: "hottake",
          title: "Hot Take",
          summary: `${total} prises · dernière majorité : ${lastAward?.majority || "—"}`,
        });
        if (mp) {
          try {
            await completeGameSession({ gameId: "hottake", screen: "results", state: {} });
          } catch (e) {
            console.warn("REVEAL completeGameSession:", e);
            navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
          }
        } else {
          setLobbyWaiting();
        }
        navigate("results");
      }
    });
  }

  function startVoteTimer() {
    clearTimer();
    if (mp && !getHotTakeSession().voteEndsAt) return;
    primeTimerSound();

    const tick = async () => {
      if (paused) return;
      if (mp) {
        timer = secondsUntil(getHotTakeSession().voteEndsAt) ?? 0;
      } else {
        timer -= 1;
      }
      onTimerSecond({ remaining: timer, urgentAt: 3 });
      const timerEl = app.querySelector("#timer-el");
      const progressEl = app.querySelector("#progress-el");
      if (timerEl) timerEl.textContent = String(timer);
      if (progressEl) {
        progressEl.style.width = `${(timer / HOT_TAKE_TIMER_SEC) * 100}%`;
      }
      if (timer <= 0) {
        clearTimer();
        if (!mp) {
          if (!myVote) {
            myVote = HOT_TAKE_OPTIONS[0];
            votes = simulateLobbyVotes(myVote, HOT_TAKE_OPTIONS);
          }
          phase = "reveal";
          if (canAwardThisTake()) {
            const votesToScore = votesForAward();
            lastAward = awardHotTakeVotes(votesToScore, HOT_TAKE_OPTIONS);
            takeScored = true;
          }
          clearHotTakePause();
          render();
        } else if (isLobbyHost()) {
          if (!myVote) {
            myVote = HOT_TAKE_OPTIONS[0];
            votes = { ...votes, [localName]: myVote };
            if (mp) await commitHotTakePlay({ votes });
          }
          await goToReveal();
        }
      }
    };

    tick();
    intervalId = setInterval(tick, 1000);
  }

  function startIntermission() {
    clearTimer();
    if (mp && !getHotTakeSession().intermissionEndsAt) return;
    primeTimerSound();

    const tick = async () => {
      if (mp) {
        intermissionTimer = secondsUntil(getHotTakeSession().intermissionEndsAt) ?? 0;
      } else {
        intermissionTimer -= 1;
      }
      onTimerSecond({ remaining: intermissionTimer, urgentAt: 3 });
      updateIntermissionUi();
      if (intermissionTimer <= 0) {
        clearTimer();
        if (!mp || isLobbyHost()) await startNextTakeVote();
      }
    };

    tick();
    intervalId = setInterval(tick, 1000);
  }

  const unsubGame = onGameSessionChange(() => {
    const prevPhase = phase;
    syncFromSession();
    render();
    if (phase === "voting" && prevPhase !== "voting") startVoteTimer();
    if (phase === "intermission" && prevPhase !== "intermission") startIntermission();
    if (phase === "reveal" && takeScored && !lastAward) {
      lastAward = getMajorityOption(votes, HOT_TAKE_OPTIONS);
    }
  });

  syncFromSession();
  render();
  if (phase === "voting") startVoteTimer();
  if (phase === "intermission") startIntermission();

  return () => {
    clearTimer();
    unsubGame();
    if (!mp) setLobbyWaiting();
  };
}
