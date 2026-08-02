/**
 * BUG-TRUTHMETER-02 — identité auteur TruthMeter (UID canonique).
 * Helpers purs / testables. Ne modifie pas userIdForName global.
 *
 * Limite : une session legacy (pseudos seuls) sans roster ni preuve de rename
 * ne peut pas toujours être convertie avec certitude — jamais d'attribution arbitraire.
 */

/** @typedef {{ userId: string, name?: string, displayName?: string }} TruthMeterRosterEntry */

/**
 * @param {Array<{ userId?: string, name?: string }>} participants
 * @returns {{ ok: true, uids: string[] } | { ok: false, error: string }}
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
  if (uids.length < 2) {
    return {
      ok: false,
      error: "Impossible de lancer TruthMeter : pas assez de joueurs avec UID.",
    };
  }
  return { ok: true, uids };
}

/**
 * Classification d'une entrée authorOrder / author :
 * - uid si match exact d'un userId connu du roster
 * - sinon name si match exact unique de display name
 * - sinon unresolved / ambiguous
 *
 * @param {string|null|undefined} entry
 * @param {TruthMeterRosterEntry[]} roster
 * @param {Array<{ userId: string, oldName: string, newName: string }>} [renames]
 */
export function classifyTruthMeterIdentityEntry(entry, roster = [], renames = []) {
  const raw = entry == null ? "" : String(entry);
  if (!raw) return { kind: "empty", uid: null, reason: "empty" };

  const byUid = new Map();
  const byName = new Map(); // name → [uids]
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

  const nameHits = byName.get(raw) || [];
  if (nameHits.length === 1) {
    return { kind: "legacy-name", uid: nameHits[0], reason: "unique-name" };
  }
  if (nameHits.length > 1) {
    return { kind: "ambiguous", uid: null, reason: "duplicate-name" };
  }

  // Preuve de rename (même userId) : oldName exact → uid
  const renameHits = (renames || []).filter((r) => r.oldName === raw || r.newName === raw);
  const renameUids = [...new Set(renameHits.map((r) => String(r.userId)).filter(Boolean))];
  if (renameUids.length === 1 && byUid.has(renameUids[0])) {
    return { kind: "legacy-rename", uid: renameUids[0], reason: "rename-proof" };
  }
  if (renameUids.length > 1) {
    return { kind: "ambiguous", uid: null, reason: "rename-ambiguous" };
  }

  return { kind: "unresolved", uid: null, reason: "no-match" };
}

/**
 * Normalise authorOrder entrée par entrée.
 * localHintOrder : même runId + même longueur, peut fournir UIDs déjà migrés I-09→UID.
 *
 * @returns {{
 *   ok: boolean,
 *   order: string[],
 *   unresolved: Array<{ index: number, value: string, reason: string }>,
 *   changed: boolean,
 * }}
 */
