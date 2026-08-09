import { normalizeTierNightMode } from "../../data/tierTopics.js";

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

export function tierNightConfigPatchFromRemoteState(st = {}) {
  const patch = {};
  const tn = st.tierNight && typeof st.tierNight === "object" ? st.tierNight : null;
  const live = st.tierNightLive && typeof st.tierNightLive === "object" ? st.tierNightLive : null;

  if (tn) {
    if (hasOwn(tn, "topicId")) patch.tierNightTopicId = tn.topicId ?? null;
    if (hasOwn(tn, "mode")) patch.tierNightMode = normalizeTierNightMode(tn.mode);
    if (hasOwn(tn, "modifier")) patch.tierNightModifier = tn.modifier || "normal";
    if (tn.recap && hasOwn(tn.recap, "topicId") && tn.recap.topicId != null) {
      patch.tierNightTopicId = tn.recap.topicId;
    }
  }

  if (live?.lobbyStarted && !live.finished) {
    patch.tierNightTopicId = live.topicId ?? null;
    patch.tierNightMode = "live";
    patch.tierNightModifier = "normal";
  }

  return patch;
}

export function finishedTierNightLiveRemote(session = null) {
  const preserve = session && typeof session === "object";
  const out = {
    runId: preserve ? session.runId ?? null : null,
    lobbyStarted: false,
    topicId: preserve ? session.topicId ?? null : null,
    listName: preserve ? session.listName || "" : "",
    deck: preserve ? session.deck || null : null,
    playerRoster: preserve ? session.playerRoster || null : null,
    roundIdx: 0,
    phase: "done",
    votes: {},
    placements: preserve ? session.placements || {} : {},
    finished: true,
  };
  // FEATURE-TIERNIGHT-04F — conserver la série (history / series_end) sur le blob fini.
  if (preserve && session.series && typeof session.series === "object") {
    out.series = session.series;
  }
  return out;
}

export function createTierNightRunId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `tiernight-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hasRemoteTierNightRecap(st = {}) {
  return Boolean(
    st?.tierNight?.recap?.recaps?.some((r) =>
      Object.values(r.placed || {}).flat().length > 0
    )
  );
}

function hasActiveTierNightRun(st = {}) {
  const live = st?.tierNightLive;
  const liveSeriesPhase =
    live?.series?.kind === "live" && typeof live.series.phase === "string"
      ? live.series.phase
      : null;
  // between_lists : lobbyStarted peut rester true — traité comme run actif.
  const liveSeriesActive =
    liveSeriesPhase === "playing_list" || liveSeriesPhase === "between_lists";
  const liveActive =
    Boolean(live?.lobbyStarted && !live?.finished) || liveSeriesActive;
  const classicActive = Boolean(st?.tierNight?.lobbyStarted);
  const seriesPhase = st?.tierNight?.series?.phase;
  const seriesPlayActive =
    seriesPhase === "ranking" || seriesPhase === "between_rounds";
  return liveActive || classicActive || seriesPlayActive;
}

export function shouldPreferTierNightEndRoute({
  state = {},
  declared = null,
  local = null,
  localHasRecap = false,
} = {}) {
  // Re-entrée prep/select après series_end : le declared setup gagne
  // (sinon l’invité reste collé à tiernight-end alors que l’hôte ouvre Rank Live).
  const setupReentry =
    declared === "tiernight-live-prep" ||
    declared === "tiernight-prep" ||
    declared === "tiernight-select";

  if (
    state?.tierNightLive?.series?.kind === "live" &&
    state.tierNightLive.series.phase === "series_end"
  ) {
    if (setupReentry) return false;
    return !hasActiveTierNightRun(state);
  }
  if (state?.tierNight?.series?.phase === "series_end") {
    if (setupReentry) return false;
    return !hasActiveTierNightRun(state);
  }
  const remoteHasRecap = hasRemoteTierNightRecap(state);
  if (declared === "tiernight-end") {
    return !hasActiveTierNightRun(state);
  }
  // Single-list live : screen encore "tiernight-live" + recap → préférer end.
  // BUG-TIERNIGHT-04F-QA-01 : en série Rank Live active, le récap de la liste
  // précédente ne doit PAS détourner l'advance (playing_list) vers tiernight-end.
  if (declared === "tiernight-live" && remoteHasRecap) {
    const liveSeriesPhase =
      state?.tierNightLive?.series?.kind === "live" &&
      typeof state.tierNightLive.series.phase === "string"
        ? state.tierNightLive.series.phase
        : null;
    if (liveSeriesPhase === "playing_list" || liveSeriesPhase === "between_lists") {
      return false;
    }
    return true;
  }
  return (
    local === "tiernight-end" &&
    declared == null &&
    (localHasRecap || remoteHasRecap)
  );
}

/** True si le récap distant correspond au run courant (sinon refuse la route end). */
export function tierNightRecapBelongsToRun(tn = {}) {
  const recap = tn?.recap;
  if (!recap?.recaps?.length) return false;
  const hasPlacements = recap.recaps.some((r) =>
    Object.values(r.placed || {}).flat().length > 0
  );
  if (!hasPlacements) return false;
  if (tn.lobbyStarted) return false;
  const runId = tn.runId || null;
  const recapRunId = recap.runId || null;
  if (runId && recapRunId && runId !== recapRunId) return false;
  if (runId && !recapRunId) return false;
  return true;
}
