/**
 * FEATURE-CHAT-03 — orchestration sync + CTA chat.
 * Couche UX au-dessus de `launchCatalogGame` / `restartGame` (aucun fork de launch).
 *
 * Concurrence sondage : vote / consultation / création / fermeture de sondage
 * restent autorisés pendant une roulette (aucune de ces actions ne lance un jeu).
 * Seuls les lancements catalogue (`restartGame` / tiles game-select) sont bloqués
 * tant que `isChatRouletteActive` est vrai.
 */
import { GAMES_AVAILABLE } from "../../data/games.js";
import { createActionLock } from "./actionLock.js";
import {
  CHAT_ROULETTE_STATE_KEY,
  buildChatRoulettePromptPayload,
  buildChatRouletteSpinPayload,
  buildEligibleCatalogGames,
  isCatalogTileEligibleForCount,
  isChatRouletteBlockingLaunch,
  isChatRouletteActionCurrent,
  localScreenAllowsChatRoulette,
  normalizeChatRouletteEvent,
  observeChatRouletteActivity,
  chatRouletteMonotonicNow,
  parseSessionUpdatedAtMs,
  pickRandomEligibleGame,
  remotePhaseAllowsChatRoulette,
  resolveEligibleCatalogGames,
  canRerollChatRoulette,
  catalogTileMinPlayers,
  resetChatRouletteObservationsForTests,
} from "./chatRandomGameLogic.js";
import {
  closeChatRouletteModal,
  isChatRouletteModalOpen,
  presentChatRouletteEvent,
  setChatRouletteUiHandlers,
} from "./chatRandomGameUi.js";
import { showAppAlert } from "./dialog.js";
import { escapeHtml } from "./ui.js";
import {
  getCachedGameSession,
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  patchGameState,
  POST_GAME_SCREENS,
} from "./gameSync.js";
import {
  getLobbyGameId,
  getLobbyParticipants,
  hasActiveLobby,
} from "./lobby.js";
import { getLastGame } from "./state.js";
import { getCurrentScreen, onScreenChange } from "./router.js";
import {
  ensureLobbyHostOrOfferClaim,
  clientMayOfferHostClaim,
} from "./hostClaimOffer.js";
import { isChatFabAllowedScreen } from "./chatFabScreens.js";

const hostActionLock = createActionLock();

let syncStarted = false;
let unsubSession = null;
let unsubScreen = null;
/** @type {string|null} */
let appliedEventSig = null;
/** Évite de spam-patcher un fantôme expiré déjà traité localement. */
const opportunisticClearedIds = new Set();

function catalogById(tileId) {
  const g = GAMES_AVAILABLE.find((x) => x.id === tileId);
  if (!g) return null;
  return { id: g.id, title: g.title, emoji: g.emoji || "🎲" };
}

function readRawRoulette() {
  return getCachedGameSession()?.state?.[CHAT_ROULETTE_STATE_KEY] ?? null;
}

function sessionUpdatedAtMs() {
  return parseSessionUpdatedAtMs(getCachedGameSession()?.updated_at);
}

function blockingContext(chatRoulette = readRawRoulette()) {
  const n = normalizeChatRouletteEvent(chatRoulette);
  const sessionTs = sessionUpdatedAtMs();
  const mono = chatRouletteMonotonicNow();
  const obs = n
    ? observeChatRouletteActivity(n, {
        nowMonotonic: mono,
        sessionUpdatedAtMs: sessionTs,
      })
    : null;
  return {
    chatRoulette: n,
    localObservation: obs,
    nowWallClock: Date.now(),
    nowMonotonic: mono,
    sessionUpdatedAtMs: sessionTs,
  };
}

function readRouletteFromCache() {
  return normalizeChatRouletteEvent(readRawRoulette());
}

/** Roulette normalisée encore active (TTL hybride centralisé). */
export function readActiveChatRoulette() {
  const ctx = blockingContext();
  if (!ctx.chatRoulette) return null;
  if (!isChatRouletteBlockingLaunch(ctx)) return null;
  return ctx.chatRoulette;
}

/** True si une roulette sync active bloque les lancements manuels. */
export function isChatRouletteBlocking() {
  return isChatRouletteBlockingLaunch(blockingContext());
}

export { isChatRouletteBlockingLaunch, observeChatRouletteActivity };

export function canControlChatRoulette() {
  return isLobbyHost();
}

export function canOfferChatRouletteCta() {
  if (!hasActiveLobby()) return false;
  if (!isChatFabAllowedScreen(getCurrentScreen())) return false;
  if (!localScreenAllowsChatRoulette(getCurrentScreen())) return false;
  const sessionRow = getCachedGameSession();
  if (!remotePhaseAllowsChatRoulette(sessionRow, getLobbyGameId())) return false;
  if (isChatRouletteBlocking()) return false;
  return true;
}

