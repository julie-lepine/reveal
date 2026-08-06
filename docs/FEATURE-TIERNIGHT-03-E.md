# FEATURE-TIERNIGHT-03 — Étape E

Navigation, sorties, reprises, legacy, isolation Rank Live.  
**Gate production toujours OFF.** Aucune opération Git. Étape F et QA terrain non commencées.

---

## 1. Cartographie routes (avant → après)

| Chemin | Avant E | Après E (gate ON) |
|--------|---------|-------------------|
| Hub `game-select` → TierNight | `tiernight-select` modes | inchangé |
| Modes → « Classe le groupe » | `tiernight-prep` | inchangé |
| Modes → Rank Live | `list` → live | inchangé |
| Wizard `roster-path` / `series-*` | redirect prep (gate ON) | inchangé (mort produit ; conservé gate OFF jusqu’à F) |
| Grille mono-thème | gate OFF only | inchangé (rollback) |
| Between → « Changer de mode » | `data-nav=game-select` → **exitGame** | **`tiernight-select` step=mode** + clear série |
| Between → Quitter | back / exit implicite | CTA hôte → `exitGameToGameSelect` |
| Between → Thème suivant | hôte / AH | inchangé |
| Between invité | CTA change mode visible | **attente only** (pas de CTA autoritaire) |
| End → Thème suivant | absent | absent (confirmé) |
| End → Rejouer | `launchTierNightSelect` (select) | **prep** si série_end / legacy roster sous gate |
| End → Changer de mode | exitGame via game-select | **select modes** + clear série |
| End → Quitter | — | CTA hôte → `exitGameToGameSelect` |
| `round_result` resume | pouvait → `tiernight` | **null** / prep (pas d’écran jouable) |

Parcours canonique gate ON :

`game-select` → `tiernight-select` → Classe le groupe → `tiernight-prep` → `tiernight` → `tiernight-between` → `tiernight-end`

---

## 2. Matrice CTA (écran × phase × autorité)

| Écran | Phase | Hôte / AH | Invité |
|-------|-------|-----------|--------|
| `tiernight-between` | `between_rounds` | ▶ Thème suivant ; ⇄ Changer de mode ; ✕ Quitter | Message d’attente ; follow état partagé |
| `tiernight-between` | autre | redirect phase | idem |
| `tiernight-end` | `series_end` | Rejouer ; ⇄ Changer de mode ; ✕ Quitter ; Résultats | Attente + Résultats ; follow |
| `tiernight-end` | classic recap | idem (hôte) | follow |
| Prep / ranking | — | inchangé (hors E moteur) | follow |

Pas de « Créer un thème » en intermanche.

---

## 3. Matrice reset / preserve

| Action | Série | Prep settings/ready | runId série | Queue | Customs roster | Consumed ledger | customTierLists |
|--------|-------|---------------------|-------------|-------|----------------|-----------------|------------------|
| Change mode | clear (`series: null`) | reset + epoch++ | null (remint au launch) | purge | **preserve** | **preserve** | **jamais touché** |
| Replay → prep | clear | reset + epoch++ | null | purge | preserve | preserve | jamais touché |
| Quit → game-select | via `exitGame` / `resetGameSessionsOnly` | reset sessions | — | — | preserve (soirée) | preserve | preserve |
| Launch série | create | — | **mint** | shuffle | — | merge one-shot | — |
| Rank Live path | n/a | n/a | live own | n/a | n/a | n/a | preserve |

---

## 4. Matrice reprise / reconnexion

| Cas | Destination | Gate ignorée ? |
|-----|-------------|----------------|
| Prep actif | `tiernight-prep` | non (création) |
| `ranking` | `tiernight` | oui |
| `between_rounds` | `tiernight-between` | oui |
| `series_end` | `tiernight-end` | oui |
| Legacy classic sans `series` | `tiernight` | oui |
| `round_result` / shape invalide | prep (gate ON) / select (OFF) — pas jouable | oui |
| Gate OFF + série active | phase → écran | oui |
| Gate ON + legacy actif | `tiernight` | oui |
| Declared screen stale | shared state gagne | oui |
| Reload between / end | mapping phase | oui |

Règle : **état partagé > gate locale > screen déclaré stale**. Pas de reshuffle à l’hydrate.

---

## 5. Preuve isolation Rank Live

- `returnToTierNightSelectStep({ step: "list" })` inchangé sous gate.
- `tierNightCreate` → list/live inchangé.
- `markTierNightLiveLobbyStarted` inchangé.
- `shouldReplayTierNightSeriesToPrep` → **false** si mode live → hub `launchTierNightSelect`.
- `tierNightSeriesExitNav` : aucune référence aux listes live / votes / runId live métier.
- Tests 18–19 + suite `tierNightLive.test.js` verts.

---

## 6. Helpers partagés touchés / risques

| Fichier | Risque |
|---------|--------|
| `tierNightSeriesExitNav.js` (**nouveau**) | Sorties série ; rollback snapshot |
| `restartGame.js` | Branche replay gate → prep |
| `gameSync.js` `resolveActivePlayScreen` | Phases invalides → null |
| `tierNightSeriesPrepContracts.js` | Destinations phase plus fines |
| `tierNightBetween.js` / `tierNightEnd.js` | CTA hôte / invité |
| `tierNightSeriesGate.js` | Doc E/F only |
| `exitGame.js` | Réutilisé (quit) — pas de sémantique nouvelle |

