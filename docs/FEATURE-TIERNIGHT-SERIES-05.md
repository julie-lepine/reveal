# FEATURE-TIERNIGHT-SERIES-05 — Rapport

**Statut** : RPC `advance_tiernight_series_round` + wrapper JS livrés · **non branchés** · gate OFF · SQL non appliqué automatiquement  
**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## 1. Verdict exécutif

La transition `between_rounds → ranking` est désormais une **RPC transactionnelle** (`FOR UPDATE`, host∨AH, idempotente `ALREADY_ADVANCED`), avec wrapper JS `commitTierNightSeriesNextRound` non branché. Aucun scoring, queue/roster/items/ledgers/historique immuables, thème suivant lu uniquement depuis la queue verrouillée. Le gate UI série reste OFF. Aucun Git.

---

## 2. Audit de la transition actuelle

| Élément | Constat | Réutilisation |
|---------|---------|---------------|
| `computeNextTierNightRoundState` | Oracle pur between→ranking | Alignement tests / contrat métier |
| `validateTierNightSeries` / SQL `tiernight_series_validate_series_shape` | Shape + ledgers + history | **Réutilisé** (pas de 2ᵉ validateur) |
| `mergeTierNightRemoteBlob` / `withTierNightSeriesRemote` | Hydrate/merge client | Non dupliqué ; RPC écrit un blob cohérent |
| `finalize_tiernight_series_round` | Skelette auth/lock/idempotence/grants | **Template** de l’advance |
| `commitTierNightSeriesRoundResult` | Timeout, parse TNS_*, pas d’optimistic | **Cloné** en `tierNightSeriesAdvance.js` |
| `patchGameState` | Non atomique pour multi-champs corrélés | **Évité** pour cette transition |
| Acting host | `is_lobby_host` ∨ `is_acting_host` | Réutilisé |

**Duplications évitées** : scoring, rebuild queue/RNG, rebuild roster, 2ᵉ shape validator, nonce client arbitraire.

---

## 3. Architecture transactionnelle retenue

```text
client (futur) → commitTierNightSeriesNextRound(ids only)
                 → RPC advance_tiernight_series_round
                    → auth + host|AH
                    → FOR UPDATE game_sessions
                    → validate shape (03A)
                    → resolve round courant
                    → ALREADY_ADVANCED ? return
                    → préconditions between_rounds + scored/completed/history/recap
                    → UPDATE atomique (index+1, ranking, topic, maps vides)
                    → return state canonique
```

Pas de `patchGameState` pour cette frontière.

---

## 4. Contrat RPC

```sql
advance_tiernight_series_round(
  p_lobby_id uuid,
  p_run_id text,
  p_current_round_id text,
  p_current_round_index integer,
  p_expected_phase text default 'between_rounds'
) returns jsonb
```

**N’accepte pas** : queue, thème suivant, nouveau roundId, blob tierNight, placements, scores.

**Succès** : `{ ok, applied, code, phase, roundId, roundIndex, fromRoundId, fromRoundIndex, topicId?, lobbyId, screen, state }`

---

## 5. Contrat d’autorisation

- `auth.uid()` requis → sinon `TNS_AUTH_REQUIRED`
- `assert_lobby_member`
- `is_lobby_host` **ou** `is_acting_host` → sinon `TNS_UNAUTHORIZED`
- `SECURITY DEFINER` + `search_path = pg_catalog, public`
- `REVOKE` anon/PUBLIC ; `GRANT EXECUTE` authenticated

---

## 6. Préconditions

**Structurelles** : session, `game_id=tiernight`, tierNight, series, shape 03A, roster, items, runId.

**Métier (1ʳᵉ application)** :
- `phase = between_rounds`
- `roundIndex = p_current_round_index`
- `roundId` = `runId:index` = queue entry
- topic actif = entrée courante
- round ∈ `scoredRoundIds` et `completedRoundIds`
- `roundHistory` : exactement 1 entrée pour ce round
- `roundRecap.roundId` = round courant
- pas dernière manche → sinon `TNS_NO_NEXT_ROUND`
- entrée suivante existe

---

## 7. État suivant

```text
nextIndex = N+1
series.roundIndex = nextIndex
series.phase = ranking
series.roundRecap = null
tierNight.topicId / listName / topicEmoji ← queue[next]
tierNight.placements = {}
tierNight.finished = {}
tierNight.lobbyStarted = true
screen = tiernight
```

