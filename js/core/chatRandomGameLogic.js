/**
 * FEATURE-CHAT-03 — logique pure roulette « Jeu aléatoire ».
 * Pas de DOM / Supabase : testable unitairement.
 *
 * Séparation horloges :
 * - **Cosmétique** : `animationStartTimestamp` = `Date.now()` hôte ; seek invité
 *   borné 0…1 via `chatRouletteSpinProgress` (aucune décision métier).
 * - **Métier (blocage launch)** : `isChatRouletteBlockingLaunch` — observation
 *   locale monotone (`performance.now`) + âge vs `game_sessions.updated_at`
 *   (serveur). `expiresAt` hôte n’est qu’un indice clampé, jamais une vérité
 *   sans borne.
 */
import { GAMES_AVAILABLE } from "../../data/games.js";
import { TRAITRE_MIN_PLAYERS } from "../../data/traitre.js";
import { TRUTH_METER_MIN_PLAYERS } from "../../data/truthMeter.js";
import {
  SESSION_GAME_ID_TO_TILE,
  TILE_ID_TO_SESSION_GAME_ID,
} from "./gameCatalogTitle.js";

/** Durée cible de l’animation slot (cosmétique). */
export const CHAT_ROULETTE_DURATION_MS = 2300;

/** Relances max après un résultat. */
export const CHAT_ROULETTE_MAX_REROLLS = 3;

/**
 * Fenêtre laissée à l’hôte pour confirmer / relancer après un résultat
 * (ou pour cliquer « Commencer » depuis le prompt).
 */
export const CHAT_ROULETTE_CONFIRM_MS = 60_000;

/** Marge réseau / skew d’horloge client (cosmétique + construction expiresAt hôte). */
export const CHAT_ROULETTE_NETWORK_MARGIN_MS = 5_000;

/**
 * Fenêtre hôte indicative (`expiresAt` = activityAt + TTL).
 * N’est plus la source de vérité pour bloquer `restartGame` — voir
 * `CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS` + `isChatRouletteBlockingLaunch`.
 */
export const CHAT_ROULETTE_TTL_MS =
  CHAT_ROULETTE_CONFIRM_MS +
  CHAT_ROULETTE_DURATION_MS +
  CHAT_ROULETTE_NETWORK_MARGIN_MS;

/**
 * Durée max de vie métier d’une roulette **sur un client**, mesurée depuis
 * la première observation locale (horloge monotone) et/ou l’âge dérivé de
 * `game_sessions.updated_at` (horloge serveur Postgres).
 *
 * Impératif : une roulette distante ne peut jamais bloquer plus longtemps
 * que cette borne après première observation — même si `expiresAt` hôte
 * est dans un futur lointain (horloge hôte avancée).
 */
export const CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS = CHAT_ROULETTE_TTL_MS;

/**
 * Marge pour skew NTP / parse de `updated_at` vs `Date.now()` local
 * (pas pour faire confiance à l’horloge hôte applicative).
 */
export const CHAT_ROULETTE_SERVER_AGE_SKEW_MS = 15_000;

export const CHAT_ROULETTE_STATE_KEY = "chatRoulette";

/** Écrans hub où la CTA / la roulette a du sens (aligné sondages). */
export const CHAT_ROULETTE_LOCAL_SCREENS = new Set([
  "game-select",
  "results",
  "leaderboard",
]);

const PHASES = new Set(["prompt", "spinning", "result", "cancelled"]);

/**
 * Horloge monotone locale (durée intra-process). Fallback Date.now() en tests Node.
 * Ne jamais persister cette valeur dans le state partagé.
 */
