/**
 * FEATURE-TIERNIGHT-SERIES-05B/05C — logique smoke advance (testable).
 * Utilisé par scripts/tiernight-series-05-smoke.mjs
 *
 * 05C : restore CAS (updated_at), hôte réel strict, erreurs RPC classées,
 * égalité JSON canonique (clés triées, tableaux stables).
 */

export const TNS05_FIXTURE_CODE_PREFIX = "TNS05";

export const RESTORE_CODES = Object.freeze({
  OK: "RESTORE_OK",
  NOT_NEEDED: "RESTORE_NOT_NEEDED",
  CONCURRENT_CHANGE: "RESTORE_CONCURRENT_CHANGE",
  CAS_MISS: "RESTORE_CAS_MISS",
  VERIFY_MISMATCH: "RESTORE_VERIFY_MISMATCH",
  SKIPPED_AMBIGUOUS_STATE: "RESTORE_SKIPPED_AMBIGUOUS_STATE",
  RLS_DENIED: "RESTORE_RLS_DENIED",
});

/** Tri récursif des clés d’objets ; ordre des tableaux conservé. */
export function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalizeJson(value[key]);
  }
  return out;
}

export function deepEqualJson(a, b) {
  return JSON.stringify(canonicalizeJson(a)) === JSON.stringify(canonicalizeJson(b));
}

export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Contenu métier comparable (ignore updated_at). */
export function sessionContentEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.game_id === b.game_id &&
    a.screen === b.screen &&
    deepEqualJson(a.state, b.state)
  );
}

export function sessionFingerprint(row) {
  return {
    game_id: row?.game_id ?? null,
    screen: row?.screen ?? null,
    state: canonicalizeJson(row?.state ?? null),
    updated_at: row?.updated_at ?? null,
  };
}

/**
 * Classification erreurs RPC smoke.
 * TNS_* / ALREADY_* déterministes → ambiguous=false.
 * Timeout / transport → ambiguous=true.
 */
export function classifySmokeRpcError(error) {
  const message = String(error?.message || error || "");
  const codeMatch = message.match(
    /\b(TNS_[A-Z0-9_]+|ALREADY_APPLIED|ALREADY_ADVANCED)\b/
  );
  const isTimeout =
    error?.name === "TimeoutError" || /timeout|trop longue/i.test(message);
  const isTransport =
    isTimeout ||
    /Failed to fetch|fetch failed|network|ECONNRESET|ETIMEDOUT|socket hung up/i.test(
      message
    );

  if (codeMatch && !isTransport) {
    return {
      kind: "deterministic",
      code: codeMatch[1],
      ambiguous: false,
      message,
    };
  }
  if (isTransport) {
    return {
      kind: "transport",
      code: codeMatch?.[1] || "TNS_TIMEOUT",
      ambiguous: true,
      message,
    };
  }
  if (codeMatch) {
    return {
      kind: "deterministic",
      code: codeMatch[1],
      ambiguous: false,
      message,
    };
  }
  return { kind: "unknown", code: "UNKNOWN", ambiguous: true, message };
}

/** Hôte réel strict : lobbies.host_id uniquement. */
export function isStrictLobbyHost(lobby, authUid) {
  return Boolean(lobby?.host_id && authUid && lobby.host_id === authUid);
}

