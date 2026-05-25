import { escapeHtml } from "../core/ui.js";

export function renderConsensusSetup({
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
    <p class="label-upper label-upper--gold">🤝 Consensus</p>
    <h2 class="screen-title">Configuration</h2>
    <p class="game-intro">Tout le monde répond avec un slider de 0 à 100. Le but n'est pas d'avoir raison, mais de ressentir où le groupe va se placer.</p>

    <!-- Bloc Mode masqué temporairement. On garde la logique derrière pour le réactiver plus tard. -->

    <div class="card">
      <p class="card-heading">Nombre de questions</p>
      <div class="theme-chips theme-chips--rounds">
        ${countPresets
          .map(
            (count) => `
          <button
            type="button"
            class="theme-chip ${count === questionCount ? "theme-chip--active" : ""}"
            data-consensus-count="${count}"
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
        <span class="muted"> · ${prep.questionTimeSec}s par question</span>
      </p>
      <p class="hint">Banque disponible : ${prep.poolSize} question${prep.poolSize > 1 ? "s" : ""}</p>
      ${!isHost ? `<p class="hint">Seul l'hôte peut modifier les réglages.</p>` : ""}
    </div>

    <div class="card" id="consensus-players">
      <p class="card-heading">Joueurs prêts</p>
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

    <button type="button" class="btn btn-ready ${localReady ? "btn-ready--active" : ""}" id="btn-consensus-ready">
      ${localReady ? "Prêt ✓" : "Je suis prêt !"}
    </button>

    <div id="consensus-start-slot">
      ${
        allReady
          ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-consensus-start">Lancer Consensus</button>`
          : '<button type="button" class="btn btn-secondary btn--spaced" disabled>En attente des joueurs…</button>'
      }
    </div>`;
}
