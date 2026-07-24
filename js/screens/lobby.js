import {
  getLobby,
  getLobbyParticipants,
  getLobbyMessages,
  getReadyCount,
  toggleLocalReady,
  simulateLobbyJoins,
  addLobbyMessage,
  getLobbyStatus,
  MAX_PLAYERS,
  createLobby,
  hasActiveLobby,
  reconcileLobbyReadyOnMount,
  goToGameSelect,
  allLobbyMembersReady,
  isLobbyEveningStarted,
  resetAppToCleanHome,
  kickLobbyMember,
  canManageLobbyRoster,
} from "../core/lobby.js";
import { canCreateLobby, updateProfileEmoji } from "../core/auth.js";
import { getLocalEmoji } from "../core/state.js";
import { isSupabaseConfigured } from "../core/supabaseClient.js";
import { onLobbyBundleUpdated } from "../core/supabaseLobby.js";
import {
  isGameSyncActive,
  isLobbyHost,
  startGameSession,
  startMultiplayerSync,
  routeToActiveGameIfNeeded,
  onGameSessionChange,
  getEffectiveSessionScreen,
  isActiveGameSessionScreen,
  isOnGameSetupScreen,
  refreshGameSession,
} from "../core/gameSync.js";
import { navigate, getCurrentScreen } from "../core/router.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { showAppAlert, showAppConfirm, showEmojiPickerDialog } from "../core/dialog.js";
import { getLobbyAutoCloseHint } from "../config/lobbyLifecycle.js";
import {
  getResumableSessionScreen,
  mountGameResumeInterstitial,
} from "../core/gameResume.js";

function participantsHtml(participants, { canKick = false, hostId = null } = {}) {
  return participants
    .map((p) => {
      const isHost = Boolean(
        (hostId && p.userId && p.userId === hostId) || (!hostId && p.isHost)
      );
      const inner = `
        ${p.emoji}
        ${p.ready ? '<span class="participant__check">✓</span>' : ""}`;
      const avatar = p.isLocal
        ? `<button type="button" class="participant__avatar participant__avatar--editable" style="background:${p.color}" data-edit-emoji aria-label="Changer mon emoji" title="Changer mon emoji">
        ${inner}
        <span class="participant__edit" aria-hidden="true">✎</span>
      </button>`
        : `<div class="participant__avatar" style="background:${p.color}">
        ${inner}
      </div>`;
      const kickable = canKick && p.userId && !p.isLocal && !isHost;
      const kickBtn = kickable
        ? `<button type="button" class="participant__kick" data-kick-user="${escapeHtml(p.userId)}" data-kick-name="${escapeHtml(p.name)}" aria-label="Retirer ${escapeHtml(p.name)}">Retirer</button>`
        : "";
      return `
    <div class="participant ${p.ready ? "participant--ready" : ""}">
      ${avatar}
      <span class="participant__name">${escapeHtml(p.name)}</span>
      ${kickBtn}
    </div>`;
    })
    .join("");
}

const LABEL_BE_READY = 'Soyez « prêt »';
const LABEL_WAITING_LAUNCH = "En attente de lancement de la partie";
const LABEL_WAITING_ALL_READY = "En attente que tous soient prêts";
const LABEL_WAITING_HOST_START = "L'hôte va lancer la soirée…";

function lobbyFooterHint(ready, total) {
  if (total > 0 && ready === total) return "Tout le monde est prêt !";
  return "En attente de validation du « Prêt »";
}

function hostStartLabel(allReady, localReady) {
  if (allReady) return "Commencer la soirée";
  if (!localReady) return LABEL_BE_READY;
  return LABEL_WAITING_ALL_READY;
}

function guestStartLabel(allReady, localReady) {
  if (allReady) return LABEL_WAITING_HOST_START;
  if (!localReady) return LABEL_BE_READY;
  return LABEL_WAITING_LAUNCH;
}

function getLobbyStartLabel({ isHost, allReady, localReady }) {
  return isHost ? hostStartLabel(allReady, localReady) : guestStartLabel(allReady, localReady);
}

