/**
 * Cycle de vie canal Realtime sondages — testable sans Supabase.
 *
 * Règles :
 * - topic unique par génération (évite collision remove/create même nom)
 * - channel assigné AVANT .subscribe() (callback sync safe)
 * - skip rebuild si même config et status subscribing|subscribed
 * - remove capture la référence exacte, await, puis create
 * - rebuilds sérialisés ; CLOSED d'un ancien canal ignoré (gén / ref)
 * - lobby_polls toujours branché ; votes seulement si votesPollId
 *
 * Diagnostic temporaire : logs status+err, config filter, probes A/B/C
 * (localStorage reveal-poll-rt-isolate=1).
 */
import {
  inspectLobbyIdForRealtimeFilter,
  pollRtIsolateEnabled,
  runPollRealtimeIsolationProbes,
  serializeRealtimeErr,
} from "./lobbyPollRealtimeDiagnose.js";

/** Délais reconnect : 1s → 2s → 5s → 10s max. */
export const POLL_REALTIME_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];

export function pollRealtimeReconnectDelayMs(attemptIndex) {
  const i = Math.max(0, Math.min(attemptIndex, POLL_REALTIME_RECONNECT_DELAYS_MS.length - 1));
  return POLL_REALTIME_RECONNECT_DELAYS_MS[i];
}

/**
 * Skip rebuild si config identique et canal encore en connexion / connecté.
 * Un état terminal (error, idle, …) autorise le remplacement.
 */
export function shouldSkipPollChannelRebuild({
  hasChannel,
  channelLobbyId,
  channelVotesPollId,
  desiredLobbyId,
  desiredVotesPollId,
  subscriptionStatus,
}) {
  if (!hasChannel) return false;
  if (channelLobbyId !== desiredLobbyId) return false;
  const nextVotes = desiredVotesPollId || null;
  if (channelVotesPollId !== nextVotes) return false;
  return (
    subscriptionStatus === "subscribing" || subscriptionStatus === "subscribed"
  );
}

/**
 * @param {object} deps
 * @param {(topic: string) => { on: Function, subscribe: Function }} deps.createChannel
 * @param {(ch: object) => Promise<void>|void} deps.removeChannel
 * @param {(payload: object, lobbyId: string) => void} deps.onPollsEvent
 * @param {(payload: object, lobbyId: string) => void} deps.onVotesEvent
 * @param {(status: string) => void} [deps.onStatusChange]
 * @param {() => void} [deps.onSubscribed]
 * @param {() => void} [deps.onTerminalError]
 * @param {(tag: string, data: object) => void} [deps.log]
 * @param {() => object|null} [deps.getSupabase] — pour probes A/B/C uniquement
 */
