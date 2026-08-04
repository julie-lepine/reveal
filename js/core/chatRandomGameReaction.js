/**
 * FEATURE-CHAT-03 — réactions éphémères roulette (commit + optimisme).
 */
import { createActionLock } from "./actionLock.js";
import {
  CHAT_ROULETTE_STATE_KEY,
  applyChatRouletteReactionOverlay,
  canAcceptChatRouletteReactions,
  isChatRouletteActionCurrent,
  isChatRouletteReactionId,
  mergeChatRouletteReactionPatch,
  normalizeChatRouletteEvent,
  resolveChatRouletteReactionToggle,
} from "./chatRandomGameLogic.js";
import {
  computeOptimisticMapEntryApply,
  rollbackOptimisticMapEntry,
} from "./optimisticMapEntry.js";
import {
  applyRemoteSession,
  getCachedGameSession,
  isGameSyncActive,
  requireLocalParticipantUid,
} from "./gameSync.js";
import { getState } from "./state.js";
import { presentChatRouletteEvent } from "./chatRandomGameUi.js";

const reactionCommitLock = createActionLock();
let reactionAttemptId = 0;

/** Overlay optimiste local jusqu'à confirmation serveur. */
let optimisticOverlay = null;

export function resetChatRouletteReactionStateForTests() {
  reactionAttemptId = 0;
  optimisticOverlay = null;
}

export function withChatRouletteReactionOverlay(reactionsByUid, scope) {
  return applyChatRouletteReactionOverlay(reactionsByUid, optimisticOverlay, scope);
}

function clearOverlayIfMatched(ev) {
  const opt = optimisticOverlay;
  if (!opt || !ev) return;
  if (
    opt.rouletteId !== ev.rouletteId ||
    opt.attemptId !== ev.attemptId
  ) {
    optimisticOverlay = null;
    return;
  }
  const serverVal = ev.reactionsByUid?.[opt.uid];
  const expected = opt.reactionId;
  if (expected == null && serverVal == null) optimisticOverlay = null;
  else if (expected != null && serverVal === expected) optimisticOverlay = null;
}

export function onChatRouletteRemoteEvent(ev) {
  clearOverlayIfMatched(normalizeChatRouletteEvent(ev));
}

/**
 * Persistance atomique serveur — RPC unique hôte + invités.
 * `contribute_chat_roulette_reaction` : SELECT … FOR UPDATE + jsonb_set sur une clé UID.
 *
 * @param {{ reaction: string|null }} input
 */
export async function persistChatRouletteReactionRemote({ reaction }) {
  const row = getCachedGameSession();
  const n = normalizeChatRouletteEvent(row?.state?.[CHAT_ROULETTE_STATE_KEY]);
  if (!n || !canAcceptChatRouletteReactions(n)) {
    throw new Error("Réaction indisponible pour ce tirage.");
  }
  const lobbyId = getState().lobby.id;
  if (!lobbyId) throw new Error("Lobby requis.");

  const { rpcContributeChatRouletteReaction } = await import("./gameSessionRpc.js");
  const { fetchGameSessionByLobby } = await import("./gameSync.js");

  const serverRow = await rpcContributeChatRouletteReaction({
    lobbyId,
    rouletteId: n.rouletteId,
    attemptId: n.attemptId,
    reaction,
  });
  if (!serverRow) throw new Error("Contribution refusée.");

  let full = serverRow;
  if (!serverRow.state) {
    full = (await fetchGameSessionByLobby(lobbyId)) || serverRow;
  }
  applyRemoteSession(full);
  return full;
}

function applyOptimisticSessionReaction(ev, uid, nextReaction) {
  const row = getCachedGameSession();
  if (!row?.state) return null;
  const merged = mergeChatRouletteReactionPatch(row.state[CHAT_ROULETTE_STATE_KEY], {
    reactionsByUid: { [uid]: nextReaction },
  });
  const nextRow = {
    ...row,
    state: {
      ...row.state,
      [CHAT_ROULETTE_STATE_KEY]: merged,
    },
  };
  applyRemoteSession(nextRow);
  return merged;
}

