# FEATURE-TIERNIGHT-03 — Étape C1 — Rapport

**Statut** : Étape C consolidée et suites catch-up du périmètre vertes.  
Le prep série reste l’unique parcours roster sous gate ON.  
Gate production toujours OFF.  
Étape D non commencée.  
QA terrain non réalisée.

**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## 1. Catch-up

### `tests/arch07CatchupResidual.test.js`

| | |
|--|--|
| **Erreur exacte** | `SyntaxError: The requested module './gameSync.js' does not provide an export named 'applyRemoteSession'` au **chargement** (avant toute assertion) |
| **Cause** | Harness `mock.module(..., { exports: {…} })` — sous Node ESM mocks, `exports` ne fournit **pas** les named exports. Identique au défaut `mpLaunchLaunch` corrigé en B1-bis (`namedExports`). |
| **Relation avec C** | **Aucune sur le produit.** `applyRemoteSession` est toujours `export function` dans `gameSync.js`. C n’a ajouté que la priorité `tnSeries.phase` dans `resolveActivePlayScreen`. |
| **Preuve pré-C** | Le harness HEAD utilisait déjà `exports:` ; le produit exporte toujours le symbole. Failure = suite ne charge pas, pas assertion métier cassée par C. |
| **Correction** | `exports:` → `namedExports:` (8 mocks) |
| **Suite seule** | **pass** (inclus dans batch 30/30 avec mpRt) |

### `tests/mpRtCatchup.test.js`

| | |
|--|--|
| **Erreur exacte** | `SyntaxError: … '../config/lobbyLifecycle.js' does not provide an export named 'HOST_PRESENCE_STALE_MS'` au chargement |
| **Cause** | Même défaut harness (`exports:` sur `lobbyLifecycle` + chaîne d’imports `supabaseLobby`) |
| **Relation avec C** | **Aucune.** Constante toujours exportée dans `js/config/lobbyLifecycle.js`. Hors diff C. |
| **Correction** | `exports:` → `namedExports:` (23 mocks) |
| **Suite seule** | **pass** |

### `tests/filRougeVague3Cleanup.test.js`

| | |
|--|--|
| **Erreur** | `assert.ok(/suppression applicative/i.test(audit))` — docs/audit CSS |
| **Relation C** | **Aucune** (pas de `gameSync` / catch-up / TierNight prep) |
| **Traitement C1** | Baseline documentaire hors périmètre ; **non corrigée** (pas de chantier docs Fil Rouge ici). Démontrée non liée par absence de chevauchement source. |

### Invariants catch-up TierNight (couverts C1)

- Série active suivie même gate OFF  
- Legacy actif suivi même gate ON  
- Phase série prioritaire vs declared select  
- Pas de wizard comme SoT  
- Reset prep stale (epoch bas) ignoré  

---

## 2. Tests SERIES — migration (pas affaiblissement)

### SERIES-04 (`featureTierNightSeries04.test.js`) — modifications C

| Ancien invariant | Pourquoi plus applicable | Nouvel invariant | Couverture |
|------------------|--------------------------|------------------|------------|
| `data-roster-path="series"` + `seriesUi ? "roster-path"` | Wizard UI retiré ; prep unique | Roster gate ON → `enterTierNightSeriesPrep` ; absence wizard HTML | SERIES-04 gate + 03c / 03c1 |
| `markTierNightSeriesStarted` dans select + `launchSeriesFromReview` | Launch série déplacé dans prep | Classic (gate OFF) dans select ; series mark dans prepSession | SERIES-04 mono + 03c1 |
| Counts UI 7 | Produit 3/5/8 (étape A) | 5/8 indisponibles sur survie ; validate ×8 | SERIES-04 setup (conservé + renommé) |
| — | — | Customs augmentent pool | SERIES-04 (ajout, couverture ↑) |

**Moteur conservé intact** dans la même suite : `validateTierNightSeriesSetupForLaunch`, `prepareTierNightSeriesLaunchAttempt`, `buildTierNightSeriesLaunchPayload`, runId/roundIds, EMPTY_ROSTER, gate, absence finalize.

### SERIES-03b — **hors C** (diff working tree pré-existant / Option A customs)

| Ancien | Nouveau | Couverture |
|--------|---------|------------|
| Custom wire → `CUSTOM_IN_SERIES_QUEUE` | Custom + `snapshot.custom=true` → OK | SERIES-03b |
| Custom + `custom:false` → même code queue | → `CUSTOM_SNAPSHOT_INCONSISTENT` | SERIES-03b (plus strict sur cohérence) |
| SQL counts 3/5/7 only | Contrat 03-A : 3/5/7/8 + historique 03A documenté | SERIES-03b |

