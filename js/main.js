import { initRouter, registerScreen, navigate, resetNav } from "./core/router.js";
import { initBottomNav } from "./core/bottomNav.js";
import {
  parseJoinCodeFromHash,
  hasActiveLobby,
  resumeEveningSession,
  reconcileLobbyMembership,
} from "./core/lobby.js";
import { initSupabaseAuth } from "./core/supabaseAuth.js";
import { initSpotifyAuth } from "./core/spotifyAuth.js";
import { mountHome } from "./screens/home.js";
import { mountLobby } from "./screens/lobby.js";
import { mountGameSelect } from "./screens/gameSelect.js";
import { mountLeaderboard } from "./screens/leaderboard.js";
import { mountResults } from "./screens/results.js";
import { mountGuessLieMenu } from "./screens/guessLieMenu.js";
import { mountGuessLieSetup } from "./screens/guessLieSetup.js";
import { mountGuessLieLobbyWait } from "./screens/guessLieLobbyWait.js";
import { mountTierNightSelect } from "./screens/tierNightSelect.js";
import { mountTierNightCreate } from "./screens/tierNightCreate.js";
import { mountTierNightEnd } from "./screens/tierNightEnd.js";
import { mountHotTakePrep } from "./screens/hotTakePrep.js";
import { mountSpeedVotePrep } from "./screens/speedVotePrep.js";
import { mountPlaylistGuessPrep } from "./screens/playlistGuessPrep.js";
import { mountTruthMeterPrep } from "./screens/truthMeterPrep.js";
import { mountDilemmaPrep } from "./screens/dilemmaPrep.js";
import { mountTriviaSetup } from "./screens/triviaSetup.js";
import { mountConsensusSetup } from "./screens/consensusSetup.js";
import { mountSettings } from "./screens/settings.js";
import { mountHotTake } from "./games/hotTake.js";
import { mountSpeedVote } from "./games/speedVote.js";
import { mountPlaylistGuess } from "./games/playlistGuess.js";
import { mountTruthMeter } from "./games/truthMeter.js";
import { mountDilemma } from "./games/dilemma.js";
import { mountTrivia } from "./games/trivia.js";
import { mountConsensus } from "./games/consensus.js";
import { mountGuessLie } from "./games/guessLie.js";
import { mountTierNight } from "./games/tierNight.js";
import { mountFilRougeSetup } from "./screens/filRougeSetup.js";
import { mountFilRougeMission } from "./screens/filRougeMission.js";
import { initFilRougeResultsListener } from "./core/filRougeResultsModal.js";
import { initFilRougeValidationListener } from "./core/filRougeToast.js";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Élément #app introuvable");
}

const joinCode = parseJoinCodeFromHash();
if (joinCode) {
  sessionStorage.setItem("reveal-pending-join", joinCode);
  if (window.history.replaceState) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

initRouter(app);

registerScreen("home", mountHome);
registerScreen("settings", mountSettings);
registerScreen("lobby", mountLobby);
registerScreen("game-select", mountGameSelect);
registerScreen("results", mountResults);
registerScreen("leaderboard", mountLeaderboard);
registerScreen("guesslie-menu", mountGuessLieMenu);
registerScreen("guesslie-setup", mountGuessLieSetup);
registerScreen("guesslie-wait", mountGuessLieLobbyWait);
registerScreen("tiernight-select", mountTierNightSelect);
registerScreen("tiernight-create", mountTierNightCreate);
registerScreen("tiernight-end", mountTierNightEnd);
registerScreen("hottake-prep", mountHotTakePrep);
registerScreen("hottake", mountHotTake);
registerScreen("speedvote-prep", mountSpeedVotePrep);
registerScreen("speedvote", mountSpeedVote);
registerScreen("playlistguess-prep", mountPlaylistGuessPrep);
registerScreen("playlistguess", mountPlaylistGuess);
registerScreen("truthmeter-prep", mountTruthMeterPrep);
registerScreen("truthmeter", mountTruthMeter);
registerScreen("dilemma-prep", mountDilemmaPrep);
registerScreen("dilemma", mountDilemma);
registerScreen("trivia-prep", mountTriviaSetup);
registerScreen("trivia", mountTrivia);
registerScreen("consensus-prep", mountConsensusSetup);
registerScreen("consensus", mountConsensus);
registerScreen("guesslie", mountGuessLie);
registerScreen("tiernight", mountTierNight);
registerScreen("filrouge-setup", mountFilRougeSetup);
registerScreen("filrouge-mission", mountFilRougeMission);

initBottomNav();
initFilRougeResultsListener();
initFilRougeValidationListener();

async function boot() {
  await initSupabaseAuth();
  const spotifyAuth = await initSpotifyAuth();
  await reconcileLobbyMembership();
  resetNav();
  navigate("home", { reset: true });
  if (spotifyAuth?.connected) {
    try {
      const returnScreen = sessionStorage.getItem("reveal-spotify-return");
      sessionStorage.removeItem("reveal-spotify-return");
      if (returnScreen === "playlistguess-prep" && hasActiveLobby()) {
        const { navigate: nav } = await import("./core/router.js");
        nav("playlistguess-prep", {
          navStack: ["home", "lobby", "game-select", "playlistguess-prep"],
        });
      }
    } catch {
      /* ignore */
    }
  }
  if (hasActiveLobby()) {
    void resumeEveningSession({ force: true });
  }
}

boot().catch((e) => {
  console.error("REVEAL boot:", e);
  app.innerHTML = `<div class="card" style="margin:1.5rem;padding:1.25rem">
    <p><strong>Erreur au démarrage</strong></p>
    <p class="hint">${e?.message || e}</p>
    <button type="button" class="btn btn-primary btn--spaced" onclick="location.reload()">Recharger</button>
  </div>`;
});
