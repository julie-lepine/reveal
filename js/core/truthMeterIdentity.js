/**
 * BUG-TRUTHMETER-02 - identité auteur TruthMeter (UID canonique).
 *
 * Limite legacy : session pseudos seuls sans preuve → unresolved (jamais d'attribution arbitraire).
 *
 * Producteurs remote vers mergeTruthMeterGameLocal / mergeTruthMeterIdentityFields :
 * - applyRemoteSession ← Realtime / poll / refresh : TOUJOURS snapshot complet
 *   (row.state.truthMeter via truthMeterFromRemote). Clé absente n'arrive pas ;
 *   affirmation est toujours présente (objet ou null). null = clear explicite.
 * - patchGameState / acting-host : merge serveur (mergeTruthMeterPatchState) puis
 *   retourne la row complète → même chemin snapshot pour les clients.
 * - Remount / resume : fetch session complète → snapshot.
 *
 * Donc pour merge client : remote.affirmation === null est un CLEAR métier ;
 * remote.affirmation === undefined ne devrait pas se produire après fromRemote.
 */

/** @typedef {{ userId: string, name?: string, displayName?: string, lastSeenAt?: string|null }} TruthMeterRosterEntry */

const hasOwn = (obj, key) =>
  obj != null && Object.prototype.hasOwnProperty.call(obj, key);

/** UUID Supabase - fast-path ordre canonique (forme 8-4-4-4-12 hex). */
const UID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCanonicalUidAuthorOrder(order) {
  return (
    Array.isArray(order) &&
    order.length > 0 &&
    order.every((e) => typeof e === "string" && UID_RE.test(e))
  );
}

/**
 * @param {Array<{ userId?: string, name?: string }>} participants
 */
export function buildTruthMeterAuthorOrderUids(participants = []) {
  const uids = [];
  const seen = new Set();
  for (const p of participants || []) {
    const uid = p?.userId != null ? String(p.userId).trim() : "";
    if (!uid) {
      return {
        ok: false,
        error: "Impossible de lancer TruthMeter : un joueur n'a pas d'identifiant synchronisé.",
      };
    }
    if (seen.has(uid)) continue;
    seen.add(uid);
    uids.push(uid);
  }
  if (!uids.length) {
    return {
      ok: false,
      error: "Impossible de lancer TruthMeter : aucun joueur avec UID.",
    };
  }
  return { ok: true, uids };
}

/**
 * @param {string|null|undefined} entry
 * @param {TruthMeterRosterEntry[]} roster
 * @param {Array<{ userId: string, oldName: string, newName: string }>} [renames]
 */
export function classifyTruthMeterIdentityEntry(entry, roster = [], renames = []) {
  const raw = entry == null ? "" : String(entry);
  if (!raw) return { kind: "empty", uid: null, reason: "empty" };

  const byUid = new Map();
  const byName = new Map();
  for (const r of roster || []) {
    const uid = r?.userId != null ? String(r.userId) : "";
    if (!uid) continue;
    byUid.set(uid, r);
    const name = String(r.name || r.displayName || "");
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(uid);
  }

  if (byUid.has(raw)) {
    return { kind: "uid", uid: raw, reason: "roster-uid" };
  }
  if (UID_RE.test(raw)) {
    return { kind: "uid", uid: raw, reason: "canonical-uid-shape" };
  }

  const nameHits = byName.get(raw) || [];
  if (nameHits.length === 1) {
    return { kind: "legacy-name", uid: nameHits[0], reason: "unique-name" };
  }
  if (nameHits.length > 1) {
    return { kind: "ambiguous", uid: null, reason: "duplicate-name" };
  }

  const renameHits = (renames || []).filter((r) => r.oldName === raw || r.newName === raw);
  const renameUids = [...new Set(renameHits.map((r) => String(r.userId)).filter(Boolean))];
  if (renameUids.length === 1 && (byUid.has(renameUids[0]) || UID_RE.test(renameUids[0]))) {
    return { kind: "legacy-rename", uid: renameUids[0], reason: "rename-proof" };
  }
  if (renameUids.length > 1) {
    return { kind: "ambiguous", uid: null, reason: "rename-ambiguous" };
  }

  return { kind: "unresolved", uid: null, reason: "no-match" };
}

/**
 * Normalise authorOrder entrée par entrée.
 * PAS de hint positionnel (localHintOrder interdit / ignoré).
 */
