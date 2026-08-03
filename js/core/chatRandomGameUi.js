/**
 * FEATURE-CHAT-03 — modale + animation slot machine (cosmétique).
 * Le résultat est déjà connu via l'événement sync ; l'UI suit le timestamp hôte.
 * Resize / orientation : recalcule le transform sans nouveau tirage ni patch.
 */
import { escapeHtml } from "./ui.js";
import {
  CHAT_ROULETTE_DURATION_MS,
  buildSlotReel,
  chatRouletteShouldShowResult,
  chatRouletteSpinProgress,
  canRerollChatRoulette,
  chatRouletteBridgeCopy,
  chatRouletteWinkLine,
  isChatRouletteActionCurrent,
  isChatRouletteBlockingLaunch,
  normalizeChatRouletteEvent,
  resolveChatRouletteResultAct,
} from "./chatRandomGameLogic.js";

const DEFAULT_CARD_H = 76;

let rootEl = null;
let rafId = 0;
let spinTimer = 0;
let lastRouletteId = null;
let lastAttemptId = null;
let lastPhaseKey = "";
let resizeListening = false;

/** @type {null|{
 *   rouletteId: string,
 *   attemptId: string,
 *   start: number,
 *   duration: number,
 *   winner: { id: string, title: string, emoji: string },
 *   games: Array<{ id: string, title: string, emoji: string }>,
 *   cardH: number,
 * }} */
let spinCtx = null;

/** @type {null|{
 *   onStart: () => void,
 *   onReroll: () => void,
 *   onLaunch: () => void,
 *   onBridgePoll?: () => void,
 *   onDismiss: () => void,
 *   canControl: () => boolean,
 *   hasOpenLobbyPoll?: () => boolean,
 *   getCatalogById: (id: string) => { id: string, title: string, emoji: string }|null,
 * }} */
let handlers = null;

export function isChatRouletteModalOpen() {
  return Boolean(rootEl);
}

export function resetChatRouletteUiForTests() {
  closeChatRouletteModal({ silent: true });
  handlers = null;
}

/**
 * @param {typeof handlers} next
 */
export function setChatRouletteUiHandlers(next) {
  handlers = next;
}

function clearTimers() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (spinTimer) {
    clearTimeout(spinTimer);
    spinTimer = 0;
  }
}

function unbindResize() {
  if (!resizeListening || typeof window === "undefined") return;
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("orientationchange", onViewportChange);
  resizeListening = false;
}

function bindResize() {
  if (resizeListening || typeof window === "undefined") return;
  window.addEventListener("resize", onViewportChange);
  window.addEventListener("orientationchange", onViewportChange);
  resizeListening = true;
}

function onViewportChange() {
  if (!spinCtx || !rootEl) return;
  // Recalcule géométrie / transform à partir du même attempt — pas de nouveau tirage.
  const progress = chatRouletteSpinProgress(
    {
      ...spinCtx,
      phase: "spinning",
      selectedTileId: spinCtx.winner.id,
      eligibleTileIds: spinCtx.games.map((g) => g.id),
      animationStartTimestamp: spinCtx.start,
      animationDurationMs: spinCtx.duration,
      createdAt: spinCtx.start,
      expiresAt: spinCtx.start + 120_000,
      rerollCount: 0,
      maxRerolls: 3,
    },
    Date.now()
  );
  if (progress >= 1) return;
  applySpinFrame(spinCtx, progress);
}

export function closeChatRouletteModal({ silent = false } = {}) {
  clearTimers();
  spinCtx = null;
  lastRouletteId = null;
  lastAttemptId = null;
  lastPhaseKey = "";
  unbindResize();
  if (rootEl) {
    rootEl.classList.remove("chat-roulette--in");
    rootEl.classList.add("chat-roulette--out");
    const el = rootEl;
    rootEl = null;
    const remove = () => el.remove();
    el.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 320);
  }
  if (!silent) handlers?.onDismiss?.();
}

