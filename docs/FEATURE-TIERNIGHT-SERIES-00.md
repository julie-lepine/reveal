# FEATURE-TIERNIGHT-SERIES-00 — Audit architectural et contrat

**Statut** : audit uniquement · **aucune** modification produit, SQL, ni Git dans ce ticket.  
**Périmètre** : mode TierNight « Classe le groupe » (roster / classic). Rank Live cité uniquement pour contraste d’identifiants.  
**Date** : 2026-08-04.

---

## 1. Verdict exécutif

Le modèle actuel est **une partie = un thème = un `runId` de jeu = une carte `placements`/`finished` = un `recap` = une attribution `scoresApplied` = navigation terminale `tiernight-end`**.

Les thèmes custom (FEATURE-TIERNIGHT-01/02) enrichissent le catalogue mais **ne changent pas** ce modèle fragmenté. FEATURE-TIERNIGHT-02 a déjà noté hors scope : *« Séries de tierlists / catégories »*.

**Verdict architecture** : pour la V1 série (catégorie(s) + 3/5/7 manches, queue figée, interstitial hôte, fin uniquement après la dernière) :

| Choix | Recommandation |
|-------|----------------|
| Identifiants | **Option A** : un `runId` **global de série** + un `roundId` (et `roundIndex`) **par manche** |
| Scoring | Remplacer `scoresApplied` booléen par un **ledger** `scoredRoundIds[]` (ou map) |
| Navigation | Nouvel écran / phase **inter-manches** ; `tiernight-end` **uniquement** en fin de série |
| Helpers génériques | **Ne pas** généraliser Trivia/SpeedVote/Clutch ; spécialiser TierNight |
| Catalogue | Évolution additive de `TIER_NIGHT_ROSTER_TOPICS` (catégorie + flags) sans casser les `id` |

Le `runId` actuel **représente déjà une instance de partie / lancement de jeu**, pas une manche interne. Le créer à chaque manche (Option B) casserait les gardes stale/`tierNightRecapBelongsToRun` / hydratation prep. Le conserver pour toute la série et versionner les manches est aligné avec Live (`runId` + `roundIdx`) et SpeedVote.

**Effort** : chantier produit réel (session + sync + UX + scoring), pas un simple enrichissement de contenu. Découpage en tickets §17.

---

## 2. Cartographie du flux actuel

### 2.1 Séquence textuelle (MP — Classe le groupe)

```
game-select
  → launchTierNightSelect (restartGame.js)
      runId#prep, topicId=null, lobbyStarted=false, recap=null
      screen: tiernight-select · chat annonce prep
  → mountTierNightSelect (tierNightSelect.js)
      step mode → step topic
      [option] tiernight-create-roster → custom → retour topic (NAV-01)
  → startGame(topicId, "roster")  [hôte only]
      setTierNightMode/Modifier/topicId
      markTierNightClassicStarted (tierNightLiveSession.js)
          runId#play (NOUVEAU, remplace prep)
          snapshot playerRoster + items (displayNames)
          placements={}, finished={}
          lobbyStarted=true, game=true
          launchGameWithSync push → game_sessions screen=tiernight
      navigateAfterGameLaunch → tiernight
  → guests: prepGuestFollowOnSession / forceFollow → tiernight
  → mountTierNight (tierNight.js)
      resolveTierNightClassicList (items figés BUG-04)
      placements locaux ; validate → finishGame
          hôte: syncTierNightSession patch placements/finished
          invité: rpcContributeGameSessionPlayer ×2 (placement, finished)
      all finished → advanceTierNightToResultsWhenReady (hôte réel)
          ensureTierNightRecapsFromRemote → buildRecapsFromPlacements
          applyTierNightRoundScores (hôte, scoresApplied)
          patch lobbyStarted=false + recap + screen=tiernight-end + withEveningScores
          navigate tiernight-end
  → mountTierNightEnd
      bootstrapRecaps / refreshEveningScoresFromSession (invités)
      « Voir les résultats » → completeGameSession → results
      « Recommencer » → launchTierNightSelect (retour select, nouveau runId)
```

### 2.2 Chemin solo

Select → `navigate("tiernight")` **sans** `markTierNightClassicStarted`.  
Items via `buildRosterList` (joueurs actifs live).  
Finish → `buildRecapsWithSimulation` + `applyTierNightRoundScores` + `navigate("tiernight-end")`.

### 2.3 Table par étape

