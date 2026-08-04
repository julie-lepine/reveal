/**
 * Membership Vague E5 - dissolve_lobby_atomically + mapping + chemins unifiés.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LOBBY_DISSOLVE_STATUS,
  mapDissolveLobbyRpcData,
  interpretDissolveMembershipRequery,
} from "../js/core/lobbyDissolveContract.js";
import { notifyVoluntaryLeaveFailure } from "../js/core/voluntaryMemberLeave.js";
import {
  commitMembershipRemoved,
} from "../js/core/lobbyMembershipAlign.js";
import {
  getMembershipSnapshot,
  setMembershipSnapshot,
  __resetMembershipAuthForTests,
} from "../js/core/lobbyMembershipSnapshot.js";
import { resetMembershipSnapshotTestState } from "./helpers/membershipSnapshotTest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const UID = "user-e5-elsewhere";

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("lobbyMembershipVagueE5 - mapping RPC", () => {
  it("1 - DISSOLVED → ok", () => {
    const r = mapDissolveLobbyRpcData(
      { status: "DISSOLVED", lobby_id: "L1" },
      "L1"
    );
    assert.equal(r.ok, true);
    assert.equal(r.status, LOBBY_DISSOLVE_STATUS.DISSOLVED);
  });

  it("2 - ALREADY_GONE → ok (succès silencieux)", () => {
    const r = mapDissolveLobbyRpcData(
      { status: "ALREADY_GONE", lobby_id: "L1" },
      "L1"
    );
    assert.equal(r.ok, true);
    assert.equal(r.status, LOBBY_DISSOLVE_STATUS.ALREADY_GONE);
  });

  it("3 - NOT_ALLOWED → !ok, pas ALREADY_GONE", () => {
    const r = mapDissolveLobbyRpcData(
      { status: "NOT_ALLOWED", lobby_id: "L1" },
      "L1"
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, LOBBY_DISSOLVE_STATUS.NOT_ALLOWED);
    assert.match(r.error, /hôte/i);
  });

  it("4 - UNAUTHENTICATED → !ok", () => {
    const r = mapDissolveLobbyRpcData(
      { status: "UNAUTHENTICATED", lobby_id: "L1" },
      "L1"
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, LOBBY_DISSOLVE_STATUS.UNAUTHENTICATED);
  });

  it("5 - payload malformé → erreur identifiable, pas ALREADY_GONE", () => {
    const r = mapDissolveLobbyRpcData({ status: "WEIRD" }, "L1");
    assert.equal(r.ok, false);
    assert.equal(r.malformed, true);
    assert.equal(r.status, null);
    assert.match(r.error, /invalide/i);
  });

  it("5b - null / undefined data → malformé", () => {
    assert.equal(mapDissolveLobbyRpcData(null, "L1").malformed, true);
    assert.equal(mapDissolveLobbyRpcData(undefined, "L1").malformed, true);
  });
});

describe("lobbyMembershipVagueE5 - re-query après transport", () => {
  it("6 - membership none → ALREADY_GONE succès", () => {
    const r = interpretDissolveMembershipRequery({ status: "none" }, "L1");
    assert.equal(r.ok, true);
    assert.equal(r.status, LOBBY_DISSOLVE_STATUS.ALREADY_GONE);
    assert.equal(r.viaRequery, true);
  });

  it("7 - found host même lobby → erreur retryable", () => {
    const r = interpretDissolveMembershipRequery(
      {
        status: "found",
        membership: { lobbyId: "L1", role: "host" },
      },
      "L1"
    );
    assert.equal(r.ok, false);
    assert.equal(r.retryable, true);
    assert.equal(r.networkError, true);
    assert.notEqual(r.status, LOBBY_DISSOLVE_STATUS.ALREADY_GONE);
  });

  it("8 - found member même lobby → NOT_ALLOWED", () => {
    const r = interpretDissolveMembershipRequery(
      {
        status: "found",
        membership: { lobbyId: "L1", role: "member" },
      },
      "L1"
    );
    assert.equal(r.ok, false);
    assert.equal(r.status, LOBBY_DISSOLVE_STATUS.NOT_ALLOWED);
  });

  it("9 - found autre lobby Y → CANONICAL_ELSEWHERE (pas ALREADY_GONE)", () => {
    const r = interpretDissolveMembershipRequery(
      {
        status: "found",
        membership: { lobbyId: "L2", role: "host", code: "YYYYYY" },
      },
      "L1"
    );
    assert.equal(r.ok, true);
    assert.equal(r.status, LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE);
    assert.equal(r.canonicalLobbyId, "L2");
    assert.equal(r.attemptedLobbyId, "L1");
    assert.equal(r.dissolveLocalSuccess, false);
    assert.notEqual(r.status, LOBBY_DISSOLVE_STATUS.ALREADY_GONE);
  });

  it("10 - unknown → état protégé", () => {
    const r = interpretDissolveMembershipRequery({ status: "unknown" }, "L1");
    assert.equal(r.ok, false);
    assert.equal(r.unknown, true);
    assert.equal(r.networkError, true);
    assert.notEqual(r.status, LOBBY_DISSOLVE_STATUS.ALREADY_GONE);
  });

  it("10b - multi-onglets logique : A timeout X, B crée Y → A re-query Y", () => {
    // A tentait X ; membership canonique = Y
    const r = interpretDissolveMembershipRequery(
      {
        status: "found",
        membership: { lobbyId: "lobby-Y", role: "host", code: "BBBBBB" },
      },
      "lobby-X"
    );
    assert.equal(r.status, LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE);
    assert.equal(r.canonicalLobbyId, "lobby-Y");
    assert.equal(r.attemptedLobbyId, "lobby-X");
  });
});

describe("lobbyMembershipVagueE5 - contrats source", () => {
  it("11 - SQL RPC + grants + search_path durci", () => {
    const sql = read(
      "supabase/lobby-membership-e5-01-dissolve-lobby-atomically.sql"
    );
    assert.match(sql, /dissolve_lobby_atomically\(p_lobby_id uuid\)/);
    assert.match(sql, /SECURITY DEFINER/);
    assert.match(sql, /SET search_path TO ''/);
    assert.match(sql, /DELETE FROM public\.lobbies/);
    assert.match(sql, /DISSOLVED/);
    assert.match(sql, /ALREADY_GONE/);
    assert.match(sql, /NOT_ALLOWED/);
    assert.match(sql, /UNAUTHENTICATED/);
    const body = sql.slice(
      sql.indexOf("AS $function$"),
      sql.lastIndexOf("$function$")
    );
    assert.equal(body.includes("game_sessions"), false);
    assert.equal(body.includes("traitre_private"), false);
    assert.equal(body.includes("pg_advisory"), false);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.dissolve_lobby_atomically/);
    assert.match(sql, /FROM anon/);
    assert.match(sql, /GRANT EXECUTE.*TO authenticated/);
    assert.match(sql, /GRANT EXECUTE.*TO service_role/);
  });

  it("12 - closeLobbyByIdAsHost = RPC unique, pas d’ancien pipeline", () => {
    const sb = read("js/core/supabaseLobby.js");
    const start = sb.indexOf("export async function closeLobbyByIdAsHost");
    const end = sb.indexOf("export async function closeLobbySupabase", start);
    const fn = sb.slice(start, end);
    assert.match(fn, /dissolve_lobby_atomically/);
    assert.equal(fn.includes("deleteGameSession"), false);
    assert.equal(fn.includes("clearTraitrePrivateForLobby"), false);
    assert.equal(fn.includes('from("lobbies").delete'), false);
    assert.equal(fn.includes("fetchLobbyHostIdById"), false);
    assert.match(fn, /reconcileDissolveAfterTransportError/);
    assert.match(fn, /queryActiveLobbyMembership/);
  });

  it("13 - dissolveLobbyAsHost : DISSOLVED/ALREADY_GONE → E3 + invalidate + local Traître", () => {
    const lobby = read("js/core/lobby.js");
    const dissolve = lobby.slice(
      lobby.indexOf("export async function dissolveLobbyAsHost"),
      lobby.indexOf("export async function confirmAndLeaveLobby")
    );
    assert.match(dissolve, /beginPostLeaveHomeTransition/);
    assert.match(dissolve, /commitMembershipRemoved/);
    assert.match(dissolve, /invalidateCurrentLobbySessionCache/);
    const start = lobby.indexOf("function applyHostDissolveLocalSuccess");
    const end = lobby.indexOf(
      "async function reconcileHostDissolveCanonicalElsewhere",
      start
    );
    const block = lobby.slice(start, end);
    assert.match(block, /clearTraitrePrivateLocalForLobby/);
    assert.match(block, /applyLeaveLobbyLocal/);
    assert.equal(block.includes("commitMembershipRemoved"), false);
  });

  it("13b - CANONICAL_ELSEWHERE : drop X, recover Y, pas Home soft-hold", () => {
    const lobby = read("js/core/lobby.js");
    const start = lobby.indexOf(
      "async function reconcileHostDissolveCanonicalElsewhere"
    );
    const end = lobby.indexOf(
      "async function reconcileHostDissolveNotAllowed",
      start
    );
    const block = lobby.slice(start, end);
    assert.match(block, /recoverLobbyFromServer/);
    assert.match(block, /goToLobby/);
    assert.match(block, /endPostLeaveHomeTransition/);
    assert.equal(block.includes("beginPostLeaveHomeTransition("), false);
    assert.equal(block.includes('navigate("home"'), false);
    assert.equal(block.includes("navigateAway: true"), false);
    assert.match(block, /CANONICAL_ELSEWHERE/);

    const dissolve = lobby.slice(
      lobby.indexOf("export async function dissolveLobbyAsHost"),
      lobby.indexOf("export async function confirmAndLeaveLobby")
    );
    assert.match(dissolve, /CANONICAL_ELSEWHERE/);
    assert.match(dissolve, /reconcileHostDissolveCanonicalElsewhere/);
    // Soft-hold Home seulement sur ALREADY_GONE/DISSOLVED, pas sur elsewhere.
    assert.ok(
      dissolve.indexOf("CANONICAL_ELSEWHERE") <
        dissolve.indexOf("applyHostDissolveLocalSuccess")
    );
  });

  it("14 - NOT_ALLOWED : pas de wipe succès aveugle, reconcile + message", () => {
    const lobby = read("js/core/lobby.js");
    assert.match(lobby, /reconcileHostDissolveNotAllowed/);
    const start = lobby.indexOf("async function reconcileHostDissolveNotAllowed");
    const end = lobby.indexOf("export async function dissolveLobbyAsHost", start);
    const block = lobby.slice(start, end);
    assert.match(block, /recoverLobbyFromServer/);
    assert.match(block, /NOT_ALLOWED/);
    assert.equal(block.includes("La connexion a empêché"), false);
    // found autre lobby depuis NOT_ALLOWED → même pipeline elsewhere
    assert.match(block, /reconcileHostDissolveCanonicalElsewhere/);
  });

  it("15 - server-only Resume utilise closeLobbyByIdAsHost (même RPC)", () => {
    const lobby = read("js/core/lobby.js");
    const start = lobby.indexOf(
      "export async function leaveLobbyMembershipFromServer"
    );
    const end = lobby.indexOf("export async function transferLobbyHost", start);
    const block = lobby.slice(start, end);
    assert.match(block, /closeLobbyAsHost:\s*closeLobbyByIdAsHost/);
    assert.match(block, /clearTraitrePrivateLocalForLobby/);
  });

  it("16 - deleteGameSession reste hors dissolve (endGameSession)", () => {
    const sync = read("js/core/gameSync.js");
    assert.match(sync, /deleteGameSession/);
    const game = read("js/core/supabaseGame.js");
    assert.match(game, /export async function deleteGameSession/);
    const close = read("js/core/supabaseLobby.js");
    const fn = close.slice(
      close.indexOf("export async function closeLobbyByIdAsHost"),
      close.indexOf("export async function closeLobbySupabase")
    );
    assert.equal(fn.includes("deleteGameSession"), false);
  });

  it("17 - clearTraitrePrivateForLobby reste pour resets jeu", () => {
    const restart = read("js/core/restartGame.js");
    assert.match(restart, /clearTraitrePrivateForLobby/);
    const traitre = read("js/core/traitreSession.js");
    assert.match(traitre, /clearTraitrePrivateForLobby/);
    const priv = read("js/core/traitrePrivate.js");
    assert.match(priv, /export function clearTraitrePrivateLocalForLobby/);
    assert.match(priv, /export async function clearTraitrePrivateForLobby/);
  });

  it("18 - notify NOT_ALLOWED n’utilise pas l’alerte connexion", async () => {
    const calls = [];
    await notifyVoluntaryLeaveFailure(
      {
        ok: false,
        status: "NOT_ALLOWED",
        error: "Tu n'es pas l'hôte de ce lobby.",
      },
      {
        showAppAlert: async (msg, opts) => {
          calls.push({ msg, opts });
        },
      }
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].msg, /hôte/i);
    assert.equal(calls[0].msg.includes("connexion a empêché"), false);
  });

  it("19 - runbook + harness E5 présents", () => {
    assert.match(
      read("supabase/lobby-membership-e5-RUNBOOK.sql"),
      /QA terrain/
    );
    assert.match(
      read("supabase/lobby-membership-e5-staging-harness.sql"),
      /lobbies_select_host/
    );
    assert.match(
      read("supabase/lobby-membership-e5-RUNBOOK.sql"),
      /CANONICAL_ELSEWHERE|autre lobby Y|timeout.*Y/i
    );
  });

  it("20 - multi-onglets : DISSOLVED puis ALREADY_GONE tous deux ok côté mapping", () => {
    const a = mapDissolveLobbyRpcData(
      { status: "DISSOLVED", lobby_id: "L" },
      "L"
    );
    const b = mapDissolveLobbyRpcData(
      { status: "ALREADY_GONE", lobby_id: "L" },
      "L"
    );
    assert.equal(a.ok && b.ok, true);
  });

  it("21 - none et found-autre-lobby ne sont plus fusionnés", () => {
    const none = interpretDissolveMembershipRequery({ status: "none" }, "X");
    const elsewhere = interpretDissolveMembershipRequery(
      { status: "found", membership: { lobbyId: "Y", role: "member" } },
      "X"
    );
    assert.equal(none.status, LOBBY_DISSOLVE_STATUS.ALREADY_GONE);
    assert.equal(elsewhere.status, LOBBY_DISSOLVE_STATUS.CANONICAL_ELSEWHERE);
    assert.notEqual(none.status, elsewhere.status);
  });
});

describe("lobbyMembershipVagueE5 - CANONICAL_ELSEWHERE sûreté X≠Y", () => {
  /** @type {Map<string, string>} */
  let memoryStorage;
  let prevLocalStorage;

  beforeEach(() => {
    memoryStorage = new Map();
    prevLocalStorage = globalThis.localStorage;
    globalThis.localStorage = {
      getItem: (key) => (memoryStorage.has(key) ? memoryStorage.get(key) : null),
      setItem: (key, value) => {
        memoryStorage.set(key, String(value));
      },
      removeItem: (key) => {
        memoryStorage.delete(key);
      },
    };
    __resetMembershipAuthForTests();
    resetMembershipSnapshotTestState(UID);
  });

  afterEach(() => {
    globalThis.localStorage = prevLocalStorage;
  });

  it("22 - Traître local : clear X ne touche pas Y (contrat clé scoped)", () => {
    const LOCAL_KEY = "reveal-traitre-private";
    const keyX = `${LOCAL_KEY}:lobby-X`;
    const keyY = `${LOCAL_KEY}:lobby-Y`;
    localStorage.setItem(keyX, '{"role":"x"}');
    localStorage.setItem(keyY, '{"role":"y"}');
    // Miroir de clearTraitrePrivateLocalForLobby(lobbyId) - une seule clé.
    localStorage.removeItem(`${LOCAL_KEY}:lobby-X`);
    assert.equal(localStorage.getItem(keyX), null);
    assert.equal(localStorage.getItem(keyY), '{"role":"y"}');
    const priv = read("js/core/traitrePrivate.js");
    assert.match(
      priv,
      /localStorage\.removeItem\(`\$\{LOCAL_KEY\}:\$\{lobbyId\}`\)/
    );
    const elsewhere = read("js/core/lobby.js");
    const start = elsewhere.indexOf(
      "async function reconcileHostDissolveCanonicalElsewhere"
    );
    const end = elsewhere.indexOf(
      "async function reconcileHostDissolveNotAllowed",
      start
    );
    assert.match(
      elsewhere.slice(start, end),
      /clearTraitrePrivateLocalForLobby\(attemptedLobbyId\)/
    );
  });

  it("23 - commitMembershipRemoved(X) préserve snapshot found Y", () => {
    setMembershipSnapshot(
      {
        status: "found",
        membership: {
          lobbyId: "lobby-Y",
          code: "YYYYYY",
          role: "host",
          lobbyStatus: "waiting",
        },
      },
      "e5-elsewhere",
      UID
    );
    const out = commitMembershipRemoved({
      userId: UID,
      lobbyId: "lobby-X",
    });
    assert.equal(out.action, "skipped");
    assert.equal(out.reason, "lobby_mismatch");
    assert.equal(getMembershipSnapshot()?.status, "found");
    assert.equal(getMembershipSnapshot()?.membership?.lobbyId, "lobby-Y");
  });

  it("24 - branche elsewhere : clear Traître / guest / commit ciblés sur X seulement", () => {
    const lobby = read("js/core/lobby.js");
    const start = lobby.indexOf(
      "async function reconcileHostDissolveCanonicalElsewhere"
    );
    const end = lobby.indexOf(
      "async function reconcileHostDissolveNotAllowed",
      start
    );
    const block = lobby.slice(start, end);

    assert.match(block, /clearTraitrePrivateLocalForLobby\(attemptedLobbyId\)/);
    assert.match(
      block,
      /String\(guestMem\.lobbyId\) === String\(attemptedLobbyId\)/
    );
    assert.match(
      block,
      /commitMembershipRemoved\(\{\s*userId,\s*lobbyId: attemptedLobbyId/
    );
    // Pas de wipe auth user / pas applyLeaveLobbyLocal (qui ferait Home + guest wipe).
    assert.equal(block.includes("applyLeaveLobbyLocal"), false);
    assert.equal(block.includes("signOutAnonGuestIfNeeded"), false);
    assert.equal(block.includes("patch.user"), false);
  });

  it("25 - recover Y échoue : pas goToLobby, pas faux succès Home, Y reste cible", () => {
    const lobby = read("js/core/lobby.js");
    const start = lobby.indexOf(
      "async function reconcileHostDissolveCanonicalElsewhere"
    );
    const end = lobby.indexOf(
      "async function reconcileHostDissolveNotAllowed",
      start
    );
    const block = lobby.slice(start, end);

    const recoverIdx = block.indexOf("recoverLobbyFromServer");
    const failIdx = block.indexOf("if (!recovered?.ok)");
    const goIdx = block.indexOf("goToLobby()");
    assert.ok(recoverIdx >= 0 && failIdx > recoverIdx && goIdx > failIdx);

    const failBranch = block.slice(failIdx, goIdx);
    assert.match(failBranch, /ok:\s*false/);
    assert.match(failBranch, /CANONICAL_ELSEWHERE/);
    assert.match(failBranch, /canonicalLobbyId/);
    assert.equal(failBranch.includes("goToLobby"), false);
    assert.equal(failBranch.includes('navigate("home"'), false);
    assert.equal(failBranch.includes("applyHostDissolveLocalSuccess"), false);
    assert.equal(failBranch.includes("applyLeaveLobbyLocal"), false);
    // Pas de promotion none / invalidate dans le fail recover.
    assert.equal(failBranch.includes("invalidateMembershipSnapshot"), false);
    assert.equal(failBranch.includes('status: "none"'), false);
  });
});
