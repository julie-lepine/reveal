# FEATURE-TIERNIGHT-03 — Étape E1 (audit consolidation)

Audit sourcé du code livré en E + correctifs ciblés des défauts démontrés.  
**Pas d’étape F. Gate OFF. Aucune SQL. Aucune opération Git.**

---

## 1. Verdict critique sur E

**E était fonctionnellement correcte sur les CTA et destinations, mais incomplète sur l’atomicité Rank Live et le routage des shapes invalides.**

Défauts démontrés puis corrigés en E1 :

| # | Défaut | Sévérité | Correctif |
|---|--------|----------|-----------|
| D1 | Change mode / replay **écrivaient `tierNightLive`** (local + remote) | Haute (isolation Rank Live) | Omission totale du blob live |
| D2 | Clear remote **sans `items` / `playerRoster` null** | Moyenne (résidus) | `items: null`, `playerRoster: null` |
| D3 | `getEffectiveSessionScreen` **conservait declared** (`tiernight-between`) si phase `round_result` / invalide | Haute (board jouable fantôme) | Safe → prep/select via resolver |
| D4 | Quit CTA autorisé pour **acting host** alors que `exitGame` / `endGameSession` = **hôte réel** | Moyenne (UX mensongère) | Quit = `isLobbyHost` only |
| D5 | Timeout change/replay → rollback aveugle (succès serveur possible) | Moyenne | `refreshGameSession` avant rollback |

E **consolidée** après ces correctifs + suite `featureTierNight03e1` (assertions d’état).

---

## 2. Cartographie des 10 chemins (source)

### 1. between → Thème suivant
| | |
|--|--|
| Fichier UI | `js/screens/tierNightBetween.js` → `onNextTheme` |
| Publique | `hostAdvanceTierNightSeriesRound` (`tierNightSeriesPlaySession.js`) |
| Commit | `commitTierNightSeriesNextRound` (RPC advance) |
| Local | `applyAuthoritativeSeriesRpcState` puis soft refresh |
| Distant | RPC advance (1) — pas `patchGameState` |
| Screen | navigué `tiernight` (ranking) |
| Garde | `isLobbyHost \|\| canActAsHost` + `canHostSeriesCommit` |
| Anti-double | `advanceLock` + `withClickLock` + `advancing` |
| Rollback | pas d’apply optimiste client ; timeout → `reconcileSeriesFromServer` |
| Invité | pas de CTA ; handler return early |

### 2. between → Changer de mode
| | |
|--|--|
| UI | `onChangeMode` → `changeTierNightModeFromSeriesPlay` |
| Commit | `applySeriesClearAndPrepReset` → **1×** `patchGameState` |
| Local | `buildSeriesExitLocalStatePatch` (avant push) |
| Distant | `{ tierNight: clear+series:null, tierNightPrep: epoch++/ready:{} }` |
| Screen | `tiernight-select` |
| Garde | host \| AH |
| Anti-double | `exitNavLock` + `exitLock` écran |
| Rollback | `snapshotStatePatch` ; timeout → refresh puis rollback si non réconcilié |
| Invité | CTA absent + `canAuthorSeriesExit` refuse |

### 3. between → Quitter
| | |
|--|--|
| UI | `onQuit` → `quitTierNightSeriesToGameSelect` → `exitGameToGameSelect` |
| Commit | hôte : `returnToGameSelect` → `endGameSession` (`deleteGameSession`) |
| Local | après delete : `resetGameSessionsOnly` |
| Distant | suppression session (pas de patch partiel série) |
| Screen | `game-select` |
| Garde | **hôte réel only** |
| Anti-double | `withClickLock(exitLock)` ; confirm modal |
| Rollback | confirm avant mutation ; si delete échoue, local intact |
| Invité | CTA absent ; handler `!isLobbyHost` return |

### 4. end → Rejouer
| | |
|--|--|
| UI | `eveningRecapRestartButtonHtml` → `restartGame("tiernight")` |
| Branche | `shouldReplayTierNightSeriesToPrep` → `replayTierNightAfterSeriesEnd` |
| Commit | même `applySeriesClearAndPrepReset` (1× patch) |
| Screen | `tiernight-prep` (gate ON) |
| Queue/runId | **aucun** jusqu’au launch |
| Garde | restart bouton = host UI ; mutation = host\|AH |

