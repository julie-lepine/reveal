import {
  getPlaylistGuessEntryScreen,
  getPlaylistGuessSession,
  getPlaylistGuessDeck,
  getCurrentPlaylistGuessRound,
  commitPlaylistGuessPlay,
  allPlaylistGuessVotesIn,
  simulatePlaylistGuessVotes,
  startPlaylistGuessRound,
  nameForPlayerId,
  getLocalParticipantId,
  PLAYLIST_GUESS_TIMER_SEC,
} from "../core/playlistGuessSession.js";
import { awardPlaylistGuessRound } from "../core/scoring.js";
import { gameCumulativeScoresHtml } from "../core/gameScores.js";
import { getLocalDisplayName, setLastGame, recordPlaylistGuessPlayed } from "../core/state.js";
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
import {
  songGuessCardHtml,
  ownerWaitingStageHtml,
} from "../playlistguess/SongGuessCard.js";
import { revealOwnerCardHtml } from "../playlistguess/RevealOwnerCard.js";

export function mountPlaylistGuess(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getPlaylistGuessEntryScreen();
  if (entry !== "playlistguess") {
    navigate(entry);
    return null;
  }

  const deck = getPlaylistGuessDeck();
  if (!deck.length) {
    navigate("playlistguess-prep");
    return null;
  }

  setLobbyPlaying("playlistguess");

  const mp = isGameSyncActive();
  const localName = getLocalDisplayName();
  const localUid = getLocalParticipantId();

  let roundIdx = 0;
  let phase = "voting";
  let selected = null;
  let timer = PLAYLIST_GUESS_TIMER_SEC;
  let roundScored = false;
  let revealSummary = null;
  let intervalId = null;
  let revealAdvancing = false;

  function clearTimer() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function currentRound() {
    return getCurrentPlaylistGuessRound() || deck[roundIdx];
  }

  function isOwner(round) {
    return round.ownerPlayerId === localUid || round.ownerName === localName;
  }

  function secondsUntil(iso) {
    if (!iso) return null;
    return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
  }

  function syncFromSession() {
    const s = getPlaylistGuessSession();
    const prevRound = roundIdx;
    if (s.roundIdx != null) roundIdx = s.roundIdx;
    if (s.phase) phase = s.phase;
    const votes = { ...(s.votes || {}) };
    selected = votes[localName] ?? null;
    roundScored = Boolean(s.roundScored);
    if (phase === "voting" && s.voteEndsAt) {
      timer = secondsUntil(s.voteEndsAt) ?? timer;
    }
    if (roundIdx !== prevRound || phase !== "reveal") {
      revealSummary = null;
    }
  }

  function computeReveal() {
    const round = currentRound();
    const s = getPlaylistGuessSession();
    const all = mp ? { ...(s.votes || {}) } : { ...simulatePlaylistGuessVotes(round, selected) };
    if (selected != null && !isOwner(round)) all[localName] = selected;

    const voters = Object.keys(all).filter((n) => n !== round.ownerName);
    const correct = voters.filter(
      (n) => all[n] === round.ownerPlayerId || all[n] === round.ownerName
    );
    const allCorrect = voters.length > 0 && correct.length === voters.length;
    const ownerStealth = !allCorrect;

    return { all, correct, allCorrect, ownerStealth, round };
  }

  function applyRoundScore(result) {
    if (roundScored) return;
    roundScored = true;
    const { correct, ownerStealth, round } = result;
    revealSummary = {
      ...awardPlaylistGuessRound({
        votes: result.all,
        ownerName: round.ownerName,
        ownerPlayerId: round.ownerPlayerId,
      }),
      round,
      ownerStealth,
      myCorrect: correct.includes(localName),
      isOwner: isOwner(round),
      votesByName: result.all,
    };
    if (mp && isLobbyHost()) void syncLobbyScores();
  }

  async function tryAdvanceToReveal() {
    if (!mp || phase !== "voting" || revealAdvancing) return;
    const s = getPlaylistGuessSession();
    const round = currentRound();
    if (!allPlaylistGuessVotesIn() || !isLobbyHost()) return;
    if (s.roundScored || roundScored) return;
    revealAdvancing = true;
    try {
      await commitPlaylistGuessPlay({ phase: "reveal", voteEndsAt: null });
      applyRoundScore(computeReveal());
      await commitPlaylistGuessPlay({ roundScored: true });
    } finally {
      revealAdvancing = false;
    }
  }

  function ensureRevealDisplay() {
    if (phase !== "reveal") return;
    const result = computeReveal();
    if (!roundScored && (!mp || isLobbyHost())) {
      applyRoundScore(result);
    } else if (!revealSummary) {
      const { correct, allCorrect, ownerStealth, round, all } = result;
      revealSummary = {
        round,
        ownerStealth,
        myCorrect: correct.includes(localName),
        isOwner: isOwner(round),
        votesByName: all,
        correctVoters: correct,
        allCorrect,
      };
    }
  }

  function startVotingTimer() {
    clearTimer();
    primeTimerSound();
    intervalId = setInterval(async () => {
      if (isEveningGameplayPaused()) return;
      const s = getPlaylistGuessSession();
      if (phase !== "voting") {
        clearTimer();
        return;
      }
      if (mp && s.voteEndsAt) {
        timer = secondsUntil(s.voteEndsAt) ?? 0;
      } else {
        timer -= 1;
      }
      onTimerSecond({ remaining: timer, urgentAt: 5 });
      const el = app.querySelector("#timer-el");
      if (el) {
        el.textContent = String(timer);
        if (timer <= 5) el.classList.add("timer--urgent");
      }
      const progressEl = app.querySelector("#progress-el");
      if (progressEl) {
        progressEl.style.width = `${(timer / PLAYLIST_GUESS_TIMER_SEC) * 100}%`;
      }
      if (timer <= 0) {
        clearTimer();
        if (!mp) {
          const round = currentRound();
          if (!isOwner(round) && selected === null && round.choices?.length) {
            selected = round.choices[Math.floor(Math.random() * round.choices.length)].playerId;
          }
          phase = "reveal";
          render();
        } else if (isLobbyHost()) {
          await tryAdvanceToReveal();
        }
      }
    }, 1000);
  }

  async function nextRound() {
    if (mp && !isLobbyHost()) return;

    if (roundIdx >= deck.length - 1) {
      recordPlaylistGuessPlayed();
      setLastGame({
        gameId: "playlistguess",
        title: "VibeCheck",
        summary: `${deck.length} manches jouées`,
      });
      if (mp) {
        try {
          await completeGameSession({
            gameId: "playlistguess",
            screen: "results",
            state: {},
          });
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
      await startPlaylistGuessRound(next);
      roundIdx = next;
      phase = "voting";
      selected = null;
      roundScored = false;
      revealSummary = null;
      timer = PLAYLIST_GUESS_TIMER_SEC;
      clearTimer();
      render();
      startVotingTimer();
    } else {
      roundIdx = next;
      phase = "voting";
      selected = null;
      roundScored = false;
      revealSummary = null;
      timer = PLAYLIST_GUESS_TIMER_SEC;
      render();
      startVotingTimer();
    }
  }

  function render() {
    syncFromSession();
    ensureRevealDisplay();

    const round = currentRound();
    const total = deck.length;
    if (!round) {
      app.innerHTML = pageShell({
        backTarget: "back",
        content: `<p class="hint">Chargement de la manche…</p>`,
      });
      bindNav(app);
      return;
    }

    const owner = isOwner(round);
    let body = "";

    if (phase === "voting") {
      if (owner) {
        body = ownerWaitingStageHtml(round, timer);
      } else {
        const alreadyVoted = mp && (getPlaylistGuessSession().votes || {})[localName] != null;
        if (alreadyVoted) {
          body = `
            ${songGuessCardHtml(round, { selectedPlayerId: selected, readonly: true })}
            <p class="hint">Vote enregistré — en attente des autres…</p>`;
        } else {
          body = `
            <div class="timer" id="timer-el">${timer}</div>
            <div class="progress progress--timer">
              <div class="progress-fill" id="progress-el" style="width:${(timer / PLAYLIST_GUESS_TIMER_SEC) * 100}%"></div>
            </div>
            ${songGuessCardHtml(round, { selectedPlayerId: selected })}
            <button type="button" class="btn btn-primary" id="confirm" ${selected === null ? "disabled" : ""}>Valider mon vote</button>`;
        }
      }
    }

    if (phase === "reveal" && revealSummary) {
      body = `
        ${revealOwnerCardHtml({
          ...revealSummary,
          nameForPlayerId,
        })}
        ${gameCumulativeScoresHtml({ gameLabel: "VibeCheck", title: "Cumul des scores" })}
        ${
          !mp || isLobbyHost()
            ? `<button type="button" class="btn btn-primary btn--spaced" id="next-round">
          ${roundIdx >= total - 1 ? "Voir les résultats →" : "Manche suivante →"}
        </button>`
            : `<p class="hint">En attente de l'hôte pour la suite…</p>`
        }
        ${exitGameToLobbyButtonHtml()}`;
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--purple">🎵 Manche ${roundIdx + 1}/${total}</p>
        <div class="logo logo--sm"><h1>VIBECHECK</h1></div>
        ${body}
      `,
    });

    bindNav(app);
    bindExitGameToLobby(app);

    app.querySelectorAll("[data-vote-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (isEveningGameplayPaused()) return;
        selected = btn.getAttribute("data-vote-id");
        render();
      });
    });

    app.querySelector("#confirm")?.addEventListener("click", async () => {
      if (selected === null) return;
      clearTimer();
      if (mp) {
        const votes = { ...(getPlaylistGuessSession().votes || {}), [localName]: selected };
        await commitPlaylistGuessPlay({ votes });
        await tryAdvanceToReveal();
      } else {
        phase = "reveal";
      }
      render();
    });

    app.querySelector("#next-round")?.addEventListener("click", () => void nextRound());
  }

  function onSyncUpdate() {
    const prevIdx = roundIdx;
    const prevPhase = phase;
    syncFromSession();
    const advanced =
      mp && (roundIdx !== prevIdx || (phase === "voting" && prevPhase === "reveal"));
    if (advanced) {
      revealSummary = null;
      selected = phase === "voting" ? null : selected;
      timer = PLAYLIST_GUESS_TIMER_SEC;
      clearTimer();
    }
    void tryAdvanceToReveal();
    render();
    if (phase === "voting" && (advanced || !intervalId)) startVotingTimer();
  }

  const unsub = onGameSessionChange(onSyncUpdate);

  if (mp) {
    onSyncUpdate();
  } else {
    render();
    startVotingTimer();
  }

  return () => {
    clearTimer();
    unsub();
    if (!mp) setLobbyWaiting();
  };
}