export function mountLobby(app) {
  if (!requireLobbyPlay()) return null;

  let cleanupResume = () => {};
  let lobbyMode = "normal";
  let cleanupSim = null;
  let unsubSession = () => {};
  let unsubBundle = () => {};
  let mounted = false;

  async function ensureLobby() {
    const lobby = getLobby();
    if (lobby?.code && lobby.participants?.length) return;
    if (hasActiveLobby()) return;
    if (canCreateLobby()) await createLobby();
  }

  function renderMessages() {
    const messages = getLobbyMessages();
    if (!messages.length) {
      return `<p class="chat-empty">Aucun message pour l'instant.</p>`;
    }
    return messages
      .map(
        (m) => `
      <div class="chat-msg">
        <span class="chat-msg__from">${escapeHtml(m.from)}</span>
        <span class="chat-msg__text">${escapeHtml(m.text)}</span>
      </div>`
      )
      .join("");
  }

  function captureChatState() {
    const input = app.querySelector("#chat-input");
    return {
      value: input?.value ?? "",
      focused: document.activeElement === input,
      selStart: input?.selectionStart ?? 0,
      selEnd: input?.selectionEnd ?? 0,
    };
  }

  function restoreChatState(state) {
    const input = app.querySelector("#chat-input");
    if (!input || !state) return;
    input.value = state.value;
    if (state.focused) {
      input.focus();
      try {
        input.setSelectionRange(state.selStart, state.selEnd);
      } catch {
        /* ignore */
      }
    }
  }

  function refreshChat() {
    const box = app.querySelector("#chat-messages");
    if (!box) return;
    box.innerHTML = renderMessages();
    box.scrollTop = box.scrollHeight;
  }

  function updateStartButton() {
    const participants = getLobbyParticipants();
    const local = participants.find((p) => p.isLocal);
    const isHost = isLobbyHost();
    const localReady = Boolean(local?.ready);
    const allReady = allLobbyMembersReady();
    const label = getLobbyStartLabel({ isHost, allReady, localReady });

    const startBtn = app.querySelector("#btn-start");
    if (!startBtn) return;

    if (isHost) {
      startBtn.disabled = !allReady;
      startBtn.classList.toggle("btn-start--waiting", !allReady);
      startBtn.title = allReady
        ? "Lancer la soirée"
        : localReady
          ? "Tous les joueurs doivent être prêts"
          : 'Appuie sur « Je suis prêt ! »';
    } else {
      startBtn.disabled = true;
      startBtn.classList.add("btn-start--waiting");
      startBtn.title = allReady
        ? "L'hôte va lancer la soirée"
        : localReady
          ? "Patiente pendant que les autres se préparent"
          : 'Appuie sur « Je suis prêt ! »';
    }

    startBtn.innerHTML = `<span class="btn-start__icon">▶</span>${label}`;
  }

  function refreshParticipants() {
    const participants = getLobbyParticipants();
    const { ready, total } = getReadyCount();
    const local = participants.find((p) => p.isLocal);
    const canKick =
      isSupabaseConfigured() && isLobbyHost() && canManageLobbyRoster();
    const hostId = getLobby()?.hostId || null;

    const countEl = app.querySelector(".lobby-count");
    if (countEl) countEl.textContent = `${total} / ${MAX_PLAYERS} participants connectés`;

    const grid = app.querySelector(".participants-grid");
    if (grid) grid.innerHTML = participantsHtml(participants, { canKick, hostId });

    const footer = app.querySelector(".lobby-footer");
    if (footer) {
      footer.textContent = `${ready} / ${total} prêts · ${lobbyFooterHint(ready, total)}`;
    }

    const readyBtn = app.querySelector("#btn-ready");
    if (readyBtn) {
      readyBtn.classList.toggle("btn-ready--active", Boolean(local?.ready));
      readyBtn.innerHTML = `
        <span class="btn-ready__icon">${local?.ready ? "✅" : "⬜"}</span>
        ${local?.ready ? "Prêt !" : "Je suis prêt !"}`;
    }

    updateStartButton();
  }

  function onLobbyUpdate() {
    refreshParticipants();
    refreshChat();
  }

  async function openEmojiPicker() {
    const res = await showEmojiPickerDialog(getLocalEmoji());
    if (!res?.ok) return;
    const saved = await updateProfileEmoji(res.emoji);
    if (!saved.ok) {
      await showAppAlert(saved.error || "Impossible d'enregistrer l'emoji.", {
        title: "Erreur",
        icon: "⚠️",
      });
      return;
    }
    refreshParticipants();
  }

  function bindEvents(lobby) {
    bindNav(app);

    app.querySelector(".participants-grid")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-edit-emoji]")) {
        void openEmojiPicker();
        return;
      }
      const kickBtn = e.target.closest("[data-kick-user]");
      if (kickBtn) {
        const userId = kickBtn.getAttribute("data-kick-user");
        const name = kickBtn.getAttribute("data-kick-name") || "";
        void kickLobbyMember(userId, { confirmName: name }).then((res) => {
          if (res?.ok) refreshParticipants();
        });
      }
    });

    app.querySelector("#copy-code")?.addEventListener("click", async () => {
      const btn = app.querySelector("#copy-code");
      try {
        await navigator.clipboard.writeText(lobby.code);
        if (btn) btn.textContent = "✓";
      } catch {
        if (btn) btn.textContent = "!";
      }
    });

    app.querySelector("#btn-ready")?.addEventListener("click", async () => {
      await toggleLocalReady();
      refreshParticipants();
    });

    app.querySelector("#btn-start")?.addEventListener("click", async () => {
      const startBtn = app.querySelector("#btn-start");
      if (!allLobbyMembersReady()) {
        await showAppAlert("Tous les joueurs doivent être prêts avant de commencer la soirée.", {
          title: "Pas encore prêt",
          icon: "⏳",
        });
        return;
      }
      if (startBtn?.disabled) return;
      if (startBtn) startBtn.disabled = true;
      try {
        if (isGameSyncActive() && isLobbyHost()) {
          await startGameSession("menu", "game-select", {});
        } else {
          await goToGameSelect();
        }
      } catch (err) {
        await showAppAlert(err.message || "Impossible de lancer la soirée.", {
          title: "Erreur",
          icon: "⚠️",
        });
        updateStartButton();
      }
    });

    const sendChat = async () => {
      const input = app.querySelector("#chat-input");
      if (!input?.value.trim()) return;
      await addLobbyMessage(input.value);
      input.value = "";
      refreshChat();
      input.focus();
    };

    app.querySelector("#chat-send")?.addEventListener("click", sendChat);
    app.querySelector("#chat-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });

    app.querySelector("#btn-lobby-reset-app")?.addEventListener("click", async () => {
      const ok = await showAppConfirm(
        "Si le lobby ne répond plus, ta session locale sera effacée. Tu pourras te reconnecter et rejoindre une nouvelle partie.",
        {
          title: "Réinitialiser REVEAL",
          confirmLabel: "Réinitialiser",
          cancelLabel: "Annuler",
          icon: "🔄",
        }
      );
      if (!ok) return;
      await resetAppToCleanHome();
    });
  }

  function renderFull() {
    const chatState = mounted ? captureChatState() : null;

    const lobby = getLobby();
    const participants = getLobbyParticipants();
    const { ready, total } = getReadyCount();
    const local = participants.find((p) => p.isLocal);
    const isHost = isLobbyHost();
    const allReady = allLobbyMembersReady();
    const online = isSupabaseConfigured();
    const canKick = online && isLobbyHost() && canManageLobbyRoster();
    const hostId = lobby?.hostId || null;

    app.innerHTML = pageShell({
      backTarget: "home",
      content: `
        <p class="lobby-count">${total} / ${MAX_PLAYERS} participants connectés</p>

        <div class="participants-wrap">
          <div class="participants-grid">${participantsHtml(participants, { canKick, hostId })}</div>
        </div>

        <div class="invite-card">
          <p class="invite-card__label">Code · ${getLobbyStatus() === "playing" ? "partie en cours" : "en attente"}</p>
          <div class="invite-card__row">
            <span class="invite-code">${escapeHtml(lobby.code)}</span>
            <button type="button" class="btn-icon" id="copy-code" aria-label="Copier le code">⧉</button>
          </div>
          <p class="hint">${online ? "Partage le code - les invités rejoignent sans compte." : "Démo locale : partage le code avec les autres joueurs."}</p>
          ${isHost && online ? `<p class="hint lobby-lifecycle-hint">${escapeHtml(getLobbyAutoCloseHint(getLobbyStatus()))}</p>` : ""}
        </div>

        <div class="chat-panel">
          <div class="chat-messages" id="chat-messages">${renderMessages()}</div>
          <div class="chat-box">
            <input type="text" class="chat-box__input" id="chat-input" placeholder="Un message…" maxlength="200" autocomplete="off" />
            <button type="button" class="chat-box__send" id="chat-send" aria-label="Envoyer">➤</button>
          </div>
        </div>

        <button type="button" class="btn btn-ready ${local?.ready ? "btn-ready--active" : ""}" id="btn-ready">
          <span class="btn-ready__icon">${local?.ready ? "✅" : "⬜"}</span>
          ${local?.ready ? "Prêt !" : "Je suis prêt !"}
        </button>

        ${
          isHost
            ? `
        <div class="lobby-host-actions">
          <button type="button" class="btn btn-start ${allReady ? "" : "btn-start--waiting"}" id="btn-start" ${
            allReady ? "" : "disabled"
          }>
            <span class="btn-start__icon">▶</span>
            ${hostStartLabel(allReady, local?.ready)}
          </button>
          ${
            !allReady
              ? `<p class="hint lobby-host-hint">Chaque joueur doit appuyer sur « Je suis prêt ! » avant le lancement.</p>`
              : ""
          }
        </div>`
            : `<button type="button" class="btn btn-start btn-start--waiting" id="btn-start" disabled>
            <span class="btn-start__icon">▶</span>
            ${guestStartLabel(allReady, local?.ready)}
          </button>`
        }

        <p class="lobby-footer">${ready} / ${total} prêts · ${lobbyFooterHint(ready, total)}</p>

        <p class="lobby-reset-wrap">
          <button type="button" class="btn-link lobby-reset-link" id="btn-lobby-reset-app">Blocage ? Réinitialiser l'app</button>
        </p>
      `,
    });

    bindEvents(lobby);
    refreshChat();
    restoreChatState(chatState);
    mounted = true;
  }

  (async () => {
    await ensureLobby();
    if (isGameSyncActive()) {
      startMultiplayerSync();
      const row = await refreshGameSession();
      const resumeScreen = getResumableSessionScreen(row);
      if (resumeScreen) {
        lobbyMode = "resume";
        cleanupResume = mountGameResumeInterstitial(app, resumeScreen, {
          allowStay: !isLobbyHost(),
        });
        unsubSession = onGameSessionChange(async (nextRow) => {
          if (!nextRow) return;
          const nextScreen = getResumableSessionScreen(nextRow);
          if (!nextScreen) return;
          if (getCurrentScreen() !== "lobby") return;
          if (await routeToActiveGameIfNeeded(nextRow)) return;
        });
        unsubBundle = onLobbyBundleUpdated(() => {
          if (getCurrentScreen() === "lobby" && lobbyMode === "resume") {
            void routeToActiveGameIfNeeded();
          }
        });
        return;
      }

      if (isLobbyEveningStarted()) {
        navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
        return;
      }
    } else if (isLobbyEveningStarted()) {
      navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
      return;
    }

    if (!isLobbyEveningStarted()) {
      await reconcileLobbyReadyOnMount();
    }
    renderFull();
    if (isGameSyncActive()) {
      startMultiplayerSync();
      void routeToActiveGameIfNeeded();
      unsubSession = onGameSessionChange(async (row) => {
        if (!row) return;
        if (await routeToActiveGameIfNeeded(row)) return;
        const effective = getEffectiveSessionScreen(row);
        if (getCurrentScreen() !== "lobby" || !effective) return;
        if (isActiveGameSessionScreen(effective) || isOnGameSetupScreen(effective)) {
          void routeToActiveGameIfNeeded(row);
          return;
        }
        if (effective === "game-select" && isLobbyEveningStarted()) {
          navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
        }
      });
      unsubBundle = onLobbyBundleUpdated(() => {
        if (isLobbyEveningStarted()) {
          void routeToActiveGameIfNeeded();
        }
      });
    }
    cleanupSim = simulateLobbyJoins(onLobbyUpdate);
  })();

  return () => {
    cleanupResume();
    unsubSession();
    unsubBundle();
    if (cleanupSim) cleanupSim();
  };
}
