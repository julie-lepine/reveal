import {
  getPlaylistGuessEntryScreen,
  getPlaylistGuessSession,
  getPlaylistGuessDeck,
  getCurrentPlaylistGuessRound,
  commitPlaylistGuessPlay,
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
import { pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
// FIL_ROUGE (Mot interdit) — pause soirée ; isEveningGameplayPaused() = false si désactivé
import { isEveningGameplayPaused } from "../core/filRougeSession.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  completeGameSession,
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

  setLobbyPlaying("playlistguess");

  const mp = isGameSyncActive();
  const localUid = getLocalParticipantId();

  let roundIdx = 0;
  let phase = "voting";
  let selected = null;
  let roundScored = false;
  let revealSummary = null;
  let revealAdvancing = false;
  let lastScoredRoundIdx = -1;

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
    if (mp && !isLobbyHost()) return;

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
    if (!allPlaylistGuessVotesIn(live) || !isLobbyHost()) return;
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
    if (mp && !isLobbyHost()) return;
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
    }
    roundIdx = next;
    phase = "voting";
    selected = null;
    roundScored = false;
    revealSummary = null;
    render();
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

    const players = lobbyPlayersWithIds();
    let body = "";

    if (phase === "voting") {
      const votesNow = getEffectivePlaylistGuessVotes(getPlaylistGuessSession());
      const alreadyVoted = mp && votesNow[localUid] != null;
      if (alreadyVoted) {
        body = `
          ${songGuessCardHtml(round, { players, selectedPlayerId: selected, readonly: true })}
          <p class="hint">Vote enregistré - en attente des autres…</p>`;
      } else {
        body = `
          ${songGuessCardHtml(round, { players, selectedPlayerId: selected })}
          <button type="button" class="btn btn-primary" id="confirm" ${selected === null ? "disabled" : ""}>Valider mon vote</button>`;
      }
      if (!mp || isLobbyHost()) {
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
        <p class="label-upper label-upper--purple">🎵 Manche ${roundIdx + 1}/${total}</p>
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
        const votes = { ...getEffectivePlaylistGuessVotes(), [localUid]: selected };
        await commitPlaylistGuessPlay({ votes });
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

  function onSyncUpdate() {
    const prevIdx = roundIdx;
    const prevPhase = phase;
    syncFromSession();
    const advanced =
      mp && (roundIdx !== prevIdx || (phase === "voting" && prevPhase === "reveal"));
    if (advanced) {
      revealSummary = null;
      selected = phase === "voting" ? null : selected;
      render();
      return;
    }
    if (phase === "reveal" && !revealSummary) {
      ensureRevealDisplay();
    }
    void tryAdvanceToReveal();
    if (phase === "reveal" || phase === "voting") {
      refreshGameScoresBox(app, {
        gameId: "playlistguess",
        gameLabel: "VibeCheck",
        title: "Cumul des scores",
      });
      if (phase === "voting" && roundIdx === prevIdx && prevPhase === phase) {
        const votesNow = getEffectivePlaylistGuessVotes();
        const forceBtn = app.querySelector("#playlist-force");
        if (forceBtn) {
          const votedCount = Object.keys(votesNow).length;
          forceBtn.textContent = `Révéler maintenant (${votedCount} vote${votedCount > 1 ? "s" : ""})`;
        }
        const alreadyVoted = votesNow[localUid] != null;
        if (alreadyVoted) return;
      }
      if (phase === "reveal" && revealSummary) return;
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