export function normalizeTruthMeterAuthorOrder(order = [], opts = {}) {
  const { roster = [], renames = [], requireFull = true } = opts;
  const src = Array.isArray(order) ? order : [];

  if (isCanonicalUidAuthorOrder(src)) {
    return { ok: true, order: src.map(String), unresolved: [], changed: false };
  }

  const out = [];
  const unresolved = [];
  let changed = false;

  src.forEach((entry, index) => {
    const classified = classifyTruthMeterIdentityEntry(entry, roster, renames);
    if (classified.uid) {
      if (String(entry) !== classified.uid) changed = true;
      out.push(classified.uid);
      return;
    }
    unresolved.push({
      index,
      value: String(entry ?? ""),
      reason: classified.reason || "unresolved",
    });
    out.push(String(entry ?? ""));
  });

  const ok = requireFull ? unresolved.length === 0 : true;
  return { ok, order: out, unresolved, changed };
}

function resolveFromAuthorOrder(session, opts = {}) {
  const roster = opts.roster || [];
  const renames = opts.renames || [];
  const order = Array.isArray(session.authorOrder) ? session.authorOrder : [];
  const idx = session.roundIdx ?? 0;
  const entry = order[idx];
  if (entry == null || entry === "") {
    return { uid: null, unresolved: true, reason: "no-author-order-entry" };
  }
  if (isCanonicalUidAuthorOrder(order)) {
    return {
      uid: String(order[idx]),
      unresolved: false,
      reason: "authorOrder-canonical",
    };
  }
  const norm = normalizeTruthMeterAuthorOrder(order, { roster, renames });
  if (norm.ok && norm.order[idx]) {
    return {
      uid: norm.order[idx],
      unresolved: false,
      reason: "authorOrder",
      legacy: String(entry) !== norm.order[idx],
    };
  }
  const c = classifyTruthMeterIdentityEntry(entry, roster, renames);
  if (c.uid) {
    return { uid: c.uid, unresolved: false, reason: c.reason, legacy: c.kind !== "uid" };
  }
  return {
    uid: null,
    unresolved: true,
    reason: c.reason || "authorOrder-unresolved",
    legacyValue: String(entry),
  };
}

/** Auteur de l'affirmation déjà soumise (voting / reveal / display). */
export function getSubmittedAffirmationAuthorUid(session = {}, opts = {}) {
  const roster = opts.roster || [];
  const renames = opts.renames || [];
  const aff =
    session.affirmation && typeof session.affirmation === "object"
      ? session.affirmation
      : null;
  if (!aff) {
    return { uid: null, unresolved: true, reason: "no-affirmation" };
  }
  if (aff.authorUid && String(aff.authorUid).trim()) {
    const raw = String(aff.authorUid).trim();
    const c = classifyTruthMeterIdentityEntry(raw, roster, renames);
    if (c.uid) return { uid: c.uid, unresolved: false, reason: "affirmation-authorUid" };
    if (UID_RE.test(raw)) {
      return { uid: raw, unresolved: false, reason: "affirmation-authorUid-raw" };
    }
  }
  if (aff.author) {
    const c = classifyTruthMeterIdentityEntry(aff.author, roster, renames);
    if (c.uid) {
      return { uid: c.uid, unresolved: false, reason: "affirmation-author-legacy", legacy: true };
    }
    return {
      uid: null,
      unresolved: true,
      reason: c.reason || "affirmation-author-unresolved",
      legacyValue: String(aff.author),
    };
  }
  return { uid: null, unresolved: true, reason: "affirmation-no-identity" };
}

/**
 * Auteur attendu pour écrire le round courant (authorOrder[roundIdx]).
 * Ne lit PAS une affirmation stale pour gouverner le writing.
 */
export function getCurrentWritingAuthorUid(session = {}, opts = {}) {
  const fromOrder = resolveFromAuthorOrder(session, opts);
  const phase = session.phase || null;
  const aff = session.affirmation;

  if (phase === "writing" && aff == null) {
    return fromOrder;
  }

  if (phase === "writing" && aff != null) {
    const submitted = getSubmittedAffirmationAuthorUid(session, opts);
    if (
      fromOrder.uid &&
      submitted.uid &&
      String(fromOrder.uid) !== String(submitted.uid)
    ) {
      tm02QaLog("author-disagreement", {
        runId: session.runId || null,
        phase,
        roundIdx: session.roundIdx ?? null,
        currentWritingAuthorUid: fromOrder.uid,
        submittedAffirmationAuthorUid: submitted.uid,
        reason: "writing-order-vs-affirmation",
        source: "getCurrentWritingAuthorUid",
      });
      return {
        ...fromOrder,
        disagreement: true,
        affirmationUid: submitted.uid,
        reason: "writing-order-wins-disagreement",
      };
    }
    return fromOrder.uid ? fromOrder : submitted;
  }

  if (aff != null) {
    return getSubmittedAffirmationAuthorUid(session, opts);
  }
  return fromOrder;
}

