import {
  getDrawItEntryScreen,
  getDrawItSession,
  commitDrawItReveal,
  commitDrawItNextRound,
  commitDrawItComplete,
  commitDrawItCompletedStroke,
  commitDrawItUndoStroke,
  commitDrawItClearCanvas,
  loadLocalDrawItPrivateWord,
  submitDrawItGuess,
} from "../core/drawItSession.js";
import {
  DRAW_IT_PHASE_DRAWING,
  DRAW_IT_PHASE_REVEAL,
  formatDrawItCountdown,
  remainingMsUntil,
  canCommitDrawItReveal,
  drawItSyncedNowMs,
} from "../core/drawItRound.js";
import {
  canKeepDrawItGuessComposer,
  drawItGuessesToChatMessages,
  isDrawItGuessInputLocked,
  isUidInDrawItFoundOrder,
} from "../core/drawItGuesses.js";
import { mountChatPanel, CHAT_MAX_LENGTH } from "../core/chatPanel.js";
import { getLocalDisplayName, getState, setLastGame } from "../core/state.js";
import { getSupabaseUserId } from "../core/supabaseAuth.js";
import { setLobbyPlaying, setLobbyWaiting } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { withClickLock } from "../core/actionLock.js";
import { createMountGuard } from "../core/mountLifecycle.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "../screens/nav.js";
import { gameExitBarHtml, bindExitGame } from "../core/exitGame.js";
import {
  isGameSyncActive,
  canActAsHost,
  onGameSessionChange,
  nameForUserId,
  stopGameSessionListenerOnPostGame,
} from "../core/gameSync.js";
import { mountDrawItCanvas, mountDrawItReplayCanvas } from "../core/drawItCanvas.js";
import {
  applyDrawItBoardClear,
  applyDrawItBoardUndo,
  createDrawItBoardFromSession,
  createDrawItBrush,
  createDrawItRecapBoardFromSession,
  DRAW_IT_TOOL_COLORS,
  DRAW_IT_TOOL_WIDTHS,
  maybeResetDrawItBoard,
  undoLastCompletedDrawItStroke,
} from "../core/drawItStrokes.js";
import {
  buildDrawItRoundRecap,
  canKeepDrawItRecapCanvas,
} from "../core/drawItRoundRecap.js";
import { buildDrawItStandings } from "../core/drawItScoring.js";
import { serializeLastGameStandings } from "../core/lastGamePodium.js";
import { getSortedActivePlayers } from "../core/players.js";
import {
  activateDrawItLive,
  bufferDrawItLivePoints,
  createDrawItLiveStrokeId,
  detachDrawItLiveRenderer,
  endDrawItLiveStroke,
  getDrawItLiveState,
  startDrawItLiveStroke,
  syncActiveDrawItLiveSession,
  teardownDrawItLive,
} from "../core/drawItLive.js";