export function isChatRouletteCtaEnabled() {
  if (!canOfferChatRouletteCta()) return false;
  return isLobbyHost() || clientMayOfferHostClaim();
}

function currentEligibleGames() {
  const row = getCachedGameSession();
  const last = getLastGame();
  return resolveEligibleCatalogGames({
    games: GAMES_AVAILABLE,
    playerCount: getLobbyParticipants().length,
    sessionGameId: row?.game_id ?? null,
    sessionScreen: row?.screen ?? null,
    lastGameId: last?.gameId ?? null,
    postGameScreens: POST_GAME_SCREENS,
  });
}

function poolFromEvent(prev) {
  const fromIds = buildEligibleCatalogGames({
    games: GAMES_AVAILABLE,
    playerCount: getLobbyParticipants().length,
    excludeTileIds: [],
  }).filter((g) => (prev?.eligibleTileIds || []).includes(g.id));
  return fromIds.length ? fromIds : currentEligibleGames();
}

async function publishRoulette(payload) {
  if (!isGameSyncActive()) {
    presentChatRouletteEvent(payload);
    return { ok: true, local: true };
  }
  try {
    await patchGameState({ [CHAT_ROULETTE_STATE_KEY]: payload });
    presentChatRouletteEvent(payload);
    return { ok: true };
  } catch (e) {
    console.warn("[FEATURE-CHAT-03] publish failed", e);
    await showAppAlert(e?.message || "Impossible de synchroniser la roulette.", {
      title: "Jeu aléatoire",
      icon: "🎲",
    });
    return { ok: false, error: e };
  }
}

/**
 * Annulation / invalidation. Ignore si `expectedRouletteId` ne matche plus.
 * @param {{ expectedRouletteId?: string|null, opportunistic?: boolean }} [opts]
 */
async function clearRouletteRemote({
  expectedRouletteId = null,
  opportunistic = false,
} = {}) {
  const current = readRouletteFromCache();
  if (
    expectedRouletteId &&
    current &&
    !isChatRouletteActionCurrent(
      { rouletteId: expectedRouletteId },
      current
    )
  ) {
    return { ok: false, stale: true };
  }
  if (!isGameSyncActive()) {
    closeChatRouletteModal({ silent: true });
    return { ok: true, local: true };
  }
  try {
    await patchGameState({ [CHAT_ROULETTE_STATE_KEY]: null });
  } catch (e) {
    console.warn("[FEATURE-CHAT-03] clear failed", e);
    if (!opportunistic) {
      /* local close still required */
    }
  }
  closeChatRouletteModal({ silent: true });
  return { ok: true };
}

async function requireHostControl() {
  if (!isGameSyncActive()) return true;
  const access = await ensureLobbyHostOrOfferClaim({
    reason: "chat-random-game",
  });
  return Boolean(access?.ok);
}

async function hostOpenRoulette() {
  return hostActionLock.run(async () => {
    if (!(await requireHostControl())) return;
    const active = readActiveChatRoulette();
    if (active) {
      presentChatRouletteEvent(active);
      return;
    }
    // Fantôme expiré : nettoyage opportuniste, ne bloque pas.
    const stale = readRouletteFromCache();
    if (stale && !isChatRouletteBlockingLaunch(blockingContext(stale))) {
      void clearRouletteRemote({
        expectedRouletteId: stale.rouletteId,
        opportunistic: true,
      });
    }
    const eligible = currentEligibleGames();
    if (!eligible.length) {
      await showAppAlert(
        "Aucun jeu disponible pour le nombre de joueurs actuel.",
        { title: "Jeu aléatoire", icon: "🎲" }
      );
      return;
    }
    try {
      const { closeChatSheet, isChatSheetOpen } = await import("./feedbackUi.js");
      if (isChatSheetOpen()) closeChatSheet();
    } catch {
      /* ignore */
    }
    if (eligible.length === 1) {
      await publishRoulette(
        buildChatRouletteSpinPayload(null, eligible[0], eligible)
      );
      return;
    }
    await publishRoulette(buildChatRoulettePromptPayload(eligible));
  });
}

async function hostStartSpin() {
  return hostActionLock.run(async () => {
    if (!(await requireHostControl())) return;
    const prev = readActiveChatRoulette();
    if (!prev || prev.phase !== "prompt") return;
    const expectedId = prev.rouletteId;
    const pool = poolFromEvent(prev);
    if (!pool.length) {
      await showAppAlert("Aucun jeu éligible.", {
        title: "Jeu aléatoire",
        icon: "🎲",
      });
      return;
    }
    const pick = pickRandomEligibleGame(pool);
    if (!pick) return;
    // Anti stale : si un autre event a remplacé pendant await host…
    const still = readActiveChatRoulette();
    if (
      !isChatRouletteActionCurrent(
        { rouletteId: expectedId },
        still
      )
    ) {
      return;
    }
    await publishRoulette(buildChatRouletteSpinPayload(prev, pick, pool));
  });
}