| Étape | Fonction | Fichier | Local | Partagé | Qui écrit | RPC / patch | Gardes | Nav |
|-------|----------|---------|-------|---------|-----------|-------------|--------|-----|
| Entrée hub | `launchTierNightSelect` | `restartGame.js` | `tierNightGame.runId`, clear topic | `state.tierNight` reset | Hôte MP | `commitPrepSessionLaunch` | `requireHostToLaunch`, chat roulette | `tiernight-select` |
| Select | `mountTierNightSelect` / `startGame` | `tierNightSelect.js` | mode, topicId | customs via RPC | Hôte lance | customs upsert/delete | `ensureHost` | create-roster / play |
| Launch classic | `markTierNightClassicStarted` | `tierNightLiveSession.js` | runId, items, roster | `tierNight` full | Hôte | `launchGameWithSync` push | host-only | `tiernight` |
| Roster | `buildTierNightPlayerRoster`, `resolveTierNightClassicList` | `tierNightRoster.js`, `tierLists.js` | items figés | items, playerRoster | Hôte au launch | — | BUG-04 freeze | — |
| Classement | `mountTierNight` / `finishGame` | `tierNight.js` | `placed` UI | placements[uid], finished[uid] | Hôte patch / invité contribute | `contribute_game_session_player` | progress roster | wait UI |
| Fin auto/force | `advanceTierNightToResultsWhenReady` | `gameSync.js` | recaps, scoresApplied | recap, lobbyStarted=false | **Hôte réel only** | `patchGameState` + evening | all/force finished | `tiernight-end` |
| End UI | `mountTierNightEnd` | `tierNightEnd.js` | affichage | lecture | — | refresh evening | runId recap | results / restart |
| Complete | `completeGameSession` | `gameSync.js` | — | game_id menu | Hôte ou acting host actor | upsert / RPC actor | — | `results` |
| Restart | `launchTierNightSelect` | `restartGame.js` | wipe | wipe + new runId | Hôte | prep launch | — | `tiernight-select` |

### 2.4 Payload remote classic (`tierNightToRemote`)

Champs : `runId`, `topicId`, `mode`, `modifier`, `lobbyStarted`, `game`, `items`, `playerRoster`, `listName`, `topicEmoji`, `placements`, `finished`, `recap` (null dans toRemote ; posé ensuite).

Recap (`tierNightRecapToRemote`) : `runId`, `topicId`, `listName`, `topicEmoji`, `recaps[]` (par **joueur**), `consensus`, `controversial*`, `scoresApplied`.

### 2.5 Reprise / late join / acting host

| Cas | Comportement actuel | Preuve |
|-----|---------------------|--------|
| Refresh mid-play | `resolveActivePlayScreen` si `lobbyStarted` → `tiernight` ; hydrate items/roster | `gameSync.js` applyRemoteSession |
| Refresh mid-end | `shouldPreferTierNightEndRoute` + `tierNightRecapBelongsToRun` | `tierNightConfig.js` |
| Late join | forceFollow vers screen déclaré ; board via snapshot | `shouldForceGuestFollowSession` |
| Acting host classic | **Ne peut pas** `advanceTierNightToResultsWhenReady` (`isLobbyHost` hard) ; **peut** `completeGameSession` via actor RPC | `gameSync.js`, `tierNightEnd.js` |
| Bandeau reprise | prep/play labels ; pas de label dédié `tiernight-end` | `gameResume.js` |

---

## 3. Sémantique des identifiants

| ID | Créé | Change | Conservé | Supprimé / wipe | Vérifié par | Représente aujourd’hui | Scoring | Merge |
|----|-------|--------|----------|-----------------|-------------|------------------------|---------|-------|
| **`runId`** | `createTierNightRunId` ; select/restart ; **re-mint** au classic start | Select→play (2 ids) ; live start | Pendant play/end du même lancement | Prep reset, live wipe classic | `tierNightRecapBelongsToRun`, `isStaleTierNightEndPatch`, hydrate | **Instance de partie / lancement**, pas une manche interne | Non (gate seulement) | Oui — mismatch → refuse recap / wipe |
| **`topicId`** | Select / start (`roster:<id>`) | Nouveau thème = nouveau start | Pendant run | Restart, `setTierNightTopicId` wipe game | Mount exige non-null | **Thème unique de la partie** | Indirect (meta recap) | Config patch |
| **`attemptId`** | Live only (mémoire) | Par vote optimiste | Non persisté | — | Rollback live | Tentative vote live | Non | Non classic |
| **`finished` map** | `{}` au launch | UID→true à validate | Jusqu’à advance | Reset au launch | `allTierNightMembersFinished` | Prêt **de la seule manche** | Non | Contribute |
| **`placements` map** | `{}` au launch | UID→tiers | Jusqu’à advance | Reset au launch | buildRecaps | Classement unique | Input scoring | Contribute |
| **`playerRoster`** | Launch | Non (figé) | Run | Restart | Progress UIDs | Snapshot identité | Via noms | Freeze BUG-04 |
| **Item board** | displayName | — | Run | — | — | Label (pas UID) | Consensus | — |
| **`scoresApplied`** | false | true après award | Recap | Restart wipe | `applyTierNightRoundScores` | **Une fois par partie** | Oui | Evening blob |
| **`recap`** | Advance hôte | — | End | Restart `recap:null` | BelongsToRun | Résultat unique | Porte scoresApplied | Hydrate |
| Live **`roundIdx`** | Live start 0 | Par item | Run live | — | Reveal lock `${runId}:${roundIdx}` | Manche **item** live | — | Vote wipe |

