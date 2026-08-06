# FEATURE-TIERNIGHT-03 — Étape F (activation finale)

Activation contrôlée du parcours série comme produit définitif « Classe le groupe », retrait de la création classic, nettoyage wizard/grille, audit Quit, preuves Rank Live / consumed, préparation QA terrain.

**Aucune SQL. Aucune opération Git. QA terrain non exécutée. Ticket non clôturé.**

---

## 1. Stratégie finale de gate

**Option 2 hybride (kill switch explicite, jamais classic).**

| Élément | Valeur |
|--------|--------|
| Clé | `__REVEAL_TIERNIGHT_SERIES_UI__` (`TIER_NIGHT_SERIES_UI_GATE_KEY`) |
| Lecture | `isTierNightSeriesUiEnabled()` uniquement (`js/core/tierNightSeriesGate.js`) |
| Défaut | **ON** si clé absente / non-`false` |
| Kill switch | `=== false` uniquement |
| OFF | bloque *nouvelle* entrée série (alert / reste modes) — **jamais** `markTierNightClassicStarted` |
| Session série active | suivie par l’état partagé, indépendamment de la gate |
| Session classic legacy | lisible / terminable ; replay → prep série |
| Rank Live | inchangé |

Justification : Option 1 pure (suppression totale de la gate) aurait retiré le frein d’urgence d’entrée. Option 2 classique avec OFF → grille mono est **interdite**. Le hybride conserve un kill switch d’entrée sans réactiver le produit classic.

---

## 2. Branches classic de création supprimées

| Chemin | Statut F |
|--------|----------|
| UI select → `markTierNightClassicStarted` | **supprimé** (plus d’appel produit) |
| Handler `startGame` classic / carte thème grille | **supprimé** (`topicStepHtml` retiré) |
| Clic thème custom depuis ancienne grille select | **supprimé** (customs dans prep) |
| Wizard single/series (`roster-path`, `series-*`) | **HTML/handlers/listeners retirés** ; steps normalisés |
| Redirection grille mono sous gate OFF | **supprimée** → modes ou message sûr |
| Contournement prep via step `topic` | **normalisé** → `tiernight-prep` (`tierNightNav.js`) |

`markTierNightClassicStarted` conserve une **garde défensive** : retourne toujours `{ ok: false, code: "SERIES_GATE_BLOCKS_CLASSIC" }`.

---

## 3. Legacy conservé (lecture / hydrate / résultat)

| Élément | Rôle |
|---------|------|
| Destination `legacy_active` / board classic | Session mono déjà démarrée |
| Replay classic → prep (`shouldReplayTierNightSeriesToPrep`) | Pas de nouveau classic |
| Codecs / hydrate `tierNight` sans `series` | Lecture session stockée |
| Count **7** en lecture seule | Compat sessions anciennes |
| `round_result` → destination sûre (pas d’écran jouable) | Shape corrompue |
| Champs wizard strip (`path`, `seriesSetup`, …) | Ignorés, jamais SoT |
| Rank Live (`list` / create / live) | Isolé |
| Helpers `isCustomRosterTopicOwnedBy`, merge consumed | Customs / ledger |

---

## 4. Cartographie finale des routes

### Roster (produit)

```
game-select → tiernight-select (modes)
  → Classe le groupe → tiernight-prep
  → launch → tiernight (ranking)
  → tiernight-between ↔ tiernight …
  → tiernight-end
  → replay → tiernight-prep (sans queue)
  → change mode → tiernight-select
  → quit → game-select
```

### Rank Live

```
game-select → tiernight-select → Rank Live → list
  → create? → list → launch → live → result
  → replay / restart (inchangé)
```

### Normalisations legacy

| Ancien | Destination sûre |
|--------|------------------|
| step `topic` / `roster-path` / `series-*` | prep (ou modes si kill switch) |
| declared grille sans jeu | prep / select selon contrat |
| `round_result` / phase invalide | prep/select — **pas** board/between jouable |
| wizard draft | non restauré comme SoT ; pas de queue |