async function hostReroll() {
  return hostActionLock.run(async () => {
    if (!(await requireHostControl())) return;
    const prev = readActiveChatRoulette();
    if (!prev || !canRerollChatRoulette({ ...prev, phase: "result" })) {
      await showAppAlert("Plus de relances disponibles.", {
        title: "Jeu aléatoire",
        icon: "🎲",
      });
      return;
    }
    const expectedId = prev.rouletteId;
    const pool = poolFromEvent(prev);
    if (pool.length < 2) return;
    const pick = pickRandomEligibleGame(pool);
    if (!pick) return;
    const still = readActiveChatRoulette();
    if (
      !isChatRouletteActionCurrent({ rouletteId: expectedId }, still)
    ) {
      return;
    }
    await publishRoulette(
      buildChatRouletteSpinPayload(prev, pick, pool, { reroll: true })
    );
  });
}

async function hostLaunchSelected() {
  return hostActionLock.run(async () => {
    if (!(await requireHostControl())) return;
    const prev = readActiveChatRoulette();
    const tileId = prev?.selectedTileId;
    const rouletteId = prev?.rouletteId;
    if (!tileId || !rouletteId) return;

    const playerCount = getLobbyParticipants().length;
    if (!isCatalogTileEligibleForCount(tileId, playerCount)) {
      const min = catalogTileMinPlayers(tileId);
      const title = catalogById(tileId)?.title || "Ce jeu";
      await showAppAlert(
        `${title} nécessite au moins ${min} joueurs (${playerCount} pour l'instant). La roulette est annulée.`,
        { title: "Jeu aléatoire", icon: "🎲" }
      );
      await clearRouletteRemote({ expectedRouletteId: rouletteId });
      return;
    }

    const {
      launchCatalogGame,
      runWithChatRouletteLaunchPermit,
    } = await import("./restartGame.js");

    // Permit ciblé : uniquement ce rouletteId + ce tile — nettoyé en finally.
    await runWithChatRouletteLaunchPermit(
      { rouletteId, tileId },
      () => launchCatalogGame(tileId)
    );

    // Si le launch a échoué, la session est toujours menu + roulette active → UI OK.
    // Si succès, startGameSession a remplacé le state (cleanup naturel).
    // Filet : si toujours le même event actif après échec silencieux, rien à faire.
  });
}

async function hostDismiss() {
  return hostActionLock.run(async () => {
    const prev = readRouletteFromCache();
    const expectedId = prev?.rouletteId || null;
    if (!(await requireHostControl())) {
      // Invité / non-hôte : fermeture visuelle locale uniquement.
      closeChatRouletteModal({ silent: true });
      return;
    }
    await clearRouletteRemote({ expectedRouletteId: expectedId });
  });
}

function applySessionRoulette() {
  const raw = readRawRoulette();
  const n = normalizeChatRouletteEvent(raw);
  const ctx = blockingContext(raw);
  const active = n && isChatRouletteBlockingLaunch(ctx) ? n : null;

  const sig = active
    ? `${active.rouletteId}|${active.attemptId}|${active.phase}|${active.selectedTileId}|${active.rerollCount}|${active.animationStartTimestamp}`
    : "";

  if (sig === appliedEventSig) {
    if (!active && isChatRouletteModalOpen()) {
      closeChatRouletteModal({ silent: true });
    }
    return;
  }
  appliedEventSig = sig;

  if (!active) {
    if (isChatRouletteModalOpen()) closeChatRouletteModal({ silent: true });
    if (n && isLobbyHost() && !opportunisticClearedIds.has(n.rouletteId)) {
      opportunisticClearedIds.add(n.rouletteId);
      void clearRouletteRemote({
        expectedRouletteId: n.rouletteId,
        opportunistic: true,
      });
    }
    return;
  }
  opportunisticClearedIds.delete(active.rouletteId);
  presentChatRouletteEvent(active, {
    blockingOpts: {
      localObservation: ctx.localObservation,
      nowWallClock: ctx.nowWallClock,
      nowMonotonic: ctx.nowMonotonic,
      sessionUpdatedAtMs: ctx.sessionUpdatedAtMs,
    },
  });
}

