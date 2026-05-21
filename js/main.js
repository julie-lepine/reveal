import { initRouter, registerScreen, navigate, resetNav } from "./core/router.js";
import { initBottomNav } from "./core/bottomNav.js";
import { parseJoinCodeFromHash, hasActiveLobby, resumeEveningSession } from "./core/lobby.js";
import { initSupabaseAuth } from "./core/supabaseAuth.js";
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
import { mountTruthMeterPrep } from "./screens/truthMeterPrep.js";
import { mountSettings } from "./screens/settings.js";
import { mountHotTake } from "./games/hotTake.js";
import { mountSpeedVote } from "./games/speedVote.js";
import { mountTruthMeter } from "./games/truthMeter.js";
import { mountGuessLie } from "./games/guessLie.js";
import { mountTierNight } from "./games/tierNight.js";

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
registerScreen("truthmeter-prep", mountTruthMeterPrep);
registerScreen("truthmeter", mountTruthMeter);
registerScreen("guesslie", mountGuessLie);
registerScreen("tiernight", mountTierNight);

initBottomNav();

async function boot() {
  await initSupabaseAuth();
  resetNav();
  navigate("home", { reset: true });
  if (hasActiveLobby()) {
    void resumeEveningSession();
  }
}

boot();
