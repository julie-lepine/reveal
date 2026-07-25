import { supabase, isSupabaseConfigured } from "./supabaseClient.js";
import { getSupabaseUserId, ensureAnonymousSessionForRecovery } from "./supabaseAuth.js";
import { getState, saveStatePatch, ensurePlayerScore } from "./state.js";
import {
  saveGuestMembership,
  membershipFromBundle,
  loadGuestMembership,
  clearGuestMembership,
  canUseGuestMembershipRecovery,
} from "./guestMembership.js";
import { getLocalDisplayName, getLocalEmoji } from "./state.js";
import {
  applyRemoteSession,
  handleSessionRoute,
  refreshGameSession,
  getCachedGameSession,
  isActiveGameSessionScreen,
  nudgeSessionListenersForActingHost,
  getActingHostUserId,
} from "./gameSync.js";
import { detectActingHostTransition, resolveActingHostUserId } from "./hostPresence.js";
import { arch03AhLog, arch03AhHostAgeMs } from "./arch03ActingHostDebug.js";
import { getCurrentScreen } from "./router.js";
import { fetchGameSessionByLobby } from "./supabaseGame.js";
import { scalePollIntervalMs } from "../config/syncConfig.js";
import {
  LOBBY_EXPIRED_JOIN_MSG,
  LOBBY_FULL_MSG,
  LOBBY_HEARTBEAT_MIN_MS,
  HOST_PRESENCE_STALE_MS,
  HOST_TRANSFER_STALE_MS,
  MAX_PLAYERS,
  isLobbyJoinTooOld,
} from "../config/lobbyLifecycle.js";
import { startLobbyHeartbeat } from "./lobbyHeartbeat.js";
import {
  arch03LiveLog,
  computeClaimEligible,
  hostAgeMs,
  isHostPresentAt,
  shouldNudgeClaimHubUi,
} from "./presenceUiLive.js";
import {
  JOIN_SESSION_RESTORE_DELAYS_MS,
  SUBSCRIBED_ROUTE_DEBOUNCE_MS,
  shouldRouteAfterRealtimeSubscribed,
  createDebouncedCallback,
} from "./joinSessionHydrate.js";
import {
  shouldSkipLobbyRealtimeResubscribe,
  shouldApplyLobbySubscribeStatus,
} from "./lobbyRealtimeGate.js";

export {
  JOIN_SESSION_RESTORE_DELAYS_MS,
  shouldRouteAfterRealtimeSubscribed,
  planLobbyJoinSyncOrder,
} from "./joinSessionHydrate.js";

const HOST_COLOR = "#A78BFA";
const GUEST_COLOR = "#60A5FA";

let realtimeChannel = null;
let lobbyPresencePollTimer = null;
let presenceLobbyId = null;
let lastLobbyBundleSig = "";
let lastMemberHeartbeatAt = 0;
/** T-01/T-02 : true pendant restore session au join (bloque route SUBSCRIBED). */
let joinSessionHydrating = false;
const lobbyBundleListeners = new Set();
/** Éligibilité claim observée (null = pas encore seed). Transition → bump token hub. */
let lastClaimEligible = null;
let claimHubUiToken = 0;
/**
 * Dernier acting host appliqué (pas un re-resolve live).
 * Indispensable : lastSeenAt hôte est figé, seul `now` avance — comparer deux
 * resolve(..., now) au même tick avale la transition 100s→120s.
 */
let lastAppliedActingHostUserId = null;

/** Token consultable par le hub si un notify a été manqué (listener absent). */
export function getClaimHubUiToken() {
  return claimHubUiToken;
}

/** Reconnexion Realtime : le socket peut mourir silencieusement (veille onglet, throttling
 *  arrière-plan, coupure brève) sans que Supabase ne le recrée tout seul. */
let realtimeOnUpdate = null;
let realtimeReconnectTimer = null;
let realtimeReconnectAttempts = 0;
const REALTIME_RECONNECT_MAX_MS = 10000;

/** idle | subscribing | subscribed | error — canal lobby realtime partagé */
let lobbyRealtimeStatus = "idle";
let lobbyChannelLobbyId = null;
/** Génération du canal lobby (invalide les callbacks / waiters obsolètes). */
let lobbyChannelGen = 0;
const lobbyRealtimeStatusListeners = new Set();

function emitLobbyRealtimeStatus(status, extra = {}) {
  lobbyRealtimeStatus = status;
  const payload = {
    lobbyId: lobbyChannelLobbyId,
    gen: lobbyChannelGen,
    ...extra,
  };
  for (const fn of lobbyRealtimeStatusListeners) {
    try {
      fn(status, payload);
    } catch (e) {
      console.warn("REVEAL lobbyRealtimeStatus listener:", e);
    }
  }
}

export function getLobbyRealtimeStatus() {
  return lobbyRealtimeStatus;
}

export function getLobbyRealtimeMeta() {
  return {
    status: lobbyRealtimeStatus,
    lobbyId: lobbyChannelLobbyId,
    gen: lobbyChannelGen,
    hasChannel: Boolean(realtimeChannel),
  };
}

export function isLobbyRealtimeSubscribed(forLobbyId = null) {
  if (lobbyRealtimeStatus !== "subscribed" || !realtimeChannel) return false;
  if (forLobbyId != null && String(lobbyChannelLobbyId) !== String(forLobbyId)) {
    return false;
  }
  return true;
}

export function onLobbyRealtimeStatus(fn) {
  lobbyRealtimeStatusListeners.add(fn);
  return () => lobbyRealtimeStatusListeners.delete(fn);
}

/**
 * Attend SUBSCRIBED du canal lobby pour un lobbyId donné (sérialisation défensive poll).
 *
 * Timeout : ok=false, reason=timeout — le caller NE DOIT PAS ouvrir le poll
 * (évite de réintroduire la course socket). Un futur SUBSCRIBED matching
 * pourra réveiller via onLobbyRealtimeStatus.
 *
 * @param {{ timeoutMs?: number, lobbyId?: string|null }} [opts]
 */
export function whenLobbyRealtimeReady({ timeoutMs = 12000, lobbyId: wantId } = {}) {
  const desiredLobbyId = wantId || getState().lobby?.id || null;
  if (!desiredLobbyId || !getState().inLobby) {
    return Promise.resolve({ ok: true, reason: "no_lobby", lobbyId: desiredLobbyId, gen: lobbyChannelGen });
  }
  if (isLobbyRealtimeSubscribed(desiredLobbyId)) {
    return Promise.resolve({
      ok: true,
      reason: "already",
      lobbyId: lobbyChannelLobbyId,
      gen: lobbyChannelGen,
    });
  }
  const minGen = lobbyChannelGen;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsub();
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({
        ok: false,
        reason: "timeout",
        status: lobbyRealtimeStatus,
        lobbyId: desiredLobbyId,
        gen: lobbyChannelGen,
      });
    }, timeoutMs);
    const unsub = onLobbyRealtimeStatus((status, meta) => {
      if (status === "idle" && meta?.reason === "teardown") {
        finish({
          ok: false,
          reason: "teardown",
          lobbyId: desiredLobbyId,
          gen: meta.gen,
        });
        return;
      }
      if (status !== "subscribed") return;
      if (String(meta?.lobbyId) !== String(desiredLobbyId)) return;
      if (meta?.gen != null && meta.gen < minGen) return;
      finish({
        ok: true,
        reason: "subscribed",
        lobbyId: meta.lobbyId,
        gen: meta.gen,
      });
    });
    if (isLobbyRealtimeSubscribed(desiredLobbyId)) {
      finish({
        ok: true,
        reason: "race_already",
        lobbyId: lobbyChannelLobbyId,
        gen: lobbyChannelGen,
      });
    }
  });
}

function clearRealtimeReconnect() {
  if (realtimeReconnectTimer) {
    clearTimeout(realtimeReconnectTimer);
    realtimeReconnectTimer = null;
  }
}