**Pas d’`attemptId` classic.** Pas de `seriesId` / `roundId` classic.

### Implication série

- `runId` = bon candidat pour **toute la série** (gardes stale/end déjà calés dessus).
- Il **ne doit pas** être réinterprété comme « une manche » sans audit des consommateurs.
- Il faut un **deuxième axe** (`roundId` / `roundIndex`) pour votes, scoring, interstitial.

---

## 4. Hypothèses « une manche = une partie »

| Zone | Fichier / fonction | Pourquoi bloquant | Risque | Ticket |
|------|--------------------|-------------------|--------|--------|
| `topicId` singulier | `state.tierNightTopicId`, `tierNight.topicId` | Pas de queue | **Bloquant** | Session |
| `setTierNightTopicId` wipe | `state.js` | Changer de thème = reset game | **Élevé** | Session |
| `placements` / `finished` uniques | `tierNightToRemote`, play | Contaminent manche N+1 si non reset contrôlé | **Bloquant** | Progression |
| `recap` unique | `advanceTierNight…`, end | End = résultat global | **Bloquant** | Progression + UX |
| `navigate("tiernight-end")` | `tierNight.js`, `advanceTierNight…` | Terminal après 1 thème | **Bloquant** | UX / progression |
| `scoresApplied` bool | `tierNightSession.js` | Une attribution / partie ; multi-manches → sous-score ou double | **Bloquant** | Scoring |
| `lobbyStarted false` = fin | advance + route helpers | Ambigu pour interstitial | **Élevé** | Session |
| Select 1 thème → start | `tierNightSelect.startGame` | Pas de pack 3/5/7 | **Bloquant** | Catalogue + UX |
| Restart = select | `launchTierNightSelect` | Seul enchaînement actuel | Moyen (conservé pour *nouvelle* série) | UX fin |
| Copy end « manche » | `tierNightEnd.js` | Pas de « X/Y » | Faible | UX |
| Custom sync | FEATURE-02 | Hors scope packs V1 | Faible | — |
| Tests mono-thème | `featureTierNight01*`, end, restart | Aucun contrat série | Moyen | Tests |

---

## 5. Audit du scoring

### Quand

1. **Solo** : `finishGame` → `buildRecapsWithSimulation` → `applyTierNightRoundScores`.
2. **MP** : hôte `advanceTierNightToResultsWhenReady` → `ensureTierNightRecapsFromRemote` → `buildRecapsFromPlacements` → `applyTierNightRoundScores` **si** `isLobbyHost()`.
3. Publication evening : `patchGameState(..., { withEveningScores: true })`.
4. Invités : **pas** de `addScore` local ; `refreshEveningScoresFromSession` sur end.

Barème : proximité consensus + outsider (`tierNightSession.js`, `tierNightScoring.js`, `EVENING_POINTS.BONUS`). Stats : `tierConsensusPoints`, `tierNightsPlayed` (+1 par award).

### Protections actuelles

| Menace | Protection | Limite pour série |
|--------|------------|-------------------|
| Double award même partie | `scoresApplied` | Insuffisant multi-manches |
| Guest double | Host-only apply | OK à conserver |
| Recap stale | `tierNightRecapBelongsToRun` | OK si `runId` série stable |
| End patch stale | `isStaleTierNightEndPatch` | À étendre phase/round |
| Remount end | Prefer remote recap + scoresApplied | Mid-série : ne pas rejouer award |
| Acting host mid-wait | Ne peut pas advance | **Angle mort** série (cf. §13) |
| Rebuild placements après award | scoresApplied local | Si wipe local + rebuild : risque double evening — ledger roundId |

### Contrat scoring cible (non implémenté)

- Award **au plus une fois par `roundId`** (ledger `scoredRoundIds`).
- Cumul evening = somme des manches ; `tierNightsPlayed` : décider +1/manche ou +1/série (produit).
- Transition manche N→N+1 : **ne pas** ré-appliquer N ; **ne pas** appliquer N+1 avant result de N+1.
- Reconnexion : lire ledger distant / evening blob ; skip apply si `roundId ∈ scoredRoundIds`.
- `withEveningScores` : soit patch à chaque fin de manche (recommandé pour reprise), soit buffer — **recommandation** : publier à chaque manche pour aligner invités.

---

## 6. Helpers partagés et risques inter-jeux

