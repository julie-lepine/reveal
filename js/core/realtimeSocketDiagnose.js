/**
 * Diagnostic socket Realtime partagé + probes comparatives lobby/poll.
 * Flags localStorage :
 * - reveal-rt-socket-debug=1  → logs socket/channels
 * - reveal-rt-socket-probes=1 → probes 1–4 une fois (après auth + éventuel lobby)
 */
import { serializeRealtimeErr } from "./lobbyPollRealtimeDiagnose.js";

export function rtSocketDebugEnabled() {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("reveal-rt-socket-debug") === "1"
    );
  } catch {
    return false;
  }
}

export function rtSocketProbesEnabled() {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("reveal-rt-socket-probes") === "1"
    );
  } catch {
    return false;
  }
}

export function snapshotRealtimeChannels(supabase) {
  if (!supabase?.getChannels) return [];
  try {
    return (supabase.getChannels() || []).map((ch) => ({
      topic: ch.topic ?? ch?.params?.config?.broadcast?.ack ?? null,
      state: ch.state ?? null,
      joinedOnce: ch.joinedOnce ?? null,
    }));
  } catch {
    return [];
  }
}

export function listRealtimeTopics(supabase) {
  return snapshotRealtimeChannels(supabase)
    .map((c) => c.topic)
    .filter(Boolean);
}

export function findDuplicateTopics(topics) {
  const seen = new Map();
  const dupes = [];
  for (const t of topics || []) {
    const n = (seen.get(t) || 0) + 1;
    seen.set(t, n);
    if (n === 2) dupes.push(t);
  }
  return dupes;
}

export {
  shouldSkipLobbyRealtimeResubscribe,
  pollShouldWaitForLobbyRealtime,
} from "./lobbyRealtimeGate.js";


let socketHooksInstalled = false;

/**
 * Instrumente une seule fois le client Realtime (API publique + hooks soft).
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 */
export function installRealtimeSocketDiagnostics(supabase) {
  if (!supabase?.realtime || socketHooksInstalled) return;
  socketHooksInstalled = true;
  const rt = supabase.realtime;

  const log = (event, extra = {}) => {
    if (!rtSocketDebugEnabled()) return;
    console.info("[RT-SOCKET]", {
      event,
      timestamp: Date.now(),
      connectionState: rt.connectionState?.() ?? rt.socket?.connectionState ?? null,
      channels: snapshotRealtimeChannels(supabase),
      duplicateTopics: findDuplicateTopics(listRealtimeTopics(supabase)),
      stack: new Error().stack,
      ...extra,
    });
  };

  try {
    const sock = rt.conn || rt.socket || rt._socket || null;
    if (sock && typeof sock.onOpen === "function") {
      /* phoenix socket callbacks vary by version — wrap connect path instead */
    }
  } catch {
    /* ignore */
  }

  const originalConnect = rt.connect?.bind(rt);
  if (originalConnect) {
    rt.connect = (...args) => {
      log("socket_connect_call");
      return originalConnect(...args);
    };
  }

  const originalDisconnect = rt.disconnect?.bind(rt);
  if (originalDisconnect) {
    rt.disconnect = (...args) => {
      log("socket_disconnect_call");
      return originalDisconnect(...args);
    };
  }

  // Écoute via channel events insuffisant — poll connectionState périodique léger si debug
  if (typeof window !== "undefined" && rtSocketDebugEnabled()) {
    let lastState = null;
    const iv = setInterval(() => {
      try {
        const s = rt.connectionState?.() ?? null;
        if (s && s !== lastState) {
          log(s === "open" || s === "connected" ? "socket_open" : "socket_state", {
            connectionState: s,
            prev: lastState,
          });
          if (s === "closed" || s === "close") {
            log("socket_close", { connectionState: s, prev: lastState });
          }
          lastState = s;
        }
      } catch {
        /* ignore */
      }
    }, 400);
    window.__revealRtSocketDiagInterval = iv;
  }

  log("socket_hooks_installed");
}

/**
 * Probes comparatives 1–4 (même client / session).
 * @param {object} supabase
 * @param {{ lobbyId?: string|null, runLobbySubscribe?: Function }} opts
 */