export function chatRouletteMonotonicNow() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/** @param {string|number|null|undefined} raw */
export function parseSessionUpdatedAtMs(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

/** Min joueurs au lancement catalogue — miroir des gardes `restartGame`. */
export function catalogTileMinPlayers(tileId) {
  if (tileId === "traitre-prep") return TRAITRE_MIN_PLAYERS;
  if (tileId === "truthmeter-prep") return TRUTH_METER_MIN_PLAYERS;
  return 1;
}

/**
 * @param {string} tileId
 * @param {number} playerCount
 */
export function isCatalogTileEligibleForCount(tileId, playerCount) {
  if (!TILE_ID_TO_SESSION_GAME_ID[tileId]) return false;
  return Number(playerCount) >= catalogTileMinPlayers(tileId);
}

/**
 * @param {{
 *   games?: Array<{ id: string, title: string, emoji: string, enabled?: boolean }>,
 *   playerCount: number,
 *   excludeTileIds?: Iterable<string>,
 * }} args
 */
export function buildEligibleCatalogGames({
  games = GAMES_AVAILABLE,
  playerCount,
  excludeTileIds = [],
} = {}) {
  const exclude = new Set(
    [...(excludeTileIds || [])].filter(Boolean).map(String)
  );
  return (games || [])
    .filter((g) => g && g.enabled !== false)
    .filter((g) => TILE_ID_TO_SESSION_GAME_ID[g.id])
    .filter((g) => !exclude.has(g.id))
    .filter((g) => isCatalogTileEligibleForCount(g.id, playerCount))
    .map((g) => ({
      id: g.id,
      title: g.title,
      emoji: g.emoji || "🎲",
    }));
}

/**
 * Tiles à exclure : jeu session actif (≠ menu) + dernier jeu si entre deux parties.
 */
export function resolveExcludedTileIds({
  sessionGameId = null,
  sessionScreen = null,
  lastGameId = null,
  postGameScreens = new Set(["results", "leaderboard"]),
} = {}) {
  const exclude = new Set();
  if (sessionGameId && sessionGameId !== "menu") {
    const tile = SESSION_GAME_ID_TO_TILE[sessionGameId];
    if (tile) exclude.add(tile);
  }
  const betweenGames =
    !sessionGameId ||
    sessionGameId === "menu" ||
    (sessionScreen && postGameScreens.has(sessionScreen));
  if (betweenGames && lastGameId) {
    const tile = SESSION_GAME_ID_TO_TILE[lastGameId];
    if (tile) exclude.add(tile);
  }
  return [...exclude];
}

/** Pool final : si exclusion du dernier jeu vide tout, on réessaye sans. */
export function resolveEligibleCatalogGames(args = {}) {
  const {
    games = GAMES_AVAILABLE,
    playerCount,
    sessionGameId = null,
    sessionScreen = null,
    lastGameId = null,
    postGameScreens,
  } = args;

  const fullExclude = resolveExcludedTileIds({
    sessionGameId,
    sessionScreen,
    lastGameId,
    postGameScreens,
  });
  let eligible = buildEligibleCatalogGames({
    games,
    playerCount,
    excludeTileIds: fullExclude,
  });
  if (eligible.length > 0) return eligible;

  const withoutLast = resolveExcludedTileIds({
    sessionGameId,
    sessionScreen,
    lastGameId: null,
    postGameScreens,
  });
  return buildEligibleCatalogGames({
    games,
    playerCount,
    excludeTileIds: withoutLast,
  });
}

/** @param {Array<{ id: string }>} eligible @param {() => number} [rng] */
export function pickRandomEligibleGame(eligible, rng = Math.random) {
  if (!eligible?.length) return null;
  const idx = Math.floor(rng() * eligible.length);
  return eligible[Math.min(eligible.length - 1, Math.max(0, idx))] || null;
}

export function newChatRouletteId(now = Date.now()) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `roulette-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newChatRouletteAttemptId(now = Date.now()) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `attempt-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** @deprecated alias — préfère newChatRouletteId */
export function newChatRouletteEventId(now = Date.now()) {
  return newChatRouletteId(now);
}

/**
 * Calcule `expiresAt` (activité + TTL). Source horloge : epoch ms hôte.
 * @param {number} activityAt
 */
export function computeChatRouletteExpiresAt(
  activityAt,
  ttlMs = CHAT_ROULETTE_TTL_MS
) {
  const t = Number(activityAt);
  if (!Number.isFinite(t)) return 0;
  return t + Math.max(0, Number(ttlMs) || CHAT_ROULETTE_TTL_MS);
}

/**
 * @param {unknown} raw
 * @returns {null|{
 *   rouletteId: string,
 *   attemptId: string,
 *   phase: "prompt"|"spinning"|"result"|"cancelled",
 *   selectedTileId: string|null,
 *   eligibleTileIds: string[],
 *   createdAt: number,
 *   animationStartTimestamp: number|null,
 *   animationDurationMs: number,
 *   expiresAt: number,
 *   rerollCount: number,
 *   maxRerolls: number,
 * }}
 */
export function normalizeChatRouletteEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const phase = String(raw.phase || "");
  if (!PHASES.has(phase)) return null;

  // Compat : eventId (v1) → rouletteId
  const rouletteId = String(raw.rouletteId || raw.eventId || "").trim();
  if (!rouletteId) return null;

  const attemptId = String(raw.attemptId || rouletteId).trim() || rouletteId;

  const eligibleTileIds = Array.isArray(raw.eligibleTileIds)
    ? raw.eligibleTileIds.map(String).filter((id) => TILE_ID_TO_SESSION_GAME_ID[id])
    : [];

  let selectedTileId =
    raw.selectedTileId != null ? String(raw.selectedTileId) : null;
  if (selectedTileId && !TILE_ID_TO_SESSION_GAME_ID[selectedTileId]) {
    selectedTileId = null;
  }
  if ((phase === "spinning" || phase === "result") && !selectedTileId) {
    return null;
  }

  const createdAtRaw = Number(raw.createdAt);
  const createdAt = Number.isFinite(createdAtRaw)
    ? createdAtRaw
    : Number.isFinite(Number(raw.animationStartTimestamp))
      ? Number(raw.animationStartTimestamp)
      : 0;
  if (!createdAt) return null;

  const animationStartTimestamp =
    raw.animationStartTimestamp == null
      ? null
      : Number(raw.animationStartTimestamp);
  const animationDurationMs = Math.max(
    0,
    Number(raw.animationDurationMs) || CHAT_ROULETTE_DURATION_MS
  );
  const rerollCount = Math.max(0, Number(raw.rerollCount) || 0);
  const maxRerolls = Math.max(
    0,
    Number(raw.maxRerolls) || CHAT_ROULETTE_MAX_REROLLS
  );

  const expiresAtRaw = Number(raw.expiresAt);
  const expiresAt = Number.isFinite(expiresAtRaw)
    ? expiresAtRaw
    : computeChatRouletteExpiresAt(createdAt);

  return {
    rouletteId,
    attemptId,
    phase,
    selectedTileId,
    eligibleTileIds,
    createdAt,
    animationStartTimestamp: Number.isFinite(animationStartTimestamp)
      ? animationStartTimestamp
      : null,
    animationDurationMs,
    expiresAt,
    rerollCount,
    maxRerolls,
  };
}