---

## 5. Audit final Quit

Chemin : CTA Quitter → `quitTierNightSeriesToGameSelect` → `exitGameToGameSelect` → hôte `returnToGameSelect` → `endGameSession` (`deleteGameSession` + timeout) → `resetLocalGamePrepState` / `resetGameSessionsOnly`.

| # | Preuve | Verdict |
|---|--------|---------|
| 1 | CTA `realHost` / `isLobbyHost` between+end | OK |
| 2 | Handler `!isLobbyHost() return` ; `canAuthorSeriesQuit` | OK |
| 3 | Delete distant avant reset local (hôte) | OK |
| 4 | Invités follow session null → game-select | OK (contrat sync) |
| 5 | Background : session absente → pas de reprise série | À valider QA terrain |
| 6 | Timeout delete → `fetchGameSessionByLobby` ; null = succès | OK (F) |
| 7 | Row encore présente → rethrow ; local non reset | OK |
| 8 | `withClickLock` / confirm | OK |
| 9 | `shouldContinue` + reset local même si mount stale | OK (F) |
| 10–11 | `resetGameSessionsOnly` ne touche pas consumed / customTierLists | OK |
| 12 | Lobby conservé (`setLobbyBetweenGames`, pas leave) | OK |
| 13 | `deleteGameSession` seul (pas dissolve lobby) | OK |
| 14 | Pas de `void` sur delete ; `await withPatchTimeout` | OK |

Pas de remplacement par patches best-effort. Pas de nouvelle SQL.

---

## 6. Matrice reset / preserve finale

| Action | série / queue / runId | prep ready | customs roster | consumed | customTierLists | tierNightLive | lobby |
|--------|----------------------|------------|----------------|----------|-----------------|---------------|-------|
| Launch série | **crée** | clear ready | preserve | + ids au launch OK | preserve | preserve | — |
| Replay | **clear** (pas de queue) | epoch++ / ready {} | preserve | preserve | preserve | **omit** | — |
| Change mode | **clear** | idem | preserve | preserve | preserve | **omit** | — |
| Quit | session **delete** | reset jeux | preserve | preserve | preserve | reset jeu | **keep** |
| Restart jeu | via replay/select | — | preserve | preserve | preserve | selon mode | — |
| Fin soirée / destroy lobby | — | — | **clear** | **clear** | selon reset evening | — | end |

---

## 7. Matrice compatibilité anciennes sessions

| État | Comportement F |
|------|----------------|
| Série active (toute gate) | Continue ; pas de rebuild queue / runId |
| Classic actif | Continue jusqu’au résultat ; pas de wrap série |
| Classic end → replay | Prep série ; pas de nouveau classic |
| Aucun jeu + ancien écran grille | Normalise select/prep ; **pas** de launch auto |
| Ancien wizard | Normalise sûre ; draft non-SoT |
| `round_result` | Pas d’écran jouable ; pas de next ; pas de mutation auto |
| Shape invalide | Destination sûre ; pas classic ; pas reshuffle |

---

## 8. Preuve Rank Live après nettoyage

- `tierNightSelect` : steps `mode` + `list` ; `markTierNightLiveLobbyStarted` ; create → list.
- Suppression `topicStepHtml` / wizard **sans** toucher `.tier-list-*` CSS.
- Exit série omet `tierNightLive` / `customTierLists` du payload.
- Suite `tests/tierNightLive.test.js` + assertions 03f §23–27 : **pass**.

---

## 9. Code wizard / grille supprimé

| Zone | Retiré |
|------|--------|
| `tierNightSelect.js` | `topicStepHtml`, grille thèmes, start classic, rendu wizard |
| Steps morts | `topic`, `roster-path`, `series-category`, `series-count`, `series-review` (normalisés seulement) |
| `style.css` | règles `.tier-roster-*` |
| Nav | topic/roster-path → prep (plus de grille) |
| Tests UI TN-01/02 | pointent prep customs (plus emoji grille select) |

