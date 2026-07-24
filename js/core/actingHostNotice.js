/**
 * ARCH-03 — notification ponctuelle quand le joueur devient acting host technique.
 * Ne confond pas avec le claim permanent ARCH-03b ni le toast « Tu es maintenant l'hôte ».
 * Aucune mutation serveur.
 */
import {
  getActingHostUserId,
  getCachedGameSession,
  isGameSyncActive,
  isLobbyHost,
  POST_GAME_SCREENS,
} from "./gameSync.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getCurrentScreen } from "./router.js";
import { showAppAlert } from "./dialog.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";

/** null = pas encore initialisé (pas de toast au seed). */
let wasActing = null;
/** Tokens pour lesquels la notif a été **affichée** (ack post-display uniquement). */
const notifiedTokens = new Set();
let noticeOpen = false;
let bundleUnsub = null;

function resetActingHostNoticeState() {
  wasActing = null;
  notifiedTokens.clear();
  noticeOpen = false;
}

function isLocalActingNow() {
  const uid = getSupabaseUserId();
  if (!uid) return false;
  return getActingHostUserId() === uid;
}

/** Uniquement pendant une manche / session de jeu active (pas hub, pas post-partie). */
function isInActivePlaySession() {
  const row = getCachedGameSession();
  const sessionScreen = row?.screen;
  if (!sessionScreen) return false;
  if (POST_GAME_SCREENS.has(sessionScreen)) return false;

  const local = getCurrentScreen();
  if (
    !local ||
    local === "game-select" ||
    local === "lobby" ||
    local === "home" ||
    local === "results" ||
    local === "leaderboard"
  ) {
    return false;
  }
  return true;
}

/** @returns {Promise<boolean>} true si la modale a été présentée */
async function showActingHostNotice() {
  if (noticeOpen) return false;
  noticeOpen = true;
  try {
    await showAppAlert(
      "Vous pouvez terminer cette manche pour que la partie continue.",
      {
        title: "L'hôte semble inactif",
        confirmLabel: "Compris",
        icon: "⏳",
      }
    );
    return true;
  } catch {
    return false;
  } finally {
    noticeOpen = false;
  }
}

/**
 * Appelé après incrément du token d'élection (nudge acting host).
 * Une seule notification par token, uniquement sur transition non-acting → acting.
 * L'ack token n'est enregistré qu'après affichage effectif.
 */
export function onActingHostElection(token) {
  if (!isGameSyncActive()) {
    resetActingHostNoticeState();
    return;
  }

  const acting = isLocalActingNow();
  // Seed : mémoriser sans afficher ni ack (évite toast au mount / F5 mid-élection)
  if (wasActing === null) {
    wasActing = acting;
    return;
  }

  const becameActing = wasActing === false && acting === true;
  wasActing = acting;

  if (!becameActing) return;
  if (isLobbyHost()) return; // vrai hôte : jamais cette notif
  if (!Number.isFinite(token) || notifiedTokens.has(token)) return;
  // Hors manche : pas d'affichage, pas d'ack (une future élection / nouveau token pourra notifier)
  if (!isInActivePlaySession()) return;

  void (async () => {
    const shown = await showActingHostNotice();
    if (shown) notifiedTokens.add(token);
  })();
}

export function initActingHostNoticeListener() {
  resetActingHostNoticeState();
  wasActing = isGameSyncActive() ? isLocalActingNow() : null;
  // Ne pas pré-ack le token courant : le seed wasActing suffit pour bloquer un faux toast.

  if (bundleUnsub) {
    bundleUnsub();
    bundleUnsub = null;
  }
  bundleUnsub = onLobbyBundleUpdated(() => {
    // Sortie de session / lobby : purger l'état pour ne pas survivre au prochain lobby
    if (!isGameSyncActive()) {
      resetActingHostNoticeState();
    }
  });
}
