# FEATURE-TIERNIGHT-03 — Étape C — Rapport

**Statut** : Étape C implémentée et tests automatisés verts.  
Le prep série est l’unique parcours roster lorsque la gate est activée.  
Gate production toujours OFF. Finalize/advance et UX intermanches encore non branchés.  
Étapes D à F et QA terrain restantes.

**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## 1. Cartographie avant / après

### Ancien parcours (pré-C, gate ON)

```
game-select → tiernight-select (modes)
  → roster → roster-path
       → single → topic grid → markTierNightClassicStarted
       → series → enterTierNightSeriesPrep (wizard category/count/review déjà mort)
```

### Nouveau parcours (gate ON)

```
game-select → tiernight-select (modes)
  → « Classe le groupe » → tiernight-prep → launch série → tiernight
  → Rank Live → list (inchangé)
```

### Gate OFF (rollback temporaire prod)

```
game-select → tiernight-select (modes)
  → roster → topic grid + create-roster + classic launch
  → Rank Live → list
```

### Legacy actif (session sans `series`)

- Hydrate / continue jusqu’au résultat : OK  
- Aucune queue synthétique  
- Rejouer / relancer hub → select ; sous gate ON, nouveau roster → prep

---

## 2. Gate

| | |
|--|--|
| **Nom** | `__REVEAL_TIERNIGHT_SERIES_UI__` (`TIER_NIGHT_SERIES_UI_GATE_KEY`) |
| **Lecture** | `isTierNightSeriesUiEnabled()` dans `js/core/tierNightSeriesGate.js` |
| **OFF** | Grille mono + classic (prod actuelle) |
| **ON** | Prep unique ; classic API bloquée ; wizard mort |
| **Activation finale** | Inverser gate + supprimer chemin OFF ; brancher D (finalize/advance/intermanches) |
| **Session** | État partagé prioritaire : série → série ; legacy actif → legacy ; sinon → gate |

---

## 3. Appels classic

| Appel | Statut | Justification |
|-------|--------|----------------|
| `markTierNightClassicStarted` (liveSession) | **Conservé** + garde `SERIES_GATE_BLOCKS_CLASSIC` sous gate ON | Lecture/écriture legacy gate OFF ; blocage nouvelle session gate ON |
| `startGame` → classic (select) | **Conservé** gate OFF only | Rollback prod |
| `startGame` roster sous gate ON | **Bloqué** → redirect prep + assertion | Interdit nouveau mono |
| `markTierNightSeriesStarted` | **Uniquement prep** | Plus dans select |
| Wizard `launchSeriesFromReview` | **Supprimé** | Remplacé par prep |

---

## 4. Wizard SERIES-04

| Élément | Statut | Raison |
|---------|--------|--------|
| `roster-path` / single / series UI | Supprimé | Remplacé par prep direct |
| `series-category` / `count` / `review` HTML + handlers | Supprimé | Morts ; prep = SoT |
| `LEGACY_SERIES_WIZARD_STEPS` | Conservé (redirect) | Params fantômes → prep sous gate ON |
| Helpers `tierNightSeriesSetup.js` | Conservés | Pool / validate / prep |
| Champs wizard dans merge prep | Strippés (`stripLegacySeriesWizardPrepFields`) | Pas de 2e SoT |

**SoT setup** : `tierNightSeriesPrep.categoryIds` / `roundCount` / `ready` / `setupEpoch` uniquement.

---

## 5. Navigation

### Pile logique (gate ON)

```
home → lobby → game-select → tiernight-select → tiernight-prep → (launch) tiernight
```

| Action | Comportement |
|--------|--------------|
| Back prep | Contrat setup existant (prep) |
| Quitter setup / restart | `launchTierNightSelect` → select (modes) ; roster → prep |
| create-roster legacy | `returnToTierNightSelectStep(topic)` → **prep** sous gate (pas grille) |
| Reprise partie active | `getEffectiveSessionScreen` / entry : phase série ou legacy → `tiernight` |
| Rank Live | Inchangé (`list` / create) |

Pas de cycle `select → prep → select → grille → prep`.

---

## 6. Legacy

| Cas | Comportement |
|-----|--------------|
| Hydrate sans `series` | Jouable (`getTierNightSeriesPrepEntryScreen` → `tiernight`) |
| Fin / résultat | Inchangé |
| Rejouer (gate ON) | Hub select puis roster → prep ; pas de classic |
| Nouvelle création mono | Interdite sous gate ON |

---

## 7. Sync

- Anciens champs wizard (`path`, `seriesSetup`, …) : ignorés au merge  
- `tierNightPrepFromRemote` : ne matérialise que le blob canonique  
- Phase série prioritaire dans `resolveActivePlayScreen`  
- Queue absente avant launch (contrat B/B1 inchangé)  
- `setupEpoch` / ready UID / consumed : non régressés  

---

## 8. Création de thèmes

- Gate ON : inline dans `tiernight-prep` uniquement  
- `tierNightCreateRoster` : classé **legacy/transitoire** (gate OFF) ; retour redirigé vers prep si gate ON  

---

## 9. Tests

### Suite dédiée

```bash
node --experimental-test-module-mocks --test tests/featureTierNight03c.test.js
```

### Périmètre demandé (extrait exécuté)

```bash
node --experimental-test-module-mocks --test \
  tests/featureTierNight03*.test.js \
  tests/featureTierNightSeries*.test.js \
  tests/tierNightBug0{3,4,5}.test.js \
  tests/uxTierNightNav01.test.js \
  tests/tierNightRestartRecap.test.js \
  tests/tierNightLive.test.js \
  tests/featureTierNight01*.test.js \
  tests/featureTierNight02*.test.js \
  tests/mpLaunchLaunch.test.js \
  tests/hotTakePodiumMp.test.js \
  tests/dilemmaSyncPending.test.js \
  tests/restartGameRollback.test.js
```

**Résultat périmètre** : **479 pass / 0 fail**

### `npm test` global

- TierNight 03 / SERIES / nav / bugs : verts  
- 03-C navigation : corrigé (navigate synchrone, plus de flaky dynamic-import-only)  
- Failures hors périmètre observées : `arch07CatchupResidual`, `mpRtCatchup`, `filRougeVague3Cleanup` (docs CSS) — non touchées par C  

Ajout dans `package.json` : `tests/featureTierNight03c.test.js`.

---

## 10. Fichiers touchés

- `js/screens/tierNightSelect.js` — parcours unifié  
- `js/core/tierNightNav.js` — return → prep sous gate  
- `js/core/tierNightSeriesGate.js` — doc OFF/ON  
- `js/core/tierNightLiveSession.js` — garde classic  
- `js/core/tierNightSeriesPrepContracts.js` — strip wizard  
- `js/core/gameSync.js` — priorité phase série ; commentaire prep fromRemote  
- `js/core/restartGame.js` — reset prep remote au hub  
- `js/screens/tierNightCreateRoster.js` — marque legacy  
- `tests/featureTierNight03c.test.js` — nouveau  
- `tests/featureTierNightSeries04.test.js` / `03b` — assertions alignées  
- `docs/FEATURE-TIERNIGHT-03-C.md` — ce rapport  

---

## 11. Hors scope (confirmé)

Pas d’activation gate prod · pas finalize/advance/intermanches · pas Rank Live métier · pas SQL · pas QA terrain · pas Git.
