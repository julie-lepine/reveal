/**
 * Cycle de vie canal Realtime sondages — testable sans Supabase.
 *
 * Règles :
 * - topic unique par génération (évite collision remove/create même nom)
 * - remove capture la référence exacte, await, puis create
 * - rebuilds sérialisés ; un cleanup ancien ne retire jamais un canal plus récent
 * - lobby_polls toujours branché ; votes seulement si votesPollId
 */

/**
 * @param {object} deps
 * @param {(topic: string) => { on: Function, subscribe: Function }} deps.createChannel
 * @param {(ch: object) => Promise<void>|void} deps.removeChannel
 * @param {(payload: object) => void} deps.onPollsEvent
 * @param {(payload: object) => void} deps.onVotesEvent
 * @param {(status: string) => void} [deps.onStatusChange]
 * @param {(tag: string, data: object) => void} [deps.log]
 */
export function createPollChannelController(deps) {
  const {
    createChannel,
    removeChannel,
    onPollsEvent,
    onVotesEvent,
    onStatusChange = () => {},
    log = () => {},
  } = deps;

  let channel = null;
  let channelLobbyId = null;
  let channelVotesPollId = null;
  let subscriptionStatus = "idle";
  let channelGen = 0;
  let rebuildChain = Promise.resolve();

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

  async function removeCurrentChannel() {
    const toRemove = channel;
    const removedGen = channelGen;
    channel = null;
    if (!toRemove) {
      log("remove channel", { ...snapshot(), skipped: true });
      return { removedGen, removed: null };
    }
    log("remove channel", {
      ...snapshot(),
      topic: toRemove.topic,
      removedGen,
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
    log("rebuild requested", {
      lobbyId,
      votesPollId,
      ...snapshot(),
    });
    rebuildChain = rebuildChain
      .catch(() => {})
      .then(() => rebuild(lobbyId, votesPollId));
    return rebuildChain;
  }

  async function rebuild(lobbyId, votesPollId = null) {
    if (!lobbyId) {
      await removeCurrentChannel();
      channelLobbyId = null;
      channelVotesPollId = null;
      subscriptionStatus = "idle";
      log("rebuild idle", snapshot());
      return snapshot();
    }

    assertLobbyId(lobbyId);
    const nextVotes = votesPollId || null;

    if (
      channel &&
      channelLobbyId === lobbyId &&
      channelVotesPollId === nextVotes &&
      subscriptionStatus === "subscribed"
    ) {
      log("rebuild skipped (already matching)", snapshot());
      return snapshot();
    }

    const myGen = ++channelGen;
    await removeCurrentChannel();

    // Cleanup ancien : ne pas créer si une rebuild plus récente a gagné
    if (myGen !== channelGen) {
      log("rebuild aborted (stale gen after remove)", {
        myGen,
        channelGen,
        lobbyId,
      });
      return snapshot();
    }

    subscriptionStatus = "subscribing";
    onStatusChange("subscribing");
    channelLobbyId = lobbyId;
    channelVotesPollId = nextVotes;

    const topic = `lobby-polls:${lobbyId}:${myGen}`;
    log("build channel", {
      lobbyId,
      channelLobbyId,
      channelVotesPollId: nextVotes,
      activePollId: nextVotes,
      topic,
      channelGen: myGen,
      subscriptionStatus,
    });

    let builder = createChannel(topic);
    builder = builder.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "lobby_polls",
        filter: `lobby_id=eq.${lobbyId}`,
      },
      (payload) => {
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
      }
    );

    if (nextVotes) {
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
    }

    const ch = builder.subscribe((status) => {
      // Ignorer les callbacks d'un canal déjà retiré / gén stale
      if (channel !== ch || myGen !== channelGen) return;
      log("subscribe status", {
        lobbyId,
        channelLobbyId,
        channelVotesPollId,
        activePollId: nextVotes,
        subscriptionStatus: status,
        channelGen: myGen,
      });
      if (status === "SUBSCRIBED") {
        subscriptionStatus = "subscribed";
        onStatusChange("subscribed");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        subscriptionStatus = "error";
        onStatusChange("error");
      }
    });

    // Si une rebuild plus récente a démarré pendant create, retirer ce canal
    if (myGen !== channelGen) {
      try {
        await removeChannel(ch);
      } catch {
        /* ignore */
      }
      log("build discarded (stale gen)", { myGen, channelGen });
      return snapshot();
    }

    channel = ch;
    channel.topic = topic;
    return snapshot();
  }

  async function dispose() {
    channelGen += 1;
    await removeCurrentChannel();
    channelLobbyId = null;
    channelVotesPollId = null;
    subscriptionStatus = "idle";
  }

  return {
    requestRebuild,
    dispose,
    getState: snapshot,
    /** @internal */
    _awaitIdle: () => rebuildChain.catch(() => {}),
  };
}
