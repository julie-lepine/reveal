# FEATURE-TIERNIGHT-SERIES-04 — Rapport

**Statut** : setup UI + launch série livrés · entrée UI **gatée OFF** · mono-thème inchangé · RPC finalize **non branchée**  
**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## 1. Verdict exécutif

Le setup et le lancement technique d’une série TierNight sont implémentés (catégories → 3/5/7 → récap → `prepare`/`markTierNightSeriesStarted`), derrière le gate local `__REVEAL_TIERNIGHT_SERIES_UI__` (défaut **false**). Le parcours mono-thème et Rank Live restent isolés. Aucune RPC de finalisation, aucun écran between, aucune transition de manche suivante.

---

## 2. Cartographie du select avant/après

| Zone | Avant | Après (gate OFF) | Après (gate ON) |
|------|-------|------------------|-----------------|
| `mountTierNightSelect` | `mode` → `topic` (roster) / `list` (live) | **Identique** | `mode` → `roster-path` → `topic` **ou** série |
| Étapes | `mode`, `topic`, `list` | inchangées | + `roster-path`, `series-category`, `series-count`, `series-review` |
| `startGame` | classic / live | inchangé | inchangé (mono) |
| Launch série | — | absent | `launchSeriesFromReview` → prepare + `markTierNightSeriesStarted` |
| Retour create-roster | `topic` / `roster` | inchangé | inchangé (pas de `roster-path`) |
| Customs | mono uniquement | inchangé | exclus des counts série |
| Invités | follow host | inchangé | recap lecture seule ; CTA launch hôte seul |

Risques NAV-01 / wipe / Rank Live : mitigés (un seul chevron via `backTargetForStep`, reset setup au retour modes, classic sans `series`, live reset séparé).

---

## 3. Machine d’étapes UI

```text
mode
  ├─ roster (+ gate) → roster-path
  │     ├─ single → topic → startGame (classic)
  │     └─ series → series-category → series-count → series-review → launchSeries
  └─ live → list → Rank Live (inchangé)

Retours :
  series-review → series-count
  series-count → series-category
  series-category → roster-path
  topic → roster-path (gate ON) | modes (gate OFF)
  roster-path → mode
```

Create-roster → `returnToTierNightSelectStep({ step: "topic", mode: "roster" })` (inchangé).

---

## 4. Gate interne retenu

| Élément | Valeur |
|---------|--------|
| Clé | `globalThis.__REVEAL_TIERNIGHT_SERIES_UI__` (`TIER_NIGHT_SERIES_UI_GATE_KEY`) |
| Défaut | **false** |
| Module | `js/core/tierNightSeriesGate.js` |
| Tests | `setTierNightSeriesUiEnabledForTests(true)` |
| Retrait prévu | SERIES-06 (flux complet jouable) |

Pas de feature flag distant. Gate OFF : étapes série refusées → fallback `mode`.

---

## 5. Contrat du setup temporaire

```js
{ path: null | "single" | "series", categoryIds: null | string[], roundCount: null | 3|5|7 }
```

- Local à `mountTierNightSelect` uniquement.
- **Non** sérialisé dans `game_sessions`.
- **Aucun** `runId` / queue tant que le launch n’est pas confirmé.
- Réinit au retour `tiernight-modes` et au changement de mode.
- Invalidation `roundCount` via `reconcileTierNightSeriesSetupAfterCategoryChange` (pas de clamp silencieux).
- Pas d’appel à `setTierNightTopicId` pendant le setup série.

---

## 6. Fonction de lancement série

| Couche | Symbole | Rôle |
|--------|---------|------|
| Pur | `prepareTierNightSeriesLaunchAttempt` | runId → queue → series → attempt |
| Pur | `buildTierNightSeriesLaunchPayload` | localGame + remote via SERIES-02 |
| Session | `markTierNightSeriesStarted({ attempt })` | host check, patch local, `launchGameWithSync`, rollback |

