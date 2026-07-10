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
