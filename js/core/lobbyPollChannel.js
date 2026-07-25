/**
 * Cycle de vie canal Realtime sondages — testable sans Supabase.
 *
 * Règles :
 * - topic unique par génération
 * - channel assigné AVANT .subscribe()
 * - skip / coalesce si même config et subscribing|subscribed|degraded
 * - CHANNEL_ERROR / TIMED_OUT : pas de remove (retry interne Supabase)
 * - CLOSED involontaire seul → reconnect manuel
 * - remove capture la ref, marquage intentionalClose
 * - un seul .subscribe() par instance
 * - rejoin-watch (instrum.) : observe rejoin Phoenix 30s après 1er CHANNEL_ERROR
 */
import { serializeRealtimeErr } from "./lobbyPollRealtimeDiagnose.js";
import { attachPollChannelRejoinWatch } from "./lobbyPollRejoinWatch.js";

/** Délais reconnect manuel (CLOSED involontaire uniquement). */
export const POLL_REALTIME_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];

export function pollRealtimeReconnectDelayMs(attemptIndex) {
  const i = Math.max(
    0,
    Math.min(attemptIndex, POLL_REALTIME_RECONNECT_DELAYS_MS.length - 1)
  );
  return POLL_REALTIME_RECONNECT_DELAYS_MS[i];
}

/**
 * Skip rebuild si config identique et canal encore vivant
 * (join en cours, connecté, ou dégradé en retry interne Supabase).
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
    subscriptionStatus === "subscribing" ||
    subscriptionStatus === "subscribed" ||
    subscriptionStatus === "degraded"
  );
}

function lifecycleDebugEnabled() {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("reveal-poll-rt-debug") === "1"
    );
  } catch {
    return false;
  }
}

/**
 * @param {object} deps
 */
