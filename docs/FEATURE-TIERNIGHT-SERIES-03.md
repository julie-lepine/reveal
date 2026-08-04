# FEATURE-TIERNIGHT-SERIES-03 — Rapport

**Statut** : RPC transactionnelle + wrapper JS livrés · **non branchés** à l’UX série · SQL **non appliqué** en prod par l’agent  
**Date** : 2026-08-04  
**Git** : aucune opération Git effectuée dans ce ticket

---

## 1. Verdict exécutif

La finalisation de manche série TierNight dispose désormais d’une frontière serveur atomique :

- RPC `finalize_tiernight_series_round` (Option A : calcul serveur depuis placements + roster) ;
- verrou `FOR UPDATE` sur `game_sessions` ;
- scoring + ledger `scoredRoundIds` + `roundRecap` / `roundHistory` + phase `between_rounds` | `series_end` dans **une seule** transaction ;
- retry → `applied: false` / `ALREADY_APPLIED` (succès idempotent) ;
- `tierNightsPlayed` uniquement sur dernière manche ;
- wrapper `commitTierNightSeriesRoundResult` sans `addScore` / sans mutation locale ;
- **aucun** parcours série accessible ; mono-thème / Rank Live / customs inchangés côté gameplay.

Le ticket reste ouvert jusqu’à exécution SQL manuelle (runbook §24) + smoke Supabase.

---

## 2. Audit du scoring actuel

### Chaîne mono-thème (inchangée)

| Étape | Où | Quoi |
|-------|-----|------|
| Placements | `tierNight.placements[uid]` + `finished[uid]` | Guest contribute / hôte |
| Déclencheur fin | `advanceTierNightToResultsWhenReady` | Hôte local uniquement (`isLobbyHost`) |
| Calcul recap | `buildRecapsFromPlacements` / `ensureTierNightRecapsFromRemote` | Consensus médian, proximité, outsider |
| Scoring local | `applyTierNightRoundScores` | `addScore(name)`, `bumpPlayerStat(…, tierConsensusPoints)`, `tierNightsPlayed +1` **par partie** via `scoresApplied` |
| Publication | `patchGameState({ tierNight: {…, recap} }, { screen: tiernight-end, withEveningScores: true })` | Merge shallow + evening blob |

### Ordre exact (legacy)

1. Calcul / hydratation recaps locaux  
2. `applyTierNightRoundScores` (mutation locale `state.scores` par **display name**)  
3. Patch remote `tierNight.recap` + `lobbyStarted: false`  
4. `withEveningScores` → `eveningStateToRemote()` mappe names → **UID** dans `scores` / `playerStats` / `gameScores`

### Force results (UI actuelle)

`forceResults()` → `advanceTierNightToResultsWhenReady(list, { force: true })` : au moins un `finished` ; calcule avec les placements disponibles côté client ; **pas** de RPC série.

### Risques démontrés (SERIES-00/01)

- double observation « non scorée » avant patch ;
- pas de CAS sur `updateGameSession` ;
- ledger JSON seul insuffisant ;
- timeout → incertitude client.

---

## 3. Stockage canonique des scores et statistiques

| Donnée | Stockage | Clé | Type | Écriture actuelle | Transactionnel PG ? | Merge actuel | Lost update |
|--------|----------|-----|------|-------------------|---------------------|--------------|-------------|
| Scores soirée | `game_sessions.state.scores` | **UID** remote / name local | number | hôte via `withEveningScores` | oui si RPC | shallow replace clés | **oui** hors RPC |
| Stats joueur | `state.playerStats` | UID remote | object | idem | oui si RPC | merge par UID | oui |
| Points jeu | `state.gameScores.tiernight` | UID | number | idem | oui si RPC | shallow | oui |
| Compteur soirée | `state.stats.tierNightsPlayed` | scalaire | number | `recordTierNightPlayed` / bump | oui si RPC | overwrite | oui |
| Flag soirée | `eveningGamesRecorded.tiernight` | bool | bool | `recordEveningGameOnce` | oui si RPC | set | idempotence locale faible |
| Recap TN | `tierNight.recap` | blob | object | hôte patch | oui si RPC | shallow tierNight | oui |
| Ledger série | `tierNight.series.scoredRoundIds` | array string | JSON | **nouveau** RPC | **même UPDATE** | append | protégé par `FOR UPDATE` + check |

**Série (RPC)** : écriture directe en **clés UID** (alignée `eveningStateToRemote`), sans passer par `addScore`.

---

## 4. Comparaison calcul serveur / payload hôte

| | Option A (serveur) | Option B (payload hôte) |
|--|--------------------|-------------------------|
| Source | placements + roster + items persistés | recap / deltas client |
| Falsification | difficile | exige validation forte |
| Retry | déterministe | dépend du payload |
| Coût | portage consensus/égalités en SQL | validations multiples |
| Divergence JS/SQL | risque de drift | risque de trust |

