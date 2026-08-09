# FEATURE-TIERNIGHT-04D — Prep UI Rank Live (série)

**Statut** : `FEATURE-TIERNIGHT-04D implementation complete — ready for 04E review`  
**Date** : 2026-08-09  
**Git** : aucune opération Git  
**Contrats figés** : [04A](./FEATURE-TIERNIGHT-04A.md) · [04B](./FEATURE-TIERNIGHT-04B.md) · [04C](./FEATURE-TIERNIGHT-04C.md)

---

## Ancien vs nouveau flow

| Avant | Après (04D) |
|-------|-------------|
| `tiernight-select` → mode live → `step=list` → pick / « Créer et jouer » → `markTierNightLiveLobbyStarted` (mono) | `tiernight-select` → mode live → **`tiernight-live-prep`** |
| Create = launch mono | Create depuis prep = **contribute** (`from=live-prep`) → `addCustomLiveTierListAndSync` → retour prep |
| Launch = mono lobby started | Launch CTA = **stub 04E** (aucune série / writable / mono) |

Legacy mono (`markTierNightLiveLobbyStarted`, formulaire « Créer et jouer ») **reste** pour compat hors `from=live-prep`. Aucune **route** depuis le nouveau parcours.

---

## State

| Couche | Clé | Rôle |
|--------|-----|------|
| Local | `tierNightLiveSeriesPrep` | settings + ready + setupEpoch |
| Remote | `tierNightLivePrep` | même codec ready que roster (`tierNightPrepToRemote` / `FromRemote`) |
| Customs | `customLiveTierLists` (04C) | collection partagée ; create/delete via RPC session helpers |

**Pas de bleed** : hydrate `tierNightLivePrep` → `tierNightLiveSeriesPrep` uniquement ; `tierNightPrep` / `tierNightSeriesPrep` inchangés.

Counts : **3 / 5 / 7**, défaut **5**. Aucune UI catégories (`categoryIds: ["*"]` wire only).

---

## setupEpoch / Ready

- Host change **roundCount** → **une** mutation : `roundCount` + `ready: {}` + `setupEpoch++` (local `saveStatePatch` + un `patchGameState` remote).
- Pattern miroir roster (atomicité logique Realtime).
- Ready **ne verrouille pas** create/delete.
- Create/delete customs **ne bumpent pas** setupEpoch et **ne clearent pas** Ready.

---

## Customs UI

Tous voient : **emoji + name + author + item count** (pas le contenu items).  
Delete bouton : **own only** via `authorUid` (`isCustomLiveTierListOwnedBy`).  
Sécurité réelle = RPC UID (04C) — l’absence de bouton n’est pas la sécurité.

---

## Launch (évolué en 04E)

04D livrait un stub CTA. **04E** remplace ce stub par le launch atomique — voir [FEATURE-TIERNIGHT-04E](./FEATURE-TIERNIGHT-04E.md).

---

## Lifecycle

Reset **local** `tierNightLiveSeriesPrep` : `enter(resetSettings)`, retour select depuis live-prep, `resetEveningState`, `resetGameSessionsOnly`.  
**Ne clear pas** `customLiveTierLists` remote en naviguant select (contrat 04C / manche).

---

## Shared helpers

- Réutilise `executePrepLaunch`, `commitPrepReadyToggle`, `prepScreen`, `usePrepLobby` via **callbacks** — **pas** de `if (live)` dans `mpLaunch` / `prepLaunch`.
- Codec ready : `tierNightPrepToRemote` / `FromRemote` (blast radius inchangé pour roster).

---

## Tests

- `tests/featureTierNight04d.test.js` intégré à `package.json` `test`.
- Résultat local gate : **31 / 31 pass** (14 suites).
- Non-régression ciblée (04B/C/D, TN01–03, series01, prep, mpLaunch, sessionMerge, nav, hotTake vote, dilemma multi) : **431 / 431 pass**.
- Couvre nav, epoch atomique, ready A–G, customs ownership, contribute, stub UX, lifecycle, non-bypass mono.

---

## Dettes 04E (hors scope 04D)

04E doit lancer en **une** opération canonique :

1. lock `game_session`
2. relire `tierNightLivePrep` + `customLiveTierLists` canoniques
3. valider `roundCount`
4. builder sous-ensemble
5. snapshots
6. créer `tierNightLive.series`
7. projeter première liste
8. `customLiveTierListsWritable=false`
9. **commit unique**

04D n’effectue **aucune** partie de cette mutation.
