/**
 * Audit sécurité Supabase n°1 et n°2 — fonctions internes fermées aux joueurs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(ROOT, "supabase/fix-security-internal-functions.sql"), "utf8");

const FNS = [
  "remap_lobby_user_id(uuid, uuid, uuid)",
  "create_lobby_member(uuid, text, text, text)",
];

const INTERNAL = [
  "is_auth_user_anonymous(uuid)",
  "touch_lobby_activity(uuid)",
  "trivia_all_expected_players_answered(uuid, jsonb)",
  "trivia_question_player_uids(uuid, jsonb)",
  "truth_meter_all_expected_voters_voted(uuid, jsonb)",
  "truth_meter_apply_reveal_scoring(uuid, jsonb)",
  "truth_meter_expected_voter_uids(uuid, jsonb)",
  "truth_meter_resolve_author_uid(uuid, jsonb)",
  "cleanup_stale_guest_members()",
];

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === "vendor" ? [] : jsFiles(join(dir, e.name))
      : e.name.endsWith(".js") ? [join(dir, e.name)] : []
  );
}

describe("fix-security-internal-functions.sql", () => {
  for (const fn of FNS) {
    it(`retire ${fn} à public, anon et authenticated`, () => {
      const esc = fn.replace(/[()]/g, "\\$&");
      for (const role of ["public", "anon", "authenticated"]) {
        assert.match(sql, new RegExp(`revoke all on function public\\.${esc} from ${role};`, "i"));
      }
      assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${esc} to (anon|authenticated)`, "i"));
    });
  }

  it("n°6 : retire les outils internes à public, anon et authenticated", () => {
    for (const fn of INTERNAL) {
      assert.ok(sql.includes(`'public.${fn}'`), fn);
    }
    assert.match(sql, /revoke all on function %s from public, anon, authenticated/);
    assert.doesNotMatch(sql, /update_member_presence\(uuid\)'/);
  });

  it("n°7 : search_path fixé sur les deux fonctions qui n'en avaient pas", () => {
    for (const fn of ["cleanup_stale_guest_members()", "update_member_presence(uuid)"]) {
      assert.ok(sql.includes(`alter function public.${fn} set search_path = pg_catalog, public;`), fn);
    }
  });

  it("l'appli n'appelle aucune des fonctions fermées", () => {
    const names = ["remap_lobby_user_id", "create_lobby_member", ...INTERNAL.map((f) => f.split("(")[0])];
    const re = new RegExp(`rpc\\(\\s*["'\`](${names.join("|")})["'\`]`);
    for (const file of jsFiles(join(ROOT, "js"))) {
      assert.doesNotMatch(readFileSync(file, "utf8"), re, file);
    }
  });
});
