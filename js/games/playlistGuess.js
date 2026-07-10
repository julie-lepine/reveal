import {
  getPlaylistGuessEntryScreen,
  getPlaylistGuessSession,
  getPlaylistGuessDeck,
  getCurrentPlaylistGuessRound,
  commitPlaylistGuessPlay,
  commitPlaylistGuessVote,
  allPlaylistGuessVotesIn,
  getEffectivePlaylistGuessVotes,
  simulatePlaylistGuessVotes,
  startPlaylistGuessRound,
  nameForPlayerId,
  getLocalParticipantId,
  lobbyPlayersWithIds,
} from "../core/playlistGuessSession.js";
import { awardPlaylistGuessRound } from "../core/scoring.js";
import { gameCumulativeScoresHtml, refreshGameScoresBox } from "../core/gameScores.js";
import {
  setLastGame,
  recordPlaylistGuessPlayed,
  setActiveScoringGame,
} from "../core/state.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { pageShell, resetPageScroll } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
// FIL_ROUGE (Mot interdit) - pause soirée ; isEveningGameplayPaused() = false si désactivé
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import {
  isGameSyncActive,
  canActAsHost,
  onGameSessionChange,
  completeGameSession,
  getCachedGameSession,
  stopGameSessionListenerOnPostGame,
} from "../core/gameSync.js";
import { songGuessCardHtml } from "../playlistguess/SongGuessCard.js";
import { revealResultCardHtml } from "../playlistguess/RevealOwnerCard.js";

