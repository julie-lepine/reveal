import { getLocalDisplayName } from "../core/state.js";
import {
  allLobbySubmitted,
  getGuessLieEntryScreen,
  getGuessLieSession,
  getLobbyMemberNames,
  handleGuessLieLaunch,
} from "../core/guessLieSession.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { prepGuestFollowOnSession } from "../core/mpLaunch.js";
import { navigate } from "../core/router.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { isLobbyHost, onGameSessionChange } from "../core/gameSync.js";

export function mountGuessLieLobbyWait(app) {
  if (!requireLobbyPlay()) return null;

  const localName = getLocalDisplayName();
  let launching = false;

  function followIfStarted() {
    const entry = getGuessLieEntryScreen();
    if (entry === "guesslie-wait") return false;
    navigate(entry, { reset: true });
    return true;
  }

  function render() {
    if (launching) return;
    if (getGuessLieSession().lobbyComplete) {
      followIfStarted();
      return;
    }

    const session = getGuessLieSession();
    const members = getLobbyMemberNames();
    const allReady = allLobbySubmitted();
    const started = Boolean(session.lobbyComplete);

    app.innerHTML = pageShell({
      back: false,
      content: `
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
            </div>`;
            })
            .join("")}
        </div>

        <p class="hint" id="wait-hint">
          ${
            started
              ? "Lancement de la partie…"
              : allReady
                ? "Tout le monde est prêt !"
                : "Les autres joueurs préparent leurs affirmations…"
          }
        </p>

        ${
          allReady && isLobbyHost() && !started
            ? `<button type="button" class="btn btn-primary btn--spaced" id="btn-start">Lancer la partie →</button>`
            : allReady && !started
              ? `<button type="button" class="btn btn-secondary btn--spaced" disabled>En attente de l'hôte…</button>`
              : started
                ? `<button type="button" class="btn btn-secondary btn--spaced" disabled>Lancement…</button>`
                : `<button type="button" class="btn btn-secondary btn--spaced" disabled>En attente…</button>`
        }
        <button type="button" class="btn btn-secondary btn--spaced" data-nav="game-select">Retour</button>
      `,
    });

    bindNav(app);
  }

  async function onStartClick(e) {
    const btn = e.target.closest("#btn-start");
    if (!btn || launching) return;
    if (getGuessLieSession().lobbyComplete) {
      followIfStarted();
      return;
    }
    launching = true;
    try {
      await handleGuessLieLaunch(btn);
      followIfStarted();
    } finally {
      launching = false;
      render();
    }
  }

  const guestFollow = prepGuestFollowOnSession({
    prepScreen: "guesslie-wait",
    getEntryScreen: getGuessLieEntryScreen,
  });

  function onSessionUpdate() {
    if (launching) return;
    if (guestFollow()) return;
    if (followIfStarted()) return;
    render();
  }

  app.addEventListener("click", onStartClick);
  render();
  if (followIfStarted()) {
    return () => app.removeEventListener("click", onStartClick);
  }

  const unsub = onGameSessionChange(onSessionUpdate);

  return () => {
    unsub();
    app.removeEventListener("click", onStartClick);
  };
}
