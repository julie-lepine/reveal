/**
 * FEATURE-TIERNIGHT-04E - préparation tentative + wire série Rank Live.
 *
 * Catalogue officiel = `TIER_LISTS` (via officialLists / getTierNightLiveOfficialPool).
 * Builder sélection = `buildTierNightLiveSeriesListSubset` (04B) UNIQUEMENT.
 * Serveur = validation structurelle + match customs + commit atomique (pas de catalogue SQL).
 */
import { createTierNightRunId } from "./tierNightConfig.js";
import {
  buildTierNightLiveSeriesListSubset,
  TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES,
  isValidTierNightLiveRoundCount,
  isReadableTierNightLiveRoundCount,
} from "./tierNightLiveSeriesDomain.js";
import {
  TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN,
  TIER_NIGHT_LIVE_SERIES_PHASE_END,
  TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING,
  projectTierNightLiveSeriesRound0 as projectRound0FromRuntime,
} from "./tierNightLiveSeriesRuntime.js";
import {
  LIVE_TIER_LIST_ITEM_MAX,
  LIVE_TIER_LIST_NAME_MAX,
  normalizeLiveTierListEmoji,
  normalizeLiveTierListName,
} from "./customLiveTierLists.js";

export const TIER_NIGHT_LIVE_SERIES_KIND = "live";
export { TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING };
export {
  TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN,
  TIER_NIGHT_LIVE_SERIES_PHASE_END,
};

export const TIER_NIGHT_LIVE_LAUNCH_ERROR_MESSAGES = Object.freeze({
  TNS_LIVE_INVALID_ROUND_COUNT: "Longueur de série invalide. Choisis 3, 5 ou 8 listes.",
  TNS_LIVE_INSUFFICIENT_TIER_LISTS:
    "Pas assez de tier lists pour cette longueur. Ajoute des customs ou réduis le nombre.",
  TNS_LIVE_PREP_STALE:
    "La préparation a changé. Mets à jour et relance quand tu es prêt.",
  TNS_LIVE_ALREADY_STARTED: "La série Rank Live est déjà lancée.",
  TNS_LIVE_CORRUPT_CUSTOM: "Une liste custom est invalide. Corrige-la puis réessaie.",
  TNS_LIVE_CORRUPT_STATE: "État de préparation invalide. Reviens au select puis réessaie.",
  TNS_LIVE_CUSTOM_SNAPSHOT_MISMATCH:
    "Une liste custom a changé. Relance après mise à jour.",
  TNS_LIVE_CUSTOM_POOL_STALE:
    "Le pool de listes custom a changé. Mets à jour et relance.",
  TNS_LIVE_HOST_REQUIRED: "Seul l'hôte peut lancer la série Rank Live.",
  TNS_LIVE_LAUNCH_FAILED: "Impossible de lancer la série. Réessaie dans un instant.",
  TNS_LIVE_CUSTOM_LOCKED: "Les listes custom sont verrouillées pour cette série.",
  INVALID_ROUND_COUNT: "Longueur de série invalide. Choisis 3, 5 ou 8 listes.",
  INSUFFICIENT_POOL:
    "Pas assez de tier lists pour cette longueur. Ajoute des customs ou réduis le nombre.",
});

const TNS_LIVE_CODE_RE = /TNS_LIVE_[A-Z0-9_]+/;
/** Codes PostgREST/Postgres génériques — jamais affichés tels quels (ex. P0001). */
const GENERIC_RPC_ERRCODES = new Set(["P0001", "57014", "40001", "40P01"]);

/**
 * Extrait le code métier TNS_LIVE_* depuis une erreur Supabase/PostgREST.
 * `error.code` est souvent P0001 (RAISE) — le motif utile est dans message/details.
 */