Conservé : Rank Live list/create, modes, ensureHost modes.

---

## 10. État des codecs / champs

| Champ | Statut |
|-------|--------|
| `tierNight.series` (+ phase/queue/scores…) | **écrit + lu** (canon) |
| `tierNightPrep` (`categoryIds`, `roundCount`, `ready`, `setupEpoch`) | **écrit + lu** |
| `consumedCustomRosterTopicIds` | **écrit** au launch / **lu** ; merge hydrate monotone |
| `customRosterTopics` / `customTierLists` | **lus/écrits** soirée |
| `tierNightLive` | Rank Live only |
| Wizard `path`, `seriesSetup`, `wizard*` | **strip lecture** ; ne pas écrire |
| Count 7 | **lecture legacy** ; UI propose 3/5/8 |
| Recap classic / items sans series | **lecture** sessions actives |
| `round_result` | **rejeté** côté phase screen |

**Extinction legacy** : garder decode jusqu’à extinction des sessions mono en prod ; retirer clés wizard du wire uniquement après période sans payload legacy observé. Ne pas casser hydrate serveur.

---

## 11. Tests créés / modifiés

| Fichier | Rôle |
|---------|------|
| **`tests/featureTierNight03f.test.js`** | Suite F (parcours, classic block, quit, Rank Live, consumed, DOM wizard) |
| `featureTierNight03*.test.js` / Series / UX-NAV | Défaut gate ON ; plus de grille classic |
| `featureTierNight01/02CustomRoster*.test.js` | UI customs → prep |

Enregistré dans `package.json` (`npm test`).

---

## 12. Commandes exactes

```bash
# Suite F
node --experimental-test-module-mocks --test tests/featureTierNight03f.test.js

# FEATURE-TIERNIGHT-03 A→F
node --experimental-test-module-mocks --test tests/featureTierNight03a.test.js tests/featureTierNight03a1.test.js tests/featureTierNight03a1bis.test.js tests/featureTierNight03b.test.js tests/featureTierNight03b1.test.js tests/featureTierNight03b1bis.test.js tests/featureTierNight03c.test.js tests/featureTierNight03c1.test.js tests/featureTierNight03d.test.js tests/featureTierNight03d1.test.js tests/featureTierNight03d1bis.test.js tests/featureTierNight03e.test.js tests/featureTierNight03e1.test.js tests/featureTierNight03f.test.js

# 03 + Series + UX-NAV (agrégat)
node --experimental-test-module-mocks --test tests/featureTierNight03*.test.js tests/featureTierNightSeries*.test.js tests/uxTierNightNav01.test.js

# Régressions F ciblées (customs, bugs, scoring, Live, prep, mp, merge, catch-up, HT, Dilemma, router)
node --experimental-test-module-mocks --test tests/featureTierNight01CustomRoster.test.js tests/featureTierNight02CustomRosterSync.test.js tests/tierNightBug03.test.js tests/tierNightBug04.test.js tests/tierNightBug05.test.js tests/tierNightScoring.test.js tests/tierNightRestartRecap.test.js tests/tierNightLive.test.js tests/uxTierNightNav01.test.js tests/prepLaunch.test.js tests/prepReadyToggle.test.js tests/prepReadyRestart.test.js tests/mpLaunch.test.js tests/mpLaunchLaunch.test.js tests/restartGameRollback.test.js tests/sessionMerge.test.js tests/joinSessionHydrate.test.js tests/syncPrepOnMount.test.js tests/arch07CatchupResidual.test.js tests/mpRtCatchup.test.js tests/guestMustFollow.test.js tests/postGameScreenFollow.test.js tests/hotTakeVoteCommit.test.js tests/featureDilemma01MultiCustom.test.js tests/routerNestedRedirect.test.js

# Suite globale
npm test
```

---

## 13. Résultats chiffrés