export function captureOwnedSession(sessionRow, label = "owned") {
  return {
    label,
    lobby_id: sessionRow.lobby_id,
    game_id: sessionRow.game_id,
    screen: sessionRow.screen,
    state: cloneJson(sessionRow.state),
    updated_at: sessionRow.updated_at ?? null,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Décide si un restore automatique est autorisé.
 * @param {{
 *   initialSnapshot: object|null,
 *   lastOwned: object|null,
 *   ownedStates?: object[],
 *   currentRow: object|null,
 *   mutated: { finalize?: boolean, advance?: boolean },
 *   ambiguous?: boolean,
 * }} input
 */
export function decideRestoreState(input) {
  const {
    initialSnapshot,
    lastOwned,
    ownedStates = [],
    currentRow,
    mutated,
    ambiguous = false,
  } = input;

  const didMutate = Boolean(mutated?.finalize || mutated?.advance);

  if (!initialSnapshot) {
    return {
      code: RESTORE_CODES.NOT_NEEDED,
      canRestore: false,
      reason: "no_snapshot",
    };
  }

  if (!currentRow) {
    return {
      code: RESTORE_CODES.SKIPPED_AMBIGUOUS_STATE,
      canRestore: false,
      reason: "no_current_row",
    };
  }

  if (!didMutate) {
    if (sessionContentEqual(currentRow, initialSnapshot)) {
      return {
        code: RESTORE_CODES.NOT_NEEDED,
        canRestore: false,
        reason: "unchanged_initial",
      };
    }
    return {
      code: RESTORE_CODES.CONCURRENT_CHANGE,
      canRestore: false,
      reason: "changed_without_smoke_mutation",
    };
  }

  // Mutation revendiquée : il faut un état terminal connu (lastOwned / ownedStates)
  const candidates = [];
  if (lastOwned) candidates.push(lastOwned);
  for (const o of ownedStates) {
    if (o && (!lastOwned || o.updated_at !== lastOwned.updated_at)) {
      candidates.push(o);
    }
  }

  const match = candidates.find(
    (c) =>
      sessionContentEqual(currentRow, c) &&
      String(currentRow.updated_at ?? "") === String(c.updated_at ?? "")
  );

  if (match) {
    return {
      code: "RESTORE_READY",
      canRestore: true,
      casFrom: match,
      reason: `matched_owned:${match.label}`,
    };
  }

  // Contenu égal à un owned mais updated_at différent → concurrent write
  const contentMatch = candidates.find((c) => sessionContentEqual(currentRow, c));
  if (contentMatch) {
    return {
      code: RESTORE_CODES.CONCURRENT_CHANGE,
      canRestore: false,
      reason: "content_match_but_updated_at_drift",
    };
  }

  if (sessionContentEqual(currentRow, initialSnapshot)) {
    // Mutation revendiquée mais serveur encore initial (échec effectif)
    return {
      code: RESTORE_CODES.NOT_NEEDED,
      canRestore: false,
      reason: "still_initial_after_claimed_mutation",
    };
  }

  if (ambiguous) {
    return {
      code: RESTORE_CODES.SKIPPED_AMBIGUOUS_STATE,
      canRestore: false,
      reason: "unknown_state_after_ambiguous_rpc",
    };
  }

  return {
    code: RESTORE_CODES.CONCURRENT_CHANGE,
    canRestore: false,
    reason: "current_not_owned_by_smoke",
  };
}

export function buildRestoreCas({ initialSnapshot, casFrom }) {
  return {
    lobby_id: initialSnapshot.lobby_id,
    expectedUpdatedAt: casFrom.updated_at,
    restoreState: initialSnapshot.state,
    restoreScreen: initialSnapshot.screen,
    expectedGameId: initialSnapshot.game_id,
  };
}

export function canRestoreAutomatically(decision) {
  return Boolean(decision?.canRestore && decision?.casFrom);
}

/**
 * Interprète le résultat d’un UPDATE CAS + verify.
 */
export function interpretRestoreUpdateResult({
  updateError,
  updatedRows,
  verifiedRow,
  initialSnapshot,
}) {
  if (updateError) {
    const msg = String(updateError.message || updateError);
    if (/row-level security|RLS|permission denied|42501/i.test(msg)) {
      return { code: RESTORE_CODES.RLS_DENIED, ok: false, error: msg };
    }
    return { code: RESTORE_CODES.CAS_MISS, ok: false, error: msg };
  }
  const rows = Array.isArray(updatedRows) ? updatedRows : [];
  if (rows.length === 0) {
    return {
      code: RESTORE_CODES.CAS_MISS,
      ok: false,
      error: "CAS update matched 0 rows",
    };
  }
  if (rows.length !== 1) {
    return {
      code: RESTORE_CODES.CAS_MISS,
      ok: false,
      error: `CAS update matched ${rows.length} rows`,
    };
  }
  if (
    !verifiedRow ||
    !sessionContentEqual(verifiedRow, {
      game_id: initialSnapshot.game_id,
      screen: initialSnapshot.screen,
      state: initialSnapshot.state,
    })
  ) {
    return {
      code: RESTORE_CODES.VERIFY_MISMATCH,
      ok: false,
      error: "post-restore state/screen mismatch",
    };
  }
  // updated_at must NOT equal snapshot initial (new server value) — optional soft check
  return { code: RESTORE_CODES.OK, ok: true, error: null, restoredRow: verifiedRow };
}


/**
 * Refuse de démarrer sans confirmation + ids fixture.
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} env
 */
export function validateSmokeEnv(env = {}) {
  const errors = [];
  if (env.TNS05_CONFIRM_STAGING_FIXTURE !== "YES") {
    errors.push("TNS05_CONFIRM_STAGING_FIXTURE must be YES");
  }
  for (const key of [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "TNS05_HOST_EMAIL",
    "TNS05_HOST_PASSWORD",
    "TNS05_LOBBY_ID",
    "TNS05_EXPECTED_LOBBY_CODE",
  ]) {
    if (!String(env[key] || "").trim()) errors.push(`Missing ${key}`);
  }
  const code = String(env.TNS05_EXPECTED_LOBBY_CODE || "").trim().toUpperCase();
  if (code && !code.startsWith(TNS05_FIXTURE_CODE_PREFIX)) {
    errors.push(
      `TNS05_EXPECTED_LOBBY_CODE must start with ${TNS05_FIXTURE_CODE_PREFIX} (got ${code})`
    );
  }
  if (String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) {
    errors.push("SUPABASE_SERVICE_ROLE_KEY must not be set for this smoke");
  }
  return {
    ok: errors.length === 0,
    errors,
    dryRead: env.TNS05_DRY_READ === "1",
    runConcurrency: env.TNS05_RUN_CONCURRENCY === "1",
    allowDirtyFixture: env.TNS05_ALLOW_DIRTY_FIXTURE === "YES",
    saveSnapshotFile: env.TNS05_SAVE_SNAPSHOT_FILE === "1",
  };
}

/**
 * @param {string} expectedCode
 * @param {string} actualCode
 */
export function lobbyCodeMatchesFixture(expectedCode, actualCode) {
  return (
    String(expectedCode || "").trim().toUpperCase() ===
    String(actualCode || "").trim().toUpperCase()
  );
}

export function isLastSeriesRound(series) {
  const idx = Number(series?.roundIndex);
  const count = Number(series?.roundCount);
  return Number.isInteger(idx) && Number.isInteger(count) && idx >= count - 1;
}

function ledgerHas(arr, roundId) {
  return Array.isArray(arr) && arr.includes(roundId);
}

function historyCountFor(history, roundId) {
  if (!Array.isArray(history)) return -1;
  return history.filter((h) => h && h.roundId === roundId).length;
}

/**
 * Analyse fixture pour dry-read / plan d’exécution.
 * @param {object} sessionRow — game_sessions row
 */
export function analyzeSeriesFixture(sessionRow) {
  const gameId = sessionRow?.game_id;
  const screen = sessionRow?.screen;
  const state = sessionRow?.state || {};
  const tn = state.tierNight;
  const series = tn?.series;
  const runId = tn?.runId ? String(tn.runId) : null;
  const phase = series?.phase ?? null;
  const roundIndex = series?.roundIndex;
  const roundCount = series?.roundCount;
  const queue = series?.queue;
  const roundId =
    runId != null && Number.isInteger(roundIndex)
      ? `${runId}:${roundIndex}`
      : null;

  const base = {
    gameId,
    screen,
    runId,
    phase,
    roundIndex,
    roundCount,
    roundId,
    hasSeries: Boolean(series && typeof series === "object"),
    scoredHasCurrent: roundId
      ? ledgerHas(series?.scoredRoundIds, roundId)
      : false,
    completedHasCurrent: roundId
      ? ledgerHas(series?.completedRoundIds, roundId)
      : false,
    historyCount: roundId ? historyCountFor(series?.roundHistory, roundId) : -1,
    hasRoundRecap:
      series?.roundRecap != null && typeof series.roundRecap === "object",
    roundRecapMatches:
      series?.roundRecap?.roundId != null &&
      series.roundRecap.roundId === roundId,
    isLastRound: series ? isLastSeriesRound(series) : true,
    canFinalize: false,
    canAdvance: false,
    readiness: "none",
    blockers: /** @type {string[]} */ ([]),
  };

  if (gameId !== "tiernight") {
    base.blockers.push("WRONG_GAME");
    return base;
  }
  if (!tn || typeof tn !== "object") {
    base.blockers.push("NO_TIERNIGHT");
    return base;
  }
  if (!base.hasSeries) {
    base.blockers.push("NO_SERIES");
    return base;
  }
  if (Number(series.version) !== 1) {
    base.blockers.push("UNSUPPORTED_VERSION");
    return base;
  }
  // 7 = legacy lecture ; 3/5/8 = contrat FEATURE-TIERNIGHT-03-A
  if (![3, 5, 7, 8].includes(Number(roundCount))) {
    base.blockers.push("INVALID_ROUND_COUNT");
    return base;
  }
  if (!runId) {
    base.blockers.push("NO_RUN_ID");
    return base;
  }
  if (!Array.isArray(queue) || queue.length !== Number(roundCount)) {
    base.blockers.push("INVALID_QUEUE");
    return base;
  }
  if (!Number.isInteger(roundIndex) || roundIndex < 0 || roundIndex >= roundCount) {
    base.blockers.push("INVALID_ROUND_INDEX");
    return base;
  }

  if (phase === "series_end") {
    base.blockers.push("SERIES_ENDED");
    return base;
  }

  if (phase === "between_rounds") {
    if (base.isLastRound) {
      base.blockers.push("LAST_ROUND");
      return base;
    }
    if (!base.scoredHasCurrent) base.blockers.push("NOT_SCORED");
    if (!base.completedHasCurrent) base.blockers.push("NOT_COMPLETED");
    if (base.historyCount === 0) base.blockers.push("HISTORY_MISSING");
    if (base.historyCount > 1) base.blockers.push("HISTORY_AMBIGUOUS");
    if (!base.roundRecapMatches) base.blockers.push("ROUND_RECAP_MISMATCH");
    if (base.blockers.length === 0) {
      base.canAdvance = true;
      base.readiness = "advance";
    }
    return base;
  }

  if (phase === "ranking") {
    if (base.isLastRound) {
      base.blockers.push("LAST_ROUND");
      return base;
    }
    const fin = assessFinalizeReadiness(tn);
    if (!fin.ok) {
      base.blockers.push(...fin.blockers);
      base.readiness = "ranking_not_ready";
      return base;
    }
    base.canFinalize = true;
    base.readiness = "finalize";
    return base;
  }

  base.blockers.push(`UNEXPECTED_PHASE:${phase}`);
  return base;
}

/**
 * Ne fabrique pas de placements — lit seulement.
 * @param {object} tn
 */
export function assessFinalizeReadiness(tn) {
  const roster = Array.isArray(tn?.playerRoster) ? tn.playerRoster : [];
  const finished = tn?.finished && typeof tn.finished === "object" ? tn.finished : {};
  const placements =
    tn?.placements && typeof tn.placements === "object" ? tn.placements : {};
  const blockers = [];
  if (roster.length === 0) blockers.push("EMPTY_ROSTER");
  for (const p of roster) {
    const uid = p?.userId;
    if (!uid) {
      blockers.push("ROSTER_MISSING_UID");
      continue;
    }
    if (finished[uid] !== true) blockers.push(`NOT_FINISHED:${uid}`);
    const pl = placements[uid];
    if (!pl || typeof pl !== "object" || Array.isArray(pl)) {
      blockers.push(`PLACEMENT_MISSING:${uid}`);
    }
  }
  return { ok: blockers.length === 0, blockers };
}

/**
 * Capture immutabilité avant advance.
 */
export function captureAdvanceBaselines(sessionRow) {
  const state = sessionRow?.state || {};
  const tn = state.tierNight || {};
  const series = tn.series || {};
  return {
    runId: tn.runId,
    modifier: tn.modifier,
    queue: cloneJson(series.queue),
    roster: cloneJson(tn.playerRoster),
    items: cloneJson(tn.items),
    scoredRoundIds: cloneJson(series.scoredRoundIds),
    completedRoundIds: cloneJson(series.completedRoundIds),
    roundHistory: cloneJson(series.roundHistory),
    scores: cloneJson(state.scores),
    playerStats: cloneJson(state.playerStats),
    gameScores: cloneJson(state.gameScores),
    stats: cloneJson(state.stats),
    eveningGamesRecorded: cloneJson(state.eveningGamesRecorded),
    fromRoundIndex: series.roundIndex,
    fromRoundId: `${tn.runId}:${series.roundIndex}`,
  };
}

/**
 * @param {object} rpcData — réponse advance
 * @param {object} sessionAfter — row rechargée
 * @param {object} baselines
 */
export function assertAdvanceApplied(rpcData, sessionAfter, baselines) {
  const failures = [];
  if (rpcData?.ok !== true) failures.push("rpc.ok !== true");
  if (rpcData?.applied !== true) failures.push("rpc.applied !== true");
  if (rpcData?.phase !== "ranking") failures.push("rpc.phase !== ranking");

  const tn = sessionAfter?.state?.tierNight;
  const series = tn?.series;
  const nextIndex = baselines.fromRoundIndex + 1;
  const nextEntry = baselines.queue?.[nextIndex];

  if (series?.phase !== "ranking") failures.push("series.phase !== ranking");
  if (series?.roundIndex !== nextIndex) {
    failures.push(`roundIndex !== ${nextIndex}`);
  }
  if (rpcData?.roundIndex != null && rpcData.roundIndex !== nextIndex) {
    failures.push("rpc.roundIndex mismatch");
  }
  if (nextEntry && series?.queue?.[nextIndex]?.roundId !== nextEntry.roundId) {
    failures.push("active roundId mismatch");
  }
  if (nextEntry && tn?.topicId !== nextEntry.topicId) {
    failures.push("topicId !== queue[next].topicId");
  }
  if (sessionAfter?.screen !== "tiernight") failures.push("screen !== tiernight");
  if (!deepEqualJson(tn?.placements, {})) failures.push("placements not {}");
  if (!deepEqualJson(tn?.finished, {})) failures.push("finished not {}");
  if (series?.roundRecap != null) failures.push("roundRecap not null");
  if (tn?.runId !== baselines.runId) failures.push("runId changed");

  failures.push(...assertImmutables(sessionAfter, baselines));
  return { ok: failures.length === 0, failures, nextIndex };
}

export function assertAlreadyAdvanced(rpcData, sessionAfter, baselines, afterFirst) {
  const failures = [];
  if (rpcData?.ok !== true) failures.push("retry.ok !== true");
  if (rpcData?.applied !== false) failures.push("retry.applied !== false");
  if (rpcData?.code !== "ALREADY_ADVANCED") {
    failures.push("retry.code !== ALREADY_ADVANCED");
  }
  const nextIndex = baselines.fromRoundIndex + 1;
  if (sessionAfter?.state?.tierNight?.series?.roundIndex !== nextIndex) {
    failures.push("retry index !== N+1");
  }
  if (sessionAfter?.state?.tierNight?.series?.roundIndex === nextIndex + 1) {
    failures.push("jumped to N+2");
  }
  if (!deepEqualJson(sessionAfter?.state, afterFirst?.state)) {
    failures.push("state changed on retry");
  }
  if (sessionAfter?.screen !== afterFirst?.screen) {
    failures.push("screen changed on retry");
  }
  return { ok: failures.length === 0, failures };
}

export function assertImmutables(sessionAfter, baselines) {
  const failures = [];
  const state = sessionAfter?.state || {};
  const tn = state.tierNight || {};
  const series = tn.series || {};
  const checks = [
    ["queue", series.queue, baselines.queue],
    ["roster", tn.playerRoster, baselines.roster],
    ["items", tn.items, baselines.items],
    ["modifier", tn.modifier, baselines.modifier],
    ["scoredRoundIds", series.scoredRoundIds, baselines.scoredRoundIds],
    ["completedRoundIds", series.completedRoundIds, baselines.completedRoundIds],
    ["roundHistory", series.roundHistory, baselines.roundHistory],
    ["scores", state.scores, baselines.scores],
    ["playerStats", state.playerStats, baselines.playerStats],
    ["gameScores", state.gameScores, baselines.gameScores],
    ["stats", state.stats, baselines.stats],
    ["eveningGamesRecorded", state.eveningGamesRecorded, baselines.eveningGamesRecorded],
  ];
  for (const [name, actual, expected] of checks) {
    if (!deepEqualJson(actual, expected)) failures.push(`IMMUTABLE:${name}`);
  }
  return failures;
}

export function assertConcurrencyResults(results, baselines) {
  const failures = [];
  const settled = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: r.reason }
  );
  const applied = settled.filter((r) => r?.ok === true && r?.applied === true);
  const already = settled.filter(
    (r) => r?.ok === true && r?.applied === false && r?.code === "ALREADY_ADVANCED"
  );
  if (applied.length !== 1) failures.push(`applied count=${applied.length}`);
  if (already.length !== 1) failures.push(`ALREADY_ADVANCED count=${already.length}`);
  if (settled.length !== 2) failures.push("expected 2 settled");
  return {
    ok: failures.length === 0,
    failures,
    expectedIndex: baselines.fromRoundIndex + 1,
  };
}

