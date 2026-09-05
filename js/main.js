import { initRouter, registerScreen, navigate, resetNav } from "./core/router.js";
import { initBottomNav } from "./core/bottomNav.js";
import { initAds } from "./core/ads.js";
import { initExitGameDelegation } from "./core/exitGame.js";
import { initDeepLinks } from "./core/deepLinks.js";
import {
  hasActiveLobby,
  resumeEveningSession,
  reconcileLobbyMembership,
} from "./core/lobby.js";
import { stripLegacyJoinHashFromLocation } from "./core/legacyJoinHash.js";
import { initSupabaseAuth, isPasswordRecoveryPending, authReady } from "./core/supabaseAuth.js";
import { shouldShowWelcome } from "./core/welcomeGate.js";
import { isSupabaseConfigured } from "./core/supabaseClient.js";
import {
  BACKEND_MISSING_SCREEN_ID,
  shouldEnterBackendMissingGate,
} from "./core/backendConfigGate.js";
import { mountBackendMissing } from "./screens/backendMissing.js";
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
import { mountTierNightPrep } from "./screens/tierNightPrep.js";
import { mountTierNightLivePrep } from "./screens/tierNightLivePrep.js";
import { mountTierNightCreate } from "./screens/tierNightCreate.js";
import { mountTierNightCreateRoster } from "./screens/tierNightCreateRoster.js";
import { mountTierNightEnd } from "./screens/tierNightEnd.js";
import { mountTierNightBetween } from "./screens/tierNightBetween.js";
import { mountTraitrePrep } from "./screens/traitrePrep.js";
import { mountHotTakePrep } from "./screens/hotTakePrep.js";
import { mountSpeedVotePrep } from "./screens/speedVotePrep.js";
import { mountClutchPrep } from "./screens/clutchPrep.js";
import { mountDrawItPrep } from "./screens/drawItPrep.js";
import { mountWrongAnswerPrep } from "./screens/wrongAnswerPrep.js";
import { mountTruthMeterPrep } from "./screens/truthMeterPrep.js";
import { mountDilemmaPrep } from "./screens/dilemmaPrep.js";
import { mountTriviaSetup } from "./screens/triviaSetup.js";
import { mountConsensusSetup } from "./screens/consensusSetup.js";
import { mountSettings } from "./screens/settings.js";
import { mountHelpLegal } from "./screens/helpLegal.js";
import { HELP_LEGAL_SCREEN_ID } from "./config/helpLegal.js";
import { mountPrivacy } from "./screens/privacy.js";
import { mountFriends } from "./screens/friends.js";
import { FRIENDS_SCREEN_ID } from "./config/friends.js";
import { mountCarnet } from "./screens/carnet.js";
import { CARNET_SCREEN_ID } from "./config/signatureCarnet.js";
import { mountTraitre } from "./games/traitre.js";
import { mountHotTake } from "./games/hotTake.js";
import { mountSpeedVote } from "./games/speedVote.js";
import { mountClutch } from "./games/clutch.js";
import { mountDrawIt } from "./games/drawIt.js";
import { mountWrongAnswer } from "./games/wrongAnswer.js";
import { mountTruthMeter } from "./games/truthMeter.js";
import { mountDilemma } from "./games/dilemma.js";
import { mountTrivia } from "./games/trivia.js";
import { mountConsensus } from "./games/consensus.js";
import { mountGuessLie } from "./games/guessLie.js";
import { mountTierNight } from "./games/tierNight.js";
import { mountTierNightLive } from "./games/tierNightLive.js";
import { initMultiplayerSyncVisibility } from "./core/gameSync.js";
import { initFeedbackFab } from "./core/feedbackUi.js";
import { initLobbyPollSync } from "./core/lobbyPollStore.js";
import { initChatRandomGameSync } from "./core/chatRandomGame.js";
import { initHostNoticeListener } from "./core/hostNotice.js";
import { initActingHostNoticeListener } from "./core/actingHostNotice.js";
import { initFriendRequestNotice } from "./core/friendRequestNotice.js";
import { initLobbyInviteNotice } from "./core/lobbyInviteNotice.js";
import { syncFriendsRealtimeForSession } from "./core/friendsRealtime.js";
import { checkClientCompatibility } from "./core/clientCompatibility.js";
import { COMPAT_STATUS } from "./core/clientCompatibilityContract.js";
import {
  presentCompatibilityGateIfNeeded,
} from "./core/clientCompatibilityGateUi.js";
import { initClientCompatibilityForeground } from "./core/clientCompatibilityForeground.js";
import { armNativeSplashSafetyHide, hideNativeSplash } from "./core/nativeSplash.js";

const app = document.getElementById("app");

if (!app) {
  throw new Error("Élément #app introuvable");
}

// Ancien canal #join= abandonné : neutraliser l’URL sans pending / auto-join.
stripLegacyJoinHashFromLocation();

initRouter(app);

document.querySelectorAll(".app-dialog").forEach((el) => el.remove());