Risques Hot Take / Dilemma : **aucun helper partagé métier HT/Dilemma modifié** (seulement suites de non-régression exécutées).

---

## 7. Apply / push / rollback / reconcile (sorties)

### Change mode / Replay (`applySeriesClearAndPrepReset`)

1. **Lock** `exitNavLock` (+ `withClickLock` écran).
2. **Apply local** : clear `tierNightGame` (sans série, `runId: null`), reset prep epoch, live shell idle.
3. **Push remote** (hôte/AH) : `patchGameState({ tierNight: { series: null, … }, tierNightPrep, tierNightLive })` + `screen` cible.
4. **Rollback** : `snapshotStatePatch` → `saveStatePatch(previous)` si patch échoue.
5. **Stale** : `shouldContinue` après await → abort sans naviguer.
6. **Navigate** synchrone après succès (pas Realtime-only).
7. Invité : pas d’appel (CTA absents).

### Quit

- `quitTierNightSeriesToGameSelect` → `exitGameToGameSelect` (confirm + `returnToGameSelect` / reset local).
- Pas de dissolve lobby.

### Next theme (inchangé D1)

- Finalize/advance RPC + locks existants.

---

## 8. Code mort / conservé gate OFF

| Élément | Statut E | Suppression F |
|---------|----------|---------------|
| Steps wizard `LEGACY_SERIES_WIZARD_STEPS` | Isolés (redirect prep gate ON ; mode gate OFF) | Oui |
| `topicStepHtml` / grille mono | Conservé gate OFF | Oui à inversion gate |
| `markTierNightClassicStarted` | Bloqué gate ON ; actif gate OFF | New-session classic retiré à F |
| Helpers lecture legacy série / classic | Conservés | Lecture jusqu’à sortie volontaire |
| Fallback gate OFF | Conservé | Inversion + retrait à F |

Pas de refactor massif du framework prep.

---

## 9. Tests créés / modifiés

| Fichier | Action |
|---------|--------|
| `tests/featureTierNight03e.test.js` | **Créé** (scénarios 1–25) |
| `tests/featureTierNight03c.test.js` | Mapping `resolveActivePlayScreen` aligné E |
| `tests/featureTierNight03c1.test.js` | reason `series_ranking` |
| `package.json` | ajoute `featureTierNight03e.test.js` |

---

## 10. Commandes et résultats

```text
# FEATURE-TIERNIGHT-03 (A→E)
node --experimental-test-module-mocks --test tests/featureTierNight03*.test.js
→ # tests 232  # pass 232  # fail 0

# SERIES-01→05
node --experimental-test-module-mocks --test tests/featureTierNightSeries*.test.js
→ # tests 164  # pass 164  # fail 0

# Customs TN-01/02, bugs 03/04/05, scoring, restart/recap, UX-NAV, Rank Live,
# prepLaunch/prepReady, mpLaunch, restart rollback, session merge/hydrate/catch-up/follow,
# Hot Take + Dilemma (helpers partagés)
node --experimental-test-module-mocks --test ^
  tests/featureTierNight01CustomRoster.test.js tests/featureTierNight02CustomRosterSync.test.js ^
  tests/tierNightBug03.test.js tests/tierNightBug04.test.js tests/tierNightBug05.test.js ^
  tests/tierNightScoring.test.js tests/tierNightRestartRecap.test.js tests/uxTierNightNav01.test.js ^
  tests/tierNightLive.test.js tests/prepLaunch.test.js tests/prepReadyToggle.test.js ^
  tests/mpLaunch.test.js tests/mpLaunchLaunch.test.js tests/restartGameRollback.test.js ^
  tests/sessionMerge.test.js tests/joinSessionHydrate.test.js tests/mpRtCatchup.test.js ^
  tests/guestMustFollow.test.js tests/hotTakeVoteCommit.test.js tests/featureDilemma01MultiCustom.test.js
→ # tests 337  # pass 337  # fail 0
```

Suite E seule : `# tests 24  # pass 24  # fail 0`.

---

## 11. Risques restants avant F

- Gate toujours OFF : parcours série non exposé en prod.
- QA terrain (multi-devices, réseau, acting host) non réalisée.
- `launchTierNightSelect` minté encore un `runId` hub (shell Rank Live / classic OFF) — runId **série** uniquement au launch ; documenté.
- Invité : back pendant between peut encore ouvrir le confirm exit local (contrat play global) — pas de CTA autoritaire change/quit.
- Suppression définitive grille/wizard uniquement à F.

---

## 12. Confirmations explicites

- Gate production **toujours OFF** (`__REVEAL_TIERNIGHT_SERIES_UI__` défaut false).
- Étape **F non commencée**.
- **QA terrain non réalisée**.
- Ticket **FEATURE-TIERNIGHT-03 non clôturé**.
- **Aucune opération Git**.