`markTierNightClassicStarted` **non** surchargé. Séparation claire `startGame` vs `launchSeriesFromReview`.

---

## 7. Ordre de génération runId/queue

```text
création runId final
→ buildTierNightSeriesQueue({ runId })
→ createTierNightSeriesState
→ payload (topic = queue[0] snapshot)
→ push session
```

`roundId = runId:roundIndex`. Tentative mémorisée (`seriesLaunchAttempt`) : retry timeout **sans** nouveau RNG.

---

## 8. Contrat du roster

- Figé une fois via `buildTierNightPlayerRoster(participants)` au `prepare` (hôte injecte `getLobbyParticipants()`).
- Identité = `userId` ; `displayName` = label snapshot.
- `items` = projection displayName du même roster (ordre identique).
- Pas de rebuild depuis membres actifs entre manches (hors scope gameplay, garanti à la création).
- Invité : **ne** appelle **pas** `prepare` ; suit le payload hôte.

---

## 9. Contrat du thème actif

Depuis `queue[0].topicSnapshot` uniquement :

- `topicId`, `listName`, `topicEmoji`
- Pas de re-résolution catalogue post-queue

---

## 10. Contrat du modificateur

V1 : **`normal` uniquement** (aligné UI classic actuelle : variantes retirées). Figé dans l’attempt / payload. Pas d’étape modificateur dédiée série.

---

## 11. Publication remote

- Local : `tierNightGame.series`
- Remote : `tierNight.series` via `withTierNightSeriesRemote` (SERIES-02)
- Full push : `runId`, `series`, `topicId`, snapshot, `playerRoster`, `items`, `placements={}`, `finished={}`, mode/modifier, `lobbyStarted=true`, `game=true`
- Classic : `tierNightToRemote` **sans** `series` → clé absente (pas de série stale)
- Live : blob `tierNightLive` séparé + reset classic sans série

---

## 12. Gestion des erreurs et retries

- CTA désactivé / « Lancement… » via `runLaunchButton`
- Flag `seriesLaunching` anti double-clic
- `catch` + rollback local si push échoue
- Échec clair → `seriesLaunchAttempt = null` (nouvelle queue autorisée)
- Échec `uncertain` (timeout) → **conserve** l’attempt (même queue / runId)
- Pas de `void` silencieux sur le chemin launch (alerts + returns)

---

## 13. Comportement invités

- Pas de bouton launch (hint « En attente de l’hôte »)
- `ensureHost` / `markTierNightSeriesStarted` bloquent non-hôte en MP
- Aucune construction de queue côté invité
- Follow session inchangé (`prepGuestFollowOnSession`)

---

## 14. Compatibilité mono-thème

```text
path single → topic → startGame → markTierNightClassicStarted
path series → … → markTierNightSeriesStarted
```

Aucune conversion mono → série 1 manche. Scoring / end / restart legacy inchangés.

---

## 15. Compatibilité customs

- Mono : create-roster + liste customs inchangés
- Série : counts via helpers SERIES-01 (customs / `enabled=false` exclus)
- UI V1 : une catégorie **ou** toutes ; pas de composition thème-par-thème

---

## 16. Compatibilité Rank Live

- Choix Mono/Série uniquement sous `Classe le groupe` (+ gate)
- Live : `mode` → `list` inchangé
- Launch série / classic reset `tierNightLiveGame` / remote live done
- Tests Live + BUG-05 verts

---

## 17. Fichiers modifiés

| Fichier | Action |
|---------|--------|
| `js/core/tierNightSeriesGate.js` | **Créé** — gate UI |
| `js/core/tierNightSeriesSetup.js` | **Créé** — setup temporaire pur |
| `js/core/tierNightSeriesLaunch.js` | **Créé** — prepare + payload purs |
| `js/core/tierNightLiveSession.js` | `markTierNightSeriesStarted` + re-export prepare |
| `js/screens/tierNightSelect.js` | Machine d’étapes + launch gaté |
| `tests/featureTierNightSeries04.test.js` | **Créé** |
| `tests/uxTierNightNav01.test.js` | Alignement `backTargetForStep()` |
| `package.json` | Suite SERIES-04 |
| `docs/FEATURE-TIERNIGHT-SERIES-04.md` | Ce rapport |

