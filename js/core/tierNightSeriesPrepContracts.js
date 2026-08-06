/**
 * FEATURE-TIERNIGHT-03-B1 — helpers purs ledger one-shot / roster launch / prep epoch.
 * Testables sans Supabase.
 */

import {
  listConsumedCustomTopicIdsFromSeries,
  mergeConsumedCustomTopicIds,
} from "./tierNightSeries.js";

/**
 * Union monotone de ledgers (local ∪ remote). Jamais de shrink via remote stale.
 * Clé absente / non-array → preserve l’autre côté.
 * @param {Iterable<string>|null|undefined} localIds
 * @param {Iterable<string>|null|undefined} remoteIds
 * @returns {string[]}
 */
export function unionConsumedCustomRosterTopicIds(localIds, remoteIds) {
  const seen = new Set();
  const out = [];
  for (const src of [localIds, remoteIds]) {
    if (src == null || typeof src === "undefined") continue;
    if (!Array.isArray(src) && typeof src[Symbol.iterator] !== "function") continue;
    for (const id of src) {
      const s = id != null ? String(id).trim() : "";
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * Réconciliation crash-safe : ledger ∪ customs présents dans la queue série lancée.
 * @param {Iterable<string>|null|undefined} previousIds
 * @param {object|null|undefined} series
 */
export function reconcileConsumedCustomRosterTopicIds(previousIds, series) {
  return mergeConsumedCustomTopicIds(previousIds, series);
}

/**
 * Merge hydrate/patch du ledger : union monotone.
 * Remote non-array / absent → conserve local.
 * @param {string[]|null|undefined} localIds
 * @param {unknown} remoteIds
 */
export function mergeConsumedCustomRosterTopicIdsForHydrate(localIds, remoteIds) {
  if (!Array.isArray(remoteIds)) {
    return Array.isArray(localIds) ? localIds.map(String) : [];
  }
  return unionConsumedCustomRosterTopicIds(localIds || [], remoteIds);
}

/**
 * Participants figés pour launch : filtre par noms (projection force-start)
 * tout en conservant les objets UID. Hôte toujours inclus si présent.
 *
 * @param {object} opts
 * @param {Array<{ userId?: string, name?: string, isHost?: boolean }>} opts.participants
 * @param {string[]|null|undefined} opts.rosterNames — si fourni, filtre (force-start / ready)
 * @returns {{ participants: typeof opts.participants, excludedNames: string[] }}
 */
export function resolveTierNightSeriesLaunchParticipants({
  participants = [],
  rosterNames = null,
} = {}) {
  const list = Array.isArray(participants) ? participants : [];
  if (!Array.isArray(rosterNames) || rosterNames.length === 0) {
    return { participants: list, excludedNames: [] };
  }
  const allow = new Set(rosterNames.map(String));
  const host = list.find((p) => p.isHost);
  if (host?.name) allow.add(String(host.name));
  const next = list.filter((p) => allow.has(String(p.name)));
  const excludedNames = list
    .filter((p) => !allow.has(String(p.name)))
    .map((p) => String(p.name || ""));
  return { participants: next, excludedNames };
}

/**
 * Détecte un changement de setup justifiant invalidation ready.
 */
export function didTierNightSeriesPrepSetupChange(prev, next) {
  const a = prev || {};
  const b = next || {};
  const catA = JSON.stringify(a.categoryIds || []);
  const catB = JSON.stringify(b.categoryIds || []);
  if (catA !== catB) return true;
  const rA = a.roundCount == null ? null : Number(a.roundCount);
  const rB = b.roundCount == null ? null : Number(b.roundCount);
  return rA !== rB;
}

/** Anciens champs wizard SERIES-04 — jamais source de vérité du prep. */
export const LEGACY_SERIES_WIZARD_PREP_KEYS = [
  "path",
  "seriesPath",
  "seriesSetup",
  "wizardCategoryIds",
  "wizardRoundCount",
  "rosterPath",
];

/**
 * Retire les champs wizard legacy d’un blob prep (ne doivent pas écraser le SoT).
 * @param {object} obj
 */
export function stripLegacySeriesWizardPrepFields(obj = {}) {
  if (!obj || typeof obj !== "object") return {};
  const next = { ...obj };
  for (const k of LEGACY_SERIES_WIZARD_PREP_KEYS) {
    delete next[k];
  }
  return next;
}

/**
 * Reset prep autoritatif (hub / nouvelle intention de setup).
 * Bump setupEpoch pour gagner le merge remote (stale reset epoch bas ignoré).
 * Ne touche pas consumed / customs.
 *
 * @param {{ previousSetupEpoch?: number, categoryIds?: string[], roundCount?: number|null }} [opts]
 */
export function buildAuthoritativeTierNightPrepReset({
  previousSetupEpoch = 0,
  categoryIds = ["*"],
  roundCount = 5,
} = {}) {
  return {
    categoryIds: Array.isArray(categoryIds) ? categoryIds.map(String) : ["*"],
    roundCount: roundCount == null || roundCount === "" ? null : Number(roundCount),
    ready: {},
    setupEpoch: (Number(previousSetupEpoch) || 0) + 1,
    poolInvalidateRequestId: null,
  };
}

/**
 * Résolution destination roster à partir de l’état partagé (gate ignorée si session active).
 * FEATURE-TIERNIGHT-03-C1 — la gate ne choisit que le parcours de *création*.
 *
 * @param {{
 *   tierNight?: object|null,
 *   hasTierNightPrep?: boolean,
 *   seriesUiEnabled?: boolean,
 *   declaredScreen?: string|null,
 * }} [opts]
 * @returns {{ screen: string, reason: string, gateIgnored: boolean }}
 */
export function resolveTierNightRosterDestinationFromSharedState({
  tierNight = null,
  hasTierNightPrep = false,
  seriesUiEnabled = false,
  declaredScreen = null,
} = {}) {
  const series = tierNight?.series;
  if (series && typeof series === "object") {
    const phase = series.phase;
    // FEATURE-TIERNIGHT-03-E — mapping phase → écran (état partagé > gate / screen stale).
    if (phase === "ranking") {
      return { screen: "tiernight", reason: "series_ranking", gateIgnored: true };
    }
    if (phase === "between_rounds") {
      return {
        screen: "tiernight-between",
        reason: "series_between",
        gateIgnored: true,
      };
    }
    if (phase === "series_end") {
      return { screen: "tiernight-end", reason: "series_end", gateIgnored: true };
    }
    // round_result / shape invalide : pas d’écran jouable incorrect
    if (phase) {
      return {
        screen: seriesUiEnabled ? "tiernight-prep" : "tiernight-select",
        reason: "series_phase_invalid",
        gateIgnored: true,
      };
    }
  }
  if (
    tierNight?.lobbyStarted &&
    !(series && typeof series === "object" && series.phase && series.phase !== "series_end")
  ) {
    // Legacy mono actif (sans series jouable) — gate ignorée
    return { screen: "tiernight", reason: "legacy_active", gateIgnored: true };
  }

  // Aucune partie active : la gate choisit le parcours de création
  if (seriesUiEnabled) {
    return {
      screen: "tiernight-prep",
      reason: hasTierNightPrep ? "gate_on_prep" : "gate_on_create",
      gateIgnored: false,
    };
  }
  // Kill switch OFF (F) : jamais classic — select modes sûr uniquement
  return {
    screen: "tiernight-select",
    reason: "series_entry_blocked",
    gateIgnored: false,
  };
}

/**
 * Merge remote prep blob (settings hôte + ready UID).
 * setupEpoch plus grand → settings + ready autoritatifs (clear possible).
 * setupEpoch plus petit → ignore (stale).
 * même epoch → merge ready ; settings seulement si présents dans inc.
 * poolInvalidateRequestId : propagé (hôte honore → bump epoch).
 * Champs wizard legacy ignorés (FEATURE-TIERNIGHT-03-C).
 *
 * @param {object} cur — remote shape (ready by uid)
 * @param {object} inc
 */
export function mergeTierNightPrepRemoteState(cur = {}, inc = {}) {
  cur = stripLegacySeriesWizardPrepFields(cur);
  inc = stripLegacySeriesWizardPrepFields(inc);
  const curEpoch = Number(cur.setupEpoch) || 0;
  const incEpoch = inc.setupEpoch != null ? Number(inc.setupEpoch) : null;

  if (incEpoch != null && Number.isFinite(incEpoch) && incEpoch > curEpoch) {
    const next = {
      ...cur,
      ...inc,
      setupEpoch: incEpoch,
      ready: inc.ready && typeof inc.ready === "object" ? { ...inc.ready } : {},
    };
    // Host bump : clear la requête d’invalidation si explicitement null/absent après bump
    if (inc.poolInvalidateRequestId === null || inc.poolInvalidateRequestId === "") {
      next.poolInvalidateRequestId = null;
    }
    return next;
  }

  if (incEpoch != null && Number.isFinite(incEpoch) && incEpoch < curEpoch) {
    return { ...cur };
  }

  // Même epoch (ou contribution sans epoch)
  const next = { ...cur, setupEpoch: curEpoch };
  if (inc.categoryIds !== undefined) next.categoryIds = inc.categoryIds;
  if (inc.roundCount !== undefined) next.roundCount = inc.roundCount;
  if (inc.ready && typeof inc.ready === "object") {
    next.ready = {
      ...(cur.ready && typeof cur.ready === "object" ? cur.ready : {}),
      ...inc.ready,
    };
  }
  if (inc.poolInvalidateRequestId != null && String(inc.poolInvalidateRequestId) !== "") {
    next.poolInvalidateRequestId = String(inc.poolInvalidateRequestId);
  }
  if (inc.poolInvalidateRequestId === null) {
    next.poolInvalidateRequestId = null;
  }
  return next;
}

/**
 * Empreinte stable des customs (ids triés) pour détecter mutation de pool.
 * @param {Iterable<object>|null|undefined} topics
 */
export function customRosterTopicsPoolSignature(topics) {
  const ids = [];
  for (const t of topics || []) {
    const id = t?.id != null ? String(t.id).trim() : "";
    if (id) ids.push(id);
  }
  ids.sort();
  return ids.join("|");
}

/**
 * @param {string|null|undefined} lastHonored
 * @param {string|null|undefined} requestId
 */
export function shouldHonorPoolInvalidateRequest(lastHonored, requestId) {
  if (requestId == null || String(requestId).trim() === "") return false;
  return String(requestId) !== String(lastHonored || "");
}

export { listConsumedCustomTopicIdsFromSeries, mergeConsumedCustomTopicIds };
