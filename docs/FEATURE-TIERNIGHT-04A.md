# FEATURE-TIERNIGHT-04A — Rank Live : audit d’architecture + contrat canonique

**Statut** : contrat architecture — **`FEATURE-TIERNIGHT-04A contract ready for 04B`**  
**Date** : 2026-08-08 (corr. finale lifecycle customs : clear à `series_end`, sans consumed / sans plafond count)  
**Git** : aucune opération Git  

> **Suite** : tickets d’implémentation proposés en §13 (`04B` …).  
> Ce document verrouille le wire contract avant tout SQL/UI large.

---

## Décisions produit figées (rappel)

| # | Décision |
|---|----------|
| 1 | Rank Live = **série** de listes (pas un prep mono-liste) |
| 2 | Counts UI : **3 / 5 / 7** |
| 3 | Contribution = **tier list complète** (nom + emoji + items) ; create/delete ; ownership auteur |
| 4 | Customs **partagés** lobby/session ; **visibles** (nom, auteur, count items) |
| 5 | Scope customs = **une manche** (= série complète 3/5/7) ; clear **ALL** à `series_end` |
| 6 | Deck : customs prioritaires (`combinedGameDeck`) ; queue **une fois** au launch |
| 7 | **Catégories live REPORTÉES** — V1 = catalogue officiel **global** uniquement ; pas de filtre UI |
| 8 | Builder : toujours `queue.length === roundCount` ; sinon **erreur métier** (jamais queue partielle / backfill hors pool / roundCount implicite) |
| 9 | **Aucun plafond** de nombre de customs (ni auteur, ni lobby) — seules les bornes **par entrée** |
| 10 | **Pas** de ledger `consumedCustomLiveTierListIds` — inutile : clear total à fin de manche |

**Note counts** : le mode roster utilise `3 / 5 / 8` (avec `7` legacy lecture seule). Live adopte volontairement `3 / 5 / 7` — divergence produit assumée, constantes **séparées**.

**Note catégories V1** : avec 8 listes officielles et `roundCount` max 7, le pool global satisfait le contrat sans custom. Aucune taxonomie `life/food/culture/digital` dans FEATURE-TIERNIGHT-04. Le wire conserve `categoryIds: ["*"]` comme sentinelle forward-compat (voir §4.4) ; le builder V1 traite uniquement `["*"]` = catalogue complet.

**Note lifecycle customs** : une « manche » = la série complète. Les customs restent dans `customLiveTierLists` pendant toute la série (sélectionnés ou non). À `series_end` → clear de **toute** la collection. Manche suivante = collection vide + nouvelles contributions prep.
---

## 1. Inventaire actuel

### 1.1 Fichiers / rôles (Rank Live + voisinage)

| Fichier | Rôle |
|---------|------|
| `data/tierTopics.js` | `TIER_LISTS` (8 listes officielles), modes, catégories **roster only** |
| `data/games.js` | Tuile catalogue `tiernight-select` |
| `js/main.js` | Enregistre `tiernight-select`, `tiernight-prep`, `tiernight-create`, `tiernight-live`, `tiernight-between`, `tiernight-end` |
| `js/screens/tierNightSelect.js` | Mode chooser ; **live = grille → launch immédiat** |
| `js/screens/tierNightCreate.js` | Création custom locale + **launch immédiat** |
| `js/screens/tierNightPrep.js` | Prep **roster uniquement** |
| `js/games/tierNightLive.js` | Runtime item-par-item (vote / reveal) |
| `js/core/tierNightLiveSession.js` | Launch live mono-liste, votes, reveal, fin ; aussi `markTierNightSeriesStarted` (roster) |
| `js/core/tierLists.js` | `TIER_LISTS ∪ customTierLists` ; résolution listes |
| `js/core/state.js` | `customTierLists` local ; `tierNightLiveGame` ; customs roster séparés |
| `js/core/tierNightSeries*.js` | Contrat série **roster** (`topicId` `roster:…`) |
| `js/core/tierNightSeriesPrepSession.js` | Prep roster + launch série |
| `js/core/customRosterTopic*.js` | Customs roster partagés |
| `js/core/combinedGameDeck.js` | Priorité customs — **réutilisable tel quel** |
| `js/core/prepScreen.js` / `usePrepLobby.js` / `prepLaunch.js` / `mpLaunch.js` | Shell prep multi-jeux |
| `js/core/tierNightSeriesExitNav.js` | Exit / replay / change mode (roster) ; live volontairement isolé |
| `js/core/tierNightCustomRosterClear.js` | Clear autoritatif customs **roster** à sortie produit |

### 1.2 Screens / routes

| Route | Usage actuel |
|-------|----------------|
| `tiernight-select` | Modes ; step `list` = grille Rank Live |
| `tiernight-create` | Créer liste + jouer |
| `tiernight-live` | Runtime live |
| `tiernight-prep` | Prep série **roster** |
| `tiernight-between` / `tiernight-end` | Série roster (end aussi reachable depuis live fini) |
| `tiernight-create-roster` | Legacy ; normalisé vers prep roster |

