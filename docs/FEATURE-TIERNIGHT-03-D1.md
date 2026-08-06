# FEATURE-TIERNIGHT-03 — Étape D1 — Rapport

**Statut** : Étape D consolidée côté code et tests (voir **D1-bis** pour `round_result` + runbook final).  
Finalize / advance / intermanches / `series_end` robustes.  
Gate production toujours OFF.  
**Smokes PostgreSQL D : encore requis** — runbook final = `feature-tiernight-03-d1bis-smoke-runbook.sql`.  
Étapes E et F restantes.  
QA terrain non réalisée.

**Date** : 2026-08-06  
**Git** : aucune opération Git

---

## 1. SQL

### Fonctions finales

| Fonction | Signature | Sécurité | ACL |
|----------|-----------|----------|-----|
| `tiernight_series_validate_series_shape` | `(jsonb, text) → jsonb` | IMMUTABLE | REVOKE all (interne) — **définition = A1-bis** |
| Helpers `tiernight_series_*` | placement, roster, finished, compute_scores, … | selon 03A | REVOKE all |
| `finalize_tiernight_series_round` | `(uuid, text, text, int, text, bool) → jsonb` | SECURITY DEFINER · `search_path=pg_catalog,public` | EXECUTE authenticated ; pas anon |
| `advance_tiernight_series_round` | `(uuid, text, text, int, text) → jsonb` | idem | idem |

### Ordre canonique

1. finalize 03 → 03A hardening (+ finished-flag fix / golden helpers)  
2. advance 05  
3. A1 (optionnel si déjà couvert)  
4. **A1-bis toujours dernier** pour le shape  

**Fragile** : rejouer 03A après A1-bis REPLACE le validateur (counts/customs plus anciens).  
**Mitigation** : runbook D1 + ré-appliquer A1-bis si rejeu accidentel.  
**Aucune nouvelle migration additive** : les fichiers existants définissent correctement les fonctions finales si l’ordre est respecté.

### Apply staging

**Non exécuté dans cette session.**  
Runbook : `supabase/feature-tiernight-03-d1-smoke-runbook.sql`  
Scripts : `scripts/tiernight-series-03a-smoke.mjs`, `scripts/tiernight-series-05-smoke.mjs`

---

## 2. Finalize

| Point | Contrat |
|-------|---------|
| **Complétude auto** | Client : `allTierNightMembersFinished()` (roster figé) avant RPC. SQL : chaque uid roster finished + placement exhaustif valide. |
| **Force** | CTA hôte explicite « Voir les résultats » (`force:true`). SQL : `roster ∩ finished=true ∩ placement valide`. 0 finished → `TNS_FORCE_NO_FINISHED`. Déterministe (pas de divergence client). |
| **Apply local** | 1) RPC `result.state` → `applyAuthoritativeSeriesRpcState` 2) soft `refreshGameSession` 3) navigate. Realtime confirme, n’est pas le déclencheur. Échec refresh ≠ rollback. |
| **Idempotence** | Ledger `scoredRoundIds` client + SQL `ALREADY_APPLIED`. |
| **Timeout** | Reconcile ledger ; succès si round scoré. |
| **Erreurs** | `mapTierNightSeriesRpcErrorToUx` — messages produit, pas SQL brut. |

Vocabulaire corrigé : « force hôte » ≠ force-start prep ; c’est un **force-finalize** explicite.

---

## 3. Advance

| Point | Contrat |
|-------|---------|
| **Apply local** | `result.state` immédiat (`expectRoundIndex=N+1`, `phase=ranking`) + soft refresh + navigate `tiernight`. |
| **Preserve** | queue, history, ledgers, roster, scores, consumed, runId |
| **Clear** | placements, finished, roundRecap, UI in-flight |
| **Idempotence** | `ALREADY_ADVANCED` (preuve complète SQL) |
| **Timeout** | reconcile `roundIndex===N+1` + phase ranking |

---

## 4. Phases `round_result` vs `between_rounds`

> **D1-bis Option A** : `round_result` retirée. Voir `docs/FEATURE-TIERNIGHT-03-D1BIS.md`.