| Helper | Consommateurs | Risque si modifié globalement | Recommandation |
|--------|---------------|-------------------------------|----------------|
| `launchGameWithSync` / `mpLaunch` | Tous jeux MP | Élevé | Réutiliser tel quel pour **lancement série** ; next-round = `patchGameState` TN |
| `commitPrepSessionLaunch` | Restarts / prep | Moyen | Restart **nouvelle série** seulement |
| `patchGameState` | Tous | Élevé | OK ; payload TN étendu |
| `pushGameSession` / preserve roster | TN-02 + autres | Élevé | Préserver aussi `series` si full replace |
| `completeGameSession` | Fin jeux | Moyen | Appeler **après dernière manche** seulement |
| `restartGame` registry | Tous | Faible | Handler TN : reset série |
| `sessionMerge` / SpeedVote helpers | Live + SV | Élevé | **Ne pas** fusionner série classic dans SV |
| `gameResume` / route | Tous | Moyen | Ajouter screens série ; labels |
| Acting host | Trivia, SV, Live… | Élevé | Spécialiser classic : aujourd’hui hôte réel only |
| Chat annonce | Prep launch | Faible | Annoncer série (copy) optionnel V1 |
| Cache invalidate ARCH-10 | Leave | Faible | Inchangé |
| `suppressSessionRoute` | Guests end | Faible | Interstitial ≠ results |

**Éviter** toute « unification multi-manches » générique avec Trivia/SpeedVote/Clutch dans ce chantier.

---

## 7. Catalogue actuel et contrat catégorisé proposé

### Actuel

`data/tierTopics.js` → `TIER_NIGHT_ROSTER_TOPICS` : **10** entrées `{ id, emoji, name }` (liste plate).

Consommateurs : `tierNightSelect.js` (render), `rosterTopic.js` (`resolveRosterTopicConfig`), tests 01/02, `tierLists.js`.

IDs stables (ex. `apocalypse`) ; wire id = `roster:${id}`. Pas d’index comme identité. Customs : préfixe `custom-roster-` (hors packs V1).

`TIER_LISTS` = catalogue **Rank Live** (autre surface) — ne pas confondre.

### Format cible (illustratif)

```js
export const TIER_NIGHT_ROSTER_CATEGORIES = [
  { id: "survival", label: "Survie", order: 10 },
  { id: "social", label: "Social", order: 20 },
  { id: "chaos", label: "Chaos", order: 30 },
];

export const TIER_NIGHT_ROSTER_TOPICS = [
  {
    id: "apocalypse",           // stable — ne pas renommer
    emoji: "🧟",
    name: "Qui survit à l'apocalypse ?",
    categoryId: "survival",
    order: 10,
    enabled: true,
  },
  {
    id: "soiree",
    emoji: "🎉",
    name: "Qui organise la meilleure soirée ?",
    categoryId: "social",
    order: 10,
    enabled: true,
  },
  // …
];
```

Helpers purs (ticket catalogue) :

- `listTopicsByCategoryIds(categoryIds, { enabledOnly })`
- `pickSeriesQueue({ categoryIds, count, rng })` → sans doublon ; si pool `< count` → erreur produit ou clamp (décision §18)
- Compat : entrées sans `categoryId` → catégorie `"legacy"` / `"misc"`

**Ne pas** mass-enrichir le contenu dans SERIES-00.

---

## 8. Architectures comparées

### Option A — `runId` série + `roundId` / `roundIndex` par manche

| Critère | Évaluation |
|---------|------------|
| Compat code actuel | **Bonne** : gardes runId (end, stale, hydrate) restent valides pour toute la série |
| Volume changements | Moyen-élevé mais localisé TN |
| Stale events | Fort si chaque patch porte `runId` + `roundId` + `phase` |
| Scoring | Ledger `scoredRoundIds` clair |
| Reprise | Un run ; cursor `roundIndex` + phase |
| Restart | Nouveau `runId` = nouvelle série (comme aujourd’hui) |
| Helpers génériques | Peu touchés |
| Régression | Maîtrisée si Live inchangé |
| Dette | Faible — parallèle Live `roundIdx` |
| Test | Naturel (run fixe, rounds variables) |

### Option B — `seriesId` + nouveau `runId` à chaque manche

| Critère | Évaluation |
|---------|------------|
| Compat | **Mauvaise** : `tierNightRecapBelongsToRun`, hydrate « run change = wipe », `isStaleTierNightEndPatch` traitent run change comme **autre partie** |
| Volume | Très élevé (réécrire sémantique runId partout) |
| Stale | runId aide par manche mais seriesId à propager partout |
| Scoring | Possible mais double couche d’ids |
| Reprise | Fragile (confondre restart et next round) |
| Restart | Ambigu |
| Helpers | Risque de casser resume générique TN |
| Dette | Haute |
| Test | Plus de matrices d’équivalence |

---

## 9. Architecture recommandée

**Option A.**

Preuves code :

