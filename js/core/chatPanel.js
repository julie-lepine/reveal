import { escapeHtml } from "./ui.js";

export const CHAT_MAX_LENGTH = 200;

/** @param {{ from?: string, text?: string }[]} messages */
export function renderChatMessagesHtml(messages) {
  if (!messages?.length) {
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

export function validateChatText(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return { ok: false, text: "" };
  if (trimmed.length > CHAT_MAX_LENGTH) {
    return { ok: false, text: trimmed.slice(0, CHAT_MAX_LENGTH), error: "too_long" };
  }
  return { ok: true, text: trimmed };
}

/**
 * Monte une instance chat sur un sous-arbre DOM existant (lobby ou sheet).
 * sendMessage / getMessages sont injectés pour éviter un import lobby au chargement.
 *
 * @param {ParentNode} _root
 * @param {{
 *   messagesEl: HTMLElement,
 *   inputEl: HTMLInputElement,
 *   sendEl: HTMLElement,
 *   getMessages: () => unknown[],
 *   sendMessage: (text: string) => Promise<void> | void,
 *   onAfterSend?: () => void,
 * }} opts
 */
export function mountChatPanel(_root, opts) {
  const messagesEl = opts.messagesEl;
  const inputEl = opts.inputEl;
  const sendEl = opts.sendEl;
  const getMessages = opts.getMessages;
  const sendMessage = opts.sendMessage;
  let sending = false;
  let cleaned = false;

  function scrollToLatest() {
    if (!messagesEl) return;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function refresh() {
    if (cleaned || !messagesEl) return;
    messagesEl.innerHTML = renderChatMessagesHtml(getMessages());
    scrollToLatest();
  }

  function setSending(next) {
    sending = next;
    if (sendEl) sendEl.disabled = next;
    if (inputEl) inputEl.disabled = next;
  }

  async function sendChat() {
    if (cleaned || sending || !inputEl) return;
    const checked = validateChatText(inputEl.value);
    if (!checked.ok) return;
    setSending(true);
    try {
      await sendMessage(checked.text);
      inputEl.value = "";
      refresh();
      opts.onAfterSend?.();
      inputEl.focus();
    } finally {
      setSending(false);
    }
  }

  const onSendClick = () => {
    void sendChat();
  };
  const onInputKeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void sendChat();
    }
  };

  sendEl?.addEventListener("click", onSendClick);
  inputEl?.addEventListener("keydown", onInputKeydown);

  if (inputEl) {
    inputEl.maxLength = CHAT_MAX_LENGTH;
    inputEl.setAttribute("maxlength", String(CHAT_MAX_LENGTH));
  }

  refresh();

  return {
    refresh,
    scrollToLatest,
    focusInput() {
      inputEl?.focus();
    },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      sendEl?.removeEventListener("click", onSendClick);
      inputEl?.removeEventListener("keydown", onInputKeydown);
    },
  };
}
