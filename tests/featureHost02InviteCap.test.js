/**
 * FEATURE-HOST-02 / H-INVITE — accept_lobby_invite suit le cap 8/14 de l’hôte.
 * feature-friends-02.sql (déjà prod) reste le snapshot historique à 8.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOBBY_INVITE_RPC_ERROR } from "../js/config/lobbyInvites.js";
import { lobbyInviteFailMessage } from "../js/core/lobbyInvitesLogic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-HOST-02 — cap invitation ami 8 / 14", () => {
  it("delta SQL : helper sur host_pack de l’hôte, pas du joiner", () => {
    const sql = read("supabase/feature-host-02-invite-cap.sql");
    const helper = sql.slice(
      sql.indexOf("create or replace function public.lobby_max_players"),
      sql.indexOf("create or replace function public.accept_lobby_invite")
    );
    assert.match(helper, /left join public\.profiles p on p\.id = l\.host_id/);
    assert.match(helper, /coalesce\(p\.host_pack, false\)/);
    assert.match(helper, /return 14/);
    assert.match(helper, /return 8/);
    assert.doesNotMatch(helper, /v_uid/);
    assert.match(helper, /revoke all on function public\.lobby_max_players\(uuid\) from authenticated/);
  });

  it("accept_lobby_invite : cap via helper, plus de >= 8 en dur", () => {
    const sql = read("supabase/feature-host-02-invite-cap.sql");
    const accept = sql.slice(sql.indexOf("create or replace function public.accept_lobby_invite"));
    assert.match(
      accept,
      /get_lobby_member_count\(v_lobby_id\) >= public\.lobby_max_players\(v_lobby_id\)/
    );
    assert.doesNotMatch(accept, /get_lobby_member_count\(v_lobby_id\) >= 8/);
    assert.match(accept, /raise exception 'lobby_invite_full'/);
    assert.match(accept, /raise exception 'lobby_invite_busy'/);
    assert.match(accept, /Jamais auto-leave/);
    assert.match(accept, /for v_i in 0\.\.20 loop/);
  });

  it("send_lobby_invite ne gagne pas de check count (plafond = Rejoindre)", () => {
    const friends = read("supabase/feature-friends-02.sql");
    const send = friends.slice(
      friends.indexOf("create or replace function public.send_lobby_invite"),
      friends.indexOf("create or replace function public.decline_lobby_invite")
    );
    assert.doesNotMatch(send, /get_lobby_member_count/);
    const delta = read("supabase/feature-host-02-invite-cap.sql");
    assert.doesNotMatch(delta, /create or replace function public\.send_lobby_invite/);
  });

  it("snapshot FRIENDS-02 historique reste à 8 ; le delta le remplace", () => {
    const friends = read("supabase/feature-friends-02.sql");
    assert.match(friends, /get_lobby_member_count\(v_lobby_id\) >= 8/);
    assert.match(friends, /Ne PAS réexécuter feature-friends-02|plafond 8 au Rejoindre/i);
    const sql = read("supabase/feature-host-02-invite-cap.sql");
    assert.match(sql, /Ne PAS réexécuter feature-friends-02/);
  });

  it("message client plein inchangé", () => {
    assert.equal(LOBBY_INVITE_RPC_ERROR.full, "lobby_invite_full");
    assert.equal(lobbyInviteFailMessage(LOBBY_INVITE_RPC_ERROR.full), "Cette soirée est complète.");
  });

  it("runbook catalogue refuse un accept encore hardcodé à 8", () => {
    const runbook = read("supabase/tests/feature-host-02-invite-cap-runbook.sql");
    assert.match(runbook, /INTERDIT EN PRODUCTION/);
    assert.match(runbook, /HOST02_INVITE_CAP_OK/);
    assert.match(runbook, /HOST02_ACCEPT_HARDCODED_8/);
    assert.match(runbook, /lobby_max_players/);
  });
});
