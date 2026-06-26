/** Toast persistant : prévient un joueur quand il devient l'hôte du lobby. */
import { getState } from "./state.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";

const TOAST_ID = "host-notice-toast";

// null = pas (encore) dans un lobby ; true/false = état hôte connu dans le lobby courant.
let wasHost = null;

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
  // Hors lobby : on oublie l'état (la création d'un lobby ne doit pas déclencher la toast).
  if (!isInLobby()) {
    wasHost = null;
    hideToast();
    return;
  }

  const isHost = isLocalHostNow();
  // Transition « invité → hôte » au sein d'un même lobby : désignation réelle.
  if (wasHost === false && isHost) showHostToast();
  wasHost = isHost;
}

export function initHostNoticeListener() {
  wasHost = isInLobby() ? isLocalHostNow() : null;
  onLobbyBundleUpdated(onLobbyUpdate);
}