**Absent** : `tiernight-live-prep`, between-listes live, série live.

### 1.3 State local / remote

| Clé | Scope | Sync |
|-----|-------|------|
| `customTierLists` | localStorage (`reveal-app-state`) | **Non** |
| `tierNightLiveGame` ↔ `state.tierNightLive` | session | Oui |
| `tierNightSeriesPrep` ↔ `state.tierNightPrep` | session | Oui (roster) |
| `customRosterTopics` | top-level session | Oui (RPC) |
| `consumedCustomRosterTopicIds` | top-level / evening | Oui (merge) |
| `tierNightGame.series` | session | Oui + SQL shape/finalize/advance |

### 1.4 Usages de `customTierLists` (inventaire complet applicatif)

| Zone | Usage |
|------|--------|
| `js/core/state.js` | default, hydrate, `addCustomTierList`, `deleteCustomTierList` |
| `js/core/tierLists.js` | `getAllTierLists()` |
| `js/screens/tierNightSelect.js` | grille + delete |
| `js/screens/tierNightCreate.js` | create via `addCustomTierList` |
| Tests / docs FEATURE-03 / smoke SQL | **préserve** volontairement (isolation vs clear roster) |
| `resetEveningState` / `resetGameSessionsOnly` | **ne clear pas** `customTierLists` |
| Sync / RPC | **aucun** |

Conclusion : `customTierLists` = bibliothèque **personnelle locale** historique. Ne pas le réutiliser comme canon partagé.

### 1.5 Catalogue officiel live

| id | name | items | JSON approx |
|----|------|------:|------------:|
| `life` | Situations de vie | 9 | 324 B |
| `fastfood` | Fast Food | 6 | 124 B |
| `animation` | Dessins animés | 9 | 191 B |
| `games` | Jeux vidéo | 9 | 184 B |
| `music` | Artistes | 9 | 170 B |
| `movies` | Films cultes | 9 | 174 B |
| `apps_hot` | Apps du quotidien | 9 | 163 B |
| `food` | Nourriture | 9 | 154 B |

- **8 listes**, **69 items**, max item **36** chars, catalogue entier ~**1.5 KB**.
- Shape : `{ id, name, emoji, items[] }` — **pas de `categoryId`**.
- Taxonomie roster (`survival` / `social` / `chaos`) : **sans sens** pour ces listes.

### 1.6 SQL / RPC liés

| RPC / fn | Rôle | Consommateurs |
|----------|------|----------------|
| `upsert_player_custom_entry` | Append/upsert custom (Hot Take / Dilemma / TierNight roster) | HT, Dilemma, TN roster |
| `delete_player_custom_entry` | Delete owned | idem |
| `upsert_game_session_preserving_roster_topics` | Replace state sans écraser `customRosterTopics` | sync TN |
| `clear_tiernight_custom_roster_topics` | Clear autoritatif roster customs | exit TN |
| `contribute_prep_*` (guest ready + pool invalidate) | Ready epoch-aware sur `tierNightPrep` | prep roster |
| `tiernight_series_validate_series_shape` | Shape queue **`roster:` + topicSnapshot** | finalize/advance roster |
| `finalize_tiernight_series_round` / `advance_tiernight_series_round` | Runtime série roster | roster only |

Limite actuelle upsert : **`octet_length(p_entry) ≤ 2048`**. Suffisant pour un thème roster (≤80 chars), **insuffisant** pour une tier list riche si on réutilise la même RPC sans branche dédiée.

---

## 2. Graphe du flux actuel Rank Live

```text
game-select
  └─ launchTierNightSelect → tiernight-select (step=mode)
       ├─ mode roster → enterTierNightSeriesPrep → tiernight-prep → …
       └─ mode live → step=list (grille)
            ├─ clic liste officielle/custom locale
            │    → markTierNightLiveLobbyStarted({topicId,listName,items})
            │    → screen tiernight-live  [BYPASS prep/ready]
            └─ « Créer ma tier list » → tiernight-create
                 → addCustomTierList (localStorage)
                 → markTierNightLiveLobbyStarted
                 → tiernight-live               [BYPASS prep/ready]

Runtime live (mono-liste) :
  phase voting → (all votes) reveal → next item …
  → phase done / finished → tiernight-end (récap live)
```

**Bypass à supprimer** : tout chemin `pick|create → launch` sans ready / epoch / queue série.

Autres entrées :
- `restartGame` / `launchTierNightSelect` : reset live + retour select.
- Replay fin live : `shouldReplayTierNightSeriesToPrep` retourne **false** pour live → hub select (pas prep).
- Deep `step=list` : ouvre encore la grille launchable.

---

## 3. Graphe du flux cible

