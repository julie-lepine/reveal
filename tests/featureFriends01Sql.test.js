/**
 * FEATURE-FRIENDS-01 Palier 1 — le SQL du repo respecte js/config/friends.js.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FRIEND_RPC,
  FRIEND_RPC_ERROR,
  FRIENDS_TABLE,
  FRIEND_OVERLAY_STATUSES,
} from "../js/config/friends.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "supabase/feature-friends-01.sql"), "utf8");
const runbook = readFileSync(
  join(ROOT, "supabase/tests/feature-friends-01-runbook.sql"),
  "utf8"
);

describe("FEATURE-FRIENDS-01 Palier 1 — SQL source", () => {
  it("crée les 3 tables et les 7 RPC du contrat", () => {
    for (const table of Object.values(FRIENDS_TABLE)) {
      assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    }
    for (const name of Object.values(FRIEND_RPC)) {
      assert.match(sql, new RegExp(`create or replace function public\\.${name}`));
      assert.match(sql, new RegExp(`grant execute on function public\\.${name}`));
    }
  });

  it("erreurs métier + overlay + cooldown 60 s", () => {
    for (const code of Object.values(FRIEND_RPC_ERROR)) {
      assert.match(sql, new RegExp(`raise exception '${code}'`));
    }
    for (const status of FRIEND_OVERLAY_STATUSES) {
      assert.match(sql, new RegExp(`then '${status}'|else '${status}'`));
    }
    assert.match(sql, /interval '60 seconds'/);
    assert.match(sql, /is_anonymous/);
  });

  it("écritures client interdites ; cooldowns sans realtime", () => {
    assert.match(sql, /grant select on table public\.friend_requests to authenticated/);
    assert.match(sql, /grant select on table public\.friendships to authenticated/);
    assert.match(sql, /revoke all on table public\.friend_request_cooldowns from authenticated/);
    assert.doesNotMatch(sql, /grant insert on table public\.friend_requests/i);
    assert.doesNotMatch(sql, /grant (insert|update|delete) on table public\.friendships/i);
    assert.match(sql, /replica identity full/);
    assert.match(sql, /alter publication supabase_realtime add table public\.friend_requests/);
    assert.match(sql, /alter publication supabase_realtime add table public\.friendships/);
    assert.doesNotMatch(
      sql,
      /alter publication supabase_realtime add table public\.friend_request_cooldowns/
    );
    assert.doesNotMatch(sql, /lobby_messages/);
  });

  it("runbook staging interdit en prod et couvre smoke", () => {
    assert.match(runbook, /INTERDIT EN PRODUCTION/);
    assert.match(runbook, /FRIENDS01_BEHAVIOR_OK/);
    assert.match(runbook, /FRIENDS01_RUNBOOK_OK/);
    assert.match(runbook, /friends_cooldown/);
    assert.match(runbook, /FRIENDS01_RLS_OK/);
  });
});
