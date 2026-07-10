function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

export function tierNightConfigPatchFromRemoteState(st = {}) {
  const patch = {};
  const tn = st.tierNight && typeof st.tierNight === "object" ? st.tierNight : null;
  const live = st.tierNightLive && typeof st.tierNightLive === "object" ? st.tierNightLive : null;

  if (tn) {
    if (hasOwn(tn, "topicId")) patch.tierNightTopicId = tn.topicId ?? null;
    if (hasOwn(tn, "mode")) patch.tierNightMode = tn.mode || "consensus";
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
  return {
    runId: preserve ? session.runId ?? null : null,
    lobbyStarted: false,
    topicId: preserve ? session.topicId ?? null : null,
    listName: preserve ? session.listName || "" : "",
    deck: preserve ? session.deck || null : null,
    roundIdx: 0,
    phase: "done",
    votes: {},
    placements: preserve ? session.placements || {} : {},
    finished: true,
  };
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
  const liveActive = Boolean(st?.tierNightLive?.lobbyStarted && !st?.tierNightLive?.finished);
  const classicActive = Boolean(st?.tierNight?.lobbyStarted);
  return liveActive || classicActive;
}

export function shouldPreferTierNightEndRoute({
  state = {},
  declared = null,
  local = null,
  localHasRecap = false,
} = {}) {
  const remoteHasRecap = hasRemoteTierNightRecap(state);
  if (declared === "tiernight-end") {
    return !hasActiveTierNightRun(state);
  }
  if (declared === "tiernight-live" && remoteHasRecap) return true;
  return (
    local === "tiernight-end" &&
    declared == null &&
    (localHasRecap || remoteHasRecap)
  );
}