### 5–6. end → change mode / quit
Identiques aux chemins 2–3 (`tierNightEnd.js`).

### 7. Replay classic legacy sous gate ON
`shouldReplay` true si recaps roster + pas de série active → même clear → prep. Pas de `markTierNightClassicStarted`.

### 8. Restart registry
`restartGame("tiernight")` : si shouldReplay → prep ; sinon `launchTierNightSelect` (hub modes). Rank Live mode → hub.

### 9. Sortie puis retour Classe le groupe
Select modes → `enterTierNightSeriesPrep({ resetSettings: true })` → prep propre (epoch bumpée, ready {}).

### 10. Sortie puis Rank Live
Change mode → select ; step list inchangé ; `tierNightLive` / `customTierLists` non touchés par exit série.

---

## 3. Payload exact

### Change mode / Replay (une mutation)

```js
patchGameState({
  tierNight: {
    runId: null,
    topicId: null,
    mode: "roster",
    modifier: "normal",
    lobbyStarted: false,
    listName: "",
    topicEmoji: "",
    placements: {},
    finished: {},
    game: null,
    recap: null,
    items: null,
    playerRoster: null,
    series: null,          // clear canonique
  },
  tierNightPrep: {
    categoryIds: ["*"],
    roundCount: 5,
    ready: {},
    setupEpoch: prevEpoch + 1,
  },
  // ABSENT: tierNightLive, consumedCustomRosterTopicIds, customRosterTopics
}, { gameId: "tiernight", screen: "tiernight-select" | "tiernight-prep" })
```

Local miroir : `tierNightGame` remplacé (sans série, `runId: null`), prep reset ; **pas** de `tierNightLiveGame`.

### Quit (hôte)

1. confirm  
2. `deleteGameSession(lobbyId)` (+ `setLobbyBetweenGames`)  
3. `resetGameSessionsOnly()` (sessions/prep ; **pas** customs/consumed/`customTierLists`)  
4. route `game-select`

Nombre d’appels : **1 delete session** (+ lobby between). Pas de patch série.

---

## 4. Nombre exact d’appels réseau

| Action | Appels |
|--------|--------|
| Next theme | 1 RPC advance (+ soft refresh optionnel) |
| Change mode | **1** `patchGameState` (timeout → +1 refresh reconcile) |
| Replay | **1** `patchGameState` (idem) |
| Quit hôte | **1** `deleteGameSession` (+ setLobbyBetweenGames) |
| Quit invité | 0 write session (leave local + suppress) |

Pas de multi-patch best-effort. Pas de `void patchGameState`.

---

## 5. Matrice reset / preserve

| Champ | Next | Replay | Change mode | Quit (hôte) | Restart hub | Retour hub select |
|-------|------|--------|-------------|-------------|-------------|-------------------|
| `tierNight.series` | evolve | **clear null** | **clear null** | session deleted | n/a | n/a |
| `tierNight.runId` | preserve | **null** | **null** | reset session | mint hub* | — |
| `lobbyStarted` | true | false | false | false | false | — |
| placements / finished | RPC | clear {} | clear {} | reset | clear | — |
| playerRoster / items | preserve round | **null** | **null** | reset | — | — |
| roundRecap / recap | RPC | null | null | reset | — | — |
| prep category/count | — | reset défaut | reset défaut | reset défaut | reset | — |
| prep ready | — | **{}** | **{}** | reset | {} | — |
| prep setupEpoch | — | **++** | **++** | reset 0 | ++ | — |
| `customRosterTopics` | preserve | **preserve** (absent) | **preserve** | **preserve** | preserve | preserve |
| `consumedCustomRosterTopicIds` | preserve | **preserve** | **preserve** | **preserve** | preserve | preserve |
| `tierNightLive` | — | **preserve** (absent) | **preserve** | reset session local | finished shell hub | — |
| `customTierLists` | — | **preserve** | **preserve** | **preserve** | preserve | preserve |

\* `launchTierNightSelect` minté un runId hub (shell) ; runId **série** uniquement au launch `prepareTierNightSeriesLaunchAttempt`.

Consumed : clé absente = preserve ; `[]` distant via hydrate = **union** (ne shrink pas).

---

## 6. Matrice autorité / CTA