/** Replanifie une souscription Realtime tant qu'on est censé être dans un lobby. */
function scheduleRealtimeReconnect() {
  if (realtimeReconnectTimer || !presenceLobbyId) return;
  const delay = Math.min(
    REALTIME_RECONNECT_MAX_MS,
    1000 * Math.pow(2, realtimeReconnectAttempts)
  );
  realtimeReconnectAttempts += 1;
  realtimeReconnectTimer = setTimeout(() => {
    realtimeReconnectTimer = null;
    if (!presenceLobbyId) return;
    realtimeChannel = null;
    lobbyChannelLobbyId = null;
    // autorise reconstruction (status error/idle, pas coalesce)
    emitLobbyRealtimeStatus("idle", { reason: "reconnect_prepare" });
    subscribeLobbyRealtime(realtimeOnUpdate || (() => notifyLobbyBundleUpdated()));
  }, delay);
}

/** Signature du lobby : ne notifier (donc re-render) que si quelque chose a réellement changé. */
function lobbyBundleSignature(bundle, now = Date.now()) {
  return JSON.stringify({
    s: bundle.status,
    g: bundle.gameId,
    p: (bundle.participants || []).map(
      (x) => `${x.userId}:${x.name}:${x.emoji}:${x.ready ? 1 : 0}:${x.isHost ? 1 : 0}`
    ),
    m: (bundle.messages || []).length,
    lm: bundle.messages?.[bundle.messages.length - 1]?.at || 0,
    // Bits dérivés (pas last_seen_at brut) — basculent aux seuils 120 s / 300 s.
    hp: isHostPresentInBundle(bundle, now, HOST_PRESENCE_STALE_MS) ? 1 : 0,
    hc: isHostPresentInBundle(bundle, now, HOST_TRANSFER_STALE_MS) ? 1 : 0,
  });
}

function isHostPresentInBundle(
  bundle,
  now = Date.now(),
  staleMs = HOST_PRESENCE_STALE_MS
) {
  const participants = bundle.participants || [];
  const host =
    participants.find((p) => p.userId === bundle.hostId) ||
    participants.find((p) => p.isHost);
  if (!host) return false;
  return isHostPresentAt(host.lastSeenAt, now, staleMs);
}

function isLobbyGoneError(e) {
  return (
    e?.code === "PGRST116" ||
    String(e?.message || "").includes("0 rows") ||
    String(e?.details || "").includes("0 rows")
  );
}

const LAST_LOBBY_CODE_KEY = "reveal-last-lobby-code";
const LAST_LOBBY_ID_KEY = "reveal-last-lobby-id";

function rememberLobbyIdentity(bundle) {
  try {
    if (bundle?.code) sessionStorage.setItem(LAST_LOBBY_CODE_KEY, bundle.code);
    if (bundle?.id) sessionStorage.setItem(LAST_LOBBY_ID_KEY, bundle.id);
  } catch {
    /* ignore */
  }
}

function readRememberedLobbyId() {
  try {
    return sessionStorage.getItem(LAST_LOBBY_ID_KEY) || null;
  } catch {
    return null;
  }
}

/** Dernier code lobby connu (reconnexion invité). */
export function getRememberedLobbyCode() {
  try {
    return sessionStorage.getItem(LAST_LOBBY_CODE_KEY) || "";
  } catch {
    return "";
  }
}

/** T-01/T-02 : true pendant restore session au join (bloque route SUBSCRIBED). */
export function isJoinSessionHydrating() {
  return joinSessionHydrating;
}

/** Debounce catch-up SUBSCRIBED uniquement (events INSERT/UPDATE inchangés). */
const subscribedCatchUpRoute = createDebouncedCallback((row) => {
  if (!row) return;
  if (!shouldRouteAfterRealtimeSubscribed({ joinSessionHydrating })) return;
  handleSessionRoute(row, { debugSource: "supabaseLobby/realtime/subscribed" });
}, SUBSCRIBED_ROUTE_DEBOUNCE_MS);

/** Charge la session de jeu en cours après join / create (sans router - voir navigateAfterLobbyJoin). */
async function restoreActiveGameSessionOnJoin(lobbyId) {
  for (const ms of JOIN_SESSION_RESTORE_DELAYS_MS) {
    if (ms) await new Promise((r) => setTimeout(r, ms));
    try {
      const gameRow = await fetchGameSessionByLobby(lobbyId);
      if (gameRow) {
        applyRemoteSession(gameRow);
        return true;
      }
    } catch (e) {
      console.warn("REVEAL restore game session on join:", e.message || e);
    }
  }
  return false;
}

/**
 * T-01 : hydrate session puis démarre le sync (jamais l'inverse).
 * Bloque le catch-up SUBSCRIBED pendant la restore.
 */
async function hydrateSessionThenStartSync(lobbyId, { afterReclaim = false } = {}) {
  joinSessionHydrating = true;
  try {
    await restoreActiveGameSessionOnJoin(lobbyId);
    if (afterReclaim) {
      await refreshGameSession();
    }
  } finally {
    joinSessionHydrating = false;
  }
  const { startMultiplayerSync } = await import("./gameSync.js");
  startMultiplayerSync();
}

/** Invité attendu : ignorer guestMembership pour les comptes email/OAuth connectés. */
export { canUseGuestMembershipRecovery } from "./guestMembership.js";

/**
 * @param {string} membershipId
 * @returns {Promise<{ row?: object, notFound?: boolean, error?: boolean }>}
 */
async function peekLobbyByMembership(membershipId) {
  const { data, error } = await supabase.rpc("peek_lobby_by_membership", {
    p_member_id: membershipId,
  });
  if (error) {
    console.warn("[Lobby Recovery] peek failed", error.message || error);
    return { error: true };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.lobby_id) return { notFound: true };
  return { row };
}

async function findLobbyIdByUserId(userId) {
  const { data, error } = await supabase
    .from("lobby_members")
    .select("lobby_id, joined_at, lobbies!inner(id, code, last_activity_at, status)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(8);

  if (error) throw error;

  for (const row of data || []) {
    const lobby = row.lobbies;
    if (!lobby?.id) continue;
    if (isLobbyJoinTooOld(lobby.last_activity_at)) continue;
    return lobby.id;
  }

  const remembered = readRememberedLobbyId();
  if (remembered) {
    const still = await isLocalStillLobbyMember(remembered);
    if (still === true) return remembered;
  }

  return null;
}

async function findLobbyIdByGuestMembership() {
  if (!canUseGuestMembershipRecovery()) return null;

  const membership = loadGuestMembership();
  if (!membership?.membershipId) return null;

  console.debug("[Lobby Recovery] membership found");

  const session = await ensureAnonymousSessionForRecovery();
  if (!session?.user?.id) {
    console.debug("[Lobby Recovery] recovery failed");
    return null;
  }

  const peek = await peekLobbyByMembership(membership.membershipId);
  if (peek.error) return null;
  if (peek.notFound) return null;

  console.debug("[Lobby Recovery] lobby found");
  return peek.row.lobby_id;
}

async function isGuestRecoveryCaptchaRequired() {
  if (!canUseGuestMembershipRecovery()) return false;
  try {
    const { isTurnstileRequired } = await import("./turnstile.js");
    if (!isTurnstileRequired()) return false;
    const { data } = await supabase.auth.getSession();
    return !data?.session?.user?.id;
  } catch {
    return false;
  }
}

/**
 * Membership invité introuvable côté serveur (supprimée ou lobby expiré).
 * @returns {Promise<boolean>}
 */
export async function isGuestMembershipDefinitivelyStale() {
  if (!canUseGuestMembershipRecovery()) return false;

  const membership = loadGuestMembership();
  if (!membership?.membershipId) return false;

  const session = await ensureAnonymousSessionForRecovery();
  if (!session?.user?.id) return false;

  const peek = await peekLobbyByMembership(membership.membershipId);
  if (peek.error) return false;
  return Boolean(peek.notFound);
}

/**
 * Lobby actif côté serveur pour le joueur connecté (F5 / perte du localStorage).
 * @returns {Promise<string|null>} lobby uuid
 */
export async function findServerLobbyIdForUser(userId = getSupabaseUserId()) {
  if (!isSupabaseConfigured()) return null;

  if (canUseGuestMembershipRecovery()) {
    if (await isGuestRecoveryCaptchaRequired()) return null;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data?.session?.user?.id) {
        return findLobbyIdByGuestMembership();
      }
    } catch {
      return findLobbyIdByGuestMembership();
    }
  }

  if (userId) {
    const byUser = await findLobbyIdByUserId(userId);
    if (byUser) return byUser;
  }

  if (!canUseGuestMembershipRecovery()) return null;
  return findLobbyIdByGuestMembership();
}

