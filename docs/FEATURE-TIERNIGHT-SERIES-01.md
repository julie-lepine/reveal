# FEATURE-TIERNIGHT-SERIES-01 — Rapport

**Statut** : fondations livrées · mono-thème inchangé · aucun parcours série accessible  
**Date** : 2026-08-04

---

## 1. Résumé des modifications

- Catalogue roster **additif** : catégories stables + `categoryId` / `enabled` / `order` sur les 10 thèmes existants (ids préservés).
- Nouveau module pur `js/core/tierNightSeries.js` : queue, snapshots, état série, validation/legacy, progression, gardes stale, invariants roster.
- Tests unitaires réels (28) + non-régression TierNight (202 pass).
- `package.json` : ajout `featureTierNightSeries01` et rattrapage `featureTierNight02` (absent du script `test`).
- **Aucune** UI série, **aucun** branchement launch/advance/scoring/nav, **aucune** SQL, **aucun** Git.

---

## 2. Fichiers modifiés

| Fichier | Action |
|---------|--------|
| `data/tierTopics.js` | Catégories + champs additifs sur `TIER_NIGHT_ROSTER_TOPICS` |
| `js/core/tierNightSeries.js` | **Créé** — helpers purs |
| `tests/featureTierNightSeries01.test.js` | **Créé** |
| `package.json` | Suites test SERIES-01 + FEATURE-02 |
| `docs/FEATURE-TIERNIGHT-SERIES-01.md` | Ce rapport |

Non touchés (volontaire) : `markTierNightClassicStarted`, `advanceTierNightToResultsWhenReady`, `applyTierNightRoundScores`, `tierNightEnd`, select UI, Realtime, `setTierNightTopicId`, SQL.

---

## 3. Contrat final de `series`

```js
{
  version: 1,
  categoryIds: ["survival"] | ["*"],
  roundCount: 3 | 5 | 7,
  queue: [ /* entrées §4 */ ],
  roundIndex: number,          // 0..roundCount-1
  phase: "ranking" | "round_result" | "between_rounds" | "series_end",
  scoredRoundIds: string[],    // ledger métier (pas encore preuve transactionnelle)
  completedRoundIds: string[]
}
```

Constantes : `TIER_NIGHT_SERIES_VERSION`, `TIER_NIGHT_SERIES_PHASES`, `TIER_NIGHT_SERIES_ROUND_COUNTS`, `TIER_NIGHT_SERIES_ALL_CATEGORIES` (`"*"`).

`setup` n’est **pas** une phase stockée (UI pre-launch).  
Les helpers **ne déduisent pas** la phase depuis `lobbyStarted`.

---

## 4. Contrat final des entrées de queue

```js
{
  roundId: `${runId}:${roundIndex}`,
  roundIndex: number,
  topicId: "roster:<id>",
  topicSnapshot: {
    id: string,
    name: string,
    emoji: string,
    categoryId: string
  }
}
```

Pas de customs V1. Snapshots sérialisables uniquement (pas de fonctions).

---

## 5. Stratégie finale de `roundId`

**Déterministe** : `roundId = \`${runId}:${roundIndex}\`` via `buildTierNightSeriesRoundId`.

Justification :

- même manche après retry / reconnexion → même id ;
- ids générés **à la création de la queue**, jamais au clic « suivante » ;
- `computeNextTierNightRoundState` lit l’entrée suivante déjà présente ;
- correlation ledger / historique / queue immédiate.

UUID aléatoire **non retenu** (aucune contrainte technique ne l’imposait).

---

## 6. Helpers ajoutés

Tous dans `js/core/tierNightSeries.js` — purs, sans DOM / Supabase / state global.

