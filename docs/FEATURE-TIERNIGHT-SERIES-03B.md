# FEATURE-TIERNIGHT-SERIES-03B — Rapport

**Statut** : correctifs intégrés dans le fichier 03A (non encore appliqué) · RPC non branchée  
**Date** : 2026-08-04  
**Git** : aucune opération Git

---

## 1. Verdict

Trois écarts bloquants corrigés **dans** `feature-tiernight-series-03a-finalize-round-hardening.sql` avant première exécution staging : préfixe custom réel `roster:custom-roster-…`, moteur SQL unique via `tiernight_series_compute_scores`, validation stricte des booléens `finished` roster.

---

## 2. Préfixe custom réel vérifié

| Couche | Valeur | Fichier / symbole |
|--------|--------|-------------------|
| Raw id | `custom-roster-…` | `js/core/customRosterTopics.js` → `CUSTOM_ROSTER_TOPIC_ID_PREFIX`, `createCustomRosterTopicId()` |
| Wire id | `roster:` + raw | `js/core/rosterTopic.js` → `ROSTER_TOPIC_PREFIX`, `parseRosterTopicDescriptor()` |
| Exclusion série JS | `rawId.startsWith(CUSTOM_ROSTER_TOPIC_ID_PREFIX)` | `js/core/tierNightSeries.js` → `validateTierNightSeries` / `isTierNightSeriesCatalogTopicEligible` |

Exemple produit : `roster:custom-roster-<uuid>` — **pas** `roster:custom:…`.

---

## 3. Correction d’exclusion customs

SQL shape :

```sql
v_raw_id := substr(v_topic_id, length('roster:') + 1);
if position('custom-roster-' in v_raw_id) = 1
   or position('roster:custom-roster-' in v_topic_id) = 1 then
  → TNS_CUSTOM_IN_SERIES_QUEUE
```

+ conservation de `topicSnapshot.custom` → rejet.

Tests : vrai ID via `createCustomRosterTopicId()`, et wire custom avec `snapshot.custom=false` toujours rejeté.

---

## 4. Moteur SQL canonique unique

`public.tiernight_series_compute_scores(...)` = seul algorithme (consensus, médiane, controversé, proximité, outsider).

---

## 5. Utilisation du moteur par la RPC

Après sélection des participants, la RPC :

1. construit le JSON des UIDs ;
2. appelle `tiernight_series_compute_scores` ;
3. exige `ok=true` ;
4. enrichit les scores (displayName, placed) ;
5. applique ledger / stats / phase.

Preuve test : corps `finalize_*` contient **1** appel `compute_scores`, **0** `median_rank` / `points_for_diff`.

---

## 6. Validation `finished`

Nouveau `tiernight_series_validate_finished(finished, roster)` :

| Valeur roster | Effet |
|---------------|--------|
| absent | non terminé |
| `true` / `false` (boolean JSON) | OK |
| `"true"`, nombre, objet… | `TNS_FINISHED_INVALID_VALUE` |
| clé hors roster | ignorée pour éligibilité (ne score jamais) |

`is_finished_flag` = uniquement `to_jsonb(true)` après validation.

---

## 7. Migration finale à exécuter

**Un seul fichier** (03A amendé, option recommandée) :

```text
supabase/feature-tiernight-series-03a-finalize-round-hardening.sql
```

Pas de migration 03B séparée (03A jamais appliquée).

Ordre : SERIES-03 (déjà fait) → **ce fichier 03A** → ACL / golden-helpers → smoke JWT.

---

## 8. Fichiers modifiés

| Fichier | Action |
|---------|--------|
| `supabase/feature-tiernight-series-03a-finalize-round-hardening.sql` | corrigé in-place |
| `supabase/feature-tiernight-series-03a-golden-helpers.sql` | + finished + custom |
| `js/core/tierNightSeriesPlacement.js` | + finished validators |
| `tests/featureTierNightSeries03b.test.js` | créé |
| `package.json` | + 03b |
| `docs/FEATURE-TIERNIGHT-SERIES-03B.md` | ce rapport |

---

## 9. Tests ajoutés

Customs (wire réel, snapshot.custom=false, catalogue) · moteur unique (extraction corps RPC) · 7 fixtures golden · finished (true/false/absent/invalides/étranger/force).

---

## 10. Résultats ciblés

03A+03B isolés : **28/28** pass.

---

## 11. Résultat global

Non-régression SERIES-01…03B + scoring + BUG-03/04/05 + TN-01/02 + Rank Live + restart + acting host + withPatchTimeout :

| Métrique | Valeur |
|----------|--------|
| tests | **253** |
| pass | **253** |
| fail | **0** |

---

## 12. Ordre exact staging

1. `feature-tiernight-series-03-finalize-round.sql` *(déjà appliqué)*  
2. **`feature-tiernight-series-03a-finalize-round-hardening.sql`** *(à appliquer une fois)*  
3. `feature-tiernight-series-03a-golden-helpers.sql` (ACL + H/I customs/finished)  
4. `scripts/tiernight-series-03a-smoke.mjs`  

---

## 13. Requêtes de contrôle après exécution

```sql
-- custom wire réel
select public.tiernight_series_validate_series_shape(... topicId := 'roster:custom-roster-abc' ...);
-- → TNS_CUSTOM_IN_SERIES_QUEUE

-- finished invalide
select public.tiernight_series_validate_finished('{"<uid>":"true"}', '[{"userId":"<uid>"}]');
-- → TNS_FINISHED_INVALID_VALUE

-- ACL anon
select has_function_privilege('anon',
  'public.finalize_tiernight_series_round(uuid,text,text,integer,text,boolean)', 'EXECUTE');
-- → false

-- moteur : le corps RPC ne doit référencer compute_scores (vérif code source déployé)
```

---

## 14. Risques résiduels

- Golden SQL helpers non exécutables par rôle `authenticated` (postgres/SQL Editor).  
- Preuve d’unicité du moteur = analyse du corps SQL + fixtures JS (pas d’intégration Postgres en CI).  
- Rank Live hors périmètre (inchangé).

---

## 15. Confirmation RPC non branchée

Aucun branchement gameplay ; test 03B pass.

---

## 16. Confirmation aucune opération Git

Aucune commande Git exécutée.
