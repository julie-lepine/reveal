/**
 * Audit carnet et cosmétiques n°2 — jetons d'archive carnet nettoyés.
 * La migration reprend dissolve_lobby_atomically (04c) : jetons expirés effacés,
 * pas de jeton pour l'hôte, le reste inchangé.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const sql = read("supabase/fix-carnet-kick-allow-cleanup.sql");
const fn = sql.slice(sql.indexOf("create or replace function"), sql.indexOf("$function$;"));

describe("fix-carnet-kick-allow-cleanup.sql", () => {
  it("efface les jetons expirés avant d'en créer, et une fois à l'application", () => {
    const purge = fn.indexOf("where a.created_at < now() - interval '30 minutes';");
    const insert = fn.indexOf("insert into public.signature_carnet_kick_allow");
    assert.ok(purge > 0 && insert > purge);
    assert.match(sql, /\$function\$;[\s\S]*delete from public\.signature_carnet_kick_allow\s+where created_at < now\(\) - interval '30 minutes';/);
  });

  it("pas de jeton pour l'hôte qui ferme", () => {
    assert.match(fn, /and lm\.user_id <> v_uid\s+and p\.profile_pack is true/);
  });

  it("garde le contrat de 04c : vérif hôte, jetons avant suppression, fermeture notée", () => {
    assert.match(fn, /security definer\s+set search_path to ''/);
    assert.match(fn, /if v_host_id is distinct from v_uid then/);
    assert.ok(fn.indexOf("insert into public.signature_carnet_kick_allow") < fn.indexOf("delete from public.lobbies"));
    assert.match(fn, /'host_closed', now\(\), v_uid/);
    for (const s of ["UNAUTHENTICATED", "ALREADY_GONE", "NOT_ALLOWED", "DISSOLVED"]) {
      assert.ok(fn.includes(`'${s}'`), s);
    }
    assert.match(sql, /revoke all on function public\.dissolve_lobby_atomically\(uuid\) from anon;/);
    assert.match(sql, /grant execute on function public\.dissolve_lobby_atomically\(uuid\) to authenticated;/);
  });
});
