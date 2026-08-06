/**
 * FEATURE-TIERNIGHT-03-B / B1 — session prep série (settings + ready), sans queue.
 *
 * Queue / series créées uniquement au launch (prepare + markTierNightSeriesStarted).
 * One-shot : consumed inclus dans la mutation de launch + réconciliation hydrate.
 */

import { getState, saveStatePatch, getLocalDisplayName, getCustomRosterTopics } from "./state.js";
import { getActivePlayerNames } from "./players.js";
import {
  TIER_NIGHT_SERIES_ALL_CATEGORIES,
  TIER_NIGHT_SERIES_ROUND_COUNTS,
  mergeConsumedCustomTopicIds,
  validateTierNightSeriesCategoryIdsShape,
} from "./tierNightSeries.js";
import {
  getTierNightSeriesPoolSize,
  getTierNightSeriesRoundCountAvailability,
  reconcileTierNightSeriesSetupAfterCategoryChange,
  resolveTierNightSeriesSetupCategoryIds,
  validateTierNightSeriesSetupForLaunch,
} from "./tierNightSeriesSetup.js";
import { estimateTierNightSeriesDuration } from "./tierNightSeriesDuration.js";
import {
  didTierNightSeriesPrepSetupChange,
  resolveTierNightSeriesLaunchParticipants,
  shouldHonorPoolInvalidateRequest,
  customRosterTopicsPoolSignature,
} from "./tierNightSeriesPrepContracts.js";
import {
  isGameSyncActive,
  isLobbyHost,
  canActAsHost,
  allMembersReady,
  patchGameState,
  tierNightPrepToRemote,
  tierNightPrepFromRemote,
  requireLocalParticipantUid,
} from "./gameSync.js";
import { commitPrepReadyToggle } from "./mpLaunch.js";
import { prepareTierNightSeriesLaunchAttempt } from "./tierNightSeriesLaunch.js";
import { markTierNightSeriesStarted } from "./tierNightLiveSession.js";
import { getLobbyParticipants } from "./lobby.js";
import {
  addCustomRosterTopicAndSync,
  deleteCustomRosterTopicAndSync,
} from "./customRosterTopicSession.js";
import { checkHotTakeModeration, getModerationNotice } from "./hotTakeSession.js";
import { navigate } from "./router.js";

export { getModerationNotice, checkHotTakeModeration, tierNightPrepFromRemote };

export const TIER_NIGHT_SERIES_PREP_DEFAULT_ROUND_COUNT = 5;

/** Dernière requête d’invalidation honorée (anti double-bump). */
let lastHonoredPoolInvalidateRequestId = null;
/** Empreinte customs vue par l’hôte (détection mutation pool). */
let lastHostSeenCustomsSignature = null;
/** Coalesce bumps hôte (customs + request proches). */
let lastAuthoritativeInvalidateAt = 0;
const AUTHORITATIVE_INVALIDATE_COALESCE_MS = 750;
/** File d’honneur hôte (une mutation autoritative à la fois). */
let honorChain = Promise.resolve();
let honorGeneration = 0;

/** Tests uniquement. */
export function resetTierNightSeriesPrepInvalidateGuardsForTests() {
  lastHonoredPoolInvalidateRequestId = null;
  lastHostSeenCustomsSignature = null;
  lastAuthoritativeInvalidateAt = 0;
  honorChain = Promise.resolve();
  honorGeneration = 0;
}