---

## 18. Tests ajoutés

`tests/featureTierNightSeries04.test.js` :

- Gate défaut OFF / activable tests / select derrière gate
- Setup : empty, counts, 3/5/7 survival, invalidate count, validate pool
- Prepare : runId final sur tous `roundId`, queue unique, phase ranking, ledgers vides, topic=queue[0]
- Payload remote `series`, retry même attempt
- Roster vide → erreur
- Non-branchement finalize (source scan)
- Mono vs series paths séparés ; create-roster → topic

---

## 19. Résultats ciblés

| Suite | Résultat |
|-------|----------|
| `featureTierNightSeries04` | **pass** |
| `uxTierNightNav01` | **pass** |
| SERIES-01 → 03B | **pass** |
| Scoring + consensus | **pass** |
| BUG-03/04/05 | **pass** |
| FEATURE-TIERNIGHT-01/02 | **pass** |
| Rank Live | **pass** |
| restart recap + rollback | **pass** |
| `mpLaunch` | **pass** |
| `uxTierNightEnd01` | **pass** |

Agrégat ciblé (hors baseline connue) : **263 pass / 0 fail**.

---

## 20. Résultat global

Ticket SERIES-04 **acceptable** au sens des critères §19 du brief : setup + launch présents, gate OFF, mono isolé, queue une fois / runId final, roster figé, customs exclus, pool insuffisant bloqué, invités sans RNG, finalize non branchée, Rank Live OK, **aucun Git**.

---

## 21. Baselines et régressions

| Item | Statut |
|------|--------|
| `mpLaunchLaunch.test.js` | **Baseline préexistante** : mock ESM casse l’export `DEFAULT_SYNC_PATCH_TIMEOUT_MS` de `gameSync` — **hors** diff SERIES-04 |
| Autres suites listées §19 | vertes |

---

## 22. Limites restantes avant série jouable

- Fin de manche 1 non branchée (RPC / advance)
- Pas d’écran `tiernight-between`
- Pas de transition manche suivante / end série
- Pas de routing phase-aware / reprise between
- Gate UI toujours OFF (volontaire)

---

## 23. Proposition précise de SERIES-05

**SERIES-05 — Brancher la finalisation de manche série sur le board**

1. Depuis `advanceTierNightToResultsWhenReady` / chemin board : si `tierNightGame.series` actif → `commitTierNightSeriesRoundResult` (SERIES-03) au lieu du scoring legacy.
2. Appliquer le payload RPC (phase `between_rounds` ou `series_end`, ledgers, scores).
3. Gardes : host-only, anti double-commit `scoredRoundIds`, placements/finished stricts.
4. **Ne pas** encore monter l’UI between (SERIES-06) : après finalize, écran tampon minimal ou stay ranking bloqué documenté + gate toujours OFF jusqu’à 06.
5. Tests : finalize depuis état play réel, non-régression mono `tiernight-end`.

---

## 24. Confirmation — entrée série gatée

Oui. `isTierNightSeriesUiEnabled()` lit uniquement `globalThis.__REVEAL_TIERNIGHT_SERIES_UI__ === true`. Défaut false → pas d’entrée publique.

---

## 25. Confirmation — aucune RPC de finalisation branchée

Oui. Aucune occurrence de `commitTierNightSeriesRoundResult` / `finalize_tiernight_series_round` dans select, board, gameSync advance, end, launch, liveSession.

---

## 26. Confirmation — aucune opération Git

Oui. Aucun `git add` / `commit` / `push` / branche effectué pour ce ticket.
