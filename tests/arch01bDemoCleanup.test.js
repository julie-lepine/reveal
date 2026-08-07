/**
 * ARCH-01B — suppression physique mode démo locale.
 * Pas d’import lobby/players runtime (esm.sh) — contrats source + modules purs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { canCreateLobbyFromInputs } from "../js/core/lobbyCreateGuard.js";
import {
  BACKEND_MISSING_SCREEN_ID,
  shouldEnterBackendMissingGate,
} from "../js/core/backendConfigGate.js";
import { getLastGameScopeKey } from "../js/core/lobbyBoundary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("ARCH-01B — modules runtime démo absents", () => {
  it("demoPlayers.js et authCredentials.js n’existent plus", () => {
    assert.equal(existsSync(join(ROOT, "js/core/demoPlayers.js")), false);
    assert.equal(existsSync(join(ROOT, "js/core/authCredentials.js")), false);
  });

  it("symboles démo absents du runtime produit clé", () => {
    const files = [
      "js/core/lobby.js",
      "js/core/players.js",
      "js/core/auth.js",
      "js/core/state.js",
      "js/screens/lobby.js",
      "js/main.js",
    ];
    for (const f of files) {
      const src = read(f);
      assert.doesNotMatch(src, /DEMO_NPC_PLAYERS|demoPlayers\.js|authCredentials/);
      assert.doesNotMatch(src, /publishOpenLobby|function getOpenLobby/);
      assert.doesNotMatch(src, /Démo locale/);
    }
  });

  it("placeholders config restent légitimes", () => {
    const example = read("js/config/supabase.example.js");
    const client = read("js/core/supabaseClient.js");
    assert.match(example, /TON_PROJECT/);
    assert.match(example, /REPLACE_ME/);
    assert.match(client, /TON_PROJECT/);
    assert.match(client, /REPLACE_ME/);
  });
});

describe("ARCH-01B — TEST A/B : gate + boot", () => {
  it("BACKEND_MISSING toujours actif si config false", () => {
    assert.equal(
      shouldEnterBackendMissingGate({ isSupabaseConfigured: () => false }),
      true
    );
    assert.equal(BACKEND_MISSING_SCREEN_ID, "backend-missing");
  });

  it("boot configuré reste inchangé (source)", () => {
    const main = read("js/main.js");
    assert.match(main, /shouldEnterBackendMissingGate/);
    assert.match(main, /await initSupabaseAuth/);
    assert.equal(
      shouldEnterBackendMissingGate({ isSupabaseConfigured: () => true }),
      false
    );
  });
});

describe("ARCH-01B — TEST C/D : getActivePlayers hors lobby", () => {
  it("contrat source : [] si !hasActiveLobby ; pas de DEMO_NPC", () => {
    const src = read("js/core/players.js");
    const fn = src.slice(
      src.indexOf("export function getActivePlayers"),
      src.indexOf("export function getActivePlayerNames")
    );
    assert.match(fn, /if \(!hasActiveLobby\(\)\) return \[\];/);
    assert.doesNotMatch(fn, /DEMO_NPC|demoPlayers|getLocalDisplayName/);
  });

  it("getLocalPlayer conserve fallback display hors roster", () => {
    const src = read("js/core/players.js");
    assert.match(src, /export function getLocalPlayer/);
    assert.match(src, /getLocalDisplayName\(\)/);
  });
});

describe("ARCH-01B — TEST E/F/G/H : chemins Supabase (source)", () => {
  it("createLobby / joinLobby : pas de branche locale", () => {
    const lobby = read("js/core/lobby.js");
    const createIdx = lobby.indexOf("export async function createLobby()");
    const joinIdx = lobby.indexOf("export async function joinLobby(");
    const createSlice = lobby.slice(createIdx, joinIdx);
    const joinSlice = lobby.slice(joinIdx, joinIdx + 2500);
    assert.match(createSlice, /createLobbySupabase/);
    assert.doesNotMatch(createSlice, /publishOpenLobby|genLobbyCode|localInstanceId/);
    assert.match(joinSlice, /joinLobbySupabase/);
    assert.doesNotMatch(joinSlice, /getOpenLobby|publishOpenLobby|localInstanceId/);
  });

  it("simulateLobbyJoins = présence Realtime uniquement", () => {
    const lobby = read("js/core/lobby.js");
    const idx = lobby.indexOf("export function simulateLobbyJoins");
    const slice = lobby.slice(idx, idx + 600);
    assert.match(slice, /startLobbyPresenceSync/);
    assert.match(slice, /onLobbyBundleUpdated/);
    assert.doesNotMatch(slice, /DEMO_NPC|setInterval|publishOpenLobby/);
  });

  it("auth.js : pas de credentials locaux", () => {
    const auth = read("js/core/auth.js");
    assert.doesNotMatch(auth, /authCredentials|registerEmailAccount|verifyEmailAccount/);
    assert.match(auth, /sbSignIn|signInWithEmail/);
    assert.match(auth, /sbGuest|signInAsGuest/);
  });

  it("canCreateLobbyFromInputs refuse !configured", () => {
    assert.equal(
      canCreateLobbyFromInputs({
        loggedIn: true,
        hasActiveLobby: false,
        supabaseConfigured: false,
      }),
      false
    );
  });
});

describe("ARCH-01B — TEST I : scope lastGame", () => {
  it("getLastGameScopeKey ignore localInstanceId", () => {
    assert.equal(getLastGameScopeKey({ id: "u1", localInstanceId: "offline-1" }), "u1");
    assert.equal(getLastGameScopeKey({ code: "ABCD", localInstanceId: "offline-1" }), "ABCD");
  });
});