export function initChatRandomGameSync() {
  if (syncStarted) return;
  syncStarted = true;

  setChatRouletteUiHandlers({
    canControl: () => canControlChatRoulette(),
    getCatalogById: catalogById,
    onStart: () => {
      void hostStartSpin();
    },
    onReroll: () => {
      void hostReroll();
    },
    onLaunch: () => {
      void hostLaunchSelected();
    },
    onDismiss: () => {
      void hostDismiss();
    },
  });

  unsubSession = onGameSessionChange(() => {
    applySessionRoulette();
  });
  unsubScreen = onScreenChange(() => {
    if (
      !localScreenAllowsChatRoulette(getCurrentScreen()) &&
      !readActiveChatRoulette()
    ) {
      if (isChatRouletteModalOpen()) closeChatRouletteModal({ silent: true });
    }
  });
  applySessionRoulette();
}

export function resetChatRandomGameSyncForTests() {
  unsubSession?.();
  unsubSession = null;
  unsubScreen?.();
  unsubScreen = null;
  syncStarted = false;
  appliedEventSig = null;
  opportunisticClearedIds.clear();
  resetChatRouletteObservationsForTests();
  closeChatRouletteModal({ silent: true });
}

/** Ouverture hôte depuis la CTA chat. */
export async function openChatRandomGameFromChat() {
  return hostOpenRoulette();
}

/* ─── CTA dans le sheet chat ─── */

let ctaHost = null;
let ctaUnsubSession = null;
let ctaUnsubScreen = null;

export function resetChatRandomGameCtaForTests() {
  ctaUnsubSession?.();
  ctaUnsubSession = null;
  ctaUnsubScreen?.();
  ctaUnsubScreen = null;
  ctaHost = null;
}

export function renderChatRandomGameCta(rootEl) {
  if (!rootEl) return;
  if (!canOfferChatRouletteCta()) {
    rootEl.innerHTML = "";
    rootEl.hidden = true;
    return;
  }
  const enabled = isChatRouletteCtaEnabled();
  rootEl.hidden = false;
  rootEl.innerHTML = `
    <div class="chat-random-cta">
      <button
        type="button"
        class="btn btn-primary chat-random-cta__btn"
        data-chat-random-game
        ${enabled ? "" : "disabled"}
        title="${enabled ? "Lancer un jeu au hasard" : "Réservé à l'hôte"}"
      >
        <span class="chat-random-cta__icon" aria-hidden="true">🎲</span>
        <span class="chat-random-cta__label">Jeu aléatoire</span>
      </button>
    </div>`;
}

function bindChatRandomGameCta(rootEl) {
  if (!rootEl || rootEl.dataset.randomBound === "1") return;
  rootEl.dataset.randomBound = "1";
  rootEl.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-chat-random-game]");
    if (!btn || btn.disabled) return;
    void openChatRandomGameFromChat();
  });
}

/**
 * Monte la CTA sous le sondage dans le sheet chat.
 * @param {ParentNode} sheetRoot
 * @returns {() => void} cleanup
 */
export function mountChatRandomGameInChatSheet(sheetRoot) {
  if (!sheetRoot) return () => {};

  let slot = sheetRoot.querySelector("#chat-sheet-random");
  if (!slot) {
    slot = document.createElement("div");
    slot.id = "chat-sheet-random";
    slot.className = "chat-sheet__random";
    const poll = sheetRoot.querySelector("#chat-sheet-poll");
    const messages = sheetRoot.querySelector("#chat-sheet-messages");
    const panel = sheetRoot.querySelector(".chat-sheet__panel");
    if (poll?.parentNode) {
      poll.parentNode.insertBefore(slot, poll.nextSibling);
    } else if (messages?.parentNode) {
      messages.parentNode.insertBefore(slot, messages);
    } else if (panel) {
      panel.appendChild(slot);
    }
  }

  ctaHost = slot;
  bindChatRandomGameCta(slot);
  renderChatRandomGameCta(slot);

  ctaUnsubSession?.();
  ctaUnsubSession = onGameSessionChange(() => {
    if (ctaHost) renderChatRandomGameCta(ctaHost);
  });
  ctaUnsubScreen?.();
  ctaUnsubScreen = onScreenChange(() => {
    if (ctaHost) renderChatRandomGameCta(ctaHost);
  });

  return () => {
    ctaUnsubSession?.();
    ctaUnsubSession = null;
    ctaUnsubScreen?.();
    ctaUnsubScreen = null;
    if (ctaHost) {
      ctaHost.innerHTML = "";
      ctaHost.hidden = true;
    }
    ctaHost = null;
  };
}

/** HTML debug / tests. */
export function chatRandomGameCtaHtmlForTests(enabled) {
  return `<button type="button" data-chat-random-game ${enabled ? "" : "disabled"}>${escapeHtml("🎲 Jeu aléatoire")}</button>`;
}
