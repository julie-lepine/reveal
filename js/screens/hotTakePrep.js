import {
  addCustomTake,
  allHotTakeReady,
  getHotTakeSession,
  getHotTakePrepSummary,
  getModerationNotice,
  isLocalHotTakeHost,
  markHotTakeLobbyStarted,
  resetHotTakeReady,
  simulateHotTakeReady,
  toggleLocalHotTakeReady,
  setHotTakeTheme,
  setHotTakeRoundCount,
  HOT_TAKE_THEMES,
  HOT_TAKE_ROUND_PRESETS,
  HOT_TAKE_ROUND_ALL,
  HOT_TAKE_CATALOG_ID,
} from "../core/hotTakeSession.js";
import { getLobbyParticipants } from "../core/lobby.js";
import { getLocalDisplayName } from "../core/state.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

function formatTake(t) {
  if (typeof t === "string") return { text: t, author: null };
  return t;
}

export function mountHotTakePrep(app) {
  if (!requireLobbyPlay()) return null;

  let cleanupSim = null;
  const moderationNotice = getModerationNotice();

  function render() {
    const session = getHotTakeSession();
    const members = getLobbyParticipants();
    const allReady = allHotTakeReady();
    const localReady = session.ready[getLocalDisplayName()];
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
                ? `<p class="hint">${prep.poolSize} take(s) dans le deck — tous les thèmes fusionnés (sans doublons).</p>`
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
          ${
            session.customTakes?.length
              ? `<ul class="take-list">${session.customTakes
                  .map((t) => {
                    const x = formatTake(t);
                    return `<li><strong>${escapeHtml(x.author || "Toi")}</strong> : ${escapeHtml(x.text)}</li>`;
                  })
                  .join("")}</ul>`
              : ""
          }
        </div>

        <div class="card">
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

        ${
          allReady && prep.effective > 0
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-start-game">Lancer Hot Take →</button>`
            : `<button type="button" class="btn btn-secondary btn--spaced" disabled>${
                prep.effective === 0 ? "Aucune take disponible" : "En attente des joueurs…"
              }</button>`
        }
      `,
    });

    bindNav(app);

    app.querySelectorAll("[data-round]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!isHost || btn.disabled) return;
        setHotTakeRoundCount(Number(btn.getAttribute("data-round")));
        render();
      });
    });

    app.querySelectorAll("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!isHost) return;
        setHotTakeTheme(btn.getAttribute("data-theme"));
        render();
      });
    });

    app.querySelector("#add-take")?.addEventListener("click", () => {
      const err = app.querySelector("#take-error");
      const res = addCustomTake(app.querySelector("#new-take").value);
      if (!res.ok) {
        err.textContent = res.error;
        err.classList.remove("hidden");
        return;
      }
      err.classList.add("hidden");
      app.querySelector("#new-take").value = "";
      render();
    });

    app.querySelector("#btn-ready")?.addEventListener("click", () => {
      const name = getLocalDisplayName();
      const wasReady = Boolean(session.ready[name]);
      toggleLocalHotTakeReady();
      if (!wasReady) {
        if (cleanupSim) cleanupSim();
        cleanupSim = simulateHotTakeReady(render);
      }
      render();
    });

    app.querySelector("#btn-start-game")?.addEventListener("click", () => {
      markHotTakeLobbyStarted();
      navigate("hottake");
    });
  }

  resetHotTakeReady();
  render();

  return () => {
    if (cleanupSim) cleanupSim();
  };
}
