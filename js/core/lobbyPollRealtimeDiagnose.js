/**
 * Micro-diagnostic Realtime polls - probes A/B/C (temporaire).
 * Activation : localStorage.setItem('reveal-poll-rt-isolate','1') puis reload dans un lobby.
 * Ou : node scripts/pollRealtimeIsolate.mjs <lobbyUuid>
 */
export function serializeRealtimeErr(err) {
  if (err == null) return null;
  if (typeof err !== "object") {
    return { value: String(err) };
  }
  return {
    name: err.name ?? null,
    message: err.message ?? null,
    cause: err.cause ?? null,
    context: err.context ?? null,
    stack: typeof err.stack === "string" ? err.stack.split("\n").slice(0, 4) : null,
    raw: err,
  };
}

export function inspectLobbyIdForRealtimeFilter(lobbyId) {
  const s = lobbyId == null ? "" : String(lobbyId);
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return {
    lobbyId: s,
    lobbyIdType: typeof lobbyId,
    length: s.length,
    isNullish: lobbyId == null,
    isEmpty: !s.trim(),
    hasWhitespace: s !== s.trim() || /\s/.test(s),
    hasQuotes: /['"]/.test(s),
    looksLikeUuid: uuidRe.test(s.trim()),
    looksLikeShortCode: /^[A-Z0-9]{4,8}$/i.test(s.trim()) && !uuidRe.test(s.trim()),
    filter: `lobby_id=eq.${s}`,
  };
}

/**
 * Attend le premier statut terminal (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED).
 * @param {object} channel - RealtimeChannel
 * @param {number} [timeoutMs]
 */
export function awaitChannelStatus(channel, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (status, err) => {
      if (done) return;
      done = true;
      resolve({ status, err: serializeRealtimeErr(err), errRaw: err ?? null });
    };
    const t = setTimeout(() => finish("TIMEOUT_LOCAL", null), timeoutMs);
    channel.subscribe((status, err) => {
      if (
        status === "SUBSCRIBED" ||
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        clearTimeout(t);
        finish(status, err);
      }
    });
  });
}

/**
 * @param {object} supabase
 * @param {string} lobbyId
 * @param {{ removeChannel?: Function, log?: Function }} [opts]
 */
export async function runPollRealtimeIsolationProbes(supabase, lobbyId, opts = {}) {
  const log = opts.log || ((tag, data) => console.log(`[POLL-RT] ${tag}`, data));
  const remove =
    opts.removeChannel ||
    (async (ch) => {
      try {
        await supabase.removeChannel(ch);
      } catch {
        /* ignore */
      }
    });

  const idInfo = inspectLobbyIdForRealtimeFilter(lobbyId);
  log("isolate lobbyId inspect", idInfo);

  const stamp = Date.now();
  const results = { A: null, B: null, C: null, lobbyIdInspect: idInfo };

  // --- Test A : canal vide ---
  {
    const topic = `poll-isolate-A:${stamp}`;
    log("isolate Test A start", { topic, note: "no postgres_changes" });
    const ch = supabase.channel(topic);
    results.A = await awaitChannelStatus(ch);
    log("isolate Test A result", results.A);
    await remove(ch);
  }

  // --- Test B : lobby_polls sans filtre ---
  {
    const topic = `poll-isolate-B:${stamp}`;
    const cfg = { event: "*", schema: "public", table: "lobby_polls" };
    log("isolate Test B start", { topic, postgres_changes: cfg });
    const ch = supabase
      .channel(topic)
      .on("postgres_changes", cfg, () => {});
    results.B = await awaitChannelStatus(ch);
    log("isolate Test B result", results.B);
    await remove(ch);
  }

  // --- Test C : lobby_polls avec filtre réel ---
  {
    const topic = `poll-isolate-C:${stamp}`;
    const cfg = {
      event: "*",
      schema: "public",
      table: "lobby_polls",
      filter: `lobby_id=eq.${lobbyId}`,
    };
    log("isolate Test C start", {
      topic,
      postgres_changes: cfg,
      ...idInfo,
    });
    const ch = supabase
      .channel(topic)
      .on("postgres_changes", cfg, () => {});
    results.C = await awaitChannelStatus(ch);
    log("isolate Test C result", results.C);
    await remove(ch);
  }

  log("isolate summary", {
    A: results.A?.status,
    B: results.B?.status,
    C: results.C?.status,
    A_err: results.A?.err,
    B_err: results.B?.err,
    C_err: results.C?.err,
  });

  return results;
}

export function pollRtIsolateEnabled() {
  // Probes A/B/C désactivées après diagnostic (pub/filtre OK).
  // Réactivation manuelle uniquement : localStorage reveal-poll-rt-isolate=1
  // ET décommenter le return ci-dessous si besoin ponctuel.
  try {
    if (localStorage.getItem("reveal-poll-rt-isolate") === "1") {
      // Isolates volontairement off - le flag ne relance plus les probes.
      return false;
    }
  } catch {
    /* ignore */
  }
  return false;
}
