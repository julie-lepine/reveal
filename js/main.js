import { initRouter, registerScreen, navigate, resetNav } from "./core/router.js";
import { initBottomNav } from "./core/bottomNav.js";
import { initAds } from "./core/ads.js";
import { initExitGameDelegation } from "./core/exitGame.js";
import { initDeepLinks } from "./core/deepLinks.js";
import {
  parseJoinCodeFromHash,
  hasActiveLobby,
  resumeEveningSession,
  reconcileLobbyMembership,
} from "./core/lobby.js";
import { initSupabaseAuth, isPasswordRecoveryPending } from "./core/supabaseAuth.js";
import { shouldShowWelcome } from "./core/welcomeGate.js";
import { mountResetPassword } from "./screens/resetPassword.js";
import { mountWelcome } from "./screens/welcome.js";
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
import { mountPrivacy } from "./screens/privacy.js";
import { mountHotTake } from "./games/hotTake.js";
import { mountSpeedVote } from "./games/speedVote.js";
import { mountPlaylistGuess } from "./games/playlistGuess.js";
import { mountTruthMeter } from "./games/truthMeter.js";
import { mountDilemma } from "./games/dilemma.js";
import { mountTrivia } from "./games/trivia.js";
import { mountConsensus } from "./games/consensus.js";
import { mountGuessLie } from "./games/guessLie.js";
import { mountTierNight } from "./games/tierNight.js";
// FIL_ROUGE (Mot interdit) — désactivé, voir data/filRouge.js
// import { mountFilRougeSetup } from "./screens/filRougeSetup.js";
// import { mountFilRougeMission } from "./screens/filRougeMission.js";
// import { initFilRougeResultsListener } from "./core/filRougeResultsModal.js";
// import { initFilRougeValidationListener } from "./core/filRougeToast.js";
import { initMultiplayerSyncVisibility } from "./core/gameSync.js";

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

registerScreen("welcome", mountWelcome);
registerScreen("home", mountHome);
registerScreen("reset-password", mountResetPassword);
registerScreen("settings", mountSettings);
registerScreen("privacy", mountPrivacy);
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
// registerScreen("filrouge-setup", mountFilRougeSetup);
// registerScreen("filrouge-mission", mountFilRougeMission);

initBottomNav();
initExitGameDelegation(app);
initAds();
initMultiplayerSyncVisibility();
// initFilRougeResultsListener();
// initFilRougeValidationListener();

async function boot() {
  await initDeepLinks();
  await initSupabaseAuth();
  await reconcileLobbyMembership();
  resetNav();
  if (isPasswordRecoveryPending()) {
    navigate("reset-password", { reset: true });
  } else if (hasActiveLobby()) {
    const resumed = await resumeEveningSession({ force: true });
    if (!resumed) navigate("home", { reset: true });
  } else if (shouldShowWelcome()) {
    navigate("welcome", { reset: true });
  } else {
    navigate("home", { reset: true });
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
