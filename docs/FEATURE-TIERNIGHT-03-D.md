# FEATURE-TIERNIGHT-03 — Étape D — Rapport

**Statut** : Étape D implémentée et tests automatisés verts.  
Finalize, intermanches, thème suivant et fin de série branchés.  
Gate production toujours OFF.  
Étapes E et F restantes.  
QA terrain non réalisée.

**Date** : 2026-08-06  
**Git** : aucune opération Git

---

## 1. Machine d’état

| Phase | Rôle | Auteur transition | Écran |
|-------|------|-------------------|--------|
| `ranking` | Classement du thème actif | Joueurs (placements) ; hôte finalize | `tiernight` |
| `round_result` | Autorisé en shape ; **non exposé durablement** par RPC | — | UI = `tiernight-between` (alias) |
| `between_rounds` | Résultat figé ; attente CTA hôte | Finalize → between (si pas dernière) | `tiernight-between` |
| `series_end` | Fin de série ; scores + stats | Finalize dernière manche | `tiernight-end` |

**Transitions RPC (inchangées)** :

- `ranking` → `between_rounds` \| `series_end` via `finalize_tiernight_series_round`
- `between_rounds` → `ranking` via `advance_tiernight_series_round`
- Pas de `round_result` durable côté SQL (mapping UI documenté)

**Gardes** : runId, roundId=`${runId}:${roundIndex}`, phase, ledgers scored/completed, host∨AH, `doesTierNightSeriesEventMatch`, locks `createActionLock`.

---

## 2. Finalize

| | |
|--|--|
| **Déclencheur** | Auto : tous finished (roster) → `hostFinalize…` sans force. Force : CTA hôte explicite « Voir les résultats » (`force:true`) — SQL score `roster∩finished∩placement`. Voir D1. |
| **Verrou** | `finalizeLock` (anti double-clic / double listener) |
| **RPC** | `commitTierNightSeriesRoundResult` → `finalize_tiernight_series_round` |
| **Apply local** | D1 : `applyAuthoritativeSeriesRpcState(result.state)` immédiat puis soft refresh (Realtime non requis). |
| **Timeout** | Reconcile via ledgers `scoredRoundIds` ; succès si round déjà scoré |
| **Idempotence** | SQL `ALREADY_APPLIED` + garde client ledger avant phase |
| **Scoring** | Uniquement SQL ; `tierNightsPlayed` **une fois** à `series_end` (pas par manche) |

Legacy : `advanceTierNightToResultsWhenReady` **uniquement** si `!hasActiveTierNightSeries()`.

---

## 3. Intermanches

**Choix** : écran dédié `tiernight-between` (évite de surcharger `tiernight-end`).

| | |
|--|--|
| Données | `roundRecap`, consensus, scores manche, cumul, progression « Thème i sur n » |
| Hôte | `▶ Thème suivant` (+ changer de mode) |
| Invité | `En attente de l’hôte…` |
| Reprise | Phase `between_rounds` → resolve → between ; CTA restauré hôte |

---

## 4. Advance

| | |
|--|--|
| **Payload** | lobbyId, runId, currentRoundId, currentRoundIndex, expectedPhase=`between_rounds` |
| **Clear** | placements, finished, roundRecap, UI in-flight |
| **Preserve** | queue, history, scored/completed, roster, scores, consumed, runId |
| **Anti-double** | `advanceLock` + SQL `ALREADY_ADVANCED` |
| **Timeout** | Reconcile si `roundIndex` déjà N+1 + phase ranking |
| **Réconciliation** | refresh + navigate ranking |

---

## 5. Dernière manche

| Count | Index final | Après finalize |
|-------|-------------|----------------|
| 3 | 2 | `series_end` |
| 5 | 4 | `series_end` |
| 8 | 7 | `series_end` |
| 7 legacy | 6 | lecture OK ; advance refusé |

Aucun CTA next ; advance refuse (`TNS_NO_NEXT_ROUND` / last).

---

## 6. Screen resolution

| Phase | Écran |
|-------|--------|
| ranking | `tiernight` |
| between / round_result | `tiernight-between` |
| series_end | `tiernight-end` |

Priorité shared state sur declared. Gate locale ignorée si série active.  
`validateTierNightSeries` **préserve** désormais `roundHistory` / `roundRecap` (fix hydrate D).

---

## 7. SQL

Aucune nouvelle migration. Preuves :

- Finalize 03a : transitions + ledgers + `tierNightsPlayed` à last  
- Advance 05 : between → ranking  
- Counts 8 : validateur A1-bis  
- Apply staging manuel inchangé (runbooks existants)

---

## 8. Fichiers livrés

- `js/core/tierNightSeriesPlaySession.js` — orchestration  
- `js/screens/tierNightBetween.js` — intermanches  
- `js/games/tierNight.js` — branche finalize série  
- `js/core/tierNightSeries.js` — preserve history/recap  
- `js/core/gameSync.js` / `tierNightConfig.js` — résolution écrans  
- `js/screens/tierNightEnd.js` — fin de série  
- `js/main.js` — register between  
- `tests/featureTierNight03d.test.js`  
- Assertions SERIES-03/03a/03b/04/05 alignées sur branchement D  

---

## 9. Tests

```bash
node --experimental-test-module-mocks --test tests/featureTierNight03d.test.js
# 18/18 pass

node --experimental-test-module-mocks --test `
  tests/featureTierNight03*.test.js `
  tests/featureTierNightSeries*.test.js `
  tests/tierNightBug0{3,4,5}.test.js `
  tests/tierNightScoring.test.js `
  tests/arch07CatchupResidual.test.js `
  tests/mpRtCatchup.test.js `
  tests/uxTierNightNav01.test.js `
  tests/mpLaunchLaunch.test.js `
  tests/tierNightRestartRecap.test.js
# 410/410 pass · 0 fail
```

**Résultat** : suite D + périmètre A–C1 / SERIES / bugs / scoring / catch-up / nav / launch / restart **verts**.  
Assertion `canRouteToTierNightEnd` mise à jour (legacy recap **ou** `series_end` + history).

---

## 10. QA terrain préliminaire (à exécuter après E/F + gate)

| # | Scénario | Attendu |
|---|----------|---------|
| 1 | Série 3 · 2 joueurs | between ×2 → end |
| 2 | Série 5 + custom | one-shot ; thèmes queue |
| 3 | Série 8 | last → end sans next |
| 4 | Double-clic finalize/next | un seul score / un advance |
| 5 | Hôte background pendant finalize | reconcile OK |
| 6 | Invité reload between | attente + résultat |
| 7 | Hôte reload before next | CTA présent |
| 8 | Réseau coupé pendant next | reconcile ou retry sûr |
| 9 | Dernière manche | pas de next |
| 10 | Replay | hub → prep (gate ON) |
| 11 | Changer de mode | game-select |
| 12 | Stale ancien round | ignoré |

---

## 11. Hors scope (confirmé)

Pas d’activation gate · pas E/F · pas Rank Live · pas barème · pas Git · pas 20 thèmes.