function defaultPrepSession() {
  return {
    categoryIds: [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount: TIER_NIGHT_SERIES_PREP_DEFAULT_ROUND_COUNT,
    ready: {},
    setupEpoch: 0,
    poolInvalidateRequestId: null,
  };
}

export function getTierNightSeriesPrepSession() {
  const raw = getState().tierNightSeriesPrep;
  if (!raw || typeof raw !== "object") return defaultPrepSession();
  const roundRaw = raw.roundCount;
  const roundCount =
    roundRaw == null || roundRaw === ""
      ? null
      : TIER_NIGHT_SERIES_ROUND_COUNTS.includes(Number(roundRaw))
        ? Number(roundRaw)
        : TIER_NIGHT_SERIES_PREP_DEFAULT_ROUND_COUNT;
  return {
    categoryIds: Array.isArray(raw.categoryIds)
      ? raw.categoryIds.map(String)
      : [TIER_NIGHT_SERIES_ALL_CATEGORIES],
    roundCount,
    ready: raw.ready && typeof raw.ready === "object" ? { ...raw.ready } : {},
    setupEpoch: Number(raw.setupEpoch) || 0,
    poolInvalidateRequestId: raw.poolInvalidateRequestId
      ? String(raw.poolInvalidateRequestId)
      : null,
  };
}

/** Codec local (ready par nom) — mapping uid dans gameSync.tierNightPrepToRemote. */
export function tierNightSeriesPrepToRemote(session = getTierNightSeriesPrepSession()) {
  return tierNightPrepToRemote(session);
}

export function tierNightSeriesPrepFromRemote(remote) {
  return tierNightPrepFromRemote(remote);
}

async function syncTierNightSeriesPrepSession(extra = {}, patchOpts = {}) {
  const session = { ...getTierNightSeriesPrepSession(), ...extra };
  saveStatePatch({ tierNightSeriesPrep: session });
  if (!isGameSyncActive()) return session;
  if (!isLobbyHost() && extra.categoryIds === undefined && extra.roundCount === undefined) {
    // Guest ready-only : handled by commitPrepReadyToggle
  }
  await patchGameState(
    { tierNightPrep: tierNightPrepToRemote(session) },
    { gameId: "tiernight", screen: "tiernight-prep", ...patchOpts }
  );
  return session;
}

/**
 * Invalide readiness après changement de setup / pool.
 * Autorité : hôte (ou acting host) bump setupEpoch + clear ready global.
 * Invité : contribute `{ poolInvalidateRequest: { requestId, customEntryId } }`
 *          (custom doit exister + appartenir à auth.uid côté SQL).
 * @param {{ customEntryId?: string|null }} [opts]
 */
export async function invalidateTierNightSeriesPrepReadiness({
  customEntryId = null,
} = {}) {
  if (!isGameSyncActive()) {
    const session = getTierNightSeriesPrepSession();
    const setupEpoch = (Number(session.setupEpoch) || 0) + 1;
    saveStatePatch({
      tierNightSeriesPrep: {
        ...session,
        ready: {},
        setupEpoch,
        poolInvalidateRequestId: null,
      },
    });
    return { ok: true, setupEpoch, localOnly: true };
  }

  if (isLobbyHost() || canActAsHost()) {
    return publishAuthoritativePrepReadyInvalidation();
  }

  const entryId = customEntryId != null ? String(customEntryId).trim() : "";
  if (!entryId) {
    return {
      ok: false,
      code: "CUSTOM_ENTRY_REQUIRED",
      error: "Invalidation pool : customEntryId requis.",
    };
  }

  // Invité : clear local (UX) + demande autoritative liée au custom
  const session = getTierNightSeriesPrepSession();
  saveStatePatch({
    tierNightSeriesPrep: { ...session, ready: {} },
  });
  let requestId;
  try {
    const uid = requireLocalParticipantUid();
    requestId = `inv-${uid}-${Date.now()}`;
  } catch {
    return {
      ok: false,
      error: "Synchronisation du joueur en cours. Réessaie.",
    };
  }
  try {
    const { patchGameStateWithFeedback } = await import("./patchGameStateFeedback.js");
    await patchGameStateWithFeedback(
      {
        tierNightPrep: {
          poolInvalidateRequest: { requestId, customEntryId: entryId },
        },
      },
      {}
    );
    return { ok: true, requested: true, poolInvalidateRequestId: requestId };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || "Impossible de demander l'invalidation ready.",
    };
  }
}

/**
 * Mutation autoritative unique : setupEpoch++ + ready:{} + clear request.
 * Coalesce ≤750 ms ; échec → refresh/reconcile ; pas de mark « honoré » ici.
 */
