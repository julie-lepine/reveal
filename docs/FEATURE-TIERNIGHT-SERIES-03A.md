# FEATURE-TIERNIGHT-SERIES-03A — Rapport

**Statut** : hardening livré · SQL **non appliqué** par l’agent · RPC **toujours non branchée**  
**Date** : 2026-08-04  
**Git** : aucune opération Git

---

## 1. Verdict

SERIES-03A corrige les défauts bloquants de la RPC déployée : validation stricte des placements (plus de D silencieux), contrat force `roster ∩ finished ∩ placement valide`, validation structurelle série côté serveur, idempotence après résolution du round, `REVOKE` explicite `anon`, golden JS + helpers SQL, smoke exécutable via JWT réel.

---

## 2. Défauts SERIES-03 confirmés ou infirmés

| Défaut | Statut | Preuve |
|--------|--------|--------|
| Placement partiel scoré via fallback `D` | **Confirmé** | SERIES-03 : `placement_item_count > 0` puis `tier_of_item` → `D` |
| Force compte `finished` hors roster | **Confirmé** | `jsonb_each(v_finished)` global |
| Force score non-finished avec placement | **Confirmé** | branche force : `if v_has_placement` sans finished |
| Force accepte placements partiels | **Confirmé** | idem count > 0 |
| Idempotence avant résolution round | **Confirmé** | `ALREADY_APPLIED` avant checks index/entry |
| `anon` conserve EXECUTE | **Confirmé** (staging) | audit user ; `REVOKE FROM public` n’enlève pas grant direct anon |
| `roundCount` ≠ `queue.length` non validé serveur | **Confirmé** | seule `version` + typeof queue |
| Smoke suppose `auth.uid()` magique | **Confirmé** | checklist 03 commentée |
| Calcul SQL vs JS non golden | **Confirmé** | aucun fixture croisé avant 03A |

---

## 3. Validation canonique des placements

Helper SQL `tiernight_series_validate_placement(placement, expected_items)` + miroir JS `validateTierNightSeriesPlacement`.

Vérifie : objet ; clés ∈ {S,A,B,C,D} ; valeurs tableaux ; items texte non vides ; exactitude / unicité vs expected ; pas d’inconnu ; pas de doublon ; expected items uniques.

Codes : `TNS_PLACEMENT_NOT_OBJECT`, `UNKNOWN_TIER`, `TIER_NOT_ARRAY`, `ITEM_NOT_TEXT`, `UNKNOWN_ITEM`, `MISSING_ITEM`, `DUPLICATE_ITEM`, `COUNT_MISMATCH`, + codes items.

La RPC **appelle** cette validation **avant** consensus/score. `tier_of_item` garde un fallback D défensif mais n’est plus utilisé pour masquer l’incomplet.

---

## 4. Contrat force final

**Participants scorables** =

```text
membres roster ∧ finished[uid]=true ∧ placement exhaustif valide
```

| Cas | Comportement |
|-----|--------------|
| `finished` hors roster | ignoré (ne débloque pas) |
| placement sans finished | **non scoré** |
| finished + placement invalide/partiel | **erreur** structurée (corruption) |
| finished valides ≥ 1 | scorés |
| zéro participant | `TNS_FORCE_NO_FINISHED` |
| queue / manches restantes | **inchangées** |

Décision produit : refuser un finished corrompu plutôt que l’exclure silencieusement.

---

## 5. Validation structurelle de la série

`tiernight_series_validate_series_shape(series, run_id)` :

- version=1, phase connue, `roundCount ∈ {3,5,7}`, `len(queue)=roundCount`, `roundIndex` borné ;
- queue : index continu, `roundId=${runId}:${i}`, topic `roster:` unique, pas de custom, snapshot cohérent ;
- ledgers : tableaux, uniques, ∈ queue, `scored ⊆ completed` ;
- `roundHistory` : tableau, roundIds ∈ queue, pas de doublon ;
- roster UUID uniques ; items chaînes uniques non vides.

---

## 6. Nouvelle séquence d’idempotence

1. auth / actor  
2. `FOR UPDATE`  
3. session + série shape + `runId`  
4. résoudre `queue[p_round_index]`  
5. valider `roundId` déterministe + entry + topic  
6. **si** `roundId ∈ scoredRoundIds` → `ALREADY_APPLIED` (OK si phase `between_rounds` \| `series_end`)  
7. sinon exiger phase `ranking` + index actif → scoring  

Retry incohérent (mauvais index/run/round) → stale **avant** ALREADY_APPLIED.

---

## 7. Permissions finales

```sql
REVOKE ALL … FROM public, anon;
GRANT EXECUTE … TO authenticated;
-- helpers tiernight_series_* : REVOKE public/anon/authenticated
```

Vérif runbook §0.2 + `feature-tiernight-series-03a-golden-helpers.sql` section A/B.

---

## 8. Alignement scoring JavaScript / PostgreSQL

| Couche | Artefact |
|--------|----------|
| JS canon | `computeTierNightSeriesRoundScores` (consensus + proximité + outsider mono-thème) |
| Fixtures | `buildTierNightSeriesGoldenFixtures()` → `supabase/feature-tiernight-series-03a-golden-fixtures.json` |
| SQL | `tiernight_series_compute_scores` + median/points helpers |
| Tests Node | médiane, points, fixtures, outsider tie, ordre items |
| Tests SQL staging | golden-helpers.sql (après 03A) |