/**
 * Délègue phase-aware (writing vs affirmation soumise).
 */
export function resolveTruthMeterAuthorUid(session = {}, opts = {}) {
  return getCurrentWritingAuthorUid(session, opts);
}

export function isLocalCurrentWritingAuthor(session, localUid, opts = {}) {
  if (!localUid) return false;
  const resolved = getCurrentWritingAuthorUid(session, opts);
  if (resolved.unresolved || !resolved.uid) return false;
  return String(resolved.uid) === String(localUid);
}

/** Alias historique. */
export function isLocalTruthMeterAuthor(session, localUid, opts = {}) {
  return isLocalCurrentWritingAuthor(session, localUid, opts);
}

export function getTruthMeterAuthorDisplayName(session, opts = {}) {
  const {
    roster = [],
    nameForUid = () => null,
    unresolvedLabel = "Un joueur",
  } = opts;
  const resolved = getCurrentWritingAuthorUid(session, {
    roster,
    renames: opts.renames,
  });
  if (resolved.uid) {
    const fromRoster = roster.find((r) => String(r.userId) === String(resolved.uid));
    const live = fromRoster?.name || fromRoster?.displayName || nameForUid(resolved.uid);
    if (live) return String(live);
  }
  const snap = session?.affirmation?.author;
  if (snap) return String(snap);
  return unresolvedLabel;
}

/**
 * Merge identité TruthMeter.
 * - Snapshot client : clé affirmation toujours présente après fromRemote ; null = clear.
 * - Cross-run : local identité ignorée.
 * - Ordre UID canonique : copie exacte, aucun hint.
 */
export function mergeTruthMeterIdentityFields(local, remote, opts = {}) {
  if (!remote) return local;
  if (!local) return remote;

  const remoteRun = remote.runId || null;
  const localRun = local.runId || null;
  const crossRun =
    Boolean(remoteRun) && Boolean(localRun) && remoteRun !== localRun;

  const roster = opts.roster || [];
  const renames = opts.renames || [];

  if (crossRun) {
    tm02QaLog("cross-run-identity-discard", {
      runId: remoteRun,
      phase: remote.phase || null,
      roundIdx: remote.roundIdx ?? null,
      reason: "local-run-ignored",
      source: "mergeTruthMeterIdentityFields",
      localRunId: localRun,
    });
    return {
      authorOrder: Array.isArray(remote.authorOrder) ? [...remote.authorOrder] : [],
      affirmation: hasOwn(remote, "affirmation") ? remote.affirmation : null,
    };
  }

  let authorOrder = Array.isArray(remote.authorOrder) ? remote.authorOrder : [];
  if (isCanonicalUidAuthorOrder(authorOrder)) {
    authorOrder = authorOrder.map(String);
  } else {
    const remoteNorm = normalizeTruthMeterAuthorOrder(authorOrder, { roster, renames });
    if (remoteNorm.ok) {
      authorOrder = remoteNorm.order;
    }
  }

  let affirmation;
  if (hasOwn(remote, "affirmation")) {
    affirmation = remote.affirmation;
    if (affirmation === null && local?.affirmation) {
      tm02QaLog("affirmation-clear-honored", {
        runId: remoteRun,
        phase: remote.phase || null,
        roundIdx: remote.roundIdx ?? null,
        reason: "remote-null-clears-local",
        source: "mergeTruthMeterIdentityFields",
        affirmationPresent: false,
        affirmationAuthorUid: null,
      });
    }
  } else {
    affirmation = local.affirmation ?? null;
  }

  if (affirmation && typeof affirmation === "object" && !affirmation.authorUid) {
    const resolved = getSubmittedAffirmationAuthorUid(
      { ...remote, affirmation, authorOrder },
      { roster, renames }
    );
    if (!resolved.unresolved && resolved.uid) {
      affirmation = { ...affirmation, authorUid: resolved.uid };
    }
  }

  return { authorOrder, affirmation };
}

/** Champs run-scoped (ignorés du local si runId diffère). */
export const TRUTH_METER_RUN_SCOPED_KEYS = [
  "authorOrder",
  "roundIdx",
  "affirmation",
  "authorEstimate",
  "votes",
  "voteEndsAt",
  "roundScored",
  "lastRound",
  "phase",
  "matchScores",
  "runId",
  "lobbyStarted",
];