registerScreen(BACKEND_MISSING_SCREEN_ID, mountBackendMissing);
registerScreen("welcome", mountWelcome);
registerScreen("home", mountHome);
registerScreen("reset-password", mountResetPassword);
registerScreen("settings", mountSettings);
registerScreen(HELP_LEGAL_SCREEN_ID, mountHelpLegal);
registerScreen("privacy", mountPrivacy);
registerScreen(FRIENDS_SCREEN_ID, mountFriends);
registerScreen(CARNET_SCREEN_ID, mountCarnet);
registerScreen("lobby", mountLobby);
registerScreen("game-select", mountGameSelect);
registerScreen("results", mountResults);
registerScreen("leaderboard", mountLeaderboard);
registerScreen("guesslie-menu", mountGuessLieMenu);
registerScreen("guesslie-setup", mountGuessLieSetup);
registerScreen("guesslie-wait", mountGuessLieLobbyWait);
registerScreen("tiernight-select", mountTierNightSelect);
registerScreen("tiernight-prep", mountTierNightPrep);
registerScreen("tiernight-live-prep", mountTierNightLivePrep);
registerScreen("tiernight-create", mountTierNightCreate);
registerScreen("tiernight-create-roster", mountTierNightCreateRoster);
registerScreen("tiernight-end", mountTierNightEnd);
registerScreen("tiernight-between", mountTierNightBetween);
registerScreen("traitre-prep", mountTraitrePrep);
registerScreen("traitre", mountTraitre);
registerScreen("hottake-prep", mountHotTakePrep);
registerScreen("hottake", mountHotTake);
registerScreen("speedvote-prep", mountSpeedVotePrep);
registerScreen("speedvote", mountSpeedVote);
registerScreen("clutch-prep", mountClutchPrep);
registerScreen("clutch", mountClutch);
registerScreen("drawit-prep", mountDrawItPrep);
registerScreen("drawit", mountDrawIt);
registerScreen("wronganswer-prep", mountWrongAnswerPrep);
registerScreen("wronganswer", mountWrongAnswer);
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
registerScreen("tiernight-live", mountTierNightLive);

try {
  initBottomNav();
  initFeedbackFab();
  // initLobbyPollSync après authReady (voir boot) - évite subscribe Realtime sans JWT
  initExitGameDelegation(app);
  initAds();
  initMultiplayerSyncVisibility();
  initHostNoticeListener();
  initActingHostNoticeListener();
  initFriendRequestNotice();
  initLobbyInviteNotice();
  initClientCompatibilityForeground();
  armNativeSplashSafetyHide();
} catch (e) {
  console.error("REVEAL init:", e);
  void hideNativeSplash();
  app.innerHTML = `<div class="card" style="margin:1.5rem;padding:1.25rem">
    <p><strong>Erreur au démarrage</strong></p>
    <p class="hint">${e?.message || e}</p>
    <button type="button" class="btn btn-primary btn--spaced" onclick="location.reload()">Recharger</button>
  </div>`;
}

/** Empêche double initLobbyPollSync / reconcile / resume après retry gate boot. */
let postCompatBootStarted = false;

function hideChromeForBackendMissing() {
  const nav = document.getElementById("bottom-nav");
  if (nav) {
    nav.hidden = true;
    nav.classList.add("bottom-nav--hidden");
    nav.setAttribute("aria-hidden", "true");
  }
}

/**
 * ARCH-01A — point de gate le plus haut du boot produit.
 * Avant auth / compat / reconcile / welcome / home / lobby.
 * Empêche toute descente vers auth locale, faux lobby, PNJ.
 */
function enterBackendMissingGate() {
  hideChromeForBackendMissing();
  resetNav();
  navigate(BACKEND_MISSING_SCREEN_ID, { reset: true });
  void hideNativeSplash();
}

async function boot() {
  // ARCH-01A : config absente = terminal, pas de démo locale silencieuse.
  if (
    shouldEnterBackendMissingGate({
      isSupabaseConfigured,
    })
  ) {
    enterBackendMissingGate();
    return;
  }

  await initDeepLinks();
  await initSupabaseAuth();
  await authReady;

  async function continueBootAfterCompatibilityOk() {
    if (postCompatBootStarted) return;
    postCompatBootStarted = true;

    // Premier subscribe polls uniquement après session Supabase prête
    void initLobbyPollSync();
    initChatRandomGameSync();
    syncFriendsRealtimeForSession();
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
    void hideNativeSplash();
  }

  // ARCH-23 : après session Supabase possible (RPC anon OK aussi), avant MP / Realtime polls.
  const compat = await checkClientCompatibility({ source: "boot" });
  if (compat.status === COMPAT_STATUS.INCOMPATIBLE) {
    presentCompatibilityGateIfNeeded(compat, {
      onCompatible: () => continueBootAfterCompatibilityOk(),
    });
    void hideNativeSplash();
    // Pas de reconcile / resume / navigate lobby - hard gate autoritaire.
    return;
  }
  // unknown au boot : ne pas afficher « mise à jour » ; continuer (create/join re-check).
  await continueBootAfterCompatibilityOk();
}

boot().catch((e) => {
  console.error("REVEAL boot:", e);
  void hideNativeSplash();
  app.innerHTML = `<div class="card" style="margin:1.5rem;padding:1.25rem">
    <p><strong>Erreur au démarrage</strong></p>
    <p class="hint">${e?.message || e}</p>
    <button type="button" class="btn btn-primary btn--spaced" onclick="location.reload()">Recharger</button>
  </div>`;
});
