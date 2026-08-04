/**
 * Instrumentation seule - observe le rejoin Phoenix après CHANNEL_ERROR.
 * N'altère pas la stratégie degraded_keep_channel.
 *
 * Logs : [POLL-RT] rejoin-watch
 * Activation : reveal-poll-rt-debug=1 (ou opts.force pour les tests).
 */
import { pollRtInstanceDebugEnabled } from "./lobbyPollRtInstanceRegistry.js";

const WATCH_MS = 30_000;
const POLL_STATE_MS = 1_000;

/**
 * Accès best-effort au Channel Phoenix sous RealtimeChannel.
 * @param {object} realtimeChannel
 */
export function getPhoenixChannel(realtimeChannel) {
  if (!realtimeChannel || typeof realtimeChannel !== "object") return null;
  const adapter = realtimeChannel.channelAdapter;
  if (!adapter) return null;
  if (typeof adapter.getChannel === "function") {
    try {
      return adapter.getChannel() || null;
    } catch {
      return null;
    }
  }
  return adapter.channel || null;
}

function noopWatch() {
  return {
    noteStatus() {},
    noteRemove() {},
    dispose() {},
  };
}

/**
 * @param {object} realtimeChannel
 * @param {{
 *   channelGen: number,
 *   topic: string,
 *   lobbyId: string,
 *   votesPollId?: string|null,
 *   channelId?: string|null,
 * }} meta
 * @param {{ force?: boolean }} [opts]
 */