1. `createTierNightRunId` + mint au **start play** → `runId` = instance de jeu (`tierNightLiveSession.markTierNightClassicStarted`).
2. `tierNightRecapBelongsToRun` / `isStaleTierNightEndPatch` → sécurité autour d’**un** run de partie.
3. Live : multi-« tours » sous **le même** `runId` avec `roundIdx` (`tierNightLiveReveal` lock key).
4. Hydrate : changement de `runId` ≈ reset prep / autre lancement (`gameSync` branche classic) — **inadapté** au passage manche→manche.

Donc : **ne pas** créer un nouveau `runId` par manche. Introduire `roundId` (+ index) sous le `runId` de série.

---

## 10. Contrat de données cible

Champs proposés (noms indicatifs) dans `state.tierNight` / `tierNightGame` :

```text
runId: string                 # instance de série (mint au lancement pack)
series:
  version: 1
  categoryIds: string[]       # snapshot choix hôte (« all » = sentinel ou liste)
  roundCount: 3|5|7
  queue: string[]             # topicIds roster:… figés au launch
  roundIndex: number          # 0..n-1
  phase: setup|ranking|round_result|between_rounds|series_end
roundId: string               # id stable manche courante (uuid)
topicId: string               # = queue[roundIndex] pendant ranking
listName, topicEmoji, items, playerRoster  # comme aujourd’hui, par manche
placements: { [uid]: tiers }  # manche courante uniquement
finished: { [uid]: true }
roundRecap: object|null       # résultat manche courante (avant hist)
roundHistory: [{ roundId, topicId, listName, recapMeta... }]  # minimal
scoredRoundIds: string[]      # ledger
hostAdvanceNonce: number      # anti double-clic transition (optionnel)
lobbyStarted: boolean         # true tant que série non terminée (y compris between)
# recap (legacy fin) : uniquement en series_end — ou alias du dernier round + agrégat
```

**Règles**

- Queue calculée **une fois** côté hôte au launch ; invités = snapshot distant.
- Reset entre manches : clear `placements`, `finished`, `roundRecap` ; **nouveau** `roundId` ; `roundIndex++` ; `topicId` = queue[i] ; **conserver** `runId`, `queue`, `scoredRoundIds`, `playerRoster` (ou re-freeze politique produit).
- Restart série : nouveau `runId`, wipe series (comme `launchTierNightSelect`).
- Compat anciennes sessions mono-thème : absence de `series` → comportement actuel (1 thème, end direct).

**SQL** : pas indispensable a priori (JSON `game_sessions.state`) — confirmer après ticket session ; pas de migration dans SERIES-00.

---

## 11. Machine à états cible

Phases actuelles (implicites) : **select/prep** (`lobbyStarted=false`, pas de recap) → **ranking** (`lobbyStarted=true`) → **end** (`lobbyStarted=false` + recap) → **results** (menu).

### Cible

| Phase | Signification |
|-------|---------------|
| `setup` | Select pack (catégories + 3/5/7) — avant launch |
| `ranking` | Plateau manche `roundIndex` |
| `round_result` | Calcul/publish résultat manche (hôte) |
| `between_rounds` | Interstitial sync ; attente CTA hôte |
| `series_end` | Fin globale (= `tiernight-end` enrichi) |

### Transitions (résumé)

| From → To | Événement | Acteur | Préconditions | Write | Anti-stale | Échec |
|-----------|-----------|--------|---------------|-------|------------|-------|
| setup → ranking | Launch série | Hôte | queue ok, count ok | push session + series | — | alert, stay setup |
| ranking → round_result | All finished / force | Hôte réel (V1) | roundId match | recap manche + score ledger + evening | runId+roundId | retry / reconcile |
| round_result → between_rounds | Auto si `roundIndex < n-1` | Hôte (même write ou suivant) | score ok | phase between, screen interstitial | — | |
| round_result → series_end | Auto si dernière | Hôte | — | phase end, screen tiernight-end | — | |
| between_rounds → ranking | CTA « Manche suivante » | Hôte / acting* | phase between, index | reset maps, roundId++, topic | nonce / phase | timeout → refresh |
| series_end → results | Voir résultats | Hôte/actor | — | completeGameSession | — | |
| series_end → setup | Recommencer | Hôte | — | new runId | — | |

\*Acting host : **lacune actuelle** sur advance classic — à traiter en ticket hardening (§13, §17).

**Atomique recommandé** : `ranking → round_result` (score + phase) ; `between_rounds → ranking` (reset + topic + roundId) en **un** patch chacune.

---

## 12. Contrat de synchronisation multijoueur

### Lancement série

- Hôte seul : catégories + count → `pickSeriesQueue` local → publish `series.queue` + `runId` + `roundId` + `roundIndex:0` + `phase:ranking` + roster snapshot.
- Invités : **aucun** tirage ; suivre Realtime / refresh.
- Mode push launch existant OK (`markTierNightClassicStarted` généralisé en `markTierNightSeriesStarted`).