**Pas d’assouplissement finalize** : produit select/launch/live sans `commitTierNightSeriesRoundResult` (assert 03c1).

---

## 3. Reset prep remote au hub

| | |
|--|--|
| **Déclencheur** | `launchTierNightSelect` — game-select / « Recommencer » / registry restart `tiernight` |
| **Autorité** | Hôte uniquement (`requireHostToLaunch`) ; solo local sans sync |
| **Helper** | `buildAuthoritativeTierNightPrepReset` + `commitPrepSessionLaunch` |
| **Payload remote** | `{ tierNightPrep: { categoryIds, roundCount, ready: {}, setupEpoch }, tierNight, tierNightLive }` **dans la même mutation** que `screen: "tiernight-select"` |
| **setupEpoch** | **Incrémenté** `(previous + 1)` — plus de `0` fire-and-forget |
| **Stale** | `mergeTierNightPrepRemoteState` : epoch inc &lt; cur → **ignore** (prep récent préservé) |
| **Reprise vs nouveau** | `enterTierNightSeriesPrep({ resetSettings: false })` = follow/reprise ; `true` / hub = nouveau (bump) |
| **Invité** | Ne peut pas lancer le hub (`requireHostToLaunch`) ; ne publie pas de reset prep global |
| **Consumed / customs** | **Non touchés** par le reset hub |
| **Hors reset** | mount, hydrate, reload, foreground, follow invité, Realtime, reprise série/prep (`resetSettings: false`) |

---

## 4. Gate × état partagé

Helper : `resolveTierNightRosterDestinationFromSharedState` (+ priorité `tnSeries.phase` dans `gameSync`).

| # | Cas | Résolution |
|---|-----|------------|
| 1 | Gate OFF + série active | `tiernight` (gateIgnored) |
| 2 | Gate ON + legacy actif | `tiernight` |
| 3 | Gate ON + prep / création | `tiernight-prep` |
| 4 | Gate OFF + rien d’actif | `tiernight-select` |
| 5 | Gate ON + declared select fantôme | `tiernight-prep` |
| 6–7 | Flip gate pendant série/legacy | destination inchangée |
| 8 | Phase série vs declared select | série gagne |

Tests : `tests/featureTierNight03c1.test.js`.

---

## 5. Legacy

| | |
|--|--|
| Hydrate mono sans `series` | entry `tiernight` ; pas de queue |
| Replay gate ON | entry prep ; `markTierNightClassicStarted` → `SERIES_GATE_BLOCKS_CLASSIC` |
| Consumed préservé | hors reset prep |

---

## 6. Régressions

```bash
# Catch-up seules
node --experimental-test-module-mocks --test \
  tests/arch07CatchupResidual.test.js tests/mpRtCatchup.test.js
# → pass

# Batch C1 exigé (extrait)
node --experimental-test-module-mocks --test \
  tests/arch07CatchupResidual.test.js tests/mpRtCatchup.test.js \
  tests/featureTierNight03c1.test.js tests/featureTierNight03c.test.js \
  tests/featureTierNightSeries03b.test.js tests/featureTierNightSeries04.test.js \
  tests/featureTierNight03*.test.js \
  tests/sessionMerge.test.js tests/joinSessionHydrate.test.js \
  tests/guestMustFollow.test.js tests/postGameScreenFollow.test.js \
  tests/syncPrepOnMount.test.js tests/restartGameRollback.test.js \
  tests/tierNightRestartRecap.test.js tests/uxTierNightNav01.test.js \
  tests/mpLaunchLaunch.test.js
```

**Résultat batch** : **372 pass / 0 fail**

**Périmètre C + catch-up** (SERIES + bugs + live + 01/02 + mpLaunch + arch07/mpRt) : exécuté vert.

**`npm test` global** : catch-up verts ; seule baseline restante observée : `filRougeVague3Cleanup` (docs), hors périmètre C1.

---

## 7. Fichiers C1

- `tests/arch07CatchupResidual.test.js` — harness namedExports  
- `tests/mpRtCatchup.test.js` — harness namedExports  
- `js/core/tierNightSeriesPrepContracts.js` — reset autoritatif + résolution shared state  
- `js/core/tierNightSeriesPrepSession.js` — reset bump epoch  
- `js/core/restartGame.js` — hub reset epoch bump  
- `tests/featureTierNight03c1.test.js` — nouveau  
- `tests/featureTierNight03c.test.js` — assert hub aligné  
- `docs/FEATURE-TIERNIGHT-03-C1.md` — ce rapport  
- `package.json` — inclusion 03c1  

---

## 8. Hors scope (confirmé)

Pas D · pas gate ON prod · pas finalize/advance/intermanches · pas Rank Live · pas SQL · pas Git.
