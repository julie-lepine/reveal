# FEATURE-TIERNIGHT-04E — Launch atomique série Rank Live

**Statut** : `FEATURE-TIERNIGHT-04E implementation complete — SQL terrain validation pending`  
**Date** : 2026-08-09  
**Git** : aucune opération Git  
**Base** : [04A](./FEATURE-TIERNIGHT-04A.md) · [04B](./FEATURE-TIERNIGHT-04B.md) · [04C](./FEATURE-TIERNIGHT-04C.md) · [04D](./FEATURE-TIERNIGHT-04D.md)

**Pas ready for 04F** — gate SQL terrain 04E d’abord.

---

## Catalogue

`TIER_LISTS` (`data/tierTopics.js`) = **unique** source officielle. Aucun miroir / allowlist SQL.

---

## Architecture (rappel)

Client construit la queue (builder 04B + snapshots + `runId`).  
Serveur sous `FOR UPDATE` : droits, epoch, shape, **C/N**, customs ↔ canon, commit atomique + projection round 0.

Invariant : `custom-live-*` ⇔ `custom:true`.  
Composition stale → `TNS_LIVE_CUSTOM_POOL_STALE`.  
Match custom : id, name, emoji, items, authorUid, custom=true (`author` display hors comparaison).

---

## SQL finals (audit / gate terrain)

| Rôle | Fichier |
|------|---------|
| Migration A | `supabase/feature-tiernight-04e-start-live-series.sql` (**déjà appliquée — ne pas réexécuter**) |
| Harness A1 bootstrap | `supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql` — fixtures **`TN04EA%`**, helpers `tn04ea_*`, ctx persisté |
| Harness A2 tests | `supabase/feature-tiernight-04e-start-live-series-smoke-tests.sql` — R1–R18 + teardown |
| Cleanup secours A | `supabase/feature-tiernight-04e-start-live-series-smoke-cleanup.sql` |
| Stub monolith A | `…-smoke-harness.sql` — DEPRECATED (pointer A1→A2) |
| Migration B | `supabase/feature-tiernight-04e-live-prep-guest-ready.sql` (**déjà appliquée — ne pas réexécuter**) |
| Harness B1 bootstrap | `…-live-prep-guest-ready-smoke-bootstrap.sql` — fixtures **`TN04EB%`**, helpers `tn04eb_*`, ctx persisté |
| Harness B2 tests | `…-live-prep-guest-ready-smoke-tests.sql` — A–O (+K teardown) |
| Cleanup secours B | `…-live-prep-guest-ready-smoke-cleanup.sql` |
| Stub monolith B | `…-live-prep-guest-ready-smoke-harness.sql` — DEPRECATED (pointer B1→B2) |

### Collision namespace corrigée

Bug : `LIKE 'TN04E%'` matchait aussi `TN04EG…`.  
Fix : préfixes **disjoints** `TN04EA%` ⊥ `TN04EB%` + asserts structurels.

### Gate B (comme A / 04C)

1. Exécuter **B1** → attendre `TN04EB B1 READY` + `ctx_rows=1`  
2. Valider le SELECT final  
3. Seulement ensuite exécuter **B2**

---

## Diff RPC partagée `contribute_game_session_player`

Canon = `feature-tiernight-03-prep-guest-contribute.sql`.

| Branche | Avant (03) | Après (04E B) |
|---------|------------|---------------|
| Ready TierNight screen | strict `tiernight-prep` only | `tiernight-prep` **ou** `tiernight-live-prep` |
| Ready write path | toujours `tierNightPrep.ready[uid]` | prep key = screen (`tierNightPrep` \| `tierNightLivePrep`) |
| Ready epoch | `tierNightPrep.setupEpoch` | epoch du blob prep choisi |
| `pool_invalidate` | `tiernight-prep` + `tierNightPrep` | **inchangé** (roster-only) |
| vote / answer / tap / deal_ack / submission / placement / finished | inchangés | inchangés |
| payload cap / guards génériques / target vote UUID | inchangés | inchangés |

**Seul delta fonctionnel 04E** = ready live-prep → `tierNightLivePrep`.

---

## ACL Migration A

Helpers internes : `REVOKE` public + anon + authenticated.  
RPC métier : `start_tiernight_live_series(uuid,int,jsonb)` → `EXECUTE` authenticated.  
Harness A vérifie owner-only helpers + ACL RPC.

### DROP signature `(uuid, integer)`

Recherche repo : aucune RPC pré-04E avec cette signature. DROP défensif = brouillon 04E non déployé uniquement.

---

## Ordre terrain FUTUR (ne pas exécuter maintenant)

1. Migration A  
2. Harness A  
3. Migration B  
4. Harness B  

---

## Hors scope

04F non commencé.
