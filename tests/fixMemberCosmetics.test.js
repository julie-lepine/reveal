/**
 * Audit carnet et cosmétiques n°1 — emoji et couleur d'un membre du salon.
 * L'appli ne garde qu'un emoji connu et une couleur #hex, échappe ce qu'elle affiche,
 * et la migration applique les mêmes listes côté serveur.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MEMBER_COLOR,
  sanitizeMemberColor,
  sanitizeMemberEmoji,
} from "../js/core/memberCosmetics.js";
import { PROFILE_EMOJI_CHOICES } from "../data/profileEmojis.js";
import { SIGNATURE_EMOJI_CHOICES } from "../data/signatureIdentity.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const sql = read("supabase/fix-member-cosmetics.sql");

const hexOf = (e) => Buffer.from(e.replace(/️/g, ""), "utf8").toString("hex");

function sqlArray(fnName, varName) {
  const start = sql.indexOf(`function public.${fnName}()`);
  const body = sql.slice(start, sql.indexOf("$function$;", start));
  const m = body.match(new RegExp(`${varName} text\\[\\] := array\\[([^\\]]*)\\]`));
  assert.ok(m, `${fnName} ${varName}`);
  return [...m[1].matchAll(/'([0-9a-f]+)'/g)].map((x) => x[1]).sort();
}

describe("memberCosmetics", () => {
  it("garde les emojis gratuits et Signature", () => {
    for (const e of [...PROFILE_EMOJI_CHOICES, ...SIGNATURE_EMOJI_CHOICES]) {
      assert.equal(sanitizeMemberEmoji(e), e, e);
    }
    assert.equal(sanitizeMemberEmoji("🕵"), "🕵️");
  });

  it("remplace un texte ou du HTML par l'emoji par défaut", () => {
    for (const bad of ["<a href=//x.yz>", "<b>x</b>", "abc", "", null, undefined, 42]) {
      assert.equal(sanitizeMemberEmoji(bad), "👤", String(bad));
    }
    assert.equal(sanitizeMemberEmoji("<i>", "🎭"), "🎭");
  });

  it("couleur #hex seulement", () => {
    for (const ok of ["#A78BFA", "#60a5fa", "#fff", "#11223344"]) {
      assert.equal(sanitizeMemberColor(ok), ok);
    }
    for (const bad of ['red;"><b>', "red", "#12", "url(//x)", "", null]) {
      assert.equal(sanitizeMemberColor(bad), DEFAULT_MEMBER_COLOR, String(bad));
    }
    assert.equal(sanitizeMemberColor("x", "#60A5FA"), "#60A5FA");
  });
});

describe("appli : nettoyage à la lecture et échappement à l'affichage", () => {
  it("mapMember nettoie emoji et couleur", () => {
    const lobby = read("js/core/supabaseLobby.js");
    assert.match(lobby, /emoji: sanitizeMemberEmoji\(row\.emoji\),/);
    assert.match(lobby, /color: sanitizeMemberColor\(row\.color, GUEST_COLOR\),/);
  });

  it("aucun emoji ou couleur de joueur inséré sans échappement", () => {
    const files = [
      "js/screens/lobby.js",
      "js/screens/gameSelect.js",
      "js/consensus/ConsensusResults.js",
      "js/games/clutch.js",
      "js/games/dilemma.js",
      "js/games/speedVote.js",
      "js/games/tierNightLive.js",
      "js/games/traitre.js",
      "js/games/truthMeter.js",
      "js/games/wrongAnswer.js",
    ];
    const raw = /\$\{(?:p|row|meta|r\.p|impostorMeta|playerMeta\(name\)|recap\.leaders\[0\])\.(?:emoji|color)\}/;
    for (const f of files) {
      assert.doesNotMatch(read(f), raw, f);
    }
  });
});

describe("fix-member-cosmetics.sql", () => {
  const free = PROFILE_EMOJI_CHOICES.map(hexOf).sort();
  const signature = SIGNATURE_EMOJI_CHOICES.map(hexOf).sort();

  it("listes alignées sur l'appli, dans les deux fonctions", () => {
    for (const fn of ["lobby_members_stamp_signature", "profiles_signature_cosmetics"]) {
      assert.deepEqual(sqlArray(fn, "v_free_hex"), free, fn);
      assert.deepEqual(sqlArray(fn, "v_signature_hex"), signature, fn);
    }
  });

  it("emoji Signature seulement avec le pack, couleur #hex, défaut 👤", () => {
    assert.match(sql, /or \(new\.signature and v_hex = any \(v_signature_hex\)\)/);
    assert.match(sql, /or \(v_pack and v_hex = any \(v_signature_hex\)\)/);
    assert.match(sql, /new\.color !~ '\^#\(\[0-9A-Fa-f\]\{3\}\|\[0-9A-Fa-f\]\{6\}\|\[0-9A-Fa-f\]\{8\}\)\$'/);
    assert.match(sql, /new\.color := '#60A5FA';/);
    assert.equal((sql.match(/decode\('f09f91a4', 'hex'\)/g) || []).length, 2);
  });

  it("le tampon du salon reste SECURITY DEFINER et garde la recopie Signature", () => {
    const start = sql.indexOf("function public.lobby_members_stamp_signature()");
    const fn = sql.slice(start, sql.indexOf("$function$;", start));
    assert.match(fn, /security definer/);
    assert.match(fn, /new\.signature := coalesce\(v_pack, false\);/);
    assert.match(fn, /new\.avatar_rev := case when new\.signature/);
  });
});