```text
tiernight-select (mode)
  └─ live → tiernight-live-prep
        ├─ hôte : roundCount ∈ {3,5,7}  (pas de filtre catégories V1)
        ├─ tous : contribute / delete own customLiveTierLists
        ├─ ready (setupEpoch) + force-start
        └─ launch (hôte) — UNE mutation atomique
              → pool = customLiveTierLists (toutes valides) ∪ catalogue officiel global
              → construit sous-ensemble (philosophie combinedGameDeck)
              → exige length === roundCount (sinon erreur)
              → snapshots listes + items dans la queue
              → **customs collection KEEP** (sélectionnés et non sélectionnés)
              → reset prep ready
              → screen tiernight-live (liste 0)

Runtime série live :
  series.phase = playing_list
    └─ item loop (voting / reveal) sur listSnapshot.items (deck figé)
  → between_lists (écran between dédié ou paramétré)
  → liste suivante …
  → series_end → tiernight-end
```

Routes cibles :
- `tiernight-live-prep` (nouveau)
- `tiernight-live` (inchangé gameplay item, branché sur snapshot série)
- `tiernight-live-between` **ou** `tiernight-between?mode=live` (décision implémentation 04D)
- `tiernight-end` (réutilisé)

La grille select `step=list` et le CTA « Créer et jouer » **cessent d’être des launchers**.

---

## 4. Canon `tierNightLivePrep`

### 4.1 Emplacement

- Remote : `game_sessions.state.tierNightLivePrep` (**top-level**, parallèle à `tierNightPrep`)
- Local : `state.tierNightLiveSeriesPrep` (ou nom local symétrique — à figer en 04B ; recommandation : `tierNightLiveSeriesPrep`)

**Ne pas** réutiliser la clé `tierNightPrep` : codecs, guest-ready SQL, pool invalidate et exit roster y sont câblés.

### 4.2 Shape remote

```json
{
  "categoryIds": ["*"],
  "roundCount": 5,
  "ready": { "<uid>": true },
  "setupEpoch": 0,
  "poolInvalidateRequestId": null
}
```

| Champ | Type | Règles V1 |
|-------|------|-----------|
| `categoryIds` | `string[]` | **uniquement** `["*"]` produit / accepté pour un **nouveau** launch ; toute autre valeur = erreur de contrat V1 (pas de filtre silencieux) |
| `roundCount` | `number` | ∈ `{3,5,7}` pour **nouveau** launch ; absent/legacy → défaut `5` |
| `ready` | `Record<uid, boolean>` | remote par UID ; local UI peut projeter par display name |
| `setupEpoch` | `number ≥ 0` | bump hôte sur changement **roundCount** (seul setting UI V1) ; ready stale rejeté |
| `poolInvalidateRequestId` | `string\|null` | optionnel ; signal pool (si adopté comme roster) |

### 4.3 Merge / reset / epoch

| Événement | Comportement |
|-----------|----------------|
| Enter live prep (1ʳᵉ fois / resetSettings) | defaults `categoryIds:["*"]`, `roundCount:5`, `ready:{}`, `setupEpoch++` |
| Host change roundCount | settings write + `ready:{}` + `setupEpoch++` ; **force** `categoryIds:["*"]` |
| Guest ready toggle | RPC contribute avec `expectedSetupEpoch` ; mismatch → no-op/reject |
| Launch success | `ready:{}` ; settings conservés pour replay UX ; **pas** de queue dans prep |
| Exit série live / change mode | reset autoritatif settings+ready+epoch++ (miroir roster E1) |
| Champ absent (client stale) | defaults défensifs (`categoryIds` → `["*"]`) ; ignore clés inconnues |

Ownership écriture :
- settings : hôte (réel) uniquement
- ready : chaque membre sur sa clé UID
- customs : RPC dédiées (hors blob prep)

### 4.4 `categoryIds` — décision wire V1 (forward-compat)

**Retenu : conserver `categoryIds: ["*"]` dans le wire.**

| Pour | Contre |
|------|--------|
| Même famille de shape que `tierNightPrep` / série | Champ mort en V1 |
| Évite une migration de schéma quand les catégories arriveront | Surface codec/validate à maintenir |
| Sentinelle explicite « catalogue global » | Risque qu’un ticket futur active un filtre trop tôt |

**Dette acceptée** si et seulement si les invariants V1 suivants sont testés :

1. UI prep **n’expose aucun** sélecteur de catégories ;
2. writers V1 **écrasent / normalisent** toujours vers `["*"]` ;
3. builder V1 : `["*"]` ⇒ pool = **toutes** les listes officielles ; **aucun** filtrage implicite ;
4. valeur ≠ `["*"]` au launch V1 ⇒ **reject** explicite (pas de best-effort).

Ne **pas** créer maintenant `life / food / culture / digital`.  
Ne **pas** annoter les 8 listes officielles avec un `categoryId` artificiel sous FEATURE-TIERNIGHT-04.

### 4.5 Builder sous-ensemble V1 (contrat exact)

Inputs : `officialPool = TIER_LISTS` (global) ; `customs = customLiveTierLists` valides au launch ; `R = roundCount`.

**Pas de filtre consumed.** Pas de ledger live.

```text
customs      = customLiveTierLists structurellement valides (toutes)
officialPool = TIER_LISTS
R            = roundCount ∈ {3,5,7}
C            = customs.length

si officialPool.length + C < R
  → ERREUR MÉTIER explicite (jamais sous-ensemble partiel)

sinon si C >= R
  → shuffle(customs).slice(0, R)
  → (shuffle final du résultat si le helper le fait déjà dans cette branche)

sinon  # 0 <= C < R
  → pickedOfficials = shuffle(officialPool).slice(0, R - C)
  → shuffle([...customs, ...pickedOfficials])   # TOUS les C customs inclus

assert result.length === R
```