/** Méta légère pour l'accueil (reprise sans appliquer l'état). */
export async function peekServerLobbyForUser(userId = getSupabaseUserId()) {
  try {
    if (userId && !canUseGuestMembershipRecovery()) {
      const lobbyId = await findLobbyIdByUserId(userId);
      if (lobbyId) {
        const { data, error } = await supabase
          .from("lobbies")
          .select("id, code, status, game_id")
          .eq("id", lobbyId)
          .maybeSingle();
        if (!error && data) return data;
      }
      return null;
    }

    if (userId) {
      const lobbyId = await findLobbyIdByUserId(userId);
      if (lobbyId) {
        const { data, error } = await supabase
          .from("lobbies")
          .select("id, code, status, game_id")
          .eq("id", lobbyId)
          .maybeSingle();
        if (!error && data) return data;
      }
    }

    if (!canUseGuestMembershipRecovery()) return null;

    const membership = loadGuestMembership();
    if (!membership?.membershipId) return null;

    await ensureAnonymousSessionForRecovery();
    const peek = await peekLobbyByMembership(membership.membershipId);
    if (peek.error || peek.notFound || !peek.row) return null;

    return {
      id: peek.row.lobby_id,
      code: peek.row.code,
      status: peek.row.status,
      game_id: peek.row.game_id,
      displayName: membership.displayName,
    };
  } catch (e) {
    console.warn("REVEAL peek server lobby:", e.message || e);
    return null;
  }
}

/**
 * Re-lie la membership invité au uid courant si nécessaire (avant fetchLobbyBundle).
 * @returns {Promise<{ ok: boolean, reclaimed?: boolean, stale?: boolean }>}
 */
async function ensureGuestMembershipReclaimed(lobbyId) {
  if (!canUseGuestMembershipRecovery()) return { ok: true, reclaimed: false };

  const membership = loadGuestMembership();
  if (!membership?.membershipId || membership.lobbyId !== lobbyId) {
    return { ok: true, reclaimed: false };
  }

  const session = await ensureAnonymousSessionForRecovery();
  if (!session?.user?.id) return { ok: false };

  const uid = getSupabaseUserId();
  const { data: memberRow, error } = await supabase
    .from("lobby_members")
    .select("user_id")
    .eq("id", membership.membershipId)
    .maybeSingle();

  if (error) {
    console.warn("[Lobby Recovery] membership check failed", error.message || error);
    return { ok: false };
  }
  if (!memberRow) {
    return { ok: false, stale: true };
  }
  if (memberRow.user_id === uid) {
    return { ok: true, reclaimed: false };
  }

  const reclaim = await reclaimGuestMembership({
    membershipId: membership.membershipId,
    lobbyCode: membership.lobbyCode,
    displayName: membership.displayName,
  });

  if (!reclaim.ok) {
    console.debug("[Lobby Recovery] recovery failed", reclaim.error);
    return { ok: false };
  }

  console.debug("[Lobby Recovery] reclaim success");
  return { ok: true, reclaimed: Boolean(reclaim.reclaimed) };
}

/** Restaure lobby + session de jeu depuis Supabase (reconnexion après F5). */
export async function recoverLobbyFromServer({ withMessages = false } = {}) {
  const hadGuestMembership = canUseGuestMembershipRecovery();
  console.debug("[DEBUG RECOVERY INPUT]", {
    guestMembership: loadGuestMembership(),
    canRecover: canUseGuestMembershipRecovery(),
  });
  const lobbyId = await findServerLobbyIdForUser();
  console.debug("[DEBUG RECOVERY LOBBY ID]", lobbyId);
  if (!lobbyId) {
    if (hadGuestMembership && (await isGuestRecoveryCaptchaRequired())) {
      console.debug("[Lobby Recovery] recovery needs captcha");
      return { ok: false, captchaRequired: true };
    }
    if (hadGuestMembership && (await isGuestMembershipDefinitivelyStale())) {
      clearGuestMembership();
      console.debug("[Lobby Recovery] recovery failed");
      return { ok: false, staleMembership: true };
    }
    console.debug("[Lobby Recovery] recovery failed");
    return { ok: false };
  }

  const reclaimResult = await ensureGuestMembershipReclaimed(lobbyId);
  if (!reclaimResult.ok) {
    if (reclaimResult.stale) {
      clearGuestMembership();
      console.debug("[Lobby Recovery] recovery failed");
      return { ok: false, staleMembership: true };
    }
    console.debug("[Lobby Recovery] recovery failed");
    return { ok: false };
  }

  const bundle = await fetchLobbyBundle(lobbyId, {
    withMessages,
    currentUserId: getSupabaseUserId(),
  });
  applyLobbyToState(bundle, { persistGuestMembership: canUseGuestMembershipRecovery() });
  startLobbyPresenceSync();
  await hydrateSessionThenStartSync(lobbyId, { afterReclaim: reclaimResult.reclaimed });
  return { ok: true, code: bundle.code, lobbyId: bundle.id };
}

/**
 * Vérifie côté serveur si le joueur local est encore dans lobby_members.
 * @returns {boolean|null} true/false, ou null si la requête a échoué (ne pas expulser).
 */
export async function isLocalStillLobbyMember(lobbyId = getState().lobby?.id) {
  const userId = getSupabaseUserId();

  console.log("[DEBUG membership check start]", {
    lobbyId,
    userId,
    stateUser: getState().user,
  });

  if (!lobbyId) {
    console.log("[DEBUG membership check skipped: no lobby]");
    return null;
  }
  const { data: sessionData } = await supabase.auth.getSession();

  const { data: authData } = await supabase.auth.getUser();

console.log("[DEBUG SESSION IN MEMBERSHIP]", {
  sessionUserId: sessionData?.session?.user?.id,
  hasToken: !!sessionData?.session?.access_token
});

  console.log("[DEBUG AUTH COMPARE]", {
    stateUserId: userId,
    authUserId: authData?.user?.id,
    isAnonymous: authData?.user?.is_anonymous,
  });

  const authUserId = authData?.user?.id;

  // Auth absente : on ne peut pas conclure que le membre est parti
  if (!authUserId) {
    console.warn("membership check skipped: no auth");
    return null;
  }

  const { data, error } = await supabase
    .from("lobby_members")
    .select("id,user_id,lobby_id")
    .eq("lobby_id", lobbyId)
    .eq("user_id", authUserId)
    .maybeSingle();

  console.log("[DEBUG membership result]", {
    lobbyId,
    userId: authUserId,
    data,
    error,
  });

  if (error) {
    console.warn(
      "REVEAL lobby membership check:",
      error.message || error
    );
    return null;
  }

  return Boolean(data);
}

/** N'expulse que si le membre local n'existe plus (évite faux « lobby fermé » après sync profil). */
async function handlePossibleLobbyGone(lobbyId, e) {
  if (!isLobbyGoneError(e)) throw e;
  const stillMember = await isLocalStillLobbyMember(lobbyId);
  if (stillMember === true) {
    console.warn("REVEAL lobby fetch failed but member still present:", e.message || e);
    return false;
  }
  if (stillMember === null) {
    console.warn("REVEAL lobby fetch failed, membership unclear:", e.message || e);
    if (loadGuestMembership()?.membershipId) {
      const recovered = await recoverLobbyFromServer();
      if (recovered.ok) return true;
      if (recovered.captchaRequired) {
        const { handleGuestRecoveryRequiresCaptcha } = await import("./lobby.js");
        handleGuestRecoveryRequiresCaptcha();
        return false;
      }
    }
    return false;
  }
  const { handleLobbyDissolvedForGuest } = await import("./lobby.js");
  await handleLobbyDissolvedForGuest();
  return false;
}