/**
 * Clé d’activité métier : nouvelle fenêtre TTL seulement si elle change
 * (nouvelle rouletteId ou nouvel attemptId / relance).
 * @param {{ rouletteId?: string, attemptId?: string }|null} ev
 */
export function chatRouletteActivityKey(ev) {
  if (!ev?.rouletteId) return null;
  return `${ev.rouletteId}|${ev.attemptId || ev.rouletteId}`;
}

/**
 * Mémoire d’observation locale (process) — jamais synchronisée.
 * @type {Map<string, { activityKey: string, firstSeenMono: number, serverUpdatedAtMs: number|null }>}
 */
const localObservations = new Map();

export function resetChatRouletteObservationsForTests() {
  localObservations.clear();
}

export function getChatRouletteObservation(activityKey) {
  if (!activityKey) return null;
  return localObservations.get(activityKey) || null;
}

/**
 * Enregistre la première observation d’une activité.
 * Ne rafraîchit PAS si la même clé est déjà connue (rerender / patch identique).
 *
 * @param {unknown} chatRoulette
 * @param {{
 *   nowMonotonic?: number,
 *   sessionUpdatedAtMs?: number|null,
 * }} [opts]
 */
export function observeChatRouletteActivity(chatRoulette, opts = {}) {
  const n = normalizeChatRouletteEvent(chatRoulette);
  const key = chatRouletteActivityKey(n);
  if (!key) return null;
  const existing = localObservations.get(key);
  if (existing) return existing;
  const nowMonotonic =
    opts.nowMonotonic != null ? opts.nowMonotonic : chatRouletteMonotonicNow();
  const serverUpdatedAtMs =
    opts.sessionUpdatedAtMs != null && Number.isFinite(opts.sessionUpdatedAtMs)
      ? opts.sessionUpdatedAtMs
      : null;
  const obs = {
    activityKey: key,
    firstSeenMono: nowMonotonic,
    serverUpdatedAtMs,
  };
  localObservations.set(key, obs);
  return obs;
}

/**
 * Source unique métier : la roulette bloque-t-elle encore un lancement ?
 *
 * Ne fait PAS confiance à `expiresAt` hôte sans borne.
 * Priorité : (1) âge vs `updated_at` serveur (2) durée monotone locale
 * depuis première observation (3) clamp défensif de `expiresAt`.
 *
 * @param {{
 *   chatRoulette?: unknown,
 *   localObservation?: { activityKey: string, firstSeenMono: number, serverUpdatedAtMs?: number|null }|null,
 *   nowWallClock?: number,
 *   nowMonotonic?: number|null,
 *   sessionUpdatedAtMs?: number|null,
 * }} [args]
 */
