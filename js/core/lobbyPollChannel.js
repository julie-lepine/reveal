/**
 * Cycle de vie canal Realtime sondages — testable sans Supabase.
 *
 * Règles :
 * - topic unique par génération
 * - channel assigné AVANT .subscribe()
 * - skip / coalesce si même config et subscribing|subscribed|degraded
 * - CHANNEL_ERROR + state===errored / TIMED_OUT : keep (retry interne realtime-js 2.11.2)
 * - CHANNEL_ERROR + state===joining : join-reply → replace immédiat + catch-up HTTP au SUBSCRIBED
 * - CLOSED involontaire → reconnect manuel
 * - remove capture la ref, marquage intentionalClose
 * - un seul .subscribe() par instance
 * - rejoin-watch (instrum.) : observe rejoin Phoenix 30s après 1er CHANNEL_ERROR
 */
import { serializeRealtimeErr } from "./lobbyPollRealtimeDiagnose.js";
import { attachPollChannelRejoinWatch } from "./lobbyPollRejoinWatch.js";
import {
  pollRtInstanceDebugEnabled,
  makePollRtInstanceId,
  upsertPollRtRegistryEntry,
  markPollRtRegistryDisposed,
  logPollRtInstance,
  countPollRtRegistryTotal,
  countPollRtRegistryActive,
} from "./lobbyPollRtInstanceRegistry.js";

/** Une fois par évaluation de ce module (distinct si double graphe). */
export const CHANNEL_MODULE_INSTANCE_ID = makePollRtInstanceId("chmod");

/** Délais reconnect manuel (CLOSED ; join-reply seulement si circuit anti-boucle ouvert). */
export const POLL_REALTIME_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];

/**
 * Remplacements immédiats join-reply successifs sans SUBSCRIBED :
 * au-delà → fallback reconnect différé (évite boucle remove/create).
 */
export const MAX_JOIN_REPLY_IMMEDIATE_REPLACES = 3;

export function pollRealtimeReconnectDelayMs(attemptIndex) {
  const i = Math.max(
    0,
    Math.min(attemptIndex, POLL_REALTIME_RECONNECT_DELAYS_MS.length - 1)
  );
  return POLL_REALTIME_RECONNECT_DELAYS_MS[i];
}

/**
 * Famille join-reply (realtime-js 2.11.2) : CHANNEL_ERROR sans transition
 * vers `errored` / scheduleTimeout — state reste `joining`.
 * Discriminant structurel uniquement (pas err.message).
 *
 * @param {string} status
 * @param {string|null|undefined} realtimeChannelState
 */
export function isJoinReplyChannelError(status, realtimeChannelState) {
  return status === "CHANNEL_ERROR" && realtimeChannelState === "joining";
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
  return pollRtInstanceDebugEnabled();
}