Machine canonique : `ranking` | `between_rounds` | `series_end`.

---

## 5. Locks

| | |
|--|--|
| **Portée** | module playSession (survit remount écran) |
| **Identité** | `action\|runId\|roundId\|phase` via `buildTierNightSeriesTransitionId` |
| **Libération** | `finally` du `createActionLock` (succès / erreur) |
| **Stale** | si `transitionId` change pendant await → `TNS_STALE_CALLBACK` ; apply RPC gardé par runId / ledger / index |

---

## 6. Scoring / statistiques

| | |
|--|--|
| **Scores** | SQL only ; client copie `state.scores` / `gameScores` / `playerStats` |
| **`tierNightsPlayed`** | +1 à `series_end` (dernière manche) dans SQL ; ledger empêche double via `ALREADY_APPLIED` |
| **Legacy classic** | `recordTierNightPlayed` / `advanceTierNightToResultsWhenReady` — chemin séparé si `!hasActiveTierNightSeries()` |

---

## 7. History / recap

| Champ | Rôle |
|-------|------|
| `roundHistory` | ledger cumulatif autoritatif |
| `roundRecap` | projection dernière manche (UI between) |
| validate | **préserve** history + recap |
| advance SQL | `roundRecap → null` ; history intact |
| reconnect between | lit `roundRecap` |
| reconnect end | lit `roundHistory` (+ bridge legacy `recap` dernière manche) |

---

## 8. Erreurs RPC → UX (extrait)

| Code | Terminal | Retry | UX |
|------|----------|-------|-----|
| `ALREADY_APPLIED` / `ALREADY_ADVANCED` | oui | non | déjà fait |
| `TNS_PLACEMENTS_INCOMPLETE` | non | oui | joueurs pas prêts |
| `TNS_FORCE_NO_FINISHED` | non | oui | impossible forcer |
| `TNS_STALE_*` | oui | non | manche/série inactive |
| `TNS_INVALID_PHASE` | oui | non | étape changée |
| `TNS_SERIES_ENDED` / `TNS_NO_NEXT_ROUND` | oui | non | fin |
| `TNS_TIMEOUT` | non | oui + reconcile | délai |
| `TNS_UNAUTHORIZED` | oui | non | hôte seul |

---

## 9. Tests SERIES « alignés » (pas d’affaiblissement)

| Ancien | Raison | Nouveau | Couverture de remplacement |
|--------|--------|---------|----------------------------|
| « RPC non branchée » SERIES-03/03A/05 | D a branché | « branché via playSession / between / board » | idempotence SQL + wrappers + croisement classic inchangés |
| `canRouteToTierNightEnd` = recap only | series_end sans bridge fragile | recap **ou** `series_end` + history | `tierNightRestartRecap` + 03d |
| assert advance acceptait `round_result` (D) | incompatible SQL | advance **refuse** `round_result` | 03d1 |

Invariants conservés : ALREADY_APPLIED / ALREADY_ADVANCED, ledgers, last round, customs/count8 (A1-bis), legacy 7 lecture, classic ↛ Series, Series ↛ classic.

---

## 10. Tests

```bash
node --experimental-test-module-mocks --test tests/featureTierNight03d1.test.js
# 24/24 pass

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
# 434/434 pass · 0 fail
```

---

## 11. Fichiers

- `js/core/tierNightSeriesPlaySession.js` — apply RPC local, force/all-finished, transitionId, UX map, phase advance  
- `js/screens/tierNightBetween.js` — CTA only between_rounds ; messages UX  
- `js/core/tierNightSeriesFinalize.js` / `Advance.js` — commentaires branchement  
- `supabase/feature-tiernight-03-d1-smoke-runbook.sql`  
- `tests/featureTierNight03d1.test.js`  
- `package.json` — entrée test D1  
- `docs/FEATURE-TIERNIGHT-03-D.md` — vocabulaire force / apply  

---

## 12. QA terrain

Toujours **non exécutée**. Smokes SQL staging **requis** avant QA multi (cases §G du runbook D1).