const DISPLAY_NAME_TAKEN_MSG =
  "Ce pseudo est déjà pris dans ce lobby, choisis-en un autre.";

function displayNameTakenError() {
  return { ok: false, code: "display_name_taken", error: DISPLAY_NAME_TAKEN_MSG };
}

function storedMembershipMatchesJoin(stored, lobbyId, code, displayName) {
  if (!stored?.membershipId) return false;
  if (stored.lobbyId !== lobbyId) return false;
  if (normalizeCode(stored.lobbyCode) !== normalizeCode(code)) return false;
  return (
    stored.displayName.toLowerCase() === String(displayName || "").trim().toLowerCase()
  );
}

/**
 * Re-lie une membership invité orpheline au auth.uid() courant (RPC reclaim_guest_membership).
 * @returns {Promise<{ ok: true, lobbyId: string, reclaimed?: boolean } | { ok: false, error: string }>}
 */
export async function reclaimGuestMembership({ membershipId, lobbyCode, displayName }) {
  const memberId = membershipId;
  const code = normalizeCode(lobbyCode);
  const name = String(displayName || "").trim();

  if (!memberId) {
    return { ok: false, error: "Membership introuvable." };
  }
  if (code.length < 4) {
    return { ok: false, error: "Code lobby invalide." };
  }
  if (name.length < 2) {
    return { ok: false, error: "Pseudo invalide." };
  }

  const { data, error } = await supabase.rpc("reclaim_guest_membership", {
    p_member_id: memberId,
    p_code: code,
    p_display_name: name,
  });

  if (error) {
    return { ok: false, error: error.message || "Reclaim impossible." };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const lobbyId = row?.lobby_id;
  if (!lobbyId) {
    return { ok: false, error: "Reclaim impossible." };
  }

  return { ok: true, lobbyId, reclaimed: Boolean(row?.reclaimed) };
}

/** Tente un reclaim si le membership local correspond au lobby et au pseudo du join. */
async function tryReclaimGuestMembershipForJoin(lobbyRow, code, displayName) {
  const stored = loadGuestMembership();
  if (!storedMembershipMatchesJoin(stored, lobbyRow.id, code, displayName)) {
    return { ok: false };
  }
  return reclaimGuestMembership({
    membershipId: stored.membershipId,
    lobbyCode: code,
    displayName,
  });
}

async function completeLobbyJoin(
  lobbyId,
  { afterReclaim = false, currentUserId = null, persistGuestMembership = false } = {}
) {
  const bundle = await fetchLobbyBundle(lobbyId, { withMessages: true, currentUserId });
  applyLobbyToState(bundle, { persistGuestMembership });
  await hydrateSessionThenStartSync(lobbyId, { afterReclaim });
  return bundle;
}

export function isDuplicateLobbyDisplayNameError(error) {
  const code = error?.code || "";
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    code === "23505" ||
    msg.includes("duplicate key") ||
    msg.includes("unique constraint") ||
    msg.includes("lobby_members_unique_name")
  );
}

/** Vérifie si un pseudo est déjà utilisé dans le lobby (casse ignorée). */
export async function isLobbyDisplayNameTaken(lobbyId, displayName, excludeUserId = null) {
  const trimmed = String(displayName || "").trim();
  if (!lobbyId || trimmed.length < 2) return false;

  let query = supabase
    .from("lobby_members")
    .select("user_id")
    .eq("lobby_id", lobbyId)
    .ilike("display_name", trimmed)
    .limit(1);

  if (excludeUserId) {
    query = query.neq("user_id", excludeUserId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

export function onLobbyBundleUpdated(fn) {
  lobbyBundleListeners.add(fn);
  return () => lobbyBundleListeners.delete(fn);
}

function notifyLobbyBundleUpdated() {
  lobbyBundleListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn("REVEAL lobby listener:", e);
    }
  });
}

/**
 * Coalescing des refetch lobby déclenchés par Realtime. Sans ça, chaque événement
 * (heartbeat last_seen_at, touch last_activity_at, vote, message…) lançait un fetch
 * complet lobbies + membres : sous une rafale (partie active à plusieurs), le thread
 * principal des invités saturait et l'onglet freezait. On regroupe les rafales en un
 * seul fetch, sans jamais plus d'une requête en vol.
 */
const LOBBY_REFRESH_DEBOUNCE_MS = 250;
let lobbyRefreshTimer = null;
let lobbyRefreshWithMessages = false;
let lobbyRefreshInFlight = false;
let lobbyRefreshQueued = false;

function scheduleLobbyRefresh({ withMessages = false } = {}) {
  if (withMessages) lobbyRefreshWithMessages = true;
  if (lobbyRefreshInFlight) {
    lobbyRefreshQueued = true;
    return;
  }
  if (lobbyRefreshTimer) return;
  lobbyRefreshTimer = setTimeout(runCoalescedLobbyRefresh, LOBBY_REFRESH_DEBOUNCE_MS);
}

async function runCoalescedLobbyRefresh() {
  lobbyRefreshTimer = null;
  if (!presenceLobbyId) return;
  lobbyRefreshInFlight = true;
  const withMessages = lobbyRefreshWithMessages;
  lobbyRefreshWithMessages = false;
  try {
    await refreshLobbyFromSupabase({ withMessages });
  } catch (e) {
    if (!isLobbyGoneError(e)) {
      console.warn("REVEAL coalesced lobby refresh:", e.message || e);
    }
  } finally {
    lobbyRefreshInFlight = false;
    // Pas de notify inconditionnel ici : refreshLobbyFromSupabase passe par
    // applyLobbyToState qui ne notifie QUE si la signature du bundle a changé.
    // Notifier ici réveillait tous les abonnés (re-render hub, refetch session…)
    // à chaque heartbeat cosmétique, même quand rien d'utile n'avait bougé.
    if (lobbyRefreshQueued) {
      lobbyRefreshQueued = false;
      scheduleLobbyRefresh({ withMessages: lobbyRefreshWithMessages });
    }
  }
}

function cancelLobbyRefresh() {
  if (lobbyRefreshTimer) {
    clearTimeout(lobbyRefreshTimer);
    lobbyRefreshTimer = null;
  }
  lobbyRefreshWithMessages = false;
  lobbyRefreshQueued = false;
}

/**
 * UPDATE lobbies « cosmétique » : seul last_activity_at / updated_at a bougé (déclenché
 * par le trigger SQL touch_lobby_activity à CHAQUE écriture game_sessions / heartbeat).
 * Ces UPDATE n'apportent rien à l'UI : on les ignore pour casser la tempête de refetch.
 */
function isMeaningfulLobbyUpdate(newRow) {
  if (!newRow) return true;
  const cur = getState().lobby;
  if (!cur || cur.id !== newRow.id) return true;
  return (
    (newRow.status || "waiting") !== (cur.status || "waiting") ||
    (newRow.game_id ?? null) !== (cur.gameId ?? null) ||
    (newRow.host_id ?? null) !== (cur.hostId ?? null)
  );
}

/**
 * UPDATE lobby_members « cosmétique » : un heartbeat (last_seen_at) ne change ni le
 * pseudo, ni l'emoji, ni le ready/host. On ne refetch que sur INSERT/DELETE ou un vrai
 * changement de profil.
 */
function isMeaningfulMemberChange(payload) {
  if (!payload || payload.eventType !== "UPDATE") return true;
  const row = payload.new;
  if (!row) return true;
  const cur = getState().lobby?.participants?.find((p) => p.userId === row.user_id);
  if (!cur) return true;
  return (
    row.display_name !== cur.name ||
    row.emoji !== cur.emoji ||
    row.color !== cur.color ||
    Boolean(row.ready) !== Boolean(cur.ready) ||
    Boolean(row.is_host) !== Boolean(cur.isHost)
  );
}

