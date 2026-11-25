/**
 * Audit badges, classement et stats n°1 — écritures directes dans game_sessions
 * réservées à l'hôte du salon. Avant, un invité pouvait créer la ligne entre deux
 * parties (elle est supprimée au retour au choix des jeux) et y écrire ses points.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/fix-game-sessions-host-only.sql");
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");
const sync = read("js/core/gameSync.js");

const HOST_CHECK = "public.is_lobby_host(lobby_id) and auth.uid() = host_id";

function policy(name) {
  const start = code.indexOf(`create policy "${name}"`);
  assert.ok(start >= 0, `${name} introuvable`);
  return code.slice(start, code.indexOf(";", start));
}

describe("fix-game-sessions-host-only.sql", () => {
  it("ajout : hôte du salon et hôte de la ligne", () => {
    const p = policy("game_sessions_insert");
    assert.match(p, /for insert/);
    assert.ok(p.includes(`with check (${HOST_CHECK})`), p);
    assert.doesNotMatch(p, /is_lobby_member/);
  });

  it("modification : même contrôle avant et après", () => {
    const p = policy("game_sessions_update");
    assert.match(p, /for update/);
    assert.ok(p.includes(`using (${HOST_CHECK})`), p);
    assert.ok(p.includes(`with check (${HOST_CHECK})`), p);
  });

  it("suppression : même contrôle", () => {
    const p = policy("game_sessions_delete");
    assert.match(p, /for delete/);
    assert.ok(p.includes(`using (${HOST_CHECK})`), p);
  });

  it("idempotent, lecture non touchée", () => {
    for (const name of ["game_sessions_insert", "game_sessions_update", "game_sessions_delete"]) {
      assert.ok(code.includes(`drop policy if exists "${name}" on public.game_sessions;`), name);
    }
    assert.doesNotMatch(code, /game_sessions_select/);
  });
});

describe("l'appli n'écrit directement que depuis l'hôte", () => {
  it("création de session hors fonction serveur : seulement si hôte", () => {
    const start = sync.indexOf("async function patchGameStateInner(");
    const body = sync.slice(start, sync.indexOf("\n}\n", start));
    const missing = body.slice(body.indexOf("if (!freshRow) {\n    const hostId"));
    assert.ok(missing.indexOf("if (isLobbyHost())") < missing.indexOf("upsertSessionPreservingRosterTopics("));
    assert.match(missing, /\} else \{\s*throw new Error\(\s*"Session de jeu introuvable/);
  });

  it("fin de partie (suppression) : seulement si hôte", () => {
    const idx = sync.indexOf("await endGameSession();");
    assert.ok(idx > 0);
    const before = sync.slice(Math.max(0, idx - 80), idx);
    assert.match(before, /if \(isLobbyHost\(\)\) \{\s*$/);
  });
});