export function assertTruthMeterAuthorOrderWire(order, rosterUids = []) {
  const uidSet = new Set((rosterUids || []).map(String));
  if (!uidSet.size) return { ok: true };
  const arr = Array.isArray(order) ? order : [];
  const allUid = arr.length > 0 && arr.every((e) => uidSet.has(String(e)));
  return { ok: allUid, allUid };
}

export function tm02Log(event, detail = {}) {
  if (typeof console === "undefined" || !console.info) return;
  console.info(`[TM-02] ${event}`, detail);
}

/**
 * Instrumentation re-QA - retirer après validation terrain (chercher TM-02-QA).
 */
export function tm02QaLog(event, detail = {}) {
  if (typeof console === "undefined" || !console.info) return;
  const safe = { ...detail };
  delete safe.text;
  delete safe.affirmationText;
  console.info(`[TM-02-QA] ${event}`, safe);
}

/**
 * @returns {{ status: string, uid: string|null, reason?: string }}
 */
export function classifyTruthMeterAuthorStatus(session, opts = {}) {
  const {
    roster = [],
    isPresent = () => true,
    rosterHydrated = true,
  } = opts;
  if (!rosterHydrated) {
    return { status: "roster-loading", uid: null };
  }
  const writing = getCurrentWritingAuthorUid(session, { roster, renames: opts.renames });
  if (writing.unresolved || !writing.uid) {
    return { status: "unresolved", uid: null, reason: writing.reason };
  }
  const p = roster.find((r) => String(r.userId) === String(writing.uid));
  if (!p) {
    if (!roster.length) return { status: "roster-loading", uid: writing.uid };
    return { status: "invalid-state", uid: writing.uid, reason: "not-in-roster" };
  }
  if (isPresent(p)) {
    return { status: "resolved-present", uid: writing.uid };
  }
  return { status: "resolved-absent", uid: writing.uid };
}

export function evaluateTruthMeterSkipEligibility(session, opts = {}) {
  const {
    canActAsHost = false,
    roster = [],
    isPresent = () => true,
    rosterHydrated = true,
  } = opts;

  if (!canActAsHost) {
    return { ok: false, reason: "not-acting-host" };
  }
  if (session?.phase !== "writing") {
    return { ok: false, reason: "wrong-phase" };
  }
  if (session?.affirmation != null) {
    return { ok: false, reason: "affirmation-present" };
  }
  if (!rosterHydrated) {
    return { ok: false, reason: "roster-loading", authorStatus: "roster-loading" };
  }

  const status = classifyTruthMeterAuthorStatus(session, {
    roster,
    isPresent,
    rosterHydrated,
    renames: opts.renames,
  });

  if (status.status !== "resolved-absent") {
    return {
      ok: false,
      reason:
        status.status === "resolved-present"
          ? "author-present"
          : status.status || "not-absent",
      authorStatus: status.status,
    };
  }

  return {
    ok: true,
    reason: "resolved-absent",
    authorStatus: "resolved-absent",
    expectedAuthorUid: status.uid,
    runId: session.runId || null,
    roundIdx: session.roundIdx ?? 0,
  };
}

/**
 * I-09 : ordre déjà UID → no-op (pas de dédup / reorder).
 */
export function migrateTruthMeterIdentityOnRename(tm, opts = {}) {
  if (!tm || typeof tm !== "object") return tm;
  const { oldName, newName, localUid = null, knownUids = [] } = opts;
  if (!oldName || !newName || oldName === newName) return tm;

  const uidSet = new Set(
    [...(knownUids || []), localUid].filter(Boolean).map((u) => String(u))
  );

  let authorOrder = tm.authorOrder;
  if (Array.isArray(authorOrder)) {
    if (isCanonicalUidAuthorOrder(authorOrder)) {
      authorOrder = authorOrder.map(String);
    } else if (authorOrder.every((e) => uidSet.has(String(e)) || UID_RE.test(String(e)))) {
      authorOrder = authorOrder.map(String);
    } else {
      authorOrder = authorOrder.map((entry) => {
        const s = entry == null ? "" : String(entry);
        if (uidSet.has(s) || UID_RE.test(s)) return s;
        if (s === oldName && localUid) return String(localUid);
        if (s === oldName) return newName;
        return s;
      });
    }
  }

  let affirmation = tm.affirmation;
  if (affirmation && typeof affirmation === "object") {
    affirmation = { ...affirmation };
    if (affirmation.authorUid) {
      if (affirmation.author === oldName) affirmation.author = newName;
    } else if (affirmation.author === oldName) {
      if (localUid) affirmation.authorUid = String(localUid);
      affirmation.author = newName;
    }
  }

  return { ...tm, authorOrder, affirmation };
}
