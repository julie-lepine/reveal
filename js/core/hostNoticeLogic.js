/**
 * Toast « Tu es maintenant l'hôte » : logique pure (pas de DOM / fetch).
 * Seulement une transition membre → hôte *dans le même lobby*.
 */

export function decideHostNotice({
  inLobby = false,
  lobbyId = null,
  lastLobbyId: prevLobbyId = null,
  wasHost: prevWasHost = null,
  isHost = false,
} = {}) {
  if (!inLobby) {
    return { wasHost: null, lastLobbyId: null, show: false, hide: true };
  }
  if (lobbyId !== prevLobbyId) {
    return { wasHost: isHost, lastLobbyId: lobbyId, show: false, hide: true };
  }
  if (prevWasHost === false && isHost) {
    return { wasHost: true, lastLobbyId: prevLobbyId, show: true, hide: false };
  }
  return { wasHost: isHost, lastLobbyId: prevLobbyId, show: false, hide: false };
}
