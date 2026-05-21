import {
  addCustomTake,
  allHotTakeReady,
  countOtherPlayersCustomTakes,
  getHotTakeSession,
  getMyCustomTakes,
  getHotTakePrepSummary,
  getModerationNotice,
  isLocalHotTakeHost,
  markHotTakeLobbyStarted,
  setHotTakeReady,
  simulateHotTakeReady,
  setHotTakeTheme,
  setHotTakeRoundCount,
  HOT_TAKE_THEMES,
  HOT_TAKE_ROUND_PRESETS,
  HOT_TAKE_ROUND_ALL,
  HOT_TAKE_CATALOG_ID,
  HOT_TAKE_MIX_ID,
} from "../core/hotTakeSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { onLobbyBundleUpdated } from "../core/supabaseLobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { isGameSyncActive, isLobbyHost, onGameSessionChange } from "../core/gameSync.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountHotTakePrep(app) {
  if (!requireLobbyPlay()) return null;

  let cleanupSim = null;
  let mounted = false;
  /** Prêt en cours d’envoi — évite que la synchro efface l’UI. */
  let readyCommitInFlight = null;
  const localName = getLocalDisplayName();
  const moderationNotice = getModerationNotice();

  function captureDraft() {
    const input = app.querySelector("#new-take");
    return {
      value: input?.value ?? "",
      focused: document.activeElement === input,
      selStart: input?.selectionStart ?? 0,
      selEnd: input?.selectionEnd ?? 0,
    };
  }

  function restoreDraft(state) {
    const input = app.querySelector("#new-take");
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

  function customTakesListHtml() {
    const myTakes = getMyCustomTakes();
    if (!myTakes.length) return "";
    return `<ul class="take-list">${myTakes
      .map((t) => `<li>${escapeHtml(t.text)}</li>`)
      .join("")}</ul>`;
  }

  function othersTakesHintHtml() {
    const n = countOtherPlayersCustomTakes();
    if (!n) return "";
    return `<p class="hint" id="hot-take-others-hint">${n} hot take${n > 1 ? "s" : ""} d'autres joueurs — révélée${n > 1 ? "s" : ""} en manche.</p>`;
  }

  function renderCustomTakesList() {
    const card = app.querySelector("#new-take")?.closest(".card");
    if (!card) return;

    let list = card.querySelector(".take-list");
    const listHtml = customTakesListHtml();
    if (!listHtml) list?.remove();
    else if (list) list.outerHTML = listHtml;
    else {
      const anchor = card.querySelector("#take-error") || card.querySelector(".moderation-notice");
      anchor?.insertAdjacentHTML("afterend", listHtml);
    }

    let hint = card.querySelector("#hot-take-others-hint");
    const hintHtml = othersTakesHintHtml();
    if (!hintHtml) hint?.remove();
    else if (hint) hint.outerHTML = hintHtml;
    else card.insertAdjacentHTML("beforeend", hintHtml);
  }

  function localReadyState() {
    if (readyCommitInFlight !== null) return readyCommitInFlight;
    return Boolean(getHotTakeSession().ready[localName]);
  }

  function hotTakeStartSlotHtml(allReady, prep) {
    if (prep.effective === 0) {
      return `<button type="button" class="btn btn-secondary btn--spaced" disabled>Aucune take disponible</button>`;
    }
    if (allReady && isLobbyHost()) {
      return `<button type="button" class="btn btn-primary btn--spaced" id="btn-start-game">Lancer Hot Take →</button>`;
    }
    if (allReady) {
      return `<button type="button" class="btn btn-secondary btn--spaced" disabled>En attente de l'hôte…</button>`;
    }
    return `<button type="button" class="btn btn-secondary btn--spaced" disabled>En attente des joueurs…</button>`;
  }

  function refreshReadySection() {
    const session = getHotTakeSession();
    const members = getLobbyParticipants();
    const allReady = allHotTakeReady();
    const localReady = localReadyState();
    const prep = getHotTakePrepSummary();

    const playersCard = app.querySelector("#hot-take-players");
    if (playersCard) {
      playersCard.innerHTML = `
        <p class="card-heading">Joueurs prêts</p>
        ${members
          .map(
            (m) => `
          <div class="lobby-player ${session.ready[m.name] ? "lobby-player--ready" : ""}">
            <span class="lobby-player__status">${session.ready[m.name] ? "✓" : "…"}</span>
            <span class="lobby-player__name">${escapeHtml(m.name)}</span>
          </div>`
          )
          .join("")}`;
    }

    const readyBtn = app.querySelector("#btn-ready");
    if (readyBtn) {
      readyBtn.classList.toggle("btn-ready--active", Boolean(localReady));
      readyBtn.textContent = localReady ? "Prêt ✓" : "Je suis prêt !";
    }

    const startSlot = app.querySelector("#hot-take-start-slot");
    if (startSlot) {
      startSlot.innerHTML = hotTakeStartSlotHtml(allReady, prep);
      startSlot.querySelector("#btn-start-game")?.addEventListener("click", onStartGame);
    }

    if (document.activeElement?.id !== "new-take") {
      renderCustomTakesList();
    }
  }

  function refreshThemeAndRounds() {
    const session = getHotTakeSession();
    const themeId = session.selectedThemeId || HOT_TAKE_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLocalHotTakeHost();
    const prep = getHotTakePrepSummary();

    app.querySelectorAll("[data-theme]").forEach((btn) => {
      const id = btn.getAttribute("data-theme");
      btn.classList.toggle("theme-chip--active", themeId === id);
      btn.disabled = !isHost;
    });

    const poolSize = prep.poolSize;
    app.querySelectorAll("[data-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-round"));
      const disabled =
        value === HOT_TAKE_ROUND_ALL ? poolSize === 0 : poolSize < value;
      btn.classList.toggle("theme-chip--active", roundCount === value);
      btn.disabled = disabled || !isHost;
    });

    const dur = app.querySelector("#hot-take-duration");
    if (dur) {
      dur.innerHTML = `
        <strong>${prep.effective}</strong> hot take${prep.effective > 1 ? "s" : ""}
        · ${escapeHtml(prep.durationLabel)}
        <span class="muted"> (estimation)</span>`;
    }
  }

  function refreshFromSync() {
    const draft = captureDraft();
    refreshThemeAndRounds();
    refreshReadySection();
    restoreDraft(draft);
  }

  async function onStartGame() {
    if (!isLobbyHost()) return;
    await markHotTakeLobbyStarted();
    navigate("hottake", {
      navStack: ["home", "lobby", "game-select", "hottake-prep", "hottake"],
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLocalHotTakeHost() || btn.disabled) return;
        const draft = captureDraft();
        await setHotTakeRoundCount(Number(btn.getAttribute("data-round")));
        render(draft);
      });
    });

    app.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLocalHotTakeHost()) return;
        const draft = captureDraft();
        await setHotTakeTheme(btn.getAttribute("data-theme"));
        render(draft);
      });
    });

    app.querySelector("#add-take")?.addEventListener("click", async () => {
      const err = app.querySelector("#take-error");
      const res = await addCustomTake(app.querySelector("#new-take").value);
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      render(captureDraft());
      const input = app.querySelector("#new-take");
      if (input) input.value = "";
    });

    app.querySelector("#btn-ready")?.addEventListener("click", async () => {
      const nextReady = !localReadyState();
      readyCommitInFlight = nextReady;
      refreshReadySection();
      try {
        await setHotTakeReady(localName, nextReady);
        if (!isGameSyncActive() && nextReady) {
          if (cleanupSim) cleanupSim();
          cleanupSim = simulateHotTakeReady(refreshReadySection);
        }
      } finally {
        readyCommitInFlight = null;
        refreshReadySection();
      }
    });

    app.querySelector("#btn-start-game")?.addEventListener("click", onStartGame);
  }

  function render(preserveDraft = null) {
    const draft = preserveDraft ?? (mounted ? captureDraft() : null);

    const session = getHotTakeSession();
    const members = getLobbyParticipants();
    const allReady = allHotTakeReady();
    const localReady = localReadyState();
    const themeId = session.selectedThemeId || HOT_TAKE_CATALOG_ID;
    const roundCount = session.roundCount ?? 5;
    const isHost = isLocalHotTakeHost();
    const prep = getHotTakePrepSummary();

    const roundChips = [
      ...HOT_TAKE_ROUND_PRESETS.map((n) => ({
        value: n,
        label: String(n),
        disabled: prep.poolSize < n,
      })),
      {
        value: HOT_TAKE_ROUND_ALL,
        label: "Tout",
        disabled: prep.poolSize === 0,
      },
    ];

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--hot">🔥 Hot Take</p>
        <h2 class="screen-title">Préparation</h2>
        <p class="game-intro">Choisis d'abord un thème, puis le nombre de manches. Ajoute tes prises si tu veux.</p>

        <div class="card">
          <p class="card-heading">Banque par thème</p>
          <div class="theme-chips">
            ${HOT_TAKE_THEMES.map(
              (th) => `
              <button type="button" class="theme-chip ${themeId === th.id ? "theme-chip--active" : ""}" data-theme="${th.id}"
                ${isHost ? "" : "disabled"}>
                ${escapeHtml(th.label)}
              </button>`
            ).join("")}
          </div>
          ${
            prep.poolSize > 0
              ? themeId === HOT_TAKE_CATALOG_ID
                ? `<p class="hint">${prep.poolSize} take(s) dans le deck — tous les thèmes fusionnés.</p>`
                : themeId === HOT_TAKE_MIX_ID
                  ? `<p class="hint">${prep.poolSize} take(s) tirées au hasard parmi tous les thèmes (+ customs).</p>`
                  : `<p class="hint">${prep.poolSize} take(s) dans ce thème (+ customs si ajoutées).</p>`
              : `<p class="hint">Ajoute un thème dans hotTakes.js pour commencer.</p>`
          }
        </div>

        <div class="card">
          <p class="card-heading">Nombre de hot takes</p>
          <div class="theme-chips theme-chips--rounds">
            ${roundChips
              .map(
                ({ value, label, disabled }) => `
              <button type="button" class="theme-chip ${roundCount === value ? "theme-chip--active" : ""}"
                data-round="${value}" ${disabled || !isHost ? "disabled" : ""}>
                ${label}
              </button>`
              )
              .join("")}
          </div>
          <p class="hot-take-duration" id="hot-take-duration" aria-live="polite">
            <strong>${prep.effective}</strong> hot take${prep.effective > 1 ? "s" : ""}
            · ${escapeHtml(prep.durationLabel)}
            <span class="muted"> (estimation)</span>
          </p>
          ${
            prep.capped
              ? `<p class="hint">Seulement ${prep.poolSize} take(s) dans le deck — toutes seront jouées.</p>`
              : ""
          }
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier le nombre de manches.</p>` : ""}
        </div>

        <div class="card">
          <label class="field-label" for="new-take">Ta hot take</label>
          <div class="join-row">
            <input type="text" class="field-input join-input" id="new-take" maxlength="120" placeholder="Ton opinion impopulaire…" />
            <button type="button" class="btn btn-secondary join-btn" id="add-take">+</button>
          </div>
          <p class="moderation-notice">${escapeHtml(moderationNotice)}</p>
          <p class="auth-error hidden" id="take-error"></p>
          ${customTakesListHtml()}
          ${othersTakesHintHtml()}
        </div>

        <div class="card" id="hot-take-players">
          <p class="card-heading">Joueurs prêts</p>
          ${members
            .map(
              (m) => `
            <div class="lobby-player ${session.ready[m.name] ? "lobby-player--ready" : ""}">
              <span class="lobby-player__status">${session.ready[m.name] ? "✓" : "…"}</span>
              <span class="lobby-player__name">${escapeHtml(m.name)}</span>
            </div>`
            )
            .join("")}
        </div>

        <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-ready">
          ${localReady ? "Prêt ✓" : "Je suis prêt !"}
        </button>

        <div id="hot-take-start-slot">${hotTakeStartSlotHtml(allReady, prep)}</div>
      `,
    });

    bindEvents();
    restoreDraft(draft);
    mounted = true;
  }

  render();

  const unsub = onGameSessionChange(() => {
    refreshFromSync();
  });

  const unsubLobby = onLobbyBundleUpdated(() => {
    if (!mounted) return;
    render(captureDraft());
  });

  return () => {
    if (cleanupSim) cleanupSim();
    unsub();
    unsubLobby();
  };
}