export function normalizeTruthMeterAuthorOrder(order = [], opts = {}) {
  const {
    roster = [],
    renames = [],
    localHintOrder = null,
    requireFull = true,
  } = opts;
  const src = Array.isArray(order) ? order : [];
  const hints = Array.isArray(localHintOrder) ? localHintOrder : null;
  const canUseHints =
    hints &&
    hints.length === src.length &&
    hints.every((h) => roster.some((r) => String(r.userId) === String(h)));

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
    if (canUseHints && hints[index] && roster.some((r) => String(r.userId) === String(hints[index]))) {
      // Preuve locale certaine : même index, même longueur, UID connu du roster.
      out.push(String(hints[index]));
      changed = true;
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

/**
 * Résout l'UID auteur courant (order[roundIdx] ou affirmation.authorUid / legacy).
 * @returns {{ uid: string|null, unresolved: boolean, reason?: string, legacy?: boolean }}
 */
export function resolveTruthMeterAuthorUid(session = {}, opts = {}) {
  const roster = opts.roster || [];
  const renames = opts.renames || [];
  const order = Array.isArray(session.authorOrder) ? session.authorOrder : [];
  const idx = session.roundIdx ?? 0;
  const aff = session.affirmation && typeof session.affirmation === "object"
    ? session.affirmation
    : null;

  if (aff?.authorUid) {
    const c = classifyTruthMeterIdentityEntry(aff.authorUid, roster, renames);
    if (c.uid) {
      return { uid: c.uid, unresolved: false, reason: "affirmation-authorUid" };
    }
    // authorUid présent mais pas dans roster courant : toujours canonique si non-vide
    if (String(aff.authorUid).trim()) {
      return {
        uid: String(aff.authorUid).trim(),
        unresolved: false,
        reason: "affirmation-authorUid-raw",
      };
    }
  }

  const entry = order[idx];
  if (entry != null && entry !== "") {
    const norm = normalizeTruthMeterAuthorOrder(order, {
      roster,
      renames,
      localHintOrder: opts.localHintOrder,
    });
    if (norm.ok && norm.order[idx]) {
      return {
        uid: norm.order[idx],
        unresolved: false,
        reason: "authorOrder",
        legacy: String(entry) !== norm.order[idx],
      };
    }
    const c = classifyTruthMeterIdentityEntry(entry, roster, renames);
    if (c.uid) return { uid: c.uid, unresolved: false, reason: c.reason, legacy: c.kind !== "uid" };
    return {
      uid: null,
      unresolved: true,
      reason: c.reason || "authorOrder-unresolved",
      legacyValue: String(entry),
    };
  }

  if (aff?.author) {
    const c = classifyTruthMeterIdentityEntry(aff.author, roster, renames);
    if (c.uid) return { uid: c.uid, unresolved: false, reason: "affirmation-author-legacy", legacy: true };
    return {
      uid: null,
      unresolved: true,
      reason: c.reason || "affirmation-author-unresolved",
      legacyValue: String(aff.author),
    };
  }

  return { uid: null, unresolved: true, reason: "no-author" };
}

export function isLocalTruthMeterAuthor(session, localUid, opts = {}) {
  if (!localUid) return false;
  const resolved = resolveTruthMeterAuthorUid(session, opts);
  if (resolved.unresolved || !resolved.uid) return false;
  return String(resolved.uid) === String(localUid);
}

/**
 * Affichage : roster courant → snapshot affirmation.author → neutre.
 */
export function getTruthMeterAuthorDisplayName(session, opts = {}) {
  const {
    roster = [],
    nameForUid = () => null,
    unresolvedLabel = "Un joueur",
  } = opts;
  const resolved = resolveTruthMeterAuthorUid(session, { roster, renames: opts.renames });
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
 * Merge ciblé identité : remote autoritaire sauf legacy remote + preuve locale même run.
 */
export function mergeTruthMeterIdentityFields(local, remote, opts = {}) {
  if (!remote) return local;
  if (!local) return remote;

  const runOk =
    Boolean(local.runId) &&
    Boolean(remote.runId) &&
    local.runId === remote.runId;

  const roster = opts.roster || [];
  const renames = opts.renames || [];

  let authorOrder = remote.authorOrder || [];
  const remoteNorm = normalizeTruthMeterAuthorOrder(authorOrder, { roster, renames });
  if (remoteNorm.ok) {
    authorOrder = remoteNorm.order;
  } else if (runOk && Array.isArray(local.authorOrder) && local.authorOrder.length === (remote.authorOrder || []).length) {
    const withHint = normalizeTruthMeterAuthorOrder(remote.authorOrder || [], {
      roster,
      renames,
      localHintOrder: local.authorOrder,
    });
    if (withHint.ok) authorOrder = withHint.order;
  }

  let affirmation = remote.affirmation ?? local.affirmation ?? null;
  if (affirmation && typeof affirmation === "object") {
    const next = { ...affirmation };
    if (!next.authorUid) {
      const resolved = resolveTruthMeterAuthorUid(
        { ...remote, affirmation: next, authorOrder },
        {
          roster,
          renames,
          localHintOrder: runOk ? local.authorOrder : null,
        }
      );
      if (!resolved.unresolved && resolved.uid) {
        next.authorUid = resolved.uid;
      } else if (runOk && local.affirmation?.authorUid) {
        next.authorUid = local.affirmation.authorUid;
      }
    }
    affirmation = next;
  }

  return { authorOrder, affirmation };
}

/** Défensif : nouvelles écritures ne doivent pas sérialiser un ordre 100% non-UID si roster connu. */
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
 * I-09 local : migrer TruthMeter sans casser un authorOrder UID.
 * - entrées déjà UID (connues) : inchangées
 * - entrée = oldName + localUid connu : normaliser vers UID (pas seulement newName)
 * - affirmation.authorUid : jamais modifié ; author snapshot cosmétique
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
    const next = [];
    const seen = new Set();
    for (const entry of authorOrder) {
      const s = entry == null ? "" : String(entry);
      let out = s;
      if (uidSet.has(s)) {
        out = s;
      } else if (s === oldName && localUid) {
        out = String(localUid);
      } else if (s === oldName) {
        out = newName;
      }
      if (seen.has(out)) continue;
      seen.add(out);
      next.push(out);
    }
    authorOrder = next;
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