Inchangés : queue, ledgers, history, roster, items, modifier, runId, scores/*.

---

## 8. Idempotence

Marqueur retenu (sans nouveau champ) — **preuve complète (SERIES-05A)** :

```text
phase=ranking ∧ roundIndex=N+1 ∧ N+1 < roundCount
∧ queue[N].roundId = p_current_round_id = runId:N
∧ queue[N+1] valide ∧ roundId = runId:(N+1)
∧ topicId = queue[N+1].topicId
∧ screen = tiernight
∧ N ∈ scoredRoundIds ∧ N ∈ completedRoundIds
∧ roundHistory contient exactement 1 entrée pour N
```

→ `{ ok:true, applied:false, code:"ALREADY_ADVANCED" }` — **jamais N+2**.

Preuve incomplète (completed / history / screen / topic / next) → erreur structurée (`TNS_ROUND_NOT_COMPLETED`, `TNS_HISTORY_*`, `TNS_SCREEN_MISMATCH`, …), **pas** `ALREADY_ADVANCED`, aucune mutation.

`roundRecap` **non** exigé (contrat post-avance = `null`).

Ancien round arbitraire → `TNS_STALE_ROUND_INDEX` / `TNS_INVALID_PHASE` (sauf retry exact N→N+1).

---

## 9. Concurrence

`FOR UPDATE` sérialise double-clic et host/AH concurrents : un `applied=true`, l’autre `ALREADY_ADVANCED`.

---

## 10. Politique du roundRecap

`series.roundRecap = null` pendant `ranking` (absence explicite, compatible SERIES-02).  
`roundHistory` conservé intact.

---

## 11. Immutabilité queue/roster/items

Réécritures identiques + asserts fail-closed : `TNS_QUEUE_MUTATED`, `TNS_ROSTER_MUTATED`, `TNS_ITEMS_MUTATED`, `TNS_LEDGER_MUTATED`, `TNS_HISTORY_MUTATED`.

---

## 12. Garantie scores inchangés

Aucun appel à `tiernight_series_compute_scores` / `tierNightsPlayed`.  
Réécriture explicite des snapshots `scores` / `playerStats` / `gameScores` / `stats` / `eveningGamesRecorded` avant UPDATE.

---

## 13. Wrapper JavaScript

`js/core/tierNightSeriesAdvance.js` :
- `commitTierNightSeriesNextRound`
- `buildAdvanceTierNightSeriesRoundRpcArgs`
- `parseTierNightSeriesAdvanceError`
- timeout via `withPatchTimeout`
- **aucune** mutation locale / optimistic
- distingue applied / ALREADY_ADVANCED / stale / unauthorized / noNextRound / timeout
- **non branché**

---

## 14. Fichiers SQL

| Fichier | Rôle |
|---------|------|
| `supabase/feature-tiernight-series-05-advance-round.sql` | RPC + grants |
| `supabase/feature-tiernight-series-05-smoke-runbook.sql` | ACL + matrice 32 cas |

**Non installé automatiquement.**

---

## 15. Fichiers JavaScript

| Fichier | Rôle |
|---------|------|
| `js/core/tierNightSeriesAdvance.js` | Wrapper |
| `tests/featureTierNightSeries05.test.js` | Tests |
| `package.json` | Suite test |
| `docs/FEATURE-TIERNIGHT-SERIES-05.md` | Rapport |

---

## 16. Tests SQL

Matrice 32 cas documentée dans le smoke runbook (staging manuel avec JWT).  
Contrats SQL vérifiés en JS (FOR UPDATE, AH, codes, immutabilité, pas de scoring).

---

## 17. Tests JavaScript

- args RPC ids-only
- applied / ALREADY_ADVANCED / stale / unauthorized / noNextRound / timeout
- pas d’import state / patch
- oracle `computeNextTierNightRoundState`
- non-branchement + gate OFF
- pas de fire-and-forget

---

## 18. Résultats ciblés

| Suite | Résultat |
|-------|----------|
| SERIES-05 | **18 pass** |
| SERIES-01→04 + 03A/03B | inclus non-régression |
| Scoring, consensus, BUG-03/04/05, TN-01/02, NAV-01, Live, restart, mpLaunch, AH | exécutés |

---

## 19. Résultat global

Ticket acceptable au sens des critères §23 : transition transactionnelle, pas de double avance, ALREADY_ADVANCED, immutabilités, thème depuis queue, reset maps, AH, legacy refusé, wrapper non branché, gate OFF, aucun Git.

---

## 20. Runbook staging

1. Appliquer `feature-tiernight-series-05-advance-round.sql` (après 03A/03B).
2. Vérifier ACL (section 0 du smoke runbook) : anon=false, authenticated=true.
3. Préparer lobby entre `between_rounds` (finalize round 0).
4. Appeler `advance_tiernight_series_round(lobby, run, run:0, 0)`.
5. Vérifier index=1, topic=queue[1], placements={}, scores inchangés.
6. Rejouer le même appel → `ALREADY_ADVANCED`.
7. Parcourir la matrice 1–32 du runbook.

---

## 21. Permissions attendues

- `authenticated` : EXECUTE sur `advance_tiernight_series_round`
- `anon` / `PUBLIC` : aucun
- helpers `tiernight_series_*` : non exposés (revoke all roles)

---

## 22. Risques résiduels

- SQL non encore appliqué en staging.
- Hydrate JS peut encore stripper `roundHistory`/`roundRecap` (dette SERIES-02) — l’advance SQL préserve l’historique côté serveur.
- Sans UI between, la RPC ne peut être exercée produit que via tests/staging.
- Finalize toujours non branché → pas de chemin produit jusqu’à between_rounds.

---

## 23. Proposition SERIES-06

**SERIES-06 — Brancher finalize + écran between + CTA advance**

1. Brancher `commitTierNightSeriesRoundResult` sur fin de manche série.
2. Créer écran `tiernight-between` (récap manche, standings série).
3. CTA hôte → `commitTierNightSeriesNextRound` + follow Realtime.
4. Timeout advance → refresh → réconciliation ALREADY_ADVANCED.
5. Ouvrir le gate UI uniquement quand le flux 1→between→2 est jouable.
6. Tests E2E launch→finalize→advance→ranking.

---

## 24. Confirmation wrapper non branché

Oui — aucune occurrence dans select / board / end / liveSession / launch / finalize / gameSync.

---

## 25. Confirmation gate OFF

Oui — `isTierNightSeriesUiEnabled()` défaut false.

---

## 26. Confirmation aucune opération Git

Oui — aucun git add/commit/push.