Interdit :
- `shuffle([...customs, ...officials]).slice(0, R)` quand `C < R` (peut évincer un custom) ;
- backfill hors pool / bibliothèque locale ;
- clamp silencieux de `R` ;
- muter `customLiveTierLists` pendant le build.

**04B** sélectionne le sous-ensemble de listes. **04E** le transforme en `queue` snapshotée (`roundId`, `listId`, …).

---

## 5. Canon customs partagés

### 5.1 Shape

```json
{
  "id": "custom-live-550e8400-e29b-41d4-a716-446655440000",
  "name": "Meilleurs desserts",
  "emoji": "🍰",
  "items": ["Tiramisu", "Brownie", "Crêpe", "Mochi"],
  "author": "Alice",
  "authorUid": "<supabase-uid>",
  "custom": true
}
```

| Champ | Obligatoire | Règle |
|-------|-------------|--------|
| `id` | oui | préfixe `custom-live-` + UUID |
| `name` | oui | trim ; 2–40 chars (aligné UI create actuelle `maxlength=40`) |
| `emoji` | non | défaut `"✨"` ; max 4 chars grapheme-safe côté client |
| `items` | oui | array de strings ; ordre = ordre de contribution ; **conservé** jusqu’au shuffle deck au launch |
| `author` | oui (serveur) | display name lobby au moment de l’écriture |
| `authorUid` | oui (serveur) | `auth.uid()` — ownership |
| `custom` | oui | toujours `true` pour cette collection |

### 5.2 Validation items

| Règle | Valeur | Justification |
|-------|--------|----------------|
| Min items | **4** | UI create actuelle |
| Max items | **16** | officielles ≤9 ; marge festives sans explosion payload |
| Max chars / item | **40** | officielles max 36 ; create n’avait pas de max explicite |
| Unicité items | **case/trim-insensitive** dans une liste | évite votes doublons |
| Blancs | trim ; vides rejetés | |
| Modération | même pipeline `checkHotTakeModeration` (name + chaque item) | cohérence REVEAL |

### 5.3 Limites collection / payload

| Limite | Décision | Justification |
|--------|----------|---------------|
| Max entry JSON | **4096 octets** (branche live) | Bornes **par entrée** ; 16×40 + meta typiquement &lt;1.5 KB ; 2 KB RPC générique trop juste |
| Max customs / **auteur** | **Aucune** | Aligné HT / Dilemma multi-append / roster |
| Max customs / **lobby** | **Aucune** | Pas de plafond numérique produit ; ne pas réintroduire sans décision explicite |
| Doublons id | reject / dedupe sanitize | |
| Visibilité prep | name, emoji, author, `items.length` ; items complets **transportés** (canon) mais UI peut replier le détail |

#### Audit limites nombre (conventions REVEAL)

| Jeu | Limite auteur / collection |
|-----|----------------------------|
| Hot Take | Aucune limite auteur — multi-append |
| Dilemma | Limite « 1 / auteur » **retirée** (`feature-dilemma-01-multi-custom.sql`) |
| Classe le groupe | Aucune limite auteur |

**Figé Rank Live** : nombre de contributions **illimité**. Seules les bornes structurelles d’**une** liste s’appliquent (name, items 4–16, item length, payload entry 4096).

Si 04C mesure un risque réel de taille cumulée `game_sessions.state` : rapporter tailles observées + option architecturale — **sans** réintroduire silencieusement un plafond de count.

Ownership delete : `authorUid === auth.uid()` (fallback legacy name **interdit** pour live — collection neuve).

### 5.4 Pattern sync (obligatoire)

**Interdit** : read-modify-write du tableau entier via `patchGameState`.

**Requis** : upsert/delete **atomiques par entrée** (FOR UPDATE sur `game_sessions`), miroir roster :
- strip collection des patches génériques (sync guard)
- preserve collection sur replace session
- optimistic local + rollback
- hydrate remote authoritative + keep in-flight own entries

### 5.5 Snapshot liste (série)

Pas de `categoryId` dans le snapshot V1 (ni `""` artificiel).

```json
{
  "id": "food",
  "name": "Nourriture",
  "emoji": "🍕",
  "items": ["Pizza", "Sushi", "..."],
  "custom": false
}
```

Champs série autour du snapshot : `roundIndex`, `roundId`, `listId` (`live:<rawId>`). Rien d’autre n’est requis pour le contenu joué.

**Deux responsabilités distinctes** :

| Couche | Clé | Mutabilité |
|--------|-----|------------|
| Prep | `customLiveTierLists` | mutable jusqu’à clear |
| Runtime | `tierNightLive.series.queue[*].listSnapshot` | **immutable** après launch |

Le runtime **ne relit jamais** `customLiveTierLists` pour jouer. Clear collection à `series_end` **n’altère pas** la queue / récap déjà snapshotés.

