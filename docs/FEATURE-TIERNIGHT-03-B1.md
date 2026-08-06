# FEATURE-TIERNIGHT-03 — Étape B1 — Rapport

**Statut** : Étape B consolidée et régressions automatisées vertes. Gate série toujours OFF. Étapes C à F restantes. QA terrain non réalisée.  
**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## 1. Diagnostic

### Écarts confirmés (corrigés)

| Écart | Cause | Fix |
|-------|--------|-----|
| One-shot en 2 mutations | Launch puis patch consumed best-effort | Consumed + reset prep dans **la même** mutation `launchGameWithSync` ; réconciliation hydrate depuis queue |
| Ledger consumed non-monotone | Hydrate/patch **remplaçait** le tableau | `union` / `mergeConsumedCustomRosterTopicIdsForHydrate` (remote stale `[]` ne shrink pas) |
| Merge ready prep cassé | Appel `mergeRemoteReadyUid(readyMap, readyMap)` (attendu session) | `mergeTierNightPrepRemoteState` + `setupEpoch` |
| Readiness non invalidée | Settings change sans clear ready | Clear ready + bump `setupEpoch` (politique plus stricte que Hot Take) |
| `lobbyStarted` local absent | Payload local sans flag | `localGame.lobbyStarted: true` immédiat |
| Reset prep trop large | `enterTierNightSeriesPrep` resettait toujours | `resetSettings` opt-in ; consumed jamais touché par reset prep |
| Stale ready après reset | Ready-only sans epoch | Ready patch porte `setupEpoch` ; epoch stale ignoré |

### Risques infirmés / clarifiés

- Mount `tiernight-prep` ne reset **pas** le prep.
- `resetGameSessionsOnly` conserve `consumedCustomRosterTopicIds`.
- Roster métier = UID via `buildTierNightPlayerRoster` ; `rosterNames` = filtre projection force-start.
- Gate reste OFF.

---

## 2. Reset — matrice

| Événement | Settings/ready prep | Customs | Consumed ledger |
|-----------|---------------------|---------|-----------------|
| Entrée série depuis select (`enter…({ resetSettings: true })`) | **Reset** | preserve | **preserve** |
| Reprise / follow (`resetSettings: false`) | **preserve** (hydrate) | preserve | preserve |
| Mount écran prep | preserve | preserve | preserve |
| Reload / Realtime / foreground | hydrate (epoch + union) | merge roster | **union** + reconcile série |
| `launchTierNightSelect` (game-select) | Reset prep | preserve | **preserve** |
| Launch série OK | Reset prep (même mutation) | preserve | **union** IDs queue |
| Launch KO / rollback | restore previous | — | **restore** previous |
| `resetGameSessionsOnly` | Reset prep | preserve | **preserve** |
| `resetEveningState` / teardown soirée | Reset | clear | **clear** |
| Back leaveGameSetup | leave session (comportement prep Hot Take) | preserve | preserve |
| Changement mode Rank Live | n/a (hors prep série) | — | preserve |

**Règle** : nouveau prep = reset settings/ready uniquement. Ledger = lobby lifetime. Clear ledger = frontière soirée/lobby uniquement.

---

## 3. `roundCount: null`

| Question | Réponse |
|----------|---------|
| Canonique ? | Oui — local **et** remote (`null` JSON) |
| Qui écrit ? | Hôte seul (`setCategories` / reconcile) |
| Publié quand ? | Sync settings hôte |
| Merge | Epoch↑ → prend `null` ; epoch stale → ignore |
| Clé absente | Preserve (merge partiel) |
| `null` | Clear explicite du count |
| Pool vérité | Catalogue filtré + customs hydratés − `excludeCustomIds` (= consumed) |
| Launch | `validateTierNightSeriesSetupForLaunch` autoritatif ; refuse null / pool insuffisant |

---

## 4. Readiness

**Politique TierNight (BUG-TIERNIGHT-PREP-READY-CUSTOM-01)** :

| Événement | Invalide les prêts ? |
|---|---:|
| Catégories / nombre de manches | **Oui** (`setupEpoch++`, `ready:{}`) |
| Mode / nouveau prep / replay | **Oui** |
| Ajout ou suppression d’un thème custom | **Non** — catalogue seulement |
| Reconnexion / hydrate identique | **Non** |

**Hot Take** : thème/count **ne** clear **pas** ready (audité). TierNight clear uniquement sur **réglages structurants**.

**Mécanisme** :

- Hôte change catégories/count : `ready: {}` + `setupEpoch++` synchronisé.
- Custom add/remove : sync catalogue (`customRosterTopics`) ; **pas** de bump `setupEpoch`.
- Ready patch inclut `expectedSetupEpoch` courant.
- Merge : epoch↑ remplace ready ; epoch↓ ignore ; même epoch merge UID.
- Signal legacy `poolInvalidateRequest` : hôte **ack** uniquement (pas de clear ready).

---

## 5. One-shot

### Séquence (crash-safe)

1. Validate setup.
2. Prepare attempt (queue en mémoire).
3. `mergedConsumed = merge(previous, series)`.
4. `markTierNightSeriesStarted({ attempt, consumedCustomRosterTopicIds, resetPrepSession })` :
   - apply **local** immédiat (`lobbyStarted`, series, consumed, prep reset) ;
   - **même** push remote : `tierNight` + `consumedCustomRosterTopicIds` + `tierNightPrep`.
5. Échec → rollback local complet (y compris consumed).

### Réconciliation

