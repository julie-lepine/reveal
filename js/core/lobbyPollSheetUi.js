/**
 * Vague 2 — UI sondage dans le sheet chat (pas de 2e FAB / sheet / store).
 * Formulaire de création replié : CTA compact → expand.
 */
import { escapeHtml } from "./ui.js";
import { showAppAlert } from "./dialog.js";
import {
  getLobbyPollSnapshot,
  onLobbyPollChange,
  createLobbyPollFromCatalog,
  castLobbyPollVote,
  closeLobbyPollExplicit,
  markLobbyPollSeen,
} from "./lobbyPollStore.js";

let hostEl = null;
let unsub = null;
let createDraftIds = new Set();
/** Formulaire création ouvert (après clic CTA). */
let createFormOpen = false;

export function resetLobbyPollSheetUiForTests() {
  createDraftIds = new Set();
  createFormOpen = false;
  hostEl = null;
  unsub?.();
  unsub = null;
}

export function isLobbyPollCreateFormOpen() {
  return createFormOpen;
}

function leaderLabel(leader, options) {
  if (!leader || leader.kind === "none") return "";
  const titleOf = (id) =>
    options.find((o) => o.gameId === id)?.title || id;
  if (leader.kind === "tie") {
    const names = leader.gameIds.map(titleOf).join(", ");
    return `Égalité (${leader.maxVotes} vote${leader.maxVotes > 1 ? "s" : ""}) : ${names}`;
  }
  return `En tête : ${titleOf(leader.gameIds[0])} (${leader.maxVotes})`;
}

function renderCreateCta() {
  return `
    <div class="lobby-poll lobby-poll--cta">
      <button type="button" class="btn btn-accent lobby-poll__cta" data-poll-open-create>
        À quoi on joue après ?
      </button>
    </div>`;
}

function renderCreateForm(snap) {
  const games = snap.catalogGames || [];
  const busy = snap.committing.create;
  const checks = games
    .map((g) => {
      const on = createDraftIds.has(g.id);
      return `
      <label class="lobby-poll__opt lobby-poll__opt--pick">
        <input type="checkbox" data-poll-pick="${escapeHtml(g.id)}" ${on ? "checked" : ""} ${busy ? "disabled" : ""} />
        <span class="lobby-poll__emoji" aria-hidden="true">${escapeHtml(g.emoji)}</span>
        <span class="lobby-poll__title">${escapeHtml(g.title)}</span>
      </label>`;
    })
    .join("");

  return `
    <div class="lobby-poll lobby-poll--create">
      <p class="lobby-poll__question">À quoi on joue après ?</p>
      <p class="hint lobby-poll__hint">Choisis au moins 2 jeux, puis lance le sondage.</p>
      <div class="lobby-poll__picks">${checks}</div>
      <div class="lobby-poll__actions">
        <button type="button" class="btn btn-accent lobby-poll__submit" data-poll-create ${busy ? "disabled" : ""}>
          ${busy ? "Création…" : "Lancer le sondage"}
        </button>
        <button type="button" class="btn-link lobby-poll__cancel" data-poll-cancel-create ${busy ? "disabled" : ""}>
          Annuler
        </button>
      </div>
    </div>`;
}

function renderOpenPoll(snap) {
  const poll = snap.activePoll;
  const d = snap.derived;
  const busyVote = snap.committing.vote;
  const busyClose = snap.committing.close;
  const options = poll.options || [];
  const rows = options
    .map((o) => {
      const n = d.resultsByOption[o.gameId] || 0;
      const mine = d.myVote === o.gameId;
      return `
      <button
        type="button"
        class="lobby-poll__opt lobby-poll__opt--vote ${mine ? "lobby-poll__opt--mine" : ""}"
        data-poll-vote="${escapeHtml(o.gameId)}"
        ${busyVote ? "disabled" : ""}
      >
        <span class="lobby-poll__emoji" aria-hidden="true">${escapeHtml(o.emoji)}</span>
        <span class="lobby-poll__title">${escapeHtml(o.title)}</span>
        <span class="lobby-poll__count">${n}</span>
      </button>`;
    })
    .join("");

  const closeBtn = d.canCloseExplicit
    ? `<button type="button" class="btn-link lobby-poll__close" data-poll-close ${busyClose ? "disabled" : ""}>
        ${busyClose ? "Fermeture…" : "Fermer le sondage"}
      </button>`
    : "";

  const lead = leaderLabel(d.leader, options);

  return `
    <div class="lobby-poll lobby-poll--open">
      <p class="lobby-poll__question">À quoi on joue après ?</p>
      <p class="lobby-poll__tally">${d.activeVoterCount} / ${d.activeMemberCount} ont voté</p>
      ${lead ? `<p class="hint lobby-poll__leader">${escapeHtml(lead)}</p>` : ""}
      <div class="lobby-poll__votes">${rows}</div>
      ${closeBtn}
    </div>`;
}

