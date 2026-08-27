/**
 * SQL identité live amis : helpers + listes + soin des profils placeholder.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FRIEND_RPC } from "../js/config/friends.js";
import { LOBBY_INVITE_RPC } from "../js/config/lobbyInvites.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(
  join(ROOT, "supabase/feature-friends-03-live-identity.sql"),
  "utf8"
);

describe("FEATURE-FRIENDS identité live — SQL source", () => {
  it("helpers internes, pas de GRANT authenticated", () => {
    assert.match(sql, /create or replace function public\.friends_live_display_name\(p_uid uuid\)/);
    assert.match(sql, /create or replace function public\.friends_live_emoji\(p_uid uuid\)/);
    assert.match(sql, /revoke all on function public\.friends_live_display_name\(uuid\) from authenticated/);
    assert.match(sql, /revoke all on function public\.friends_live_emoji\(uuid\) from authenticated/);
    assert.doesNotMatch(
      sql,
      /grant execute on function public\.friends_live_display_name/
    );
  });

  it("les 4 listes relisent les helpers, pas un simple coalesce profiles", () => {
    for (const name of [
      FRIEND_RPC.listFriends,
      FRIEND_RPC.listIncoming,
      FRIEND_RPC.listOutgoing,
      LOBBY_INVITE_RPC.listIncoming,
    ]) {
      assert.match(sql, new RegExp(`create or replace function public\\.${name}`));
    }
    const listFriends = sql.slice(sql.indexOf("create or replace function public.list_my_friends"));
    assert.match(listFriends, /friends_live_display_name\(other\.id\)/);
    assert.match(listFriends, /friends_live_emoji\(other\.id\)/);
    assert.doesNotMatch(
      listFriends.slice(0, listFriends.indexOf("create or replace function public.list_incoming_friend_requests")),
      /coalesce\(p\.display_name, 'Joueur'\)/
    );
  });

  it("soigne les profils Joueur / 👤 et les lignes manquantes ; pas de nouvelle table", () => {
    assert.doesNotMatch(sql, /create table/i);
    assert.match(sql, /update public\.profiles p/);
    assert.match(sql, /insert into public\.profiles/);
    assert.match(sql, /raw_user_meta_data->>'display_name'/);
    assert.match(sql, /from public\.lobby_members m/);
    assert.match(sql, /char_length\(v_email_local\) < 2/);
    assert.doesNotMatch(sql, /lobby_messages/);
  });
});
