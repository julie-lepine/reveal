import { escapeHtml } from "../core/ui.js";

const ERROR_LABELS = {
  SPOTIFY_DISCONNECTED: "Spotify non connecté.",
  NO_LIKED_SONGS: "Aucun titre dans tes likes Spotify.",
  SPOTIFY_TOKEN_EXPIRED: "Session Spotify expirée - reconnecte-toi.",
  SPOTIFY_API_FAILURE: "Impossible de joindre Spotify. Réessaie.",
  SPOTIFY_NOT_CONFIGURED: "Spotify n'est pas configuré sur cette build.",
  SPOTIFY_TOKEN_EXCHANGE_FAILED: "Échec de la connexion Spotify.",
  NOT_ENOUGH_PLAYERS: "Il faut au moins 3 joueurs dans le lobby pour lancer VibeCheck.",
};

export function spotifyErrorLabel(code) {
  return ERROR_LABELS[code] || "Une erreur est survenue.";
}

export function spotifyConnectCardHtml({
  connected,
  trackCount = 0,
  loading = false,
  errorCode = null,
  devMode = false,
}) {
  const status = connected
    ? `<p class="hint hint--ok">✓ ${trackCount} titre${trackCount > 1 ? "s" : ""} synchronisé${trackCount > 1 ? "s" : ""}</p>`
    : `<p class="hint">Connecte ton compte pour partager tes likes (privés).</p>`;

  const err = errorCode
    ? `<p class="hint hint--error" role="alert">${escapeHtml(spotifyErrorLabel(errorCode))}</p>`
    : "";

  const devNote = devMode
    ? `<p class="hint muted">Mode démo local - titres fictifs sans Spotify.</p>`
    : "";

  return `
    <div class="card vibecheck-connect-card">
      <p class="card-heading">Spotify</p>
      <p class="game-intro">Scope : titres que tu as likés sur Spotify.</p>
      ${status}
      ${err}
      ${devNote}
      ${
        connected
          ? `<button type="button" class="btn btn-secondary btn--spaced" id="btn-spotify-disconnect" ${loading ? "disabled" : ""}>
              Déconnecter Spotify
            </button>`
          : `<button type="button" class="btn btn-primary btn--spaced" id="btn-spotify-connect" ${loading ? "disabled" : ""}>
              ${loading ? "Synchronisation…" : "Connecter Spotify"}
            </button>`
      }
    </div>`;
}