### Manche suivante

- Seul hôte (V1 : `isLobbyHost`) commit `between_rounds → ranking`.
- Préconditions : `phase===between_rounds`, `runId`, `roundIndex`, `hostAdvanceNonce`.
- Clear placements/finished ; nouveau roundId ; topic suivant.
- Double-clic : bouton disabled + nonce / phase guard.
- Timeout : `refreshGameSession` ; si serveur déjà advanced → hydrate ; sinon retry CTA.

### Stale

- Tout event avec `runId` ≠ courant → ignore.
- Event `roundId` / `roundIndex` &lt; courant → ignore (ne pas restaurer ancienne manche).
- Event phase ranking alors que local between avec index supérieur → ignore.

### Dernière manche

- `round_result` avec `roundIndex === roundCount-1` → `series_end` seulement.
- Ancien `tiernight-end` patch d’une mono-partie / autre run : déjà filtré par runId ; étendre phase.

---

## 13. Stratégie de reprise et acting host

### Reprise

- Hydrate `series` + `phase` + `roundIndex` + maps courantes.
- Si `ranking` : plateau thème courant (items/roster).
- Si `between_rounds` / `round_result` : interstitial (pas select, pas premier thème).
- Si `series_end` : end global.
- Scoring : si `roundId ∈ scoredRoundIds` → skip apply.
- **Ne jamais** recalculer `queue` côté client.

### Acting host

**État actuel** : classic advance/force = **hôte réel uniquement**. Acting host peut clôturer vers `results` mais **pas** publier le recap de plateau. Risque : hôte parti mid-wait → série bloquée.

**Cible V1 minimale** : documenter le risque ; claim host existant (`requireHostToLaunch` / offer) comme mitigation.

**Ticket hardening** : autoriser `canActAsHost` pour `round_result` et `next round` **avec** ledger `scoredRoundIds` + nonce pour éviter double score / double advance. Hors chemin critique catalogue.

---

## 14. Risques et angles morts

1. **Ambiguïté `lobbyStarted`** pour interstitial — à remplacer/compléter par `phase`.
2. **Acting host** classic insuffisant (bloquant terrain si hôte drop).
3. **Double evening** si rebuild recap après wipe local sans ledger round.
4. **`setTierNightTopicId` wipe** dangereux si réutilisé mid-série.
5. **preserve on push** (TN-02) : full replace doit préserver `series` + customs.
6. **Solo** : même machine d’états sans sync (ou V1 MP-only — produit).
7. **Compat sessions** mono-thème en cours pendant deploy.
8. **`tierNightsPlayed` +1/manche** peut gonfler stats — décision produit.
9. **Pool &lt; count** (catégorie trop petite).
10. **Rank Live** non touché mais partage `tierNightTopicId` / restart — régressions collatérales à tester.
11. **Force results** mid-série : sémantique à cadrer (skip joueurs vs attendre).
12. Pas de tests série aujourd’hui.

---

## 15. Tests existants

| Fichier | Contrat | Type | Valeur | Lacune série |
|---------|---------|------|--------|--------------|
| `tierNightScoring.test.js` | Points / reverse / outsider | unitaire | Haute | Pas multi-round ledger |
| `tierNightConsensus.test.js` | Consensus | unitaire | Haute | — |
| `tierNightLive.test.js` | Live merge / route | miroir | Haute live | Hors classic series |
| `tierNightBug03/04/05` | Reveal / roster freeze / runId wipe | miroir | Haute | Patterns à réutiliser |
| `tierNightRestartRecap.test.js` | Restart ≠ old recap | miroir | **Critique** pour série | Étendre between≠end |
| `tierNightRankItRemoval.test.js` | Modes | statique | Moyenne | — |
| `featureTierNight01/02` | Customs | miroir+unit | Haute | Hors packs V1 |
| `uxTierNightEnd01` | UI end | statique | Moyenne | Interstitial ≠ end |
| `uxTierNightNav01` | Nav create | statique | Moyenne | Select pack nouveau |
| `arch04PrepResumeBanner` | Resume prep | miroir | Moyenne | Screens série |
| `sessionRouteRestartDecision` | Guest/host restart | miroir | Haute | — |
| `restartGameRollback` | Rollback multi-key | miroir | Haute | Keys série |
| `rosterRenameMigrate` | Rename | unitaire | Moyenne | — |

---

## 16. Matrice de tests future