function measureCardH() {
  const card = rootEl?.querySelector(".chat-roulette__card");
  const h = card?.getBoundingClientRect?.().height;
  return h && h > 0 ? h : DEFAULT_CARD_H;
}

function gameCardHtml(g, { winner = false } = {}) {
  return `
    <div class="chat-roulette__card${winner ? " chat-roulette__card--winner" : ""}" data-tile="${escapeHtml(g.id)}">
      <span class="chat-roulette__card-emoji" aria-hidden="true">${escapeHtml(g.emoji || "🎲")}</span>
      <span class="chat-roulette__card-title">${escapeHtml(g.title)}</span>
    </div>`;
}

function resolveGames(ev) {
  const ids = ev.eligibleTileIds?.length
    ? ev.eligibleTileIds
    : ev.selectedTileId
      ? [ev.selectedTileId]
      : [];
  return ids
    .map((id) => handlers?.getCatalogById?.(id))
    .filter(Boolean);
}

function renderPrompt(canControl) {
  return `
    <p class="chat-roulette__headline">Quel sera<br/>le prochain jeu&nbsp;?</p>
    ${
      canControl
        ? `<button type="button" class="btn btn-primary chat-roulette__btn" data-roulette-start>Commencer</button>`
        : `<p class="hint chat-roulette__wait">L'hôte lance la roulette…</p>`
    }`;
}

function renderResult(winner, ev, canControl) {
  const act = resolveChatRouletteResultAct(ev.drawCount);
  const canReroll = canControl && canRerollChatRoulette(ev);
  const pollOpen = Boolean(handlers?.hasOpenLobbyPoll?.());
  const wink = chatRouletteWinkLine(ev.drawCount);
  const bridge = chatRouletteBridgeCopy();

  let voiceHtml = "";
  if (act === "wink") {
    voiceHtml = `<p class="chat-roulette__voice">${escapeHtml(wink)}</p>`;
  } else if (act === "bridge") {
    voiceHtml = `
      <div class="chat-roulette__voice chat-roulette__voice--bridge">
        <p class="chat-roulette__voice-title">${escapeHtml(bridge.title)}</p>
        <p class="chat-roulette__voice-sub">${escapeHtml(bridge.subtitle)}</p>
      </div>`;
  }

  const rerollLabel = act === "plain" ? "Relancer" : "Encore une fois";
  const bridgeLabel = pollOpen
    ? "Voir le vote du groupe"
    : "Faire voter le groupe";

  let actionsHtml = "";
  if (canControl) {
    const bridgeBtn =
      act === "bridge"
        ? `<button type="button" class="btn btn-accent chat-roulette__btn" data-roulette-bridge>
            ${escapeHtml(bridgeLabel)}
          </button>`
        : "";
    const rerollBtn = canReroll
      ? act === "bridge"
        ? `<button type="button" class="btn-link chat-roulette__reroll-link" data-roulette-reroll>
            ${escapeHtml(rerollLabel)}
          </button>`
        : `<button type="button" class="btn btn-secondary chat-roulette__btn" data-roulette-reroll>
            ${escapeHtml(rerollLabel)}
          </button>`
      : "";
    actionsHtml = `
      <div class="chat-roulette__actions${act === "bridge" ? " chat-roulette__actions--bridge" : ""}">
        <button type="button" class="btn btn-primary chat-roulette__btn" data-roulette-launch>On joue</button>
        ${bridgeBtn}
        ${rerollBtn}
      </div>`;
  } else {
    actionsHtml = `<p class="hint chat-roulette__wait">L'hôte décide de la suite…</p>`;
  }

  return `
    <p class="chat-roulette__result-label">Le prochain jeu est</p>
    <div class="chat-roulette__winner chat-roulette__winner--pop">
      ${gameCardHtml(winner, { winner: true })}
    </div>
    ${voiceHtml}
    ${actionsHtml}`;
}