Divergence mono-thème restante **voulue** : legacy peut encore scorer via fallback D client ; série refuse.

---

## 9. Statistiques et `eveningGamesRecorded`

| Champ | Comportement 03A |
|-------|------------------|
| `stats.tierNightsPlayed` | +1 **uniquement** dernière manche |
| `playerStats[uid].tierNightsPlayed` | +1 roster en dernière manche |
| Retry | ledger → pas de ré-incrément |
| `eveningGamesRecorded.tiernight=true` | posé en fin ; **ne bloque pas** la RPC (idempotence = ledger) ; bloque un futur `recordTierNightPlayed` client |

Risque futur : ne pas rappeler `applyTierNightRoundScores` sur un chemin série (hors scope, non branché).

---

## 10. Contrat du récap final

- **Canon série** : `tierNight.series.roundHistory` (+ `roundRecap` courant)  
- **Bridge legacy** : `tierNight.recap` = **dernière manche seulement**, marqueur `seriesCanon: "roundHistory"`  
- L’écran final futur **ne doit pas** traiter `tierNight.recap` comme la série entière  

---

## 11. Migration corrective créée

`supabase/feature-tiernight-series-03a-finalize-round-hardening.sql`  
(`CREATE OR REPLACE` + ACL) — **pas exécutée** par l’agent.

---

## 12. Fichiers modifiés

| Fichier | Action |
|---------|--------|
| `supabase/feature-tiernight-series-03a-finalize-round-hardening.sql` | créé |
| `supabase/feature-tiernight-series-03a-golden-helpers.sql` | créé |
| `supabase/feature-tiernight-series-03a-golden-fixtures.json` | créé |
| `supabase/feature-tiernight-series-03a-smoke-runbook.sql` | créé |
| `scripts/tiernight-series-03a-smoke.mjs` | créé |
| `js/core/tierNightSeriesPlacement.js` | créé |
| `js/core/tierNightSeriesScoreCompute.js` | créé |
| `tests/featureTierNightSeries03a.test.js` | créé |
| `package.json` | + test 03A |
| `supabase/feature-tiernight-series-03-smoke-checklist.sql` | pointeur 03A |
| `docs/FEATURE-TIERNIGHT-SERIES-03A.md` | ce rapport |

---

## 13. Tests SQL ajoutés

- `feature-tiernight-series-03a-golden-helpers.sql` (ACL + validate + compute + median + reverse) — **manuel staging**  
- Runbook smoke sections 0–3 (ACL, setup, RPC, force, concurrence, cleanup) — **manuel**  

---

## 14. Tests JavaScript ajoutés

`tests/featureTierNightSeries03a.test.js` : placements, force, golden, contrats SQL, non-branchement.

---

## 15. Golden tests

Couverture : impair/pair, diffs, reverse, outsider tie, ordre items, tiers vides, absence interdite.  
Comparaison SQL staging via helpers purs (pas de confiance au seul count).

---

## 16. Résultats ciblés

```text
featureTierNightSeries03a + 03 + 01 + 02 + scoring + consensus + bugs + TN01/02 + live + restart
220 pass / 0 fail
```

SERIES-03A seul : tous les cas du fichier **pass**.

---

## 17. Résultat de la suite globale

Suite npm complète non rejouée intégralement ; non-régression TierNight ciblée **220/220**.  
`package.json` valide JSON.

---

## 18. Nouveau smoke runbook

1. **Méthode R (recommandée)** : `node scripts/tiernight-series-03a-smoke.mjs` avec JWT hôte + lobby test  
2. **Méthode S** : `set_config('request.jwt.claims', …)` staging only  
3. ACL lecture seule sans JWT : runbook §0 + golden-helpers  
4. Mutations séparées des lectures ; nettoyage / `ROLLBACK` ; préfixe lobby test  

Ancien checklist 03 : **supersédé** pour le métier.

---

## 19. Ordre exact d’exécution staging

1. (déjà fait) `feature-tiernight-series-03-finalize-round.sql`  
2. **À faire** : `feature-tiernight-series-03a-finalize-round-hardening.sql`  
3. ACL : golden-helpers A/B  
4. `npm test` ciblé / `featureTierNightSeries03a`  
5. Smoke : `TNS03A_DRY_READ=1` puis RPC + retry  

L’agent **n’a pas** appliqué 03A sur staging.

---

## 20. Risques résiduels

- Drift subtil consensus si ordre d’items controversés à égalité de spread (même règle `>` JS/SQL).  
- Simulation JWT (méthode S) dépend du comportement exact Supabase `auth.uid()`.  
- Helpers non appelables par `authenticated` : golden SQL = rôle postgres/SQL Editor.  
- Pas de preuve concurrence automatisée en CI.

---

## 21. Confirmation que la RPC reste non branchée

Aucun import de `commitTierNightSeriesRoundResult` dans gameplay / select / end / `advanceTierNight…`. Test statique 03A : pass.

---

## 22. Confirmation qu’aucune opération Git n’a été effectuée

Aucune commande Git exécutée pour ce ticket.
