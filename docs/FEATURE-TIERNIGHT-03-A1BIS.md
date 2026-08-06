# FEATURE-TIERNIGHT-03 — Étape A1-bis — Rapport

**Statut** : types JSON stricts livrés · smokes métier documentés · **pas** d’UI / pas d’étape B  
**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## A. Hardening

| Validation | Code | Justification |
|------------|------|---------------|
| `topicSnapshot.id` non-string | `TNS_SNAPSHOT_ID_TYPE` | Empêche coercion `123` → `"123"` via `->>` |
| `topicSnapshot.name` non-string | `TNS_SNAPSHOT_NAME_TYPE` | Empêche coercion `true` → `"true"` |
| id/name absent ou blank | `TNS_INCOMPLETE_SNAPSHOT` | Distingue absence / vide du mauvais type |
| `custom` null / type / chaîne hors whitelist | `TNS_CUSTOM_FLAG_INVALID` | Snapshot malformé ≠ simple incohérence wire |
| wire ↔ valeur custom | `TNS_CUSTOM_SNAPSHOT_INCONSISTENT` | Conservé pour mismatch métier |
| ledger élément non-string | `TNS_LEDGER_INVALID_ENTRY` | Avant `jsonb_array_elements_text` |
| `categoryIds` shape | `TNS_INVALID_CATEGORY_IDS` (+ detail) | Contrat complet §D |
| Filet | `TNS_SHAPE_EXCEPTION` | Uniquement surprise runtime |

Fichier : `supabase/feature-tiernight-03-a1bis-series-shape-strict.sql`  
Runbook smokes : `…-a1bis-series-shape-strict-runbook.sql`

---

## B. `custom`

| Cas | Résultat |
|-----|----------|
| Canonique | booléen JSON `true` \| `false` |
| Legacy string | `"true"` \| `"t"` \| `"false"` \| `"f"` uniquement |
| `"banana"` / `"yes"` / `"0"` | `TNS_CUSTOM_FLAG_INVALID` |
| Champ **absent** + officiel | accepté comme `false` (legacy) |
| Champ **absent** + wire custom | `TNS_CUSTOM_SNAPSHOT_INCONSISTENT` |
| `custom: null` | `TNS_CUSTOM_FLAG_INVALID` (≠ absent) |
| JS `snapshotTierNightSeriesTopic` | écrit toujours `custom: true\|false` |

---

## C. Ledgers

- Tableau requis (`TNS_LEDGER_NOT_ARRAY`)
- Chaque élément : `jsonb_typeof = 'string'` sinon `TNS_LEDGER_INVALID_ENTRY`
- Puis unicité / ∈ queue / `scored ⊆ completed` (inchangé)
- Tests JS : entier, objet, scored ⊈ completed

---

## D. `categoryIds`

Contrat SQL :

- tableau non vide  
- uniquement strings non vides (après trim)  
- pas de doublons  
- soit exactement `["*"]`  
- soit uniquement des catégories explicites  
- jamais `["*", "survival"]`

**Limite volontaire JS** : appartenance au catalogue `TIER_NIGHT_ROSTER_CATEGORIES` non dupliquée en SQL (évite drift catalogue). Helper : `validateTierNightSeriesCategoryIdsShape`.

---

## E. Smokes (codes métier ≠ `TNS_SHAPE_EXCEPTION`)

Miroir JS (contrat SQL) — tous passent avec code métier précis :

| Cas | Code |
|-----|------|
| id number | `SNAPSHOT_ID_TYPE` |
| name bool | `SNAPSHOT_NAME_TYPE` |
| custom banana / int / object / null | `CUSTOM_FLAG_INVALID` |
| ledger int / object | `LEDGER_INVALID_ENTRY` |
| categoryIds star mixte | `INVALID_CATEGORY_IDS` |

Runbook SQL Editor : S1–S12 (mêmes attentes côté Postgres après apply A1-bis).

---

## F. Suites

```
tests/featureTierNight03a1bis + 03a1 + 03 + SERIES 01/03b/04/05
→ 138 pass / 0 fail
```

---

## SQL à appliquer

1. A1 (si pas déjà)  
2. **`feature-tiernight-03-a1bis-series-shape-strict.sql`**  
3. Smokes runbook A1-bis  

**Étape B** autorisée uniquement après apply SQL + smokes Postgres verts.
