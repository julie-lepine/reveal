import {
  FIL_ROUGE_MIN_PLAYERS,
  FIL_ROUGE_STATUS,
  FIL_ROUGE_TILE,
  getFilRougeWordChoices,
} from "../../data/filRouge.js";
import {
  getFilRougeSession,
  startFilRougeSetup,
  submitFilRougeWord,
  allFilRougeWordsSubmitted,
  launchFilRougeMissions,
} from "../core/filRougeSession.js";
import { fetchMyFilRougePrivate } from "../core/filRougePrivate.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { isLobbyHost, onGameSessionChange, userIdForName } from "../core/gameSync.js";
import { navigate, getCurrentScreen } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { handleNavTarget } from "./nav.js";
import { getSupabaseUserId } from "../core/supabaseAuth.js";
import { showAppAlert } from "../core/dialog.js";

function setupSnapshot(session, localUid) {
  const subs = session.submissions || {};
  return JSON.stringify({
    status: session.status,
    localDone: Boolean(subs[localUid]),
    subs,
    allIn: allFilRougeWordsSubmitted(),
    playerCount: getLobbyParticipants().length,
  });
}

export function mountFilRougeSetup(app) {
  if (!requireLobbyPlay()) return null;

  let unsub = () => {};
  let renderTimer = null;
  let renderInFlight = false;
  let lastSnapshot = "";

  async function ensureSetup() {
    const s = getFilRougeSession();
    if (s.status === FIL_ROUGE_STATUS.COMPLETED) {
      navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
      return;
    }
    if (s.status === "idle") await startFilRougeSetup();
  }

  function getLocalUid() {
    return (
      getSupabaseUserId() ||
      userIdForName(getLobbyParticipants().find((p) => p.isLocal)?.name)
    );
  }

  function scheduleRender(force = false) {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      void renderIfNeeded(force);
    }, force ? 0 : 280);
  }

  async function renderIfNeeded(force = false) {
    const session = getFilRougeSession();
    const localUid = getLocalUid();
    const snap = setupSnapshot(session, localUid);

    const input = app.querySelector("#fil-rouge-word");
    const draft = input?.value ?? "";
    const inputFocused = document.activeElement === input;

    if (!force && inputFocused) return;
    if (!force && snap === lastSnapshot) return;

    if (renderInFlight) {
      scheduleRender(false);
      return;
    }

    renderInFlight = true;
    try {
      await paint(draft, inputFocused);
      lastSnapshot = snap;
    } finally {
      renderInFlight = false;
    }
  }

  async function paint(preservedDraft = "", refocusInput = false) {
    const session = getFilRougeSession();
    const host = isLobbyHost();
    const localUid = getLocalUid();
    const submitted = Boolean(session.submissions?.[localUid]);
    const allIn = allFilRougeWordsSubmitted();
    const participants = getLobbyParticipants();
    const playerCount = participants.length;
    const minPlayersMet = playerCount >= FIL_ROUGE_MIN_PLAYERS;
    const canLaunch = allIn && minPlayersMet;
    const submittedCount = participants.filter((p) => {
      const uid = p.userId || userIdForName(p.name);
      return session.submissions?.[uid];
    }).length;

    const minPlayersNotice = `
      <div class="fil-rouge-setup__req ${minPlayersMet ? "fil-rouge-setup__req--ok" : "fil-rouge-setup__req--warn"}" role="status">
        <span class="fil-rouge-setup__req-icon" aria-hidden="true">👥</span>
        <div class="fil-rouge-setup__req-body">
          <p class="fil-rouge-setup__req-title">Minimum ${FIL_ROUGE_MIN_PLAYERS} joueurs</p>
          <p class="fil-rouge-setup__req-detail">
            ${
              minPlayersMet
                ? `${playerCount} joueurs dans le lobby - c'est bon.`
                : `<strong>${playerCount} / ${FIL_ROUGE_MIN_PLAYERS}</strong> joueurs dans le lobby - invite au moins <strong>${FIL_ROUGE_MIN_PLAYERS - playerCount}</strong> personne${FIL_ROUGE_MIN_PLAYERS - playerCount > 1 ? "s" : ""} de plus.`
            }
          </p>
        </div>
      </div>`;

    const hostLaunchHint =
      host && !canLaunch
        ? `<div class="fil-rouge-setup__launch-hint" role="status">
            <p class="fil-rouge-setup__launch-hint-title">Pour lancer les missions</p>
            <ul class="fil-rouge-setup__launch-hint-list">
              <li class="${minPlayersMet ? "fil-rouge-setup__launch-hint-item--done" : "fil-rouge-setup__launch-hint-item--todo"}">
                ${minPlayersMet ? "✓" : "○"} Au moins ${FIL_ROUGE_MIN_PLAYERS} joueurs dans le lobby
              </li>
              <li class="${allIn ? "fil-rouge-setup__launch-hint-item--done" : "fil-rouge-setup__launch-hint-item--todo"}">
                ${allIn ? "✓" : "○"} Chaque joueur a soumis son mot interdit
                ${!allIn ? ` <span class="fil-rouge-setup__launch-hint-sub">(${submittedCount} / ${playerCount})</span>` : ""}
              </li>
            </ul>
          </div>`
        : "";

    const privateRow = submitted ? await fetchMyFilRougePrivate() : null;
    const myWord = privateRow?.setup_word
      ? `<p class="card card--ok">Ton mot : <strong>« ${escapeHtml(privateRow.setup_word)} »</strong></p>`
      : `<p class="card card--ok">Ton mot est enregistré. En attente des autres joueurs…</p>`;

    const progress = participants
      .map((p) => {
        const uid = p.userId || userIdForName(p.name);
        const done = session.submissions?.[uid];
        return `<span class="fil-rouge-setup__chip ${done ? "fil-rouge-setup__chip--done" : ""}">${escapeHtml(p.name)}${done ? " ✓" : ""}</span>`;
      })
      .join("");

    app.innerHTML = pageShell({
      backTarget: "game-select",
      content: `
        <p class="label-upper label-upper--muted">${FIL_ROUGE_TILE.emoji} Fil Rouge</p>
        <h2 class="screen-title">${escapeHtml(FIL_ROUGE_TILE.title)}</h2>
        <p class="hint">Chaque joueur propose un <strong>mot interdit</strong>. La cible sera tirée au hasard au lancement.</p>
        ${minPlayersNotice}

        ${
          submitted
            ? myWord
            : `
        <div class="card fil-rouge-setup__form">
          <label class="field-label" for="fil-rouge-word">Choisis ton mot interdit</label>
          <select class="field-input" id="fil-rouge-word">
            <option value="" disabled selected>Choisis un mot…</option>
            ${getFilRougeWordChoices(localUid)
              .map((w) => `<option value="${escapeHtml(w)}">${escapeHtml(w)}</option>`)
              .join("")}
          </select>
          <button type="button" class="btn btn-primary btn--spaced" id="fil-rouge-submit">Enregistrer mon mot</button>
        </div>`
        }

        <div class="fil-rouge-setup__progress">${progress}</div>

        ${
          host
            ? `${hostLaunchHint}
        <button type="button" class="btn btn-primary btn--spaced" id="fil-rouge-launch" ${canLaunch ? "" : "disabled"}>
          Lancer les missions
        </button>`
            : `<p class="hint">En attente que l'hôte lance les missions…</p>`
        }
      `,
    });

    const wordInput = app.querySelector("#fil-rouge-word");
    if (wordInput && preservedDraft) {
      wordInput.value = preservedDraft;
      if (refocusInput) {
        wordInput.focus();
        if (typeof wordInput.setSelectionRange === "function") {
          const len = wordInput.value.length;
          wordInput.setSelectionRange(len, len);
        }
      }
    }

    app.querySelector("#fil-rouge-submit")?.addEventListener("click", async () => {
      const word = app.querySelector("#fil-rouge-word")?.value || "";
      if (!word) {
        await showAppAlert("Choisis un mot dans la liste.", {
          title: "Mot interdit",
          icon: "⚠️",
        });
        return;
      }
      try {
        const res = await submitFilRougeWord(word);
        if (!res.ok) {
          await showAppAlert(res.error, { title: "Mot interdit", icon: "⚠️" });
          return;
        }
        scheduleRender(true);
      } catch (e) {
        console.error("[fil-rouge-setup] submit", e);
        await showAppAlert(e.message || "Erreur de synchronisation.", {
          title: "Mot interdit",
          icon: "⚠️",
        });
      }
    });

    app.querySelector("#fil-rouge-launch")?.addEventListener("click", async () => {
      const res = await launchFilRougeMissions();
      if (!res.ok) {
        await showAppAlert(res.error, { title: "Lancement", icon: "⚠️" });
        return;
      }
      navigate("filrouge-mission", {
        navStack: ["home", "lobby", "game-select", "filrouge-mission"],
      });
    });
  }

  function onSetupClick(e) {
    if (getCurrentScreen() !== "filrouge-setup") return;
    const navEl = e.target.closest("[data-nav]");
    if (navEl) {
      void handleNavTarget(navEl.getAttribute("data-nav"), {});
    }
  }

  app.addEventListener("click", onSetupClick);

  void ensureSetup().then(() => {
    scheduleRender(true);
    unsub = onGameSessionChange(() => {
      const s = getFilRougeSession();
      if (s.status === "active") {
        navigate("filrouge-mission", {
          navStack: ["home", "lobby", "game-select", "filrouge-mission"],
        });
        return;
      }
      scheduleRender(false);
    });
  });

  return () => {
    app.removeEventListener("click", onSetupClick);
    unsub();
    if (renderTimer) clearTimeout(renderTimer);
  };
}
