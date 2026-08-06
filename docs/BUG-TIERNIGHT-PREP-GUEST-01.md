# BUG-TIERNIGHT-PREP-GUEST-01 — Rapport consolidé (pré-déploiement)

**Statut** : SQL **non appliquée** · isolation + honor + anti-spam consolidés côté repo · **pas prêt terrain** tant que SQL staging + runbook R0–R10 verts.

Aucune opération Git. D1-bis / finalize / advance / scoring inchangés.

---

## 1. Cause du défaut `game_id`

La première migration faisait, pour `ready` / `pool_invalidate_request` :

```sql
if game_id incompatible then
  if v_kind = 'ready' then null;           -- bypass
  elsif v_kind = 'pool_invalidate_request' then null;
```

Conséquence : `p_game='tiernight'` + session d’un **autre** jeu dont l’écran matchait `%prep%` pouvait écrire `state.tierNightPrep`.

**Correction** : branche **stricte** avant le contrat générique :

- `v_game = 'tiernight'` et kind ∈ {ready, pool_invalidate_request}
- exige `v_row.game_id = 'tiernight'`
- exige `v_row.screen = 'tiernight-prep'`
- **aucun** `null` de neutralisation
- **`menu` refusé** pour ces kinds TierNight

### Justification `menu`

**Refusé.** Le produit pose toujours `gameId: "tiernight"` + `screen: "tiernight-prep"` via `enterTierNightSeriesPrep` / sync prep hôte. Aucun état produit réel ne nécessite `menu` pour le prep série.

Les prêts génériques des autres jeux conservent leur tolérance `menu` historique (inchangée).

---

## 2. Contrat d’écran exact

| Kind TierNight prep | Écran |
|---------------------|--------|
| `ready` | **exact** `tiernight-prep` |
| `pool_invalidate_request` | **exact** `tiernight-prep` |

Pas de `LIKE '%prep%'`. Cross-refus : `hottake-prep`, `trivia-prep`, etc.

---

## 3. ACL finales

```sql
revoke all on function public.contribute_game_session_player(uuid, text, text, jsonb) from public;
revoke all on function public.contribute_game_session_player(uuid, text, text, jsonb) from anon;
grant execute on function public.contribute_game_session_player(uuid, text, text, jsonb) to authenticated;
```

Runbook R0 : SECURITY DEFINER · search_path · authenticated execute · anon/public non execute.

---

## 4. Matrice kinds (base vibecheck → après)

| Kind | Jeux avant | Jeux après | Path avant | Path après | Notes |
|------|------------|------------|------------|------------|-------|
| ready | hottake…truthmeter | + **tiernight** | `{stateKey}.ready[uid]` | **tiernight** → `tierNightPrep.ready[uid]` ; autres inchangés | value objet `{ready, expectedSetupEpoch}` si tiernight |
| vote | (vibecheck) | inchangé | inchangé | inchangé | — |
| answer | … | inchangé | … | … | — |
| tap | clutch | inchangé | … | … | — |
| deal_ack | traitre | inchangé | … | … | — |
| submission | guesslie | inchangé | … | … | — |
| placement | tiernight | inchangé | `tierNight.placements[uid]` | inchangé | classic |
| finished | tiernight | inchangé | `tierNight.finished[uid]` | inchangé | classic |
| **pool_invalidate_request** | — | **tiernight** | — | `tierNightPrep.poolInvalidateRequestId` | value `{requestId, customEntryId}` ; ownership SQL |

Base fichier : `feature-vibecheck-01-remove-allowlist.sql` (pas i08 brut sans retrait playlistguess).

---

## 5. Ready + `expectedSetupEpoch` (risque 1)

RPC value :

```json
{ "ready": true, "expectedSetupEpoch": 4 }
```

Mismatch → `Ready obsolète` · state inchangé · rollback client silencieux (pas HOST_ONLY).

---

## 6. Honor hôte (risque 2)

### Avant
`void import(...).then(Promise.all(honor…)).catch(() => {})` — rejets avalés ; `lastHonored` **avant** succès patch.

### Après
- `scheduleTierNightPrepHostHonors` : chaîne sérialisée (`honorChain`) + **catch terminal** journalisé
- `gameSync` : plus de `void` ; `.catch(console.warn)`
- bump = mutation unique `setupEpoch++` + `ready:{}` + clear request
- timeout/échec → `refreshGameSession` ; si epoch déjà ↑ et ready vide → **reconciled**
- callback stale (`honorGeneration`) → pas de rollback régressif
- `lastHonored*` / signature **après** succès uniquement
- coalesce 750 ms ; échec réel → `lastAuthoritativeInvalidateAt = 0` (réessayable)

---

## 7. Anti-spam `pool_invalidate_request`