function rollbackOptimisticSessionReaction(captured) {
  const row = getCachedGameSession();
  if (!row?.state) {
    optimisticOverlay = null;
    return;
  }
  const live = normalizeChatRouletteEvent(row.state[CHAT_ROULETTE_STATE_KEY]);
  if (
    !live ||
    !isChatRouletteActionCurrent(captured, live, { matchAttempt: true }) ||
    captured.commitAttemptId !== reactionAttemptId
  ) {
    optimisticOverlay = null;
    return;
  }
  const rolled = rollbackOptimisticMapEntry({
    currentMap: withChatRouletteReactionOverlay(live.reactionsByUid, live),
    key: captured.uid,
    hadPreviousValue: captured.hadPreviousValue,
    previousValue: captured.previousValue,
    optimisticValue: captured.optimisticValue,
    attemptId: captured.commitAttemptId,
    currentAttemptId: reactionAttemptId,
  });
  if (!rolled.applied) {
    optimisticOverlay = null;
    return;
  }
  const nextEv = { ...live, reactionsByUid: rolled.map };
  applyRemoteSession({
    ...row,
    state: {
      ...row.state,
      [CHAT_ROULETTE_STATE_KEY]: mergeChatRouletteReactionPatch(live, {
        reactionsByUid: { [captured.uid]: rolled.map[captured.uid] ?? null },
      }),
    },
  });
  optimisticOverlay = null;
  presentChatRouletteEvent(nextEv);
}

/**
 * @param {string} clickedReactionId
 * @param {{
 *   rouletteId: string,
 *   attemptId: string,
 *   reactionsByUid?: Record<string, string>,
 * }} scope
 */
export async function commitChatRouletteReaction(clickedReactionId, scope) {
  if (!isChatRouletteReactionId(clickedReactionId)) {
    return { ok: false, reason: "invalid_reaction" };
  }
  if (
    !scope?.rouletteId ||
    !scope?.attemptId ||
    !isChatRouletteActionCurrent(scope, scope, { matchAttempt: true })
  ) {
    return { ok: false, reason: "stale_scope" };
  }

  return reactionCommitLock.run(async () => {
    const row = getCachedGameSession();
    const live = normalizeChatRouletteEvent(row?.state?.[CHAT_ROULETTE_STATE_KEY]);
    if (
      !live ||
      !isChatRouletteActionCurrent(scope, live, { matchAttempt: true }) ||
      !canAcceptChatRouletteReactions(live)
    ) {
      return { ok: false, reason: "stale_roulette" };
    }

    let uid;
    try {
      uid = requireLocalParticipantUid();
    } catch {
      return { ok: false, reason: "no_uid" };
    }

    const effective = withChatRouletteReactionOverlay(live.reactionsByUid, live);
    const nextReaction = resolveChatRouletteReactionToggle(
      effective[uid],
      clickedReactionId
    );

    const apply = computeOptimisticMapEntryApply({
      map: live.reactionsByUid,
      key: uid,
      value: nextReaction,
    });
    const nextReactionsMap = { ...apply.nextMap };
    if (nextReaction == null) delete nextReactionsMap[uid];

    const commitAttemptId = ++reactionAttemptId;
    const captured = {
      rouletteId: live.rouletteId,
      attemptId: live.attemptId,
      uid,
      commitAttemptId,
      hadPreviousValue: apply.hadPreviousValue,
      previousValue: apply.previousValue,
      optimisticValue: apply.optimisticValue,
    };

    optimisticOverlay = {
      rouletteId: live.rouletteId,
      attemptId: live.attemptId,
      uid,
      reactionId: nextReaction,
    };

    const optimisticEv = {
      ...live,
      reactionsByUid: withChatRouletteReactionOverlay(nextReactionsMap, live),
    };
    applyOptimisticSessionReaction(live, uid, nextReaction);
    presentChatRouletteEvent(optimisticEv);

    if (!isGameSyncActive()) {
      optimisticOverlay = null;
      return { ok: true, local: true };
    }

    try {
      await persistChatRouletteReactionRemote({ reaction: nextReaction });
      clearOverlayIfMatched(
        normalizeChatRouletteEvent(
          getCachedGameSession()?.state?.[CHAT_ROULETTE_STATE_KEY]
        )
      );
      return { ok: true };
    } catch (err) {
      if (commitAttemptId === reactionAttemptId) {
        rollbackOptimisticSessionReaction(captured);
        try {
          const { showAppAlert } = await import("./dialog.js");
          await showAppAlert("Réaction non envoyée. Réessaie.", {
            title: "Jeu aléatoire",
            icon: "🎲",
          });
        } catch {
          /* ignore alert failure */
        }
      }
      return { ok: false, error: err };
    }
  });
}
