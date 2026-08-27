/**
 * FEATURE-FRIENDS-03 Palier 1 — le SQL du repo respecte js/config/friends.js.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIEND_CANCEL_RPC_ERROR,
  FRIEND_RPC_F03,
  FRIENDS_TABLE,
} from "../js/config/friends.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "supabase/feature-friends-03.sql"), "utf8");
const runbook = readFileSync(
  join(ROOT, "supabase/tests/feature-friends-03-runbook.sql"),
  "utf8"
);

describe("FEATURE-FRIENDS-03 Palier 1 — SQL source", () => {
  it("2 RPC, pas de nouvelle table, pas de graphe dans lobby_members", () => {
    assert.doesNotMatch(sql, /create table/i);
    assert.doesNotMatch(sql, /alter table public\.lobby_members/i);
    assert.doesNotMatch(sql, /lobby_messages/);
    assert.doesNotMatch(sql, /decline_lobby_invite|cancel_lobby_invite/);
    for (const name of Object.values(FRIEND_RPC_F03)) {
      assert.match(sql, new RegExp(`create or replace function public\\.${name}`));
      assert.match(sql, new RegExp(`grant execute on function public\\.${name}`));
    }
    assert.match(sql, /cancel_friend_request\(p_to uuid\)/);
    assert.match(sql, /from_user_id = v_from/);
    assert.match(sql, /to_user_id = p_to/);
  });

  it("erreurs F01 ; no-op gone ; pas de cooldown", () => {
    for (const code of Object.values(FRIEND_CANCEL_RPC_ERROR)) {
      assert.match(sql, new RegExp(`raise exception '${code}'`));
    }
    const cancelFn = sql.slice(
      sql.indexOf("create or replace function public.cancel_friend_request"),
      sql.indexOf("create or replace function public.list_outgoing_friend_requests")
    );
    assert.match(cancelFn, /result', 'gone'/);
    assert.match(cancelFn, /result', 'cancelled'/);
    assert.doesNotMatch(cancelFn, /insert into public\.friend_request_cooldowns/i);
    assert.doesNotMatch(cancelFn, /friends_cooldown/);
    assert.match(sql, new RegExp(FRIENDS_TABLE.requests));
  });

  it("list_outgoing : to_user_id + profiles live", () => {
    const listFn = sql.slice(sql.indexOf("list_outgoing_friend_requests"));
    assert.match(listFn, /to_user_id uuid/);
    assert.match(listFn, /where r\.from_user_id = v_uid/);
    assert.match(listFn, /left join public\.profiles p on p\.id = r\.to_user_id/);
    assert.doesNotMatch(listFn, /from_user_id uuid/);
  });

  it("runbook staging interdit en prod ; pas d’unfriend / dissolve", () => {
    assert.match(runbook, /INTERDIT EN PRODUCTION/);
    assert.match(runbook, /FRIENDS03_BEHAVIOR_OK/);
    assert.match(runbook, /FRIENDS03_RUNBOOK_OK/);
    assert.match(runbook, /Ne touche PAS aux friendships/);
    assert.doesNotMatch(runbook, /delete from public\.friendships/);
    assert.doesNotMatch(runbook, /unfriend\(/);
    assert.doesNotMatch(runbook, /dissolve_lobby/);
    assert.match(runbook, /FRIENDS03_CANCEL_WROTE_COOLDOWN/);
    assert.match(runbook, /FRIENDS03_RECIPIENT_WIPED_ROW/);
  });
});