export function extractTierNightLiveLaunchCode(errOrCode, fallbackMessage = "") {
  if (typeof errOrCode === "string") {
    if (TNS_LIVE_CODE_RE.test(errOrCode) && !GENERIC_RPC_ERRCODES.has(errOrCode)) {
      return errOrCode.match(TNS_LIVE_CODE_RE)[0];
    }
    if (GENERIC_RPC_ERRCODES.has(errOrCode) || errOrCode === "P0001") {
      const fromFallback = String(fallbackMessage || "").match(TNS_LIVE_CODE_RE)?.[0];
      return fromFallback || "TNS_LIVE_LAUNCH_FAILED";
    }
    if (TIER_NIGHT_LIVE_LAUNCH_ERROR_MESSAGES[errOrCode]) return errOrCode;
    const fromSelf = errOrCode.match(TNS_LIVE_CODE_RE)?.[0];
    return fromSelf || errOrCode || "TNS_LIVE_LAUNCH_FAILED";
  }
  const blob = [
    errOrCode?.message,
    errOrCode?.details,
    errOrCode?.hint,
    fallbackMessage,
  ]
    .filter(Boolean)
    .join("\n");
  const fromMsg = blob.match(TNS_LIVE_CODE_RE)?.[0];
  if (fromMsg) return fromMsg;
  const rawCode = errOrCode?.code != null ? String(errOrCode.code) : "";
  if (rawCode && !GENERIC_RPC_ERRCODES.has(rawCode) && TIER_NIGHT_LIVE_LAUNCH_ERROR_MESSAGES[rawCode]) {
    return rawCode;
  }
  if (rawCode && !GENERIC_RPC_ERRCODES.has(rawCode) && TNS_LIVE_CODE_RE.test(rawCode)) {
    return rawCode.match(TNS_LIVE_CODE_RE)[0];
  }
  return "TNS_LIVE_LAUNCH_FAILED";
}

export function mapTierNightLiveLaunchError(codeOrErr, fallback) {
  const code = extractTierNightLiveLaunchCode(codeOrErr, fallback);
  const mapped = TIER_NIGHT_LIVE_LAUNCH_ERROR_MESSAGES[code];
  if (mapped) return mapped;
  const raw = String(
    typeof codeOrErr === "string" && !GENERIC_RPC_ERRCODES.has(codeOrErr)
      ? codeOrErr
      : (typeof codeOrErr === "object" && codeOrErr?.message) ||
          fallback ||
          TIER_NIGHT_LIVE_LAUNCH_ERROR_MESSAGES.TNS_LIVE_LAUNCH_FAILED
  );
  // Message SQL métier non mappé (ex. « Session de jeu introuvable. »)
  if (GENERIC_RPC_ERRCODES.has(raw) || raw === "P0001") {
    return TIER_NIGHT_LIVE_LAUNCH_ERROR_MESSAGES.TNS_LIVE_LAUNCH_FAILED;
  }
  if (/TNS_LIVE_/.test(raw)) {
    return TIER_NIGHT_LIVE_LAUNCH_ERROR_MESSAGES.TNS_LIVE_LAUNCH_FAILED;
  }
  return raw || TIER_NIGHT_LIVE_LAUNCH_ERROR_MESSAGES.TNS_LIVE_LAUNCH_FAILED;
}

function mapSubsetFailCode(code) {
  if (code === "INSUFFICIENT_POOL") return "TNS_LIVE_INSUFFICIENT_TIER_LISTS";
  if (code === "INVALID_ROUND_COUNT") return "TNS_LIVE_INVALID_ROUND_COUNT";
  if (
    code === "INVALID_CUSTOM_LIVE_LIST" ||
    code === "INVALID_ITEMS_COUNT" ||
    String(code || "").includes("CUSTOM") ||
    String(code || "").includes("INVALID_")
  ) {
    return "TNS_LIVE_CORRUPT_CUSTOM";
  }
  return code || "TNS_LIVE_LAUNCH_FAILED";
}

/** Snapshot défensif (copie items - aucune ref mutable).
 * Bornes wire SQL 04E : name/item trim 1–40 (catalogue officiel peut être plus long).
 */
export function snapshotLiveTierListForSeries(list) {
  const rawItems = Array.isArray(list.items) ? list.items : [];
  const items = [];
  for (const raw of rawItems) {
    const item = String(raw ?? "")
      .trim()
      .slice(0, LIVE_TIER_LIST_ITEM_MAX);
    if (item) items.push(item);
  }
  const name =
    normalizeLiveTierListName(list.name) ||
    String(list.id || "Liste")
      .trim()
      .slice(0, LIVE_TIER_LIST_NAME_MAX) ||
    "Liste";
  const snap = {
    id: String(list.id),
    name,
    emoji: normalizeLiveTierListEmoji(list.emoji != null ? list.emoji : "📋"),
    items,
    custom: list.custom === true,
  };
  if (snap.custom) {
    snap.author = list.author != null ? String(list.author) : "";
    snap.authorUid = list.authorUid != null ? String(list.authorUid) : "";
  }
  return snap;
}

/**
 * Comparaison gameplay custom snapshot ↔ canon (miroir SQL).
 * Champs : id, name, emoji, items, authorUid, custom=true.
 * `author` display volontairement hors comparaison (non autoritatif).
 */