export function createPollChannelController(deps) {
  const {
    createChannel,
    removeChannel,
    onPollsEvent,
    onVotesEvent,
    onStatusChange = () => {},
    onSubscribed = () => {},
    onTerminalError = () => {},
    log = () => {},
    getSupabase = () => null,
  } = deps;

  let channel = null;
  let channelLobbyId = null;
  let channelVotesPollId = null;
  let subscriptionStatus = "idle";
  let channelGen = 0;
  let rebuildChain = Promise.resolve();
  let isolateProbesDone = false;

  function snapshot() {
    return {
      channelLobbyId,
      channelVotesPollId,
      subscriptionStatus,
      channelGen,
      hasChannel: Boolean(channel),
      topic: channel?.topic || null,
    };
  }

  function assertLobbyId(lobbyId) {
    if (!lobbyId || typeof lobbyId !== "string" || !lobbyId.trim()) {
      throw new Error("poll_channel_invalid_lobby_id");
    }
  }

  async function removeCurrentChannel({ intentionalRemoval = true } = {}) {
    const toRemove = channel;
    const removedGen = channelGen;
    channel = null;
    if (!toRemove) {
      log("remove channel", {
        ...snapshot(),
        skipped: true,
        intentionalRemoval,
      });
      return { removedGen, removed: null };
    }
    log("remove channel", {
      ...snapshot(),
      topic: toRemove.topic,
      removedGen,
      intentionalRemoval,
    });
    try {
      await removeChannel(toRemove);
    } catch (e) {
      log("remove channel error", { message: e?.message || String(e) });
    }
    return { removedGen, removed: toRemove };
  }

  /**
   * @param {string|null} lobbyId
   * @param {string|null} votesPollId
   */
  function requestRebuild(lobbyId, votesPollId = null) {
    const nextVotes = votesPollId || null;
    const sameConfiguration =
      Boolean(channel) &&
      channelLobbyId === lobbyId &&
      channelVotesPollId === nextVotes;
    log("rebuild requested", {
      lobbyId,
      votesPollId: nextVotes,
      sameConfiguration,
      ...snapshot(),
    });
    rebuildChain = rebuildChain
      .catch(() => {})
      .then(() => rebuild(lobbyId, votesPollId));
    return rebuildChain;
  }

  async function maybeRunIsolationProbes(lobbyId) {
    if (isolateProbesDone || !pollRtIsolateEnabled()) return;
    const sb = getSupabase?.();
    if (!sb) {
      console.log("[POLL-RT] isolate skipped (no supabase)");
      return;
    }
    isolateProbesDone = true;
    try {
      await runPollRealtimeIsolationProbes(sb, lobbyId, {
        removeChannel,
        log: (tag, data) => console.log(`[POLL-RT] ${tag}`, data),
      });
    } catch (e) {
      console.log("[POLL-RT] isolate probes failed", serializeRealtimeErr(e));
    }
  }

  async function rebuild(lobbyId, votesPollId = null) {
    if (lobbyId == null) {
      await removeCurrentChannel({ intentionalRemoval: true });
      channelLobbyId = null;
      channelVotesPollId = null;
      subscriptionStatus = "idle";
      onStatusChange("idle");
      log("rebuild idle", snapshot());
      return snapshot();
    }

    assertLobbyId(lobbyId);
    const nextVotes = votesPollId || null;

    if (
      shouldSkipPollChannelRebuild({
        hasChannel: Boolean(channel),
        channelLobbyId,
        channelVotesPollId,
        desiredLobbyId: lobbyId,
        desiredVotesPollId: nextVotes,
        subscriptionStatus,
      })
    ) {
      log("rebuild skipped (already matching)", {
        sameConfiguration: true,
        ...snapshot(),
      });
      return snapshot();
    }

    const myGen = ++channelGen;
    await removeCurrentChannel({ intentionalRemoval: true });

    if (myGen !== channelGen) {
      log("rebuild aborted (stale gen after remove)", {
        myGen,
        channelGen,
        lobbyId,
      });
      return snapshot();
    }

    // Probes A/B/C une seule fois (flag isolate) — n'altère pas la config applicative
    await maybeRunIsolationProbes(lobbyId);
    if (myGen !== channelGen) return snapshot();

    subscriptionStatus = "subscribing";
    onStatusChange("subscribing");
    channelLobbyId = lobbyId;
    channelVotesPollId = nextVotes;

    const topic = `lobby-polls:${lobbyId}:${myGen}`;
    const lobbyIdInspect = inspectLobbyIdForRealtimeFilter(lobbyId);
    const pollsFilter = `lobby_id=eq.${lobbyId}`;

    console.log("[POLL-RT] postgres_changes config", {
      event: "*",
      schema: "public",
      table: "lobby_polls",
      filter: pollsFilter,
      lobbyId,
      lobbyIdType: typeof lobbyId,
      ...lobbyIdInspect,
      votesListenerWillBind: Boolean(nextVotes),
      votesPollId: nextVotes,
    });

    log("build channel", {
      lobbyId,
      channelLobbyId,
      channelVotesPollId: nextVotes,
      activePollId: nextVotes,
      topic,
      channelGen: myGen,
      subscriptionStatus,
      lobbyIdInspect,
    });

    let builder = createChannel(topic);

    const pollsCfg = {
      event: "*",
      schema: "public",
      table: "lobby_polls",
      filter: pollsFilter,
    };
    builder = builder.on("postgres_changes", pollsCfg, (payload) => {
      log("polls event", {
        lobbyId,
        channelLobbyId,
        channelVotesPollId,
        activePollId: nextVotes,
        eventType: payload?.eventType || payload?.event,
        newPollId: payload?.new?.id,
        oldStatus: payload?.old?.status,
        newStatus: payload?.new?.status,
        subscriptionStatus,
      });
      onPollsEvent(payload, lobbyId);
    });

    // Garde stricte : jamais poll_id=eq.null / undefined
    if (nextVotes != null && String(nextVotes).trim() !== "") {
      const votesFilter = `poll_id=eq.${nextVotes}`;
      console.log("[POLL-RT] postgres_changes votes config", {
        event: "*",
        schema: "public",
        table: "lobby_poll_votes",
        filter: votesFilter,
        votesPollId: nextVotes,
      });
      builder = builder.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lobby_poll_votes",
          filter: votesFilter,
        },
        (payload) => {
          log("votes event", {
            lobbyId,
            channelLobbyId,
            channelVotesPollId: nextVotes,
            activePollId: nextVotes,
            eventType: payload?.eventType || payload?.event,
            newPollId: payload?.new?.poll_id,
            subscriptionStatus,
          });
          onVotesEvent(payload, lobbyId);
        }
      );
    } else {
      console.log("[POLL-RT] votes listener skipped", {
        reason: "no activePollId",
        votesPollId: nextVotes,
        wouldHaveBeenInvalid:
          nextVotes == null ? "poll_id=eq.null|undefined avoided" : null,
      });
    }

    // Assigner AVANT .subscribe() : un SUBSCRIBED synchrone doit voir channel === builder
    channel = builder;
    if (channel && typeof channel === "object") {
      channel.topic = topic;
    }

    builder.subscribe((status, err) => {
      console.log("[POLL-RT] subscription status", {
        status,
        error: err,
        errorName: err?.name,
        errorMessage: err?.message,
        errorCause: err?.cause,
        errorContext: err?.context,
        serialized: serializeRealtimeErr(err),
        lobbyId,
        topic,
        votesPollId: nextVotes,
        channelGen: myGen,
      });

      if (channel !== builder || myGen !== channelGen) {
        log("subscribe status ignored (stale)", {
          subscriptionStatus: status,
          intentionalRemoval: channel !== builder,
          channelGen: myGen,
          currentGen: channelGen,
        });
        return;
      }
      log("subscribe status", {
        lobbyId,
        channelLobbyId,
        channelVotesPollId,
        activePollId: nextVotes,
        subscriptionStatus: status,
        channelGen: myGen,
        error: serializeRealtimeErr(err),
      });
      if (status === "SUBSCRIBED") {
        subscriptionStatus = "subscribed";
        onStatusChange("subscribed");
        onSubscribed();
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        subscriptionStatus = "error";
        onStatusChange("error");
        onTerminalError();
      }
    });

    if (myGen !== channelGen) {
      const stale = builder;
      channel = null;
      try {
        await removeChannel(stale);
      } catch {
        /* ignore */
      }
      log("build discarded (stale gen)", { myGen, channelGen });
      return snapshot();
    }

    return snapshot();
  }

  async function dispose() {
    channelGen += 1;
    await removeCurrentChannel({ intentionalRemoval: true });
    channelLobbyId = null;
    channelVotesPollId = null;
    subscriptionStatus = "idle";
    onStatusChange("idle");
  }

  return {
    requestRebuild,
    dispose,
    getState: snapshot,
    /** @internal */
    _awaitIdle: () => rebuildChain.catch(() => {}),
  };
}
