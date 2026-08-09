# FEATURE-TIERNIGHT-04F — Progression multi-listes Rank Live

**Statut** : `FEATURE-TIERNIGHT-04F implementation complete — QA terrain pending`  
**Date** : 2026-08-09  
**Git** : aucune opération Git  
**Base** : [04A](./FEATURE-TIERNIGHT-04A.md) · [04E](./FEATURE-TIERNIGHT-04E.md)

---

## Contrat

Après le launch 04E (`playing_list`, `roundIndex=0`, queue snapshotée) :

1. Fin du **dernier item** d’une liste → finalize liste (host-commit `patchGameState`)
2. Si listes restantes → `between_lists` + écran `tiernight-between`
3. CTA manuel **Thème suivant** → advance → `playing_list` + projection queue[next] (items du snapshot uniquement)
4. Dernière liste → `series_end` + clear **ALL** customs live + écran `tiernight-end`

Pas de re-architecture du launch 04E. Pas de RPC finalize/advance dédiée (04A).

---

## Phases

| Phase | Écran | Notes |
|-------|-------|--------|
| `playing_list` | `tiernight-live` | Item-par-item |
| `between_lists` | `tiernight-between` | Recap liste ; CTA hôte |
| `series_end` | `tiernight-end` | History + cumul ; clear customs |

---

## Modules

| Fichier | Rôle |
|---------|------|
| `js/core/tierNightLiveSeriesRuntime.js` | Phases, `getActive*`, `projectTierNightLiveSeriesRound` |
| `js/core/tierNightLiveSeriesPlaySession.js` | `hostFinalize*` / `hostAdvance*` + navigate/follow |
| `js/core/tierNightSession.js` | `applyScores: false` + `applyTierNightLiveSeriesListScores` |
| `js/games/tierNightLive.js` | `nextRound` → finalize série si `series.kind==="live"` |
| `js/core/gameSync.js` | `resolveActivePlayScreen` priorise phases live |
| `js/screens/tierNightBetween.js` | Variante Rank Live |
| `js/screens/tierNightEnd.js` | Fin live + CTAs sans emoji |

---

## Scoring

- Ledger `series.scoredRoundIds` (anti double-finalize)
- `tierConsensusPoints` chaque liste
- `tierNightsPlayed` **une seule fois** à `series_end`
- Ne pas bloquer via singleton `scoresApplied`

---

## Customs

À `series_end` : `rpcClearTierNightCustomLiveTierLists` + `clearCustomLiveTierListsLocal` (best effort ; échec clear ≠ rollback scoring).

---

## Tests

`tests/featureTierNight04f.test.js` — finalize/advance 3 listes, immutabilité queue, anti-double, clear customs, routing, `applyScores: false`.
