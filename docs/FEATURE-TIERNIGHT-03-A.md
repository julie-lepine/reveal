# FEATURE-TIERNIGHT-03 — Étape A — Rapport

**Statut** : contrat moteur livré · UI prep **non** remplacée · gate série toujours OFF  
**Date** : 2026-08-05  
**Git** : aucune opération Git  

> **Suite** : [FEATURE-TIERNIGHT-03-A1](./FEATURE-TIERNIGHT-03-A1.md) puis **[A1-bis](./FEATURE-TIERNIGHT-03-A1BIS.md)** (types JSON stricts) — obligatoires avant étape B.

---

## 1. Verdict

Le moteur SERIES existant évolue sans second modèle :

| Décision | Implémenté |
|----------|------------|
| Option A (`runId` série + `roundId = runId:index`) | Conservée |
| Counts nouveaux | **3 / 5 / 8** |
| Count 7 | Lecture / validate défensive uniquement |
| Customs dans la queue | Autorisés si wire + `topicSnapshot.custom` cohérents |
| Snapshot complet | `id`, `name`, `emoji`, `categoryId`, `custom` |
| One-shot | `excludeCustomIds` + `consumedCustomTopicIds` |
| SQL | Migration additive `feature-tiernight-03-series-contract.sql` |

---

## 2. Fichiers modifiés / créés

| Fichier | Rôle |
|---------|------|
| `js/core/tierNightSeries.js` | Counts, pool, snapshots, validation customs, one-shot helpers |
| `js/core/tierNightSeriesSetup.js` | Pool size / avail 3-5-8 + customs optionnels |
| `js/core/tierNightSeriesLaunch.js` | `customTopics` / `excludeCustomIds` / `consumedCustomTopicIds` |
| `js/screens/tierNightSelect.js` | Tagline gate « 3, 5 ou 8 » (pas de prep HT) |
| `scripts/lib/tiernightSeries05SmokeLib.mjs` | Counts 3/5/7/8 en lecture smoke |
| `supabase/feature-tiernight-03-series-contract.sql` | **Nouveau** — shape SQL |
| `supabase/feature-tiernight-03-series-contract-runbook.sql` | **Nouveau** — ordre d’exec |
| `tests/featureTierNight03.test.js` | **Nouveau** |
| `tests/featureTierNightSeries01/03b/04.test.js` | Alignés |
| `package.json` | Inclut `featureTierNight03.test.js` |
| `docs/FEATURE-TIERNIGHT-03-A.md` | Ce rapport |

Non touchés volontairement : game-prep Hot Take clone, finalize/advance branchés, suppression grille mono, Rank Live.

---

## 3. Contrat moteur final

### Counts

```js
TIER_NIGHT_SERIES_ROUND_COUNTS = [3, 5, 8]        // build + setup
TIER_NIGHT_SERIES_LEGACY_ROUND_COUNTS = [7]       // validate / hydrate seulement
```

### Pool

```text
eligible = uniqueById(
  officialFilteredByCategories
  ∪ filterUnconsumedCustomTopics(lobbyCustoms, excludeCustomIds)
)
queue = shuffle(eligible).slice(0, N)   // N ∈ {3,5,8}
```

- Pas de wrap, pas de doublon, pas de clamp silencieux.
- Customs **ignorent** le filtre catégorie.
- Sources non mutées (copie avant shuffle).

### Snapshot

```js
{ id, name, emoji, categoryId, custom }
// custom true → emoji "" , categoryId ""
```

### One-shot

1. Au build : `consumedCustomTopicIds` = ids custom présents dans la queue.
2. Lancement suivant : passer `excludeCustomIds` (union lobby) pour ne pas les re-tirer.
3. Persistance evening de ces ids = **étape B/C** (helpers purs prêts).

### Identité

Inchangée : `runId` global · `roundId = \`${runId}:${roundIndex}\``.

---

## 4. Audit SQL

| Élément | Avant (03A) | Après (03-A migration) |
|---------|-------------|-------------------------|
| `v_allowed_counts` | `[3,5,7]` | `[3,5,7,8]` |
| Customs | `TNS_CUSTOM_IN_SERIES_QUEUE` | Autorisés si flag cohérent |
| Incohérence | — | `TNS_CUSTOM_SNAPSHOT_INCONSISTENT` |
| Fichier 03A | Conservé tel quel | **Ne pas ré-exécuter après 03-A** |

**SQL requis avant QA MP série** : oui, appliquer `feature-tiernight-03-series-contract.sql` (après 03A/05 selon runbook).

Blob `tierNight.series` : pas de nouvelle table ; pas de whitelist RPC customs impactée.

---

## 5. Tests

```
node --test tests/featureTierNight03.test.js \
  tests/featureTierNightSeries01.test.js \
  tests/featureTierNightSeries02.test.js \
  tests/featureTierNightSeries03b.test.js \
  tests/featureTierNightSeries04.test.js \
  tests/featureTierNightSeries05.test.js
→ 115 pass / 0 fail
```

---

## 6. Hors scope (étapes suivantes)

- Écran prep type Hot Take + readiness
- Suppression grille mono / gate ON
- Branchement finalize + « Thème suivant »
- Persistance remote de `consumedCustomTopicIds`
- Catalogue éditorial 30 thèmes

---

## 7. Risques résiduels

| Risque | Mitigation |
|--------|------------|
| SQL 03A encore en prod sans migration 03-A | Finalize refuse customs / count 8 |
| One-shot non persisté evening | Helpers prêts ; wiring étape B |
| Sessions in-flight roundCount 7 | Validate + SQL acceptent encore 7 |
| Gate OFF | Parcours joueur inchangé jusqu’à étape UI |