| Helper | Signature | Responsabilité | Entrées | Sortie | Erreurs | Tests |
|--------|-----------|----------------|---------|--------|---------|-------|
| `buildTierNightSeriesRoundId` | `(runId, roundIndex) → string` | Identité manche | run + index | id ou `""` | — | queue / progression |
| `isTierNightSeriesCatalogTopicEligible` | `(topic) → bool` | Filtre custom/disabled | topic | bool | — | exclus custom/disabled |
| `listEligibleTierNightSeriesTopics` | `({ topics, categoryIds, … }) → topic[]` | Pool éligible | opts | liste | — | filtre / all |
| `countEligibleTierNightSeriesTopics` | `(opts) → number` | Cardinalité pool | opts | n | — | all categories |
| `snapshotTierNightSeriesTopic` | `(topic) → snap\|null` | Snapshot méta | topic | objet plat | — | snapshot |
| `buildTierNightSeriesQueue` | `({ runId, topics, categoryIds, roundCount, rng })` | Tirage sans doublon | opts | `{ok,queue}` / erreur | `INSUFFICIENT_TOPICS`, `INVALID_*` | queue * |
| `createTierNightSeriesState` | `({ runId, categoryIds, roundCount, queue })` | État initial | opts | `{ok,series}` | validation | create + valid |
| `getActiveTierNightSeriesRound` | `(series)` | Manche active | series | `{ok,round}` | bounds | progression |
| `getTierNightSeriesProgress` | `(series)` | Vue progression | series | progress | — | progression |
| `isTierNightSeriesLastRound` | `(series) → bool` | Dernière manche ? | series | bool | — | last round |
| `normalizeTierNightSeries` | `(raw, {runId?})` | legacy / series / invalid | raw | `{kind,…}` | codes invalid | legacy |
| `validateTierNightSeries` | `(series, {runId?})` | Invariants métier | series | `{ok,series}` / code | nombreux | validation * |
| `doesTierNightSeriesEventMatch` | `({ currentRunId, currentSeries, incoming* })` | Garde stale | event | `{ok}` / code | RUN/ROUND/PHASE | gardes |
| `computeNextTierNightRoundState` | `({ runId, series, placements?, finished? })` | Next round pur | état | next + clear flags | PHASE/LAST/… | progression |
| `isTierNightSeriesRosterFrozen` | `(session) → bool` | Roster présent | session | bool | — | roster |
| `assertTierNightSeriesUsesFrozenRoster` | `(session)` | items+roster | session | `{ok}` | MISSING_* | roster |
| `didTierNightSeriesRosterChange` | `(prev, next) → bool` | Immutabilité | rosters | bool | — | roster |
| `listTierNightRosterCategories` | `() → cats` | Catalogue cats | — | copie | — | catalogue |

---

## 7. Invariants validés

- `version === 1`
- `roundCount ∈ {3,5,7}` et `=== queue.length`
- `roundIndex` continu 0..n-1 dans la queue
- unicité `roundId` et `topicId` (V1)
- `roundId` cohérent avec `runId` si fourni
- snapshots complets (id+name) alignés sur `topicId`
- phase ∈ canonique
- ledgers ⊆ roundIds de la queue
- aucun custom dans la queue
- pool insuffisant → erreur (pas de clamp / pas de complément autre catégorie)
- roster de série : snapshot requis (helpers) ; rebuild live interdit par contrat

---

## 8. Compatibilité mono-thème

- Absence de `series` → `normalizeTierNightSeries` = `{ kind: "legacy" }` (pas une erreur).
- Aucune conversion auto mono → série d’1 manche.
- Select / launch / end / scoring runtime **non branchés**.
- `resolveRosterTopicConfig` inchangé fonctionnellement (champs additifs ignorés).

---

## 9. Compatibilité customs

- Exclus du pool série (`custom` / préfixe `custom-roster-`).
- Validation refuse `CUSTOM_IN_SERIES_QUEUE`.
- Parcours mono-thème + sync FEATURE-02 non modifiés.
- Suites 01/02 : pass.

---

## 10. Compatibilité Rank Live

- `TIER_LISTS` / create live / live session **non touchés**.
- Suites `tierNightLive`, BUG-03/05, RankItRemoval : pass.

---

## 11. Analyse d’idempotence du scoring futur

### Ordre actuel (classic MP)

1. Hôte `advanceTierNightToResultsWhenReady` → `ensureTierNightRecapsFromRemote` / `buildRecapsFromPlacements`
2. **`applyTierNightRoundScores`** : garde `scoresApplied` **locale** → `addScore` / stats → `scoresApplied: true` dans `tierNightGame` local (`tierNightSession.js`)
3. `tierNightRecapToRemote` puis **`patchGameState(..., { withEveningScores: true })`**
4. Inner host : merge `eveningStateToRemote()` dans le payload, charge row, **shallow merge** `tierNight: { ...current, ...incoming }`, `updateGameSession` = `UPDATE … WHERE lobby_id = ?` **sans CAS** (`supabaseGame.js`)

### Preuves d’absence de transaction / CAS

