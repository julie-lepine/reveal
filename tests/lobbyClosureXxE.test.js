/**
 * BUG-LOBBY-XX-E - copies, mapping RPC, session dédup, SQL migration.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  getLobbyClosureCopy,
  LOBBY_CLOSURE_REASON,
} from "../js/core/lobbyClosureCopy.js";
import {
  mapGetLobbyClosureRpcData,
  LOBBY_CLOSURE_FETCH,
} from "../js/core/lobbyClosureContract.js";
import {
  markLobbyClosureHandled,
  wasLobbyClosureHandled,
  markLocalHostManualDissolve,
  isLocalHostManualDissolve,
  __resetLobbyClosureSessionStateForTests,
} from "../js/core/lobbyClosureSession.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("BUG-LOBBY-XX-E - getLobbyClosureCopy", () => {
  it("host_closed → copie manuelle", () => {
    const c = getLobbyClosureCopy(LOBBY_CLOSURE_REASON.HOST_CLOSED);
    assert.equal(c.title, "Lobby fermé");
    assert.equal(c.message, "L'hôte a fermé le lobby.");
    assert.equal(c.cta, "Retour à l'accueil");
  });

  it("inactive_expired → copie automatique", () => {
    const c = getLobbyClosureCopy(LOBBY_CLOSURE_REASON.INACTIVE_EXPIRED);
    assert.equal(c.title, "Lobby fermé automatiquement");
    assert.match(c.message, /inactivité/i);
    assert.equal(c.cta, "Retour à l'accueil");
  });

  it("raison inconnue / null → générique (pas d'hôte)", () => {
    for (const r of [null, undefined, "", "weird", "host_left"]) {
      const c = getLobbyClosureCopy(r);
      assert.equal(c.message, "Le lobby a été fermé.");
      assert.equal(c.message.includes("hôte"), false);
    }
  });
});

describe("BUG-LOBBY-XX-E - mapGetLobbyClosureRpcData", () => {
  it("found + reason", () => {
    const r = mapGetLobbyClosureRpcData(
      {
        found: true,
        lobby_id: "L1",
        reason: "inactive_expired",
        closed_at: "2026-01-01T00:00:00Z",
        closed_by_uid: null,
      },
      "L1"
    );
    assert.equal(r.status, LOBBY_CLOSURE_FETCH.FOUND);
    assert.equal(r.reason, "inactive_expired");
  });

  it("found avec reason inconnue → reason null (générique côté UI)", () => {
    const r = mapGetLobbyClosureRpcData(
      { found: true, lobby_id: "L1", reason: "other" },
      "L1"
    );
    assert.equal(r.status, LOBBY_CLOSURE_FETCH.FOUND);
    assert.equal(r.reason, null);
  });

  it("absent", () => {
    const r = mapGetLobbyClosureRpcData({ found: false, lobby_id: "L1" }, "L1");
    assert.equal(r.status, LOBBY_CLOSURE_FETCH.ABSENT);
    assert.equal(r.reason, null);
  });

  it("UNAUTHENTICATED", () => {
    const r = mapGetLobbyClosureRpcData(
      { found: false, lobby_id: "L1", error: "UNAUTHENTICATED" },
      "L1"
    );
    assert.equal(r.status, LOBBY_CLOSURE_FETCH.UNAUTHENTICATED);
  });

  it("payload invalide → error", () => {
    const r = mapGetLobbyClosureRpcData(null, "L1");
    assert.equal(r.status, LOBBY_CLOSURE_FETCH.ERROR);
  });
});

describe("BUG-LOBBY-XX-E - session dédup", () => {
  beforeEach(() => {
    __resetLobbyClosureSessionStateForTests();
  });

  it("handled par lobbyId - pas de réutilisation autre lobby", () => {
    markLobbyClosureHandled("A");
    assert.equal(wasLobbyClosureHandled("A"), true);
    assert.equal(wasLobbyClosureHandled("B"), false);
  });

  it("local host manual dissolve", () => {
    markLocalHostManualDissolve("H1");
    assert.equal(isLocalHostManualDissolve("H1"), true);
    assert.equal(isLocalHostManualDissolve("H2"), false);
  });
});

describe("BUG-LOBBY-XX-E - migration SQL", () => {
  const sql = read("supabase/lobby-closures-xx-e.sql");

  it("table + check reason + pas de FK cascade lobbies", () => {
    assert.match(sql, /create table if not exists public\.lobby_closures/);
    assert.match(sql, /host_closed/);
    assert.match(sql, /inactive_expired/);
    assert.match(sql, /lobby_closures_reason_check/);
    assert.doesNotMatch(
      sql,
      /lobby_closures[\s\S]{0,400}references public\.lobbies[\s\S]{0,80}on delete cascade/i
    );
  });

  it("RPC get_lobby_closure + grants", () => {
    assert.match(sql, /get_lobby_closure\(p_lobby_id uuid\)/);
    assert.match(sql, /security definer/i);
    assert.match(sql, /grant execute on function public\.get_lobby_closure/);
  });

  it("dissolve écrit host_closed après DELETE réussi", () => {
    assert.match(sql, /dissolve_lobby_atomically/);
    const dissolveStart = sql.indexOf(
      "create or replace function public.dissolve_lobby_atomically"
    );
    const dissolveEnd = sql.indexOf(
      "create or replace function public.purge_stale_lobbies"
    );
    const body = sql.slice(dissolveStart, dissolveEnd);
    assert.match(body, /host_closed/);
    assert.match(body, /on conflict \(lobby_id\) do nothing/i);
    assert.ok(
      body.indexOf("delete from public.lobbies") <
        body.indexOf("insert into public.lobby_closures")
    );
  });

  it("purge écrit inactive_expired depuis deleted_ids + rétention 14j", () => {
    const purgeStart = sql.indexOf(
      "create or replace function public.purge_stale_lobbies"
    );
    const body = sql.slice(purgeStart);
    assert.match(body, /inactive_expired/);
    assert.match(body, /array_agg/);
    assert.match(body, /purge_old_lobby_closures/);
    assert.match(sql, /interval '14 days'/);
    assert.match(body, /interval '2 hours'/);
    assert.match(body, /interval '12 hours'/);
    assert.match(body, /interval '45 minutes'/);
  });
});

describe("BUG-LOBBY-XX-E - client wiring (statique)", () => {
  it("lobby.js pipeline + copies centralisées", () => {
    const lobby = read("js/core/lobby.js");
    assert.match(lobby, /resolveLobbyClosureAndExit/);
    assert.match(lobby, /getLobbyClosureCopy/);
    assert.match(lobby, /markLocalHostManualDissolve/);
    assert.equal(lobby.includes("L'hôte a quitté le lobby."), false);
  });

  it("Realtime DELETE → resolveLobbyClosureAndExit", () => {
    const src = read("js/core/supabaseLobby.js");
    assert.match(
      src,
      /event:\s*"DELETE"[\s\S]*table:\s*"lobbies"[\s\S]*resolveLobbyClosureAndExit/
    );
    assert.match(src, /fetchLobbyClosure/);
    assert.match(src, /getRememberedLobbyId/);
  });

  it("pas d'early-return isLocalLobbyHost dans handleLobbyDissolvedForGuest", () => {
    const lobby = read("js/core/lobby.js");
    const start = lobby.indexOf("export async function handleLobbyDissolvedForGuest");
    const end = lobby.indexOf("export async function handleKickedFromLobby", start);
    const fn = lobby.slice(start, end);
    assert.equal(fn.includes("isLocalLobbyHost()"), false);
  });

  it("kick consulte wasLobbyClosureHandled", () => {
    const lobby = read("js/core/lobby.js");
    const start = lobby.indexOf("export async function handleKickedFromLobby");
    const fn = lobby.slice(start, start + 1200);
    assert.match(fn, /wasLobbyClosureHandled/);
  });
});