export function renderLobbyPollSheet(rootEl) {
  if (!rootEl) return;
  const snap = getLobbyPollSnapshot();
  const d = snap.derived;

  if (snap.activePoll && snap.activePoll.status === "open") {
    createDraftIds = new Set();
    createFormOpen = false;
    rootEl.innerHTML = renderOpenPoll(snap);
    rootEl.hidden = false;
    return;
  }

  if (!d.showCreateCta) {
    createFormOpen = false;
    createDraftIds = new Set();
    rootEl.innerHTML = "";
    rootEl.hidden = true;
    return;
  }

  if (createFormOpen) {
    rootEl.innerHTML = renderCreateForm(snap);
    rootEl.hidden = false;
    return;
  }

  rootEl.innerHTML = renderCreateCta();
  rootEl.hidden = false;
}

function bindLobbyPollSheet(rootEl) {
  if (!rootEl || rootEl.dataset.pollBound === "1") return;
  rootEl.dataset.pollBound = "1";

  rootEl.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    const id = t.getAttribute("data-poll-pick");
    if (!id) return;
    if (t.checked) createDraftIds.add(id);
    else createDraftIds.delete(id);
  });

  rootEl.addEventListener("click", async (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    if (t.closest("[data-poll-open-create]")) {
      createFormOpen = true;
      renderLobbyPollSheet(rootEl);
      return;
    }

    if (t.closest("[data-poll-cancel-create]")) {
      createFormOpen = false;
      createDraftIds = new Set();
      renderLobbyPollSheet(rootEl);
      return;
    }

    const createBtn = t.closest("[data-poll-create]");
    if (createBtn) {
      const ids = [...createDraftIds];
      const res = await createLobbyPollFromCatalog(ids);
      if (!res.ok) {
        await showAppAlert(res.error || "Création impossible.", {
          title: "Sondage",
          icon: "📊",
        });
        if (hostEl) renderLobbyPollSheet(hostEl);
      } else {
        createFormOpen = false;
        createDraftIds = new Set();
      }
      return;
    }

    const voteBtn = t.closest("[data-poll-vote]");
    if (voteBtn) {
      const gameId = voteBtn.getAttribute("data-poll-vote");
      if (!gameId) return;
      const res = await castLobbyPollVote(gameId);
      if (!res.ok) {
        await showAppAlert(res.error || "Vote impossible.", {
          title: "Sondage",
          icon: "📊",
        });
      }
      return;
    }

    const closeBtn = t.closest("[data-poll-close]");
    if (closeBtn) {
      const res = await closeLobbyPollExplicit();
      if (!res.ok) {
        await showAppAlert(res.error || "Fermeture impossible.", {
          title: "Sondage",
          icon: "📊",
        });
      }
    }
  });
}

/** Monte le pin dans le sheet ouvert ; nettoie à la fermeture. */
export function mountLobbyPollInChatSheet(sheetRoot) {
  if (!sheetRoot) return () => {};
  const panel = sheetRoot.querySelector(".chat-sheet__panel");
  const messages = sheetRoot.querySelector("#chat-sheet-messages");
  if (!panel || !messages) return () => {};

  let slot = sheetRoot.querySelector("#chat-sheet-poll");
  if (!slot) {
    slot = document.createElement("div");
    slot.id = "chat-sheet-poll";
    slot.className = "chat-sheet__poll";
    panel.insertBefore(slot, messages);
  }

  hostEl = slot;
  createFormOpen = false;
  markLobbyPollSeen();
  bindLobbyPollSheet(slot);
  renderLobbyPollSheet(slot);

  unsub?.();
  unsub = onLobbyPollChange(() => {
    if (hostEl) renderLobbyPollSheet(hostEl);
  });

  return () => {
    unsub?.();
    unsub = null;
    hostEl = null;
    createFormOpen = false;
  };
}
