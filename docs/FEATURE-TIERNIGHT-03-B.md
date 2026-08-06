# FEATURE-TIERNIGHT-03 — Étape B — Rapport

**Statut** : Étape B implémentée et tests verts. Gate série toujours OFF. Étapes C à F restantes. QA terrain non réalisée.  
**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## Architecture retenue

- Écran dédié `tiernight-prep` (modèle UX Hot Take), derrière le gate série existant.
- Settings + ready dans `tierNightSeriesPrep` / remote `tierNightPrep` — **pas de queue**.
- Queue + `runId` + `roundIndex=0` + `phase=ranking` uniquement dans `markTierNightSeriesPrepStarted` → `prepareTierNightSeriesLaunchAttempt` → `markTierNightSeriesStarted`.
- One-shot : `consumedCustomRosterTopicIds` (source de vérité) ; `excludeCustomIds` dérivé ; merge **uniquement après launch OK**.
- Ancien wizard local (category/count/review) conservé dans le fichier select mais **non emprunté** : le chemin série gate ON ouvre le prep.

---

## Fichiers modifiés / créés

| Fichier | Rôle |
|---------|------|
| `js/screens/tierNightPrep.js` | **Nouveau** — UI prep |
| `js/core/tierNightSeriesPrepSession.js` | Session prep + launch + one-shot |
| `js/core/tierNightSeriesDuration.js` | Estimation durée 3/5/8 |
| `js/core/state.js` | `tierNightSeriesPrep`, `consumedCustomRosterTopicIds` |
| `js/core/gameSync.js` | Codec / hydrate / merge / setup screens |
| `js/screens/tierNightSelect.js` | Route série → `enterTierNightSeriesPrep` |
| `js/core/tierNightNav.js` | Back stack ignore `tiernight-prep` |
| `js/core/restartGame.js` | Reset prep à l’entrée TierNight |
| `js/main.js` | `registerScreen("tiernight-prep")` |
| `tests/featureTierNight03b.test.js` | Suite étape B |
| `package.json` | Inclut le test 03b |
| `docs/FEATURE-TIERNIGHT-03-B.md` | Ce rapport |

---

## Helpers réutilisés

- `prepScreen.js` (draft, ready card, launch slot, char counter)
- `prepLaunch.js` / `executePrepLaunch` (anti-double-clic via lock)
- `createPrepLobbyController` / `commitPrepReadyToggle`
- `prepGuestFollowOnSession` / `mpLaunch`
- Helpers étape A : pool, counts, validate, prepare launch, merge consumed

**Non partagé** : deck builder Hot Take.

---

## Contrat prep

| Champ local | Remote | Notes |
|-------------|--------|-------|
| `tierNightSeriesPrep.categoryIds` | `tierNightPrep.categoryIds` | `["*"]` XOR explicites |
| `tierNightSeriesPrep.roundCount` | idem | `3\|5\|8` ou `null` si pool insuffisant |
| `tierNightSeriesPrep.ready` | ready par **uid** remote | noms en local |
| `consumedCustomRosterTopicIds` | même clé | lobby lifetime ; clear soirée |

Queue **absente** du blob prep.

---

## Synchronisation

- Hôte : patch settings (`categoryIds` / `roundCount`) + screen `tiernight-prep`.
- Ready : `commitPrepReadyToggle` (UID, optimistic + rollback).
- Merge remote ready via `mergeRemoteReadyUid`.
- Guests : follow select → prep → board via `getEffectiveSessionScreen` / entry screen.

---

## Launch

1. Validate setup (3/5/8 + pool).
2. Filter roster (`rosterNames` force-start).
3. `prepareTierNightSeriesLaunchAttempt` (queue one-shot en mémoire).
4. `markTierNightSeriesStarted` (publish).
5. Si OK → merge consumed + reset prep.
6. Si KO / rollback → **aucun** consume.

---

## One-shot

- Jamais au clic custom, avant confirm, après rollback, ni callback stale.
- `excludeCustomIds = consumedCustomRosterTopicIds`.

---

## UX

- Chips catégories : Tout / Survie / Social / Chaos.
- Counts : 3 / 5 / 8 (disabled si pool < n).
- Customs inline + draft/focus (pattern Hot Take / WAO).
- Ready + launch hôte.

---

## Tests

`tests/featureTierNight03b.test.js` — **19 pass / 0 fail**  
Régression ciblée A / A1 / A1-bis / SERIES-04 / NAV : à vérifier dans la même passe.

---

## Risques restants

- Gate OFF → prep non jouable en terrain tant que C n’active pas le parcours.
- Finalize / advance / intermanches non branchés (étapes D+).
- `lobbyStarted` local série encore surtout via remote hydrate (entry keye sur `series.phase`).
- QA terrain (reload hôte/invité, foreground, launch pendant absence) non réalisée.
- Wizard select encore présent (code mort sur chemin série) — nettoyage étape C/E.

---

## Statut maximal

**Étape B implémentée et tests verts.  
Gate série toujours OFF.  
Étapes C à F restantes.  
QA terrain non réalisée.**
