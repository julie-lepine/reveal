# FEATURE-TIERNIGHT-SERIES-02 — Rapport

**Statut** : sérialisation / hydratation / préservation livrées · aucun parcours série accessible  
**Date** : 2026-08-04

---

## 1. Verdict exécutif

Le contrat `tierNight.series` (SERIES-01) circule désormais de façon sûre entre local et `game_sessions` :

- sérialisation **validée** uniquement (pas de copie brute) ;
- hydratation **legacy / valide / corrompu** distincts ;
- patches partiels **préservent** `series` si la clé est absente ;
- clear explicite (`series: null`) ou full remote sans clé / restart / Rank Live reset ;
- queue divergente même `runId` **refusée** (local valide conservé) ;
- mono-thème, customs, Rank Live non régressés ;
- **aucune** UX série.

---

## 2. Cartographie des chemins de sérialisation et de merge

| Chemin | Type | Avant | Risque `series` | Mitigation SERIES-02 |
|--------|------|-------|-----------------|----------------------|
| `tierNightToRemote` | build blob | champs classic only | omit / oubli | `withTierNightSeriesRemote` si série valide |
| `tierNightRecapToRemote` | recap only | pas de series | n/a | inchangé |
| `syncTierNightSession` | patch full-ish blob | shallow merge | omit → preserve (OK) ; republie série locale si présente | passe `series` locale/cache |
| `patchGameStateInner` tierNight | shallow `{...cur,...inc}` | omit préserve ; invalid écrase | merge dédié `mergeTierNightRemoteBlob` | |
| `pushGameSession` | `{...current,...payload}` remplace clé `tierNight` | wipe si blob sans series | voulu pour launch mono / live reset | |
| `startGameSession` / prep restart | state = evening + remoteState | wipe series | voulu | |
| `markTierNightClassicStarted` | push blob sans series | wipe | mono inchangé | |
| `markTierNightLiveLobbyStarted` | `tierNightClassicResetRemote()` | wipe classic | Rank Live OK | |
| `applyRemoteSession` classic | hydrate local | ignore series | `resolveTierNightSeriesMerge` + apply sur `tierNightGame` | |
| `advanceTierNight…` / push recap | `{...tnRemote, …}` | conserve si tnRemote a series | OK | |
| contribute guest SQL | `jsonb_set` path `tierNight.placements\|finished[uid]` | **préserve** siblings | preuve SQL, pas de migration | |
| TN-02 preserve customs | full replace whitelist | series non whitelist | series dans payload canonique ou absente = clear ; **pas** de preserve stale sur autre mode | |
| `setTierNightTopicId` | wipe `tierNightGame` | clear | défaut sans series | |
| `launchTierNightSelect` | reset local + remote sans series | clear | OK | |

---

## 3. Source canonique locale retenue

| Couche | Emplacement | Rôle |
|--------|-------------|------|
| **Canon local** | `state.tierNightGame.series` | Une seule source runtime |
| **Remote** | `game_sessions.state.tierNight.series` | Snapshot partagé |
| Config | `tierNightTopicId` / mode / modifier | inchangés ; topic doit aligner la manche active si série |
| Projections | diagnostics `seriesMergeDiagnostic` (local only) | non sérialisés serveur |

Helpers purs n’accèdent **pas** au state global ; `gameSync` lit/écrit `tierNightGame.series` à l’hydratation.

Pas de double écriture implicite multi-direction : remote → décision merge → `tierNightGame` ; local → `tierNightToRemote` / sync.

---

## 4. Contrat remote final

`tierNight` peut contenir tous les champs classic existants **+** `series` (format SERIES-01), uniquement si validé.

Absence de clé `series` = legacy mono-thème (full row) ou « ne pas toucher » (patch).

---

## 5. Distinction legacy / valide / corrompu

| Cas | Détection | Comportement |
|-----|-----------|--------------|
| **A Legacy** | clé absente (full) ou `null` explicite | clear local series ; pas d’erreur |
| **B Valide** | `hydrate` / `normalize` kind `series` + invariant topic si fourni | apply remote |
| **C Corrompu** | version/queue/phase/ledger/topic mismatch / queue divergence même run | **pas** legacy ; `keep_local_reject_remote` si local valide même run ; sinon reject ; **pas** de republish auto |

`series: null` = clear explicite (sémantique distincte de l’absence en patch).

---

## 6. Helpers de sérialisation ajoutés

| Helper | Signature | Rôle | Legacy | Corruption | Tests |
|--------|-----------|------|--------|------------|-------|
| `tierNightSeriesToRemote` | `(series, {runId?})` | JSON validé cloné | n/a | `{ok:false}` | round-trip |
| `withTierNightSeriesRemote` | `(remoteBase, series, opts)` | attache série au blob | omit clé | omit clé | round-trip / mono |

`tierNightToRemote` (gameSync) délègue l’attache à `withTierNightSeriesRemote`.

---

## 7. Helpers d’hydratation ajoutés

| Helper | Signature | Rôle | Legacy | Corruption | Tests |
|--------|-----------|------|--------|------------|-------|
| `hydrateTierNightSeriesFromRemote` | `(raw, {runId?})` | wrap normalize | kind legacy | kind invalid | legacy / corruption |
| `resolveTierNightSeriesMerge` | `(opts)` | décision apply/clear/preserve/keep | clear/preserve | keep_local / reject | merge * |
| `applySeriesDecisionToTierNightGame` | `(localGame, decision)` | applique sur session locale | delete series | keep + diagnostic | clear |