### 5.6 Concept retiré — `consumedCustomLiveTierListIds`

**Retiré du contrat Rank Live.**  
Raison : les customs appartiennent à **une seule manche** ; clear total à `series_end` rend le ledger one-shot redondant. Ne pas maintenir deux mécanismes pour le même lifecycle.

*(Le ledger roster `consumedCustomRosterTopicIds` reste inchangé — autre mode.)*

---

## 6. Décision sur le nom

| Symbole | Rôle | Action |
|---------|------|--------|
| `customTierLists` | bibliothèque **locale** historique | **Conserver** tel quel ; ne plus l’utiliser comme source de launch série ; éventuelle UX « importer » = **hors scope 04** |
| **`customLiveTierLists`** | catalogue **partagé** de la manche | **Canon retenu** |
| `tierNightLiveCustomLists` | alternative | rejetée : moins parallèle à `customRosterTopics` |
| `consumedCustomLiveTierListIds` | — | **RETIRÉ** du contrat Rank Live |
| `customLiveTierListsEpoch` / `Writable` | anti-revive après clear | miroir roster si besoin aux frontières clear |

Préfixe id : `custom-live-` (distinct de `custom-` local et `custom-roster-`).

Wire officiel dans queue : `live:<rawId>` (ex. `live:food`, `live:custom-live-…`) — parallèle à `roster:<id>`.

---

## 7. Contrat série — décision

### Verdict : **contrat live séparé / discriminé**, **pas** d’extension de `tierNight.series`

### Preuves code

1. SQL `tiernight_series_validate_series_shape` exige `topicId` préfixé **`roster:`** et `topicSnapshot` `{id,name,custom}` **sans items**.
2. `finalize_tiernight_series_round` / `advance_tiernight_series_round` orchestrent placements **joueurs-as-items**, screens `tiernight` / `tiernight-between`, scoring roster.
3. Phases série roster : `ranking | between_rounds | series_end`.  
   Phases item live actuelles : `voting | reveal | done` — collision sémantique si fusionnées.
4. `roundIdx` live = **index d’item** ; `roundIndex` série = **index de liste**. Vocabulaires incompatibles dans un même objet.
5. Exit E1 / clear customs / guest ready sont câblés sur `tierNight` + `tierNightPrep` + `customRosterTopics`.

### Canon recommandé

Série sous le blob live remote `state.tierNightLive.series` (local `tierNightLiveGame.series`) :

```text
series: {
  version: 1,
  kind: "live",                 // discriminant explicite
  categoryIds: ["*"],           // V1 : sentinelle catalogue global uniquement
  roundCount,                   // ∈ {3,5,7} ; queue.length === roundCount
  queue: [ LiveQueueEntry, ... ],
  roundIndex,                   // index de LISTE
  phase: "playing_list" | "between_lists" | "series_end",
  completedRoundIds: [],
  // ledgers scoring list-level si besoin plus tard
}
```

**Runtime item** reste sibling (pas dans queue) :

```text
tierNightLive: {
  runId,
  lobbyStarted, finished,
  series,
  // active list projection (dérivée de queue[roundIndex] au advance) :
  listId, listName, deck,       // deck = shuffle(items) figé au début de la liste
  itemIndex,                    // renommer progressivement roundIdx → itemIndex (alias)
  phase: "voting"|"reveal"|"done",
  votes, placements,
  playerRoster
}
```

Queue entry :

```json
{
  "roundIndex": 0,
  "roundId": "<runId>:0",
  "listId": "live:food",
  "listSnapshot": {
    "id": "food",
    "name": "Nourriture",
    "emoji": "🍕",
    "items": ["Pizza", "Sushi", "..."],
    "custom": false
  }
}
```

Règles :
- runtime **ne relit jamais** `customLiveTierLists` ni `TIER_LISTS` après launch pour le contenu joué ;
- delete custom post-launch : série intacte ;
- rebuild queue client interdit.

---

## 8. Wire example complet

