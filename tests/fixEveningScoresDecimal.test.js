/**
 * FIX-EVENING-SCORES-DECIMAL-01 : le cumul de soirée peut être décimal (Consensus,
 * points au dixième). Les helpers SQL d'ajout de points ne doivent plus le lire en
 * entier (22P02 « invalid input syntax for type integer: "235.4" »).
 * Contrat source : le SQL n'est pas exécuté par la suite Node.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, "../supabase/fix-evening-scores-decimal-01.sql"), "utf8");

function functionBody(name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} redéfinie`);
  const end = sql.indexOf("$$;", sql.indexOf("as $$", start));
  return sql.slice(start, end);
}

describe("fix-evening-scores-decimal-01", () => {
  for (const name of ["traitre_add_score_deltas", "drawit_add_score_deltas"]) {
    it(`${name} : cumul et points lus en numeric, plus aucun ::int`, () => {
      const body = functionBody(name);
      assert.match(body, /v_current numeric;/);
      assert.match(body, /v_delta numeric;/);
      assert.match(body, /->>\s*v_entry\.key\)::numeric/);
      assert.match(body, /#>> '\{\}'\)::numeric/);
      assert.doesNotMatch(body, /::int\b/);
      assert.match(body, /immutable/);
      assert.match(body, /set search_path = pg_catalog, public/);
    });

    it(`${name} : droits révoqués comme à l'origine`, () => {
      assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(jsonb, jsonb\\) from public;`));
    });
  }

  it("règles conservées : traitre ignore les deltas ≤ 0, drawit les borne à 0", () => {
    assert.match(functionBody("traitre_add_score_deltas"), /if v_delta > 0 then/);
    assert.match(functionBody("drawit_add_score_deltas"), /greatest\(v_delta, 0\)/);
  });
});
