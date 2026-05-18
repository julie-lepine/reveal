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
} from "../core/lobby.js";
import { canCreateLobby } from "../core/auth.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

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

export function mountLobby(app) {
  if (!requireLobbyPlay()) return null;

  let cleanupSim = null;
  let mounted = false;

  function ensureLobby() {
    const lobby = getLobby();
    if (lobby?.code && lobby.participants?.length) return;
    if (hasActiveLobby()) return;
    if (canCreateLobby()) createLobby();
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
      footer.textContent = `${ready} / ${total} prêts · ${
        ready === total && total > 0 ? "Tout le monde est prêt !" : "En attente des joueurs"
      }`;
    }

    const readyBtn = app.querySelector("#btn-ready");
    if (readyBtn) {
      readyBtn.classList.toggle("btn-ready--active", Boolean(local?.ready));
      readyBtn.innerHTML = `
        <span class="btn-ready__icon">${local?.ready ? "✅" : "⬜"}</span>
        ${local?.ready ? "Prêt !" : "Je suis prêt !"}`;
    }
  }

  function bindEvents(lobby) {
    bindNav(app);

    const qr = app.querySelector("#lobby-qr");
    if (qr && lobby.code) {
      const url = encodeURIComponent(getLobbyJoinUrl(lobby.code));
      qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${url}`;
    }

    app.querySelector("#copy-code")?.addEventListener("click", async () => {
      const btn = app.querySelector("#copy-code");
      try {
        await navigator.clipboard.writeText(lobby.code);
        if (btn) btn.textContent = "✓";
      } catch {
        if (btn) btn.textContent = "!";
      }
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      toggleLocalReady();
      refreshParticipants();
    });

    const sendChat = () => {
      const input = app.querySelector("#chat-input");
      if (!input?.value.trim()) return;
      addLobbyMessage(input.value);
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

    ensureLobby();
    const lobby = getLobby();
    const participants = getLobbyParticipants();
    const { ready, total } = getReadyCount();
    const local = participants.find((p) => p.isLocal);
    const isHost = local?.isHost;

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
          </div>>
          <img class="lobby-qr" id="lobby-qr" width="140" height="140" alt="QR code" />
          <p class="hint"><a href="${escapeHtml(getLobbyJoinUrl(lobby.code))}" class="lobby-deep-link">Lien d'invitation</a> (démo locale)</p>
        </div>>

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
            ? `<button type="button" class="btn btn-start" id="btn-start" data-nav="game-select">
            <span class="btn-start__icon">▶</span>
            Commencer la soirée
          </button>`
            : `<button type="button" class="btn btn-start btn-start--waiting" disabled>
            En attente de l'hôte…
          </button>`
        }

        <p class="lobby-footer">${ready} / ${total} prêts · ${ready === total && total > 0 ? "Tout le monde est prêt !" : "En attente des joueurs"}</p>
      `,
    });

    bindEvents(lobby);
    refreshChat();
    restoreChatState(chatState);
    mounted = true;
  }

  ensureLobby();
  resetAllParticipantsReady();
  renderFull();
  cleanupSim = simulateLobbyJoins(refreshParticipants);

  return () => {
    if (cleanupSim) cleanupSim();
  };
}