export function isChatRouletteBlockingLaunch({
  chatRoulette = null,
  localObservation = null,
  nowWallClock = Date.now(),
  nowMonotonic = null,
  sessionUpdatedAtMs = null,
} = {}) {
  const n = normalizeChatRouletteEvent(chatRoulette);
  if (!n) return false;
  if (n.phase === "cancelled") return false;

  const key = chatRouletteActivityKey(n);
  const wall = Number(nowWallClock);
  if (!Number.isFinite(wall)) return false;

  const obs =
    localObservation && localObservation.activityKey === key
      ? localObservation
      : null;

  const serverTs =
    sessionUpdatedAtMs != null && Number.isFinite(sessionUpdatedAtMs)
      ? sessionUpdatedAtMs
      : obs?.serverUpdatedAtMs != null && Number.isFinite(obs.serverUpdatedAtMs)
        ? obs.serverUpdatedAtMs
        : null;

  // (1) Âge serveur — indépendant de l’horloge applicative de l’hôte
  if (serverTs != null) {
    const serverAge = Math.max(0, wall - serverTs);
    if (
      serverAge >
      CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS + CHAT_ROULETTE_SERVER_AGE_SKEW_MS
    ) {
      return false;
    }
  }

  // (2) Durée monotone depuis première observation locale
  const mono =
    nowMonotonic != null && Number.isFinite(nowMonotonic) ? nowMonotonic : null;
  if (obs && mono != null) {
    const localAge = mono - obs.firstSeenMono;
    if (localAge > CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS) return false;
    return true;
  }

  // (3) Cold start sans observation mono : serveur déjà filtré ci-dessus.
  if (serverTs != null) {
    return true;
  }

  // (4) Dernier recours : clamp `expiresAt` hôte — jamais plus que now+MAX_LOCAL
  const clampedExpires = Math.min(
    n.expiresAt,
    wall + CHAT_ROULETTE_MAX_LOCAL_LIFETIME_MS
  );
  // Horloge hôte en retard : expiresAt déjà passé → inactif sans serveur/obs
  // (après redémarrage app sans updated_at : pessimiste, ne bloque pas).
  return wall <= clampedExpires;
}

/**
 * Alias métier « active » = bloque encore launch / peut afficher la modale.
 * Accepte `(ev, nowWall)` legacy ou `(ev, opts)`.
 *
 * @param {unknown} chatRoulette
 * @param {number|object} [nowOrOpts]
 */
export function isChatRouletteActive(chatRoulette, nowOrOpts = Date.now()) {
  if (typeof nowOrOpts === "number") {
    return isChatRouletteBlockingLaunch({
      chatRoulette,
      nowWallClock: nowOrOpts,
    });
  }
  return isChatRouletteBlockingLaunch({
    chatRoulette,
    ...(nowOrOpts && typeof nowOrOpts === "object" ? nowOrOpts : {}),
  });
}

/** @deprecated — utiliser isChatRouletteActive / isChatRouletteBlockingLaunch */
export function isChatRouletteEventActive(ev, now = Date.now()) {
  return isChatRouletteActive(ev, now);
}

/**
 * Progression 0→1 de l'animation (cosmétique uniquement).
 * Indépendant du TTL métier. Borne : horloge aberrante → clamp.
 */
export function chatRouletteSpinProgress(ev, now = Date.now()) {
  const n = normalizeChatRouletteEvent(ev);
  if (!n) return 0;
  if (n.phase === "result" || n.phase === "cancelled") return 1;
  if (n.phase !== "spinning" || n.animationStartTimestamp == null) return 0;
  if (n.animationDurationMs <= 0) return 1;
  const t = Number(now);
  if (!Number.isFinite(t)) return 1;
  const elapsed = t - n.animationStartTimestamp;
  if (!Number.isFinite(elapsed)) return 1;
  return Math.min(1, Math.max(0, elapsed / n.animationDurationMs));
}

export function chatRouletteShouldShowResult(ev, now = Date.now()) {
  const n = normalizeChatRouletteEvent(ev);
  if (!n) return false;
  if (n.phase === "result") return true;
  if (n.phase === "spinning") return chatRouletteSpinProgress(n, now) >= 1;
  return false;
}

export function canRerollChatRoulette(ev, opts = {}) {
  const n = normalizeChatRouletteEvent(ev);
  if (!n) return false;
  const active =
    typeof opts === "number"
      ? isChatRouletteActive(n, opts)
      : isChatRouletteBlockingLaunch({ chatRoulette: n, ...opts });
  if (!active) return false;
  if (n.phase !== "result" && n.phase !== "spinning") return false;
  return n.rerollCount < n.maxRerolls;
}

