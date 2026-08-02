import { INSTAGRAM_HANDLE, INSTAGRAM_PROFILE_URL } from "../../data/appConfig.js";
import { isChatFabAllowedScreen } from "./chatFabScreens.js";
import { mountChatPanel } from "./chatPanel.js";
import {
  formatUnreadBadge,
  getChatLobbyKey,
  initChatUnreadTracking,
  markMessagesRead,
  onChatUnreadChange,
  syncChatUnread,
} from "./chatUnread.js";
import { hasActiveLobby, getLobby, getLobbyMessages, addLobbyMessage } from "./lobby.js";
import { openExternalUrl } from "./openExternal.js";
import { getCurrentScreen, onScreenChange } from "./router.js";
import { onLobbyBundleUpdated } from "./supabaseLobby.js";
import { escapeHtml } from "./ui.js";
import { mountLobbyPollInChatSheet } from "./lobbyPollSheetUi.js";
import {
  onLobbyPollChange,
  getLobbyPollUnseen,
  markLobbyPollSeen,
  setLobbyPollSheetOpenGetter,
} from "./lobbyPollStore.js";

export { CHAT_FAB_ALLOWED_SCREENS, isChatFabAllowedScreen } from "./chatFabScreens.js";

let fabEl = null;
let badgeEl = null;
let sheetRoot = null;
let sheetPanel = null;
let chatInstance = null;
let unsubMessages = null;
let unsubPollUi = null;
let unsubPollBadge = null;
let sheetOpen = false;
let bodyOverflowPrev = "";
/** Compteur messages non lus (indépendant de unseenPoll). */
let chatUnreadCount = 0;

export function isChatSheetOpen() {
  return sheetOpen;
}

function shouldShowChatFab() {
  if (!hasActiveLobby()) return false;
  return isChatFabAllowedScreen(getCurrentScreen());
}

function updateFeedbackFabVisibility() {
  if (!fabEl) return;
  const show = shouldShowChatFab();
  fabEl.classList.toggle("feedback-fab--hidden", !show);
  fabEl.hidden = !show;
  if (!show && sheetOpen) {
    closeChatSheet();
  }
}

function updateFabBadge() {
  if (!badgeEl || !fabEl) return;
  const unseenPoll = getLobbyPollUnseen();
  const chatN = chatUnreadCount;
  const show = chatN > 0 || unseenPoll;

  if (!show) {
    badgeEl.hidden = true;
    badgeEl.textContent = "";
    badgeEl.classList.remove("feedback-fab__badge--poll");
    fabEl.setAttribute("aria-label", "Ouvrir le chat");
    return;
  }

  badgeEl.hidden = false;
  if (chatN > 0) {
    const label = formatUnreadBadge(chatN);
    badgeEl.textContent = label;
    badgeEl.classList.toggle("feedback-fab__badge--poll", unseenPoll && !label);
    fabEl.setAttribute(
      "aria-label",
      unseenPoll
        ? `Ouvrir le chat, ${label} non lus, sondage en cours`
        : `Ouvrir le chat, ${label} non lus`
    );
  } else {
    badgeEl.textContent = "";
    badgeEl.classList.add("feedback-fab__badge--poll");
    fabEl.setAttribute("aria-label", "Ouvrir le chat, nouveau sondage");
  }
}

export function openInstagramProfile() {
  void openExternalUrl(INSTAGRAM_PROFILE_URL);
}

export function feedbackPromptCardHtml() {
  return `
    <div class="card settings-section feedback-prompt game-select-feedback">
      <h2 class="settings-section__title">Un retour ?</h2>
      <p class="hint feedback-prompt__hint">
        Bug, idée de jeu ou mot à ajouter ? Écris-nous sur Instagram
        <strong>@${escapeHtml(INSTAGRAM_HANDLE)}</strong>.
      </p>
      <button
        type="button"
        class="btn btn-accent feedback-prompt__btn btn--spaced"
        data-open-feedback-dm
      >Envoie un DM</button>
    </div>`;
}

export function bindFeedbackPrompt(root) {
  root.querySelectorAll("[data-open-feedback-dm]").forEach((el) => {
    el.addEventListener("click", () => {
      openInstagramProfile();
    });
  });
}

function onSheetKeydown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    closeChatSheet();
  }
}

function cleanupSheetDom() {
  unsubPollUi?.();
  unsubPollUi = null;
  unsubMessages?.();
  unsubMessages = null;
  chatInstance?.cleanup();
  chatInstance = null;
  if (sheetRoot) {
    sheetRoot.removeEventListener("keydown", onSheetKeydown);
    sheetRoot.remove();
  }
  sheetRoot = null;
  sheetPanel = null;
  document.body.style.overflow = bodyOverflowPrev;
  bodyOverflowPrev = "";
  sheetOpen = false;
}

