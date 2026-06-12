import {
  getLobby,
  getLobbyParticipants,
  getLobbyMessages,
  getReadyCount,
  toggleLocalReady,
  simulateLobbyJoins,
  addLobbyMessage,
  getLobbyJoinUrl,
  getLobbyStatus,
  MAX_PLAYERS,
  createLobby,
  hasActiveLobby,
  resetAllParticipantsReady,
  goToGameSelect,
  allLobbyMembersReady,
  getNotReadyParticipants,
  getLobbyNudge,
  sendLobbyNudgeToNotReady,
  isLobbyEveningStarted,
} from "../core/lobby.js";
import { canCreateLobby } from "../core/auth.js";
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
} from "../core/gameSync.js";
import { navigate, getCurrentScreen } from "../core/router.js";
import { triggerLobbyNudge } from "../core/nudge.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { showAppAlert } from "../core/dialog.js";
import { getLobbyAutoCloseHint } from "../config/lobbyLifecycle.js";

function participantsHtml(participants) {
  return participants
    .map(
      (p) => `
    <div class="participant ${p.ready ? "participant--ready" : ""}">
      <div class="participant__avatar" style="background:${p.color}">
        ${p.emoji}
        ${p.ready ? '<span class="participant__check">✓</span>' : ""}
      </div>
      <span class="participant__name">${escapeHtml(p.name)}</span>
    </div>`
    )
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

  let cleanupSim = null;
  let unsubSession = () => {};
  let unsubBundle = () => {};
  let mounted = false;
  let lastNudgeSeen = 0;
  let wizzCooldownUntil = 0;

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

  function checkIncomingNudge() {
    const { at, forUserId } = getLobbyNudge();
    if (!at || at <= lastNudgeSeen) return;

    const local = getLobbyParticipants().find((p) => p.isLocal);
    if (!local || local.ready) return;
    if (forUserId && forUserId !== local.userId) return;

    lastNudgeSeen = at;
    triggerLobbyNudge();
  }

  function updateStartButton() {
    const participants = getLobbyParticipants();
    const local = participants.find((p) => p.isLocal);
    const isHost = Boolean(local?.isHost);
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

  function updateHostControls() {
    const notReadyGuests = getNotReadyParticipants().filter((p) => !p.isHost);
    const wizzOnCooldown = Date.now() < wizzCooldownUntil;

    updateStartButton();

    const wizzBtn = app.querySelector("#btn-wizz");
    if (wizzBtn) {
      const canWizz = isSupabaseConfigured() && notReadyGuests.length > 0 && !wizzOnCooldown;
      wizzBtn.disabled = !canWizz;
      const names = notReadyGuests.map((p) => p.name).join(", ");
      wizzBtn.title = canWizz
        ? `Réveiller : ${names}`
        : wizzOnCooldown
          ? "Patiente quelques secondes…"
          : "Personne à réveiller";
    }
  }

  function refreshParticipants() {
    const participants = getLobbyParticipants();
    const { ready, total } = getReadyCount();
    const local = participants.find((p) => p.isLocal);

    const countEl = app.querySelector(".lobby-count");
    if (countEl) countEl.textContent = `${total} / ${MAX_PLAYERS} participants connectés`;

    const grid = app.querySelector(".participants-grid");
    if (grid) grid.innerHTML = participantsHtml(participants);

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

    updateHostControls();
    checkIncomingNudge();
  }

  function onLobbyUpdate() {
    refreshParticipants();
    refreshChat();
  }

  function bindEvents(lobby) {
    bindNav(app);

    app.querySelector("#copy-code")?.addEventListener("click", async () => {
      const btn = app.querySelector("#copy-code");
      try {
        await navigator.clipboard.writeText(lobby.code);
        if (btn) btn.textContent = "✓";
      } catch {
        if (btn) btn.textContent = "!";
      }
    });

    app.querySelector("#copy-link")?.addEventListener("click", async () => {
      const btn = app.querySelector("#copy-link");
      try {
        await navigator.clipboard.writeText(getLobbyJoinUrl(lobby.code));
        if (btn) btn.textContent = "Lien copié ✓";
      } catch {
        if (btn) btn.textContent = "Erreur";
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
        updateHostControls();
      }
    });

    app.querySelector("#btn-wizz")?.addEventListener("click", async () => {
      const res = await sendLobbyNudgeToNotReady();
      if (!res.ok) {
        await showAppAlert(res.error, { title: "Wizz", icon: "📳" });
        return;
      }
      wizzCooldownUntil = Date.now() + 5000;
      updateHostControls();
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
  }

  function renderFull() {
    const chatState = mounted ? captureChatState() : null;

    const lobby = getLobby();
    const participants = getLobbyParticipants();
    const { ready, total } = getReadyCount();
    const local = participants.find((p) => p.isLocal);
    const isHost = local?.isHost;
    const allReady = allLobbyMembersReady();
    const notReadyGuests = getNotReadyParticipants().filter((p) => !p.isHost);
    const joinUrl = getLobbyJoinUrl(lobby.code);
    const online = isSupabaseConfigured();

    lastNudgeSeen = getLobbyNudge().at || 0;

    app.innerHTML = pageShell({
      backTarget: "home",
      content: `
        <p class="lobby-count">${total} / ${MAX_PLAYERS} participants connectés</p>

        <div class="participants-wrap">
          <div class="participants-grid">${participantsHtml(participants)}</div>
        </div>

        <div class="invite-card">
          <p class="invite-card__label">Code · ${getLobbyStatus() === "playing" ? "partie en cours" : "en attente"}</p>
          <div class="invite-card__row">
            <span class="invite-code">${escapeHtml(lobby.code)}</span>
            <button type="button" class="btn-icon" id="copy-code" aria-label="Copier le code">⧉</button>
          </div>
          <p class="hint">
            <a href="${escapeHtml(joinUrl)}" class="lobby-deep-link">Lien d'invitation</a>
            · <button type="button" class="btn-link" id="copy-link">Copier le lien</button>
          </p>
          <p class="hint">${online ? "Partage le code ou le lien - les invités rejoignent sans compte." : "Démo locale : ouvre le lien sur le même appareil ou un autre onglet."}</p>
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
          ${
            online && notReadyGuests.length
              ? `<button type="button" class="btn btn-wizz" id="btn-wizz" title="Réveiller les joueurs pas prêts">
            📳 Wizz ! <span class="btn-wizz__count">${notReadyGuests.length} pas prêt</span>
          </button>`
              : ""
          }
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
      `,
    });

    bindEvents(lobby);
    refreshChat();
    restoreChatState(chatState);
    mounted = true;
  }

  (async () => {
    await ensureLobby();
    if (!isLobbyEveningStarted()) {
      await resetAllParticipantsReady();
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
        if (effective === "game-select" && getLobbyStatus() === "playing") {
          navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
        }
      });
      unsubBundle = onLobbyBundleUpdated(() => {
        if (getLobbyStatus() === "playing") {
          void routeToActiveGameIfNeeded();
        }
      });
    }
    cleanupSim = simulateLobbyJoins(onLobbyUpdate);
  })();

  return () => {
    unsubSession();
    unsubBundle();
    if (cleanupSim) cleanupSim();
  };
}
