/** Toast persistant : prévient un joueur quand il devient l'hôte du lobby. */
import { getState } from "./state.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";
import { decideHostNotice } from "./hostNoticeLogic.js";

const TOAST_ID = "host-notice-toast";

// null = pas (encore) dans un lobby ; true/false = état hôte connu dans le lobby courant.
let wasHost = null;
let lastLobbyId = null;

function isInLobby() {
  return Boolean(getState().inLobby && getState().lobby?.id);
}

function isLocalHostNow() {
  const lobby = getState().lobby;
  if (!lobby) return false;
  const uid = getSupabaseUserId();
  if (uid && lobby.hostId) return uid === lobby.hostId;
  return Boolean(lobby.participants?.find((p) => p.isLocal)?.isHost);
}

function hideToast() {
  document.getElementById(TOAST_ID)?.remove();
}

function applyHostNoticeDecision(decision) {
  wasHost = decision.wasHost;
  lastLobbyId = decision.lastLobbyId;
  if (decision.hide) hideToast();
  if (decision.show) showHostToast();
}

function showHostToast() {
  if (document.getElementById(TOAST_ID)) return;

  const root = document.createElement("div");
  root.id = TOAST_ID;
  root.className = "host-notice-toast";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `
    <div class="host-notice-toast__inner">
      <span class="host-notice-toast__emoji" aria-hidden="true">👑</span>
      <div class="host-notice-toast__text">
        <p class="host-notice-toast__title">Tu es maintenant l'hôte</p>
        <p class="host-notice-toast__sub">C'est toi qui lances les parties et gères la soirée.</p>
      </div>
      <button type="button" class="host-notice-toast__close" aria-label="Fermer">×</button>
    </div>`;

  document.body.prepend(root);
  requestAnimationFrame(() => root.classList.add("host-notice-toast--in"));

  root.querySelector(".host-notice-toast__close")?.addEventListener("click", () => hideToast());
}

function onLobbyUpdate() {
  applyHostNoticeDecision(
    decideHostNotice({
      inLobby: isInLobby(),
      lobbyId: getState().lobby?.id || null,
      lastLobbyId,
      wasHost,
      isHost: isLocalHostNow(),
    })
  );
}

/** Appelé au switch de salon (invite) pour ne pas reporter le toast. */
export function resetHostNoticeOnLobbySwitch() {
  applyHostNoticeDecision(
    decideHostNotice({
      inLobby: false,
      lobbyId: null,
      lastLobbyId,
      wasHost,
      isHost: false,
    })
  );
}

export function initHostNoticeListener() {
  const inLobby = isInLobby();
  lastLobbyId = inLobby ? getState().lobby?.id || null : null;
  wasHost = inLobby ? isLocalHostNow() : null;
  onLobbyBundleUpdated(onLobbyUpdate);
}