/**
 * @param {object} deps
 * @param {{
 *   storeModuleInstanceId?: string|null,
 *   storeInstanceId?: string|null,
 *   storeStarted?: boolean|null,
 * }} [deps.identity]
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
    identity = {},
  } = deps;

  const controllerId = makePollRtInstanceId("ctrl");
  const controllerCreatedAt = Date.now();
  const storeModuleInstanceId = identity.storeModuleInstanceId ?? null;
  const storeInstanceId = identity.storeInstanceId ?? null;
  let disposed = false;

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
  /** Raison du dernier rebuild (passée à onSubscribed). */
  let lastBuildReason = null;
  /** Remplacements join-reply immédiats sans SUBSCRIBED depuis le dernier succès. */
  let joinReplyImmediateStreak = 0;

  function channelTopics(ch = channel) {
    return {
      logicalTopic: ch?.__pollLogicalTopic ?? null,
      internalTopic: ch?.topic ?? null,
    };
  }

  function syncRegistry(patch = {}) {
    const topics = channelTopics();
    upsertPollRtRegistryEntry(controllerId, {
      storeModuleInstanceId,
      storeInstanceId,
      channelModuleInstanceId: CHANNEL_MODULE_INSTANCE_ID,
      controllerId,
      controllerCreatedAt,
      createdAt: controllerCreatedAt,
      disposedAt: disposed ? Date.now() : null,
      started: identity.storeStarted ?? null,
      lobbyId: channelLobbyId,
      channelGen,
      channelId: channel?.__pollChannelId || null,
      topic: topics.logicalTopic,
      logicalTopic: topics.logicalTopic,
      internalTopic: topics.internalTopic,
      status: subscriptionStatus,
      joinReplyImmediateStreak,
      active: !disposed,
      ...patch,
    });
  }

  function instanceLog(event, extra = {}) {
    const topics = channelTopics();
    logPollRtInstance(event, {
      storeModuleInstanceId,
      storeInstanceId,
      channelModuleInstanceId: CHANNEL_MODULE_INSTANCE_ID,
      controllerId,
      controllerCreatedAt,
      channelId: extra.channelId ?? channel?.__pollChannelId ?? null,
      channelGen: extra.channelGen ?? channelGen,
      lobbyId: extra.lobbyId ?? channelLobbyId,
      topic: extra.logicalTopic ?? extra.topic ?? topics.logicalTopic,
      logicalTopic: extra.logicalTopic ?? topics.logicalTopic,
      internalTopic: extra.internalTopic ?? topics.internalTopic,
      status: extra.status ?? subscriptionStatus,
      channelState: extra.channelState ?? subscriptionStatus,
      started: identity.storeStarted ?? null,
      reason: extra.reason ?? lastBuildReason,
      joinReplyImmediateStreak,
      disposed,
      ...extra,
    });
  }

  function snapshot() {
    const topics = channelTopics();
    return {
      channelLobbyId,
      channelVotesPollId,
      subscriptionStatus,
      channelGen,
      hasChannel: Boolean(channel),
      /** Topic logique applicatif (logs / debug). */
      topic: topics.logicalTopic,
      logicalTopic: topics.logicalTopic,
      /** Propriété RealtimeChannel.topic préservée (préfixe realtime:). */
      internalTopic: topics.internalTopic,
      reconnectTimerActive,
      inFlightDesire,
      lastBuildReason,
      joinReplyImmediateStreak,
      controllerId,
      controllerCreatedAt,
      storeModuleInstanceId,
      storeInstanceId,
    };
  }

  function lifecycleLog(reason, extra = {}) {
    if (!lifecycleDebugEnabled()) return;
    const topics = channelTopics();
    const stack = new Error().stack;
    console.info("[POLL-RT] lifecycle", {
      reason,
      requestedGeneration: extra.requestedGeneration ?? null,
      currentGeneration: channelGen,
      currentTopic: topics.logicalTopic,
      logicalTopic: topics.logicalTopic,
      internalTopic: topics.internalTopic,
      channelState: subscriptionStatus,
      reconnectTimerActive,
      lobbyId: extra.lobbyId ?? channelLobbyId,
      votesPollId: extra.votesPollId ?? channelVotesPollId,
      controllerId,
      storeModuleInstanceId,
      storeInstanceId,
      stack,
      ...extra,
    });
  }

  /** Chronologie replace join-reply — debug only (reveal-poll-rt-debug). */
  function replaceChronology(step, extra = {}) {
    if (!lifecycleDebugEnabled()) return;
    const topics = channelTopics();
    const payload = {
      lobbyId: extra.lobbyId ?? channelLobbyId,
      oldChannelGen: extra.oldChannelGen ?? null,
      newChannelGen: extra.newChannelGen ?? channelGen,
      topic: extra.logicalTopic ?? extra.topic ?? topics.logicalTopic,
      logicalTopic: extra.logicalTopic ?? topics.logicalTopic,
      internalTopic: extra.internalTopic ?? topics.internalTopic,
      votesPollId: extra.votesPollId ?? channelVotesPollId,
      channelState: extra.channelState ?? subscriptionStatus,
      reason: extra.reason ?? lastBuildReason,
      joinReplyImmediateStreak,
      controllerId,
      storeModuleInstanceId,
      storeInstanceId,
      channelId: extra.channelId ?? channel?.__pollChannelId ?? null,
      registryTotal: countPollRtRegistryTotal(),
      registryActiveForLobby: countPollRtRegistryActive(
        extra.lobbyId ?? channelLobbyId
      ),
      ...extra,
    };
    console.info(`[POLL-RT] ${step}`, payload);
    lifecycleLog(step, payload);
  }

  syncRegistry();
  instanceLog("controller_created", {
    reason: "createPollChannelController",
    status: "idle",
    channelState: "idle",
  });

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
    const removedLogical = toRemove?.__pollLogicalTopic || null;
    const removedInternal = toRemove?.topic || null;
    const removedChannelId = toRemove?.__pollChannelId || null;
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
    instanceLog("channel_remove_start", {
      reason: intentionalRemoval ? "intentional_remove" : "remove",
      channelGen: removedGen,
      logicalTopic: removedLogical,
      internalTopic: removedInternal,
      topic: removedLogical,
      channelId: removedChannelId,
      intentionalRemoval,
    });
    log("remove channel", {
      ...snapshot(),
      topic: removedLogical,
      logicalTopic: removedLogical,
      internalTopic: removedInternal,
      removedGen,
      intentionalRemoval,
    });
    lifecycleLog("remove_start", {
      intentionalRemoval,
      requestedGeneration: removedGen,
      currentTopic: removedLogical,
      logicalTopic: removedLogical,
      internalTopic: removedInternal,
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
    instanceLog("channel_remove_done", {
      reason: intentionalRemoval ? "intentional_remove" : "remove",
      channelGen: removedGen,
      logicalTopic: removedLogical,
      internalTopic: removedInternal,
      topic: removedLogical,
      channelId: removedChannelId,
      intentionalRemoval,
    });
    syncRegistry({
      channelId: null,
      topic: null,
      logicalTopic: null,
      internalTopic: null,
    });
    return { removedGen, removed: toRemove };
  }

  /**
   * @param {string|null} lobbyId
   * @param {string|null} votesPollId
   * @param {{ reason?: string, replacedChannelGen?: number|null }} [opts]
   */
  function requestRebuild(lobbyId, votesPollId = null, opts = {}) {
    const reason = opts.reason || "requestRebuild";
    const nextVotes = votesPollId || null;
    const replacedChannelGen =
      opts.replacedChannelGen != null ? opts.replacedChannelGen : null;

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
      .then(() =>
        rebuild(lobbyId, votesPollId, reason, { replacedChannelGen })
      )
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

  async function rebuild(
    lobbyId,
    votesPollId = null,
    reason = "rebuild",
    { replacedChannelGen = null } = {}
  ) {
    if (lobbyId == null) {
      await removeCurrentChannel({ intentionalRemoval: true });
      channelLobbyId = null;
      channelVotesPollId = null;
      subscriptionStatus = "idle";
      lastBuildReason = reason;
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

    const oldGenForLog =
      replacedChannelGen != null ? replacedChannelGen : channelGen;
    const myGen = ++channelGen;
    lastBuildReason = reason;
    lifecycleLog("rebuild_start", {
      reason,
      requestedGeneration: myGen,
      lobbyId,
      votesPollId: nextVotes,
    });
    if (reason === "join_reply_error_replace") {
      replaceChronology("replacement_build_start", {
        lobbyId,
        oldChannelGen: oldGenForLog,
        newChannelGen: myGen,
        topic: `lobby-polls:${lobbyId}:${myGen}`,
        logicalTopic: `lobby-polls:${lobbyId}:${myGen}`,
        internalTopic: null,
        votesPollId: nextVotes,
        channelState: "subscribing",
        reason,
      });
    }

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
    const channelId = `poll-ch-${controllerId}-${myGen}`;

    instanceLog("channel_build_start", {
      reason,
      lobbyId,
      channelGen: myGen,
      logicalTopic: topic,
      internalTopic: null,
      topic,
      channelId,
      status: "subscribing",
      channelState: "subscribing",
      votesPollId: nextVotes,
    });

    log("build channel", {
      reason,
      lobbyId,
      channelLobbyId,
      channelVotesPollId: nextVotes,
      activePollId: nextVotes,
      topic,
      logicalTopic: topic,
      channelGen: myGen,
      subscriptionStatus,
    });
    lifecycleLog("build", {
      reason,
      requestedGeneration: myGen,
      lobbyId,
      votesPollId: nextVotes,
      currentTopic: topic,
      logicalTopic: topic,
    });

    let builder = createChannel(topic);
    if (builder && typeof builder === "object") {
      // Ne jamais muter RealtimeChannel.topic (doit rester realtime:${logical}).
      builder.__pollLogicalTopic = topic;
      builder.__pollSubscribeCallCount = 0;
      builder.__pollChannelId = channelId;
      builder.__pollControllerId = controllerId;
    }

    const internalTopic =
      builder && typeof builder === "object" ? builder.topic ?? null : null;

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
    syncRegistry({
      lobbyId,
      channelGen: myGen,
      channelId,
      topic,
      logicalTopic: topic,
      internalTopic: builder?.topic ?? internalTopic,
      status: "subscribing",
      active: true,
    });

    instanceLog("channel_build_bound", {
      reason,
      lobbyId,
      channelGen: myGen,
      logicalTopic: topic,
      internalTopic: builder?.topic ?? internalTopic,
      topic,
      channelId,
      status: "subscribing",
    });

    builder.__pollSubscribeCallCount =
      (builder.__pollSubscribeCallCount || 0) + 1;
    if (builder.__pollSubscribeCallCount !== 1) {
      console.warn("[POLL-RT] subscribeCallCount != 1", {
        count: builder.__pollSubscribeCallCount,
        logicalTopic: topic,
        internalTopic: builder?.topic ?? null,
      });
    }

    // Hooks rejoin AVANT subscribe : le 1er scheduleTimeout Phoenix
    // se produit dans receive('error') avant/avec le callback app.
    const rejoinWatch = attachPollChannelRejoinWatch(builder, {
      channelGen: myGen,
      topic,
      logicalTopic: topic,
      internalTopic: builder?.topic ?? null,
      lobbyId,
      votesPollId: nextVotes,
      channelId: builder.__pollChannelId || null,
    });

    builder.subscribe((status, err) => {
      const intentional = Boolean(builder.__pollIntentionalClose);
      const isCurrentBuilder = channel === builder;
      const isCurrentGeneration = myGen === channelGen;
      let ignoredReason = null;
      if (!isCurrentBuilder) ignoredReason = "channel_!==_builder";
      else if (!isCurrentGeneration) ignoredReason = "myGen_!==_channelGen";

      // Avant toute garde stale — visible même si callback ignoré ensuite.
      instanceLog("subscribe_callback", {
        reason: lastBuildReason,
        lobbyId,
        channelGen: myGen,
        currentChannelGen: channelGen,
        logicalTopic: topic,
        internalTopic: builder?.topic ?? null,
        topic,
        channelId: builder.__pollChannelId || null,
        status,
        channelState: builder?.state ?? null,
        isCurrentBuilder,
        isCurrentGeneration,
        ignoredReason,
        intentionalClose: intentional,
        disposed,
      });
      syncRegistry({
        status:
          isCurrentBuilder && isCurrentGeneration
            ? subscriptionStatus
            : status,
        channelGen: isCurrentBuilder && isCurrentGeneration ? channelGen : myGen,
        topic,
        logicalTopic: topic,
        internalTopic: builder?.topic ?? null,
        channelId: builder.__pollChannelId || null,
        lastSubscribeStatus: status,
        lastSubscribeIgnoredReason: ignoredReason,
      });

      try {
        rejoinWatch.noteStatus(status, err);
      } catch {
        /* ignore watch errors */
      }

      const realtimeState =
        builder && typeof builder === "object" ? builder.state ?? null : null;

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        // CLOSED intentionnel (remove/rebuild) : pas de warn prod.
        if (!(status === "CLOSED" && intentional)) {
          console.warn("[POLL-RT] subscription status", {
            status,
            realtimeState,
            errorMessage: err?.message ?? null,
            lobbyId,
            channelGen: myGen,
            intentionalClose: intentional,
            ignoredReason,
          });
        }
        if (lifecycleDebugEnabled()) {
          console.warn("[POLL-RT] subscription status detail", {
            status,
            realtimeState,
            errorName: err?.name,
            errorMessage: err?.message,
            errorCause: err?.cause,
            errorContext: err?.context,
            serialized: serializeRealtimeErr(err),
            lobbyId,
            logicalTopic: topic,
            internalTopic: builder?.topic ?? null,
            topic,
            votesPollId: nextVotes,
            channelGen: myGen,
            intentionalClose: intentional,
            subscribeCallCount: builder.__pollSubscribeCallCount,
            controllerId,
            storeModuleInstanceId,
            storeInstanceId,
            isCurrentBuilder,
            isCurrentGeneration,
            ignoredReason,
          });
        }
      } else if (lifecycleDebugEnabled()) {
        console.info("[POLL-RT] subscription status", {
          status,
          realtimeState,
          lobbyId,
          logicalTopic: topic,
          internalTopic: builder?.topic ?? null,
          channelGen: myGen,
          controllerId,
        });
      }

      if (!isCurrentBuilder || !isCurrentGeneration) {
        log("subscribe status ignored (stale)", {
          subscriptionStatus: status,
          intentionalRemoval: !isCurrentBuilder || intentional,
          channelGen: myGen,
          currentGen: channelGen,
          ignoredReason,
        });
        return;
      }

      if (status === "SUBSCRIBED") {
        subscriptionStatus = "subscribed";
        joinReplyImmediateStreak = 0;
        onStatusChange("subscribed");
        syncRegistry({
          status: "subscribed",
          joinReplyImmediateStreak: 0,
          logicalTopic: topic,
          internalTopic: builder?.topic ?? null,
        });
        const subMeta = {
          reason: lastBuildReason,
          lobbyId,
          channelGen: myGen,
          votesPollId: nextVotes,
          topic,
          logicalTopic: topic,
          internalTopic: builder?.topic ?? null,
          controllerId,
          channelId: builder.__pollChannelId || null,
        };
        if (lastBuildReason === "join_reply_error_replace") {
          replaceChronology("replacement_subscribed", {
            lobbyId,
            oldChannelGen: null,
            newChannelGen: myGen,
            topic,
            logicalTopic: topic,
            internalTopic: builder?.topic ?? null,
            votesPollId: nextVotes,
            channelState: "subscribed",
            reason: lastBuildReason,
            channelId: builder.__pollChannelId || null,
          });
        }
        onSubscribed(subMeta);
        return;
      }

      // Famille A (realtime-js 2.11.2) : join-reply error, state reste joining.
      // Remplacement immédiat sérialisé (pas le reconnect différé CLOSED).
      if (isJoinReplyChannelError(status, realtimeState)) {
        subscriptionStatus = "error";
        onStatusChange("error");
        replaceChronology("join_reply_error_replace_start", {
          lobbyId,
          oldChannelGen: myGen,
          newChannelGen: channelGen,
          topic,
          logicalTopic: topic,
          internalTopic: builder?.topic ?? null,
          votesPollId: nextVotes,
          channelState: realtimeState,
          reason: "join_reply_error_replace",
          status,
        });
        if (lifecycleDebugEnabled()) {
          console.warn("[POLL-RT] join_reply_error_replace", {
            lobbyId,
            topic,
            logicalTopic: topic,
            internalTopic: builder?.topic ?? null,
            channelGen: myGen,
            realtimeState,
            votesPollId: nextVotes,
          });
        }
        void (async () => {
          if (channel !== builder || myGen !== channelGen) return;
          await removeCurrentChannel({ intentionalRemoval: true });
          replaceChronology("old_channel_removed", {
            lobbyId,
            oldChannelGen: myGen,
            newChannelGen: channelGen,
            topic,
            logicalTopic: topic,
            internalTopic: builder?.topic ?? null,
            votesPollId: nextVotes,
            channelState: subscriptionStatus,
            reason: "join_reply_error_replace",
          });
          if (myGen !== channelGen) return;

          if (joinReplyImmediateStreak >= MAX_JOIN_REPLY_IMMEDIATE_REPLACES) {
            replaceChronology("join_reply_replace_circuit_open", {
              lobbyId,
              oldChannelGen: myGen,
              newChannelGen: channelGen,
              topic,
              logicalTopic: topic,
              internalTopic: builder?.topic ?? null,
              votesPollId: nextVotes,
              channelState: subscriptionStatus,
              reason: "join_reply_error_replace",
              maxImmediate: MAX_JOIN_REPLY_IMMEDIATE_REPLACES,
            });
            onInvoluntaryClosed();
            return;
          }
          joinReplyImmediateStreak += 1;
          await requestRebuild(lobbyId, nextVotes, {
            reason: "join_reply_error_replace",
            replacedChannelGen: myGen,
          });
        })();
        return;
      }

      // Famille B (phx_error → errored) et TIMED_OUT : retry interne armé.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        subscriptionStatus = "degraded";
        onStatusChange("degraded");
        lifecycleLog("degraded_keep_channel", {
          requestedGeneration: myGen,
          lobbyId,
          votesPollId: nextVotes,
          status,
          realtimeState,
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
    instanceLog("controller_dispose_start", {
      reason: "dispose",
      status: subscriptionStatus,
    });
    disposed = true;
    channelGen += 1;
    inFlightDesire = null;
    joinReplyImmediateStreak = 0;
    lastBuildReason = null;
    await removeCurrentChannel({ intentionalRemoval: true });
    channelLobbyId = null;
    channelVotesPollId = null;
    subscriptionStatus = "idle";
    onStatusChange("idle");
    markPollRtRegistryDisposed(controllerId, {
      storeModuleInstanceId,
      storeInstanceId,
      channelModuleInstanceId: CHANNEL_MODULE_INSTANCE_ID,
      status: "disposed",
      channelGen,
      joinReplyImmediateStreak: 0,
    });
    instanceLog("controller_disposed", {
      reason: "dispose",
      status: "disposed",
      channelState: "idle",
    });
    lifecycleLog("dispose", {});
  }

  return {
    requestRebuild,
    dispose,
    getState: snapshot,
    setReconnectTimerActive,
    controllerId,
    /** @internal */
    _awaitIdle: () => rebuildChain.catch(() => {}),
  };
}

// Diagnostic : évaluation module channel (debug only).
logPollRtInstance("module_evaluated", {
  storeModuleInstanceId: null,
  storeInstanceId: null,
  channelModuleInstanceId: CHANNEL_MODULE_INSTANCE_ID,
  controllerId: null,
  channelId: null,
  channelGen: null,
  lobbyId: null,
  topic: null,
  status: "channel_module",
  channelState: null,
  started: null,
  reason: "lobbyPollChannel_module",
  origin: {
    importMetaUrl:
      typeof import.meta !== "undefined" ? import.meta.url : null,
  },
});
