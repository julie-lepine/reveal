import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, saveStatePatch } from "../js/core/state.js";
import { SESSION_GAME_ID_TO_TILE } from "../js/core/gameCatalogTitle.js";
import {
  SIGNATURE_CARNET_ALLOWED_GAMES,
  aggregateCarnetRankSplit,
  aggregateCarnetStats,
  buildSignatureEveningPayload,
  carnetRankBarPercents,
  carnetSparklineLayout,
  carnetWinrateRing,
  chronologicalCarnetEvenings,
  formatCarnetWinrate,
  parseCarnetListPayload,
  sanitizeCarnetGames,
} from "../js/core/signatureCarnetLogic.js";
import {
  CARNET_CARD_HEIGHT,
  CARNET_CARD_WIDTH,
  buildCarnetCardModel,
  canShareCarnetCard,
  carnetCardHook,
  carnetCardLayout,
  carnetCardRankDots,
} from "../js/core/signatureCarnetCardLogic.js";
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

  it("visuels : rangs 1/2/reste, courbe chrono, anneau", () => {
    const split = aggregateCarnetRankSplit([
      { rank: 1 },
      { rank: 1 },
      { rank: 2 },
      { rank: 4 },
      { rank: null },
    ]);
    assert.deepEqual(split, { first: 2, second: 1, rest: 1 });
    const pct = carnetRankBarPercents(split);
    assert.equal(pct.first, 100);
    assert.ok(pct.second > 0 && pct.second < 100);
    assert.equal(carnetRankBarPercents({ first: 0, second: 0, rest: 0 }).first, 0);

    const chrono = chronologicalCarnetEvenings([
      { endedAt: "2026-09-05T10:00:00.000Z", score: 20 },
      { endedAt: "2026-09-01T10:00:00.000Z", score: 5 },
      { endedAt: "2026-09-03T10:00:00.000Z", score: 12 },
    ]);
    assert.deepEqual(chrono.map((r) => r.score), [5, 12, 20]);

    const spark = carnetSparklineLayout([5, 12, 20]);
    assert.equal(spark.dots.length, 3);
    assert.equal(spark.yMin, 0);
    assert.equal(spark.yMax, 30);
    assert.ok(spark.dots[2].y < spark.dots[0].y);
    assert.match(spark.points, /,/);
    const flat = carnetSparklineLayout([10, 10, 10]);
    assert.equal(flat.dots[0].y, flat.dots[2].y);
    assert.equal(flat.yMin, 0);
    assert.equal(flat.yMax, 20);
    const neg = carnetSparklineLayout([-20, 8]);
    assert.equal(neg.yMin, -30);
    assert.equal(neg.yMax, 18);
    const allNeg = carnetSparklineLayout([-20, -5]);
    assert.equal(allNeg.yMin, -30);
    assert.equal(allNeg.yMax, 5);

    const ring = carnetWinrateRing(2 / 3);
    assert.equal(ring.percent, 67);
    assert.ok(ring.dash > 0 && ring.dash < ring.circumference);
    assert.equal(carnetWinrateRing(null).percent, 0);
    assert.equal(carnetWinrateRing(1).dash, carnetWinrateRing(1).circumference);
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

    const fromTable = parseCarnetListPayload([
      { ended_at: "2026-09-05T10:00:00.000Z", rank: 2, score: 8, games: ["trivia"], friend_names: ["Tom"] },
    ]);
    assert.equal(fromTable.evenings.length, 1);
    assert.equal(fromTable.evenings[0].rank, 2);
    assert.deepEqual(fromTable.evenings[0].friendNames, ["Tom"]);
    assert.equal(fromTable.stats.evenings, 1);
  });

  it("SQL : table interne, RPC, trim 20, pas de GRANT SELECT client", () => {
    const sql = src("supabase/feature-profile-04-carnet.sql");
    assert.match(sql, /create table if not exists public\.signature_evenings/);
    assert.match(sql, /unique \(user_id, lobby_id\)/);
    assert.match(sql, /limit 20/);
    assert.match(sql, /create or replace function public\.archive_signature_evening/);
    assert.match(sql, /create function public\.list_signature_carnet/);
    assert.match(sql, /signature_locked/);
    assert.match(sql, /is_lobby_member/);
    assert.match(sql, /friends_live_display_name/);
    assert.match(sql, /p_peer_user_ids/);
    assert.match(sql, /notify pgrst/);
    assert.match(sql, /revoke all on table public\.signature_evenings from authenticated/);
    assert.doesNotMatch(sql, /grant select on table public\.signature_evenings/);
    const listFn = sql.slice(sql.indexOf("create function public.list_signature_carnet"));
    assert.match(sql, /returns table/);
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
    assert.match(screen, /carnet-viz/);
    assert.match(screen, /carnet-ring/);
    assert.match(screen, /carnet-spark-wrap/);
    assert.match(screen, /carnet-spark__y--min/);
    assert.match(screen, /carnet-spark__y--max/);
    const css = src("style.css");
    assert.match(css, /\.carnet-spark__y--min\{[\s\S]*bottom:0/);
    assert.match(css, /\.carnet-spark__y--max\{[\s\S]*top:8px/);
    assert.match(screen, /carnet-rank-row/);
    assert.match(screen, /CARNET_LABEL\.listTitle/);
    assert.match(screen, /data-carnet-share/);
    assert.match(screen, /openCarnetSharePreview/);
    const shareIdx = screen.indexOf("data-carnet-share");
    const listIdx = screen.indexOf("CARNET_LABEL.listTitle");
    assert.ok(shareIdx > 0 && listIdx > shareIdx);
    assert.match(screen, /carnet-chip/);
    assert.match(screen, /medalForCompetitionRank/);
    const sync = src("js/core/gameSync.js");
    const menuBlock = sync.slice(
      sync.indexOf("const MENU_SCREENS"),
      sync.indexOf("export function isPassiveChromeScreen")
    );
    assert.match(menuBlock, /"carnet"/);
    assert.match(sync, /screen === "carnet"/);
    const hub = sync.slice(
      sync.indexOf("if (isSessionHubScreen(screen))"),
      sync.indexOf('return routeLog(false, "session_hub_screen_guest_free")')
    );
    assert.match(hub, /current === "lobby"/);
    assert.doesNotMatch(hub, /isPassiveChromeScreen/);
    assert.match(screen, /suppressSessionRoute/);
  });

  it("carte share 9:16 : 20 pastilles, pas de prénoms d’amis", () => {
    assert.equal(canShareCarnetCard([]), false);
    assert.equal(canShareCarnetCard([{ rank: 1 }]), true);

    const dots = carnetCardRankDots([
      { endedAt: "2026-09-05T10:00:00.000Z", rank: 1 },
      { endedAt: "2026-09-01T10:00:00.000Z", rank: 2 },
      { endedAt: "2026-09-03T10:00:00.000Z", rank: 4 },
    ]);
    assert.equal(dots.length, 20);
    assert.deepEqual(dots.slice(0, 3), ["second", "rest", "first"]);
    assert.ok(dots.slice(3).every((t) => t === "empty"));

    const model = buildCarnetCardModel({
      identity: {
        name: "Ada",
        emoji: "🦄",
        color: "#60A5FA",
        nameColor: "gold",
        signature: true,
      },
      evenings: [
        {
          endedAt: "2026-09-05T10:00:00.000Z",
          rank: 1,
          score: 20,
          games: ["hottake"],
          friendNames: ["Léa", "Tom"],
        },
      ],
      stats: { evenings: 1, games: 1, mvp: 1, winrate: 1, favoriteGame: "hottake" },
    });
    const dumped = JSON.stringify(model);
    assert.equal(dumped.includes("Léa"), false);
    assert.equal(dumped.includes("Tom"), false);
    assert.equal(dumped.includes("friend"), false);
    assert.equal(model.identity.name, "Ada");
    assert.equal(model.identity.nameColorHex, "#F5D76E");
    assert.equal(model.dots.length, 20);
    assert.equal(model.hook, "Première soirée, première place");

    const layout = carnetCardLayout();
    assert.equal(layout.w, CARNET_CARD_WIDTH);
    assert.equal(layout.h, CARNET_CARD_HEIGHT);
    assert.equal(layout.w / layout.h, 1080 / 1920);
    assert.ok(layout.hero.y >= layout.padTop);
    assert.ok(layout.ident.y >= layout.hero.y + layout.hero.h);
    assert.ok(layout.dots.y >= layout.tiles[2].y + layout.tiles[2].h);
    assert.ok(layout.logo.y > layout.dots.y + layout.dots.h);
    assert.ok(layout.logo.y + layout.logo.h <= layout.h - 160);

    const cardJs = src("js/core/signatureCarnetCard.js");
    assert.doesNotMatch(cardJs, /friendNames|friend_names/);
    assert.match(cardJs, /renderCarnetSharePng/);
    assert.match(cardJs, /navigator\.share/);
    assert.match(cardJs, /layout\.yMin/);
    assert.match(cardJs, /layout\.yMax/);
    assert.match(cardJs, /chart\.x \+ chart\.w/);
    assert.match(cardJs, /chart\.y \+ chart\.h/);
    assert.doesNotMatch(cardJs, /box\.y \+ box\.h - 18/);
    const labels = src("js/config/signatureCarnet.js");
    assert.match(labels, /Partager ma carte/);
    assert.match(labels, /Mes 20 dernières soirées/);
    assert.doesNotMatch(labels, /derniers tops/);
  });

  it("accroche carte : barème, 🥇, pas Mon carnet", () => {
    const days = (d) => ({
      endedAt: `2026-09-0${d}T10:00:00.000Z`,
      score: 10,
      games: ["clutch"],
    });
    const hook = (rows, statsExtra = {}) =>
      carnetCardHook(
        buildCarnetCardModel({
          evenings: rows,
          stats: {
            evenings: rows.length,
            games: rows.length,
            mvp: rows.filter((r) => r.rank === 1).length,
            winrate: rows.length
              ? rows.filter((r) => r.rank === 1).length / rows.length
              : null,
            favoriteGame: "clutch",
            ...statsExtra,
          },
        })
      );

    assert.equal(
      hook([
        { ...days(1), rank: 1 },
        { ...days(2), rank: 1 },
        { ...days(3), rank: 1 },
      ]),
      "3 🥇 d'affilée"
    );
    assert.equal(
      hook([
        { ...days(1), rank: 1 },
        { ...days(2), rank: 1 },
        { ...days(3), rank: 2 },
      ]),
      "3 soirées, 3 podiums"
    );
    assert.equal(
      hook([
        { ...days(1), rank: 1 },
        { ...days(2), rank: 3 },
        { ...days(3), rank: 1 },
      ]),
      "2 MVP en 3 soirées"
    );
    assert.equal(
      hook(
        Array.from({ length: 6 }, (_, i) => ({
          endedAt: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
          rank: i < 4 ? 1 : 3,
          score: 10,
          games: ["clutch"],
        }))
      ),
      "67 % de 1re places"
    );
    assert.equal(hook([{ ...days(1), rank: 2 }]), "Jeu fétiche : Clutch");
    assert.equal(hook([{ ...days(1), rank: 2 }], { favoriteGame: null }), "C'est lancé");
    assert.equal(
      hook(
        [
          { ...days(1), rank: 3 },
          { ...days(2), rank: 4 },
        ],
        { favoriteGame: null }
      ),
      "2 soirées au compteur"
    );
    assert.doesNotMatch(hook([{ ...days(1), rank: 2 }], { favoriteGame: null }), /carnet/i);
  });

  it("recadrage cercle : cover, clamp, pas de capture caméra", async () => {
    const { cropMinScale, cropMaxScale, clampCropTransform, cropSourceRect } = await import(
      "../js/core/signatureCarnetCropLogic.js"
    );
    assert.equal(cropMinScale(400, 200, 100), 0.5);
    assert.equal(cropMaxScale(0.5), 2);
    const clamped = clampCropTransform({
      tx: 999,
      ty: 999,
      scale: 0.5,
      imgW: 400,
      imgH: 200,
      circleD: 100,
      minScale: 0.5,
      maxScale: 2,
    });
    assert.equal(clamped.ty, 0);
    assert.equal(clamped.tx, 50);
    const rect = cropSourceRect({
      imgW: 400,
      imgH: 200,
      scale: 0.5,
      tx: 0,
      ty: 0,
      circleD: 100,
    });
    assert.equal(rect.sw, 200);
    assert.equal(rect.sh, 200);
    assert.equal(rect.sy, 0);

    const cropUi = src("js/core/signatureCarnetCrop.js");
    assert.doesNotMatch(cropUi, /rotate|90°|Pivoter/);
    assert.match(cropUi, /carnet-crop-dialog/);
    assert.doesNotMatch(src("js/core/signatureCarnetCard.js"), /openCarnetPhotoCrop/);
    assert.match(src("js/screens/settings.js"), /openCarnetPhotoCrop/);
  });
});
