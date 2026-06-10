import { escapeHtml } from "../core/ui.js";
import { rulesButtonHtml } from "../core/gameRulesUi.js";
import { prepStartSlotHtml } from "../core/prepScreen.js";

export function renderTriviaSetup({
  themeId,
  themes = [],
  questionCount,
  countPresets = [],
  isHost = false,
  prep,
  members = [],
  readyMap = {},
  localReady = false,
  allReady = false,
} = {}) {
  return `
    <p class="label-upper label-upper--gold">🧠 Trivia Quiz</p>
    <div class="screen-title-row">
      <h2 class="screen-title">Configuration</h2>
      ${rulesButtonHtml("trivia")}
    </div>
    <p class="game-intro">Répondez juste, mais surtout vite : une bonne réponse vaut +10 pts, le plus rapide a répondre juste prend +10 pts bonus. La manche se cloture des que tout le monde a répondu.</p>

    <div class="card">
      <p class="card-heading">Theme</p>
      <div class="theme-chips">
        ${themes
          .map(
            (theme) => `
          <button
            type="button"
            class="theme-chip ${theme.id === themeId ? "theme-chip--active" : ""}"
            data-trivia-theme="${escapeHtml(theme.id)}"
            ${isHost ? "" : "disabled"}
          >
            ${escapeHtml(theme.label)}
          </button>`
          )
          .join("")}
      </div>
      <p class="hint">
        Banque disponible : ${prep.poolSize} question${prep.poolSize > 1 ? "s" : ""}
        ${prep.launchable ? "" : ` · il en manque ${prep.missing} pour lancer ${prep.requested}`}
      </p>
    </div>

    <div class="card">
      <p class="card-heading">Nombre de questions</p>
      <div class="theme-chips theme-chips--rounds">
        ${countPresets
          .map(
            (count) => `
          <button
            type="button"
            class="theme-chip ${count === questionCount ? "theme-chip--active" : ""}"
            data-trivia-count="${count}"
            ${isHost ? "" : "disabled"}
          >
            ${count}
          </button>`
          )
          .join("")}
      </div>
      <p class="hot-take-duration">
        <strong>${prep.requested}</strong> question${prep.requested > 1 ? "s" : ""}
        · ${escapeHtml(prep.durationLabel)}
      </p>
      ${!isHost ? `<p class="hint">Seul l'hote peut modifier les reglages.</p>` : ""}
    </div>

    <div class="card" id="trivia-players">
      <p class="card-heading">Joueurs prets</p>
      ${members
        .map(
          (member) => `
        <div class="lobby-player ${readyMap[member.name] ? "lobby-player--ready" : ""}">
          <span class="lobby-player__status">${readyMap[member.name] ? "✓" : "…"}</span>
          <span class="lobby-player__name">${escapeHtml(member.name)}</span>
        </div>`
        )
        .join("")}
    </div>

    <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-trivia-ready">
      ${localReady ? "Pret ✓" : "Je suis pret !"}
    </button>

    <div id="trivia-start-slot">
      ${prepStartSlotHtml({
        allReady,
        isHost,
        launchLabel: "Lancer le quiz",
        startButtonId: "btn-trivia-start",
      })}
    </div>`;
}
