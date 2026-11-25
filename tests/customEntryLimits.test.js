/**
 * Audit contenus perso n°2 : plafonds de nombre (appli + migration).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkCustomEntryLimit,
  isCustomLimitServerError,
  CUSTOM_ENTRIES_MAX_PER_PLAYER,
  CUSTOM_LIVE_TIER_LISTS_MAX_PER_PLAYER,
  CUSTOM_ENTRIES_MAX_PER_LOBBY,
} from "../js/core/customEntryLimits.js";

const mine = (n, author = "Moi") => Array.from({ length: n }, (_, i) => ({ id: `${author}-${i}`, author }));

describe("checkCustomEntryLimit", () => {
  const isMine = (x) => x.author === "Moi";

  it("accepte sous les plafonds", () => {
    assert.deepEqual(checkCustomEntryLimit({ list: mine(9), isMine }), { ok: true });
  });

  it("refuse au plafond par joueur", () => {
    const res = checkCustomEntryLimit({ list: mine(10), isMine, noun: { one: "mot", many: "mots" } });
    assert.equal(res.ok, false);
    assert.equal(res.code, "CUSTOM_LIMIT_PLAYER");
    assert.match(res.error, /10 mots : supprimes-en un pour en ajouter un autre/);
  });

  it("refuse au plafond du salon même si le joueur n'a rien ajouté", () => {
    const res = checkCustomEntryLimit({ list: mine(50, "Autre"), isMine });
    assert.equal(res.ok, false);
    assert.equal(res.code, "CUSTOM_LIMIT_LOBBY");
  });

  it("Rank Live : 3 par joueur", () => {
    const res = checkCustomEntryLimit({
      list: mine(3),
      isMine,
      maxPerPlayer: CUSTOM_LIVE_TIER_LISTS_MAX_PER_PLAYER,
      noun: { one: "tier list", many: "tier lists", feminine: true },
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /3 tier lists : supprimes-en une pour en ajouter une autre/);
  });

  it("reconnaît les refus du serveur par leur hint", () => {
    assert.equal(isCustomLimitServerError({ hint: "CUSTOM_LIMIT_PLAYER" }), true);
    assert.equal(isCustomLimitServerError({ hint: "CUSTOM_LIMIT_LOBBY" }), true);
    assert.equal(isCustomLimitServerError(new Error("Failed to fetch")), false);
  });
});

describe("migration fix-custom-entries-caps.sql alignée sur l'appli", () => {
  const sql = readFileSync(new URL("../supabase/fix-custom-entries-caps.sql", import.meta.url), "utf8");
  const [entryFn, liveFn] = sql.split("create or replace function public.upsert_player_custom_live_tier_list");

  it("mêmes chiffres", () => {
    assert.match(entryFn, new RegExp(`c_max_per_player constant int := ${CUSTOM_ENTRIES_MAX_PER_PLAYER};`));
    assert.match(entryFn, new RegExp(`c_max_per_lobby constant int := ${CUSTOM_ENTRIES_MAX_PER_LOBBY};`));
    assert.match(liveFn, new RegExp(`c_max_per_player constant int := ${CUSTOM_LIVE_TIER_LISTS_MAX_PER_PLAYER};`));
    assert.match(liveFn, new RegExp(`c_max_per_lobby constant int := ${CUSTOM_ENTRIES_MAX_PER_LOBBY};`));
  });

  it("codes dans hint, plafond vérifié avant l'écriture Draw It", () => {
    assert.match(sql, /hint = 'CUSTOM_LIMIT_PLAYER'/);
    assert.match(sql, /hint = 'CUSTOM_LIMIT_LOBBY'/);
    assert.ok(entryFn.indexOf("CUSTOM_LIMIT_LOBBY") < entryFn.indexOf("insert into public.drawit_custom_words"));
  });
});

describe("propriétaire par compte (audit n°4)", async () => {
  const { isAuthorOwnedEntryMine } = await import("../js/core/customEntryLimits.js");
  const { normalizeHotTakeEntry, normalizeDilemmaEntry } = await import(
    "../js/core/sessionMerge.js"
  );

  it("même compte = à moi, autre compte au même pseudo = pas à moi", () => {
    assert.equal(isAuthorOwnedEntryMine({ author: "Léa", authorUid: "u1" }, "Léa", "u1"), true);
    assert.equal(isAuthorOwnedEntryMine({ author: "Léa", authorUid: "u-ancien" }, "Léa", "u1"), false);
  });

  it("entrée d'une ancienne version (sans compte) : repli sur le pseudo", () => {
    assert.equal(isAuthorOwnedEntryMine({ author: "Léa" }, "Léa", "u1"), true);
    assert.equal(isAuthorOwnedEntryMine({ author: "Tom" }, "Léa", "u1"), false);
    assert.equal(isAuthorOwnedEntryMine({ author: null }, "Léa", "u1"), true);
  });

  it("le nettoyage garde l'identifiant du compte, sans l'inventer", () => {
    assert.equal(normalizeHotTakeEntry({ id: "c1", text: "x", author: "Léa", authorUid: "u1" }).authorUid, "u1");
    assert.equal("authorUid" in normalizeHotTakeEntry({ id: "c1", text: "x", author: "Léa" }), false);
    assert.equal(
      normalizeDilemmaEntry({ id: "d1", optionA: "a", optionB: "b", author: "Léa", authorUid: "u1" }).authorUid,
      "u1"
    );
  });
});

describe("migration : n°3 et n°4", () => {
  const sql = readFileSync(new URL("../supabase/fix-custom-entries-caps.sql", import.meta.url), "utf8");

  it("identifiant d'un autre refusé à l'ajout, sans bloquer la suppression", () => {
    assert.match(sql, /hint = 'CUSTOM_ID_TAKEN'/);
    assert.match(sql, /create or replace function public\.delete_player_custom_entry/);
    assert.match(sql, /v_matched_other and not v_removed/);
  });

  it("Hot Take et Dilemma enregistrent authorUid", () => {
    const hottake = sql.slice(sql.indexOf("if v_game = 'hottake' then\n    v_text_a"), sql.indexOf("elsif v_game = 'drawit' then\n    v_text_a"));
    assert.equal((hottake.match(/'authorUid', v_uid::text/g) || []).length, 2);
  });
});