export function customLiveSnapshotMatchesCanon(snap, canon) {
  if (!snap || !canon) return false;
  if (String(snap.id || "") !== String(canon.id || "")) return false;
  if (String(snap.name || "") !== String(canon.name || "")) return false;
  const emojiA = String(snap.emoji || "").trim() || "✨";
  const emojiB = String(canon.emoji || "").trim() || "✨";
  if (emojiA !== emojiB) return false;
  if (String(snap.authorUid || "") !== String(canon.authorUid || "")) return false;
  if (snap.custom !== true || canon.custom !== true) return false;
  const a = Array.isArray(snap.items) ? snap.items.map(String) : null;
  const b = Array.isArray(canon.items) ? canon.items.map(String) : null;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
}

const CUSTOM_LIVE_PREFIX = "custom-live-";

function isCustomLiveId(id) {
  return String(id || "").startsWith(CUSTOM_LIVE_PREFIX);
}

/**
 * Miroir JS de tiernight_live_validate_custom_queue_policy (SQL).
 * @param {{ series: object, customLists?: unknown[], roundCount?: number }} opts
 */
export function validateTierNightLiveCustomQueuePolicy({
  series,
  customLists = [],
  roundCount,
} = {}) {
  const n =
    roundCount != null
      ? Number(roundCount)
      : series?.roundCount != null
        ? Number(series.roundCount)
        : NaN;
  if (!isValidTierNightLiveRoundCount(n)) {
    return { ok: false, code: "TNS_LIVE_INVALID_ROUND_COUNT" };
  }
  if (!series || !Array.isArray(series.queue)) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "queue" };
  }
  if (!Array.isArray(customLists)) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_CUSTOM", message: "canon_not_array" };
  }

  const canonIds = [];
  for (const entry of customLists) {
    if (!entry || typeof entry !== "object") {
      return { ok: false, code: "TNS_LIVE_CORRUPT_CUSTOM", message: "canon_entry" };
    }
    const id = String(entry.id || "").trim();
    if (!id || !isCustomLiveId(id) || entry.custom !== true) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_CUSTOM", message: "canon_id" };
    }
    if (canonIds.includes(id)) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_CUSTOM", message: "canon_dup" };
    }
    canonIds.push(id);
  }

  const queueCustomIds = [];
  for (const entry of series.queue) {
    const snap = entry?.listSnapshot;
    if (!snap || typeof snap !== "object") continue;
    const id = String(snap.id || "").trim();
    const hasPrefix = isCustomLiveId(id);
    const isCustom = snap.custom === true;
    if (hasPrefix !== isCustom) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_CUSTOM", message: "custom_flag_prefix" };
    }
    if (isCustom) queueCustomIds.push(id);
  }

  const C = canonIds.length;
  const Q = queueCustomIds.length;

  if (C === 0) {
    if (Q !== 0) {
      return { ok: false, code: "TNS_LIVE_CUSTOM_POOL_STALE", message: "c0_has_custom" };
    }
    return { ok: true, C, Q };
  }
  if (C < n) {
    if (Q !== C) {
      return { ok: false, code: "TNS_LIVE_CUSTOM_POOL_STALE", message: "c_lt_n_count" };
    }
    for (const id of canonIds) {
      if (!queueCustomIds.includes(id)) {
        return { ok: false, code: "TNS_LIVE_CUSTOM_POOL_STALE", message: "c_lt_n_missing" };
      }
    }
    return { ok: true, C, Q };
  }
  if (Q !== n) {
    return { ok: false, code: "TNS_LIVE_CUSTOM_POOL_STALE", message: "c_ge_n_count" };
  }
  return { ok: true, C, Q };
}

/**
 * Cast défensif miroir SQL tiernight_live_jsonb_int - number entier seulement.
 */
export function parseTierNightLiveJsonInt(value) {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

/**
 * Shape + anti-bypass custom-live-* ⇔ custom:true (miroir SQL étendu).
 */
export function validateTierNightLiveSeriesShapeStrict(series) {
  const base = validateTierNightLiveSeriesShape(series);
  if (!base.ok) return base;
  if (parseTierNightLiveJsonInt(series.version) !== 1) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "version" };
  }
  if (parseTierNightLiveJsonInt(series.roundCount) == null) {
    return { ok: false, code: "TNS_LIVE_INVALID_ROUND_COUNT" };
  }
  if (parseTierNightLiveJsonInt(series.roundIndex) !== 0) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "roundIndex" };
  }
  for (const entry of series.queue) {
    const snap = entry?.listSnapshot;
    const id = String(snap?.id || "");
    const hasPrefix = isCustomLiveId(id);
    const isCustom = snap?.custom === true;
    if (hasPrefix !== isCustom) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_CUSTOM", message: "custom_flag_prefix" };
    }
  }
  return { ok: true };
}