export function attachPollChannelRejoinWatch(realtimeChannel, meta, opts = {}) {
  if (!opts.force && !pollRtInstanceDebugEnabled()) {
    return noopWatch();
  }
  if (!realtimeChannel || typeof realtimeChannel !== "object") {
    return noopWatch();
  }

  const t0 =
    typeof performance !== "undefined" && performance.now
      ? () => performance.now()
      : () => Date.now();
  const startedAt = t0();
  const phoenix = getPhoenixChannel(realtimeChannel);
  const joinPush = realtimeChannel.joinPush || phoenix?.joinPush || null;
  const rejoinTimer =
    realtimeChannel.rejoinTimer || phoenix?.rejoinTimer || null;

  /** @type {object[]} */
  const events = [];
  let statusSeq = 0;
  let subscribeCallbackCount = 0;
  let firstErrorAt = null;
  let watchTimer = null;
  let statePollTimer = null;
  let disposed = false;
  let summaryEmitted = false;
  let lastPolledState = null;
  let lastPolledTries = null;

  function elapsedMs() {
    return Math.round(t0() - startedAt);
  }

  function elapsedSinceFirstErrorMs() {
    if (firstErrorAt == null) return null;
    return Math.round(t0() - firstErrorAt);
  }

  function pushEvent(kind, extra = {}) {
    const row = {
      tMs: elapsedMs(),
      sinceFirstErrorMs: elapsedSinceFirstErrorMs(),
      kind,
      phoenixState: readState(),
      rejoinTimerTries: readTimerTries(),
      joinPushRef: joinPush?.ref ?? null,
      ...extra,
    };
    events.push(row);
    console.info("[POLL-RT] rejoin-watch", {
      ...meta,
      ...row,
      channelStillControllerRef: true,
    });
    return row;
  }

  function readState() {
    try {
      return (
        phoenix?.state ??
        realtimeChannel.state ??
        realtimeChannel.channelAdapter?.state ??
        null
      );
    } catch {
      return null;
    }
  }

  function readTimerTries() {
    try {
      return typeof rejoinTimer?.tries === "number" ? rejoinTimer.tries : null;
    } catch {
      return null;
    }
  }

  function wrapMethod(obj, methodName, kind) {
    if (!obj || typeof obj[methodName] !== "function") return false;
    if (obj[`__pollWatchWrapped_${methodName}`]) return true;
    const original = obj[methodName].bind(obj);
    obj[methodName] = function pollRejoinWatchWrapped(...args) {
      pushEvent(kind, {
        argsPreview: args.map((a) =>
          a == null || typeof a === "number" || typeof a === "string" ? a : typeof a
        ),
      });
      return original(...args);
    };
    obj[`__pollWatchWrapped_${methodName}`] = true;
    return true;
  }

  const hooks = {
    phoenixFound: Boolean(phoenix),
    wrapRejoin: wrapMethod(phoenix, "rejoin", "phoenix_rejoin"),
    wrapResend: wrapMethod(joinPush, "resend", "joinPush_resend"),
    wrapSchedule: wrapMethod(rejoinTimer, "scheduleTimeout", "rejoinTimer_scheduleTimeout"),
    wrapReset: wrapMethod(rejoinTimer, "reset", "rejoinTimer_reset"),
  };

  pushEvent("watch_attached", {
    hooks,
    initialState: readState(),
    hasJoinPush: Boolean(joinPush),
    hasRejoinTimer: Boolean(rejoinTimer),
  });

  function emitSummary(reason) {
    if (summaryEmitted) return;
    summaryEmitted = true;
    const sinceError = elapsedSinceFirstErrorMs();
    const subscribeStatuses = events.filter((e) => e.kind === "subscribe_callback");
    const rejoins = events.filter((e) => e.kind === "phoenix_rejoin");
    const resends = events.filter((e) => e.kind === "joinPush_resend");
    const schedules = events.filter(
      (e) => e.kind === "rejoinTimer_scheduleTimeout"
    );
    const afterFirstError = events.filter(
      (e) =>
        firstErrorAt != null &&
        (e.sinceFirstErrorMs == null || e.sinceFirstErrorMs >= 0) &&
        e.kind !== "watch_attached"
    );
    const callbacksAfterFirstError = subscribeStatuses.filter(
      (e) => e.sinceFirstErrorMs != null && e.sinceFirstErrorMs > 0
    );

    let verdict;
    if (rejoins.length > 0 || resends.length > 0) {
      verdict = "rejoin_confirmed_in_reveal";
    } else if (schedules.length > 0 && callbacksAfterFirstError.length === 0) {
      verdict = "rejoin_scheduled_but_no_subscribe_callback_yet";
    } else if (
      firstErrorAt != null &&
      callbacksAfterFirstError.length === 0 &&
      rejoins.length === 0 &&
      resends.length === 0 &&
      schedules.length === 0
    ) {
      verdict = "no_rejoin_signal_observed_theory_only_so_far";
    } else if (callbacksAfterFirstError.length > 0) {
      verdict = "subscribe_callbacks_after_error_rejoin_likely";
    } else {
      verdict = "inconclusive";
    }

    console.warn("[POLL-RT] rejoin-watch SUMMARY", {
      reason,
      ...meta,
      watchWindowMs: WATCH_MS,
      elapsedMs: elapsedMs(),
      sinceFirstErrorMs: sinceError,
      firstErrorAtMs: firstErrorAt == null ? null : Math.round(firstErrorAt - startedAt),
      subscribeCallbackTotal: subscribeCallbackCount,
      subscribeCallbacksAfterFirstError: callbacksAfterFirstError.length,
      phoenixRejoinCount: rejoins.length,
      joinPushResendCount: resends.length,
      rejoinTimerScheduleCount: schedules.length,
      finalPhoenixState: readState(),
      finalRejoinTimerTries: readTimerTries(),
      hooks,
      timeline: events.map((e) => ({
        tMs: e.tMs,
        sinceFirstErrorMs: e.sinceFirstErrorMs,
        kind: e.kind,
        status: e.status ?? null,
        phoenixState: e.phoenixState,
        rejoinTimerTries: e.rejoinTimerTries,
      })),
      verdict,
    });
  }

  function startPostErrorWatch() {
    if (watchTimer || disposed) return;
    pushEvent("post_error_watch_start", {
      windowMs: WATCH_MS,
      pollStateEveryMs: POLL_STATE_MS,
    });
    statePollTimer = setInterval(() => {
      if (disposed) return;
      const st = readState();
      const tries = readTimerTries();
      if (st !== lastPolledState || tries !== lastPolledTries) {
        lastPolledState = st;
        lastPolledTries = tries;
        pushEvent("state_poll", {
          phoenixState: st,
          rejoinTimerTries: tries,
        });
      }
    }, POLL_STATE_MS);
    watchTimer = setTimeout(() => {
      emitSummary("window_30s");
      stopPolling();
    }, WATCH_MS);
  }

  function stopPolling() {
    if (statePollTimer) {
      clearInterval(statePollTimer);
      statePollTimer = null;
    }
    if (watchTimer) {
      clearTimeout(watchTimer);
      watchTimer = null;
    }
  }

  function noteStatus(status, err) {
    if (disposed) return;
    subscribeCallbackCount += 1;
    statusSeq += 1;
    const isTerminalFail =
      status === "CHANNEL_ERROR" || status === "TIMED_OUT";
    pushEvent("subscribe_callback", {
      statusSeq,
      status,
      errorMessage: err?.message ?? null,
      subscribeCallbackCount,
    });
    if (isTerminalFail && firstErrorAt == null) {
      firstErrorAt = t0();
      startPostErrorWatch();
    }
    if (status === "SUBSCRIBED" && firstErrorAt != null) {
      pushEvent("recovered_subscribed_after_error", {});
      emitSummary("recovered_subscribed");
      stopPolling();
    }
    if (status === "CLOSED") {
      pushEvent("closed_during_watch", {});
      emitSummary("closed");
      stopPolling();
    }
  }

  function noteRemove(extra = {}) {
    if (disposed) return;
    pushEvent("channel_remove", extra);
    emitSummary("removed");
    stopPolling();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopPolling();
    if (firstErrorAt != null && !summaryEmitted) {
      emitSummary("dispose");
    }
  }

  realtimeChannel.__pollRejoinWatch = {
    noteStatus,
    noteRemove,
    dispose,
    getEvents: () => events.slice(),
  };

  return { noteStatus, noteRemove, dispose };
}
