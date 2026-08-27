/**
 * ARCH-03 - notification ponctuelle quand le joueur devient acting host technique.
 * Ne confond pas avec le claim permanent ARCH-03b ni le toast « Tu es maintenant l'hôte ».
 * Aucune mutation serveur.
 */
import {
  getActingHostUserId,
  getActingHostUiRefreshToken,
  getCachedGameSession,
  isGameSyncActive,
  isLobbyHost,
  canActAsHost,
  POST_GAME_SCREENS,
} from "./gameSync.js";
import { getSupabaseUserId } from "./supabaseAuth.js";
import { getCurrentScreen } from "./router.js";
import { showAppAlert, isAppDialogOpen } from "./dialog.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";
import { arch03LiveLog, decideActingHostNotice, hostAgeMs } from "./presenceUiLive.js";
import { getState } from "./state.js";

/** null = pas encore seedé depuis un bundle lobby. */
let wasActing = null;
/** Tokens pour lesquels la notif a été affichée (ack post-display uniquement). */
const notifiedTokens = new Set();
/** Élection vue hors manche / dialog ouvert : à flush plus tard. */
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
    local === "settings" ||
    local === "friends" ||
    local === "privacy" ||
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

function liveSnapshot(extra = {}) {
  return {
    localUserId: getSupabaseUserId() || null,
    actingHostUserId: getActingHostUserId(),
    canActAsHost: canActAsHost(),
    isLobbyHost: isLobbyHost(),
    wasActing,
    token: getActingHostUiRefreshToken(),
    pendingNoticeToken,
    currentScreen: getCurrentScreen(),
    activeSessionScreen: isInActivePlaySession(),
    dialogOpen: isAppDialogOpen(),
    hostAgeMs: hostAgeFromLobby(),
    ...extra,
  };
}

/** @returns {Promise<boolean>} true si la modale a été présentée jusqu'à fermeture */
async function showActingHostNotice(token) {
  if (noticeOpen) return false;
  if (isAppDialogOpen()) return false;
  noticeOpen = true;
  arch03LiveLog("ARCH03-LIVE", "notice requested/shown", {
    ...liveSnapshot({ token, phase: "requested" }),
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
      ...liveSnapshot({ token, phase: "shown" }),
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
  const shown = await showActingHostNotice(token);
  if (shown) {
    notifiedTokens.add(token);
    if (pendingNoticeToken === token) pendingNoticeToken = null;
    arch03LiveLog("ARCH03-LIVE", "notice token current/acked", {
      ...liveSnapshot({ current: token, acked: true }),
    });
  } else {
    // Échec d'ouverture : garder pending, ne pas ack
    pendingNoticeToken = token;
    arch03LiveLog("ARCH03-LIVE", "notice deferred reason", {
      ...liveSnapshot({
        token,
        reason: isAppDialogOpen() || noticeOpen ? "dialog-busy" : "show-failed",
      }),
    });
  }
  return shown;
}

/**
 * Si un nudge est arrivé hors manche / dialog ouvert / avant listener.
 */
export function flushPendingActingHostNotice() {
  if (!isGameSyncActive() || isLobbyHost()) return;
  if (!Number.isFinite(pendingNoticeToken)) return;
  if (!isLocalActingNow()) {
    pendingNoticeToken = null;
    return;
  }
  if (!isInActivePlaySession()) {
    arch03LiveLog("ARCH03-LIVE", "notice deferred reason", {
      ...liveSnapshot({ reason: "flush-not-active-session" }),
    });
    return;
  }
  if (isAppDialogOpen() || noticeOpen) {
    arch03LiveLog("ARCH03-LIVE", "notice deferred reason", {
      ...liveSnapshot({ reason: "flush-dialog-open" }),
    });
    return;
  }
  const token = pendingNoticeToken;
  arch03LiveLog("ARCH03-LIVE", "notice eligibility", {
    ...liveSnapshot({ phase: "flush", token }),
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
    fromElectionNudge: true,
    dialogOpen: isAppDialogOpen() || noticeOpen,
  });

  arch03LiveLog("ARCH03-LIVE", "acting transition", {
    ...liveSnapshot({
      oldActing: prev,
      newActing: acting,
      became: decision.show || decision.pending,
      token,
      acked: notifiedTokens.has(token),
      deferReason: decision.deferReason,
    }),
  });
  arch03LiveLog("ARCH03-LIVE", "notice eligibility", {
    ...liveSnapshot({
      show: decision.show,
      pending: decision.pending,
      deferReason: decision.deferReason,
      token,
    }),
  });

  wasActing = decision.nextWasActing;

  if (!acting) {
    pendingNoticeToken = null;
    return;
  }

  if (decision.pending) {
    pendingNoticeToken = token;
    arch03LiveLog("ARCH03-LIVE", "notice deferred reason", {
      ...liveSnapshot({ token, reason: decision.deferReason }),
    });
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
    arch03LiveLog("ARCH03-LIVE", "acting seed", {
      ...liveSnapshot({ phase: "init" }),
    });
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
    if (wasActing === null) {
      wasActing = isLocalActingNow();
      arch03LiveLog("ARCH03-LIVE", "acting seed", {
        ...liveSnapshot({ phase: "bundle" }),
      });
    }
    flushPendingActingHostNotice();
  });
}