export async function runSharedSocketProbes(supabase, opts = {}) {
  if (!supabase) return null;
  const lobbyId = opts.lobbyId || "00000000-0000-4000-8000-000000000099";
  const stamp = Date.now();
  const results = {};

  const awaitStatus = (ch, ms = 8000) =>
    new Promise((resolve) => {
      let done = false;
      const fin = (status, err) => {
        if (done) return;
        done = true;
        resolve({ status, err: serializeRealtimeErr(err) });
      };
      const t = setTimeout(() => fin("TIMEOUT_LOCAL"), ms);
      ch.subscribe((status, err) => {
        if (
          status === "SUBSCRIBED" ||
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          clearTimeout(t);
          fin(status, err);
        }
      });
    });

  const remove = async (ch) => {
    try {
      await supabase.removeChannel(ch);
    } catch {
      /* ignore */
    }
  };

  console.log("[RT-SOCKET] probe start", {
    lobbyId,
    topicsBefore: listRealtimeTopics(supabase),
  });

  // Probe 1 — poll seul
  {
    const topic = `probe-poll-only:${stamp}`;
    const ch = supabase.channel(topic).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_polls",
        filter: `lobby_id=eq.${lobbyId}`,
      },
      () => {}
    );
    results.probe1 = await awaitStatus(ch);
    console.log("[RT-SOCKET] probe1 poll-only", results.probe1);
    await remove(ch);
  }

  // Probe 2 — lobby-like seul (même forme de topic que prod)
  {
    const topic = `probe-lobby-only:${stamp}`;
    const ch = supabase.channel(topic).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_members",
        filter: `lobby_id=eq.${lobbyId}`,
      },
      () => {}
    );
    results.probe2 = await awaitStatus(ch);
    console.log("[RT-SOCKET] probe2 lobby-only", results.probe2);
    await remove(ch);
  }

  // Probe 3 — lobby SUBSCRIBED puis poll
  {
    const lobbyTopic = `probe-lobby-then-poll-L:${stamp}`;
    const pollTopic = `probe-lobby-then-poll-P:${stamp}`;
    const lobbyCh = supabase.channel(lobbyTopic).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_members",
        filter: `lobby_id=eq.${lobbyId}`,
      },
      () => {}
    );
    const lobbyRes = await awaitStatus(lobbyCh);
    const pollCh = supabase.channel(pollTopic).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_polls",
        filter: `lobby_id=eq.${lobbyId}`,
      },
      () => {}
    );
    const pollRes = await awaitStatus(pollCh);
    results.probe3 = { lobby: lobbyRes, poll: pollRes };
    console.log("[RT-SOCKET] probe3 lobby-then-poll", results.probe3);
    await remove(pollCh);
    await remove(lobbyCh);
  }

  // Probe 4 — quasi simultané
  {
    const lobbyTopic = `probe-simul-L:${stamp}`;
    const pollTopic = `probe-simul-P:${stamp}`;
    const lobbyCh = supabase.channel(lobbyTopic).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_members",
        filter: `lobby_id=eq.${lobbyId}`,
      },
      () => {}
    );
    const pollCh = supabase.channel(pollTopic).on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_polls",
        filter: `lobby_id=eq.${lobbyId}`,
      },
      () => {}
    );
    const [lobbyRes, pollRes] = await Promise.all([
      awaitStatus(lobbyCh),
      awaitStatus(pollCh),
    ]);
    results.probe4 = { lobby: lobbyRes, poll: pollRes };
    console.log("[RT-SOCKET] probe4 simultaneous (discriminant harness)", {
      ...results.probe4,
      interpretation:
        lobbyRes.status === "SUBSCRIBED" && pollRes.status === "SUBSCRIBED"
          ? "simultaneity_alone_ok_lifecycle_reveal_suspect"
          : "capture_socket_timeline_and_supabase_js_version",
      supabaseJsHint: "see package.json @supabase/supabase-js",
    });
    await remove(pollCh);
    await remove(lobbyCh);
  }

  console.log("[RT-SOCKET] probe summary", results);
  return results;
}
