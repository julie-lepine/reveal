import {
  PLAYLIST_GUESS_ROUND_PRESETS,
  PLAYLIST_GUESS_ROUND_DEFAULT,
  allPlaylistGuessReady,
  canUseDevTrackFallback,
  connectAndSyncSpotifyLibrary,
  disconnectLocalSpotify,
  getLocalParticipantId,
  getPlaylistGuessPrepSummary,
  getPlaylistGuessSession,
  isLocalPlaylistGuessHost,
  isLocalSpotifyReady,
  markPlaylistGuessLobbyStarted,
  setPlaylistGuessReady,
  setPlaylistGuessRoundCount,
  toggleLocalPlaylistGuessReady,
} from "../core/playlistGuessSession.js";
import { isSpotifyConnected } from "../core/spotifyAuth.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { isGameSyncActive, isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { spotifyConnectCardHtml, spotifyErrorLabel } from "../playlistguess/SpotifyConnectCard.js";
import { prepStartSlotHtml } from "../core/prepScreen.js";

export function mountPlaylistGuessPrep(app) {
  if (!requireLobbyPlay()) return null;

  let connectLoading = false;
  let readyCommitInFlight = null;
  const localName = getLocalDisplayName();
  const localUid = getLocalParticipantId();

  function localReadyState() {
    if (readyCommitInFlight !== null) return readyCommitInFlight;
    return Boolean(getPlaylistGuessSession().ready[localUid]);
  }

  function memberSpotifyLine(m) {
    const session = getPlaylistGuessSession();
    const meta = session.spotifyByUid?.[m.userId || m.name];
    const count = session.librariesByUid?.[m.userId || m.name]?.length || 0;
    if (meta?.errorCode) {
      return `<span class="muted">${escapeHtml(spotifyErrorLabel(meta.errorCode))}</span>`;
    }
    if (meta?.connected && count > 0) {
      return `<span class="hint hint--ok">Spotify · ${count} titres</span>`;
    }
    return `<span class="muted">Spotify…</span>`;
  }

  function refreshReadySection() {
    const session = getPlaylistGuessSession();
    const members = getLobbyParticipants();
    const allReady = allPlaylistGuessReady();
    const localReady = localReadyState();
    const prep = getPlaylistGuessPrepSummary();
    const isHost = isLocalPlaylistGuessHost();

    const playersCard = app.querySelector("#pg-players");
    if (playersCard) {
      playersCard.innerHTML = `
        <p class="card-heading">Joueurs prêts</p>
        ${members
          .map((m) => {
            const uid = m.userId || m.name;
            return `
          <div class="lobby-player ${session.ready[uid] ? "lobby-player--ready" : ""}">
            <span class="lobby-player__status">${session.ready[uid] ? "✓" : "…"}</span>
            <span class="lobby-player__name">${escapeHtml(m.name)}</span>
            ${memberSpotifyLine({ ...m, userId: uid })}
          </div>`;
          })
          .join("")}`;
    }

    const readyBtn = app.querySelector("#btn-ready");
    if (readyBtn) {
      readyBtn.classList.toggle("btn-ready--active", Boolean(localReady));
      readyBtn.textContent = localReady ? "Prêt ✓" : "Je suis prêt !";
      readyBtn.disabled = !isLocalSpotifyReady() && !canUseDevTrackFallback();
    }

    const startSlot = app.querySelector("#pg-start-slot");
    if (startSlot) {
      let poolLabel = "En attente des joueurs…";
      if (!prep.validation.ok) {
        if (prep.validation.error === "DUPLICATE_POOL_ONLY") {
          poolLabel = "Pas assez de titres uniques";
        } else if (prep.validation.error === "INSUFFICIENT_POOL") {
          poolLabel = "Pool insuffisant pour les manches";
        }
      } else if (prep.poolSize === 0) {
        poolLabel = "Aucun titre — connecte Spotify";
      }

      startSlot.innerHTML = prepStartSlotHtml({
        poolEmpty: prep.poolSize === 0 || !prep.validation.ok,
        poolEmptyLabel: poolLabel,
        allReady,
        isHost: isHost && isLobbyHost(),
        launchLabel: "Lancer la partie →",
      });
      startSlot.querySelector("#btn-start-game")?.addEventListener("click", onStartGame);
    }

    const poolHint = app.querySelector("#pg-pool-hint");
    if (poolHint) {
      poolHint.textContent = `${prep.poolSize} titre(s) unique(s) · ${prep.connectedCount}/${prep.playerCount} bibliothèque(s)`;
    }
  }

  function refreshSpotifyCard() {
    const slot = app.querySelector("#pg-spotify-slot");
    if (!slot) return;
    const session = getPlaylistGuessSession();
    const meta = session.spotifyByUid?.[localUid];
    const connected = Boolean(meta?.connected) || isSpotifyConnected();
    const trackCount = session.librariesByUid?.[localUid]?.length || meta?.trackCount || 0;
    slot.innerHTML = spotifyConnectCardHtml({
      connected: isLocalSpotifyReady() || (connected && trackCount > 0),
      trackCount,
      loading: connectLoading,
      errorCode: session.connectError || meta?.errorCode || null,
      devMode: canUseDevTrackFallback(),
    });
    slot.querySelector("#btn-spotify-connect")?.addEventListener("click", onConnect);
    slot.querySelector("#btn-spotify-disconnect")?.addEventListener("click", onDisconnect);
  }

  function refreshRoundChips() {
    const session = getPlaylistGuessSession();
    const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
    const isHost = isLocalPlaylistGuessHost();
    app.querySelectorAll("[data-pg-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-pg-round"));
      btn.classList.toggle("theme-chip--active", roundCount === value);
      btn.disabled = !isHost;
    });
  }

  async function onConnect() {
    if (canUseDevTrackFallback()) {
      connectLoading = true;
      refreshSpotifyCard();
      try {
        await connectAndSyncSpotifyLibrary();
      } catch {
        /* error in card */
      } finally {
        connectLoading = false;
        refreshSpotifyCard();
        refreshReadySection();
      }
      return;
    }
    const { connectSpotify } = await import("../core/spotifyAuth.js");
    await connectSpotify("playlistguess-prep");
  }

  async function onDisconnect() {
    connectLoading = true;
    refreshSpotifyCard();
    try {
      await disconnectLocalSpotify();
    } finally {
      connectLoading = false;
      refreshSpotifyCard();
      refreshReadySection();
    }
  }

  async function onStartGame() {
    if (!isLobbyHost()) return;
    try {
      await markPlaylistGuessLobbyStarted();
      navigate("playlistguess", {
        navStack: ["home", "lobby", "game-select", "playlistguess-prep", "playlistguess"],
      });
    } catch (e) {
      const { showAppAlert } = await import("../core/dialog.js");
      await showAppAlert(spotifyErrorLabel(e.message) || e.message || "Impossible de lancer.", {
        title: "VibeCheck",
        icon: "⚠️",
      });
    }
  }

  async function onReadyClick() {
    const nextReady = !localReadyState();
    if (nextReady && !isLocalSpotifyReady() && !canUseDevTrackFallback()) return;
    readyCommitInFlight = nextReady;
    refreshReadySection();
    try {
      const res = await toggleLocalPlaylistGuessReady();
      if (!res.ok && res.error === "SPOTIFY_REQUIRED") {
        const { showAppAlert } = await import("../core/dialog.js");
        await showAppAlert("Connecte Spotify avant de te déclarer prêt.", {
          title: "Spotify requis",
          icon: "🎵",
        });
      }
    } finally {
      readyCommitInFlight = null;
      refreshReadySection();
    }
  }

  function render() {
    const session = getPlaylistGuessSession();
    const roundCount = session.roundCount ?? PLAYLIST_GUESS_ROUND_DEFAULT;
    const isHost = isLocalPlaylistGuessHost();
    const localReady = localReadyState();

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--purple">🎵 VibeCheck</p>
        <h2 class="screen-title">Préparation</h2>
        <p class="game-intro">Une chanson tirée des likes Spotify du groupe — devine qui l'a aimée.</p>

        <div id="pg-spotify-slot"></div>

        <div class="card">
          <p class="card-heading">Nombre de manches</p>
          <div class="theme-chips theme-chips--rounds">
            ${PLAYLIST_GUESS_ROUND_PRESETS.map(
              (n) => `
              <button type="button" class="theme-chip ${roundCount === n ? "theme-chip--active" : ""}"
                data-pg-round="${n}" ${!isHost ? "disabled" : ""}>${n}</button>`
            ).join("")}
          </div>
          <p class="hint" id="pg-pool-hint" aria-live="polite"></p>
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier les réglages.</p>` : ""}
        </div>

        <div class="card" id="pg-players"></div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="pg-start-slot"></div>
      `,
    });

    bindNav(app);
    refreshSpotifyCard();
    refreshRoundChips();
    refreshReadySection();

    app.querySelectorAll("[data-pg-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLocalPlaylistGuessHost()) return;
        await setPlaylistGuessRoundCount(Number(btn.getAttribute("data-pg-round")));
        render();
      });
    });

    app.querySelector("#btn-ready")?.addEventListener("click", onReadyClick);
  }

  async function afterOAuthReturn() {
    if (!isSpotifyConnected()) return;
    connectLoading = true;
    render();
    try {
      await connectAndSyncSpotifyLibrary();
    } catch {
      /* shown in card */
    } finally {
      connectLoading = false;
      render();
    }
  }

  render();
  void afterOAuthReturn();
  if (canUseDevTrackFallback()) {
    import("../core/playlistGuessSession.js").then(({ ensureDevLibrariesForSolo }) => {
      void ensureDevLibrariesForSolo().then(() => {
        refreshSpotifyCard();
        refreshReadySection();
      });
    });
  }

  const unsub = onGameSessionChange(() => {
    refreshSpotifyCard();
    refreshRoundChips();
    refreshReadySection();
  });

  return () => unsub();
}
