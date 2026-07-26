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
import { gameCumulativeScoresHtml } from "../core/gameScores.js";
import {
  setLastGame,
  recordPlaylistGuessPlayed,
  setActiveScoringGame,
} from "../core/state.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell, resetPageScroll } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import { withClickLock, createActionLock } from "../core/actionLock.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import {
  isGameSyncActive,
  canActAsHost,
  isLobbyHost,
  onGameSessionChange,
  completeGameSession,
  getCachedGameSession,
  stopGameSessionListenerOnPostGame,
} from "../core/gameSync.js";
import { voteConfirmChrome, pickForVoteConfirm } from "../core/voteConfirm.js";
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
  /** Vote validé (session). */
  let myVote = null;
  /** Choix local avant « Valider mon vote ». */
  let selected = null;
  let voteCommitInFlight = null;
  let roundScored = false;
  let revealSummary = null;
  let revealAdvancing = false;
  let lastScoredRoundIdx = -1;
  let lastScrollKey = "";
  const mount = createMountGuard();
  /** ARCH-06 : partagé entre re-binds après render (pas un verrou DOM seul). */
  const nextRoundLock = createActionLock();
  const forceRevealLock = createActionLock();

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
    const serverPick = votesByUid[localUid] ?? null;

    if (roundIdx !== prevIdx || (phase === "voting" && prevPhase === "reveal")) {
      selected = null;
      myVote = serverPick;
      lastScoredRoundIdx = -1;
    } else if (phase !== "voting") {
      selected = null;
      myVote = null;
    } else if (voteCommitInFlight != null) {
      myVote = voteCommitInFlight;
    } else {
      myVote = serverPick;
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

  function localPick() {
    return pickForVoteConfirm(selected, myVote);
  }

  function gatherVotes() {
    const round = currentRound();
    const s = getPlaylistGuessSession();
    const all = mp
      ? { ...getEffectivePlaylistGuessVotes(s) }
      : { ...simulatePlaylistGuessVotes(round, localPick()) };
    const pick = localPick();
    if (pick != null) all[localUid] = pick;
    return all;
  }

  function countPlayersVoted(votesMap = getEffectivePlaylistGuessVotes()) {
    const base = { ...votesMap };
    if (voteCommitInFlight != null) base[localUid] = voteCommitInFlight;
    else if (myVote != null) base[localUid] = myVote;
    return lobbyPlayersWithIds().filter((p) => {
      const pick = base[p.userId];
      return pick != null && pick !== "";
    }).length;
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
      { withEveningScores: mp && isLobbyHost() }
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
      if (mount.isMounted() && mount.isCurrentMount()) render();
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
        if (mount.isMounted() && mount.isCurrentMount()) render();
      } finally {
        revealAdvancing = false;
      }
    } else {
      phase = "reveal";
      await transitionToReveal();
      if (mount.isMounted() && mount.isCurrentMount()) render();
    }
  }

  async function submitVote(pick) {
    if (pick == null || voteCommitInFlight != null) return;
    if (mp) {
      voteCommitInFlight = pick;
      render();
      try {
        await commitPlaylistGuessVote(pick);
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
        selected = null;
        myVote = pick;
      } catch {
        // Feedback déjà affiché ; l’état revient via syncFromSession.
      } finally {
        voteCommitInFlight = null;
        if (mount.isMounted() && mount.isCurrentMount()) syncFromSession();
      }
      if (!mount.isMounted()) return;
      if (!mount.isCurrentMount()) return;
      await tryAdvanceToReveal();
      if (mount.isMounted() && mount.isCurrentMount() && phase !== "reveal") render();
    } else {
      myVote = pick;
      selected = null;
      phase = "reveal";
      await transitionToReveal();
      if (mount.isMounted() && mount.isCurrentMount()) render();
    }
  }

  async function nextRound() {
    if (mp && !canActAsHost()) return;
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;

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
          if (!mount.isMounted()) return;
          if (!mount.isCurrentMount()) return;
          navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
        }
      } else {
        setLobbyWaiting();
        if (!mount.isMounted()) return;
        if (!mount.isCurrentMount()) return;
        navigate("results");
      }
      return;
    }

    const next = roundIdx + 1;
    if (mp) {
      await startPlaylistGuessRound(next);
    }
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    roundIdx = next;
    phase = "voting";
    selected = null;
    myVote = null;
    roundScored = false;
    revealSummary = null;
    render();
    scrollToTopForRound(true);
  }

  function votingPhaseHtml(round, players) {
    const votesNow = getEffectivePlaylistGuessVotes(getPlaylistGuessSession());
    const votedCount = countPlayersVoted(votesNow);
    const totalPlayers = players.length;
    const allIn = mp ? allPlaylistGuessVotesIn() : false;
    const confirm = voteConfirmChrome({
      selected,
      committed: myVote,
      allIn,
      emptyHint: "Choisis le propriétaire de la playlist.",
    });
    const waitingHint =
      myVote != null && !confirm.hasPendingChange && !allIn && mp
        ? `Vote enregistré - en attente des autres (${votedCount}/${totalPlayers})…`
        : confirm.hint;
    const host = !mp || canActAsHost();

    return `
      ${songGuessCardHtml(round, { players, selectedPlayerId: confirm.displayPick })}
      <p class="hint">${escapeHtml(waitingHint)}</p>
      <button type="button" class="btn ${confirm.confirmClass} btn--spaced" id="confirm"
        ${confirm.confirmDisabled || voteCommitInFlight != null ? "disabled" : ""}>${escapeHtml(
          voteCommitInFlight != null ? "Envoi…" : confirm.confirmLabel
        )}</button>
      ${
        host
          ? `<button type="button" class="btn btn-secondary btn--spaced" id="playlist-force">
              Révéler maintenant (${votedCount}/${totalPlayers})
            </button>`
          : ""
      }
      ${gameExitBarHtml()}
      <div class="screen-bottom-spacer" aria-hidden="true"></div>`;
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
      body = votingPhaseHtml(round, players);
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
        }
        ${gameExitBarHtml()}
        <div class="screen-bottom-spacer" aria-hidden="true"></div>`;
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
      `,
    });

    bindNav(app);
    bindExitGame(app);

    app.querySelectorAll("[data-vote-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (phase !== "voting") return;
        selected = btn.getAttribute("data-vote-id");
        render();
      });
    });

    app.querySelector("#confirm")?.addEventListener("click", () => {
      void submitVote(pickForVoteConfirm(selected, myVote));
    });

    app.querySelector("#playlist-force")?.addEventListener(
      "click",
      withClickLock(() => forceReveal(), { lock: forceRevealLock })
    );

    app.querySelector("#next-round")?.addEventListener(
      "click",
      withClickLock(() => nextRound(), { lock: nextRoundLock })
    );
  }

  function patchVotingChrome() {
    const votesNow = getEffectivePlaylistGuessVotes();
    const votedCount = countPlayersVoted(votesNow);
    const totalPlayers = lobbyPlayersWithIds().length;
    const forceBtn = app.querySelector("#playlist-force");
    if (forceBtn) {
      forceBtn.textContent = `Révéler maintenant (${votedCount}/${totalPlayers})`;
    }
    const allIn = allPlaylistGuessVotesIn();
    const confirm = voteConfirmChrome({
      selected,
      committed: myVote,
      allIn,
      emptyHint: "Choisis le propriétaire de la playlist.",
    });
    const hintEl = app.querySelector(".hint");
    if (hintEl && myVote != null && !confirm.hasPendingChange) {
      hintEl.textContent = allIn
        ? confirm.hint
        : `Vote enregistré - en attente des autres (${votedCount}/${totalPlayers})…`;
    }
    const confirmBtn = app.querySelector("#confirm");
    if (confirmBtn && voteCommitInFlight == null) {
      confirmBtn.textContent = confirm.confirmLabel;
      confirmBtn.disabled = confirm.confirmDisabled;
      confirmBtn.className = `btn ${confirm.confirmClass} btn--spaced`;
    }
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
    if (!mount.isMounted()) return;
    if (!mount.isCurrentMount()) return;
    if (stopGameSessionListenerOnPostGame(row)) return;

    const prevIdx = roundIdx;
    const prevPhase = phase;
    const prevVotesJson = JSON.stringify(getEffectivePlaylistGuessVotes());
    syncFromSession();
    reconcilePhaseFromCachedSession();

    const newRoundStarted = mp && roundIdx !== prevIdx;
    const enteredVotingFromReveal = mp && phase === "voting" && prevPhase === "reveal";
    const enteredRevealFromVoting = mp && phase === "reveal" && prevPhase === "voting";

    if (newRoundStarted || enteredVotingFromReveal) {
      revealSummary = null;
      selected = null;
      myVote = null;
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
      if (app.querySelector("#confirm")) {
        const votesJson = JSON.stringify(getEffectivePlaylistGuessVotes());
        if (votesJson !== prevVotesJson || myVote != null) {
          patchVotingChrome();
        }
        return;
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
    mount.dispose();
    unsub();
    if (!mp) setLobbyWaiting();
  };
}