À chaque hydrate série : `reconcileConsumedCustomRosterTopicIds(local, series)`  
→ launch OK + crash avant second patch **réparé** dès que la queue est visible.

### Merge ledger

- Union monotone dédupliquée.
- Remote `[]` / absent → **ne clear pas**.
- Clear autorisé : `resetEveningState` uniquement.

---

## 6. Roster

- Identité canonique : **`userId`** (`buildTierNightPlayerRoster`).
- `rosterNames` : filtre force-start / prêts (projection display) ; hôte toujours inclus.
- Rename après freeze : `displayName` snapshoté ; votes par UID (BUG-04 intact).
- Freeze : une fois au `prepare` / launch ; pas de rebuild par manche.

---

## 7. Launch local

1. Validate + prepare.
2. `saveStatePatch` local (series, `lobbyStarted: true`, consumed, prep reset).
3. Push remote (même blob).
4. Realtime = confirm/merge, pas seule source de transition.
5. Anti-double-clic : `executePrepLaunch` lock (existant).

---

## 8. Navigation

`tierNightNav` retire `tiernight-prep` de la pile quand on reconstruit un retour vers `tiernight-select` **depuis les écrans create** — évite un fantôme prep derrière create-roster.  
Le prep lui-même n’est pas « perdu » : état dans `tierNightSeriesPrep` + remote.  
Back depuis prep = leave setup (comme Hot Take), pas une réouverture grille legacy. Gate OFF → pas de parcours série terrain.

---

## 9. Sync settings

| Champ | Auteur | Sérialisation | Merge |
|-------|--------|---------------|-------|
| `categoryIds` / `roundCount` | Hôte | `tierNightPrep` | epoch |
| `ready` | Tous (UID) | map uid | epoch + merge UID |
| `setupEpoch` | Hôte | number | max gagne |
| Queue / roster / `customRosterTopics` | **jamais** via patch prep | — | — |

Invité settings → `HOST_ONLY` refusé.

---

## 10. UX stabilité

Écran : `captureDraft` / `restoreDraft` ; `refreshFromSync` patche chips/ready sans dépendre d’un remount total pour les updates sync. Tests source + harness draft.

---

## 11. Fichiers

- `js/core/tierNightSeriesPrepContracts.js` **(nouveau)**
- `js/core/tierNightSeriesPrepSession.js`
- `js/core/tierNightLiveSession.js`
- `js/core/gameSync.js`
- `js/core/state.js` / `restartGame.js`
- `tests/featureTierNight03b1.test.js` **(nouveau)**
- `tests/featureTierNight03b.test.js` (assertion ready)
- `docs/FEATURE-TIERNIGHT-03-B1.md`

---

## 12. Tests — commandes et résultats

### Suite B1

```text
node --experimental-test-module-mocks --test tests/featureTierNight03b1.test.js
```

**Pass** (inclus dans la passe globale ci-dessous).

### Régression §2 (commande exécutée)

```text
node --experimental-test-module-mocks --test ^
  tests/featureTierNight03.test.js ^
  tests/featureTierNight03a1.test.js ^
  tests/featureTierNight03a1bis.test.js ^
  tests/featureTierNight03b.test.js ^
  tests/featureTierNight03b1.test.js ^
  tests/featureTierNightSeries01.test.js ^
  tests/featureTierNightSeries02.test.js ^
  tests/featureTierNightSeries03.test.js ^
  tests/featureTierNightSeries03a.test.js ^
  tests/featureTierNightSeries03b.test.js ^
  tests/featureTierNightSeries04.test.js ^
  tests/featureTierNightSeries05.test.js ^
  tests/featureTierNightSeries05bSmoke.test.js ^
  tests/featureTierNight01CustomRoster.test.js ^
  tests/featureTierNight02CustomRosterSync.test.js ^
  tests/tierNightBug03.test.js tests/tierNightBug04.test.js tests/tierNightBug05.test.js ^
  tests/prepLaunch.test.js tests/prepReadyToggle.test.js tests/mpLaunch.test.js ^
  tests/uxTierNightNav01.test.js tests/tierNightRankItRemoval.test.js ^
  tests/hotTakeVoteCommit.test.js tests/featureDilemma01MultiCustom.test.js ^
  tests/restartGameRollback.test.js tests/syncPrepOnMount.test.js ^
  tests/joinSessionHydrate.test.js tests/sessionMerge.test.js ^
  tests/tierNightLive.test.js tests/tierNightRestartRecap.test.js ^
  tests/guestMustFollow.test.js tests/prepReadyRestart.test.js
```

**Résultat : 571 pass / 0 fail**

Complément :

```text
tests/featureDilemma01QaFixes.test.js
tests/featureDilemma01DeckRegression.test.js
tests/arch04PrepResumeBanner.test.js
tests/resumeBannerDismiss.test.js
tests/postGameScreenFollow.test.js
```

**Résultat : 67 pass / 0 fail**

### Failure baseline (hors B1)

```text
node --experimental-test-module-mocks --test tests/mpLaunchLaunch.test.js
```

**Fail 1** — `SyntaxError: The requested module './gameSync.js' does not provide an export named 'DEFAULT_SYNC_PATCH_TIMEOUT_MS'`  
Cause : mock du test (`exports:` vs named) ; l’export existe bien dans `gameSync.js`. **Non introduit par B1** ; non corrigé ici (hors scope prep série).

---

## 13. Statut maximal

**Étape B consolidée et régressions automatisées vertes.  
Gate série toujours OFF.  
Étapes C à F restantes.  
QA terrain non réalisée.**
