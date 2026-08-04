/**
 * Gate Realtime lobby (sérialisation défensive poll) - logique pure + contrôleur testable.
 *
 * Mitigation produit : attendre SUBSCRIBED lobby avant poll sur le socket partagé.
 * Cause immédiate prouvée : _onConnClose pendant join poll.
 * Déclencheur exact du close : non isolé (pas prouvé = « 2 subs simultanés impossibles »).
 */

/** Coalesce uniquement si canal vivant du même lobbyId. */
export function shouldSkipLobbyRealtimeResubscribe({
  desiredLobbyId,
  activeLobbyId,
  hasChannel,
  subscriptionStatus,
}) {
  if (!desiredLobbyId || !hasChannel) return false;
  if (desiredLobbyId !== activeLobbyId) return false;
  // error / idle / closed → reconstruction autorisée
  return (
    subscriptionStatus === "subscribing" || subscriptionStatus === "subscribed"
  );
}

export function shouldApplyLobbySubscribeStatus({
  eventGen,
  currentGen,
  channelRef,
  activeChannelRef,
}) {
  if (eventGen !== currentGen) return false;
  if (activeChannelRef != null && channelRef !== activeChannelRef) return false;
  return true;
}

/** Wake poll seulement pour le lobby (et gen) encore courants. */
export function shouldWakePollOnLobbySubscribed({
  eventLobbyId,
  storeLobbyId,
  eventGen,
  minGen,
}) {
  if (!eventLobbyId || !storeLobbyId) return false;
  if (String(eventLobbyId) !== String(storeLobbyId)) return false;
  if (minGen != null && eventGen != null && eventGen < minGen) return false;
  return true;
}

/**
 * Après whenLobbyRealtimeReady :
 * - ok → ouvrir le poll
 * - timeout / teardown → NE PAS ouvrir (évite de réintroduire la course) ;
 *   un futur SUBSCRIBED matching pourra réveiller via listener.
 */
export function decidePollAfterLobbyWait({
  readyOk,
  reason,
  waitedLobbyId,
  storeLobbyId,
  started,
}) {
  if (!started) return { action: "abort", why: "module_stopped" };
  if (!storeLobbyId) return { action: "abort", why: "no_store_lobby" };
  if (String(waitedLobbyId) !== String(storeLobbyId)) {
    return { action: "abort", why: "lobby_changed" };
  }
  if (readyOk) return { action: "open_poll", why: reason || "ready" };
  // timeout / error : abandonner cette tentative, attendre un futur SUBSCRIBED
  return { action: "abandon_wait_future", why: reason || "timeout" };
}

export function pollShouldWaitForLobbyRealtime({ inLobby, lobbyRealtimeStatus }) {
  if (!inLobby) return false;
  return lobbyRealtimeStatus !== "subscribed";
}

/**
 * Contrôleur lobby realtime testable (sans Supabase).
 * @param {object} deps
 */
export function createLobbyRealtimeGateController(deps = {}) {
  const {
    createChannel = (topic) => ({ topic, on() { return this; }, subscribe() { return this; } }),
    removeChannel = async () => {},
    onStatus = () => {},
    log = () => {},
  } = deps;

  let channel = null;
  let lobbyId = null;
  let status = "idle";
  let gen = 0;
  /** @type {Map<number, { lobbyId: string, resolve: Function, timer: any }>} */
  const waiters = new Map();
  let waiterSeq = 0;

  function snapshot() {
    return {
      lobbyId,
      status,
      gen,
      hasChannel: Boolean(channel),
      topic: channel?.topic || null,
      waiterCount: waiters.size,
      subscribeCallCount: channel?.__lobbySubscribeCallCount ?? 0,
    };
  }

  function emit(next) {
    status = next;
    onStatus(next, { lobbyId, gen });
    if (next === "subscribed" && lobbyId) {
      for (const [id, w] of [...waiters.entries()]) {
        if (String(w.lobbyId) === String(lobbyId) && w.minGen <= gen) {
          clearTimeout(w.timer);
          waiters.delete(id);
          w.resolve({
            ok: true,
            reason: "subscribed",
            lobbyId,
            gen,
          });
        }
      }
    }
  }

  function invalidateWaiters(why) {
    for (const [id, w] of [...waiters.entries()]) {
      clearTimeout(w.timer);
      waiters.delete(id);
      w.resolve({
        ok: false,
        reason: why,
        lobbyId: w.lobbyId,
        gen,
      });
    }
  }

  function whenReady(desiredLobbyId, { timeoutMs = 12000, minGen = 0 } = {}) {
    if (!desiredLobbyId) {
      return Promise.resolve({ ok: true, reason: "no_lobby" });
    }
    if (
      status === "subscribed" &&
      channel &&
      String(lobbyId) === String(desiredLobbyId) &&
      gen >= minGen
    ) {
      return Promise.resolve({
        ok: true,
        reason: "already",
        lobbyId,
        gen,
      });
    }
    return new Promise((resolve) => {
      const id = ++waiterSeq;
      const timer = setTimeout(() => {
        waiters.delete(id);
        resolve({
          ok: false,
          reason: "timeout",
          lobbyId: desiredLobbyId,
          gen,
          status,
        });
      }, timeoutMs);
      waiters.set(id, {
        lobbyId: desiredLobbyId,
        minGen,
        resolve,
        timer,
      });
    });
  }

  function requestSubscribe(desiredLobbyId) {
    if (
      shouldSkipLobbyRealtimeResubscribe({
        desiredLobbyId,
        activeLobbyId: lobbyId,
        hasChannel: Boolean(channel),
        subscriptionStatus: status,
      })
    ) {
      log("coalesce", snapshot());
      return snapshot();
    }

    const prev = channel;
    if (prev) {
      prev.__intentionalClose = true;
      channel = null;
      void removeChannel(prev);
    }

    const myGen = ++gen;
    lobbyId = desiredLobbyId;
    emit("subscribing");

    const topic = `lobby:${desiredLobbyId}`;
    const ch = createChannel(topic);
    ch.topic = topic;
    ch.__lobbyGen = myGen;
    channel = ch;

    const onStatus = (st) => {
      if (
        !shouldApplyLobbySubscribeStatus({
          eventGen: myGen,
          currentGen: gen,
          channelRef: ch,
          activeChannelRef: channel,
        })
      ) {
        log("stale_status_ignored", { st, myGen, gen });
        return;
      }
      if (st === "SUBSCRIBED") {
        emit("subscribed");
      } else if (
        st === "CHANNEL_ERROR" ||
        st === "TIMED_OUT" ||
        st === "CLOSED"
      ) {
        if (ch.__intentionalClose && st === "CLOSED") return;
        emit("error");
      }
    };

    ch.__statusCb = onStatus;
    if (typeof ch.subscribe === "function") {
      ch.subscribe(onStatus);
    } else {
      ch.__lobbySubscribeCallCount = 1;
    }

    return snapshot();
  }

  function teardown({ reason = "teardown" } = {}) {
    gen += 1;
    const prev = channel;
    channel = null;
    lobbyId = null;
    if (prev) {
      prev.__intentionalClose = true;
      void removeChannel(prev);
    }
    emit("idle");
    invalidateWaiters(reason);
    return snapshot();
  }

  return {
    requestSubscribe,
    whenReady,
    teardown,
    getState: snapshot,
    getGen: () => gen,
    /** @internal tests */
    _emitOnActive(st) {
      if (typeof channel?.__statusCb === "function") channel.__statusCb(st);
    },
  };
}
