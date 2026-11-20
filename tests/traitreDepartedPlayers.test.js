/**
 * Audit Le Traître n°1 — joueur qui quitte le salon en pleine partie.
 * Avant : le joueur parti restait dans les survivants. Fake parti → tout vote
 * refusé (TRAITRE_ROLE_MISSING), partie impossible à finir ; autre joueur parti →
 * jamais votant, impossible à éliminer, égalités sans fin à deux.
 * Le résolveur pur (resolveTraitreAdvance) est le contrat de advance_traitre_play.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTraitreAdvance } from "../js/core/traitreAdvance.js";
import { TRAITRE_POINTS } from "../data/traitre.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

function vote(overrides = {}) {
  return {
    matchId: "match-a",
    pairId: "social_1",
    phase: "vote",
    speakRound: 2,
    speakerIndex: 0,
    alive: ["Alice", "Bob", "Chloé", "Dom"],
    eliminated: [],
    votes: {},
    dealAcks: {},
    revotePending: false,
    revoteCount: 0,
    tieAfterVote: false,
    voteSurvivals: 0,
    intuitionAwards: {},
    impostorRevealed: false,
    winner: null,
    scoresApplied: false,
    lastEliminated: null,
    ...overrides,
  };
}

function ask(current, extra = {}) {
  return {
    action: "resolve_vote",
    expectedMatchId: current.matchId,
    expectedPhase: current.phase,
    expectedSpeakRound: current.speakRound,
    expectedPairId: current.pairId,
    expectedAliveCount: current.alive.length,
    force: false,
    ...extra,
  };
}

describe("Le Traître : le fake quitte le salon", () => {
  const current = vote({ votes: { Alice: "Bob", Bob: "Alice", Dom: "Bob" } });
  const ctx = { impostorName: "Chloé", memberNames: ["Alice", "Bob", "Dom"] };

  it("la partie s'arrête sans points au lieu d'être refusée", () => {
    const r = resolveTraitreAdvance(current, ask(current), ctx);
    assert.equal(r.kind, "applied");
    assert.equal(r.session.phase, "final");
    assert.equal(r.session.winner, "abandon");
    assert.equal(r.session.impostorName, "Chloé");
    assert.equal(r.session.impostorRevealed, true);
    assert.equal(r.session.scoresApplied, true);
    assert.deepEqual(r.session.alive, ["Alice", "Bob", "Dom"]);
    assert.deepEqual(r.eveningDeltas, {});
    assert.deepEqual(r.session.lastRound.deltas, {});
  });

  it("le retry ne refait rien", () => {
    const first = resolveTraitreAdvance(current, ask(current), ctx);
    const retry = resolveTraitreAdvance(first.session, ask(current), ctx);
    assert.equal(retry.kind, "idempotent");
  });

  it("plusieurs joueurs partis : nom du fake inconnu, partie quand même arrêtée", () => {
    const r = resolveTraitreAdvance(current, ask(current, { force: true }), {
      impostorName: "Chloé",
      memberNames: ["Alice", "Bob"],
    });
    assert.equal(r.session.winner, "abandon");
    assert.equal(r.session.impostorName, null);
  });
});

describe("Le Traître : un autre joueur quitte le salon", () => {
  it("on n'attend plus son vote, et il ne compte plus parmi les survivants", () => {
    // Dom est parti. Fake = Chloé. Alice et Chloé votent Bob, Bob vote Chloé.
    const current = vote({ votes: { Alice: "Bob", Chloé: "Bob", Bob: "Chloé" } });
    const ctx = { impostorName: "Chloé", memberNames: ["Alice", "Bob", "Chloé"] };
    const r = resolveTraitreAdvance(current, ask(current), ctx);
    assert.equal(r.kind, "applied");
    // Sans Dom, il reste Alice + Chloé : le fake est dans le duo final.
    assert.equal(r.session.phase, "final");
    assert.equal(r.session.winner, "traitre");
    assert.deepEqual(r.session.alive, ["Alice", "Chloé"]);
    assert.equal(r.eveningDeltas.Chloé, TRAITRE_POINTS.FAKE_WIN);
    const retry = resolveTraitreAdvance(r.session, ask(current), ctx);
    assert.equal(retry.kind, "idempotent");
  });

  it("fake dans les 2 derniers après départs : il gagne au lieu d'égalités sans fin", () => {
    const current = vote({
      alive: ["Alice", "Bob", "Dom"],
      eliminated: ["Chloé"],
      voteSurvivals: 1,
      votes: { Alice: "Bob", Bob: "Alice" },
    });
    const ctx = { impostorName: "Bob", memberNames: ["Alice", "Bob", "Chloé"] };
    const r = resolveTraitreAdvance(current, ask(current), ctx);
    assert.equal(r.session.phase, "final");
    assert.equal(r.session.winner, "traitre");
    assert.equal(r.session.tieAfterVote, false);
    assert.equal(
      r.eveningDeltas.Bob,
      TRAITRE_POINTS.FAKE_WIN + TRAITRE_POINTS.FAKE_SURVIVE_VOTE
    );
    const retry = resolveTraitreAdvance(r.session, ask(current), ctx);
    assert.equal(retry.kind, "idempotent");
  });

  it("égalité : le joueur parti est retiré, le retry reste idempotent", () => {
    const current = vote({
      alive: ["Alice", "Bob", "Chloé", "Dom", "Eve"],
      votes: { Alice: "Bob", Bob: "Alice", Chloé: "Eve", Eve: "Chloé" },
    });
    const ctx = { impostorName: "Chloé", memberNames: ["Alice", "Bob", "Chloé", "Eve"] };
    const r = resolveTraitreAdvance(current, ask(current), ctx);
    assert.equal(r.session.phase, "speak");
    assert.equal(r.session.tieAfterVote, true);
    assert.deepEqual(r.session.alive, ["Alice", "Bob", "Chloé", "Eve"]);
    assert.equal(resolveTraitreAdvance(r.session, ask(current), ctx).kind, "idempotent");
  });

  it("élimination : le retry reste idempotent même si 2 survivants de moins", () => {
    const current = vote({
      alive: ["Alice", "Bob", "Chloé", "Dom", "Eve"],
      votes: { Alice: "Eve", Bob: "Eve", Chloé: "Eve", Eve: "Alice" },
    });
    const ctx = { impostorName: "Chloé", memberNames: ["Alice", "Bob", "Chloé", "Eve"] };
    const r = resolveTraitreAdvance(current, ask(current), ctx);
    assert.equal(r.session.phase, "speak");
    assert.deepEqual(r.session.alive, ["Alice", "Bob", "Chloé"]);
    assert.equal(resolveTraitreAdvance(r.session, ask(current), ctx).kind, "idempotent");
  });

  it("sans liste des membres : comportement inchangé (tout le monde compté)", () => {
    const current = vote({ votes: { Alice: "Bob", Chloé: "Bob", Bob: "Chloé" } });
    const r = resolveTraitreAdvance(current, ask(current), { impostorName: "Chloé" });
    assert.equal(r.reason, "TRAITRE_VOTES_INCOMPLETE");
  });
});

describe("Le Traître : écran et serveur", () => {
  it("l'écran n'attend que les joueurs encore dans le salon", () => {
    const session = read("js/core/traitreSession.js");
    assert.match(session, /export function getTraitreVotingAlive\(/);
    assert.match(
      session,
      /export function allTraitreVotesIn\(session = getTraitreSession\(\)\) \{\s*const alive = getTraitreVotingAlive\(session\);/
    );
    const screen = read("js/games/traitre.js");
    assert.match(screen, /const voters = getTraitreVotingAlive\(session\);/);
    assert.match(screen, /Clôturer le vote \(\$\{votedCount\}\/\$\{voters\.length\}\)/);
  });

  it("l'écran final affiche « Le fake a quitté la partie » sans points", () => {
    const screen = read("js/games/traitre.js");
    assert.match(screen, /const fakeLeft = resultWinner === "abandon";/);
    assert.match(screen, /Le fake a quitté la partie/);
    assert.match(screen, /Partie arrêtée : aucun point\./);
  });

  it("SQL : survivants filtrés sur les membres, fake parti, duo, retries", () => {
    const sql = read("supabase/fix-traitre-departed-players.sql");
    assert.match(sql, /create or replace function public\.advance_traitre_play\(/);
    assert.match(sql, /where v_uid_by_name \? elem\.value;/);
    assert.match(sql, /v_alive := v_present;/);
    assert.match(sql, /'winner', 'abandon'/);
    assert.match(sql, /if jsonb_array_length\(v_departed\) > 0 and v_alive_count <= 2 then/);
    assert.match(sql, /'tieAfterVote', true,\n\s*'alive', v_alive/);
    assert.equal((sql.match(/and v_alive_count <= v_expected_alive\n/g) || []).length, 2);
    assert.equal((sql.match(/and v_alive_count < v_expected_alive\n/g) || []).length, 1);
    assert.doesNotMatch(sql, /v_alive_count = v_expected_alive - 1/);
    // Le départ forcé déjà en prod est conservé.
    assert.match(sql, /Départ forcé \(hôte \/ remplaçant\)/);
    assert.match(sql, /grant execute on function public\.advance_traitre_play/);
    assert.match(sql, /revoke all on function public\.advance_traitre_play[\s\S]*from anon/);
    // Le fake est lu dans la table privée avant de trancher.
    const privateRead = sql.indexOf("from public.traitre_private");
    const abandon = sql.indexOf("'winner', 'abandon'");
    assert.ok(privateRead > 0 && privateRead < abandon);
  });
});