async function publishAuthoritativePrepReadyInvalidation() {
  const now = Date.now();
  if (now - lastAuthoritativeInvalidateAt < AUTHORITATIVE_INVALIDATE_COALESCE_MS) {
    const session = getTierNightSeriesPrepSession();
    return {
      ok: true,
      coalesced: true,
      setupEpoch: Number(session.setupEpoch) || 0,
      authoritative: true,
    };
  }

  const generation = honorGeneration;
  const session = getTierNightSeriesPrepSession();
  const prevEpoch = Number(session.setupEpoch) || 0;
  const setupEpoch = prevEpoch + 1;
  const snapshot = { ...session };
  const next = {
    ...session,
    ready: {},
    setupEpoch,
    poolInvalidateRequestId: null,
  };
  saveStatePatch({ tierNightSeriesPrep: next });
  lastAuthoritativeInvalidateAt = now;

  try {
    await patchGameState(
      { tierNightPrep: tierNightPrepToRemote(next) },
      { gameId: "tiernight", screen: "tiernight-prep" }
    );
    return { ok: true, setupEpoch, authoritative: true };
  } catch (err) {
    if (generation !== honorGeneration) {
      return { ok: false, staleCallback: true };
    }
    try {
      const { refreshGameSession } = await import("./gameSync.js");
      const row = await refreshGameSession();
      const remote = row?.state?.tierNightPrep || {};
      const remoteEpoch = Number(remote.setupEpoch) || 0;
      const remoteReady =
        remote.ready && typeof remote.ready === "object" ? remote.ready : {};
      const readyEmpty = Object.keys(remoteReady).length === 0;
      if (remoteEpoch > prevEpoch && readyEmpty) {
        return { ok: true, reconciled: true, setupEpoch: remoteEpoch };
      }
      if (remoteEpoch > setupEpoch) {
        return { ok: true, superseded: true, setupEpoch: remoteEpoch };
      }
    } catch {
      /* refresh best-effort */
    }
    const cur = getTierNightSeriesPrepSession();
    if (
      generation === honorGeneration &&
      Number(cur.setupEpoch) === setupEpoch
    ) {
      saveStatePatch({ tierNightSeriesPrep: snapshot });
    }
    lastAuthoritativeInvalidateAt = 0;
    return {
      ok: false,
      error: err?.message || "Impossible d'invalider la préparation.",
      retryable: true,
    };
  }
}

/**
 * Hôte : honore une requête d’invalidation.
 * - Bump epoch seulement si l’empreinte customs a changé (anti-spam request).
 * - Sinon ack : clear request id sans bump.
 * - lastHonored marqué uniquement après succès.
 */
export async function honorTierNightPrepPoolInvalidateRequest(remotePrep) {
  if (!isGameSyncActive()) return { ok: true, skipped: true };
  if (!isLobbyHost() && !canActAsHost()) {
    return { ok: true, skipped: true, notHost: true };
  }
  const requestId =
    remotePrep?.poolInvalidateRequestId ??
    getTierNightSeriesPrepSession().poolInvalidateRequestId;
  if (!shouldHonorPoolInvalidateRequest(lastHonoredPoolInvalidateRequestId, requestId)) {
    return { ok: true, skipped: true };
  }

  const sig = customRosterTopicsPoolSignature(getCustomRosterTopics());
  const poolChanged =
    lastHostSeenCustomsSignature != null && sig !== lastHostSeenCustomsSignature;

  if (!poolChanged) {
    // Request sans mutation pool réelle → ack seul (pas de bump epoch)
    const ack = await ackPoolInvalidateRequestOnly(String(requestId));
    if (ack.ok) lastHonoredPoolInvalidateRequestId = String(requestId);
    return { ...ack, bumped: false, reason: "no_pool_change" };
  }

  const result = await publishAuthoritativePrepReadyInvalidation();
  if (result.ok && !result.retryable) {
    lastHonoredPoolInvalidateRequestId = String(requestId);
    lastHostSeenCustomsSignature = sig;
  }
  return { ...result, bumped: Boolean(result.ok && !result.coalesced) };
}

