# FEATURE-TIERNIGHT-04B — Domaine pur Rank Live série

**Statut** : `FEATURE-TIERNIGHT-04B implementation complete — ready for 04C review`  
**Date** : 2026-08-08  
**Git** : aucune opération Git  
**Contrat** : [`FEATURE-TIERNIGHT-04A.md`](./FEATURE-TIERNIGHT-04A.md)

---

## 1. Inventaire réel

| Élément | Constat |
|---------|---------|
| `TIER_LISTS` | 8 listes `{ id, name, emoji, items[] }` — **pas** de `categoryId` |
| `getAllTierLists()` | fusionne `TIER_LISTS + customTierLists` local → **non utilisé** par 04B |
| `combinedGameDeck.js` | `shuffleArray`, `dedupeEntriesById`, `prepareCombinedDeckPool`, `buildCombinedShuffledDeck` (+ helpers Dilemma) |
| Consommateurs `buildCombinedShuffledDeck` | `tierNightSeries.js` (roster), `dilemmaSession` via `buildDilemmaDeckEntries`, tests Dilemma |
| Décision réutilisation | **B** — helper **non modifié** ; wrapper live `buildTierNightLiveSeriesListSubset` |

API `buildCombinedShuffledDeck(customs, bank, requestedRoundCount, resolveEffectiveRoundCount, random)` : customs prioritaires, pas de giant-shuffle+slice quand C&lt;R. Live passe `(requested) => Number(requested) \|\| 0` puis assert `length === R` (comme roster).

---

## 2. Fichiers créés / modifiés

| Fichier | Rôle |
|---------|------|
| `js/core/customLiveTierLists.js` | **Nouveau** — ids, normalize/validate customs, sanitize collection |
| `js/core/tierNightLiveSeriesDomain.js` | **Nouveau** — counts 3/5/7, pool officiel, categoryIds V1, builder |
| `tests/featureTierNight04b.test.js` | **Nouveau** — tests domaine |
| `docs/FEATURE-TIERNIGHT-04B.md` | **Nouveau** — ce rapport |
| `package.json` | Ajoute le test au script `test` |

**Non touchés** : `combinedGameDeck.js`, SQL, UI, navigation, `state.js`, runtime live, `customTierLists`.

---

## 3. Constantes live

```js
TIER_NIGHT_LIVE_SERIES_ROUND_COUNTS = [3, 5, 7]
DEFAULT_TIER_NIGHT_LIVE_SERIES_ROUND_COUNT = 5
isValidTierNightLiveRoundCount(value) // strict : number ∈ {3,5,7} ; "5" / 8 → false
```

Distinctes des counts roster `[3,5,8]`.

---

## 4. Contrat validation custom

| Fonction | Rôle |
|----------|------|
| `normalizeCustomLiveTierListInput` | trim, emoji défaut `✨`, copie items — **sans** accepter l’invalide |
| `validateCustomLiveTierList` | id `custom-live-*`, name 2–40, emoji ≤4, items 4–16, item ≤40, doublons case/trim, author + authorUid, `custom===true`, JSON ≤4096 |
| `sanitizeCustomLiveTierListsCollection` | skip invalides + dédup id |
| `validateCustomLiveTierListsForBuild` | tous valides + ids uniques sinon erreur |
| `createCustomLiveTierListId` | `custom-live-` + UUID |

Longueurs = **code units** UTF-16 (`String.length`) — convention REVEAL.

**Pas** de limite de nombre de customs.

---

## 5. Frontière modération

`checkHotTakeModeration` est **pur/local** mais volontairement **hors** validate/builder 04B.

À brancher en **04C/04D** à la contribution (UI/session) sur `name` + chaque `item`, avant upsert.

---

## 6. Ledger consumed

**Aucun helper consumed** — retiré du contrat 04A. Clear collection à `series_end` (04F).

---

## 7. Builder

`buildTierNightLiveSeriesListSubset({ officialLists?, customLists, roundCount, categoryIds?, random? })`

```text
si roundCount ∉ {3,5,7} → INVALID_ROUND_COUNT
si categoryIds ≠ ["*"] → INVALID_CATEGORY_IDS
valider tous les customs
si official.length + C < R → INSUFFICIENT_POOL
sinon buildCombinedShuffledDeck(customs, officials, R, …)
assert length === R
```

Cas :
- C=0 → R officielles  
- C&lt;R → tous les C + (R−C) officielles  
- C≥R → R customs  

Sortie = **listes** (pas encore `LiveQueueEntry` / runId / roundId).

---

## 8. Protection `customTierLists` local

- Pool officiel = `getTierNightLiveOfficialPool()` ← `TIER_LISTS` uniquement.  
- Customs builder = shape `custom-live-*` validée.  
- Test : id `custom-999` (shape locale) → `INVALID_CUSTOM_LIVE_ID` ; absent du pool officiel.

---

## 9. Catégories

- Aucune taxonomie `life/food/culture/digital`.  
- Aucun `categoryId` sur listes officielles.  
- Wire API : `categoryIds: ["*"]` only (sinon reject).

---

## 10. Tests

Suite `tests/featureTierNight04b.test.js` : constantes, catalogue, validation, catégories, builder (C=0/&lt;/≥/≫, pool insuffisant, local isolation, immutabilité, multi-RNG), smoke `combinedGameDeck`, ENTRY_TOO_LARGE.

Non-régression exécutée avec succès :
- `featureDilemma01DeckRegression.test.js`
- `featureDilemma01QaFixes.test.js`
- `featureTierNight03.test.js`
- `featureTierNight04b.test.js` (après fix smoke shuffle)

---

## 11. Baseline

Aucune failure préexistante masquée. Un assert smoke shuffle trop strict a été corrigé dans le test 04B uniquement.

---

## 12. Helpers partagés

`combinedGameDeck.js` : **non modifié**. Blast radius = 0.

---

## 13. Dettes / risques pour 04C

1. RPC upsert/delete atomiques + preserve-array (payload entry 4096).  
2. Brancher modération à la contribution.  
3. Sync multi-auteur sans republier toute la collection.  
4. Mesurer taille cumulée state si beaucoup de customs (pas de plafond count produit).  
5. Clear ALL à `series_end` + frontiers (04F/04G).

---

## 14. Statut

`FEATURE-TIERNIGHT-04B implementation complete — ready for 04C review`

Pas de QA terrain à cette étape. FEATURE-TIERNIGHT-04 globale non clôturée.
