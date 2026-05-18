import { getLocalDisplayName, markGuessLieLobbyComplete, setGuessLieSubmission } from "../core/state.js";
import {
  allLobbySubmitted,
  fallbackForPlayer,
  getGuessLieSession,
  getLobbyMemberNames,
} from "../core/guessLieSession.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { navigate } from "../core/router.js";
import { escapeHtml, logoHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";

export function mountGuessLieLobbyWait(app) {
  if (!requireLobbyPlay()) return null;

  let intervalId = null;
  let simIdx = 0;
  const localName = getLocalDisplayName();

  function render() {
    const session = getGuessLieSession();
    const members = getLobbyMemberNames();

    app.innerHTML = pageShell({
      back: false,
      content: `
        <div class="logo logo--with-img">
          ${logoHtml({ className: "app-logo app-logo--sm" })}
        </div>
        <p class="label-upper label-upper--green">🕵️ Lobby Guess The Lie</p>
        <h2 class="screen-title">En attente des joueurs</h2>
        <p class="game-intro">
          Rotation : chaque joueur du lobby aura sa manche. La partie démarre quand tout le monde a envoyé ses 3 affirmations.
        </p>

        <div class="card">
          ${members
            .map((name) => {
              const ready = Boolean(session.submissions[name]);
              return `
            <div class="lobby-player ${ready ? "lobby-player--ready" : ""}">
              <span class="lobby-player__status">${ready ? "✓" : "…"}</span>
              <span class="lobby-player__name">${escapeHtml(name)}${name === localName ? " (vous)" : ""}</span>
            </div>>`;
            })
            .join("")}
        </div>>

        <p class="hint" id="wait-hint">
          ${allLobbySubmitted() ? "Tout le monde est prêt !" : "Les autres joueurs préparent leurs affirmations…"}
        </p>

        ${
          allLobbySubmitted()
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-start">Lancer la partie →</button>`
            : `<button type="button" class="btn btn-secondary btn--spaced" disabled>En attente…</button>`
        }
        <button type="button" class="btn btn-secondary btn--spaced" data-nav="game-select">Retour</button>
      `,
    });

    bindNav(app);

    app.querySelector("#btn-start")?.addEventListener("click", () => {
      markGuessLieLobbyComplete();
      navigate("guesslie", { reset: true });
    });
  }

  function simulateNextNpc() {
    const queue = getLobbyMemberNames().filter((n) => n !== localName);
    if (simIdx >= queue.length) {
      render();
      return;
    }
    const name = queue[simIdx];
    simIdx += 1;
    const session = getGuessLieSession();
    if (!session.submissions[name]) {
      setGuessLieSubmission(name, fallbackForPlayer(name));
    }
    render();
    if (simIdx < queue.length) {
      intervalId = setTimeout(simulateNextNpc, 800 + Math.random() * 600);
    }
  }

  render();
  intervalId = setTimeout(simulateNextNpc, 400);

  return () => {
    if (intervalId) clearTimeout(intervalId);
  };
}