/** Clear distant du request id sans changer setupEpoch / ready. */
async function ackPoolInvalidateRequestOnly(requestId) {
  const session = getTierNightSeriesPrepSession();
  if (!session.poolInvalidateRequestId) {
    return { ok: true, acked: true, alreadyClear: true };
  }
  const next = { ...session, poolInvalidateRequestId: null };
  const snapshot = session;
  saveStatePatch({ tierNightSeriesPrep: next });
  try {
    await patchGameState(
      { tierNightPrep: { poolInvalidateRequestId: null } },
      { gameId: "tiernight", screen: "tiernight-prep" }
    );
    return { ok: true, acked: true, requestId };
  } catch (err) {
    saveStatePatch({ tierNightSeriesPrep: snapshot });
    return {
      ok: false,
      retryable: true,
      error: err?.message || "Ack invalidate échoué.",
    };
  }
}

/**
 * Hôte : si l’empreinte customs a changé, invalide la readiness globale.
 * Source primaire d’invalidation (request id = hint secondaire).
 * Première observation : amorce à "" pour ne pas avaler le 1er custom sans bump.
 */
export async function honorTierNightPrepCustomsPoolChange(topics) {
  if (!isGameSyncActive()) return { ok: true, skipped: true };
  if (!isLobbyHost() && !canActAsHost()) {
    return { ok: true, skipped: true, notHost: true };
  }
  const sig = customRosterTopicsPoolSignature(topics);
  if (lastHostSeenCustomsSignature == null) {
    lastHostSeenCustomsSignature = "";
  }
  if (sig === lastHostSeenCustomsSignature) {
    return { ok: true, skipped: true };
  }
  const result = await publishAuthoritativePrepReadyInvalidation();
  if (result.ok && !result.retryable) {
    lastHostSeenCustomsSignature = sig;
    const pending = getTierNightSeriesPrepSession().poolInvalidateRequestId;
    if (pending) lastHonoredPoolInvalidateRequestId = String(pending);
  }
  return result;
}

/**
 * Point d’entrée hydrate/Realtime : chaîne sérialisée + catch terminal.
 * Pas de `void` silencieux — rejet toujours journalisé, jamais non géré.
 * @param {object|null|undefined} remotePrep
 * @param {Iterable<object>|null|undefined} topics
 */
export function scheduleTierNightPrepHostHonors(remotePrep, topics) {
  if (!isGameSyncActive()) return Promise.resolve({ ok: true, skipped: true });
  if (!isLobbyHost() && !canActAsHost()) {
    return Promise.resolve({ ok: true, skipped: true, notHost: true });
  }
  honorGeneration += 1;
  const gen = honorGeneration;
  const job = async () => {
    if (gen !== honorGeneration) return { ok: false, staleCallback: true };
    const customs = await honorTierNightPrepCustomsPoolChange(topics);
    if (gen !== honorGeneration) return { ok: false, staleCallback: true };
    const request = await honorTierNightPrepPoolInvalidateRequest(remotePrep);
    return { ok: true, customs, request };
  };
  honorChain = honorChain.then(job, job).catch((err) => {
    console.warn("REVEAL tierNight prep host honor:", err);
    return { ok: false, error: err?.message || String(err) };
  });
  return honorChain;
}

export function getConsumedCustomRosterTopicIds() {
  const ids = getState().consumedCustomRosterTopicIds;
  return Array.isArray(ids) ? ids.map(String) : [];
}

/** excludeCustomIds dérivé de la source de vérité consumed. */
export function getExcludeCustomIdsForSeriesPrep() {
  return getConsumedCustomRosterTopicIds();
}

export function getTierNightSeriesPrepPoolOpts() {
  return {
    customTopics: getCustomRosterTopics(),
    excludeCustomIds: getExcludeCustomIdsForSeriesPrep(),
  };
}