```json
{
  "tierNightLivePrep": {
    "categoryIds": ["*"],
    "roundCount": 3,
    "ready": {
      "uid-host": true,
      "uid-alice": true,
      "uid-bob": true
    },
    "setupEpoch": 4,
    "poolInvalidateRequestId": null
  },

  "customLiveTierLists": [
    {
      "id": "custom-live-aaa",
      "name": "Desserts",
      "emoji": "🍰",
      "items": ["Tiramisu", "Brownie", "Crêpe", "Mochi"],
      "author": "Alice",
      "authorUid": "uid-alice",
      "custom": true
    },
    {
      "id": "custom-live-bbb",
      "name": "Sports",
      "emoji": "⚽",
      "items": ["Foot", "Basket", "Tennis", "Natation", "Rugby"],
      "author": "Bob",
      "authorUid": "uid-bob",
      "custom": true
    }
  ],

  "tierNightLive": {
    "runId": "tiernight-1723123456-ab12",
    "lobbyStarted": true,
    "finished": false,
    "listId": "live:custom-live-aaa",
    "listName": "Desserts",
    "deck": ["Mochi", "Tiramisu", "Brownie", "Crêpe"],
    "itemIndex": 1,
    "phase": "voting",
    "votes": { "uid-alice": "S" },
    "placements": {},
    "playerRoster": [
      { "userId": "uid-host", "displayName": "Host" },
      { "userId": "uid-alice", "displayName": "Alice" },
      { "userId": "uid-bob", "displayName": "Bob" }
    ],
    "series": {
      "version": 1,
      "kind": "live",
      "categoryIds": ["*"],
      "roundCount": 3,
      "roundIndex": 0,
      "phase": "playing_list",
      "completedRoundIds": [],
      "queue": [
        {
          "roundIndex": 0,
          "roundId": "tiernight-1723123456-ab12:0",
          "listId": "live:custom-live-aaa",
          "listSnapshot": {
            "id": "custom-live-aaa",
            "name": "Desserts",
            "emoji": "🍰",
            "items": ["Tiramisu", "Brownie", "Crêpe", "Mochi"],
            "custom": true
          }
        },
        {
          "roundIndex": 1,
          "roundId": "tiernight-1723123456-ab12:1",
          "listId": "live:movies",
          "listSnapshot": {
            "id": "movies",
            "name": "Films cultes",
            "emoji": "🍿",
            "items": ["Inception", "Titanic", "Interstellar", "Matrix", "Le Parrain", "Fight Club", "Harry Potter", "Gladiator", "Forrest Gump"],
            "custom": false
          }
        },
        {
          "roundIndex": 2,
          "roundId": "tiernight-1723123456-ab12:2",
          "listId": "live:music",
          "listSnapshot": {
            "id": "music",
            "name": "Artistes",
            "emoji": "🎵",
            "items": ["Drake", "Taylor Swift", "The Weeknd", "Beyoncé", "Kanye West", "Billie Eilish", "Travis Scott", "Ariana Grande", "Eminem"],
            "custom": false
          }
        }
      ]
    }
  }
}
```

Notes exemple :
- `custom-live-bbb` (Sports) **reste** dans `customLiveTierLists` pendant la série même s’il n’est pas dans la queue ;
- à `series_end` → clear **toute** la collection (aaa + bbb) ; les `listSnapshot` de la série terminée restent intacts pour le récap ;
- **pas** de clé `consumedCustomLiveTierListIds` ;
- invariant : `series.queue.length === series.roundCount` (ici 3).

---

## 9. Lifecycle matrix

Légende : **P** = prep live · **C** = `customLiveTierLists` · **S** = série live active · **E** = setupEpoch

| Cas | P | C | S | E |
|-----|---|---|---|---|
| 1. Enter live prep | init/keep settings | keep (souvent `[]` après clear précédent) | clear si résidu | ++ si resetSettings |
| 2. Contribuer / delete own | keep | mutate entry | — | **pas** de bump |
| 3. Quitter prep → revenir | keep | keep | — | keep |
| 4. Launch série | ready clear | **KEEP** (tous, tirés ou non) | create + snapshots | keep |
| 5. Jouer listes / between | — | **KEEP** | advance | — |
| 6. **`series_end`** | — | **CLEAR ALL** (joués + non joués, tous auteurs) | retain jusqu’exit/replay (récap via snapshots) | — |
| 7. Replay / nouvelle manche | reset ready/settings | déjà `[]` post-`series_end` ; nouvelles contribs prep | clear S | ++ |
| 8. Change mode → roster | reset live prep | **CLEAR** customs live (sécurité / isolation) | clear S | ++ |
| 9. Sortie anormale TierNight | clear | **CLEAR** sécurité | clear | ++ |
| 10. Quitter lobby / dissolve | evening reset | **CLEAR** | clear | reset |
| 11. `resetGameSessionsOnly` | reset | **CLEAR** live customs (manche annulée) | clear live game | reset prep |
| 12. `resetEveningState` | reset | **CLEAR** | clear | reset |
| 13. Reconnect | hydrate | hydrate | hydrate snapshots | hydrate |
| 14. Acting-host | play OK ; clear collection / settings = **hôte réel** | | | |
| 15. Client stale | ignore unknown ; ready epoch mismatch rejected | | | |

Règle métier principale : **fin normale de manche** = `series_end` ⇒ clear **tous** les `customLiveTierLists`.  
Les frontiers 8–12 sont des **clears de sécurité** ; elles ne remplacent pas la règle `series_end`.

Isolation : customs live ≠ roster customs.  
`customTierLists` local : **jamais** clearé par ces frontières (bibliothèque perso distincte).  
Snapshots queue : **survivent** au clear C (runtime / end screen).

---

## 10. Analyse taille / performance

### Observé

- Catalogue officiel : ~1.5 KB / 8 listes / ≤9 items.
- Session live actuelle : 1 deck + votes + placements — déjà syncée.

### Customs (nombre non borné produit)

- Nombre de customs : **illimité** côté produit.
- Taille **individuelle** bornée (items 4–16, name/item caps, entry ≤4096 B).
- Série max 7 × snapshot ~1.5 KB ≈ **~10.5 KB** dans `series.queue` (indépendant du nombre de customs restés hors queue).
- Pool officiel V1 : 8 listes → `roundCount` 7 satisfiable sans custom.