export function closeChatSheet() {
  if (!sheetOpen && !sheetRoot) return;
  const returnFocus = fabEl && !fabEl.hidden ? fabEl : null;
  cleanupSheetDom();
  void syncChatUnread();
  if (returnFocus) {
    try {
      returnFocus.focus();
    } catch {
      /* ignore */
    }
  }
}

function openChatSheet() {
  if (sheetOpen) return;
  if (typeof document === "undefined") return;

  sheetOpen = true;
  markLobbyPollSeen();
  updateFabBadge();
  bodyOverflowPrev = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  sheetRoot = document.createElement("div");
  sheetRoot.className = "chat-sheet";
  sheetRoot.setAttribute("role", "presentation");
  sheetRoot.innerHTML = `
    <div class="chat-sheet__backdrop" data-chat-sheet-dismiss aria-hidden="true"></div>
    <div
      class="chat-sheet__panel"
      role="dialog"
      aria-modal="true"
      aria-label="Chat"
      tabindex="-1"
    >
      <div class="chat-sheet__header">
        <h2 class="chat-sheet__title">Chat</h2>
        <button type="button" class="chat-sheet__close" data-chat-sheet-dismiss aria-label="Fermer">✕</button>
      </div>
      <div id="chat-sheet-poll" class="chat-sheet__poll" hidden></div>
      <div class="chat-messages chat-sheet__messages" id="chat-sheet-messages"></div>
      <div class="chat-box chat-sheet__box">
        <input
          type="text"
          class="chat-box__input"
          id="chat-sheet-input"
          placeholder="Un message…"
          maxlength="200"
          autocomplete="off"
        />
        <button type="button" class="chat-box__send" id="chat-sheet-send" aria-label="Envoyer">➤</button>
      </div>
    </div>
  `;

  document.body.appendChild(sheetRoot);
  sheetPanel = sheetRoot.querySelector(".chat-sheet__panel");

  const messagesEl = sheetRoot.querySelector("#chat-sheet-messages");
  const inputEl = sheetRoot.querySelector("#chat-sheet-input");
  const sendEl = sheetRoot.querySelector("#chat-sheet-send");

  unsubPollUi = mountLobbyPollInChatSheet(sheetRoot);

  chatInstance = mountChatPanel(sheetRoot, {
    messagesEl,
    inputEl,
    sendEl,
    getMessages: getLobbyMessages,
    sendMessage: addLobbyMessage,
    onAfterSend: () => {
      markMessagesRead(getLobbyMessages(), getChatLobbyKey(getLobby()));
      void syncChatUnread();
    },
  });

  // Marquer lus seulement après rendu réussi de la liste.
  markMessagesRead(getLobbyMessages(), getChatLobbyKey(getLobby()));
  void syncChatUnread();

  unsubMessages = onLobbyBundleUpdated(() => {
    chatInstance?.refresh();
    if (sheetOpen) {
      markMessagesRead(getLobbyMessages(), getChatLobbyKey(getLobby()));
      void syncChatUnread();
    }
  });

  sheetRoot.querySelectorAll("[data-chat-sheet-dismiss]").forEach((el) => {
    el.addEventListener("click", () => closeChatSheet());
  });

  sheetRoot.addEventListener("keydown", onSheetKeydown);

  requestAnimationFrame(() => {
    sheetRoot?.classList.add("chat-sheet--in");
    // Focus dialog (a11y / Escape) sans focus input — sinon clavier mobile à l'ouverture (UX-CHAT-02).
    sheetPanel?.focus();
  });
}

export function initFeedbackFab() {
  if (fabEl || typeof document === "undefined") return;

  fabEl = document.createElement("button");
  fabEl.type = "button";
  fabEl.id = "feedback-fab";
  fabEl.className = "feedback-fab feedback-fab--hidden";
  fabEl.setAttribute("aria-label", "Ouvrir le chat");
  fabEl.hidden = true;
  fabEl.innerHTML = `
    <span class="feedback-fab__icon" aria-hidden="true">💬</span>
    <span class="feedback-fab__badge" hidden></span>
  `;
  badgeEl = fabEl.querySelector(".feedback-fab__badge");

  fabEl.addEventListener("click", () => {
    // Ouverture async légère : pas de travail sync lourd.
    queueMicrotask(() => openChatSheet());
  });

  document.body.appendChild(fabEl);
  updateFeedbackFabVisibility();

  onScreenChange(() => updateFeedbackFabVisibility());
  onLobbyBundleUpdated(() => updateFeedbackFabVisibility());

  initChatUnreadTracking({ isChatSheetOpen: () => sheetOpen });
  onChatUnreadChange((count) => {
    chatUnreadCount = Number(count) || 0;
    updateFabBadge();
  });
  setLobbyPollSheetOpenGetter(() => sheetOpen);
  unsubPollBadge?.();
  unsubPollBadge = onLobbyPollChange(() => updateFabBadge());
  updateFabBadge();
  void syncChatUnread();
}