| Couche | Contrat |
|--------|---------|
| SQL | value **objet** `{ requestId, customEntryId }` ; custom doit exister dans `state.customRosterTopics` avec `authorUid = auth.uid()` |
| Client | publié seulement après **add custom réussi** ; remove invité → empreinte customs seule (pas de request sur custom mort) |
| Honor | **bump seulement si empreinte customs a changé** ; sinon **ack** clear request sans bump |
| Coalesce | ≤750 ms anti double-bump |

Spam de request ids sans custom réel → **rejet SQL**.  
Spam de request ids avec même custom → ack sans bump si signature inchangée.

---

## 8. Payloads client

**Ready**

```json
{
  "tierNightPrep": {
    "ready": { "<uid>": true },
    "expectedSetupEpoch": 4
  }
}
```

**Invalidate (après add custom)**

```json
{
  "tierNightPrep": {
    "poolInvalidateRequest": {
      "requestId": "inv-<uid>-<ts>",
      "customEntryId": "<id>"
    }
  }
}
```

---

## 9. Fichiers

| Fichier | Rôle |
|---------|------|
| `supabase/feature-tiernight-03-prep-guest-contribute.sql` | RPC finale |
| `supabase/feature-tiernight-03-prep-guest-contribute-runbook.sql` | Preuves R0–R10 |
| `js/core/playerContribution.js` | detect ready+epoch + poolInvalidateRequest |
| `js/core/tierNightSeriesPrepSession.js` | invalidate / honor / schedule |
| `js/core/mpLaunch.js` | ready epoch + échec bénin |
| `js/core/gameSync.js` | schedule honor |
| `tests/bugTierNightPrepGuest01.test.js` | suite bug |
| `tests/playerContribution.test.js` | detect |
| `tests/featureTierNight03b1bis.test.js` | wiring honor |

---

## 10. Tests client (exécutés — gate finale)

### Passe annoncée

```bash
node --experimental-test-module-mocks --test tests/bugTierNightPrepGuest01.test.js tests/playerContribution.test.js tests/featureTierNight03b1bis.test.js tests/featureTierNight03b1.test.js tests/featureTierNight03b.test.js tests/featureTierNight03f.test.js
```

**Résultat : `# tests 107` · `# pass 107` · `# fail 0`**

### Régression RPC / consommateurs

```bash
node --experimental-test-module-mocks --test tests/playerContribution.test.js tests/prepReadyToggle.test.js tests/prepReadyRestart.test.js tests/hotTakeVoteCommit.test.js tests/hotTakePodiumMp.test.js tests/hotTakeSyncPending.test.js tests/featureDilemma01MultiCustom.test.js tests/dilemmaVoteChange.test.js tests/dilemmaSyncPending.test.js tests/clutchTapCommit.test.js tests/clutchParticipants.test.js tests/wrongAnswerUiRefresh.test.js tests/wrongAnswerScoring.test.js tests/synTraitreDealAck01.test.js tests/traitreSession.test.js tests/triviaAnswerCommit.test.js tests/triviaRevealCommit.test.js tests/triviaActingHostPlay.test.js tests/consensusSession.test.js tests/consensusPostGame.test.js tests/truthMeterVoteCommit.test.js tests/truthMeterRevealAtomicity.test.js tests/guessLieVoteCommit.test.js tests/commitGuessLiePlay.test.js tests/tierNightLive.test.js tests/tierNightScoring.test.js tests/tierNightRestartRecap.test.js tests/sessionMerge.test.js tests/joinSessionHydrate.test.js tests/syncPrepOnMount.test.js tests/mpLaunch.test.js tests/mpLaunchLaunch.test.js
```

**Résultat : `# tests 425` · `# pass 425` · `# fail 0`**

Aucune failure.

### Runbook / harness

| Fichier | Rôle |
|---------|------|
| `feature-tiernight-03-prep-guest-contribute-runbook.sql` | Pointeur — **descriptif, non probant** |
| **`feature-tiernight-03-prep-guest-contribute-smoke-harness.sql`** | **Harness exécutable R0–R10** (fixtures, JWT, assertions, cleanup) |

R0 ACL validé manuellement sur staging. **R1–R10 non verts** tant que le harness n’a pas été exécuté.

---

## 11. Confirmations gate

| Assertion | Statut |
|-----------|--------|
| Tests client annoncés exécutés | **Oui — 107/107** |
| Régression RPC consommateurs | **Oui — 425/425** |
| Migration SQL appliquée staging | **Oui** (autorisée ; ne pas re-modifier sauf défaut smoke) |
| Harness SQL exécutable créé | **Oui** |
| Runbook commenté = preuve R1–R10 | **Non** |
| R1–R10 smokes staging exécutés | **Non — à faire** |
| Ancienne SQL booléenne | **Interdite** |
| D1-bis / finalize / advance / scoring | **Inchangés** |
| QA terrain | **Toujours bloquée** jusqu’aux smokes + re-test invité |
| Git | **Aucune opération** |

