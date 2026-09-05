import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch } from "../js/core/state.js";
import { SESSION_GAME_ID_TO_TILE } from "../js/core/gameCatalogTitle.js";
import {
  SIGNATURE_CARNET_ALLOWED_GAMES,
  aggregateCarnetStats,
  buildSignatureEveningPayload,
  formatCarnetWinrate,
  parseCarnetListPayload,
  sanitizeCarnetGames,
} from "../js/core/signatureCarnetLogic.js";
import { CARNET_SCREEN_ID } from "../js/config/signatureCarnet.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function src(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("FEATURE-PROFILE-04 — carnet Signature", () => {
  let snapshot;

  beforeEach(() => {
    snapshot = structuredClone(getState());
  });

  afterEach(() => {
    saveStatePatch(snapshot);
  });

  it("jeux autorisés alignés sur le catalogue session", () => {
    assert.deepEqual(
      [...SIGNATURE_CARNET_ALLOWED_GAMES].sort(),
      Object.keys(SESSION_GAME_ID_TO_TILE).sort()
    );
    assert.deepEqual(sanitizeCarnetGames(["hottake", "nope", "hottake", "drawit"]), [
      "hottake",
      "drawit",
    ]);
  });

  it("payload d’archive seulement si Signature + salon + activité + rang", () => {
    const base = {
      profilePack: true,
      isGuest: false,
      loggedIn: true,
      lobbyId: "11111111-1111-1111-1111-111111111111",
      hasActivity: true,
      localRank: 2,
      localScore: 15,
      gameIds: ["hottake", "trivia"],
    };
    assert.equal(buildSignatureEveningPayload({ ...base, profilePack: false }), null);
    assert.equal(buildSignatureEveningPayload({ ...base, isGuest: true }), null);
    assert.equal(buildSignatureEveningPayload({ ...base, hasActivity: false }), null);
    assert.equal(buildSignatureEveningPayload({ ...base, localRank: 0 }), null);
    const ok = buildSignatureEveningPayload({
      ...base,
      peerUserIds: [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "not-a-uuid",
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ],
    });
    assert.equal(ok.rank, 2);
    assert.equal(ok.score, 15);
    assert.deepEqual(ok.games, ["hottake", "trivia"]);
    assert.equal("lobbyId" in ok, true);
    assert.deepEqual(ok.peerUserIds, ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
  });

  it("stats : winrate, MVP = rang 1, jeu préféré le plus fréquent", () => {
    const stats = aggregateCarnetStats([
      { rank: 1, games: ["hottake", "trivia"] },
      { rank: 3, games: ["hottake"] },
      { rank: 1, games: ["drawit"] },
    ]);
    assert.equal(stats.evenings, 3);
    assert.equal(stats.games, 4);
    assert.equal(stats.wins, 2);
    assert.equal(stats.mvp, 2);
    assert.equal(stats.winrate, 2 / 3);
    assert.equal(stats.favoriteGame, "hottake");
    assert.equal(formatCarnetWinrate(stats.winrate), "67%");
    assert.equal(formatCarnetWinrate(null), "—");
  });

  it("parse liste : pas de lobby_id, amis encore amis seulement", () => {
    const parsed = parseCarnetListPayload({
      evenings: [
        {
          lobby_id: "secret",
          ended_at: "2026-09-05T10:00:00.000Z",
          rank: 1,
          score: 20,
          games: ["hottake", "evil"],
          friend_names: ["Léa", ""],
        },
      ],
      stats: { evenings: 1, games: 1, wins: 1, mvp: 1, favorite_game: "hottake" },
    });
    assert.equal("lobbyId" in parsed.evenings[0], false);
    assert.equal("lobby_id" in parsed.evenings[0], false);
    assert.deepEqual(parsed.evenings[0].games, ["hottake"]);
    assert.deepEqual(parsed.evenings[0].friendNames, ["Léa"]);
    assert.equal(parsed.stats.favoriteGame, "hottake");
    assert.equal(parsed.stats.winrate, 1);
  });

  it("SQL : table interne, RPC, trim 20, pas de GRANT SELECT client", () => {
    const sql = src("supabase/feature-profile-04-carnet.sql");
    assert.match(sql, /create table if not exists public\.signature_evenings/);
    assert.match(sql, /unique \(user_id, lobby_id\)/);
    assert.match(sql, /limit 20/);
    assert.match(sql, /create or replace function public\.archive_signature_evening/);
    assert.match(sql, /create or replace function public\.list_signature_carnet/);
    assert.match(sql, /signature_locked/);
    assert.match(sql, /is_lobby_member/);
    assert.match(sql, /friends_live_display_name/);
    assert.match(sql, /p_peer_user_ids/);
    assert.match(sql, /notify pgrst/);
    assert.match(sql, /revoke all on table public\.signature_evenings from authenticated/);
    assert.doesNotMatch(sql, /grant select on table public\.signature_evenings/);
    const listFn = sql.slice(sql.indexOf("create or replace function public.list_signature_carnet"));
    assert.doesNotMatch(listFn, /e\.lobby_id/);
    assert.match(listFn, /friend_names/);
  });

  it("archive avant perte de membership (hôte + membre)", () => {
    const lobby = src("js/core/lobby.js");
    const dissolve = lobby.slice(
      lobby.indexOf("export async function dissolveLobbyAsHost"),
      lobby.indexOf("export async function confirmAndLeaveLobby")
    );
    const archiveIdx = dissolve.indexOf("archiveSignatureEveningBeforeLeave");
    const closeIdx = dissolve.indexOf("closeLobbySupabase");
    assert.ok(archiveIdx >= 0 && closeIdx > archiveIdx);

    const leave = src("js/core/voluntaryMemberLeave.js");
    const remote = leave.slice(leave.indexOf("if (remote) {"), leave.indexOf("let res;"));
    assert.match(remote, /archiveSignatureEvening/);
    const leaveCall = lobby.slice(
      lobby.indexOf("return runVoluntaryMemberLeave"),
      lobby.indexOf("export async function leaveLobbyMembershipFromServer")
    );
    assert.match(leaveCall, /archiveSignatureEvening:\s*archiveSignatureEveningBeforeLeave/);
    assert.doesNotMatch(
      lobby.slice(
        lobby.indexOf("export async function leaveLobbyMembershipFromServer"),
        lobby.indexOf("export async function leaveLobbyMembershipFromServer") + 800
      ),
      /archiveSignatureEvening/
    );
  });

  it("Profil : lien Mon carnet, écran dédié, retour onglet Profil", () => {
    const settings = src("js/screens/settings.js");
    assert.match(settings, /CARNET_SCREEN_ID/);
    assert.match(settings, /CARNET_LABEL\.entrySettings/);
    const labels = src("js/config/signatureCarnet.js");
    assert.match(labels, /Mon carnet/);
    const main = src("js/main.js");
    assert.match(main, /registerScreen\(CARNET_SCREEN_ID, mountCarnet\)/);
    const nav = src("js/screens/nav.js");
    assert.match(nav, /export function goToCarnet/);
    assert.match(nav, /CARNET_SCREEN_ID/);
    const tabs = src("js/config/settingsTabs.js");
    assert.match(tabs, /"carnet"/);
    assert.equal(CARNET_SCREEN_ID, "carnet");
    const screen = src("js/screens/carnet.js");
    assert.doesNotMatch(screen, /lobby_id/);
    assert.match(screen, /data-carnet-forfaits/);
    assert.match(screen, /CARNET_LABEL\.seePacks/);
    const sync = src("js/core/gameSync.js");
    const menuBlock = sync.slice(
      sync.indexOf("const MENU_SCREENS"),
      sync.indexOf("export function isPassiveChromeScreen")
    );
    assert.match(menuBlock, /"carnet"/);
    assert.match(sync, /screen === "carnet"/);
  });
});