/**
 * Une action ne s’applique que si elle cible encore l’événement courant.
 * @param {{ rouletteId?: string, attemptId?: string }|null} expected
 * @param {{ rouletteId?: string, attemptId?: string }|null} current
 * @param {{ matchAttempt?: boolean }} [opts]
 */
export function isChatRouletteActionCurrent(expected, current, opts = {}) {
  if (!expected?.rouletteId || !current?.rouletteId) return false;
  if (String(expected.rouletteId) !== String(current.rouletteId)) return false;
  if (opts.matchAttempt) {
    if (!expected.attemptId || !current.attemptId) return false;
    if (String(expected.attemptId) !== String(current.attemptId)) return false;
  }
  return true;
}

/**
 * Rouleau slot : plusieurs tours + atterrissage sur le gagnant.
 * @returns {{ reel: Array<{id:string,title:string,emoji:string}>, landingIndex: number }}
 */
export function buildSlotReel(eligibleGames, winnerTileId, { loops = 5 } = {}) {
  const games = eligibleGames?.length ? eligibleGames : [];
  const winner =
    games.find((g) => g.id === winnerTileId) || games[0] || null;
  if (!winner) return { reel: [], landingIndex: 0 };

  const reel = [];
  for (let i = 0; i < loops; i++) {
    for (const g of games) reel.push(g);
  }
  for (const g of games) reel.push(g);
  const wIdx = games.findIndex((g) => g.id === winner.id);
  const landingIndex = loops * games.length + (wIdx >= 0 ? wIdx : 0);
  return { reel, landingIndex };
}

export function localScreenAllowsChatRoulette(screenId) {
  return CHAT_ROULETTE_LOCAL_SCREENS.has(screenId);
}

/**
 * Miroir phase menu (sondage) : session menu ou absente.
 * @param {{ game_id?: string, gameId?: string, screen?: string }|null} sessionRow
 * @param {string|null|undefined} lobbyGameId
 */
export function remotePhaseAllowsChatRoulette(sessionRow, lobbyGameId) {
  if (!sessionRow) {
    return lobbyGameId == null || lobbyGameId === "menu";
  }
  const gameId = sessionRow.game_id ?? sessionRow.gameId ?? null;
  const screen = sessionRow.screen ?? null;
  return gameId === "menu" && CHAT_ROULETTE_LOCAL_SCREENS.has(screen);
}

/**
 * Construit un payload prompt (nouvel `rouletteId`).
 * @param {Array<{id:string}>} eligible
 * @param {number} [now]
 */
export function buildChatRoulettePromptPayload(eligible, now = Date.now()) {
  const createdAt = now;
  return {
    rouletteId: newChatRouletteId(now),
    attemptId: newChatRouletteAttemptId(now),
    phase: "prompt",
    selectedTileId: null,
    eligibleTileIds: (eligible || []).map((g) => g.id),
    createdAt,
    animationStartTimestamp: null,
    animationDurationMs: CHAT_ROULETTE_DURATION_MS,
    expiresAt: computeChatRouletteExpiresAt(createdAt),
    rerollCount: 0,
    maxRerolls: CHAT_ROULETTE_MAX_REROLLS,
  };
}

/**
 * Spin / résultat / relance. Conserve `rouletteId` ; nouvel `attemptId`.
 * @param {ReturnType<typeof normalizeChatRouletteEvent>|null} prev
 * @param {{ id: string }} pick
 * @param {Array<{id:string}>} eligible
 * @param {{ reroll?: boolean, now?: number }} [opts]
 */
export function buildChatRouletteSpinPayload(
  prev,
  pick,
  eligible,
  { reroll = false, now = Date.now() } = {}
) {
  const single = (eligible || []).length <= 1;
  const createdAt = prev?.createdAt || now;
  return {
    rouletteId: prev?.rouletteId || newChatRouletteId(now),
    attemptId: newChatRouletteAttemptId(now),
    phase: single ? "result" : "spinning",
    selectedTileId: pick.id,
    eligibleTileIds: (eligible || []).map((g) => g.id),
    createdAt,
    animationStartTimestamp: now,
    animationDurationMs: CHAT_ROULETTE_DURATION_MS,
    expiresAt: computeChatRouletteExpiresAt(now),
    rerollCount: reroll ? (prev?.rerollCount || 0) + 1 : prev?.rerollCount || 0,
    maxRerolls: CHAT_ROULETTE_MAX_REROLLS,
  };
}