function normalizeCode(code) {
  return code.trim().toUpperCase().replace(/\s/g, "");
}

function mapMember(row, currentUserId) {
  return {
    membershipId: row.id,
    userId: row.user_id,
    name: row.display_name,
    emoji: row.emoji,
    color: row.color,
    ready: Boolean(row.ready),
    isHost: Boolean(row.is_host),
    isLocal: row.user_id === currentUserId,
    lastSeenAt: row.last_seen_at || null,
  };
}

/**
 * Bundle lobby. Par défaut on NE rapatrie PAS les 100 messages (gros poste d'egress) :
 * ils ne changent qu'à l'envoi d'un message, géré séparément (Realtime + envoi).
 * On ne les charge que quand `withMessages` est explicitement demandé.
 */
async function fetchLobbyBundle(lobbyId, { withMessages = false, currentUserId = null } = {}) {
  const userId = currentUserId || getSupabaseUserId();
  const queries = [
    supabase
      .from("lobbies")
      .select("id, code, status, game_id, host_id, last_activity_at")
      .eq("id", lobbyId)
      .single(),
    supabase
      .from("lobby_members")
      .select("id, user_id, display_name, emoji, color, ready, is_host, joined_at, last_seen_at")
      .eq("lobby_id", lobbyId)
      .order("joined_at"),
  ];
  if (withMessages) {
    queries.push(
      supabase
        .from("lobby_messages")
        .select("id, display_name, body, created_at, user_id")
        .eq("lobby_id", lobbyId)
        .order("created_at", { ascending: true })
        .limit(100)
    );
  }

  const [{ data: lobby, error: lErr }, { data: members, error: mErr }, msgRes] =
    await Promise.all(queries);

  if (lErr) throw lErr;
  if (mErr) throw mErr;
  if (msgRes?.error) throw msgRes.error;

  const participants = (members || []).map((m) => mapMember(m, userId));

  console.log("[DEBUG FETCH BUNDLE MEMBERS]", {
    currentUserId: userId,
    members: members?.map(m => ({
      id: m.id,
      user_id: m.user_id,
      display_name: m.display_name,
    })),
    participants,
  });

  const bundle = {
    id: lobby.id,
    code: lobby.code,
    status: lobby.status || "waiting",
    gameId: lobby.game_id,
    hostId: lobby.host_id,
    lastActivityAt: lobby.last_activity_at || null,
    participants,
  };

  if (withMessages) {
    bundle.messages = (msgRes?.data || []).map((m) => ({
      id: m.id,
      from: m.display_name,
      text: m.body,
      at: new Date(m.created_at).getTime(),
      userId: m.user_id || null,
    }));
  }

  return bundle;
}

function applyLobbyToState(bundle, { persistGuestMembership = false } = {}) {
  // Si le bundle n'a pas chargé les messages, on conserve ceux déjà en mémoire.
  const messages =
    bundle.messages !== undefined ? bundle.messages : getState().lobby?.messages || [];

  const localUid = getSupabaseUserId();
  if (
    localUid &&
    Array.isArray(bundle.participants) &&
    !bundle.participants.some((p) => p.userId === localUid)
  ) {
    // Membership absente du bundle (kick) — ne pas réécrire un lobby fantôme.
    setTimeout(() => {
      if (!getState().inLobby) return;
      void import("./lobby.js").then(({ handleKickedFromLobby }) => handleKickedFromLobby());
    }, 0);
    return;
  }

  rememberLobbyIdentity(bundle);

  const prevLobby = getState().lobby;
  const now = Date.now();
  // Capture BEFORE toute mutation state / saveStatePatch.
  // BEFORE = dernier acting mémorisé — JAMAIS re-resolve(prev, now) qui avale
  // la transition dès que hostAge franchit 120s avec le même lastSeenAt figé.
  // AFTER = resolve pur depuis le bundle entrant (aucune mutation state).
  const transition = detectActingHostTransition(
    lastAppliedActingHostUserId,
    bundle.participants || [],
    bundle.hostId || null,
    now
  );
  let actingHostBefore = transition.before;
  let actingHostAfterResolved = transition.after;
  let actingHostChanged = transition.changed;
  if (actingHostBefore == null) {
    // Premier apply / après reset : seed sans nudge
    actingHostBefore = resolveActingHostUserId(
      prevLobby?.participants || [],
      prevLobby?.hostId || null,
      now
    );
    actingHostChanged = false;
  }

  const hostParticipant =
    (bundle.participants || []).find((p) => p.userId === bundle.hostId) ||
    (bundle.participants || []).find((p) => p.isHost) ||
    null;
  const hostLastSeenAt = hostParticipant?.lastSeenAt ?? null;
  const claimEligibleBefore = lastClaimEligible;
  const claimEligibleAfter = computeClaimEligible({
    participants: bundle.participants || [],
    hostId: bundle.hostId || null,
    localUserId: localUid || null,
    now,
    isRealHost: Boolean(localUid && bundle.hostId && localUid === bundle.hostId),
  });
  const claimHubNudge = shouldNudgeClaimHubUi(claimEligibleBefore, claimEligibleAfter);
  arch03AhLog("applyLobbyToState", {
    hostId: bundle.hostId || null,
    hostLastSeenAt,
    hostAgeMs: arch03AhHostAgeMs(hostLastSeenAt, now),
    hostPresentBit: isHostPresentInBundle(bundle, now, HOST_PRESENCE_STALE_MS) ? 1 : 0,
    hostClaimPresentBit: isHostPresentInBundle(bundle, now, HOST_TRANSFER_STALE_MS) ? 1 : 0,
    actingHostBefore,
    actingHostAfterResolved,
    didActingHostChange: actingHostChanged,
    localUid: localUid || null,
    participantLastSeen: (bundle.participants || []).map((p) => ({
      userId: p.userId,
      lastSeenAt: p.lastSeenAt || null,
      ageMs: arch03AhHostAgeMs(p.lastSeenAt, now),
      isHost: Boolean(p.isHost),
    })),
  });
  arch03LiveLog("ARCH03B-LIVE", "claim eligibility before/after", {
    localUserId: localUid || null,
    hostAgeMs: hostAgeMs(hostLastSeenAt, now),
    claimEligibleBefore,
    claimEligibleAfter,
    currentScreen: getCurrentScreen(),
  });

  saveStatePatch({
    lobby: {
      id: bundle.id,
      code: bundle.code,
      participants: bundle.participants,
      messages,
      status: bundle.status,
      gameId: bundle.gameId,
      hostId: bundle.hostId,
      lastActivityAt: bundle.lastActivityAt || null,
      actingHostUserId: actingHostAfterResolved,
    },
    lobbyCode: bundle.code,
    inLobby: true,
    guessLie: {
      ...getState().guessLie,
      sessionId: bundle.code,
    },
  });
  lastAppliedActingHostUserId = actingHostAfterResolved;

  if (persistGuestMembership || getState().user?.isGuest) {
    const membership = membershipFromBundle(bundle);
    if (membership) saveGuestMembership(membership);
  }
  bundle.participants.forEach((p) => ensurePlayerScore(p.name));
  startLobbyPresenceSync();

  if (claimHubNudge) {
    claimHubUiToken += 1;
    arch03LiveLog("ARCH03B-LIVE", "hub UI nudge", {
      localUserId: localUid || null,
      claimEligibleBefore,
      claimEligibleAfter,
      claimHubUiToken,
      hostAgeMs: hostAgeMs(hostLastSeenAt, now),
      currentScreen: getCurrentScreen(),
      listenerCount: lobbyBundleListeners.size,
    });
  }
  lastClaimEligible = claimEligibleAfter;

  // ARCH-03 : nudge acting AVANT notifyLobby — sinon le seed wasActing dans
  // onLobbyBundleUpdated voit déjà le nouvel acting host et avale false→true.
  if (actingHostChanged) {
    arch03AhLog("will call nudgeSessionListenersForActingHost", {
      actingHostBefore,
      actingHostAfter: actingHostAfterResolved,
    });
    arch03LiveLog("ARCH03-LIVE", "poll acting resolution", {
      localUserId: localUid || null,
      actingHostBefore,
      actingHostAfter: actingHostAfterResolved,
      didActingHostChange: true,
      hostAgeMs: hostAgeMs(hostLastSeenAt, now),
      currentScreen: getCurrentScreen(),
      hp: isHostPresentInBundle(bundle, now, HOST_PRESENCE_STALE_MS) ? 1 : 0,
    });
    nudgeSessionListenersForActingHost();
  } else {
    arch03AhLog("skip nudge (didActingHostChange=false)");
  }

  const sig = lobbyBundleSignature({ ...bundle, messages }, now);
  if (sig !== lastLobbyBundleSig) {
    lastLobbyBundleSig = sig;
    notifyLobbyBundleUpdated();
  } else if (claimHubNudge) {
    notifyLobbyBundleUpdated();
  }
}