| Périmètre | Tests | Pass | Fail |
|-----------|------:|-----:|-----:|
| `featureTierNight03f` | 16 | 16 | 0 |
| FEATURE-TIERNIGHT-03 **A→F** | 255 | 255 | 0 |
| 03* + Series* + UX-NAV | 442 | 442 | 0 |
| Régressions F ciblées (liste §12) | 372 | 372 | 0 |
| **`npm test`** | 2326 | 2325 | **1** |

---

## 14. Failures — analyse

### `filRougeVague3Cleanup` — docs actives / Fil Rouge

- **Erreur exacte** : `assert.ok(/suppression applicative/i.test(audit))` faux sur `docs/AUDIT_REGROUPEMENT_CAUSES_RACINES.md` (`tests/filRougeVague3Cleanup.test.js:116`).
- **Préexistence** : le fichier audit est un WIP local (hors diff métier F) ; il mentionne déjà l’échec docs Fil Rouge. F n’édite pas le wording Fil Rouge requis.
- **Chevauchement F** : **aucun** (TierNight série / classic / quit ; pas Fil Rouge).
- **Décision** : **ticket séparé** — ne pas « baseline » silencieuse ; corriger le doc audit ou le test hors F. **Ne bloque pas** l’activation série F côté code.

Aucune autre failure `npm test`.

---

## 15. Risques restants

1. QA terrain non faite (sync réel, background quit/finalize, réseau).
2. Kill switch OFF : utilisateurs bloqués à l’entrée série (comportement voulu) — communication support.
3. Sessions classic encore en vol en prod : OK jusqu’à end ; surveillance hydrate.
4. Failure docs Fil Rouge locale peut masquer un rouge CI si le même audit est commit sans phrase attendue.
5. Invité background pendant quit : prouvé en contrat unit ; **à valider terrain**.

---

## 16. Runbook QA terrain

**Prérequis globaux** : build staging avec D1-bis déjà déployé ; 2 appareils min (hôte + invité) ; idéalement 3ᵉ (invité ou acting host) ; même lobby ; réseau stable sauf scénarios dédiés ; **ne pas** forcer `round_result` en prod réelle.

Pour chaque scénario : capturer écrans + logs console hôte/invité + `game_sessions.state` (si accessible) en cas d’échec.

### 1. Série 3 officielle
- **Prérequis** : lobby 2+ ; pool catégories OK pour 3.
- **Appareils** : H + I.
- **Hôte** : Classe le groupe → Tout → 3 → ready → launch.
- **Invité** : ready → suit ranking.
- **UI** : prep → ranking thème 1 ; pas de count 7 ; pas de queue visible.
- **Sync** : même `runId` / thème.
- **Scores** : N/A manche 1 incomplete.
- **Capture** : mismatch thème / écran.

### 2. Série 5 multi-catégories
- Hôte coche Survie + Social (pas Tout) → 5 → launch.
- Attendu : 5 manches ; catégories respectées ; estimation durée cohérente.

### 3. Série 8
- Count 8 ; pool suffisant ; sinon options disabled + message pool.
- Attendu : 8 manches jusqu’à end.

### 4. Custom dans une série
- Hôte/invité ajoute custom inline prep ; launch série l’incluant.
- Attendu : custom apparaît dans une manche ; consommé après launch réussi.

### 5. One-shot custom
- Custom déjà dans consumed avant nouvelle série.
- Attendu : exclu du pool / UI.

### 6. Custom non consommé encore disponible
- Custom créé, série lancée **sans** l’inclure (ou après clear non consommé).
- Attendu : toujours éligible à la série suivante.

### 7. Ready invalidé après changement setup
- Invité ready → hôte change count/catégories.
- Attendu : ready reset ; CTA launch bloque tant que pas tous prêts (sauf force).

### 8. Launch avec tous prêts
- Tous ready → hôte launch une fois.
- Attendu : une queue + un `runId` ; pas de double partie.

### 9. Force-start
- Invité non ready → hôte force-start (si UI prévue).
- Attendu : launch OK ; sync invité vers ranking.