export function buildTierNightLiveSeriesWire({
  lists,
  runId = createTierNightRunId(),
  categoryIds = [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES],
} = {}) {
  if (!Array.isArray(lists) || !lists.length) {
    return { ok: false, code: "TNS_LIVE_INSUFFICIENT_TIER_LISTS" };
  }
  const roundCount = lists.length;
  if (!isValidTierNightLiveRoundCount(roundCount)) {
    return { ok: false, code: "TNS_LIVE_INVALID_ROUND_COUNT" };
  }
  const rid = String(runId || createTierNightRunId());
  const queue = lists.map((list, roundIndex) => {
    const listSnapshot = snapshotLiveTierListForSeries(list);
    return {
      roundIndex,
      roundId: `${rid}:${roundIndex}`,
      listId: listSnapshot.id,
      listSnapshot,
    };
  });
  const series = {
    version: 1,
    kind: TIER_NIGHT_LIVE_SERIES_KIND,
    categoryIds: Array.isArray(categoryIds)
      ? categoryIds.map(String)
      : [TIER_NIGHT_LIVE_SERIES_ALL_CATEGORIES],
    roundCount,
    runId: rid,
    roundIndex: 0,
    phase: TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING,
    queue,
    completedRoundIds: [],
    scoredRoundIds: [],
  };
  const shape = validateTierNightLiveSeriesShape(series);
  if (!shape.ok) return shape;
  return { ok: true, series };
}

export function validateTierNightLiveSeriesShape(series) {
  if (!series || typeof series !== "object") {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "series_not_object" };
  }
  if (Number(series.version) !== 1) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "version" };
  }
  if (series.kind !== TIER_NIGHT_LIVE_SERIES_KIND) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "kind" };
  }
  const runId = series.runId != null ? String(series.runId).trim() : "";
  if (!runId) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "runId" };
  }
  // Lecture : 3/5/8 + legacy 7 (séries déjà lancées). Nouveau build refuse 7 via isValid*.
  if (!isReadableTierNightLiveRoundCount(series.roundCount)) {
    return { ok: false, code: "TNS_LIVE_INVALID_ROUND_COUNT" };
  }
  const idx = Number(series.roundIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= Number(series.roundCount)) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "roundIndex" };
  }
  if (
    series.phase !== TIER_NIGHT_LIVE_SERIES_PHASE_PLAYING &&
    series.phase !== TIER_NIGHT_LIVE_SERIES_PHASE_BETWEEN &&
    series.phase !== TIER_NIGHT_LIVE_SERIES_PHASE_END
  ) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "phase" };
  }
  if (!Array.isArray(series.queue) || series.queue.length !== series.roundCount) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "queue_length" };
  }
  if (!Array.isArray(series.completedRoundIds) || !Array.isArray(series.scoredRoundIds)) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "ledgers" };
  }
  if (new Set(series.completedRoundIds).size !== series.completedRoundIds.length) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "completed_dup" };
  }
  if (new Set(series.scoredRoundIds).size !== series.scoredRoundIds.length) {
    return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "scored_dup" };
  }
  const seenRoundIds = new Set();
  const seenListIds = new Set();
  for (let i = 0; i < series.queue.length; i += 1) {
    const entry = series.queue[i];
    if (!entry || typeof entry !== "object") {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "queue_entry" };
    }
    if (Number(entry.roundIndex) !== i) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "roundIndex_mismatch" };
    }
    const roundId = String(entry.roundId || "");
    if (roundId !== `${runId}:${i}`) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "roundId" };
    }
    if (seenRoundIds.has(roundId)) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "roundId_dup" };
    }
    seenRoundIds.add(roundId);
    const snap = entry.listSnapshot;
    if (!snap || typeof snap !== "object") {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "snapshot" };
    }
    if (!String(snap.id || "").trim()) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "snapshot_id" };
    }
    const snapName = String(snap.name || "").trim();
    if (!snapName || snapName.length > LIVE_TIER_LIST_NAME_MAX) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "name" };
    }
    if (typeof snap.custom !== "boolean") {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "custom" };
    }
    if (!Array.isArray(snap.items) || snap.items.length < 1 || snap.items.length > 16) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "snapshot_items" };
    }
    for (const rawItem of snap.items) {
      const item = String(rawItem ?? "").trim();
      if (!item || item.length > LIVE_TIER_LIST_ITEM_MAX) {
        return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "item" };
      }
    }
    if (String(entry.listId || "") !== String(snap.id)) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "listId" };
    }
    const listId = String(snap.id);
    if (seenListIds.has(listId)) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_STATE", message: "listId_dup" };
    }
    seenListIds.add(listId);
    const hasPrefix = listId.startsWith("custom-live-");
    const isCustom = snap.custom === true;
    if (hasPrefix !== isCustom) {
      return { ok: false, code: "TNS_LIVE_CORRUPT_CUSTOM", message: "custom_flag_prefix" };
    }
  }
  return { ok: true };
}