| Cas | Niveau |
|-----|--------|
| Pack 3 / 5 / 7 | unit pickQueue + miroir launch |
| Sans doublon | unit |
| Catégorie insuffisante | unit + UX message |
| Progression index | miroir state machine |
| Reset votes entre manches | miroir merge |
| Stale round / run | unit guards |
| Double-clic next | miroir nonce/phase |
| Déco/reco mid-ranking / between | intégration manuelle + miroir hydrate |
| Acting host double score | miroir ledger |
| Timeout next patch | miroir reconcile |
| Score exactement 1×/round | unit ledger |
| Fin seulement dernière | miroir route |
| Restart après series_end | miroir = select clean |
| Retour catalogue jeux | existant complete |
| Compat session sans `series` | miroir legacy path |
| Non-régression Live + customs 02 | suites existantes |

---

## 17. Découpage des tickets d’implémentation

### T1 — FEATURE-TIERNIGHT-SERIES-01 · Catalogue & catégories

- **Objectif** : structure catégorisée + helpers pick ; enrichissement **modéré** du contenu.
- **Périmètre** : `data/tierTopics.js`, `rosterTopic.js`, tests unit catalogue.
- **Hors scope** : session multi-manches, UX pack complète (stub OK).
- **Dépendances** : aucune.
- **Risques** : casser ids existants.
- **AC** : ids stables ; pick sans doublon ; fallback pool insuffisant défini.
- **Tests** : unit pick/clamp ; resolve `roster:id` inchangé.
- **QA** : smoke select affiche catégories (si UI minimale) ou data-only.

### T2 — FEATURE-TIERNIGHT-SERIES-02 · Contrat session (`series` + Option A)

- **Objectif** : shape remote/local + hydrate + compat legacy.
- **Périmètre** : `tierNightToRemote`, applyRemote, state defaults, preserve push.
- **Hors scope** : UI interstitial, scoring ledger complet.
- **Dépendances** : T1 (ids queue).
- **Risques** : hydrate / TN-02 preserve.
- **AC** : session avec `series` round-trip ; sans `series` = mono path.
- **Tests** : miroir serialize/hydrate/preserve.

### T3 — FEATURE-TIERNIGHT-SERIES-03 · Progression manches

- **Objectif** : transitions ranking ↔ round_result ↔ between ↔ next / series_end.
- **Périmètre** : `advance…` refactor, next-round commit, reset maps, **pas** select entre manches.
- **Dépendances** : T2.
- **Risques** : navigation, stale.
- **AC** : 3 manches sans `tiernight-select` ; fin seulement à la fin.
- **Tests** : machine à états pure + miroir host transitions.

### T4 — FEATURE-TIERNIGHT-SERIES-04 · UX select pack + interstitial

- **Objectif** : UI catégories + 3/5/7 ; interstitial sync ; CTA hôte / wait invité.
- **Périmètre** : `tierNightSelect.js`, nouvel écran ou mode end, CSS ciblé, nav.
- **Dépendances** : T1–T3.
- **Hors scope** : playlist manuelle, customs in pack.
- **AC** : parcours produit V1 ; pas de full remount inutile.
- **Tests** : wiring statique + QA terrain.
- **QA** : hôte/invité interstitial, double-clic, erreur réseau.

### T5 — FEATURE-TIERNIGHT-SERIES-05 · Scoring ledger

- **Objectif** : `scoredRoundIds` ; evening chaque manche ; pas de double.
- **Périmètre** : `tierNightSession.js`, advance, end cumul.
- **Dépendances** : T3.
- **AC** : N awards pour N manches ; refresh ne re-score pas.
- **Tests** : unit ledger + miroir.

### T6 — FEATURE-TIERNIGHT-SERIES-06 · Reprise / stale / acting host

- **Objectif** : hydrate phases ; guards ; option acting host advance.
- **Périmètre** : route helpers, resume labels, advance gates.
- **Dépendances** : T3–T5.
- **AC** : reco mid-série OK ; stale ignore ; claim/acting documenté ou implémenté.
- **Tests** : restartRecap étendu ; route ; acting.
- **QA** : kill app, host switch.

### T7 — FEATURE-TIERNIGHT-SERIES-07 · Suite tests automatisés

- Matrice §16 ; non-régression Live + 01/02 + end/nav.
- **Dépendances** : T3–T6.

### T8 — FEATURE-TIERNIGHT-SERIES-08 · QA terrain

- Packs 3/5/7, multi-joueurs, leave, restart, Live non-régression, customs always-on hors pack.
- Clôture audit + MAJ `AUDIT_REGROUPEMENT_CAUSES_RACINES.md`.

**Note ticket audit** : reformuler / remplacer le libellé actuel de **FEATURE-TIERNIGHT-01** (customs) dans l’audit vivant — les customs sont livrés ; le besoin série est **SERIES-***.

---

## 18. Questions produit résiduelles