export function createPollChannelController(deps) {
  const {
    createChannel,
    removeChannel,
    onPollsEvent,
    onVotesEvent,
    onStatusChange = () => {},
    onSubscribed = () => {},
    /** Reconnect manuel — uniquement CLOSED involontaire */
    onInvoluntaryClosed = () => {},
    log = () => {},
  } = deps;

  let channel = null;
  let channelLobbyId = null;
  let channelVotesPollId = null;
  /** idle | subscribing | subscribed | degraded | error */
  let subscriptionStatus = "idle";
  let channelGen = 0;
  let rebuildChain = Promise.resolve();
  /** @type {{ lobbyId: string|null, votesPollId: string|null }|null} */
  let inFlightDesire = null;
  let reconnectTimerActive = false;

  function snapshot() {
    return {
      channelLobbyId,
      channelVotesPollId,
      subscriptionStatus,
      channelGen,
      hasChannel: Boolean(channel),
      topic: channel?.topic || null,
      reconnectTimerActive,
      inFlightDesire,
    };
  }

  function lifecycleLog(reason, extra = {}) {
    if (!lifecycleDebugEnabled()) return;
    const stack = new Error().stack;
    console.info("[POLL-RT] lifecycle", {
      reason,
      requestedGeneration: extra.requestedGeneration ?? null,
      currentGeneration: channelGen,
      currentTopic: channel?.topic || null,
      channelState: subscriptionStatus,
      reconnectTimerActive,
      lobbyId: extra.lobbyId ?? channelLobbyId,
      votesPollId: extra.votesPollId ?? channelVotesPollId,
      stack,
      ...extra,
    });
  }

  function assertLobbyId(lobbyId) {
    if (!lobbyId || typeof lobbyId !== "string" || !lobbyId.trim()) {
      throw new Error("poll_channel_invalid_lobby_id");
    }
  }

  function setReconnectTimerActive(v) {
    reconnectTimerActive = Boolean(v);
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
      lifecycleLog("remove_skipped", {
        intentionalRemoval,
        requestedGeneration: removedGen,
      });
      return { removedGen, removed: null };
    }
    if (intentionalRemoval && typeof toRemove === "object") {
      toRemove.__pollIntentionalClose = true;
      toRemove.__pollClosedGen = removedGen;
    }
    log("remove channel", {
      ...snapshot(),
      topic: toRemove.topic,
      removedGen,
      intentionalRemoval,
    });
    lifecycleLog("remove_start", {
      intentionalRemoval,
      requestedGeneration: removedGen,
      currentTopic: toRemove.topic,
      subscribeCallCount: toRemove.__pollSubscribeCallCount ?? null,
    });
    try {
      toRemove.__pollRejoinWatch?.noteRemove?.({
        intentionalRemoval,
        removedGen,
      });
      toRemove.__pollRejoinWatch?.dispose?.();
    } catch {
      /* ignore watch errors */
    }
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
   * @param {{ reason?: string }} [opts]
   */
  function requestRebuild(lobbyId, votesPollId = null, opts = {}) {
    const reason = opts.reason || "requestRebuild";
    const nextVotes = votesPollId || null;

    const sameAsCurrent = shouldSkipPollChannelRebuild({
      hasChannel: Boolean(channel),
      channelLobbyId,
      channelVotesPollId,
      desiredLobbyId: lobbyId,
      desiredVotesPollId: nextVotes,
      subscriptionStatus,
    });

    if (sameAsCurrent) {
      lifecycleLog("rebuild_coalesced_current", {
        reason,
        lobbyId,
        votesPollId: nextVotes,
        sameConfiguration: true,
      });
      log("rebuild skipped (already matching)", {
        reason,
        sameConfiguration: true,
        ...snapshot(),
      });
      return Promise.resolve(snapshot());
    }

    // Même désir déjà en file / en vol → coalescer sur la chaîne existante
    if (
      inFlightDesire &&
      inFlightDesire.lobbyId === lobbyId &&
      inFlightDesire.votesPollId === nextVotes
    ) {
      lifecycleLog("rebuild_coalesced_inflight", {
        reason,
        lobbyId,
        votesPollId: nextVotes,
      });
      return rebuildChain;
    }

    lifecycleLog("rebuild_queued", {
      reason,
      lobbyId,
      votesPollId: nextVotes,
      sameConfiguration: false,
    });
    log("rebuild requested", {
      reason,
      lobbyId,
      votesPollId: nextVotes,
      ...snapshot(),
    });

    inFlightDesire = { lobbyId, votesPollId: nextVotes };
    rebuildChain = rebuildChain
      .catch(() => {})
      .then(() => rebuild(lobbyId, votesPollId, reason))
      .finally(() => {
        if (
          inFlightDesire &&
          inFlightDesire.lobbyId === lobbyId &&
          inFlightDesire.votesPollId === nextVotes
        ) {
          inFlightDesire = null;
        }
      });
    return rebuildChain;
  }

  async function rebuild(lobbyId, votesPollId = null, reason = "rebuild") {
    if (lobbyId == null) {
      await removeCurrentChannel({ intentionalRemoval: true });
      channelLobbyId = null;
      channelVotesPollId = null;
      subscriptionStatus = "idle";
      onStatusChange("idle");
      log("rebuild idle", snapshot());
      lifecycleLog("rebuild_idle", { reason });
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
        reason,
        sameConfiguration: true,
        ...snapshot(),
      });
      lifecycleLog("rebuild_skipped_inner", {
        reason,
        lobbyId,
        votesPollId: nextVotes,
      });
      return snapshot();
    }

    const myGen = ++channelGen;
    lifecycleLog("rebuild_start", {
      reason,
      requestedGeneration: myGen,
      lobbyId,
      votesPollId: nextVotes,
    });

    await removeCurrentChannel({ intentionalRemoval: true });

    if (myGen !== channelGen) {
      log("rebuild aborted (stale gen after remove)", {
        myGen,
        channelGen,
        lobbyId,
      });
      lifecycleLog("rebuild_aborted_stale", {
        requestedGeneration: myGen,
        lobbyId,
      });
      return snapshot();
    }

    subscriptionStatus = "subscribing";
    onStatusChange("subscribing");
    channelLobbyId = lobbyId;
    channelVotesPollId = nextVotes;

    const topic = `lobby-polls:${lobbyId}:${myGen}`;
    const pollsFilter = `lobby_id=eq.${lobbyId}`;

    log("build channel", {
      reason,
      lobbyId,
      channelLobbyId,
      channelVotesPollId: nextVotes,
      activePollId: nextVotes,
      topic,
      channelGen: myGen,
      subscriptionStatus,
    });
    lifecycleLog("build", {
      reason,
      requestedGeneration: myGen,
      lobbyId,
      votesPollId: nextVotes,
      currentTopic: topic,
    });

    let builder = createChannel(topic);
    if (builder && typeof builder === "object") {
      builder.topic = topic;
      builder.__pollSubscribeCallCount = 0;
      builder.__pollChannelId = `poll-ch-${myGen}`;
    }

    builder = builder.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_polls",
        filter: pollsFilter,
      },
      (payload) => {
        log("polls event", {
          lobbyId,
          eventType: payload?.eventType || payload?.event,
          newPollId: payload?.new?.id,
          newStatus: payload?.new?.status,
        });
        onPollsEvent(payload, lobbyId);
      }
    );

    if (nextVotes != null && String(nextVotes).trim() !== "") {
      builder = builder.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "lobby_poll_votes",
          filter: `poll_id=eq.${nextVotes}`,
        },
        (payload) => {
          log("votes event", {
            lobbyId,
            eventType: payload?.eventType || payload?.event,
            newPollId: payload?.new?.poll_id,
          });
          onVotesEvent(payload, lobbyId);
        }
      );
    }

    // Assigner AVANT .subscribe()
    channel = builder;

    builder.__pollSubscribeCallCount =
      (builder.__pollSubscribeCallCount || 0) + 1;
    if (builder.__pollSubscribeCallCount !== 1) {
      console.warn("[POLL-RT] subscribeCallCount != 1", {
        count: builder.__pollSubscribeCallCount,
        topic,
      });
    }

    // Hooks rejoin AVANT subscribe : le 1er scheduleTimeout Phoenix
    // se produit dans receive('error') avant/avec le callback app.
    const rejoinWatch = attachPollChannelRejoinWatch(builder, {
      channelGen: myGen,
      topic,
      lobbyId,
      votesPollId: nextVotes,
      channelId: builder.__pollChannelId || null,
    });

    builder.subscribe((status, err) => {
      const intentional = Boolean(builder.__pollIntentionalClose);

      try {
        rejoinWatch.noteStatus(status, err);
      } catch {
        /* ignore watch errors */
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        console.warn("[POLL-RT] subscription status", {
          status,
          errorName: err?.name,
          errorMessage: err?.message,
          errorCause: err?.cause,
          errorContext: err?.context,
          serialized: serializeRealtimeErr(err),
          lobbyId,
          topic,
          votesPollId: nextVotes,
          channelGen: myGen,
          intentionalClose: intentional,
          subscribeCallCount: builder.__pollSubscribeCallCount,
        });
      } else if (lifecycleDebugEnabled()) {
        console.info("[POLL-RT] subscription status", {
          status,
          lobbyId,
          topic,
          channelGen: myGen,
        });
      }

      if (channel !== builder || myGen !== channelGen) {
        log("subscribe status ignored (stale)", {
          subscriptionStatus: status,
          intentionalRemoval: channel !== builder || intentional,
          channelGen: myGen,
          currentGen: channelGen,
        });
        // Callbacks stale toujours chroniqués par rejoin-watch ci-dessus
        return;
      }

      if (status === "SUBSCRIBED") {
        subscriptionStatus = "subscribed";
        onStatusChange("subscribed");
        onSubscribed();
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // Retry interne Supabase — ne pas remove/rebuild
        subscriptionStatus = "degraded";
        onStatusChange("degraded");
        lifecycleLog("degraded_keep_channel", {
          requestedGeneration: myGen,
          lobbyId,
          votesPollId: nextVotes,
          status,
          errorMessage: err?.message,
        });
        return;
      }

      if (status === "CLOSED") {
        if (intentional) {
          lifecycleLog("closed_intentional_ignored", {
            requestedGeneration: myGen,
            lobbyId,
          });
          return;
        }
        subscriptionStatus = "error";
        onStatusChange("error");
        channel = null;
        lifecycleLog("closed_involuntary", {
          requestedGeneration: myGen,
          lobbyId,
          votesPollId: nextVotes,
        });
        onInvoluntaryClosed();
      }
    });

    if (myGen !== channelGen) {
      const stale = builder;
      stale.__pollIntentionalClose = true;
      channel = null;
      try {
        stale.__pollRejoinWatch?.noteRemove?.({
          intentionalRemoval: true,
          reason: "stale_gen_discard",
        });
        stale.__pollRejoinWatch?.dispose?.();
      } catch {
        /* ignore */
      }
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
    inFlightDesire = null;
    await removeCurrentChannel({ intentionalRemoval: true });
    channelLobbyId = null;
    channelVotesPollId = null;
    subscriptionStatus = "idle";
    onStatusChange("idle");
    lifecycleLog("dispose", {});
  }

  return {
    requestRebuild,
    dispose,
    getState: snapshot,
    setReconnectTimerActive,
    /** @internal */
    _awaitIdle: () => rebuildChain.catch(() => {}),
  };
}