**04C** doit : écritures atomiques **par entrée** ; éviter republications complètes inutiles ; mesurer si la taille cumulée `game_sessions.state` devient un problème réel.  
**Aucune limite globale de count** ne peut être ajoutée sans nouvelle décision produit.

### Risques

| Risque | Mitigation |
|--------|------------|
| Upsert 2 KB trop bas | Branche live **4096** |
| Patch full-collection | Interdit ; guard + RPC |
| Amplification merge | Remote authoritative ; strip keys |
| Mobile | Cap **par entrée** (16 items) ; UI liste repliable |
| Queue rebuild | Interdit post-launch |
| Pool &lt; roundCount | Reject launch explicite |
| Catalogue customs volumineux | Mesure 04C ; pas de plafond count silencieux |

---

## 11. Cartographie helpers partagés

| Helper | Consommateurs | Réutilisable ? | Risque | Stratégie |
|--------|---------------|----------------|--------|-----------|
| `prepScreen.js` | HT, Dilemma, WAO, SV, Clutch, Traitre, TM, Trivia, Consensus, TN roster | Oui (UI shell) | Moyen si if-live | Adapter config (labels, render entry) — **pas** de branche jeu dans le core |
| `usePrepLobby.js` | idem preps | Oui | Faible | config ready callbacks |
| `prepLaunch.js` | idem | Oui | Moyen (min players, validate) | `validateLaunch` injecté |
| `mpLaunch.js` | presque tous les jeux | Oui | **Élevé** | ne pas spécialiser TN live dans le cœur ; passer `stateKey`/`screen`/`buildRemote` |
| `combinedGameDeck.js` | TN roster (+ autres decks) | **Oui tel quel** | Faible | tests non-régression existants |
| `commitPrepReadyToggle` | plusieurs sessions | Oui | Moyen | nouveau `readyKey` + epoch wrapper comme roster |
| `sessionMerge` / `gameSync` codecs | global | Extension | **Élevé** | nouveaux codecs `tierNightLivePrep*` / merge live series **additifs** ; ne pas altérer merge roster |
| `upsert_player_custom_entry` | HT/Dilemma/TN roster | Extension SQL | **Élevé** | nouvelle branche `p_game` discriminant **ou** RPC dédiée live — cartographier avant REPLACE |
| `tierNightSeries*` / SQL série | roster only | **Ne pas mutualiser** | Critique | contrat live séparé |
| `tierNightSeriesExitNav` | roster exit | Extension miroir | Moyen | fonctions jumelles live ; ne pas casser E1 |

Architecture cible : **shell prep partagé + adapter `livePrepAdapter` / `rosterPrepAdapter`**.

---

## 12. SQL / RPC plan

### Réutiliser (patterns, pas le shape roster)

- Pattern FOR UPDATE + upsert by id + ownership `authorUid`
- Pattern preserve-array on full replace
- Pattern clear + epoch + writable
- Pattern guest ready + `expectedSetupEpoch`

### Ne pas réutiliser tel quel

- `tiernight_series_validate_series_shape` / finalize / advance roster
- Branche `customRosterTopics` sans discriminant
- Guest contribute hardcodé `tierNightPrep` seulement — **étendre** avec `tierNightLivePrep` **ou** RPC parallèle

### À ajouter (plan)

| Artefact | Rôle |
|----------|------|
| `upsert_player_custom_live_tier_list` **ou** RPC dédiée | upsert liste (items, caps 4096) — **pas** de plafond de count |
| `delete_player_custom_live_tier_list` | delete owned |
| `upsert_game_session_preserving_live_tier_lists` (ou preserve-keys) | anti lost-update replace |
| `clear_tiernight_custom_live_tier_lists` | clear **ALL** autoritatif (`series_end` + frontiers sécurité) |
| `contribute` ready sur `tierNightLivePrep` | guest ready |
| (04D+) `validate_tiernight_live_series_shape` | shape queue live |
| (04F+) advance/finalize list-level si besoin | optionnel ; 1ʳᵉ vague peut rester host-commit |

**Ne pas** prévoir de RPC / merge / ledger pour `consumedCustomLiveTierListIds`.

**Recommandation** : RPC **dédiées** live (clone propre) plutôt que surcharger `upsert_player_custom_entry` — réduit le blast radius.

Whitelist `game_id` session reste `tiernight` ; discriminant = **clés state** / `p_kind`, pas un nouveau `game_sessions.game_id`.

---

## 13. Découpage d’implémentation