/**
 * roundCount null = état canonique (local + remote) : « aucun count valide ».
 * Source de vérité pool = catalogue filtré + customs hydratés − exclude (consumed).
 * Launch revalide toujours via validateTierNightSeriesSetupForLaunch.
 */
export function getTierNightSeriesPrepSummary() {
  const session = getTierNightSeriesPrepSession();
  const cats = resolveTierNightSeriesSetupCategoryIds(session.categoryIds);
  const opts = getTierNightSeriesPrepPoolOpts();
  const poolSize = getTierNightSeriesPoolSize(cats, opts);
  const requested = session.roundCount;
  const available =
    requested != null &&
    TIER_NIGHT_SERIES_ROUND_COUNTS.includes(Number(requested)) &&
    poolSize >= Number(requested);
  const duration = estimateTierNightSeriesDuration(available ? Number(requested) : 0);
  return {
    poolSize,
    requested: requested == null ? null : Number(requested),
    effective: available ? Number(requested) : 0,
    available,
    durationLabel: available ? duration.label : "-",
    categoryIds: cats,
    roundCountAvailability: getTierNightSeriesRoundCountAvailability(cats, opts),
    setupEpoch: session.setupEpoch,
  };
}

export async function setTierNightSeriesPrepCategories(categoryIds) {
  if (isGameSyncActive() && !isLobbyHost()) {
    return { ok: false, code: "HOST_ONLY", message: "Seul l'hôte modifie les catégories." };
  }
  const shape = validateTierNightSeriesCategoryIdsShape(categoryIds);
  if (!shape.ok) {
    return { ok: false, code: shape.code, message: shape.message };
  }
  const prev = getTierNightSeriesPrepSession();
  const reconciled = reconcileTierNightSeriesSetupAfterCategoryChange(
    {
      path: "series",
      categoryIds: shape.categoryIds,
      roundCount: prev.roundCount,
    },
    getTierNightSeriesPrepPoolOpts()
  );
  const next = {
    categoryIds: shape.categoryIds,
    roundCount: reconciled.roundCount,
  };
  const setupEpoch = didTierNightSeriesPrepSetupChange(prev, next)
    ? (Number(prev.setupEpoch) || 0) + 1
    : prev.setupEpoch;
  await syncTierNightSeriesPrepSession({
    ...next,
    ready: didTierNightSeriesPrepSetupChange(prev, next) ? {} : prev.ready,
    setupEpoch,
  });
  return { ok: true };
}

export async function setTierNightSeriesPrepRoundCount(roundCount) {
  if (isGameSyncActive() && !isLobbyHost()) {
    return { ok: false, code: "HOST_ONLY", message: "Seul l'hôte modifie la longueur." };
  }
  const n = Number(roundCount);
  if (!TIER_NIGHT_SERIES_ROUND_COUNTS.includes(n)) {
    return { ok: false, code: "INVALID_ROUND_COUNT" };
  }
  const cats = resolveTierNightSeriesSetupCategoryIds(
    getTierNightSeriesPrepSession().categoryIds
  );
  const avail = getTierNightSeriesRoundCountAvailability(
    cats,
    getTierNightSeriesPrepPoolOpts()
  ).find((a) => a.roundCount === n);
  if (!avail?.available) {
    return { ok: false, code: "INSUFFICIENT_TOPICS" };
  }
  const prev = getTierNightSeriesPrepSession();
  const next = { roundCount: n };
  const changed = didTierNightSeriesPrepSetupChange(prev, { ...prev, ...next });
  await syncTierNightSeriesPrepSession({
    roundCount: n,
    ready: changed ? {} : prev.ready,
    setupEpoch: changed ? (Number(prev.setupEpoch) || 0) + 1 : prev.setupEpoch,
  });
  return { ok: true };
}

/**
 * Ready joueur : contribution UID + expectedSetupEpoch (anti-stale B1).
 * Payload contribute :
 * `{ tierNightPrep: { ready: { [uid]: bool }, expectedSetupEpoch } }`
 * → RPC value `{ ready, expectedSetupEpoch }`.
 */
