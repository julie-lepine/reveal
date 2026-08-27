/**
 * FEATURE-FRIENDS-04 Palier 1 — le SQL du repo respecte js/config/recentPeers.js.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RECENT_PEERS_RPC,
  RECENT_PEERS_TABLE,
} from "../js/config/recentPeers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "supabase/feature-friends-04.sql"), "utf8");
const runbook = readFileSync(
  join(ROOT, "supabase/tests/feature-friends-04-runbook.sql"),
  "utf8"
);

describe("FEATURE-FRIENDS-04 Palier 1 — SQL source", () => {
  it("table lobby_encounters, pas de colonnes sur lobby_members, pas de chat", () => {
    assert.match(
      sql,
      new RegExp(`create table if not exists public\\.${RECENT_PEERS_TABLE}`)
    );
    assert.match(sql, /constraint lobby_encounters_ordered check \(user_a < user_b\)/);
    assert.match(sql, /last_shared_at timestamptz/);
    assert.match(sql, /on delete cascade/);
    assert.doesNotMatch(sql, /alter table public\.lobby_members add/i);
    assert.doesNotMatch(sql, /lobby_messages/);
  });

  it("trigger INSERT/DELETE, écriture serveur, RLS sans grant client", () => {
    assert.match(sql, /create or replace function public\.friends_record_lobby_encounter/);
    assert.match(sql, /create trigger lobby_encounters_on_member_ins/);
    assert.match(sql, /create trigger lobby_encounters_on_member_del/);
    assert.match(sql, /after insert on public\.lobby_members/);
    assert.match(sql, /before delete on public\.lobby_members/);
    assert.match(sql, /friends_auth_kind\(v_uid\) is distinct from 'registered'/);
    assert.match(
      sql,
      /revoke all on table public\.lobby_encounters from authenticated/
    );
    assert.doesNotMatch(sql, /grant (select|insert|update|delete) on table public\.lobby_encounters/i);
  });

  it("RPC list : 24 h, hors amis, hors lobby commun, identité live, pas de code", () => {
    assert.match(
      sql,
      new RegExp(`create or replace function public\\.${RECENT_PEERS_RPC.list}`)
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${RECENT_PEERS_RPC.list}`)
    );
    const listFn = sql.slice(sql.indexOf("list_recent_lobby_peers"));
    assert.match(listFn, /interval '24 hours'/);
    assert.match(listFn, /from public\.friendships f/);
    assert.match(listFn, /from public\.lobby_members me/);
    assert.match(listFn, /friends_live_display_name/);
    assert.match(listFn, /friends_live_emoji/);
    assert.match(listFn, /purge_stale_lobby_encounters/);
    assert.doesNotMatch(listFn, /lobby_id uuid/);
    assert.doesNotMatch(listFn, /lobby_code|p_code|l\.code/);
    assert.doesNotMatch(sql, /alter publication supabase_realtime add table public\.lobby_encounters/);
    assert.match(sql, /notify pgrst/);
  });

  it("runbook staging interdit en prod ; lobby jetable ; pas d’unfriend", () => {
    assert.match(runbook, /INTERDIT EN PRODUCTION/);
    assert.match(runbook, /FRIENDS04_BEHAVIOR_OK/);
    assert.match(runbook, /FRIENDS04_RUNBOOK_OK/);
    assert.match(runbook, /FRIENDS04_STILL_TOGETHER/);
    assert.match(runbook, /FRIENDS04_AFTER_LEAVE/);
    assert.match(runbook, /FRIENDS04_GUEST_RECORDED/);
    assert.doesNotMatch(runbook, /delete from public\.friendships/);
    assert.doesNotMatch(runbook, /unfriend\(/);
    assert.doesNotMatch(runbook, /dissolve_lobby/);
  });
});