export function captureSessionSnapshot(sessionRow) {
  return {
    lobby_id: sessionRow.lobby_id,
    game_id: sessionRow.game_id,
    screen: sessionRow.screen,
    host_id: sessionRow.host_id,
    state: cloneJson(sessionRow.state),
    updated_at: sessionRow.updated_at ?? null,
    capturedAt: new Date().toISOString(),
  };
}

export function buildSafeSummary(authUid, lobbyId, lobbyCode, analysis) {
  return {
    authUid,
    lobbyId,
    lobbyCode,
    gameId: analysis.gameId,
    screen: analysis.screen,
    runId: analysis.runId,
    phase: analysis.phase,
    roundIndex: analysis.roundIndex,
    roundCount: analysis.roundCount,
    roundId: analysis.roundId,
    scoredHasCurrent: analysis.scoredHasCurrent,
    completedHasCurrent: analysis.completedHasCurrent,
    historyCount: analysis.historyCount,
    hasRoundRecap: analysis.hasRoundRecap,
    roundRecapMatches: analysis.roundRecapMatches,
    isLastRound: analysis.isLastRound,
    readiness: analysis.readiness,
    canFinalize: analysis.canFinalize,
    canAdvance: analysis.canAdvance,
    blockers: analysis.blockers,
  };
}

