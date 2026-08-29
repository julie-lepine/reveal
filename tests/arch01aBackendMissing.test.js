/**
 * ARCH-01A — gate BACKEND_MISSING + séparation config vs sync.
 *
 * Ne migre pas les mocks historiques isSupabaseConfigured===false des autres suites.
 * Pas d’import gameSync / supabaseClient (esm.sh) — contrats source + module gate pur.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  BACKEND_MISSING_MESSAGE,
  BACKEND_MISSING_SCREEN_ID,
  BACKEND_MISSING_TITLE,
  isBackendMissingAllowedScreen,
  shouldEnterBackendMissingGate,
} from "../js/core/backendConfigGate.js";
import { mountBackendMissing } from "../js/screens/backendMissing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("ARCH-01A — contrat gate (unité)", () => {
  it("shouldEnterBackendMissingGate uniquement si config !== true", () => {
    assert.equal(
      shouldEnterBackendMissingGate({ isSupabaseConfigured: () => false }),
      true
    );
    assert.equal(
      shouldEnterBackendMissingGate({ isSupabaseConfigured: () => true }),
      false
    );
    assert.equal(shouldEnterBackendMissingGate({}), false);
    assert.equal(shouldEnterBackendMissingGate(null), false);
  });

  it("seul l’écran backend-missing est autorisé sous le gate", () => {
    assert.equal(isBackendMissingAllowedScreen(BACKEND_MISSING_SCREEN_ID), true);
    assert.equal(isBackendMissingAllowedScreen("home"), false);
    assert.equal(isBackendMissingAllowedScreen("lobby"), false);
    assert.equal(isBackendMissingAllowedScreen("welcome"), false);
  });

  it("copy UX : configuration absente, pas réseau / démo / hors-ligne", () => {
    assert.equal(BACKEND_MISSING_TITLE, "Configuration requise");
    assert.match(BACKEND_MISSING_MESSAGE, /configuration backend/i);
    assert.match(BACKEND_MISSING_MESSAGE, /pas une panne Internet/i);
    assert.doesNotMatch(BACKEND_MISSING_MESSAGE, /hors[- ]ligne|démo locale|réessayer/i);
    assert.doesNotMatch(BACKEND_MISSING_TITLE, /hors[- ]ligne|offline/i);
  });
});

describe("ARCH-01A — TEST A : boot → BACKEND_MISSING (source)", () => {
  it("main.js gate avant auth / compat / welcome / home / lobby", () => {
    const main = read("js/main.js");
    const bootIdx = main.indexOf("async function boot()");
    assert.ok(bootIdx > 0);
    const bootBody = main.slice(bootIdx);

    assert.match(bootBody, /shouldEnterBackendMissingGate/);
    assert.match(bootBody, /enterBackendMissingGate/);
    assert.match(main, /BACKEND_MISSING_SCREEN_ID/);
    assert.match(main, /registerScreen\(BACKEND_MISSING_SCREEN_ID/);

    const gateReturn = bootBody.indexOf("enterBackendMissingGate()");
    const initAuth = bootBody.indexOf("await initSupabaseAuth()");
    const continueBoot = bootBody.indexOf("continueBootAfterCompatibilityOk");
    const welcomeNav = bootBody.indexOf('navigate("welcome"');
    const homeNav = bootBody.indexOf('navigate("home"');
    const lobbyResume = bootBody.indexOf("resumeEveningSession");

    assert.ok(gateReturn > 0, "gate call present");
    assert.ok(initAuth > gateReturn, "auth après gate");
    assert.ok(continueBoot > gateReturn, "continueBoot après gate");
    assert.ok(welcomeNav > gateReturn);
    assert.ok(homeNav > gateReturn);
    assert.ok(lobbyResume > gateReturn);

    const earlySlice = bootBody.slice(0, initAuth);
    assert.match(earlySlice, /return;/);
  });

  it("écran BACKEND_MISSING n’offre ni login ni home ni lobby", () => {
    const el = { innerHTML: "" };
    mountBackendMissing(el);
    const html = el.innerHTML;
    assert.match(html, /Configuration requise/);
    assert.match(html, /configuration backend/i);
    assert.doesNotMatch(html, /data-nav="home"|data-nav="lobby"|data-nav="welcome"/);
    assert.doesNotMatch(html, /Créer un compte|Créer un lobby|mode démo|démo locale/i);
    assert.doesNotMatch(html, /type="password"|signup|sign-in|guest-login/i);
    assert.doesNotMatch(html, /hors[- ]ligne|réessayer/i);
    assert.doesNotMatch(html, /<button[^>]*>/i);
  });
});

describe("ARCH-01A — TEST B : auth locale inatteignable (parcours runtime)", () => {
  it("boot ne lance pas initSupabaseAuth ni continueBoot si gate actif (ordre source)", () => {
    const main = read("js/main.js");
    const bootIdx = main.indexOf("async function boot()");
    const bootBody = main.slice(bootIdx, main.indexOf("boot().catch"));
    assert.match(
      bootBody,
      /shouldEnterBackendMissingGate\([\s\S]*?\)\s*\{\s*enterBackendMissingGate\(\);\s*return;/
    );
  });

  it("authCredentials absent du runtime (fichier + imports)", () => {
    assert.equal(existsSync(join(ROOT, "js/core/authCredentials.js")), false);
    const main = read("js/main.js");
    assert.doesNotMatch(main, /authCredentials/);
  });
});

describe("ARCH-01A — TEST C : faux lobby inatteignable via parcours utilisateur", () => {
  it("boot ne touche pas createLobby / reconcile / resume si non configuré", () => {
    const main = read("js/main.js");
    const bootIdx = main.indexOf("async function boot()");
    const beforeAuth = main.slice(bootIdx, main.indexOf("await initSupabaseAuth()"));
    assert.doesNotMatch(
      beforeAuth,
      /createLobby|publishOpenLobby|reconcileLobbyMembership|resumeEveningSession/
    );
  });

  it("gate n’appelle pas publishOpenLobby / lookupOpenLobby", () => {
    const gate = read("js/core/backendConfigGate.js");
    const screen = read("js/screens/backendMissing.js");
    assert.doesNotMatch(gate + screen, /publishOpenLobby|lookupOpenLobby|createLobby/);
  });
});

describe("ARCH-01A — TEST D : PNJ démo non atteints depuis ce parcours", () => {
  it("boot / BACKEND_MISSING n’importent ni demoPlayers ni branche PNJ", () => {
    const main = read("js/main.js");
    const screen = read("js/screens/backendMissing.js");
    assert.doesNotMatch(main, /demoPlayers|DEMO_NPC/);
    assert.doesNotMatch(screen, /demoPlayers|DEMO_NPC|simulateLobbyJoins/);
  });
});

describe("ARCH-01A — TEST E : Supabase configuré → boot produit inchangé", () => {
  it("si gate false, boot enchaîne auth + compat + continueBoot (source)", () => {
    const main = read("js/main.js");
    assert.equal(
      shouldEnterBackendMissingGate({ isSupabaseConfigured: () => true }),
      false
    );
    const bootIdx = main.indexOf("async function boot()");
    const bootBody = main.slice(bootIdx);
    assert.match(bootBody, /await initDeepLinks\(\)/);
    assert.match(bootBody, /await initSupabaseAuth\(\)/);
    assert.match(bootBody, /checkClientCompatibility/);
    assert.match(bootBody, /continueBootAfterCompatibilityOk/);
    assert.match(bootBody, /shouldShowWelcome/);
    assert.match(bootBody, /hasActiveLobby/);
    assert.match(bootBody, /hideNativeSplash/);
    const auth = read("js/core/supabaseAuth.js");
    assert.match(auth, /AUTH_READY_TIMEOUT_MS/);
    assert.match(auth, /markAuthReadyUnblocked\("timeout"\)/);
    assert.match(auth, /void syncPurchasesIdentity\(\)/);
    const supabaseClient = read("js/core/supabaseClient.js");
    assert.match(supabaseClient, /from ["']\.\.\/vendor\/supabase-js\.js["']/);
    assert.doesNotMatch(supabaseClient, /esm\.sh/);
    const capImports = read("js/core/capacitorImports.js");
    assert.doesNotMatch(capImports, /https:\/\/esm\.sh/);
  });

  it("isSupabaseConfigured reste un test de credentials purs (pas de réseau)", () => {
    const src = read("js/core/supabaseClient.js");
    const fn = src.slice(src.indexOf("export function isSupabaseConfigured"));
    const body = fn.slice(0, fn.indexOf("export const supabase"));
    assert.doesNotMatch(body, /fetch\(|navigator\.onLine|ping|timeout/i);
    assert.match(body, /SUPABASE_URL/);
    assert.match(body, /SUPABASE_ANON_KEY/);
  });
});

describe("ARCH-01A — TEST F : configured sans lobby ≠ backend missing", () => {
  it("isGameSyncActive false avec config true reste légitime (pas d’alias)", () => {
    const gs = read("js/core/gameSync.js");
    assert.match(
      gs,
      /export function isGameSyncActive\(\)\s*\{\s*return isSupabaseConfigured\(\) && Boolean\(getState\(\)\.lobby\?\.id\);/
    );

    assert.equal(
      shouldEnterBackendMissingGate({ isSupabaseConfigured: () => true }),
      false
    );
    const configuredNoLobby = {
      isSupabaseConfigured: () => true,
      isGameSyncActive: () => false,
    };
    assert.equal(
      shouldEnterBackendMissingGate(configuredNoLobby),
      false,
      "sync false ne doit pas déclencher le gate config"
    );
    assert.equal(
      shouldEnterBackendMissingGate({
        isSupabaseConfigured: () => false,
        isGameSyncActive: () => false,
      }),
      true
    );
  });

  it("main ne remplace pas isGameSyncActive par isSupabaseConfigured", () => {
    const main = read("js/main.js");
    assert.doesNotMatch(main, /isGameSyncActive/);
    assert.match(main, /isSupabaseConfigured/);
  });
});

describe("ARCH-01A — non-régression présence MP (source)", () => {
  it("simulateLobbyJoins = présence Realtime (plus de PNJ)", () => {
    const lobby = read("js/core/lobby.js");
    assert.match(lobby, /simulateLobbyJoins/);
    assert.match(lobby, /startLobbyPresenceSync/);
    const idx = lobby.indexOf("export function simulateLobbyJoins");
    const slice = lobby.slice(idx, idx + 500);
    assert.doesNotMatch(slice, /DEMO_NPC|setInterval/);
  });
});
