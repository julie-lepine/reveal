# FEATURE-TIERNIGHT-03 — Étape A1 — Rapport

**Statut** : validateur SQL total livré · preuves + one-shot clarifié · **pas** d’UI  
**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## 1. Verdict

L’architecture A (Option A, 3/5/8 +7 legacy, customs snapshotés) est **conservée**.  
A1 durcit uniquement `tiernight_series_validate_series_shape` pour qu’elle soit **totale** :

```text
Entrée invalide / cast impossible / surprise
        ↓
{ "ok": false, "code": "TNS_..." }
        ↓
jamais raise vers l’appelant
```

---

## 2. Correctifs SQL

| Point | Avant (03-A) | Après (A1) |
|-------|--------------|------------|
| Cast `version` | pouvait lever | `TNS_UNSUPPORTED_VERSION` |
| Cast `roundIndex` entry | pouvait lever | `TNS_ROUND_INDEX_DISCONTINUITY` |
| `categoryIds` | non vérifié | `TNS_INVALID_CATEGORY_IDS` si pas array |
| Flag `custom` | string `true`/`t` seul | bool JSON **ou** string ; autre type → inconsistent |
| Filet | absent | `TNS_SHAPE_EXCEPTION` |
| ACL | GRANT authenticated (erreur) | **REVOKE** public/anon/**authenticated** |

Fichier à appliquer : `supabase/feature-tiernight-03-a1-series-shape-total.sql`  
Runbook : `supabase/feature-tiernight-03-a1-series-shape-total-runbook.sql`

---

## 3. One-shot (cycle de vie clarifié)

| Règle | Valeur |
|-------|--------|
| Consommation | id custom ∈ `series.queue` au lancement |
| Lobby `customRosterTopics` | **non** muté par le moteur |
| Prochaine série | `excludeCustomIds` (union lobby) |
| Série active | snapshot queue = vérité ; delete lobby OK |
| Persistance evening | **pending étape B+** (`persistEvening: "pending_step_b"`) |

Constante : `TIER_NIGHT_SERIES_ONE_SHOT_CONTRACT` dans `tierNightSeries.js`.

---

## 4. Tests

```
tests/featureTierNight03a1.test.js (+ 03 / SERIES 01 / 03b / 04)
→ 92 pass / 0 fail
```

Preuves couvertes : totalité SQL (source), ACL, codes catalogue, one-shot, alignement JS flag/categoryIds.

---

## 5. SQL à exécuter (ordre)

1. SERIES-03A hardening (si pas déjà)  
2. (optionnel) `feature-tiernight-03-series-contract.sql`  
3. **`feature-tiernight-03-a1-series-shape-total.sql`** ← obligatoire avant QA MP  
4. Preuves P0–P5 du runbook A1 (SQL Editor / postgres)

---

## 6. Hors scope (inchangé)

Écran prep · gate ON · finalize/advance branchés · persistance evening one-shot.

**Étape B** : seulement après application SQL A1 + validation des preuves runbook.
