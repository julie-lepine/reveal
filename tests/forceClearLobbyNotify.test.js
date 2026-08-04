/**
 * forceClearClientLobbyState - notification après wipe local.
 * (Pas d’import de lobby.js : supabaseClient charge un URL https: incompatible Node.)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function forceClearFnBody() {
  const lobby = src("js/core/lobby.js");
  const start = lobby.indexOf("export function forceClearClientLobbyState");
  const end = lobby.indexOf("export function handleGuestRecoveryRequiresCaptcha");
  assert.ok(start >= 0 && end > start);
  return lobby.slice(start, end);
}

/**
 * Miroir minimal du pub/sub + wipe : vérifie l’ordre d’invariants
 * (state effacé avant notify, une notif, hasActive faux).
 */
function runForceClearContractSequence() {
  const state = {
    inLobby: true,
    lobbyCode: "ABCD",
    lobby: { code: "ABCD", participants: [{ isLocal: true }] },
  };
  const listeners = new Set();
  const events = [];

  function hasActiveLobby() {
    return Boolean(state.inLobby && state.lobby?.code);
  }

  function onLobbyBundleUpdated(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notifyLobbyBundleUpdated() {
    for (const fn of listeners) fn();
  }

  function forceClearClientLobbyState() {
    // Ordre aligné sur js/core/lobby.js
    events.push("stopMultiplayerSync");
    events.push("clearCachedGameSession");
    state.inLobby = false;
    state.lobby = null;
    state.lobbyCode = null;
    events.push("saveStatePatch");
    notifyLobbyBundleUpdated();
    events.push("notifyLobbyBundleUpdated");
  }

  let calls = 0;
  /** @type {{ inLobby: boolean, lobby: unknown, active: boolean } | null} */
  let seen = null;
  onLobbyBundleUpdated(() => {
    calls += 1;
    seen = {
      inLobby: state.inLobby,
      lobby: state.lobby,
      active: hasActiveLobby(),
    };
  });

  assert.equal(hasActiveLobby(), true);
  forceClearClientLobbyState();

  return { calls, seen, events, hasActiveLobby, forceClearClientLobbyState, state };
}

describe("forceClearClientLobbyState - contrat source", () => {
  it("notifie après mutations, une seule fois dans la fonction", () => {
    const body = forceClearFnBody();
    assert.match(body, /performLobbyBoundaryTeardown\(\)/);
    assert.match(body, /saveStatePatch\(\{\s*inLobby:\s*false/);
    assert.match(body, /notifyLobbyBundleUpdated\(\)/);
    const notifyIdx = body.lastIndexOf("notifyLobbyBundleUpdated()");
    const patchIdx = body.indexOf("saveStatePatch");
    const teardownIdx = body.indexOf("performLobbyBoundaryTeardown()");
    assert.ok(teardownIdx >= 0 && patchIdx > teardownIdx);
    assert.ok(patchIdx >= 0 && notifyIdx > patchIdx);
    assert.equal((body.match(/notifyLobbyBundleUpdated\(\)/g) || []).length, 1);
    // Sync/clear restent dans le teardown partagé - pas d’invalidate snapshot ici.
    assert.equal(body.includes("invalidateMembershipSnapshot"), false);
    assert.equal(body.includes("commitMembershipRemoved"), false);
  });

  it("importe notifyLobbyBundleUpdated depuis supabaseLobby", () => {
    const lobby = src("js/core/lobby.js");
    assert.match(
      lobby,
      /notifyLobbyBundleUpdated/
    );
    assert.match(src("js/core/supabaseLobby.js"), /export function notifyLobbyBundleUpdated/);
  });

  it("callers n’ajoutent pas de notify après force-clear", () => {
    const lobby = src("js/core/lobby.js");
    const markers = [
      "export function handleGuestRecoveryRequiresCaptcha",
      "async function reconcileLobbyWhenUidMissing",
      "export async function reconcileLobbyMembership",
    ];
    for (const marker of markers) {
      const start = lobby.indexOf(marker);
      assert.ok(start >= 0, marker);
      const nextExport = lobby.indexOf("\nexport ", start + marker.length);
      const block = lobby.slice(start, nextExport > start ? nextExport : start + 1200);
      const parts = block.split("forceClearClientLobbyState()");
      for (let i = 1; i < parts.length; i++) {
        assert.equal(
          parts[i].slice(0, 160).includes("notifyLobbyBundleUpdated"),
          false,
          `${marker}: pas de notify après forceClear`
        );
      }
    }
  });

  it("boot : reconcile puis resetNav/navigate - pas de navigate dans forceClear", () => {
    const body = forceClearFnBody();
    assert.equal(body.includes("navigate("), false);
    const main = src("js/main.js");
    const bootStart = main.indexOf("async function boot");
    const boot = main.slice(bootStart, bootStart + 2200);
    assert.match(boot, /checkClientCompatibility/);
    assert.match(boot, /continueBootAfterCompatibilityOk/);
    assert.match(boot, /await reconcileLobbyMembership\(\)/);
    const compatIdx = boot.indexOf("checkClientCompatibility");
    const continueIdx = boot.indexOf("continueBootAfterCompatibilityOk");
    const reconcileIdx = boot.indexOf("reconcileLobbyMembership");
    const resetIdx = boot.indexOf("resetNav");
    assert.ok(
      compatIdx >= 0 &&
        continueIdx >= 0 &&
        reconcileIdx > continueIdx &&
        resetIdx > reconcileIdx
    );
  });

  it("settings écoute onLobbyBundleUpdated pour rafraîchir la soirée", () => {
    const settings = src("js/screens/settings.js");
    assert.match(settings, /onLobbyBundleUpdated/);
    assert.match(settings, /refreshSoireePanel/);
    assert.match(settings, /mount\.isMounted\(\)/);
  });
});

describe("forceClearClientLobbyState - invariants d’ordre (miroir)", () => {
  it("listener voit lobby déjà effacé, hasActiveLobby faux, une seule notif", () => {
    const { calls, seen, events } = runForceClearContractSequence();
    assert.deepEqual(events, [
      "stopMultiplayerSync",
      "clearCachedGameSession",
      "saveStatePatch",
      "notifyLobbyBundleUpdated",
    ]);
    assert.equal(calls, 1);
    assert.ok(seen);
    assert.equal(seen.inLobby, false);
    assert.equal(seen.lobby, null);
    assert.equal(seen.active, false);
  });

  it("deux force-clear → deux notifs ; listener ne relance pas forceClear", () => {
    const state = {
      inLobby: true,
      lobbyCode: "ABCD",
      lobby: { code: "ABCD" },
    };
    const listeners = new Set();
    let calls = 0;
    function notify() {
      for (const fn of listeners) fn();
    }
    function forceClear() {
      state.inLobby = false;
      state.lobby = null;
      state.lobbyCode = null;
      notify();
    }
    listeners.add(() => {
      calls += 1;
      assert.equal(state.inLobby, false);
      // Interdit : relancer forceClear depuis le listener (anti-boucle).
    });
    forceClear();
    forceClear();
    assert.equal(calls, 2);
  });
});

describe("cleanup migration - alias / CSS", () => {
  it("seul lobbySettingsActionsForRole est exporté", () => {
    const menu = src("js/core/partySettingsMenu.js");
    assert.match(menu, /export function lobbySettingsActionsForRole/);
    assert.equal(menu.includes("partySettingsActionsForRole"), false);
    assert.equal(src("js/screens/settings.js").includes("partySettingsActionsForRole"), false);
    assert.equal(src("tests/uxNavLobby.test.js").includes("partySettingsActionsForRole"), false);
  });

  it("classes CSS game-select profile/party absentes", () => {
    for (const file of ["style.css", "css/a11y.css"]) {
      const text = src(file);
      assert.equal(text.includes("game-select-profile"), false, file);
      assert.equal(text.includes("game-select-party-settings"), false, file);
    }
  });
});