/** Realtime + polling tant que le joueur est dans un lobby (tous les écrans). */
export function startLobbyPresenceSync() {
  if (!isSupabaseConfigured() || !getState().inLobby || !getState().lobby?.id) return;

  const lobbyId = getState().lobby.id;

  // Singleton / coalesce : déjà branché (ou en cours) sur ce lobby
  if (
    shouldSkipLobbyRealtimeResubscribe({
      desiredLobbyId: lobbyId,
      activeLobbyId: presenceLobbyId,
      hasChannel: Boolean(realtimeChannel),
      subscriptionStatus: lobbyRealtimeStatus,
    }) &&
    presenceLobbyId === lobbyId
  ) {
    if (typeof localStorage !== "undefined" && localStorage.getItem("reveal-rt-socket-debug") === "1") {
      console.info("[RT-LOBBY] startLobbyPresenceSync coalesced", {
        lobbyId,
        lobbyRealtimeStatus,
        topic: realtimeChannel?.topic,
        gen: lobbyChannelGen,
      });
    }
    return;
  }

  if (presenceLobbyId && presenceLobbyId !== lobbyId) {
    stopLobbyPresenceSync();
  } else if (realtimeChannel && presenceLobbyId === lobbyId) {
    // Canal mort / error : retirer seulement le canal, pas tout le sync state
    unsubscribeLobbyRealtime();
  }

  presenceLobbyId = lobbyId;
  subscribeLobbyRealtime(() => notifyLobbyBundleUpdated());

  scheduleLobbyPresencePoll();
  void pingLobbyMemberPresence();
}

/** Heartbeat : last_seen_at sur lobby_members (purge / présence). */
export async function pingLobbyMemberPresence() {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId || !isSupabaseConfigured()) return;

  const now = Date.now();
  if (now - lastMemberHeartbeatAt < LOBBY_HEARTBEAT_MIN_MS) return;
  lastMemberHeartbeatAt = now;

  const { error } = await supabase
    .from("lobby_members")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("lobby_id", lobbyId)
    .eq("user_id", userId);

  if (error && !/last_seen_at|column/i.test(String(error.message || ""))) {
    console.warn("REVEAL lobby heartbeat:", error.message || error);
  }
}

/**
 * Poll de présence auto-planifié. En partie active, on l'espace (le fetch ramène
 * lobby + membres + 100 messages : inutile de marteler ça pendant un jeu, ça
 * contribue aux lags côté hôte). Hors jeu (lobby/menu) on reste réactif.
 */
function scheduleLobbyPresencePoll() {
  if (lobbyPresencePollTimer) clearTimeout(lobbyPresencePollTimer);
  // Le Realtime gère les changements en direct ; ce poll n'est qu'un filet de
  // sécurité (et il ne rapatrie ni les messages ni le `state` du jeu).
  const inGame = isActiveGameSessionScreen(getCurrentScreen());
  const delay = scalePollIntervalMs(inGame ? 20000 : 12000);
  lobbyPresencePollTimer = setTimeout(async () => {
    lobbyPresencePollTimer = null;
    const screen = getCurrentScreen();
    if (typeof document !== "undefined" && document.hidden) {
      arch03AhLog("presence poll skipped (document.hidden)", {
        screen,
        inGame,
        delayMs: delay,
      });
      if (presenceLobbyId) scheduleLobbyPresencePoll();
      return;
    }
    arch03AhLog("presence poll tick", {
      screen,
      inGame,
      delayMs: delay,
      lobbyId: presenceLobbyId,
      localUid: getSupabaseUserId() || null,
    });
    try {
      await pingLobbyMemberPresence();
      await refreshLobbyFromSupabase();
    } catch (e) {
      arch03AhLog("presence poll error", { message: e?.message || String(e) });
      if (!isLobbyGoneError(e)) {
        console.warn("REVEAL lobby presence poll:", e.message || e);
      }
    }
    if (presenceLobbyId) scheduleLobbyPresencePoll();
  }, delay);
}

export function stopLobbyPresenceSync() {
  presenceLobbyId = null;
  lastLobbyBundleSig = "";
  lastMemberHeartbeatAt = 0;
  lastClaimEligible = null;
  lastAppliedActingHostUserId = null;
  joinSessionHydrating = false;
  subscribedCatchUpRoute.cancel();
  realtimeReconnectAttempts = 0;
  realtimeOnUpdate = null;
  if (lobbyPresencePollTimer) {
    clearTimeout(lobbyPresencePollTimer);
    lobbyPresencePollTimer = null;
  }
  cancelLobbyRefresh();
  unsubscribeLobbyRealtime();
}

async function generateUniqueCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const { data } = await supabase.rpc("find_lobby_by_code", { p_code: code });
    if (!data?.length) return code;
  }
  throw new Error("Impossible de générer un code lobby.");
}

export async function createLobbySupabase() {
  const userId = getSupabaseUserId();

const { data: authCheck } = await supabase.auth.getUser();

console.log("[DEBUG CREATE LOBBY AUTH]", {
  localUserId: userId,
  authUserId: authCheck?.user?.id,
  isAnonymous: authCheck?.user?.is_anonymous,
});
  if (!userId) return { ok: false, error: "Connecte-toi pour créer un lobby." };

  const code = await generateUniqueCode();
  const displayName = getLocalDisplayName();
  const emoji = getLocalEmoji();

  const { data: lobby, error: lobbyErr } = await supabase
    .from("lobbies")
    .insert({
      code,
      host_id: userId,
      status: "waiting",
      game_id: null,
    })
    .select("id, code, status, game_id, host_id")
    .single();

  if (lobbyErr) return { ok: false, error: lobbyErr.message };

  const { data: memberData, error: memberErr } = await supabase.rpc(
    "create_lobby_member",
    {
      p_lobby_id: lobby.id,
      p_display_name: displayName,
      p_emoji: emoji,
      p_color: HOST_COLOR,
    }
  );

console.log("[DEBUG MEMBER INSERT CREATE]", {
  lobbyId: lobby.id,
  userId,
  memberData,
  memberErr,
});

  if (memberErr) return { ok: false, error: memberErr.message };

  const bundle = await fetchLobbyBundle(lobby.id, { withMessages: true, currentUserId: userId });
  applyLobbyToState(bundle, { persistGuestMembership: getState().user?.isGuest === true });
  await hydrateSessionThenStartSync(lobby.id);

  const gs = { ...getState().globalStats };
  gs.lobbiesCreated = (gs.lobbiesCreated || 0) + 1;
  saveStatePatch({ globalStats: gs });

  return { ok: true, code };
}

