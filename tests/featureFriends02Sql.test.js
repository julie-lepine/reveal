/**
 * FEATURE-FRIENDS-02 Palier 1 — le SQL du repo respecte js/config/lobbyInvites.js.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOBBY_INVITE_RPC,
  LOBBY_INVITE_RPC_ERROR,
  LOBBY_INVITE_TABLE,
  LOBBY_INVITE_UNIQUE,
} from "../js/config/lobbyInvites.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "supabase/feature-friends-02.sql"), "utf8");
const runbook = readFileSync(
  join(ROOT, "supabase/tests/feature-friends-02-runbook.sql"),
  "utf8"
);

describe("FEATURE-FRIENDS-02 Palier 1 — SQL source", () => {
  it("crée lobby_invites + 4 RPC, unique lobby/to, pas de colonnes membres", () => {
    assert.match(
      sql,
      new RegExp(`create table if not exists public\\.${LOBBY_INVITE_TABLE}`)
    );
    assert.equal(LOBBY_INVITE_UNIQUE, "lobby_id_to_user_id");
    assert.match(sql, /unique \(lobby_id, to_user_id\)/);
    assert.match(sql, /references public\.lobbies \(id\) on delete cascade/);
    assert.doesNotMatch(sql, /alter table public\.lobby_members add/i);
    for (const name of Object.values(LOBBY_INVITE_RPC)) {
      assert.match(sql, new RegExp(`create or replace function public\\.${name}`));
      assert.match(sql, new RegExp(`grant execute on function public\\.${name}`));
    }
  });

  it("erreurs métier + busy sans auto-leave + plafond 8 au join", () => {
    for (const code of Object.values(LOBBY_INVITE_RPC_ERROR)) {
      assert.match(sql, new RegExp(`raise exception '${code}'`));
    }
    assert.match(sql, /get_lobby_member_count\(v_lobby_id\) >= 8/);
    assert.match(sql, /interval '24 hours'/);
    assert.match(sql, /ne quitte JAMAIS/);
    assert.match(sql, /raise exception 'lobby_invite_busy'/);
    assert.doesNotMatch(sql, /delete from public\.lobby_members/);
  });

  it("écritures client interdites ; realtime ; list sans code salon", () => {
    assert.match(sql, /grant select on table public\.lobby_invites to authenticated/);
    assert.doesNotMatch(sql, /grant insert on table public\.lobby_invites/i);
    assert.match(sql, /replica identity full/);
    assert.match(
      sql,
      /alter publication supabase_realtime add table public\.lobby_invites/
    );
    const listFn = sql.slice(sql.indexOf("list_incoming_lobby_invites"));
    assert.doesNotMatch(listFn, /\.code\b/);
    assert.doesNotMatch(sql, /from public\.lobbies l[\s\S]*l\.code/);
  });

  it("runbook staging interdit en prod ; pas d’unfriend / dissolve", () => {
    assert.match(runbook, /INTERDIT EN PRODUCTION/);
    assert.match(runbook, /FRIENDS02_BEHAVIOR_OK/);
    assert.match(runbook, /FRIENDS02_RUNBOOK_OK/);
    assert.match(runbook, /FRIENDS02_RLS_OK/);
    assert.match(runbook, /Ne touche PAS aux friendships/);
    assert.doesNotMatch(runbook, /delete from public\.friendships/);
    assert.doesNotMatch(runbook, /dissolve_lobby/);
  });
});