---

## 5. Architecture retenue

**Option A** — calcul serveur.

Justification : le barème (médiane par item, proximité, outsider ±15, reverse) est borné et déjà purement fonctionnel côté JS ; le dupliquer en helpers SQL immutables évite d’accepter un `scoreDeltas` hôte. Aucun payload de points n’est accepté.

Helpers SQL : `tiernight_series_tier_rank`, `rank_to_tier`, `points_for_diff`, `median_rank`, `tier_of_item`, `placement_item_count`.

---

## 6. Contrat RPC final

```text
finalize_tiernight_series_round(
  p_lobby_id uuid,
  p_run_id text,
  p_round_id text,
  p_round_index int,
  p_expected_phase text default 'ranking',
  p_force boolean default false
) → jsonb
```

**Succès appliqué** : `{ ok: true, applied: true, phase, roundRecap, state, … }`  
**Succès idempotent** : `{ ok: true, applied: false, code: 'ALREADY_APPLIED', … }`  
**Erreur** : `raise exception 'TNS_*'`

Non envoyés : queue complète, nouveau roundId, index futur, blob `tierNight` entier, deltas de score.

---

## 7. Contrat d’autorisation

| Règle | Implémentation |
|-------|----------------|
| Identité | `auth.uid()` uniquement |
| Membre | `assert_lobby_member(p_lobby_id)` |
| Acteur | `is_lobby_host OR is_acting_host` (même pattern que `complete_game_session_as_actor`) |
| Client UID libre | **refusé** |

Acting host autorisé dès ce ticket (helpers ARCH-03 déjà en prod SQL). Évolution future = changer uniquement le prédicat acteur, pas la transaction métier.

---

## 8. Préconditions transactionnelles

Après `SELECT … FOR UPDATE` :

1. session existe (`lobby_id`)  
2. membre lobby  
3. `game_id = tiernight`  
4. `tierNight.series` objet  
5. `series.version = 1`  
6. `tierNight.runId = p_run_id`  
7. `series.roundIndex = p_round_index`  
8. `queue[index].roundId = p_round_id`  
9. phase = `ranking` (et `p_expected_phase` cohérent)  
10. entrée queue présente  
11. roster + items non vides  
12. `roundId ∉ scoredRoundIds` (sinon ALREADY_APPLIED)  
13. finished/placements complets **ou** force avec ≥1 finished  
14. pas de finalisation d’index hors queue  
15. pas déjà `series_end` (sauf idempotence ledger)

---

## 9. Stratégie de verrouillage et concurrence

| Preuve | Détail |
|--------|--------|
| Verrou | `select * from game_sessions where lobby_id = … for update` |
| Transaction | corps PL/pgSQL = une transaction implicite |
| Sérialisation | 2e appel concurrent attend le unlock puis voit le ledger → `ALREADY_APPLIED` |
| Test auto Node | contrat SQL statique (`FOR UPDATE`, `ALREADY_APPLIED`) |
| Test réel concurrent | runbook smoke §D (manuel Supabase) |

---

## 10. Stratégie d’idempotence

| Cas | Comportement |
|-----|--------------|
| Premier OK | calcule, score, ledger, recap, phase → `applied: true` |
| Retry même roundId déjà dans ledger | **aucune** écriture score ; retour état courant → `ALREADY_APPLIED` |
| Stale / contradictoire | exception `TNS_*` ; rollback |

Côté wrapper : `ALREADY_APPLIED` → `ok: true`, `applied: false` (pas d’erreur terminale).

---

## 11. Atomicité score / ledger / recap / phase

**Preuve** : un seul `UPDATE game_sessions SET state = v_state, screen = …` après construction complète de `v_state` (scores + playerStats + gameScores + stats + `tierNight.series` avec phase, scoredRoundIds, roundHistory, roundRecap).

Invariants impossibles en commit partiel (même transaction) :

- score sans ledger  
- ledger sans score (si points > 0 pour participants)  
- phase avancée sans `roundRecap`  
- `tierNightsPlayed` sans `series_end`

---

## 12. Contrat force results

| Règle | Comportement RPC |
|-------|------------------|
| Indicateur | `p_force` |
| Droit | même acteur hôte / acting host |
| Précond | `finished_count ≥ 1` sinon `TNS_FORCE_NO_FINISHED` |
| Scoring | **uniquement** UIDs roster avec placement non vide ; pas d’invention de placements |
| Phase | `between_rounds` si non dernière ; `series_end` si dernière |
| Queue | non altérée (pas de skip vers fin de série) |
| UI | bouton force **non modifié** |

---

## 13. Contrat recap et historique