export function projectTierNightLiveSeriesRound0(
  series,
  playerRoster = [],
  random = Math.random
) {
  const shape = validateTierNightLiveSeriesShape(series);
  if (!shape.ok) return shape;
  return projectRound0FromRuntime(series, playerRoster, random);
}

/**
 * PURE PREPARE - tentative de launch (runId client + series snapshot).
 * @param {object} opts
 * @param {object} opts.prep - { roundCount, setupEpoch }
 * @param {unknown[]} [opts.officialLists]
 * @param {unknown[]} [opts.customLists]
 * @param {string} [opts.runId]
 * @param {() => number} [opts.random]
 */
export function prepareTierNightLiveSeriesLaunch({
  prep,
  officialLists,
  customLists = [],
  runId,
  random = Math.random,
} = {}) {
  const roundCount = prep?.roundCount;
  const setupEpoch = Number(prep?.setupEpoch) || 0;
  const subset = buildTierNightLiveSeriesListSubset({
    customLists,
    officialLists,
    roundCount,
    random,
  });
  if (!subset.ok) {
    return { ok: false, code: mapSubsetFailCode(subset.code), message: subset.message };
  }
  const rid = runId != null ? String(runId) : createTierNightRunId();
  const wire = buildTierNightLiveSeriesWire({
    lists: subset.lists,
    runId: rid,
    categoryIds: subset.categoryIds,
  });
  if (!wire.ok) return wire;
  return {
    ok: true,
    setupEpoch,
    runId: wire.series.runId,
    roundCount: wire.series.roundCount,
    series: wire.series,
  };
}

/**
 * Solo / tests : prepare + projection locale (même domaine que multi).
 */
export function buildTierNightLiveSeriesLaunchState({
  customLists = [],
  officialLists,
  roundCount,
  playerRoster = [],
  runId,
  random = Math.random,
  deckRandom = Math.random,
  setupEpoch = 0,
} = {}) {
  const prepared = prepareTierNightLiveSeriesLaunch({
    prep: { roundCount, setupEpoch },
    officialLists,
    customLists,
    runId,
    random,
  });
  if (!prepared.ok) return prepared;
  const projected = projectTierNightLiveSeriesRound0(
    prepared.series,
    playerRoster,
    deckRandom
  );
  if (!projected.ok) return projected;
  return {
    ok: true,
    setupEpoch: prepared.setupEpoch,
    runId: prepared.runId,
    series: prepared.series,
    live: projected.live,
    customLiveTierListsWritable: false,
  };
}

/** Tentative in-flight (anti double-shuffle). Tests : reset via clear. */
let inFlightLaunchAttempt = null;

export function getInFlightTierNightLiveLaunchAttempt() {
  return inFlightLaunchAttempt;
}

export function clearInFlightTierNightLiveLaunchAttempt() {
  inFlightLaunchAttempt = null;
}

/**
 * Réutilise la tentative courante si même setupEpoch + roundCount ; sinon rebuild.
 * roundCount fait partie de la clé : un changement 3↔5↔8 sans bump epoch
 * ne doit pas renvoyer une proposal stale (contrat Rank Live QA-02).
 */
export function obtainTierNightLiveLaunchAttempt({
  prep,
  officialLists,
  customLists,
  random = Math.random,
} = {}) {
  const setupEpoch = Number(prep?.setupEpoch) || 0;
  const roundCount = Number(prep?.roundCount);
  if (
    inFlightLaunchAttempt?.ok &&
    inFlightLaunchAttempt.setupEpoch === setupEpoch &&
    Number(inFlightLaunchAttempt.roundCount) === roundCount &&
    inFlightLaunchAttempt.series?.runId
  ) {
    return inFlightLaunchAttempt;
  }
  const next = prepareTierNightLiveSeriesLaunch({
    prep,
    officialLists,
    customLists,
    random,
  });
  inFlightLaunchAttempt = next.ok ? next : null;
  return next;
}