export function redactSecretsFromText(text) {
  return String(text || "")
    .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/TNS05_HOST_PASSWORD=\S+/gi, "TNS05_HOST_PASSWORD=[REDACTED]")
    .replace(/SUPABASE_ANON_KEY=\S+/gi, "SUPABASE_ANON_KEY=[REDACTED]")
    .replace(/service_role/gi, "[REDACTED_ROLE]");
}

/**
 * Orchestrateur injectable (tests + CLI).
 *
 * @param {object} opts
 * @param {Record<string,string|undefined>} opts.env
 * @param {object} opts.supabase — client déjà authentifié OU factory via deps
 * @param {(msg: string) => void} [opts.log]
 * @param {(msg: string) => void} [opts.error]
 * @param {{ writeSnapshotFile?: (snap: object) => Promise<string|null> }} [opts.io]
 */
export async function runTierNightSeries05Smoke(opts) {
  const env = opts.env || {};
  const log = opts.log || console.log;
  const error = opts.error || console.error;
  const io = opts.io || {};

  const gate = validateSmokeEnv(env);
  if (!gate.ok) {
    return {
      ok: false,
      step: "env",
      code: 2,
      errors: gate.errors,
      mutated: { finalize: false, advance: false },
    };
  }

  const supabase = opts.supabase;
  if (!supabase) {
    return { ok: false, step: "client", code: 2, errors: ["supabase client required"] };
  }

  let snapshot = null;
  let lastOwned = null;
  const ownedStates = [];
  let mutated = { finalize: false, advance: false };
  let ambiguous = false;
  const restoreFlags = {
    restoreAttempted: false,
    restoreOk: false,
    restoreError: null,
    restoreCode: null,
  };

  const rememberOwned = (row, label) => {
    lastOwned = captureOwnedSession(row, label);
    ownedStates.push(lastOwned);
  };

  const restore = async () => {
    if (!snapshot) {
      restoreFlags.restoreCode = RESTORE_CODES.NOT_NEEDED;
      return { skipped: true, code: RESTORE_CODES.NOT_NEEDED };
    }

    const { data: currentRow, error: readErr } = await supabase
      .from("game_sessions")
      .select("lobby_id, game_id, screen, host_id, state, updated_at")
      .eq("lobby_id", snapshot.lobby_id)
      .maybeSingle();
    if (readErr) {
      restoreFlags.restoreAttempted = true;
      restoreFlags.restoreOk = false;
      restoreFlags.restoreCode = RESTORE_CODES.SKIPPED_AMBIGUOUS_STATE;
      restoreFlags.restoreError = readErr.message;
      return { ok: false, code: restoreFlags.restoreCode, error: readErr.message };
    }

    const decision = decideRestoreState({
      initialSnapshot: snapshot,
      lastOwned,
      ownedStates,
      currentRow,
      mutated,
      ambiguous,
    });

    if (!canRestoreAutomatically(decision)) {
      restoreFlags.restoreAttempted = false;
      restoreFlags.restoreOk = decision.code === RESTORE_CODES.NOT_NEEDED;
      restoreFlags.restoreCode = decision.code;
      restoreFlags.restoreError =
        decision.code === RESTORE_CODES.NOT_NEEDED ? null : decision.reason;
      return {
        skipped: true,
        code: decision.code,
        reason: decision.reason,
      };
    }

    restoreFlags.restoreAttempted = true;
    const cas = buildRestoreCas({
      initialSnapshot: snapshot,
      casFrom: decision.casFrom,
    });

    const { data: updatedRows, error: upErr } = await supabase
      .from("game_sessions")
      .update({ state: cas.restoreState, screen: cas.restoreScreen })
      .eq("lobby_id", cas.lobby_id)
      .eq("updated_at", cas.expectedUpdatedAt)
      .select("lobby_id, game_id, screen, state, updated_at");

    const { data: verifiedRow, error: verifyErr } = await supabase
      .from("game_sessions")
      .select("lobby_id, game_id, screen, state, updated_at")
      .eq("lobby_id", cas.lobby_id)
      .maybeSingle();

    if (verifyErr && !upErr) {
      restoreFlags.restoreOk = false;
      restoreFlags.restoreCode = RESTORE_CODES.VERIFY_MISMATCH;
      restoreFlags.restoreError = verifyErr.message;
      return { ok: false, code: restoreFlags.restoreCode, error: verifyErr.message };
    }

    const interpreted = interpretRestoreUpdateResult({
      updateError: upErr,
      updatedRows,
      verifiedRow,
      initialSnapshot: snapshot,
    });
    restoreFlags.restoreOk = interpreted.ok;
    restoreFlags.restoreCode = interpreted.code;
    restoreFlags.restoreError = interpreted.error;
    return {
      ok: interpreted.ok,
      code: interpreted.code,
      error: interpreted.error,
    };
  };

  const finish = (result) => ({
    ...result,
    mutated: result.mutated || mutated,
    ambiguous: result.ambiguous ?? ambiguous,
    restoreAttempted: restoreFlags.restoreAttempted,
    restoreOk: restoreFlags.restoreOk,
    restoreError: restoreFlags.restoreError,
    restoreCode: restoreFlags.restoreCode,
  });

  let outcome = null;

  try {
    smokeMain: {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user?.id) {
      outcome = {
        ok: false,
        step: "auth",
        code: 1,
        errors: [userErr?.message || "no user"],
      };
      break smokeMain;
    }
    const authUid = user.id;
    const lobbyId = String(env.TNS05_LOBBY_ID).trim();
    const expectedCode = String(env.TNS05_EXPECTED_LOBBY_CODE).trim();

    const { data: lobby, error: lobbyErr } = await supabase
      .from("lobbies")
      .select("id, code, host_id, status, game_id")
      .eq("id", lobbyId)
      .maybeSingle();
    if (lobbyErr || !lobby) {
      outcome = {
        ok: false,
        step: "lobby",
        code: 1,
        errors: [lobbyErr?.message || "lobby not found"],
      };
      break smokeMain;
    }
    if (!lobbyCodeMatchesFixture(expectedCode, lobby.code)) {
      outcome = {
        ok: false,
        step: "fixture_code",
        code: 2,
        errors: [
          `Lobby code mismatch: expected ${expectedCode.toUpperCase()}, got ${String(lobby.code).toUpperCase()}`,
        ],
      };
      break smokeMain;
    }

    const { data: membership, error: memErr } = await supabase
      .from("lobby_members")
      .select("user_id, is_host")
      .eq("lobby_id", lobbyId)
      .eq("user_id", authUid)
      .maybeSingle();
    if (memErr || !membership) {
      outcome = {
        ok: false,
        step: "membership",
        code: 1,
        errors: [memErr?.message || "not a lobby member"],
      };
      break smokeMain;
    }

    const isRealHost = isStrictLobbyHost(lobby, authUid);
    if (!isRealHost) {
      outcome = {
        ok: false,
        step: "host",
        code: 1,
        errors: [
          "authenticated user is not lobbies.host_id (strict real host required for CAS restore)",
          `membership.is_host=${membership.is_host}`,
        ],
      };
      break smokeMain;
    }

    const readSession = async () => {
      const { data, error: sessErr } = await supabase
        .from("game_sessions")
        .select("lobby_id, game_id, screen, host_id, state, updated_at")
        .eq("lobby_id", lobbyId)
        .maybeSingle();
      if (sessErr) throw new Error(sessErr.message);
      if (!data) throw new Error("No game_sessions row");
      return data;
    };

    let session = await readSession();
    let analysis = analyzeSeriesFixture(session);
    const summary = buildSafeSummary(authUid, lobbyId, lobby.code, analysis);
    log(JSON.stringify({ step: "summary", ...summary }, null, 2));

    if (gate.dryRead) {
      log("DRY_READ=1 — stop before any mutation");
      outcome = {
        ok: true,
        step: "dry_read",
        code: 0,
        dryRead: true,
        summary,
      };
      break smokeMain;
    }

    if (gate.runConcurrency && analysis.readiness !== "advance") {
      outcome = {
        ok: false,
        step: "concurrency_precondition",
        code: 1,
        errors: [
          "TNS05_RUN_CONCURRENCY=1 requires fixture already in between_rounds ready to advance",
          ...analysis.blockers,
        ],
        summary,
      };
      break smokeMain;
    }

    if (!analysis.canAdvance && !analysis.canFinalize) {
      outcome = {
        ok: false,
        step: "not_ready",
        code: 1,
        errors: ["Fixture not ready for finalize or advance", ...analysis.blockers],
        summary,
      };
      break smokeMain;
    }

    snapshot = captureSessionSnapshot(session);
    rememberOwned(session, "pre_mutation");
    log("fixture snapshot captured");
    if (gate.saveSnapshotFile && typeof io.writeSnapshotFile === "function") {
      const path = await io.writeSnapshotFile(snapshot);
      if (path) {
        log(`snapshot file written (local tmp): ${path}`);
        log(
          "WARNING: snapshot may contain fixture application data (roster/items/scores); no credentials/tokens."
        );
      }
    }

    const callAdvance = async (fromIndex, runId) => {
      const currentRoundId = `${runId}:${fromIndex}`;
      const { data, error: rpcErr } = await supabase.rpc(
        "advance_tiernight_series_round",
        {
          p_lobby_id: lobbyId,
          p_run_id: runId,
          p_current_round_id: currentRoundId,
          p_current_round_index: fromIndex,
          p_expected_phase: "between_rounds",
        }
      );
      if (rpcErr) {
        const cls = classifySmokeRpcError(rpcErr);
        ambiguous = cls.ambiguous;
        throw Object.assign(new Error(rpcErr.message || "advance RPC error"), {
          rpc: true,
          classification: cls,
        });
      }
      return data;
    };

    if (gate.runConcurrency) {
      const baselines = captureAdvanceBaselines(session);
      const runId = baselines.runId;
      const fromIndex = baselines.fromRoundIndex;
      const settled = await Promise.allSettled([
        callAdvance(fromIndex, runId),
        callAdvance(fromIndex, runId),
      ]);
      mutated.advance = true;
      const conc = assertConcurrencyResults(settled, baselines);
      session = await readSession();
      if (session.state?.tierNight?.series?.roundIndex !== conc.expectedIndex) {
        conc.failures.push("final index !== N+1");
        conc.ok = false;
      }
      if (session.state?.tierNight?.series?.roundIndex === conc.expectedIndex + 1) {
        conc.failures.push("final index N+2");
        conc.ok = false;
      }
      if (!conc.ok) {
        outcome = {
          ok: false,
          step: "concurrency",
          code: 1,
          errors: conc.failures,
          summary: buildSafeSummary(
            authUid,
            lobbyId,
            lobby.code,
            analyzeSeriesFixture(session)
          ),
        };
        break smokeMain;
      }
      rememberOwned(session, "post_concurrency");
      log("concurrency OK — one applied, one ALREADY_ADVANCED, index N+1");
      outcome = {
        ok: true,
        step: "concurrency",
        code: 0,
        summary: buildSafeSummary(
          authUid,
          lobbyId,
          lobby.code,
          analyzeSeriesFixture(session)
        ),
      };
      break smokeMain;
    }

    if (analysis.canFinalize && !analysis.canAdvance) {
      const runId = analysis.runId;
      const roundIndex = analysis.roundIndex;
      const roundId = `${runId}:${roundIndex}`;
      log(JSON.stringify({ step: "finalize_call", runId, roundId, roundIndex }));
      const { data: finData, error: finErr } = await supabase.rpc(
        "finalize_tiernight_series_round",
        {
          p_lobby_id: lobbyId,
          p_run_id: runId,
          p_round_id: roundId,
          p_round_index: roundIndex,
          p_expected_phase: "ranking",
          p_force: false,
        }
      );
      if (finErr) {
        const cls = classifySmokeRpcError(finErr);
        ambiguous = cls.ambiguous;
        throw Object.assign(new Error(finErr.message || "finalize RPC error"), {
          rpc: true,
          classification: cls,
        });
      }
      const finOk =
        finData?.ok === true &&
        (finData.applied === true || finData.code === "ALREADY_APPLIED");
      if (!finOk || finData.phase !== "between_rounds") {
        mutated.finalize = Boolean(finData?.applied);
        outcome = {
          ok: false,
          step: "finalize",
          code: 1,
          errors: [
            `finalize unexpected: applied=${finData?.applied} code=${finData?.code} phase=${finData?.phase}`,
          ],
        };
        break smokeMain;
      }
      mutated.finalize = finData.applied === true;
      session = await readSession();
      analysis = analyzeSeriesFixture(session);
      if (!analysis.canAdvance) {
        outcome = {
          ok: false,
          step: "post_finalize",
          code: 1,
          errors: [
            "After finalize, fixture not ready to advance",
            ...analysis.blockers,
          ],
        };
        break smokeMain;
      }
      rememberOwned(session, "post_finalize");
      log("finalize OK → between_rounds");
    }

    const baselines = captureAdvanceBaselines(session);
    const first = await callAdvance(baselines.fromRoundIndex, baselines.runId);
    mutated.advance = true;
    session = await readSession();
    const appliedCheck = assertAdvanceApplied(first, session, baselines);
    if (!appliedCheck.ok) {
      outcome = {
        ok: false,
        step: "advance",
        code: 1,
        errors: appliedCheck.failures,
      };
      break smokeMain;
    }
    rememberOwned(session, "post_advance");
    log("advance applied OK");
    const afterFirst = cloneJson(session);

    const retry = await callAdvance(baselines.fromRoundIndex, baselines.runId);
    session = await readSession();
    const retryCheck = assertAlreadyAdvanced(retry, session, baselines, afterFirst);
    if (!retryCheck.ok) {
      outcome = {
        ok: false,
        step: "retry",
        code: 1,
        errors: retryCheck.failures,
      };
      break smokeMain;
    }
    rememberOwned(session, "post_retry");
    log("retry ALREADY_ADVANCED OK");
    log("smoke OK");
    outcome = {
      ok: true,
      step: "done",
      code: 0,
      summary: buildSafeSummary(
        authUid,
        lobbyId,
        lobby.code,
        analyzeSeriesFixture(session)
      ),
    };
    }
  } catch (err) {
    const cls = err?.classification || classifySmokeRpcError(err);
    if (cls?.ambiguous) ambiguous = true;
    const msg = redactSecretsFromText(err?.message || String(err));
    error(`FAIL at runtime: ${msg}`);
    outcome = {
      ok: false,
      step: "exception",
      code: 1,
      errors: [msg],
      ambiguous,
      rpcKind: cls?.kind || null,
      rpcCode: cls?.code || null,
    };
  } finally {
    if (snapshot) {
      const res = await restore();
      if (res.skipped) {
        log(`restore skipped: ${res.code || "n/a"} (${res.reason || "ok"})`);
        if (
          res.code &&
          res.code !== RESTORE_CODES.NOT_NEEDED &&
          (mutated.finalize || mutated.advance)
        ) {
          error(
            `RESTORE NOT APPLIED (${res.code}). Snapshot kept locally if SAVE_SNAPSHOT_FILE=1. Manual restore only after verifying no concurrent play.`
          );
          if (outcome) {
            outcome.ok = false;
            outcome.code = Math.max(outcome.code || 1, 1);
            outcome.errors = [...(outcome.errors || []), res.code];
          }
        }
      } else if (res.ok) {
        log(`fixture restored from snapshot (${res.code || RESTORE_CODES.OK})`);
      } else {
        error(
          `RESTORE FAILED: ${res.code} ${redactSecretsFromText(res.error || "unknown")}`
        );
        error(
          "Manual restore: as lobbies.host_id, UPDATE game_sessions SET state=<snapshot.state>, screen=<snapshot.screen> WHERE lobby_id=<TNS05> AND updated_at matches last owned. Prefer TNS05_SAVE_SNAPSHOT_FILE=1."
        );
        if (outcome) {
          outcome.ok = false;
          outcome.code = Math.max(outcome.code || 1, 1);
          outcome.errors = [
            ...(outcome.errors || []),
            res.code || "RESTORE_FAILED",
          ];
        }
      }
    }
  }

  if (!outcome) {
    outcome = { ok: false, step: "unknown", code: 1, errors: ["no outcome"] };
  }
  return finish(outcome);
}

/** @deprecated kept for tests that imported it */
export function attachRestoreFlags(result, flags) {
  return {
    ...result,
    restoreAttempted: flags.restoreAttempted,
    restoreOk: flags.restoreOk,
  };
}