export async function setTierNightSeriesPrepReady(playerName, ready) {
  await commitPrepReadyToggle({
    readyKey: playerName,
    ready,
    getSession: getTierNightSeriesPrepSession,
    saveLocal: (session) => saveStatePatch({ tierNightSeriesPrep: session }),
    stateKey: "tierNightPrep",
    gameId: "tiernight",
    screen: "tiernight-prep",
    buildRemoteReadyPatch: (uid, readyVal, session) => ({
      ready: { [uid]: Boolean(readyVal) },
      expectedSetupEpoch: Number(session.setupEpoch) || 0,
    }),
    isBenignRemoteFailure: (err) =>
      /Ready obsolète|expectedSetupEpoch|setupEpoch diverg/i.test(
        String(err?.message || err || "")
      ),
  });
}

export function allTierNightSeriesPrepReady() {
  const session = getTierNightSeriesPrepSession();
  if (isGameSyncActive()) {
    return allMembersReady(session.ready || {});
  }
  return getActivePlayerNames().every((n) => session.ready[n]);
}

export function simulateTierNightSeriesPrepReady(onUpdate) {
  const pool = getActivePlayerNames().filter((n) => n !== getLocalDisplayName());
  let i = 0;
  const id = setInterval(() => {
    if (i >= pool.length) {
      clearInterval(id);
      onUpdate?.();
      return;
    }
    void setTierNightSeriesPrepReady(pool[i], true);
    i += 1;
    onUpdate?.();
  }, 600);
  return () => clearInterval(id);
}

/**
 * Reset settings+ready autoritatif — **ne touche pas** consumedCustomRosterTopicIds.
 * FEATURE-TIERNIGHT-03-C1 — bump setupEpoch (monotone) pour qu’un reset ne soit
 * pas ignoré par merge face à un prep distant plus récent.
 */
export function resetTierNightSeriesPrepSession() {
  const prev = getTierNightSeriesPrepSession();
  const setupEpoch = (Number(prev.setupEpoch) || 0) + 1;
  saveStatePatch({
    tierNightSeriesPrep: {
      ...defaultPrepSession(),
      setupEpoch,
    },
  });
}

export function getMyCustomRosterTopicsForPrep() {
  const name = getLocalDisplayName();
  const uid = getState().lobby?.participants?.find((p) => p.name === name)?.userId;
  return getCustomRosterTopics().filter((t) => {
    if (uid && t.authorUid) return String(t.authorUid) === String(uid);
    return t.author === name || !t.author;
  });
}

export function countOtherPlayersCustomRosterTopics() {
  const name = getLocalDisplayName();
  const uid = getState().lobby?.participants?.find((p) => p.name === name)?.userId;
  return getCustomRosterTopics().filter((t) => {
    if (uid && t.authorUid) return String(t.authorUid) !== String(uid);
    return t.author && t.author !== name;
  }).length;
}

export async function addCustomRosterTopicFromPrep(name) {
  const res = await addCustomRosterTopicAndSync({ name });
  if (res?.ok) {
    await invalidateTierNightSeriesPrepReadiness({ customEntryId: res.id });
  }
  return res;
}

export async function removeCustomRosterTopicFromPrep(id) {
  const res = await deleteCustomRosterTopicAndSync(id);
  if (!res?.ok) return res;
  if (isLobbyHost() || canActAsHost()) {
    await invalidateTierNightSeriesPrepReadiness();
  } else {
    // Invité : le delete RPC change déjà l’empreinte customs ;
    // l’hôte bump via honorTierNightPrepCustomsPoolChange (pas de request sans custom vivant).
    const session = getTierNightSeriesPrepSession();
    saveStatePatch({ tierNightSeriesPrep: { ...session, ready: {} } });
  }
  return res;
}

/**
 * Écran d’entrée série : prep tant qu’aucune série active (phase ranking…).
 */