| Champ | Rôle |
|-------|------|
| `series.roundRecap` | recap courant de la manche finalisée |
| `series.roundHistory[]` | historique compact append-only |
| Entrée | `roundId`, `roundIndex`, `topicId`, `topicSnapshot`, `recaps`, `consensus`, outsider meta, `forced`, `scoredAt`, `scoresApplied` |
| Dernière manche | copie aussi `tierNight.recap` (compat écran end) |

Une seule structure de vérité par manche dans `roundHistory` ; `roundRecap` = pointeur courant (même objet logique).

---

## 14. Gestion de `tierNightsPlayed`

| Manche | Effet |
|--------|-------|
| Non finale | **pas** d’incrément |
| Dernière (`roundIndex >= roundCount - 1`) | `stats.tierNightsPlayed +1` + `playerStats[uid].tierNightsPlayed +1` pour tout le roster + `eveningGamesRecorded.tiernight = true` |
| Retry dernière | ledger → pas de ré-incrément |

`tierConsensusPoints` : +points **par manche** (sémantique cumulée conservée).

---

## 15. Wrapper JavaScript

Fichier : `js/core/tierNightSeriesFinalize.js`

- `commitTierNightSeriesRoundResult` → RPC + `withPatchTimeout`  
- **aucun** `addScore` / scoring local / optimistic scores  
- distingue : applied / ALREADY_APPLIED / stale / unauthorized / validation / timeout+network  
- timeout → `ok: false`, `timeout: true` (réconciliation possible par refresh session)  
- **non importé** par `advanceTierNightToResultsWhenReady` / select / end

---

## 16. Fichiers JavaScript modifiés

| Fichier | Action |
|---------|--------|
| `js/core/tierNightSeriesFinalize.js` | **créé** |
| `tests/featureTierNightSeries03.test.js` | **créé** |
| `package.json` | ajout test + fix virgule JSON |

Aucun changement de `tierNightSession.js`, `tierNight.js`, `gameSync` gameplay scoring.

---

## 17. Fichiers SQL ajoutés

| Fichier | Rôle |
|---------|------|
| `supabase/feature-tiernight-series-03-finalize-round.sql` | migration idempotente (`CREATE OR REPLACE`) |
| `supabase/feature-tiernight-series-03-smoke-checklist.sql` | runbook smoke manuel |

---

## 18. Sécurité SQL

| Contrôle | Statut |
|----------|--------|
| `SECURITY DEFINER` | oui (écriture session + helpers actor) |
| `search_path` | `pg_catalog, public` fixé |
| `GRANT EXECUTE` | `authenticated` only ; `REVOKE ALL … FROM public` |
| Helpers scoring | `REVOKE ALL FROM public` |
| `auth.uid()` | obligatoire |
| Cible session | uniquement `p_lobby_id` membre + verrouillé |
| Scores | UIDs dérivés du roster snapshoté uniquement |
| runId | doit matcher `tierNight.runId` stocké |
| SQL dynamique | aucun |
| Anonyme | `TNS_AUTH_REQUIRED` |
| Messages | codes `TNS_*` sans dump sensible hors state déjà accessible membre |

---

## 19. Tests SQL

| # | Scénario | Auto Node | Manuel Supabase |
|---|----------|-----------|-----------------|
| 1 | session inexistante | contrat codes | smoke B1 |
| 2 | acteur non autorisé | — | B2 |
| 3 | mono sans série | contrat `TNS_NO_SERIES` | B3 |
| 4 | série invalide | — | B4 |
| 5–8 | stale run/id/index/phase | parsing + SQL texte | B5–B8 |
| 9 | placements incomplets | — | B9 |
| 10–15 | apply + ledger + scores + recap + phases | SQL texte | C1 |
| 16 | tierNightsPlayed fin | SQL texte | C4–C5 |
| 17–18 | retry / autre payload | wrapper + smoke | C2–C3 |
| 19 | concurrent | SQL `FOR UPDATE` | D1–D2 |
| 20 | ancienne manche | — | D3 |
| 21–22 | UID/points arbitraires | N/A (Option A : pas de payload) | — |
| 23 | force | SQL `p_force` | E1 |
| 24 | double attribution | idempotence | C2 + D1 |

---

## 20. Tests JavaScript

Fichier `tests/featureTierNightSeries03.test.js` :

- mapping args RPC  
- parse codes  
- applied / ALREADY_APPLIED / stale / unauthorized / validation  
- timeout (`trop longue`) sans mutation  
- non-branchement `advanceTierNight` / select / end  
- pas d’import `addScore`  
- contrat SQL (FOR UPDATE, ledger, phases, acting host)

---

## 21. Résultats des tests ciblés

Commande :

