/**
 * Audit « hôte qui quitte » n°2 — Le Traître : si un joueur (souvent l'hôte) part
 * avant de confirmer son mot, la distribution restait bloquée. L'hôte ou son
 * remplaçant peut désormais « Commencer sans attendre » dès qu'un joueur a confirmé.
 * Le résolveur pur (resolveTraitreAdvance) est le contrat de advance_traitre_play.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTraitreAdvance, traitreAdvanceRpcArgs } from "../js/core/traitreAdvance.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function session(overrides = {}) {
  return {
    matchId: "match-a",
    pairId: "social_1",
    phase: "deal",
    speakRound: 1,
    speakerIndex: 0,
    alive: ["Alice", "Bob", "Chloé"],
    eliminated: [],
    votes: {},
    dealAcks: {},
    lastEliminated: null,
    ...overrides,
  };
}

function request(current, action, extra = {}) {
  return {
    action,
    expectedMatchId: current.matchId,
    expectedPhase: current.phase,
    expectedSpeakRound: current.speakRound ?? 1,
    expectedPairId: current.pairId,
    expectedAliveCount: (current.alive || []).length,
    force: false,
    ...extra,
  };
}

describe("Le Traître : départ forcé après la distribution", () => {
  const partial = session({ dealAcks: { Bob: true, Chloé: true } }); // Alice (hôte) partie

  it("sans forcer : toujours bloqué tant que tout le monde n'a pas confirmé", () => {
    const r = resolveTraitreAdvance(partial, request(partial, "deal_to_speak"));
    assert.equal(r.kind, "rejected");
    assert.equal(r.code ?? r.reason ?? r.error, "TRAITRE_WAITING_ACKS");
  });

  it("forcé avec au moins une confirmation : la partie démarre", () => {
    const r = resolveTraitreAdvance(partial, request(partial, "deal_to_speak", { force: true }));
    assert.equal(r.kind, "applied");
    assert.equal(r.session.phase, "speak");
    assert.equal(r.session.speakerIndex, 0);
  });

  it("forcé sans aucune confirmation : refusé", () => {
    const none = session();
    const r = resolveTraitreAdvance(none, request(none, "deal_to_speak", { force: true }));
    assert.equal(r.kind, "rejected");
  });

  it("tout le monde a confirmé : démarre, forcé ou non (inchangé)", () => {
    const all = session({ dealAcks: { Alice: true, Bob: true, Chloé: true } });
    assert.equal(resolveTraitreAdvance(all, request(all, "deal_to_speak")).kind, "applied");
  });

  it("l'option « forcer » part au serveur pour la distribution et le vote seulement", () => {
    assert.equal(traitreAdvanceRpcArgs(partial, "deal_to_speak", { force: true }).force, true);
    assert.equal(traitreAdvanceRpcArgs(partial, "resolve_vote", { force: true }).force, true);
    assert.equal(traitreAdvanceRpcArgs(partial, "finish_speak", { force: true }).force, false);
    assert.equal(traitreAdvanceRpcArgs(partial, "deal_to_speak").force, false);
  });

  it("bouton « Commencer sans attendre (x/y) » : hôte ou remplaçant, si au moins un a confirmé", () => {
    const screen = read("js/games/traitre.js");
    assert.match(
      screen,
      /mp && host && dealAckCount > 0 && dealAckCount < dealTotal\s*\?\s*`<button type="button" class="btn btn-secondary btn--spaced" id="btn-force-deal">Commencer sans attendre \(\$\{dealAckCount\}\/\$\{dealTotal\}\)<\/button>`/
    );
    assert.match(screen, /const host = !mp \|\| canActAsHost\(\);/);
    assert.match(
      screen,
      /#btn-force-deal"\)\?\.addEventListener\(\s*"click",\s*withClickLock\(async \(\) => \{\s*if \(mp && !canActAsHost\(\)\) return;[\s\S]{0,120}commitTraitreAdvance\("deal_to_speak", \{ force: true \}\)/
    );
  });

  it("fichier SQL : modification ciblée, rejouable, exige le passage exactement une fois", () => {
    const sql = read("supabase/feature-traitre-force-deal.sql");
    assert.match(sql, /pg_get_functiondef\(\s*'public\.advance_traitre_play\(uuid,uuid,text,text,integer,text,integer,boolean\)'::regprocedure/);
    assert.match(sql, /if v_count <> 1 then/);
    assert.match(sql, /coalesce\(p_force, false\)/);
    assert.match(sql, /execute replace\(v_def, v_old, v_new\);/);
  });
});