1. Solo : multi-manches dès V1 ou MP-only ?
2. Pool &lt; N : clamp, bloquer launch, ou compléter depuis « toutes catégories » ?
3. `tierNightsPlayed` : +1/manche ou +1/série ?
4. Force results mid-série : autorisé comme aujourd’hui ?
5. Interstitial : détail scoring complet vs compact ?
6. Acting host advance en V1 ou reporté T6 ?
7. « Toutes catégories » : union de toutes les `enabled` ?
8. Conserver customs sur select **à côté** des packs (hors tirage) — oui par défaut ?
9. Relancer avec **mêmes paramètres** (mêmes catégories/N, nouvelle queue RNG) en V1 ?
10. Faut-il un écran `tiernight-between` dédié ou réutiliser `tiernight-end` en mode partiel ?

Aucune de ces questions **n’empêche** de figer le contrat Option A ci-dessus.

---

## 19. Liste exhaustive des fichiers et fonctions inspectés

### Domaine / data

- `data/tierTopics.js` — `TIER_NIGHT_ROSTER_TOPICS`, modes, modifiers, `TIER_LISTS`
- `data/gameRules.js` — règles TierNight (contexte)
- `data/eveningScoring.js` — via `EVENING_POINTS` (réf. scoring)

### Screens / games

- `js/screens/tierNightSelect.js` — `mountTierNightSelect`, `startGame`, `ensureHost`
- `js/screens/tierNightCreateRoster.js` — create custom (hors packs)
- `js/screens/tierNightCreate.js` — Rank Live create (contraste)
- `js/screens/tierNightEnd.js` — `mountTierNightEnd`, bootstrap, complete, restart bind
- `js/games/tierNight.js` — `mountTierNight`, `finishGame`, force, navigate end
- `js/games/tierNightLive.js` — contraste roundIdx / finalize

### Core TierNight

- `js/core/tierNightConfig.js` — `createTierNightRunId`, `tierNightRecapBelongsToRun`, `shouldPreferTierNightEndRoute`, `finishedTierNightLiveRemote`, config patch
- `js/core/tierNightLiveSession.js` — `markTierNightClassicStarted`, live start/reset
- `js/core/tierNightSession.js` — `buildRecapsFromPlacements`, `buildRecapsWithSimulation`, `applyTierNightRoundScores`, `saveTierNightRecaps`
- `js/core/tierNightScoring.js` / `tierNightConsensus.js` — barème
- `js/core/tierNightRoster.js` — `buildTierNightPlayerRoster`, list from roster
- `js/core/tierLists.js` — `resolveTierNightClassicList`, `buildRosterList`
- `js/core/rosterTopic.js` — `resolveRosterTopicConfig`, prefix
- `js/core/tierNightNav.js` — retour select steps
- `js/core/customRosterTopics.js` / `customRosterTopicSession.js` / `customRosterTopicsSyncGuard.js` — customs (hors packs V1)
- `js/core/tierNightLiveMerge.js` / `tierNightLiveReveal.js` — contraste runId/roundIdx

### Sync / launch / state

- `js/core/gameSync.js` — `tierNightToRemote`, `tierNightRecapToRemote`, `syncTierNightSession`, `ensureTierNightRecapsFromRemote`, `advanceTierNightToResultsWhenReady`, `finalizeTierNightLiveToResults`, `canRouteToTierNightEnd`, `isStaleTierNightEndPatch`, applyRemote classic branch, progress finished, `completeGameSession` (réf.)
- `js/core/mpLaunch.js` — `launchGameWithSync`, navigateAfterGameLaunch
- `js/core/restartGame.js` — `launchTierNightSelect`, restart registry, evening restart button
- `js/core/state.js` — `setTierNightTopicId` (wipe), getters, `customRosterTopics`, scores
- `js/core/gameResume.js` — labels reprise
- `js/core/sessionMerge.js` — merge customs / patterns
- `js/core/gameSessionRpc.js` — contribute player (réf.)
- `js/core/lobby.js` — `setLobbyPlaying` (réf. scores session)
- `js/main.js` — routes screens
- `js/screens/gameSelect.js` — entry launch (réf.)

### Docs / SQL (lecture, non modifiés)

- `docs/AUDIT_REGROUPEMENT_CAUSES_RACINES.md` — TIERNIGHT-01/02 hors scope séries
- `supabase/feature-tiernight-02-*.sql` — preserve roster (contrainte future series field)
- `supabase/game-sessions-i08-arch03.sql` — contribute placement/finished (réf. agents)

### Tests inventoriés

- Liste §15 (tous les `tierNight*`, `featureTierNight*`, `uxTierNight*`, routes/restart/roster associés)

---

## 20. Confirmation explicite

**Aucune fonctionnalité produit n’a été implémentée dans ce ticket.**

- Aucune opération Git.
- Aucune migration SQL / modification Supabase.
- Aucun renommage de structures runtime.
- Aucun changement de comportement applicatif.
- Livrables : ce rapport (`docs/FEATURE-TIERNIGHT-SERIES-00.md`) et un canvas de synthèse associé.

---

*Fin FEATURE-TIERNIGHT-SERIES-00.*
