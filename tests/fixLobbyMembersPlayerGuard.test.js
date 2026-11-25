/**
 * Audit sécurité Supabase n°4 — garde sur les écritures directes dans lobby_members.
 * Le garde fige id, lobby_id, user_id, is_host, joined_at pour un joueur : l'appli ne
 * doit donc jamais les envoyer autrement qu'à l'arrivée (is_host: false).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "supabase/fix-lobby-members-player-guard.sql"), "utf8");
const lobby = readFileSync(join(ROOT, "js/core/supabaseLobby.js"), "utf8");

const LOCKED = ["id", "lobby_id", "user_id", "is_host", "joined_at"];

describe("fix-lobby-members-player-guard.sql", () => {
  it("garde SECURITY INVOKER déclenché avant ajout et modification", () => {
    const fn = sql.slice(sql.indexOf("create or replace function"), sql.indexOf("$function$;"));
    assert.doesNotMatch(fn, /security definer/i);
    assert.match(sql, /if current_user in \('authenticated', 'anon'\) then/);
    assert.match(sql, /before insert or update on public\.lobby_members/);
  });

  it("fige les colonnes sensibles en modification, is_host faux à l'arrivée", () => {
    for (const col of LOCKED) {
      assert.ok(sql.includes(`new.${col} := old.${col};`), col);
    }
    assert.match(sql, /tg_op = 'INSERT' then\s+new\.is_host := false;/);
  });

  it("longueurs alignées sur l'appli (pseudo 24)", () => {
    assert.match(sql, /new\.display_name := left\(new\.display_name, 24\)/);
    assert.match(sql, /new\.emoji := left\(new\.emoji, 16\)/);
    assert.match(sql, /new\.color := left\(new\.color, 16\)/);
    assert.match(lobby, /String\(displayName\)\.trim\(\)\.slice\(0, 24\)/);
  });

  it("l'appli ne modifie pas les colonnes figées et arrive en non-hôte", () => {
    const updates = [...lobby.matchAll(/\.from\("lobby_members"\)\s*\.update\(([^)]*)\)/g)].map((m) => m[1]);
    assert.ok(updates.length >= 3);
    for (const body of updates) {
      for (const col of LOCKED) {
        assert.doesNotMatch(body, new RegExp(`\\b${col}\\b`), body);
      }
    }
    const insert = lobby.match(/\.from\("lobby_members"\)\s*\.insert\(\{([\s\S]*?)\}\)/);
    assert.ok(insert);
    assert.match(insert[1], /is_host: false/);
  });
});