---

## 8. Invariant du thème actif

`assertTierNightSeriesActiveTopicInvariant` :  
`topicId === queue[roundIndex].topicId` (+ optionnellement listName / emoji).

Divergence → invalid ; merge **ne choisit pas** arbitrairement un gagnant : conserve local valide ou reject.

---

## 9. Politique de préservation des patches partiels

`mergeTierNightRemoteBlob(..., { source: "patch" })` :

- clé `series` **absente** → preserve local ;
- `series: null` → clear ;
- `series` objet → validate / queue check / topic check.

Branché dans `patchGameStateInner` à la place du shallow naïf.

---

## 10. Politique des full pushes

| Scénario | Effet sur series |
|----------|------------------|
| Launch mono (`markTierNightClassicStarted`) | blob sans series → remplace clé → clear |
| Launch live | `tierNightClassicResetRemote()` → clear |
| Restart select | remoteState sans series + full state → clear |
| Futur launch série | blob avec series validée (helper prêt, UI non branchée) |
| Preserve TN-02 customs | inchangé ; series **pas** réinjectée depuis un autre mode |

---

## 11. Contribution invitée et RPC existante

`contribute_game_session_player` : `jsonb_set(state, [tierNight, placements|finished, uid], value)`.

**Préserve** les autres clés du blob (`series` inclus). **Aucune migration SQL** dans ce ticket. Test de contrat source SQL ajouté.

---

## 12. Merge local/distant

| Situation | Action |
|-----------|--------|
| Local sans / distant valide | `apply_remote` |
| Local valide / distant sans clé (patch) | `preserve_local` |
| Local valide / distant sans clé (full) | `clear` (legacy/reset) |
| Même run, queues ≠ | `keep_local_reject_remote` |
| Même run, topic mismatch | idem |
| Distant invalid, local valide même run | keep local |
| `runId` différent | apply remote (pas de fusion) |

---

## 13. Immutabilité de la queue

`tierNightSeriesQueueFingerprint` / `doTierNightSeriesQueuesMatch` — divergence même run = corruption.

---

## 14. Immutabilité du roster

Sérialisation copie `playerRoster` / `items` fournis ; hydratation préfère remote non vide (BUG-04). Test : live members ≠ roster sérialisé.

---

## 15. Compatibilité mono-thème

Aucun changement de parcours select → launch → end. `tierNightToRemote` sans `series` = payload historique. Suites scoring / restart / end : pass.

---

## 16. Compatibilité customs

TN-02 strip/preserve inchangés. SERIES hors customs. Suites 01/02 : pass.

---

## 17. Compatibilité Rank Live

Reset classic sans series au launch live. Suites live / BUG-03/05 : pass.

---

## 18. Fichiers modifiés

| Fichier | Action |
|---------|--------|
| `js/core/tierNightSeries.js` | Helpers wire SERIES-02 |
| `js/core/gameSync.js` | toRemote, patch merge, applyRemote hydrate, syncSession |
| `tests/featureTierNightSeries02.test.js` | **Créé** |
| `package.json` | Ajout suite SERIES-02 |
| `docs/FEATURE-TIERNIGHT-SERIES-02.md` | Ce rapport |

---

## 19. Tests ajoutés

`tests/featureTierNightSeries02.test.js` — helpers runtime réels + contrat source gameSync/SQL.

---

## 20. Résultats des tests ciblés

```
featureTierNightSeries01 + featureTierNightSeries02
# tests 43  # pass 43  # fail 0
```

---

## 21. Résultat de la suite globale (ciblée)

Inclut scoring, consensus, BUG-03/04/05, restart recap, live, rankit, 01/02, UX nav/end, SERIES-01/02, restart rollback, arch04 resume, mpLaunch :

```
# tests 233  # suites 61  # pass 233  # fail 0
```

---

## 22. Baselines et régressions

Aucune régression. Baseline tooling : SERIES-02 ajouté à `npm test`.

---

## 23. Risques ou dettes restantes

- UI / launch série non branchés (voulu).
- Scoring multi-manches + RPC transactionnelle toujours nécessaires (SERIES-01 §11).
- Diagnostic corruption = `console.warn` + champ local ; pas d’UI.
- Full push qui omet `series` efface la série (voulu pour reset) — le futur launch série **doit** inclure la clé.

---

## 24. Proposition précise du ticket suivant

**FEATURE-TIERNIGHT-SERIES-03 — Progression manches (host transitions pures → patch)**  
ou **SERIES-04 UX select pack** selon découpage 00 :

Recommandation : **SERIES-03** brancher `computeNextTierNightRoundState` + fin de manche → `between_rounds` / `series_end` **sans** encore l’écran polish, **ou** UX select 3/5/7 qui appelle `buildTierNightSeriesQueue` + launch helper (toujours derrière host).

Ne pas mélanger scoring RPC dans le même ticket.

---

## 25. Confirmation qu’aucun parcours série n’est accessible

**Confirmé.** Aucun CTA / route / launch pack.

---

## 26. Confirmation qu’aucun SQL ni aucune opération Git n’a été effectué

**Confirmé.**

---

*Fin FEATURE-TIERNIGHT-SERIES-02.*