function countResults(votesByUid) {
  const counts = {};
  Object.values(votesByUid || {}).forEach((pick) => {
    if (pick == null || pick === "") return;
    counts[pick] = (counts[pick] || 0) + 1;
  });
  let maxVotes = 0;
  Object.values(counts).forEach((n) => {
    if (n > maxVotes) maxVotes = n;
  });
  const leaders = Object.entries(counts)
    .filter(([, n]) => n === maxVotes && maxVotes > 0)
    .map(([uid]) => uid);
  return { counts, leaders, maxVotes };
}

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

  void setLobbyPlaying("playlistguess").catch(() => {});

  const mp = isGameSyncActive();
  const localUid = getLocalParticipantId();

  let roundIdx = 0;
  let phase = "voting";
  let selected = null;
  let roundScored = false;
  let revealSummary = null;
  let revealAdvancing = false;
  let lastScoredRoundIdx = -1;
  let lastScrollKey = "";

  /** Scroll en haut au début d'une manche (pas après validation du vote). */
  function scrollToTopForRound(force = false) {
    const key = `${roundIdx}:${phase}`;
    if (!force && key === lastScrollKey) return;
    lastScrollKey = key;
    requestAnimationFrame(() => resetPageScroll(app));
  }

  function currentRound() {
    return getCurrentPlaylistGuessRound() || deck[roundIdx];
  }

  function syncFromSession() {
    const prevIdx = roundIdx;
    const prevPhase = phase;
    const s = getPlaylistGuessSession();
    if (s.roundIdx != null) roundIdx = s.roundIdx;
    if (s.phase) phase = s.phase;
    const votesByUid = getEffectivePlaylistGuessVotes(s);
    const serverPick = votesByUid[localUid];
    if (roundIdx !== prevIdx || (phase === "voting" && prevPhase === "reveal")) {
      selected = serverPick != null ? serverPick : null;
      lastScoredRoundIdx = -1;
    } else if (serverPick != null) {
      selected = serverPick;
    } else if (phase === "voting" && prevPhase !== "voting") {
      selected = null;
    }
    if (s.phase === "voting") {
      roundScored = Boolean(s.roundScored) && Object.keys(s.votes || {}).length > 0
        ? Boolean(s.roundScored)
        : false;
    } else {
      roundScored = Boolean(s.roundScored);
    }
    if (roundIdx !== prevIdx || phase !== "reveal") {
      revealSummary = null;
    }
  }

  function gatherVotes() {
    const round = currentRound();
    const s = getPlaylistGuessSession();
    const all = mp
      ? { ...getEffectivePlaylistGuessVotes(s) }
      : { ...simulatePlaylistGuessVotes(round, selected) };
    if (selected != null) all[localUid] = selected;
    return all;
  }

  function buildSummary(votesByUid) {
    const round = currentRound();
    const players = lobbyPlayersWithIds();
    const result = countResults(votesByUid);
    return {
      song: round.song || round.track || {},
      players,
      counts: result.counts,
      leaders: result.leaders,
      votesByUid,
      localUid,
      nameForPlayerId,
    };
  }

  async function transitionToReveal() {
    const live = getPlaylistGuessSession();
    if (phase === "reveal" || live.phase === "reveal") {
      if (!revealSummary) {
        revealSummary = buildSummary(gatherVotes());
      }
      return;
    }
    if (mp && !canActAsHost()) return;

    setActiveScoringGame("playlistguess");
    roundScored = true;
    if (lastScoredRoundIdx !== roundIdx) {
      awardPlaylistGuessRound({
        votesByUid: gatherVotes(),
        resolveName: nameForPlayerId,
      });
      lastScoredRoundIdx = roundIdx;
    }
    revealSummary = buildSummary(gatherVotes());
    await commitPlaylistGuessPlay(
      {
        phase: "reveal",
        voteEndsAt: null,
        roundScored: true,
      },
      { withEveningScores: mp && canActAsHost() }
    );
    phase = "reveal";
  }

  async function tryAdvanceToReveal() {
    if (!mp || phase !== "voting" || revealAdvancing) return;
    const live = getPlaylistGuessSession();
    if (!allPlaylistGuessVotesIn(live) || !canActAsHost()) return;
    if (live.phase === "reveal" || live.roundScored) return;
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
    if (!revealSummary) {
      revealSummary = buildSummary(gatherVotes());
    }
  }

  /** Filet de sécurité hôte : clôt la manche même si un joueur n'a pas voté. */
  async function forceReveal() {
    if (mp && !canActAsHost()) return;
    if (getPlaylistGuessSession().phase === "reveal" || phase === "reveal") return;
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

  async function nextRound() {
    if (mp && !canActAsHost()) return;

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
    }
    roundIdx = next;
    phase = "voting";
    selected = null;
    roundScored = false;
    revealSummary = null;
    render();
    scrollToTopForRound(true);
  }

  function render() {
    syncFromSession();
    ensureRevealDisplay();

    const round = currentRound();
    const total = deck.length;
    if (!round) {
      app.innerHTML = pageShell({
        backTarget: "back",
        scroll: true,
        content: `<p class="hint">Chargement de la manche…</p>`,
      });
      bindNav(app);
      return;
    }

    const players = lobbyPlayersWithIds();
    let body = "";

    if (phase === "voting") {
      const votesNow = getEffectivePlaylistGuessVotes(getPlaylistGuessSession());
      const committedVote = votesNow[localUid];
      const displayPick = selected !== null ? selected : committedVote ?? null;
      const hasCommitted = mp && committedVote != null;
      body = `
          ${songGuessCardHtml(round, { players, selectedPlayerId: displayPick })}
          <p class="hint">${hasCommitted && selected === null ? "Vote enregistré — tu peux encore modifier avant la révélation." : "Choisis le propriétaire de la playlist."}</p>
          <button type="button" class="btn btn-primary" id="confirm" ${displayPick == null ? "disabled" : ""}>${hasCommitted && selected === null ? "Modifier mon vote" : "Valider mon vote"}</button>
          <div class="screen-bottom-spacer" aria-hidden="true"></div>`;
      if (!mp || canActAsHost()) {
        const votedCount = Object.keys(votesNow).length;
        body += `
          <button type="button" class="btn btn-secondary btn--spaced" id="playlist-force">
            Révéler maintenant (${votedCount} vote${votedCount > 1 ? "s" : ""})
          </button>`;
      }
      if (mp) {
        body += gameCumulativeScoresHtml({
          gameId: "playlistguess",
          gameLabel: "VibeCheck",
          title: "Cumul des scores",
        });
      }
    }

    if (phase === "reveal" && revealSummary) {
      body = `
        ${revealResultCardHtml(revealSummary)}
        ${gameCumulativeScoresHtml({
          gameId: "playlistguess",
          gameLabel: "VibeCheck",
          title: "Cumul des scores",
        })}
        ${
          !mp || canActAsHost()
            ? `<button type="button" class="btn btn-primary btn--spaced" id="next-round">
          ${roundIdx >= total - 1 ? "Voir les résultats →" : "Manche suivante →"}
        </button>`
            : `<p class="hint">En attente de l'hôte pour la suite…</p>`
        }`;
    }

    app.innerHTML = pageShell({
      backTarget: "back",
      scroll: true,
      content: `
        <div class="game-header">
          <div class="dots">${Array.from({ length: total }, (_, i) =>
            `<span class="dot ${i === roundIdx ? "dot--active" : i < roundIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${roundIdx + 1}/${total}</span>
        </div>
        <div class="logo logo--sm"><h1>VIBECHECK</h1></div>
        ${body}
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app);

    app.querySelectorAll("[data-vote-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (isEveningGameplayPaused()) return;
        selected = btn.getAttribute("data-vote-id");
        render();
      });
    });

    app.querySelector("#confirm")?.addEventListener("click", async () => {
      if (selected === null) return;
      if (mp) {
        await commitPlaylistGuessVote(selected);
        render();
        await tryAdvanceToReveal();
      } else {
        phase = "reveal";
        await transitionToReveal();
        render();
      }
    });

    app.querySelector("#playlist-force")?.addEventListener("click", () => void forceReveal());

    app.querySelector("#next-round")?.addEventListener("click", () => void nextRound());
  }

  /** Filet si le cache session a avancé avant playlistGuessGame local (sync Realtime / merge). */
  function reconcilePhaseFromCachedSession() {
    if (!mp) return;
    const remote = getCachedGameSession()?.state?.playlistGuess;
    if (!remote?.phase || remote.phase === phase) return;
    phase = remote.phase;
    if (remote.roundIdx != null) roundIdx = remote.roundIdx;
    if (remote.phase === "reveal") {
      roundScored = Boolean(remote.roundScored);
    } else if (remote.phase === "voting") {
      roundScored =
        Boolean(remote.roundScored) && Object.keys(remote.votes || {}).length > 0
          ? Boolean(remote.roundScored)
          : false;
    }
  }

  function onSyncUpdate(row = getCachedGameSession()) {
    if (stopGameSessionListenerOnPostGame(row)) return;

    const prevIdx = roundIdx;
    const prevPhase = phase;
    syncFromSession();
    reconcilePhaseFromCachedSession();

    const newRoundStarted = mp && roundIdx !== prevIdx;
    const enteredVotingFromReveal = mp && phase === "voting" && prevPhase === "reveal";
    const enteredRevealFromVoting = mp && phase === "reveal" && prevPhase === "voting";

    if (newRoundStarted || enteredVotingFromReveal) {
      revealSummary = null;
      selected = null;
      render();
      scrollToTopForRound(true);
      return;
    }

    if (enteredRevealFromVoting) {
      ensureRevealDisplay();
      render();
      return;
    }

    void tryAdvanceToReveal();

    if (phase === "voting" && roundIdx === prevIdx && prevPhase === "voting") {
      refreshGameScoresBox(app, {
        gameId: "playlistguess",
        gameLabel: "VibeCheck",
        title: "Cumul des scores",
      });
      const votesNow = getEffectivePlaylistGuessVotes();
      const forceBtn = app.querySelector("#playlist-force");
      if (forceBtn) {
        const votedCount = Object.keys(votesNow).length;
        forceBtn.textContent = `Révéler maintenant (${votedCount} vote${votedCount > 1 ? "s" : ""})`;
      }
    }

    if (phase === "reveal") {
      ensureRevealDisplay();
    }

    render();
  }

  const unsub = onGameSessionChange(onSyncUpdate);

  setActiveScoringGame("playlistguess");

  if (mp) {
    onSyncUpdate();
  } else {
    render();
  }

  return () => {
    unsub();
    if (!mp) setLobbyWaiting();
  };
}
