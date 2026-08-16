import {
  getDrawItEntryScreen,
  getDrawItSession,
  commitDrawItReveal,
  commitDrawItNextRound,
  commitDrawItComplete,
  commitDrawItCompletedStroke,
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
import { mountDrawItCanvas } from "../core/drawItCanvas.js";
import {
  createDrawItBoardFromSession,
  maybeResetDrawItBoard,
} from "../core/drawItStrokes.js";
import { buildDrawItRoundRecap } from "../core/drawItRoundRecap.js";
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
  const liveRender = ({ delta }) => {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
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
      },
    });
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
      inputEl.disabled = locked;
      inputEl.placeholder = locked
        ? reason || "Propositions fermées"
        : "Propose un mot…";
    }
    if (sendEl) sendEl.disabled = locked;
    if (hintEl) {
      if (reason) {
        hintEl.hidden = false;
        hintEl.textContent = reason;
      } else {
        hintEl.hidden = true;
        hintEl.textContent = "";
      }
    }
  }

  function patchFoundLine(session) {
    const el = app.querySelector("#draw-it-found");
    if (!el) return;
    const found = Array.isArray(session.foundOrder) ? session.foundOrder : [];
    if (!found.length) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = `Trouvé : ${found
      .map((entry) => nameForUserId(entry.uid) || "Joueur")
      .join(", ")}`;
  }

  function patchDrawerWord(session) {
    if (!isLocalDrawer(session) || !privateWord) return;
    const el = app.querySelector("#draw-it-word");
    if (el) el.textContent = privateWord;
  }

  function patchDrawingLive(session) {
    if (!mount.isMounted() || !mount.isCurrentMount()) return;
    if (!hasStableGuessComposer()) {
      render();
      return;
    }
    syncActiveDrawItLiveSession(session);
    board = maybeResetDrawItBoard(board, session);
    chatPanel.refresh();
    applyGuessInputLock(session);
    patchFoundLine(session);
    const clock = app.querySelector("#draw-it-clock");
    if (clock) {
      clock.textContent = formatDrawItCountdown(
        remainingMsUntil(session.roundEndsAt, drawItSyncedNowMs(session))
      );
    }
    canvasCtl?.syncInteractive();
    canvasCtl?.paint();
    rememberPlayIdentity(session);
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
    if (!found.length) {
      return `<p class="hint" id="draw-it-found" hidden></p>`;
    }
    const names = found
      .map((entry) => nameForUserId(entry.uid) || "Joueur")
      .map((name) => escapeHtml(name));
    return `<p class="hint" id="draw-it-found">Trouvé : ${names.join(", ")}</p>`;
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

  function roundRecapDrawingHtml(session) {
    if (isLocalDrawer(session)) {
      return `
        <div class="draw-it-canvas-host draw-it-recap__canvas" id="draw-it-canvas-host"></div>
        <p class="hint">Dessin disponible localement sur l’appareil du dessinateur.</p>`;
    }
    return `
      <div class="draw-it-recap__drawing-placeholder" role="img"
        aria-label="Dessin indisponible sur cet appareil">
        <span aria-hidden="true">🖼️</span>
        <p>Dessin indisponible sur cet appareil.</p>
        <small>Il sera partagé ici lorsque la synchronisation du dessin sera disponible.</small>
      </div>`;
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
    const session = getDrawItSession();
    syncActiveDrawItLiveSession(session);
    if (!session.lobbyStarted) {
      navigate(getDrawItEntryScreen());
      return;
    }

    const total = Number(session.roundCount) || 0;
    const roundIdx = session.roundIdx ?? 0;
    const phase = session.phase;
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
          ${roundRecapDrawingHtml(session)}
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
    if (
      phase === DRAW_IT_PHASE_DRAWING ||
      (phase === DRAW_IT_PHASE_REVEAL && drawer)
    ) {
      bindCanvas(session);
    }
    bindGuessChat(session);
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
    if (canKeepDrawItGuessComposer(lastPlayIdentity, session) && hasStableGuessComposer()) {
      patchDrawingLive(session);
      void refreshPrivateWord(session).then(() => {
        if (!mount.isMounted() || !mount.isCurrentMount()) return;
        const live = getDrawItSession();
        if (!canKeepDrawItGuessComposer(lastPlayIdentity, live) || !hasStableGuessComposer()) {
          render();
          return;
        }
        patchDrawerWord(live);
        patchDrawingLive(live);
      });
      return;
    }
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