export async function joinLobbySupabase(codeInput) {
  console.log("[DEBUG JOIN SUPABASE START]", { codeInput });

  const recoverySession = await ensureAnonymousSessionForRecovery();

  const userId =
    recoverySession?.user?.id ||
    getSupabaseUserId();

  if (!userId) {
    return { ok: false, error: "Connecte-toi ou rejoins en invité d'abord." };
  }

  const code = normalizeCode(codeInput);
  if (code.length < 4) return { ok: false, error: "Code invalide." };

  const { data: rows, error: findErr } = await supabase.rpc("find_lobby_by_code", { p_code: code });
  if (findErr) return { ok: false, error: findErr.message };
  const lobbyRow = rows?.[0];
  if (!lobbyRow) {
    return {
      ok: false,
      error:
        "Code introuvable. Vérifie le code auprès de l'hôte ou ouvre le lien d'invitation qu'il t'a envoyé.",
    };
  }

  if (isLobbyJoinTooOld(lobbyRow.last_activity_at)) {
    return { ok: false, error: LOBBY_EXPIRED_JOIN_MSG };
  }

  let afterReclaim = false;
  const persistGuestMembership =
    recoverySession?.user?.is_anonymous === true || getState().user?.isGuest === true;

  const { data: existing } = await supabase
    .from("lobby_members")
    .select("id")
    .eq("lobby_id", lobbyRow.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!existing) {
    const { data: memberCount, error: countErr } = await supabase.rpc("get_lobby_member_count", {
      p_lobby_id: lobbyRow.id,
    });
    if (countErr) return { ok: false, error: countErr.message };

    if ((memberCount ?? 0) >= MAX_PLAYERS) {
      return { ok: false, error: LOBBY_FULL_MSG };
    }

    const displayName = getLocalDisplayName();
    let membershipResolved = false;

    try {
      if (await isLobbyDisplayNameTaken(lobbyRow.id, displayName)) {
        const reclaimRes = await tryReclaimGuestMembershipForJoin(lobbyRow, code, displayName);
        if (!reclaimRes.ok) {
          return displayNameTakenError();
        }
        membershipResolved = true;
        afterReclaim = true;
      }
    } catch (e) {
      return { ok: false, error: e.message || "Impossible de vérifier le pseudo." };
    }

    console.log("[DEBUG JOIN PATH]", {
      existing,
      displayName,
      membershipResolved,
    });

    if (!membershipResolved) {
      const { data: joinData, error: joinErr } = await supabase
        .from("lobby_members")
        .insert({
          lobby_id: lobbyRow.id,
          user_id: userId,
          display_name: displayName,
          emoji: getLocalEmoji(),
          color: GUEST_COLOR,
          is_host: false,
          ready: false,
        })
        .select()
        .single();

      if (joinErr) {
        if (isDuplicateLobbyDisplayNameError(joinErr)) {
          const reclaimRes = await tryReclaimGuestMembershipForJoin(lobbyRow, code, displayName);
          if (!reclaimRes.ok) {
            return displayNameTakenError();
          }
          afterReclaim = true;
        } else {
          return { ok: false, error: joinErr.message };
        }
      } else {
        if (persistGuestMembership) {
          saveGuestMembership({
            membershipId: joinData.id,
            lobbyId: lobbyRow.id,
            lobbyCode: code,
            displayName,
          });
        }

        const gs = { ...getState().globalStats };
        gs.playersJoined = (gs.playersJoined || 0) + 1;
        saveStatePatch({ globalStats: gs });
      }
    }
  }

  const bundle = await completeLobbyJoin(lobbyRow.id, {
    afterReclaim,
    currentUserId: userId,
    persistGuestMembership,
  });
  return { ok: true, code: bundle.code };
}

export async function refreshLobbyFromSupabase({ withMessages = false } = {}) {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return false;
  try {
    const bundle = await fetchLobbyBundle(lobbyId, { withMessages });
    applyLobbyToState(bundle);
    return true;
  } catch (e) {
    return handlePossibleLobbyGone(lobbyId, e);
  }
}

/** Hôte : supprime le lobby (membres et messages en cascade). */
export async function closeLobbySupabase() {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  const hostId = getState().lobby?.hostId;
  const isHostMember = getState().lobby?.participants?.some((p) => p.isLocal && p.isHost);
  const isHost =
    Boolean(userId && hostId && userId === hostId) ||
    (isHostMember && !hostId);

  if (!lobbyId || !isHost) {
    return { ok: false, error: "Seul l'hôte peut fermer le lobby." };
  }

  try {
    const { deleteGameSession } = await import("./supabaseGame.js");
    await deleteGameSession(lobbyId);
  } catch (e) {
    console.warn("REVEAL delete game session on close lobby:", e.message || e);
  }

  try {
    const { clearTraitrePrivateForLobby } = await import("./traitrePrivate.js");
    await clearTraitrePrivateForLobby(lobbyId);
  } catch (e) {
    console.warn("REVEAL clear traitre private:", e.message || e);
  }

  const { data, error } = await supabase.from("lobbies").delete().eq("id", lobbyId).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) {
    return {
      ok: false,
      error:
        "Le lobby n'a pas pu être supprimé (droits ou session). Reconnecte-toi avec le compte qui a créé la partie.",
    };
  }
  return { ok: true };
}

/** Quitte le lobby côté serveur (retire le membre local). */
export async function leaveLobbySupabase() {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId) return { ok: true };

  const { error } = await supabase
    .from("lobby_members")
    .delete()
    .eq("lobby_id", lobbyId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function setLocalReadySupabase(ready) {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId) return;

  const { error } = await supabase
    .from("lobby_members")
    .update({ ready: Boolean(ready) })
    .eq("lobby_id", lobbyId)
    .eq("user_id", userId);

  if (error) throw error;
  await refreshLobbyFromSupabase();
}

export async function updateLobbyMemberProfileSupabase({ displayName, emoji } = {}) {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId) return;

  const patch = {};
  if (displayName != null) {
    const trimmed = String(displayName).trim().slice(0, 24);
    if (trimmed.length >= 2) {
      const taken = await isLobbyDisplayNameTaken(lobbyId, trimmed, userId);
      if (taken) throw new Error(DISPLAY_NAME_TAKEN_MSG);
      patch.display_name = trimmed;
    }
  }
  if (emoji != null) patch.emoji = emoji;

  if (!Object.keys(patch).length) return;

  const { error } = await supabase
    .from("lobby_members")
    .update(patch)
    .eq("lobby_id", lobbyId)
    .eq("user_id", userId);

  if (error) {
    if (isDuplicateLobbyDisplayNameError(error)) {
      throw new Error(DISPLAY_NAME_TAKEN_MSG);
    }
    throw error;
  }
  /* Realtime lobby_members met à jour tout le lobby ; évite double refresh + faux kick. */
}

/** Hôte : transfère le rôle à un autre membre du lobby (RPC atomique). */
export async function transferLobbyHostSupabase(newHostUserId) {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId || !newHostUserId) {
    return { ok: false, error: "Lobby ou joueur invalide." };
  }

  const { error } = await supabase.rpc("transfer_lobby_host", {
    p_lobby_id: lobbyId,
    p_new_host_user_id: newHostUserId,
  });

  if (error) return { ok: false, error: error.message };

  await refreshLobbyFromSupabase();
  return { ok: true };
}

/**
 * ARCH-03b : claim atomique du rôle hôte si host stale ≥ 5 min (RPC serveur).
 * Ne met pas à jour le state local avant confirmation + refresh.
 */
export async function claimLobbyHostIfStaleSupabase() {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId) {
    return { ok: false, error: "Lobby ou session invalide." };
  }

  const { data, error } = await supabase.rpc("claim_lobby_host_if_stale", {
    p_lobby_id: lobbyId,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, claimed: data !== false };
}

/** Hôte : retire un membre du lobby (RPC kick_lobby_member). */
export async function kickLobbyMemberSupabase(targetUserId) {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId || !targetUserId) {
    return { ok: false, error: "Lobby ou joueur invalide." };
  }

  const { error } = await supabase.rpc("kick_lobby_member", {
    p_lobby_id: lobbyId,
    p_target_user_id: targetUserId,
  });

  if (error) return { ok: false, error: error.message };

  await refreshLobbyFromSupabase();
  return { ok: true };
}