export function getTierNightSeriesPrepEntryScreen() {
  const game = getState().tierNightGame;
  if (game?.series && typeof game.series === "object") {
    const phase = game.series.phase;
    if (phase && phase !== "series_end") return "tiernight";
  }
  if (
    game?.lobbyStarted &&
    Array.isArray(game?.items) &&
    game.items.length &&
    !game.series
  ) {
    return "tiernight";
  }
  return "tiernight-prep";
}

/**
 * Entrée prep depuis le select (chemin série volontaire).
 * @param {{ resetSettings?: boolean }} [opts]
 *   resetSettings=true (défaut) : nouveau prep — clear settings/ready, preserve consumed.
 *   resetSettings=false : reprise / follow — hydrate remote, ne wipe pas.
 */
export async function enterTierNightSeriesPrep({ resetSettings = true } = {}) {
  if (resetSettings) {
    resetTierNightSeriesPrepSession();
  }
  const session = getTierNightSeriesPrepSession();
  const navOpts = {
    navStack: ["home", "lobby", "game-select", "tiernight-select", "tiernight-prep"],
  };

  if (!isGameSyncActive()) {
    navigate("tiernight-prep", navOpts);
    return { ok: true, localOnly: true };
  }

  if (isLobbyHost() && resetSettings) {
    try {
      await patchGameState(
        { tierNightPrep: tierNightPrepToRemote(session) },
        { gameId: "tiernight", screen: "tiernight-prep" }
      );
    } catch (err) {
      return {
        ok: false,
        error: err?.message || "Impossible d'ouvrir la préparation série.",
      };
    }
  } else if (isLobbyHost() && !resetSettings) {
    try {
      await patchGameState(
        {},
        { gameId: "tiernight", screen: "tiernight-prep" }
      );
    } catch {
      /* screen bump best-effort */
    }
  }

  navigate("tiernight-prep", navOpts);
  return { ok: true };
}

/**
 * Launch hôte : prepare queue une fois + mark (consumed dans la même mutation).
 * @param {{ rosterNames?: string[] }} [opts]
 * @returns {Promise<object>}
 */
export async function markTierNightSeriesPrepStarted({ rosterNames } = {}) {
  const session = getTierNightSeriesPrepSession();
  const poolOpts = getTierNightSeriesPrepPoolOpts();
  const setupCheck = validateTierNightSeriesSetupForLaunch(
    {
      path: "series",
      categoryIds: session.categoryIds,
      roundCount: session.roundCount,
    },
    poolOpts
  );
  if (!setupCheck.ok) {
    return { ok: false, error: setupCheck.message, code: setupCheck.code };
  }

  const { participants } = resolveTierNightSeriesLaunchParticipants({
    participants: getLobbyParticipants(),
    rosterNames,
  });

  const prepared = prepareTierNightSeriesLaunchAttempt({
    categoryIds: session.categoryIds,
    roundCount: session.roundCount,
    modifier: "normal",
    participants,
    customTopics: getCustomRosterTopics(),
    excludeCustomIds: getExcludeCustomIdsForSeriesPrep(),
  });

  if (!prepared.ok) {
    return {
      ok: false,
      error: prepared.error || "Impossible de préparer la série.",
      code: prepared.code,
    };
  }

  const beforeSeries = getState().tierNightGame?.series;
  if (beforeSeries?.phase && beforeSeries.phase !== "series_end") {
    return {
      ok: false,
      code: "SERIES_ALREADY_ACTIVE",
      error: "Une série est déjà en cours.",
    };
  }

  // Ledger prévu avant mark — appliqué localement + dans la même mutation remote
  const mergedConsumed = mergeConsumedCustomTopicIds(
    getConsumedCustomRosterTopicIds(),
    prepared.attempt.series
  );

  const result = await markTierNightSeriesStarted({
    attempt: prepared.attempt,
    consumedCustomRosterTopicIds: mergedConsumed,
    resetPrepSession: defaultPrepSession(),
  });

  if (result?.ok === false) {
    return result;
  }

  return { ...result, ok: true, consumedCustomTopicIds: mergedConsumed };
}