- `updateGameSession` : pas de `eq("updated_at", expected)`, pas de version state.
- Deux writers lisant la même row peuvent chacun `addScore` sur une copie evening locale puis écraser `state` : last-write-wins.
- Le ledger JSON (`scoredRoundIds` futur) voyage dans le même blob `tierNight` shallow-mergé : un patch concurrent peut **perdre** un append de ledger ou republier un evening déjà crédité.
- Séparation evening / tierNight : evening est un autre sous-arbre du JSON ; l’award local précède le patch → timeout après `addScore` laisse un client « déjà scorant » vs serveur pas à jour.

### Conclusion explicite

**2. Ledger JSON insuffisant — une RPC transactionnelle (ou CAS serveur) est nécessaire** pour garantir exactly-once en présence de deux transitions concurrentes.

Le ledger `scoredRoundIds` reste un **état métier nécessaire** (UI, reprise, guards) mais **n’est pas** une preuve d’atomicité. Ticket suivant scoring/transition devra proposer une RPC du type « append score round if not in ledger » (ou équivalent) côté SQL.

---

## 12. Tests ajoutés

`tests/featureTierNightSeries01.test.js` — **28** tests, imports runtime réels des helpers (pas miroir texte seul).

Couverture : catalogue additif, queue 3/5/7, filtres, all categories, custom/disabled, insufficient, RNG, snapshots, validation complète, legacy, progression, stale guards, roster.

---

## 13. Résultats détaillés des tests ciblés

```
tests/featureTierNightSeries01.test.js
# tests 28
# pass 28
# fail 0
```

---

## 14. Résultat de la suite globale (ciblée TierNight)

Commande :

```
node --test tests/tierNightScoring.test.js tests/tierNightConsensus.test.js
  tests/tierNightBug03.test.js tests/tierNightBug04.test.js tests/tierNightBug05.test.js
  tests/tierNightRestartRecap.test.js tests/tierNightLive.test.js tests/tierNightRankItRemoval.test.js
  tests/featureTierNight01CustomRoster.test.js tests/featureTierNight02CustomRosterSync.test.js
  tests/uxTierNightNav01.test.js tests/uxTierNightEnd01.test.js
  tests/featureTierNightSeries01.test.js
```

```
# tests 202
# suites 50
# pass 202
# fail 0
```

Note : plusieurs suites historiques restent des **miroirs/statique** (contracts source) ; SERIES-01 exerce les **fonctions réelles**.

---

## 15. Régressions ou baselines observées

- Aucune régression.
- Baseline : `featureTierNight02` n’était pas dans `npm test` — **ajouté** (rattrapage tooling, pas un changement produit).

---

## 16. Dette ou limites restantes

- Pas encore branché dans `tierNightToRemote` / hydrate (ticket session/wiring).
- Enrichissement éditorial catalogue limité (3 cats, 10 thèmes).
- Ledger non transactionnel (cf. §11).
- Acting host / force results / interstitial / select 3-5-7 hors scope.
- `tierNightsPlayed += 1` / série : contrat possible via `completedRoundIds` + phase `series_end`, non implémenté.

---

## 17. Proposition précise du ticket suivant

**FEATURE-TIERNIGHT-SERIES-02 — Sérialisation / hydrate `series` + lancement pack (sans UX interstitial complète)**

Objectif :

1. Étendre `tierNightToRemote` / applyRemote pour transporter `series` (compat legacy si absent).
2. Préserver `series` sur full-replace / push (comme TN-02 customs).
3. Introduire `markTierNightSeriesStarted` (ou extension gated) **derrière** un flag / API non exposée UI **ou** brancher un CTA derrière feature flag — **recommandation** : wiring remote + helper launch testable, UI select pack = SERIES-03/04.
4. Spécifier le design RPC scoring exactly-once (suite §11) sans forcément l’implémenter si découpé en SERIES-05.

Dépendance : SERIES-01 ✅  
Hors scope suivant immédiat : `tiernight-between`, ledger SQL si ticket scoring séparé.

Alternative si on veut coller au découpage SERIES-00 : enchaîner **SERIES-02 contrat session remote** strictement (serialize/hydrate/preserve) avant tout launch.

---

## 18. Confirmation qu’aucun parcours série n’est encore accessible

**Confirmé.** Aucune route, bouton, ni appel depuis select/launch/end n’utilise les helpers série. Le comportement jouable reste mono-thème.

---

## 19. Confirmation qu’aucune migration SQL ni opération Git n’a été effectuée

**Confirmé.** Pas de fichier SQL ajouté/modifié. Pas d’opération Git.

---

*Fin FEATURE-TIERNIGHT-SERIES-01.*