export async function setLobbyStatusSupabase(status, gameId = null) {
  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return;

  const patch = { status };
  if (gameId !== undefined) patch.game_id = gameId;

  const { error } = await supabase.from("lobbies").update(patch).eq("id", lobbyId);
  if (error) throw error;
  await refreshLobbyFromSupabase();
}

export async function addLobbyMessageSupabase(text) {
  const lobbyId = getState().lobby?.id;
  const userId = getSupabaseUserId();
  if (!lobbyId || !userId) return;

  const body = text.trim();
  if (!body) return;

  const { error } = await supabase.from("lobby_messages").insert({
    lobby_id: lobbyId,
    user_id: userId,
    display_name: getLocalDisplayName(),
    body,
  });

  if (error) throw error;
  await refreshLobbyFromSupabase({ withMessages: true });
}

export function subscribeLobbyRealtime(onUpdate) {
  if (!isSupabaseConfigured()) return () => {};

  const lobbyId = getState().lobby?.id;
  if (!lobbyId) return () => {};

  realtimeOnUpdate = onUpdate;

  const debug =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("reveal-rt-socket-debug") === "1";

  // Coalesce uniquement si canal vivant (subscribing|subscribed) du même lobbyId
  if (
    shouldSkipLobbyRealtimeResubscribe({
      desiredLobbyId: lobbyId,
      activeLobbyId: lobbyChannelLobbyId,
      hasChannel: Boolean(realtimeChannel),
      subscriptionStatus: lobbyRealtimeStatus,
    })
  ) {
    if (debug) {
      console.info("[RT-LOBBY] subscribeLobbyRealtime coalesced", {
        lobbyId,
        lobbyRealtimeStatus,
        topic: realtimeChannel.topic,
        subscribeCallCount: realtimeChannel.__lobbySubscribeCallCount ?? null,
        gen: lobbyChannelGen,
      });
    }
    return unsubscribeLobbyRealtime;
  }

  const topicsBefore = (() => {
    try {
      return (supabase.getChannels?.() || []).map((c) => c.topic);
    } catch {
      return [];
    }
  })();

  if (debug) {
    console.info("[RT-LOBBY] subscribeLobbyRealtime build", {
      lobbyId,
      reason: "subscribeLobbyRealtime",
      previousTopic: realtimeChannel?.topic ?? null,
      previousStatus: lobbyRealtimeStatus,
      previousGen: lobbyChannelGen,
      topicsBefore,
      connectionState: supabase.realtime?.connectionState?.() ?? null,
    });
  }

  unsubscribeLobbyRealtime({ reason: "replace" });

  const myGen = ++lobbyChannelGen;
  lobbyChannelLobbyId = lobbyId;
  emitLobbyRealtimeStatus("subscribing", { gen: myGen });

  const topic = `lobby:${lobbyId}`;
  let builder = supabase.channel(topic);
  builder.__lobbySubscribeCallCount = 0;
  builder.__lobbyChannelId = `lobby-ch-${lobbyId}`;
  builder.__lobbyGen = myGen;

  builder = builder
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lobby_members", filter: `lobby_id=eq.${lobbyId}` },
      (payload) => {
        const removedUid = payload?.eventType === "DELETE" ? payload.old?.user_id : null;
        const localUid = getSupabaseUserId();
        if (removedUid && localUid && removedUid === localUid) {
          setTimeout(() => {
            if (!getState().inLobby) return;
            void import("./lobby.js").then(({ handleKickedFromLobby }) =>
              handleKickedFromLobby()
            );
          }, 180);
          return;
        }
        if (!isMeaningfulMemberChange(payload)) return;
        scheduleLobbyRefresh();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "lobby_messages", filter: `lobby_id=eq.${lobbyId}` },
      () => {
        scheduleLobbyRefresh({ withMessages: true });
      }
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` },
      (payload) => {
        const meaningful = isMeaningfulLobbyUpdate(payload.new);
        if (!meaningful) return;
        scheduleLobbyRefresh();
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "lobbies", filter: `id=eq.${lobbyId}` },
      async () => {
        const { handleLobbyDissolvedForGuest } = await import("./lobby.js");
        await handleLobbyDissolvedForGuest();
        onUpdate?.();
      }
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "game_sessions", filter: `lobby_id=eq.${lobbyId}` },
      async (payload) => {
        if (payload.eventType === "DELETE") {
          applyRemoteSession(null);
          refreshLobbyFromSupabase()
            .catch((e) => {
              if (!isLobbyGoneError(e)) {
                console.warn("REVEAL lobby after game_sessions delete:", e.message || e);
              }
            })
            .finally(() => onUpdate?.());
          return;
        }
        try {
          const { pulseGameSessionRealtime } = await import("./gameSync.js");
          pulseGameSessionRealtime();
          if (payload.new && payload.new.state !== undefined) {
            applyRemoteSession(payload.new);
          } else {
            await refreshGameSession();
          }
          const row = getCachedGameSession();
          if (row) handleSessionRoute(row, { debugSource: "supabaseLobby/realtime/handle" });
        } catch (e) {
          console.warn("REVEAL realtime game_sessions:", e.message || e);
        }
        onUpdate?.();
      }
    );

  realtimeChannel = builder;
  builder.__lobbySubscribeCallCount = 1;

  builder.subscribe((status, err) => {
    if (
      !shouldApplyLobbySubscribeStatus({
        eventGen: myGen,
        currentGen: lobbyChannelGen,
        channelRef: builder,
        activeChannelRef: realtimeChannel,
      })
    ) {
      if (debug) {
        console.info("[RT-LOBBY] subscribe status ignored (stale gen/ref)", {
          status,
          myGen,
          lobbyChannelGen,
          lobbyId,
        });
      }
      return;
    }

    if (debug || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.info("[RT-LOBBY] subscribe status", {
        status,
        errorMessage: err?.message,
        errorName: err?.name,
        errorContext: err?.context,
        lobbyId,
        topic,
        gen: myGen,
        subscribeCallCount: builder.__lobbySubscribeCallCount,
        connectionState: supabase.realtime?.connectionState?.() ?? null,
      });
    }

    if (status === "SUBSCRIBED") {
      realtimeReconnectAttempts = 0;
      clearRealtimeReconnect();
      emitLobbyRealtimeStatus("subscribed", { gen: myGen });
      void refreshGameSession()
        .then((row) => {
          if (!shouldRouteAfterRealtimeSubscribed({ joinSessionHydrating })) return;
          if (!row) return;
          subscribedCatchUpRoute.schedule(row);
        })
        .catch(() => {});
      return;
    }
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      emitLobbyRealtimeStatus("error", { gen: myGen });
      scheduleRealtimeReconnect();
    }
  });

  return unsubscribeLobbyRealtime;
}

export function unsubscribeLobbyRealtime({ reason = "unsubscribe" } = {}) {
  clearRealtimeReconnect();
  subscribedCatchUpRoute.cancel();
  if (realtimeChannel && supabase) {
    try {
      realtimeChannel.__intentionalClose = true;
      supabase.removeChannel(realtimeChannel);
    } catch (e) {
      console.warn("REVEAL lobby removeChannel:", e?.message || e);
    }
  }
  realtimeChannel = null;
  lobbyChannelLobbyId = null;
  // Invalide waiters / anciens SUBSCRIBED : bump gen sauf replace (bump fait après)
  if (reason !== "replace") {
    lobbyChannelGen += 1;
  }
  emitLobbyRealtimeStatus("idle", { reason, gen: lobbyChannelGen });
}

/**
 * Force un canal Realtime frais (retour au premier plan, socket potentiellement étranglé
 * par le navigateur en arrière-plan). No-op si on n'est pas dans un lobby.
 */
export function resubscribeLobbyRealtime() {
  if (!presenceLobbyId) return;
  realtimeReconnectAttempts = 0;
  unsubscribeLobbyRealtime();
  subscribeLobbyRealtime(realtimeOnUpdate || (() => notifyLobbyBundleUpdated()));
}
