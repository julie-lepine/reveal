/**
 * ARCH-03 — notification ponctuelle quand le joueur devient acting host technique.
 * Ne confond pas avec le claim permanent ARCH-03b ni le toast « Tu es maintenant l'hôte ».
 * Aucune mutation serveur.
 */
import {
  getActingHostUserId,
  getActingHostUiRefreshToken,
  getCachedGameSession,
  isGameSyncActive,
  isLobbyHost,
  POST_GAME_SCREENS,
} from "./gameSync.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getCurrentScreen } from "./router.js";
import { showAppAlert } from "./dialog.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";
import { arch03LiveLog, decideActingHostNotice, hostAgeMs } from "./presenceUiLive.js";
import { getState } from "./state.js";

/** null = pas encore seedé depuis un bundle lobby. */
let wasActing = null;
/** Tokens pour lesquels la notif a été affichée (ack post-display uniquement). */
const notifiedTokens = new Set();
/** Élection vue hors manche : à flush au prochain écran de jeu. */
let pendingNoticeToken = null;
let noticeOpen = false;
let bundleUnsub = null;

function resetActingHostNoticeState() {
  wasActing = null;
  notifiedTokens.clear();
  pendingNoticeToken = null;
  noticeOpen = false;
}

function isLocalActingNow() {
  const uid = getSupabaseUserId();
  if (!uid) return false;
  return getActingHostUserId() === uid;
}

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

function hostAgeFromLobby() {
  const lobby = getState().lobby;
  const host =
    (lobby?.participants || []).find((p) => p.userId === lobby?.hostId) ||
    (lobby?.participants || []).find((p) => p.isHost);
  return hostAgeMs(host?.lastSeenAt);
}

/** @returns {Promise<boolean>} true si la modale a été présentée */
async function showActingHostNotice() {
  if (noticeOpen) return false;
  noticeOpen = true;
  arch03LiveLog("ARCH03-LIVE", "notice requested/shown", {
    phase: "requested",
    localUserId: getSupabaseUserId() || null,
    token: pendingNoticeToken ?? getActingHostUiRefreshToken(),
    currentScreen: getCurrentScreen(),
    hostAgeMs: hostAgeFromLobby(),
  });
  try {
    await showAppAlert(
      "Vous pouvez terminer cette manche pour que la partie continue.",
      {
        title: "L'hôte semble inactif",
        confirmLabel: "Compris",
        icon: "⏳",
      }
    );
    arch03LiveLog("ARCH03-LIVE", "notice requested/shown", {
      phase: "shown",
      localUserId: getSupabaseUserId() || null,
      currentScreen: getCurrentScreen(),
    });
    return true;
  } catch {
    return false;
  } finally {
    noticeOpen = false;
  }
}

async function presentNoticeForToken(token) {
  if (!Number.isFinite(token) || notifiedTokens.has(token)) return false;
  const shown = await showActingHostNotice();
  if (shown) {
    notifiedTokens.add(token);
    if (pendingNoticeToken === token) pendingNoticeToken = null;
    arch03LiveLog("ARCH03-LIVE", "notice token current/acked", {
      current: token,
      acked: true,
      ackedTokens: [...notifiedTokens],
      localUserId: getSupabaseUserId() || null,
    });
  }
  return shown;
}

/**
 * Si un nudge est arrivé hors manche / avant que l'écran jeu soit prêt.
 * Appelé après élection et au seed lobby en session active.
 */
export function flushPendingActingHostNotice() {
  if (!isGameSyncActive() || isLobbyHost()) return;
  if (!Number.isFinite(pendingNoticeToken)) return;
  if (!isLocalActingNow()) {
    pendingNoticeToken = null;
    return;
  }
  if (!isInActivePlaySession()) return;
  const token = pendingNoticeToken;
  arch03LiveLog("ARCH03-LIVE", "notice token current/acked", {
    current: token,
    acked: notifiedTokens.has(token),
    pendingFlush: true,
    localUserId: getSupabaseUserId() || null,
    currentScreen: getCurrentScreen(),
  });
  void presentNoticeForToken(token);
}

/**
 * Appelé après incrément du token d'élection (nudge acting host).
 */
export function onActingHostElection(token) {
  if (!isGameSyncActive()) {
    resetActingHostNoticeState();
    return;
  }

  const acting = isLocalActingNow();
  const prev = wasActing;
  const decision = decideActingHostNotice({
    wasActing: prev,
    isActing: acting,
    isRealHost: isLobbyHost(),
    token,
    ackedTokens: notifiedTokens,
    inActivePlaySession: isInActivePlaySession(),
  });

  arch03LiveLog("ARCH03-LIVE", "acting transition", {
    localUserId: getSupabaseUserId() || null,
    oldActing: prev,
    newActing: acting,
    became: decision.show || decision.pending,
    hostAgeMs: hostAgeFromLobby(),
    currentScreen: getCurrentScreen(),
    token,
    acked: notifiedTokens.has(token),
    inActivePlaySession: isInActivePlaySession(),
  });

  wasActing = decision.nextWasActing;

  // Plus acting (hôte revenu, autre élu…) : abandonner le pending sans afficher
  if (!acting) {
    pendingNoticeToken = null;
    return;
  }

  if (decision.pending) {
    pendingNoticeToken = token;
    return;
  }
  if (!decision.show) return;

  pendingNoticeToken = token;
  void presentNoticeForToken(token);
}

export function initActingHostNoticeListener() {
  resetActingHostNoticeState();
  if (isGameSyncActive()) {
    wasActing = isLocalActingNow();
  }

  if (bundleUnsub) {
    bundleUnsub();
    bundleUnsub = null;
  }
  bundleUnsub = onLobbyBundleUpdated(() => {
    if (!isGameSyncActive()) {
      resetActingHostNoticeState();
      return;
    }
    // Seed silencieux dès que le lobby est connu (avant le nudge d'élection)
    if (wasActing === null) {
      wasActing = isLocalActingNow();
      arch03LiveLog("ARCH03-LIVE", "notice token current/acked", {
        phase: "seed",
        wasActing,
        token: getActingHostUiRefreshToken(),
        localUserId: getSupabaseUserId() || null,
        currentScreen: getCurrentScreen(),
      });
    }
    flushPendingActingHostNotice();
  });
}