export function mountDrawIt(app) {
  if (!requireLobbyPlay()) return null;

  const entry = getDrawItEntryScreen();
  if (entry !== "drawit") {
    navigate(entry);
    return null;
  }

  void setLobbyPlaying("drawit").catch(() => {});

  const mount = createMountGuard();
  const mp = isGameSyncActive();
  let privateWord = null;
  let tickId = 0;
  let chatPanel = null;
  let canvasCtl = null;
  let board = createDrawItBoardFromSession(getDrawItSession());
  let lastPlayIdentity = null;
  let deferredDrawingRender = false;
  let lastDebugInput = null;
  let debugPatchSeq = 0;
  let brush = createDrawItBrush();
  const liveRender = ({ delta }) => {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    if (
      canvasCtl?.isReadOnly?.() ||
      getDrawItSession().phase === DRAW_IT_PHASE_REVEAL
    ) {
      return;
    }
    if (delta?.action === "undo" && delta.strokeId) {
      board = applyDrawItBoardUndo(board, delta.strokeId);
    } else if (delta?.action === "clear") {
      board = applyDrawItBoardClear(board, delta.canvasEpoch);
    }
    canvasCtl?.applyLiveDelta(delta);
  };

  function localUid() {
    return getSupabaseUserId() || null;
  }

  function isLocalDrawer(session) {
    const uid = localUid();
    if (uid && session.drawerUid) return uid === session.drawerUid;
    const name = getLocalDisplayName();
    const drawerName = nameForUserId(session.drawerUid);
    return Boolean(name && drawerName && name === drawerName);
  }

  function stopTick() {
    if (tickId) {
      clearInterval(tickId);
      tickId = 0;
    }
  }

  function teardownChat() {
    debugGuessFocus("teardownChat");
    chatPanel?.cleanup();
    chatPanel = null;
  }

  function teardownCanvas() {
    canvasCtl?.cleanup();
    canvasCtl = null;
  }

  function bindCanvas(session) {
    teardownCanvas();
    board = maybeResetDrawItBoard(board, session);
    const host = app.querySelector("#draw-it-canvas-host");
    if (!host) return;
    canvasCtl = mountDrawItCanvas(host, {
      getBoard: () => board,
      setBoard: (next) => {
        board = next;
      },
      getSession: getDrawItSession,
      getLocalUid: localUid,
      nowMs: () => drawItSyncedNowMs(getDrawItSession()),
      getLiveState: getDrawItLiveState,
      createStrokeId: () => createDrawItLiveStrokeId(localUid()),
      onStrokeStart: (stroke) => {
        startDrawItLiveStroke(stroke);
        syncToolButtons();
      },
      onStrokePoints: (strokeId, points) => {
        bufferDrawItLivePoints(strokeId, points);
      },
      onStrokeEnd: (stroke, finalPoints) => {
        void endDrawItLiveStroke(stroke, finalPoints).finally(() => {
          if (
            deferredDrawingRender &&
            mount.isMounted() &&
            mount.isCurrentMount()
          ) {
            deferredDrawingRender = false;
            render();
          }
        });
        void commitDrawItCompletedStroke(stroke);
        syncToolButtons();
      },
      getBrush: () => brush,
      onDrawingChange: () => {
        syncToolButtons();
      },
    });
  }

  function bindRecapCanvas(session) {
    teardownCanvas();
    board = createDrawItRecapBoardFromSession(session);
    const host = app.querySelector("#draw-it-canvas-host");
    if (!host) return;
    canvasCtl = mountDrawItReplayCanvas(host, {
      getBoard: () => board,
    });
  }

  function hasStableRecapCanvas() {
    return Boolean(
      app.querySelector("#draw-it-canvas-host") && canvasCtl?.isReadOnly?.()
    );
  }

  function patchRecapView(session) {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    if (!hasStableRecapCanvas()) {
      render();
      return;
    }
    board = createDrawItRecapBoardFromSession(session);
    if (typeof canvasCtl?.applyBoard === "function") canvasCtl.applyBoard();
    else canvasCtl?.paint?.();
    const ranking = app.querySelector("#draw-it-round-ranking");
    if (ranking) ranking.innerHTML = roundRecapRowsHtml(session);
    rememberPlayIdentity(session);
  }

  function guessLockReason(session, nowMs = drawItSyncedNowMs(session)) {
    if (session.phase !== DRAW_IT_PHASE_DRAWING) return "Les propositions sont fermées.";
    if (isLocalDrawer(session)) return "Le dessinateur ne propose pas.";
    if (isUidInDrawItFoundOrder(session.foundOrder, localUid())) {
      return "Tu as trouvé ! Tu peux encore lire les propositions.";
    }
    if (isDrawItGuessInputLocked(session, localUid(), nowMs)) {
      return "Les propositions sont fermées.";
    }
    return "";
  }

  function isGuessFocusDebug() {
    try {
      return sessionStorage.getItem("drawit-focus-debug") === "1";
    } catch {
      return false;
    }
  }

  function debugGuessFocus(label, extra = {}) {
    if (!isGuessFocusDebug()) return;
    const input = app.querySelector("#draw-it-guess-input");
    debugPatchSeq += 1;
    console.info("[drawit-focus]", debugPatchSeq, label, {
      activeId: document.activeElement?.id || document.activeElement?.tagName || null,
      activeIsInput: document.activeElement === input,
      inputIsConnected: input?.isConnected ?? null,
      inputSameNode: lastDebugInput ? lastDebugInput === input : null,
      inputDisabled: input?.disabled ?? null,
      canKeep: extra.canKeep,
      ...extra,
    });
    lastDebugInput = input || lastDebugInput;
  }

  function buildGuessMsgNode(message) {
    const row = document.createElement("div");
    row.className = "chat-msg";
    const from = document.createElement("span");
    from.className = "chat-msg__from";
    from.textContent = message?.from || "Joueur";
    const text = document.createElement("span");
    text.className = "chat-msg__text";
    text.textContent = message?.text || "";
    row.appendChild(from);
    row.appendChild(text);
    return row;
  }

  function syncGuessFeedDom(session) {
    const messagesEl = app.querySelector("#draw-it-guess-messages");
    if (!messagesEl) return false;
    const messages = drawItGuessesToChatMessages(session.guesses, (uid) => {
      return nameForUserId(uid) || "Joueur";
    });
    const nodes = messagesEl.querySelectorAll(":scope > .chat-msg");
    let prefixOk =
      nodes.length > 0 &&
      messages.length >= nodes.length &&
      !messagesEl.querySelector(":scope > .chat-empty");
    if (prefixOk) {
      for (let i = 0; i < nodes.length; i += 1) {
        const from = nodes[i].querySelector(".chat-msg__from")?.textContent;
        const text = nodes[i].querySelector(".chat-msg__text")?.textContent;
        if (from !== messages[i].from || text !== messages[i].text) {
          prefixOk = false;
          break;
        }
      }
    }
    if (prefixOk && messages.length === nodes.length) return false;
    if (prefixOk) {
      for (let i = nodes.length; i < messages.length; i += 1) {
        messagesEl.appendChild(buildGuessMsgNode(messages[i]));
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return true;
    }
    const empty = messagesEl.querySelector(":scope > .chat-empty");
    if (empty && messages.length && !nodes.length) {
      empty.remove();
      for (const message of messages) {
        messagesEl.appendChild(buildGuessMsgNode(message));
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return true;
    }
    const frag = document.createDocumentFragment();
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "chat-empty";
      empty.textContent = "Aucun message pour l'instant.";
      frag.appendChild(empty);
    } else {
      for (const message of messages) frag.appendChild(buildGuessMsgNode(message));
    }
    messagesEl.replaceChildren(frag);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return true;
  }

  function rememberPlayIdentity(session) {
    lastPlayIdentity = {
      runId: session?.runId || null,
      roundIdx: Number(session?.roundIdx) || 0,
      canvasEpoch: Number(session?.canvasEpoch) || 0,
      drawerUid: session?.drawerUid || null,
      phase: session?.phase || null,
    };
  }

  function hasStableGuessComposer() {
    return Boolean(chatPanel && app.querySelector("#draw-it-guess-input"));
  }

  function applyGuessInputLock(session) {
    const nowMs = drawItSyncedNowMs(session);
    const locked = isDrawItGuessInputLocked(session, localUid(), nowMs);
    const reason = guessLockReason(session, nowMs);
    const inputEl = app.querySelector("#draw-it-guess-input");
    const sendEl = app.querySelector("#draw-it-guess-send");
    const hintEl = app.querySelector("#draw-it-guess-hint");
    if (inputEl) {
      if (inputEl.disabled !== locked) inputEl.disabled = locked;
      const nextPlaceholder = locked
        ? reason || "Propositions fermées"
        : "Propose un mot…";
      if (inputEl.placeholder !== nextPlaceholder) {
        inputEl.placeholder = nextPlaceholder;
      }
    }
    if (sendEl && sendEl.disabled !== locked) sendEl.disabled = locked;
    if (hintEl) {
      const hide = !reason;
      if (hintEl.hidden !== hide) hintEl.hidden = hide;
      const nextHint = reason || "";
      if (hintEl.textContent !== nextHint) hintEl.textContent = nextHint;
    }
  }

  function patchFoundLine(session) {
    const el = app.querySelector("#draw-it-found");
    if (!el) return;
    const found = Array.isArray(session.foundOrder) ? session.foundOrder : [];
    const next = found.length
      ? `Trouvé : ${found
          .map((entry) => nameForUserId(entry.uid) || "Joueur")
          .join(", ")}`
      : "";
    if (el.textContent !== next) el.textContent = next;
  }

  function patchDrawerWord(session) {
    if (!isLocalDrawer(session) || !privateWord) return;
    const el = app.querySelector("#draw-it-word");
    if (el) el.textContent = privateWord;
  }

  function patchDrawingLive(session) {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    const inputBefore = app.querySelector("#draw-it-guess-input");
    debugGuessFocus("patch:before", {
      canKeep: canKeepDrawItGuessComposer(lastPlayIdentity, session),
      guesses: (session.guesses || []).length,
      found: (session.foundOrder || []).length,
    });
    if (!hasStableGuessComposer()) {
      debugGuessFocus("patch:fallback-render", { reason: "no-composer" });
      render();
      return;
    }
    syncActiveDrawItLiveSession(session);
    const previousBoard = board;
    board = maybeResetDrawItBoard(board, session);
    syncGuessFeedDom(session);
    applyGuessInputLock(session);
    patchFoundLine(session);
    const clock = app.querySelector("#draw-it-clock");
    if (clock) {
      const nextClock = formatDrawItCountdown(
        remainingMsUntil(session.roundEndsAt, drawItSyncedNowMs(session))
      );
      if (clock.textContent !== nextClock) clock.textContent = nextClock;
    }
    canvasCtl?.syncInteractive();
    if (board !== previousBoard)     canvasCtl?.paint();
    rememberPlayIdentity(session);
    syncToolButtons();
    const inputAfter = app.querySelector("#draw-it-guess-input");
    debugGuessFocus("patch:after", {
      inputSameNode: Boolean(inputBefore && inputBefore === inputAfter),
      stillFocused: document.activeElement === inputAfter,
    });
  }

  function bindGuessChat(session) {
    teardownChat();
    const messagesEl = app.querySelector("#draw-it-guess-messages");
    const inputEl = app.querySelector("#draw-it-guess-input");
    const sendEl = app.querySelector("#draw-it-guess-send");
    if (!messagesEl || !inputEl || !sendEl) return;

    chatPanel = mountChatPanel(app, {
      messagesEl,
      inputEl,
      sendEl,
      getMessages: () =>
        drawItGuessesToChatMessages(getDrawItSession().guesses, (uid) => {
          return nameForUserId(uid) || "Joueur";
        }),
      sendMessage: async (text) => {
        const result = await submitDrawItGuess(text, {
          nowMs: drawItSyncedNowMs(getDrawItSession()),
        });
        if (!result?.ok) {
          throw new Error(result?.reason || "guess_failed");
        }
      },
      onAfterSend: () => {
        if (!mount.isMounted() || !mount.isCurrentMount()) return;
        chatPanel?.refresh();
        applyGuessInputLock(getDrawItSession());
      },
    });
    applyGuessInputLock(session);
  }

  async function refreshPrivateWord(session) {
    if (session.phase !== DRAW_IT_PHASE_DRAWING || !isLocalDrawer(session)) {
      privateWord = null;
      return;
    }
    const row = await loadLocalDrawItPrivateWord();
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    privateWord = row?.wordLabel || null;
  }

  function drawerLabel(session) {
    const name = nameForUserId(session.drawerUid);
    if (name) return name;
    return isLocalDrawer(session) ? getLocalDisplayName() : "un joueur";
  }

  function foundLine(session) {
    const found = Array.isArray(session.foundOrder) ? session.foundOrder : [];
    const names = found
      .map((entry) => nameForUserId(entry.uid) || "Joueur")
      .map((name) => escapeHtml(name));
    const text = names.length ? `Trouvé : ${names.join(", ")}` : "";
    return `<p class="hint draw-it-found-line" id="draw-it-found">${text}</p>`;
  }

  function roundRecapRowsHtml(session) {
    const recap = buildDrawItRoundRecap(session);
    return recap.rows
      .map((row) => {
        const marker =
          row.role === "drawer"
            ? "✏️"
            : row.found
              ? `${row.rank}.`
              : "—";
        const result =
          row.role === "drawer"
            ? "Dessinateur"
            : row.found
              ? "A trouvé"
              : "N’a pas trouvé";
        const points = Number(row.pointsDelta) || 0;
        const pointsLabel = `${points > 0 ? "+" : ""}${points} pt${Math.abs(points) > 1 ? "s" : ""}`;
        return `
          <li class="draw-it-recap__row" data-role="${row.role}" data-found="${row.found}">
            <span class="draw-it-recap__rank">${marker}</span>
            <span class="draw-it-recap__player">${escapeHtml(row.name)}</span>
            <span class="draw-it-recap__result">${result}</span>
            <span class="draw-it-recap__points">${pointsLabel}</span>
          </li>`;
      })
      .join("");
  }

  function roundRecapDrawingHtml() {
    return `
      <div class="draw-it-canvas-host draw-it-recap__canvas" id="draw-it-canvas-host"
        data-readonly="true"></div>`;
  }

  function toolsBusy() {
    return Boolean(canvasCtl?.isDrawing() || board?.currentStroke);
  }

  function syncToolButtons() {
    const root = app.querySelector("#draw-it-tools");
    if (!root) return;
    const busy = toolsBusy();
    root.querySelectorAll("[data-color]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-color") === brush.color);
      btn.disabled = busy;
    });
    root.querySelectorAll("[data-width]").forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.getAttribute("data-width")) === brush.width);
      btn.disabled = busy;
    });
    const undoEl = root.querySelector("#draw-it-undo");
    const clearEl = root.querySelector("#draw-it-clear");
    if (undoEl) undoEl.disabled = busy || !(board.strokes || []).length;
    if (clearEl) clearEl.disabled = busy || !(board.strokes || []).length;
  }

  function toolsHtml(session) {
    if (session.phase !== DRAW_IT_PHASE_DRAWING || !isLocalDrawer(session)) {
      return "";
    }
    const colors = DRAW_IT_TOOL_COLORS.map(
      (entry) => `
        <button type="button" class="draw-it-swatch${
          entry.value === brush.color ? " is-active" : ""
        }" data-color="${escapeHtml(entry.value)}" style="background:${escapeHtml(entry.value)}"
          aria-label="${escapeHtml(entry.label)}" title="${escapeHtml(entry.label)}"></button>`
    ).join("");
    const widths = DRAW_IT_TOOL_WIDTHS.map(
      (entry) => `
        <button type="button" class="draw-it-width${
          entry.value === brush.width ? " is-active" : ""
        }" data-width="${entry.value}">${escapeHtml(entry.label)}</button>`
    ).join("");
    return `
      <div class="draw-it-tools" id="draw-it-tools">
        <div class="draw-it-tools__row" role="group" aria-label="Couleur">${colors}</div>
        <div class="draw-it-tools__row" role="group" aria-label="Épaisseur">${widths}</div>
        <div class="draw-it-tools__row draw-it-tools__actions">
          <button type="button" class="btn btn-ghost draw-it-tools__btn" id="draw-it-undo">Undo</button>
          <button type="button" class="btn btn-ghost draw-it-tools__btn" id="draw-it-clear">Clear</button>
        </div>
      </div>`;
  }

  function bindTools() {
    const root = app.querySelector("#draw-it-tools");
    if (!root) return;
    root.addEventListener("click", (event) => {
      const target = event.target?.closest?.("button");
      if (!target || !root.contains(target)) return;
      event.preventDefault();
      if (!isLocalDrawer(getDrawItSession())) return;
      if (target.id === "draw-it-undo") {
        if (toolsBusy() || !(board.strokes || []).length) return;
        const last = board.strokes[board.strokes.length - 1];
        board = undoLastCompletedDrawItStroke(board);
        canvasCtl?.paint();
        syncToolButtons();
        if (last?.strokeId) void commitDrawItUndoStroke(last.strokeId);
        return;
      }
      if (target.id === "draw-it-clear") {
        if (toolsBusy()) return;
        const nextEpoch = (Number(board.canvasEpoch) || 0) + 1;
        board = applyDrawItBoardClear(board, nextEpoch);
        canvasCtl?.paint();
        syncToolButtons();
        void commitDrawItClearCanvas();
        return;
      }
      if (toolsBusy()) return;
      if (target.hasAttribute("data-color")) {
        brush = createDrawItBrush({
          color: target.getAttribute("data-color"),
          width: brush.width,
        });
        syncToolButtons();
        return;
      }
      if (target.hasAttribute("data-width")) {
        brush = createDrawItBrush({
          color: brush.color,
          width: Number(target.getAttribute("data-width")),
        });
        syncToolButtons();
      }
    });
    syncToolButtons();
  }

  function guessChatHtml(session) {
    const nowMs = drawItSyncedNowMs(session);
    const locked = isDrawItGuessInputLocked(session, localUid(), nowMs);
    const hint = guessLockReason(session, nowMs);
    return `
      <div class="card draw-it-guess">
        <p class="label-upper">Propositions</p>
        <div class="chat-messages" id="draw-it-guess-messages"></div>
        <div class="chat-box">
          <input type="text" class="chat-box__input" id="draw-it-guess-input"
            placeholder="${escapeHtml(locked ? hint || "Propositions fermées" : "Propose un mot…")}"
            maxlength="${CHAT_MAX_LENGTH}" autocomplete="off" ${locked ? "disabled" : ""} />
          <button type="button" class="chat-box__send" id="draw-it-guess-send"
            aria-label="Envoyer" ${locked ? "disabled" : ""}>➤</button>
        </div>
        <p class="hint" id="draw-it-guess-hint"${hint ? "" : " hidden"}>${
          hint ? escapeHtml(hint) : ""
        }</p>
      </div>`;
  }

  function render() {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    debugGuessFocus("render:start");
    const session = getDrawItSession();
    syncActiveDrawItLiveSession(session);
    if (!session.lobbyStarted) {
      navigate(getDrawItEntryScreen());
      return;
    }

    const total = Number(session.roundCount) || 0;
    const roundIdx = session.roundIdx ?? 0;
    const phase = session.phase;
    if (
      lastPlayIdentity &&
      (lastPlayIdentity.runId !== (session.runId || null) ||
        Number(lastPlayIdentity.roundIdx) !== Number(roundIdx))
    ) {
      brush = createDrawItBrush();
    }
    const remaining = remainingMsUntil(
      session.roundEndsAt,
      drawItSyncedNowMs(session)
    );
    const clock = formatDrawItCountdown(remaining);
    const host = !mp || canActAsHost();
    const drawer = isLocalDrawer(session);
    const drawerName = drawerLabel(session);

    let phaseHtml = "";
    if (phase === DRAW_IT_PHASE_DRAWING) {
      const wordBlock = drawer
        ? `<p class="hot-take-text" id="draw-it-word">${escapeHtml(privateWord || "…")}</p>
           <p class="hint">Toi seul vois ce mot. Dessine-le.</p>`
        : `<p class="hot-take-text" id="draw-it-word">✏️ ${escapeHtml(drawerName)} dessine…</p>
           <p class="hint">Le mot est secret jusqu'à la fin des 60 secondes.</p>`;
      phaseHtml = `
        <div class="card">
          <p class="label-upper label-upper--gold">Manche ${roundIdx + 1}</p>
          ${wordBlock}
          <p class="hot-take-duration" id="draw-it-clock" aria-live="polite">${clock}</p>
          <div class="draw-it-canvas-host" id="draw-it-canvas-host"></div>
          ${toolsHtml(session)}
          ${foundLine(session)}
        </div>`;
    } else if (phase === DRAW_IT_PHASE_REVEAL) {
      const recap = buildDrawItRoundRecap(session);
      const word = recap.wordLabel;
      const last = roundIdx >= total - 1;
      phaseHtml = `
        <div class="card draw-it-recap">
          <p class="label-upper label-upper--gold">Récapitulatif de la manche</p>
          <p class="hot-take-text">${escapeHtml(word || "—")}</p>
          <p class="hint">${
            recap.allGuessersFound ? "Tout le monde a trouvé !" : "Temps écoulé."
          } Le mot est maintenant public.</p>
          <p class="label-upper">Dessin de la manche</p>
          ${roundRecapDrawingHtml()}
          <p class="label-upper draw-it-recap__ranking-title">Résultat de la manche</p>
          <ol class="draw-it-recap__ranking" id="draw-it-round-ranking">
            ${roundRecapRowsHtml(session)}
          </ol>
        </div>
        ${
          host
            ? `<button type="button" class="btn btn-primary btn--spaced" id="draw-it-advance">
                ${last ? "Voir les résultats →" : "Manche suivante →"}
              </button>`
            : `<p class="hint">En attente de l'hôte…</p>`
        }`;
    }

    teardownChat();
    teardownCanvas();
    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <div class="game-header">
          <div class="dots">${Array.from({ length: total }, (_, i) =>
            `<span class="dot ${i === roundIdx ? "dot--active" : i < roundIdx ? "dot--done" : ""}"></span>`
          ).join("")}</div>
          <span class="muted">${roundIdx + 1}/${total}</span>
        </div>
        <p class="label-upper label-upper--gold">✏️ Draw it !</p>
        ${phaseHtml}
        ${guessChatHtml(session)}
        ${gameExitBarHtml()}
      `,
    });

    bindNav(app);
    bindExitGame(app, { shouldContinue: () => mount.isMounted() });
    if (phase === DRAW_IT_PHASE_DRAWING) {
      bindCanvas(session);
    } else if (phase === DRAW_IT_PHASE_REVEAL) {
      bindRecapCanvas(session);
    }
    bindGuessChat(session);
    bindTools();
    rememberPlayIdentity(session);

    app.querySelector("#draw-it-advance")?.addEventListener(
      "click",
      withClickLock(async () => {
        const live = getDrawItSession();
        if (live.roundIdx >= (Number(live.roundCount) || 0) - 1) {
          setLastGame({
            gameId: "drawit",
            title: "Draw it !",
            summary: `${live.roundCount} manches`,
            standings: serializeLastGameStandings(
              buildDrawItStandings(live, getSortedActivePlayers())
            ),
          });
          const done = await commitDrawItComplete();
          if (done?.ok === false) return;
          if (!mp) {
            setLobbyWaiting();
            if (!mount.isMounted()) return;
            navigate("results", { navStack: ["home", "lobby", "game-select", "results"] });
          }
          return;
        }
        await commitDrawItNextRound();
        if (!mount.isMounted() || !mount.isCurrentMount()) return;
        await refreshPrivateWord(getDrawItSession());
        render();
      })
    );
  }

  function startTick() {
    stopTick();
    tickId = setInterval(() => {
      if (!mount.isMounted() || !mount.isCurrentMount()) {
        stopTick();
        return;
      }
      const session = getDrawItSession();
      if (session.phase !== DRAW_IT_PHASE_DRAWING) return;
      const nowMs = drawItSyncedNowMs(session);
      const clock = app.querySelector("#draw-it-clock");
      if (clock) {
        clock.textContent = formatDrawItCountdown(
          remainingMsUntil(session.roundEndsAt, nowMs)
        );
      }
      applyGuessInputLock(session);
      canvasCtl?.syncInteractive();
      if ((!mp || canActAsHost()) && canCommitDrawItReveal(session, nowMs).ok) {
        void commitDrawItReveal({ nowMs }).then(() => {
          if (!mount.isMounted() || !mount.isCurrentMount()) return;
          render();
        });
      }
    }, 250);
  }

  const unsub = onGameSessionChange((row) => {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    if (stopGameSessionListenerOnPostGame(row)) {
      teardownDrawItLive();
      return;
    }
    const session = getDrawItSession();
    syncActiveDrawItLiveSession(session);
    if (session.phase === DRAW_IT_PHASE_REVEAL) {
      if (
        canKeepDrawItRecapCanvas(lastPlayIdentity, session) &&
        hasStableRecapCanvas()
      ) {
        patchRecapView(session);
        return;
      }
      render();
      return;
    }
    const previousBoard = board;
    board = maybeResetDrawItBoard(board, session);
    const sameRound =
      previousBoard.runId === board.runId &&
      Number(previousBoard.roundIdx) === Number(board.roundIdx) &&
      Number(previousBoard.canvasEpoch) === Number(board.canvasEpoch);
    if (
      sameRound &&
      session.phase === DRAW_IT_PHASE_DRAWING &&
      canvasCtl?.isDrawing()
    ) {
      deferredDrawingRender = true;
      patchDrawingLive(session);
      return;
    }
    const keepComposer =
      canKeepDrawItGuessComposer(lastPlayIdentity, session) && hasStableGuessComposer();
    debugGuessFocus("session-change", {
      canKeep: canKeepDrawItGuessComposer(lastPlayIdentity, session),
      keepComposer,
      lastPhase: lastPlayIdentity?.phase || null,
      phase: session.phase,
      lastRun: lastPlayIdentity?.runId || null,
      run: session.runId || null,
      lastRound: lastPlayIdentity?.roundIdx,
      round: session.roundIdx,
      lastEpoch: lastPlayIdentity?.canvasEpoch,
      epoch: session.canvasEpoch,
      lastDrawer: lastPlayIdentity?.drawerUid || null,
      drawer: session.drawerUid || null,
    });
    if (keepComposer) {
      patchDrawingLive(session);
      if (!isLocalDrawer(session)) return;
      void refreshPrivateWord(session).then(() => {
        if (!mount.isMounted() || !mount.isCurrentMount()) return;
        const live = getDrawItSession();
        if (!canKeepDrawItGuessComposer(lastPlayIdentity, live) || !hasStableGuessComposer()) {
          debugGuessFocus("private-word:full-render");
          render();
          return;
        }
        patchDrawerWord(live);
      });
      return;
    }
    debugGuessFocus("session-change:full-render");
    // Le nouveau roundIdx/timer est rendu immédiatement ; le mot privé du
    // nouveau drawer peut arriver ensuite sans retarder le countdown.
    render();
    void refreshPrivateWord(session).then(() => {
      if (!mount.isMounted() || !mount.isCurrentMount()) return;
      if (
        getDrawItSession().phase === DRAW_IT_PHASE_DRAWING &&
        canvasCtl?.isDrawing()
      ) {
        deferredDrawingRender = true;
        return;
      }
      const live = getDrawItSession();
      if (canKeepDrawItGuessComposer(lastPlayIdentity, live) && hasStableGuessComposer()) {
        patchDrawerWord(live);
        patchDrawingLive(live);
        return;
      }
      render();
    });
  });

  activateDrawItLive({
    lobbyId: getState().lobby?.id,
    getSession: getDrawItSession,
    getLocalUid: localUid,
    onRender: liveRender,
  });

  void refreshPrivateWord(getDrawItSession()).then(() => {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    render();
    startTick();
  });

  return () => {
    stopTick();
    teardownChat();
    teardownCanvas();
    unsub();
    detachDrawItLiveRenderer(liveRender);
    mount.dispose();
  };
}