| Action | Invité DOM | Invité handler | AH | Hôte |
|--------|------------|----------------|----|------|
| Next | non | early return | oui | oui |
| Change mode | non | early + NOT_HOST | oui | oui |
| Replay | non (bouton host) | restart host UI | mutation AH ok | oui |
| Quit | non | early return | **non** | oui |

---

## 7. Rollback / timeout / reconcile

1. Snapshot shallow des clés patchées **avant** apply local.  
2. Apply local → push unique.  
3. Échec réseau/timeout → `refreshGameSession` ; si série clearée + epoch ≥ attendu → **reconcile succès** (pas de rollback).  
4. Sinon rollback snapshot.  
5. STALE après succès serveur : **pas de rollback** (évite d’écraser un état plus récent).  
6. Invité ne publie pas.

---

## 8. Preuve Rank Live

- Payload exit **n’inclut pas** `tierNightLive` / `customTierLists`.  
- Après clear local, `tierNightLiveGame.runId` / votes / listes **inchangés** (test E1 #16–17).  
- `returnTo list/live`, create, `markTierNightLiveLobbyStarted` non modifiés.  
- `shouldReplay` false en mode live → hub select, pas prep forcé.

---

## 9. Shapes invalides (comportement concret)

| Couche | Comportement |
|--------|----------------|
| `resolveTierNightSeriesScreenFromPhase` | `null` |
| `resolveActivePlayScreen` | `null` (plus de catch-all) |
| `getEffectiveSessionScreen` | **E1** : safe `tiernight-prep` (gate ON) / select (OFF) — **ne renvoie plus** declared between/tiernight |
| Mount between | `round_result` → navigate prep ; phase ≠ between → leave |
| CTA advance | `canAdvance` false hors `between_rounds` |
| Hydrate | pas de reshuffle / pas de nouvelle série |

---

## 10. Tests ajoutés / modifiés

| Fichier | |
|---------|--|
| `tests/featureTierNight03e1.test.js` | **Créé** (20 scénarios état + source) |
| `tests/featureTierNight03e.test.js` | CTA hostOrAh / realHost |
| `package.json` | enregistre `03e1` |

---

## 11. Commandes et résultats

```text
node --experimental-test-module-mocks --test tests/featureTierNight03*.test.js
→ # tests 254  # pass 254  # fail 0

node --experimental-test-module-mocks --test ^
  tests/featureTierNightSeries*.test.js ^
  tests/featureTierNight01CustomRoster.test.js tests/featureTierNight02CustomRosterSync.test.js ^
  tests/tierNightBug03.test.js tests/tierNightBug04.test.js tests/tierNightBug05.test.js ^
  tests/tierNightScoring.test.js tests/tierNightRestartRecap.test.js tests/tierNightLive.test.js ^
  tests/uxTierNightNav01.test.js tests/prepLaunch.test.js tests/prepReadyToggle.test.js ^
  tests/mpLaunch.test.js tests/mpLaunchLaunch.test.js tests/restartGameRollback.test.js ^
  tests/sessionMerge.test.js tests/joinSessionHydrate.test.js tests/syncPrepOnMount.test.js ^
  tests/mpRtCatchup.test.js tests/guestMustFollow.test.js tests/postGameScreenFollow.test.js ^
  tests/hotTakeVoteCommit.test.js tests/featureDilemma01MultiCustom.test.js
→ # tests 506  # pass 506  # fail 0

# E1 seul
node --experimental-test-module-mocks --test tests/featureTierNight03e1.test.js
→ # tests 22  # pass 22  # fail 0
```

---

## 12. Risques restants avant F

- Gate OFF : parcours série non exposé prod.  
- QA terrain multi-devices / flaky réseau non faite.  
- Quit s’appuie sur `deleteGameSession` générique (OK pour clear série) — pas de patch TierNight dédié.  
- `void exitGameToGameSelect` dans délégation globale `data-exit-game` (préexistant, hors CTA série).  
- Hub `launchTierNightSelect` minté encore un runId shell (non série).

---

## 13. Confirmations

- **Aucune SQL nouvelle** ; finalize / advance / validateur D1-bis **non modifiés**  
- Gate **toujours OFF**  
- Étape **F non commencée**  
- **QA terrain non réalisée**  
- Ticket **non clôturé**  
- **Aucune opération Git**