### 10. Finalize automatique
- Tous placent → finalize auto.
- Attendu : between (ou end si dernière) ; scores cohérents.

### 11. Force-finalize
- Hôte force-finalize manche incomplète.
- Attendu : avance contrôlée ; pas de double finalize.

### 12. Intermanche
- Between : scores / thème suivant visible ; pas de CTA next pour invité.

### 13. Double-clic next
- Hôte double-clic « thème suivant ».
- Attendu : une seule advance ; lock UI.

### 14. Reload invité between
- Invité reload en between.
- Attendu : revient between ; pas de nouvelle queue.

### 15. Reload hôte between
- Idem hôte ; état inchangé.

### 16. Background pendant finalize
- App en background pendant finalize auto.
- Attendu : catch-up vers between/end sans reshuffle.

### 17. Réseau coupé pendant next
- Couper réseau hôte au clic next ; rétablir.
- Attendu : reconcile ou message ; pas d’état fantôme divergé.

### 18. Dernière manche → end
- Dernier thème finalisé → `tiernight-end` ; **aucun** CTA next.

### 19. Aucun CTA next à end
- Vérifier UI end (replay / change mode / quit selon rôle).

### 20. Replay → prep sans queue
- Hôte replay.
- Attendu : prep ; `runId`/queue absents jusqu’au relaunch ; consumed préservé.

### 21. Nouveau runId au relaunch
- Relancer une série.
- Attendu : nouveau `runId` + nouvelle queue.

### 22. Change mode
- Depuis between/end → modes.
- Attendu : série clear ; live/customs/consumed/customTierLists préservés.

### 23. Passage vers Rank Live
- Depuis modes → Rank Live list → partie.
- Attendu : pas de contamination série.

### 24. Retour Rank Live → roster
- Fin/sortie Live → modes → Classe le groupe → prep.
- Attendu : prep propre ; consumed intact.

### 25. Quit
- Hôte quit (confirm).
- Attendu : `game_sessions` absente ; lobby intact ; game-select ; customs/consumed OK.

### 26. Invité background pendant quit
- Invité background ; hôte quit ; invité foreground.
- Attendu : game-select / pas de reprise série fantôme.

### 27. Reprise après fermeture/réouverture app
- Fermer app mid-série ; rouvrir.
- Attendu : reprise phase correcte ; pas de reshuffle.

### 28. Legacy classic (si fixture)
- Session classic active fixture.
- Attendu : continue → résultat → replay prep ; **pas** de nouveau classic.

### 29. Phase invalide (env contrôlé uniquement)
- Staging/fixture `round_result` ou shape invalide.
- Attendu : destination sûre ; pas de board interactif ; pas de CTA next ; pas de mutation auto.

### 30. Fin de soirée puis nouveau lobby
- Quitter/détruire lobby ; nouveau lobby.
- Attendu : **consumed clear** ; customs soirée précédente absents.

---

## 17. Confirmations explicites

| Assertion | Statut |
|-----------|--------|
| Parcours série = produit final « Classe le groupe » | **Oui** (défaut ON) |
| Aucune nouvelle création classic possible | **Oui** (UI + garde `markTierNightClassicStarted`) |
| D1-bis toujours dernier validateur SQL | **Oui** (aucune nouvelle SQL F) |
| Aucune nouvelle SQL (sauf nécessité démontrée) | **Aucune créée** |
| QA terrain réalisée | **Non** |
| Ticket FEATURE-TIERNIGHT-03 clôturable | **Non** — attendre QA terrain complète |
| Opération Git | **Aucune** |

---

## UX prep (spot-check F, pas redesign)

Visible côté `tierNightPrep.js` : intro série multi-thèmes ; counts **3 / 5 / 8** ; catégories Tout / Survie / Social / Chaos ; ready + force-start ; customs inline ; message pool ; pas de wording mono/série wizard ; pas de count 7 proposé.

---

*Fin rapport F — prêt pour exécution du runbook QA terrain.*