| Ticket | Contenu | Dépend |
|--------|---------|--------|
| **04A** | Ce contrat | — |
| **04B** | Domaine pur : catalogue live **global** + validation/normalisation customs + builder customs-priority + RNG testable + erreurs + immutabilité — **sans** catégories, **sans** consumed helpers, **sans** plafond count, **sans UI** | 04A |
| **04C** | SQL/RPC customs live + sync guard + codecs ; atomicité multi-auteur ; **aucune** limite de nombre | 04B |
| **04D** | Prep remote `tierNightLivePrep` + guest ready + UI `tiernight-live-prep` (roundCount + customs + ready ; **pas** de filtre catégories) + kill pick=launch | 04C |
| **04E** | Launch série live : sous-ensemble → queue snapshots, mutation atomique, projection 1ʳᵉ liste (**pas** de append consumed) | 04D |
| **04F** | Runtime multi-listes + **clear ALL `customLiveTierLists` à `series_end`** | 04E |
| **04G** | Lifecycle exit/replay/change-mode/clears de sécurité + isolation roster↔live + QA terrain | 04F |

Chaque ticket : tests automatisés §14 correspondants + pas de Git hors demande explicite.

---

## 14. Tests automatisés proposés

### 14.1 Domaine builder / 04B (obligatoires)

1. 0 custom + R=3 → 3 officielles distinctes ; length 3
2. 0 custom + R=5 → 5 officielles distinctes ; length 5
3. 0 custom + R=7 → 7 officielles distinctes ; length 7
4. C&lt;R (ex. 2 customs + R=5) → les **2** customs obligatoires + 3 officielles ; length 5
5. C=R (ex. 5 customs + R=5) → les 5 customs ; **aucune** officielle
6. C&gt;R (ex. 10 customs + R=5) → exactement 5 customs ; aucune officielle ; sélection parmi les 10
7. C ≫ R (ex. 20+ customs) → builder correct **sans** plafond global
8. Builder **ne mute pas** `customLiveTierLists` / inputs
9. Customs non sélectionnés restent dans la collection source (10 in → length result 5 ; source length reste 10)
10. Pool global insuffisant → **erreur métier** ; jamais sous-ensemble partiel
11. Aucun rejet « trop de customs » pour length 13 / 20 / …
12. Validations structurelles par entrée (name, items 4–16, blank, &gt;40, id `custom-live-`, `custom===true`, doublons items case/trim)
13. R=8 → invalide live
14. Liste uniquement dans `customTierLists` local → **hors** builder
15. `categoryIds` si exposé : seul `["*"]` OK ; autre → reject ; aucune taxonomie implicite
16. RNG injecté / shuffle déterministe → résultats testables
17. Plusieurs RNG sur C&lt;R → customs **jamais** évincés
18. `TIER_LISTS` original inchangé après build

### 14.2 Suite feature (04C+)

19. Upsert concurrent 2 auteurs → 2 entrées
20. Delete cross-author → reject
21. Validation serveur entry (structure + 4096) — **pas** de cap count
22. Delete custom post-launch → snapshot série intact
23. `series_end` → clear ALL customs ; snapshots/récap intactes
24. Reconnect mid-list → même runId / roundId / deck
25. Mode live↔roster : pas de pollution croisée
26. Non-régression `combinedGameDeck` + prep helpers (HT/Dilemma)

---

## 15. QA terrain future (min. 3 devices)

A. Contributions concurrentes (nombre libre)  
B. Ownership delete  
C. Ready / unready / force-start  
D. Launch : même sous-ensemble / même ordre items sur 3 devices  
E. Série liste1 → between → liste2  
F. Reconnect mid-list  
G. C&gt;R : customs non tirés restent visibles en prep/catalogue jusqu’à fin de série  
H. `series_end` : **tous** les customs disparus ; récap snapshot OK  
I. Change mode live ↔ roster  
J. Sortie anormale TierNight → clear sécurité  

Plateformes : 1 hôte + 2 invités ; ≥1 mobile.

---

## 16. Questions bloquantes restantes

**Aucun blocage restant** pour démarrer **04B**.

| Sujet | Arbitrage 04A (final) |
|-------|------------------------|
| Nom collection partagée | `customLiveTierLists` |
| Ledger consumed live | **Retiré** |
| Plafond nombre customs | **Aucun** (auteur ni lobby) |
| Lifecycle customs | KEEP pendant série ; **CLEAR ALL** à `series_end` |
| Non sélectionnés | Restent dans la collection jusqu’à `series_end` |
| Série | `tierNightLive.series` (`kind:"live"`) |
| Counts | Live `3/5/7` |
| Catégories V1 | Reportées ; `categoryIds:["*"]` only |
| Snapshot | `{ id, name, emoji, items, custom }` |
| Builder | Customs prioritaires ; `length === R` sinon erreur |
| RPC | Dédiées live ; clear ALL à fin de manche |
| Import `customTierLists` local | Hors scope |

---

## Critère de sortie 04A

Validé lorsque l’équipe accepte ce document comme contrat stable pour :

- schéma Supabase / RPC (§12)  
- builder + snapshots (§4.5, §7–8)  
- runtime série discriminé (§7)  
- lifecycle customs / clear `series_end` (§9)  
- catégories reportées (§4.4)

**Statut** : `FEATURE-TIERNIGHT-04A contract ready for 04B`

**Pas** de clôture FEATURE-TIERNIGHT-04 globale · **pas** de QA terrain · **pas** d’implémentation UI/runtime/SQL sous 04A · **04B non démarré** dans cette passe.