function renderSpinMarkup(games, winner, progress, cardH) {
  const { reel, landingIndex } = buildSlotReel(games, winner.id);
  const viewportH = cardH * 3;
  const offset = Math.max(0, landingIndex * cardH - cardH);
  const y = -offset * progress;
  const cards = reel.map((g) => gameCardHtml(g)).join("");
  return `
    <div class="chat-roulette__viewport" style="height:${viewportH}px">
      <div class="chat-roulette__reel" data-roulette-reel style="transform:translate3d(0,${y}px,0)">
        ${cards}
      </div>
      <div class="chat-roulette__fade chat-roulette__fade--top" aria-hidden="true"></div>
      <div class="chat-roulette__fade chat-roulette__fade--bottom" aria-hidden="true"></div>
      <div class="chat-roulette__center-line" style="height:${cardH}px;margin-top:-${cardH / 2}px" aria-hidden="true"></div>
    </div>`;
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function applySpinFrame(ctx, linearProgress) {
  const stage = rootEl?.querySelector("[data-roulette-stage]");
  if (!stage || !ctx) return;
  const cardH = measureCardH() || ctx.cardH || DEFAULT_CARD_H;
  ctx.cardH = cardH;
  const eased = easeOutCubic(Math.min(1, Math.max(0, linearProgress)));
  stage.innerHTML = renderSpinMarkup(ctx.games, ctx.winner, eased, cardH);
}

function finishSpinIfCurrent(ev) {
  if (
    !isChatRouletteActionCurrent(ev, {
      rouletteId: lastRouletteId,
      attemptId: lastAttemptId,
    }, { matchAttempt: true })
  ) {
    return;
  }
  presentEvent(ev, { forceResult: true });
}

function runSpinAnimation(ev, winner, games) {
  const stage = rootEl?.querySelector("[data-roulette-stage]");
  if (!stage || !winner) return;

  const start = ev.animationStartTimestamp || Date.now();
  const duration = ev.animationDurationMs || CHAT_ROULETTE_DURATION_MS;

  spinCtx = {
    rouletteId: ev.rouletteId,
    attemptId: ev.attemptId,
    start,
    duration,
    winner,
    games,
    cardH: DEFAULT_CARD_H,
  };
  bindResize();

  const already = chatRouletteSpinProgress(ev, Date.now());
  if (already >= 1) {
    finishSpinIfCurrent(ev);
    return;
  }

  clearTimers();
  applySpinFrame(spinCtx, already);

  const tick = () => {
    if (!rootEl || !spinCtx) return;
    if (
      !isChatRouletteActionCurrent(spinCtx, {
        rouletteId: lastRouletteId,
        attemptId: lastAttemptId,
      }, { matchAttempt: true })
    ) {
      return;
    }
    const linear = chatRouletteSpinProgress(
      {
        ...ev,
        animationStartTimestamp: spinCtx.start,
        animationDurationMs: spinCtx.duration,
      },
      Date.now()
    );
    applySpinFrame(spinCtx, linear);
    if (linear < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
      finishSpinIfCurrent(ev);
    }
  };

  rafId = requestAnimationFrame(tick);
  const remaining = Math.max(
    0,
    duration * (1 - already)
  );
  spinTimer = setTimeout(() => {
    finishSpinIfCurrent(ev);
  }, remaining + 40);
}

function bindRootOnce(root) {
  if (root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest("[data-roulette-dismiss]")) {
      if (handlers?.canControl?.()) handlers.onDismiss?.();
      else closeChatRouletteModal({ silent: true });
      return;
    }
    if (t.closest("[data-roulette-start]")) {
      handlers?.onStart?.();
      return;
    }
    if (t.closest("[data-roulette-reroll]")) {
      handlers?.onReroll?.();
      return;
    }
    if (t.closest("[data-roulette-bridge]")) {
      handlers?.onBridgePoll?.();
      return;
    }
    if (t.closest("[data-roulette-launch]")) {
      handlers?.onLaunch?.();
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (handlers?.canControl?.()) handlers.onDismiss?.();
    }
  });
}

