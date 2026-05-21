import {
  addCustomDilemma,
  removeCustomDilemma,
  allDilemmaReady,
  countOtherPlayersCustomDilemmas,
  getDilemmaPrepSummary,
  getDilemmaSession,
  getMyCustomDilemmas,
  getModerationNotice,
  isLocalDilemmaHost,
  markDilemmaLobbyStarted,
  setDilemmaReady,
  setDilemmaRoundCount,
  setDilemmaDeck,
  simulateDilemmaReady,
  DILEMMA_DECKS,
  DILEMMA_ROUND_PRESETS,
  DILEMMA_ROUND_ALL,
  DILEMMA_CATALOG_ID,
} from "../core/dilemmaSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { onLobbyBundleUpdated } from "../core/supabaseLobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import {
  isGameSyncActive,
  isLobbyHost,
  onGameSessionChange,
  refreshGameSession,
} from "../core/gameSync.js";
import { navigate, getCurrentScreen } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountDilemmaPrep(app) {
  if (!requireLobbyPlay()) return null;

  let cleanupSim = null;
  let readyCommitInFlight = null;
  let mounted = false;
  const localName = getLocalDisplayName();
  const moderationNotice = getModerationNotice();

  function captureDraft() {
    return {
      optionA: app.querySelector("#dilemma-option-a")?.value ?? "",
      optionB: app.querySelector("#dilemma-option-b")?.value ?? "",
      focusedId: document.activeElement?.id || null,
    };
  }

  function restoreDraft(state) {
    if (!state) return;
    const inputA = app.querySelector("#dilemma-option-a");
    const inputB = app.querySelector("#dilemma-option-b");
    if (inputA) inputA.value = state.optionA;
    if (inputB) inputB.value = state.optionB;
    if (state.focusedId === "dilemma-option-a") inputA?.focus();
    if (state.focusedId === "dilemma-option-b") inputB?.focus();
  }

  function customDilemmasListHtml() {
    const mine = getMyCustomDilemmas();
    if (!mine.length) return "";
    return `<ul class="take-list dilemma-custom-list">${mine
      .map(
        (d) =>
          `<li class="dilemma-custom-list__item">
            <span class="dilemma-custom-list__a">${escapeHtml(d.optionA)}</span>
            <span class="dilemma-custom-list__vs">VS</span>
            <span class="dilemma-custom-list__b">${escapeHtml(d.optionB)}</span>
            <button type="button" class="btn-link dilemma-custom-list__remove" data-remove-dilemma="${escapeHtml(d.id)}" aria-label="Supprimer ce dilemme">Supprimer</button>
          </li>`
      )
      .join("")}</ul>`;
  }

  function othersDilemmasHintHtml() {
    const n = countOtherPlayersCustomDilemmas();
    if (!n) return "";
    return `<p class="hint" id="dilemma-others-hint">${n} dilemme${n > 1 ? "s" : ""} d'autres joueurs — révélé${n > 1 ? "s" : ""} en manche.</p>`;
  }

  function renderCustomDilemmasList() {
    const card = app.querySelector("#dilemma-option-a")?.closest(".card");
    if (!card) return;

    let list = card.querySelector(".dilemma-custom-list");
    const listHtml = customDilemmasListHtml();
    if (!listHtml) list?.remove();
    else if (list) list.outerHTML = listHtml;
    else {
      const anchor = card.querySelector("#dilemma-error") || card.querySelector(".moderation-notice");
      anchor?.insertAdjacentHTML("afterend", listHtml);
    }

    let hint = card.querySelector("#dilemma-others-hint");
    const hintHtml = othersDilemmasHintHtml();
    if (!hintHtml) hint?.remove();
    else if (hint) hint.outerHTML = hintHtml;
    else card.insertAdjacentHTML("beforeend", hintHtml);
  }

  function localReadyState() {
    if (readyCommitInFlight !== null) return readyCommitInFlight;
    return Boolean(getDilemmaSession().ready[localName]);
  }

  function dilemmaStartSlotHtml(allReady, prep) {
    if (prep.effective === 0) {
      return `<button type="button" class="btn btn-secondary btn--spaced" disabled>Aucun dilemme disponible</button>`;
    }
    if (allReady && isLobbyHost()) {
      return `<button type="button" class="btn btn-primary btn--spaced" id="btn-start-game">Lancer Dilemma →</button>`;
    }
    if (allReady) {
      return `<button type="button" class="btn btn-secondary btn--spaced" disabled>En attente de l'hôte…</button>`;
    }
    return `<button type="button" class="btn btn-secondary btn--spaced" disabled>En attente des joueurs…</button>`;
  }

  function refreshReadySection() {
    const session = getDilemmaSession();
    const members = getLobbyParticipants();
    const allReady = allDilemmaReady();
    const localReady = localReadyState();
    const prep = getDilemmaPrepSummary();

    const playersCard = app.querySelector("#dilemma-players");
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

    const startSlot = app.querySelector("#dilemma-start-slot");
    if (startSlot) {
      startSlot.innerHTML = dilemmaStartSlotHtml(allReady, prep);
      startSlot.querySelector("#btn-start-game")?.addEventListener("click", onStartGame);
    }
  }

  function refreshDeckAndRounds() {
    const session = getDilemmaSession();
    const deckId = session.selectedDeckId || DILEMMA_CATALOG_ID;
    const roundCount = session.roundCount ?? 8;
    const isHost = isLocalDilemmaHost();
    const prep = getDilemmaPrepSummary();
    app.querySelectorAll("[data-deck]").forEach((btn) => {
      const id = btn.getAttribute("data-deck");
      btn.classList.toggle("theme-chip--active", deckId === id);
      btn.disabled = !isHost;
    });

    const poolHint = app.querySelector("#dilemma-pool-hint");
    if (poolHint) {
      poolHint.textContent =
        prep.poolSize > 0
          ? `${prep.poolSize} dilemme(s) dans le deck (+ customs si ajoutés).`
          : "Ajoute des dilemmes dans data/dilemma.js ou crée les tiens ci-dessous.";
    }

    app.querySelectorAll("[data-round]").forEach((btn) => {
      const value = Number(btn.getAttribute("data-round"));
      const disabled =
        value === DILEMMA_ROUND_ALL ? prep.poolSize === 0 : prep.poolSize < value;
      btn.classList.toggle("theme-chip--active", roundCount === value);
      btn.disabled = disabled || !isHost;
    });

    const dur = app.querySelector("#dilemma-duration");
    if (dur) {
      dur.innerHTML = `
        <strong>${prep.effective}</strong> dilemme${prep.effective > 1 ? "s" : ""}
        · ${escapeHtml(prep.durationLabel)}
        <span class="muted"> (estimation)</span>`;
    }

    renderCustomDilemmasList();
  }

  function refreshFromSync() {
    refreshDeckAndRounds();
    refreshReadySection();
  }

  async function onStartGame() {
    if (!isLobbyHost()) return;
    await markDilemmaLobbyStarted();
    navigate("dilemma", {
      navStack: ["home", "lobby", "game-select", "dilemma-prep", "dilemma"],
    });
  }

  function bindEvents() {
    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLocalDilemmaHost() || btn.disabled) return;
        const draft = captureDraft();
        await setDilemmaRoundCount(Number(btn.getAttribute("data-round")));
        render(draft);
      });
    });

    app.querySelectorAll("[data-deck]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isLocalDilemmaHost()) return;
        const draft = captureDraft();
        await setDilemmaDeck(btn.getAttribute("data-deck"));
        render(draft);
      });
    });

    app.querySelector("#add-dilemma")?.addEventListener("click", async () => {
      const err = app.querySelector("#dilemma-error");
      const res = await addCustomDilemma(
        app.querySelector("#dilemma-option-a")?.value,
        app.querySelector("#dilemma-option-b")?.value
      );
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      render(captureDraft());
      const inputA = app.querySelector("#dilemma-option-a");
      const inputB = app.querySelector("#dilemma-option-b");
      if (inputA) inputA.value = "";
      if (inputB) inputB.value = "";
    });

    app.querySelector("#btn-ready")?.addEventListener("click", async () => {
      const nextReady = !localReadyState();
      readyCommitInFlight = nextReady;
      refreshReadySection();
      try {
        await setDilemmaReady(localName, nextReady);
        if (!isGameSyncActive() && nextReady) {
          if (cleanupSim) cleanupSim();
          cleanupSim = simulateDilemmaReady(refreshReadySection);
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

    const session = getDilemmaSession();
    const localReady = localReadyState();
    const deckId = session.selectedDeckId || DILEMMA_CATALOG_ID;
    const roundCount = session.roundCount ?? 8;
    const isHost = isLocalDilemmaHost();
    const prep = getDilemmaPrepSummary();
    const members = getLobbyParticipants();
    const allReady = allDilemmaReady();

    const roundChips = [
      ...DILEMMA_ROUND_PRESETS.map((n) => ({
        value: n,
        label: String(n),
        disabled: prep.poolSize < n,
      })),
      {
        value: DILEMMA_ROUND_ALL,
        label: "Tout",
        disabled: prep.poolSize === 0,
      },
    ];

    app.innerHTML = pageShell({
      backTarget: "back",
      content: `
        <p class="label-upper label-upper--gold">⚖️ Dilemma</p>
        <h2 class="screen-title">Préparation</h2>
        <p class="game-intro">Choix impossible A vs B — vote, réactions emoji et reveal en 10 secondes. Ajoute tes dilemmes si tu veux.</p>

        <div class="card">
          <p class="card-heading">Deck de dilemmes</p>
          <div class="theme-chips">
            ${DILEMMA_DECKS.map(
              (d) => `
              <button type="button" class="theme-chip ${deckId === d.id ? "theme-chip--active" : ""}" data-deck="${d.id}"
                ${isHost ? "" : "disabled"}>
                ${escapeHtml(d.label)}
              </button>`
            ).join("")}
          </div>
          <p class="hint" id="dilemma-pool-hint"></p>
        </div>

        <div class="card">
          <p class="card-heading">Nombre de manches</p>
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
          <p class="hot-take-duration" id="dilemma-duration" aria-live="polite"></p>
          ${
            prep.capped
              ? `<p class="hint">Seulement ${prep.poolSize} dilemme(s) — toutes les manches seront jouées.</p>`
              : ""
          }
          ${!isHost ? `<p class="hint">Seul l'hôte peut modifier les réglages.</p>` : ""}
        </div>

        <div class="card">
          <p class="card-heading">Ton dilemme</p>
          <label class="field-label" for="dilemma-option-a">Option A</label>
          <input type="text" class="field-input" id="dilemma-option-a" maxlength="120" placeholder="Ex : Ne plus jamais dormir" />
          <label class="field-label" for="dilemma-option-b">Option B</label>
          <div class="join-row">
            <input type="text" class="field-input join-input" id="dilemma-option-b" maxlength="120" placeholder="Ex : Ne plus jamais manger chaud" />
            <button type="button" class="btn btn-secondary join-btn" id="add-dilemma">+</button>
          </div>
          <p class="moderation-notice">${escapeHtml(moderationNotice)}</p>
          <p class="auth-error hidden" id="dilemma-error"></p>
          ${customDilemmasListHtml()}
          ${othersDilemmasHintHtml()}
        </div>

        <div class="card" id="dilemma-players">
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

        <div id="dilemma-start-slot">${dilemmaStartSlotHtml(allReady, prep)}</div>
      `,
    });

    bindEvents();
    restoreDraft(draft);
    refreshDeckAndRounds();
    refreshReadySection();
    mounted = true;
  }

  async function onDilemmaPrepClick(e) {
    if (getCurrentScreen() !== "dilemma-prep") return;

    const removeBtn = e.target.closest("[data-remove-dilemma]");
    if (removeBtn) {
      e.preventDefault();
      const id = removeBtn.getAttribute("data-remove-dilemma");
      if (!id) return;
      await removeCustomDilemma(id);
      refreshFromSync();
    }
  }

  app.addEventListener("click", onDilemmaPrepClick);

  render();

  if (isGameSyncActive()) {
    void refreshGameSession().then(() => refreshFromSync());
  }

  const unsub = onGameSessionChange(() => {
    refreshFromSync();
  });

  const unsubLobby = onLobbyBundleUpdated(() => {
    if (!mounted) return;
    refreshFromSync();
  });

  return () => {
    app.removeEventListener("click", onDilemmaPrepClick);
    if (cleanupSim) cleanupSim();
    unsub();
    unsubLobby();
  };
}