```text
node --experimental-test-module-mocks --test
  tests/featureTierNightSeries03.test.js
  tests/featureTierNightSeries01.test.js
  tests/featureTierNightSeries02.test.js
```

| Métrique | Valeur |
|----------|--------|
| tests | 55 |
| pass | **55** |
| fail | **0** |

SERIES-03 seul : **12** pass / 0 fail (après correctifs timeout + assertion `addScore`).

---

## 22. Résultat de la suite globale

Non-régression TierNight ciblée (254 tests) :

```text
SERIES-01/02/03 + scoring + consensus + BUG-03/04/05 + restart recap
+ FEATURE-01/02 + Rank Live + UX end/nav + evening bars + acting host
+ restart rollback + arch04 banner
```

| Métrique | Valeur |
|----------|--------|
| tests | 254 |
| pass | **254** |
| fail | **0** |

`package.json` était momentanément invalide (virgule manquante après SERIES-03) — **corrigé**. La suite npm complète peut être relancée localement ; non rejouée intégralement ici après le fix (périmètre ticket = ciblé + TierNight).

---

## 23. Baselines et régressions

| Baseline | Résultat |
|----------|----------|
| SERIES-01 | pass (inchangé) |
| SERIES-02 | pass (inchangé) |
| scoring / consensus / BUG-03/04/05 | pass |
| restart recap | pass |
| FEATURE-TIERNIGHT-01/02 | pass |
| Rank Live | pass |
| evening scoring bars | pass |
| acting host notice | pass |
| restart rollback | pass |
| **Nouvelles régressions** | **0** |

---

## 24. Runbook SQL exact

1. **Fichier** : `supabase/feature-tiernight-series-03-finalize-round.sql`  
2. **Ordre** : après `game-sessions.sql` + `game-sessions-i08-arch03.sql` (helpers actor) ; indépendant des customs TN-02 ; logique série côté JSON déjà définie SERIES-01/02 client.  
3. **Projet** : projet Supabase de staging/prod REVEAL (celui déjà utilisé pour les RPC trivia / acting host).  
4. **Exécution** : coller/exécuter le fichier dans SQL Editor (ou CLI `psql`) **une fois**.  
5. **Vérif** : ouvrir `supabase/feature-tiernight-series-03-smoke-checklist.sql` sections A puis B–F.  
6. **Attendu A1** : fonction présente, `prosecdef = true`.  
7. **Double exécution SQL** : `CREATE OR REPLACE` → no-op fonctionnel (idempotent).  
8. **Rollback manuel** : `drop function public.finalize_tiernight_series_round(uuid, text, text, int, text, boolean);` (+ helpers `tiernight_series_*` si besoin). Les sessions déjà scorées conservent leur JSON.  
9. **Dépendances** : `assert_lobby_member`, `is_lobby_host`, `is_acting_host`.

**Confirmation agent** : la migration **n’a pas** été exécutée sur un projet distant dans ce ticket.

---

## 25. Limites ou dettes restantes

- Drift potentiel JS ↔ SQL sur détails d’égalités médiane / ordre d’items controversés (à figer par golden tests SQL plus tard).  
- Screen `tiernight-end` posé dès `series_end` (pratique pour fin) ; écran `between_rounds` UX **absent**.  
- Wrapper non hydratant automatiquement le state local après succès (futur branchement).  
- Concurrence réelle non prouvée en CI (smoke manuel).  
- Mono-thème continue d’utiliser `addScore` local (voulu).  
- Acting host UI force/série non branchée.

---

## 26. Proposition du ticket suivant

**FEATURE-TIERNIGHT-SERIES-04** — brancher la finalisation série :

- appeler `commitTierNightSeriesRoundResult` depuis un chemin série **uniquement** (feature-flag / phase série) ;
- garder mono-thème sur `advanceTierNightToResultsWhenReady` ;
- introduire écran / phase `between_rounds` (sans « manche suivante » complète si découpé) ;
- ou ticket UX pack catégories 3/5/7 selon priorité produit.

Alternative plus petite : **SERIES-03b** = golden tests SQL automatisés contre Postgres local + alignement score byte-à-byte avec fixtures JS.

---

## 27. Confirmation que la RPC n’est pas encore branchée au parcours produit

- Grep : `commitTierNightSeriesRoundResult` / `tierNightSeriesFinalize` **uniquement** dans le module wrapper + tests.  
- `advanceTierNightToResultsWhenReady` inchangé (toujours `patchGameState` + `withEveningScores`).  
- Select / end / force UI non modifiés.  
- Test statique SERIES-03 « wrapper non branché » : **pass**.

---

## 28. Confirmation qu’aucune opération Git n’a été effectuée

Aucune commande `git add` / `commit` / `push` / `checkout` / etc. n’a été exécutée pour ce ticket.