function ensureRoot() {
  if (rootEl || typeof document === "undefined") return rootEl;
  rootEl = document.createElement("div");
  rootEl.className = "chat-roulette";
  rootEl.setAttribute("role", "dialog");
  rootEl.setAttribute("aria-modal", "true");
  rootEl.setAttribute("aria-label", "Jeu aléatoire");
  rootEl.innerHTML = `
    <div class="chat-roulette__backdrop" data-roulette-dismiss aria-hidden="true"></div>
    <div class="chat-roulette__panel" tabindex="-1">
      <button type="button" class="chat-roulette__close" data-roulette-dismiss aria-label="Fermer">✕</button>
      <p class="chat-roulette__icon" aria-hidden="true">🎲</p>
      <div class="chat-roulette__stage" data-roulette-stage></div>
    </div>`;
  document.body.appendChild(rootEl);
  bindRootOnce(rootEl);
  requestAnimationFrame(() => rootEl?.classList.add("chat-roulette--in"));
  rootEl.querySelector(".chat-roulette__panel")?.focus();
  return rootEl;
}

/**
 * Affiche / met à jour la modale selon l'événement sync.
 * @param {object|null} rawEvent
 * @param {{ forceResult?: boolean, now?: number }} [opts]
 */
export function presentChatRouletteEvent(rawEvent, opts = {}) {
  presentEvent(rawEvent, opts);
}

function presentEvent(rawEvent, { forceResult = false, blockingOpts = null, now = Date.now() } = {}) {
  const ev = normalizeChatRouletteEvent(rawEvent);
  const active = ev
    ? isChatRouletteBlockingLaunch({
        chatRoulette: ev,
        nowWallClock: now,
        ...(blockingOpts && typeof blockingOpts === "object" ? blockingOpts : {}),
      })
    : false;
  if (!ev || !active) {
    closeChatRouletteModal({ silent: true });
    return;
  }

  ensureRoot();
  if (!rootEl) return;

  const canControl = Boolean(handlers?.canControl?.());
  const games = resolveGames(ev);
  const winner = ev.selectedTileId
    ? handlers?.getCatalogById?.(ev.selectedTileId) ||
      games.find((g) => g.id === ev.selectedTileId) ||
      null
    : null;

  const showResult =
    forceResult ||
    ev.phase === "result" ||
    (ev.phase === "spinning" && chatRouletteShouldShowResult(ev, now));

  const phaseKey = `${ev.rouletteId}|${ev.attemptId}|${ev.phase}|${ev.selectedTileId || ""}|${ev.drawCount}|${showResult ? "R" : "A"}`;
  if (
    phaseKey === lastPhaseKey &&
    lastRouletteId === ev.rouletteId &&
    lastAttemptId === ev.attemptId &&
    !forceResult
  ) {
    return;
  }

  // Nouvel attempt → invalide callbacks de l’ancien spin
  if (
    lastAttemptId &&
    lastAttemptId !== ev.attemptId &&
    lastRouletteId === ev.rouletteId
  ) {
    clearTimers();
    spinCtx = null;
  }

  lastRouletteId = ev.rouletteId;
  lastAttemptId = ev.attemptId;
  lastPhaseKey = phaseKey;

  const stage = rootEl.querySelector("[data-roulette-stage]");
  if (!stage) return;

  if (ev.phase === "prompt") {
    clearTimers();
    spinCtx = null;
    unbindResize();
    stage.innerHTML = renderPrompt(canControl);
    return;
  }

  if (!winner) {
    stage.innerHTML = `<p class="hint">Roulette indisponible.</p>`;
    return;
  }

  if (showResult || games.length <= 1) {
    clearTimers();
    spinCtx = null;
    unbindResize();
    stage.innerHTML = renderResult(winner, ev, canControl);
    return;
  }

  if (ev.phase === "spinning") {
    runSpinAnimation(ev, winner, games);
  }
}

/** Exposé tests : identité UI courante. */
export function getChatRouletteUiIdentityForTests() {
  return {
    rouletteId: lastRouletteId,
    attemptId: lastAttemptId,
    spinning: Boolean(spinCtx),
  };
}
