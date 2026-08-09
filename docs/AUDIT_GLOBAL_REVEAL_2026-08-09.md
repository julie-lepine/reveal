# AUDIT GLOBAL REVEAL — RAPPORT

**Date :** 2026-08-09  
**Périmètre :** application REVEAL — Party Games (Vanilla JS + Supabase Realtime)  
**Contrainte :** audit lecture seule — aucun correctif, aucun refactor, aucune opération git.

---

## 1. Executive Summary

L’app est une SPA Vanilla JS + Supabase Realtime avec une architecture **serveur-autoritaire** pour lobby/session, projection locale pour l’UI, et une couche de merge défensive très développée (surtout TierNight, membership, votes).

**Findings :** **0 P0 confirmé** · **4 P1** · **5 P2** · **4 P3** (+ dead code / dette séparés)

**Risques principaux :**

1. `mergeMatchScoresLocal` (max additif) survit aux restarts sur plusieurs jeux
2. Reconnect Realtime qui **null** la ref channel sans `removeChannel`
3. Rollback vote HotTake/Clutch = **map entière** (régression partielle vs SYN-VOTE-ROLLBACK-01)
4. Customs / `pickRichest*` pouvant ressusciter des entrées

**Zones les plus fragiles :** `gameSync.js` merges · `supabaseLobby.js` reconnect · customs TierNight · routing `getEffectiveSessionScreen` (mitigé mais encore complexe)

**Robustesse globale :** bonne sur les chemins déjà ticketés (membership, catch-up, TierNight series exit, vote rollback ciblé). Les résidus les plus dangereux sont des **asymétries de contrat** entre jeux (Trivia/TruthMeter protégés, HotTake/SV/Clutch/WAO/Dilemma non).

---

## 2. P0 — Critique

Aucun P0 **confirmé** avec chaîne causale terrain complète.

Les candidats les plus proches sont classés **P1** (scores restart, channel orphan) — impact réel possible, pas preuve d’incident massif en prod.

---

## 3. P1 — Important

### AUDIT-001 — `matchScores` survivent au restart (merge max) - Implementation ✅ / Tests ✅ / QA terrain ✅

* **Sévérité :** P1
* **Confiance :** BUG CONFIRMÉ (chemin code)
* **Fichier :** `js/core/gameScores.js` · `js/core/gameSync.js`
* **Fonction :** `mergeMatchScoresLocal` · `mergeHotTakeGameLocal` / SpeedVote / Clutch / WrongAnswer / Dilemma (~1354–1933)
* **Cause :** fusion `Math.max(local, remote)` ; remote `{}` ne purge pas le local
* **Scénario :**
  1. Partie HotTake (ou SV/Clutch/WAO/Dilemma) terminée avec scores
  2. Restart → prep/launch republie `matchScores: {}`
  3. Guest hydrate via merge max → **anciens scores locaux conservés**
  4. UI Guest divergente ; si acting-host score depuis ce client → base polluée
* **Impact :** podium / cumul faux · divergence Host/Guest · pollution possible si AH
* **Preuve :** `mergeMatchScoresLocal` conserve les clés locales quand remote est vide ; Trivia remplace (`matchScores: { ...remote }`) ; TruthMeter a `hydrateTruthMeterMatchScores` run-aware ; Consensus a `isNewConsensusGame` → replace. Ces 5 jeux **non**.
* **Tests existants :** aucun sur `mergeMatchScoresLocal` + restart
* **Tests manquants :** AUDIT-TEST-01
* **Recommandation :** reset autoritaire sur nouveau run/prep (comme Trivia) ou flag `runId` / `isNew*Game`

---

### AUDIT-002 — Reconnect Realtime orpheline le channel - Implementation ✅ / Tests ✅ / QA terrain ✅

* **Sévérité :** P1
* **Confiance :** BUG PROBABLE
* **Fichier :** `js/core/supabaseLobby.js`
* **Fonction :** `scheduleRealtimeReconnect` · `subscribeLobbyRealtime`
* **Cause :** `realtimeChannel = null` **sans** `removeChannel` ; `subscribeLobbyRealtime` appelle `unsubscribe` sur une ref déjà nulle
* **Scénario :** CHANNEL_ERROR/TIMEOUT → timer → null ref → nouveau subscribe → ancien Phoenix channel peut rester vivant
* **Impact :** doubles events → double `applyRemoteSession` / `handleSessionRoute` / auto-actions (reveal, advance)
* **Preuve :** reconnect nullifie avant resubscribe ; `unsubscribeLobbyRealtime` ne peut plus retirer l’ancien ; les handlers `postgres_changes` **ne filtrent pas** `lobbyChannelGen` (seul le status `subscribe` le fait)
* **Tests :** `tests/audit002RealtimeReconnect.test.js` (AUDIT-TEST-02)
* **Fix :** reconnect via `unsubscribeLobbyRealtime` (removeChannel) ; garde gen/ref sur `postgres_changes` ; ignore CLOSED intentionnel

---

### AUDIT-003 — Rollback HotTake/Clutch écrase la map votes/taps - Implementation ✅ / Tests ✅ / QA terrain ✅

* **Sévérité :** P1
* **Confiance :** BUG CONFIRMÉ
* **Fichier :** `js/core/hotTakeSession.js` · `js/core/clutchSession.js`
* **Fonction :** `commitHotTakeVote` · `commitClutchTap`
* **Cause :** restore de **toute** la map snapshotée au début ; pas `rollbackOptimisticMapEntry`
* **Scénario :** A vote → B vote arrive pendant le await → échec réseau A → rollback restaure map sans B → `all*In` faux jusqu’au catch-up
* **Impact :** retard reveal / auto-advance ; UI « en attente » incorrecte
* **Preuve :** HotTake / Clutch restauraient `previousVotes` / `previousTaps` entiers ; Dilemma/SV/WAO/Traitre utilisent le helper ciblé
* **Tests :** `tests/audit003VoteRollback.test.js` + contrats `synVoteRollback01`
* **Fix :** `computeOptimisticMapEntryApply` + `rollbackOptimisticMapEntry` (clé locale) + gardes attempt/phase

---

### AUDIT-004 — Customs ressuscités (`mergeAuthorOwned` + `pickRichest*`) - Implementation ✅ / Tests ✅ / QA terrain ⏳

* **Sévérité :** P1
* **Confiance :** BUG CONFIRMÉ (QA terrain : dernière custom)
* **Fichier :** `tierNightCustomRosterClear.js` · `customLiveTierListsSyncGuard.js` · `gameSync.applyRemoteEveningState`
* **Cause terrain :** hydrate ignorait `remote []` si local contenait des customs d’autrui et epoch non bumpée (RPC delete ne bump pas)
* **Scénario :** `[B] → delete B → []` refusé chez Guest ; `[A,B] → [B]` OK ; rejoin OK (local déjà vide)
* **Fix :** `resolveCustom*FromRemote` — `[]` epoch égale → merge (drop others) ; epoch↑ / writable:false → authoritative ; epoch remote < local → keep local (stale)
* **Tests :** `tests/audit004CustomEmptyClear.test.js`

---

## 4. P2 — Moyen

### AUDIT-005 — Scores soirée perdus si joueur parti

* **Sévérité :** P2
* **Confiance :** BUG CONFIRMÉ
* **Fichier :** `gameSync.js` — `nameForUserId` · `scoresFromRemote` (~995, ~2921)
* **Cause :** UUID → pseudo via membership live uniquement ; sinon drop
* **Scénario :** scores persistés UID → joueur leave → autre client refresh → entrée absente des standings
* **Impact :** classements soirée incomplets (ghost inverse)
* **Tests existants :** UX-HIST-01 standings actifs ∪ contributeurs (ne couvre pas drop UID unresolved)
* **Tests manquants :** AUDIT-TEST-07
* **Recommandation :** snapshot displayName sur wire score, ou cache uid→name soirée

---

### AUDIT-006 — Post-game declared ignore `resolveActivePlayScreen`

* **Sévérité :** P2
* **Confiance :** RISQUE / HYPOTHÈSE À CONFIRMER
* **Fichier :** `gameSync.js` — `getEffectiveSessionScreen` (~4031)
* **Cause :** `skippedActivePlay` calculé puis **jamais utilisé** ; si local déjà post-game / suppress → `declared` gagne
* **Scénario :** split update (play blob neuf + `row.screen` post-game stale) pendant suppress
* **Impact :** Guest reste résultats alors que Host a avancé (lié ARCH-05 mitigé)
* **Tests existants :** `sessionRouteRestartDecision.test.js` documente le short-circuit
* **Tests manquants :** split state play + declared post-game
* **Recommandation :** décision explicite ; ou supprimer le calcul mort

---

### AUDIT-007 — Roster `series_end` sans garde setup-reentry (asymétrie Live)

* **Sévérité :** P2
* **Confiance :** RISQUE
* **Fichier :** `gameSync.js` — `resolveActivePlayScreen` (~3984–4002)
* **Cause :** Live ignore `series_end` si declared prep/select ; Roster retourne toujours `tiernight-end` si `phase === series_end`
* **Scénario :** screen prep publié **sans** `series: null` effectif (échec merge / path atypique)
* **Impact :** Guest collé end (mitigé si `applySeriesClearAndPrepReset` atomique OK)
* **Note :** exit roster clear `series: null` — défense en profondeur Live absente côté Roster
* **Tests existants :** BUG-MP-NAV-01 / series exit ; pas ce cas split
* **Tests manquants :** AUDIT-TEST-05
* **Recommandation :** même `setupReentry` pour `tnSeries`

---

### AUDIT-008 — Replay Live avale l’erreur du 1er patch

* **Sévérité :** P2
* **Confiance :** BUG PROBABLE
* **Fichier :** `tierNightSeriesExitNav.js` — `replayTierNightLiveAfterSeriesEnd` (~507–517)
* **Cause :** `catch` → `console.warn` puis `enterTierNightLivePrep` quand même
* **Scénario :** 1er patch échoue · Host navigue prep · remote encore `series_end`
* **Impact :** fenêtre Host/Guest (gardes routing aident) · état ambigu
* **Tests existants :** feature TierNight 04F / replay paths partiels
* **Tests manquants :** AUDIT-TEST-06
* **Recommandation :** fail fermé ou rollback ; pas continuer silencieusement

---

### AUDIT-009 — Merge votes HotTake pendant `voting` : local gagne toutes les clés

* **Sévérité :** P2
* **Confiance :** RISQUE
* **Fichier :** `gameSync.js` — `mergeHotTakeGameLocal` (~1330)
* **Cause :** `votes = { ...remoteVotes, ...localVotes }`
* **Scénario :** si revote autorisé / ordre Realtime bizarre → vote distant d’un autre joueur écrasé par cache local
* **Impact :** faible si write-once ; plus haut si changement de vote
* **Tests existants :** merges HotTake phase/round ; pas revote concurrent multi-joueur
* **Tests manquants :** remote vote B plus récent vs local stale B
* **Recommandation :** ne merger que la clé locale optimiste (comme Dilemma post-fix)

---

## 5. P3 — Faible / dette technique

### AUDIT-010 — `skippedActivePlay` mort

* Variable inutilisée (~4032)
* **Type :** DETTE
* **Confiance :** haute
* **Risque suppression :** faible

### AUDIT-011 — `setLobbyPlaying(...).catch(() => {})` silencieux

* `js/games/*`
* Accepté M-11 / ARCH-07
* **Type :** DETTE observabilité
* **Sévérité :** P3

### AUDIT-012 — Helpers deprecated encore exportés

* `runWithChatRouletteLaunchBypass` · `setHotTakePausedBy`
* **Type :** DEAD CODE candidat

### AUDIT-013 — `clearLocalOpenLobbySlot` no-op

* Documenté ARCH-01
* Conservé pour deps
* **Type :** DEAD CODE contrôlé

---

## 6. Dead Code

| Élément | Fichier | Preuve d'inutilisation | Confiance | Risque suppression |
| ------- | ------- | ---------------------- | --------- | ------------------ |
| `runWithChatRouletteLaunchBypass` | `restartGame.js` | `@deprecated`, wrap `fn()` | Haute | Faible |
| `setHotTakePausedBy` / resume deprecated | `hotTakeSession.js` | Marqués deprecated | Moyenne | Moyen (call sites legacy?) |
| `clearLocalOpenLobbySlot` | `lobby.js` | Corps vide, deps leave | Haute | Moyen (tests/deps) |
| `skippedActivePlay` | `gameSync.js` | Assigné jamais lu | Haute | Faible |
| Mode Consensus `extremes` UI | data/UI | Scoring encore branché, UX commentée | Moyenne | Moyen |
| VibeCheck runtime | — | FEATURE-VIBECHECK-01 retiré | Haute | Déjà nettoyé |

---

## 7. Contrats incohérents

| Domaine | Contrat A | Contrat B | Risque |
| -------- | --------- | --------- | ------ |
| matchScores hydrate | Trivia replace / TM run-aware / Consensus newGame | HT/SV/Clutch/WAO/Dilemma max merge | AUDIT-001 |
| Vote rollback | Dilemma/SV/WAO/Traitre/GL ciblé | HotTake/Clutch map entière | AUDIT-003 |
| series_end → prep | Live : setupReentry dans resolve + preferEnd | Roster : clear `series:null` sans garde resolve | AUDIT-007 |
| Customs ownership | Live : authorUid only | HotTake/Dilemma : pseudo author | revive / rename |
| Launch Guess Lie | `localFirst: true` | Autres jeux remote-first fréquent | Guest retard OK voulu |
| Scoring evening | max merge UID | drop si name unresolved | AUDIT-005 |
| Navigation | Host `navigate` local + patch | Guest `getEffectiveSessionScreen` | asymétrie volontaire mitigée |

---

## 8. Race Conditions potentielles

1. **Vote A + vote B + fail A** → rollback map entière → B disparaît localement (AUDIT-003)
2. **CHANNEL_ERROR → reconnect sans remove** → double Realtime (AUDIT-002)
3. **Restart scores** → remote `{}` + merge max → stale scores (AUDIT-001)
4. **Delete custom + hydrate own** → resurrection (AUDIT-004)
5. **Replay Live patch1 fail → enter prep** → Host local ≠ remote (AUDIT-008)
6. **Post-game suppress + play state** → declared wins (AUDIT-006) — hypothèse

---

## 9. Host / Guest Sync Risks

| Chemin | Risque |
| ------ | ------ |
| Restart HT/SV/Clutch/WAO/Dilemma | Guest scores locaux stale |
| Acting host sur client Guest stale | Peut republier scores faux |
| Auto-reveal Live / HotTake all-in | Doublé si channels orphelins |
| TierNight end → prep/change mode | Bien couvert BUG-MP-NAV-01 ; Live mieux gardé que Roster en resolve |
| Guess Lie launch localFirst | Guest suit avec léger retard (voulu) |
| Join Home flash | BUG-MP-JOIN-TRANSITION-01 ✅ |

---

## 10. State / Reset Risks

| Donnée | Trop longtemps | Trop tôt |
| ------ | -------------- | -------- |
| `matchScores` HT/SV/… | Oui après restart | — |
| Votes Live | Protégé runId / series roundIndex (04E) | — |
| `series` roster | Clear `null` explicite OK | — |
| `series` live finished | Conservé volontairement (04F) jusqu’à idle clear | — |
| Customs own optimistic | Oui si delete distant | — |
| Evening scores UID | Perdus si leave puis hydrate | — |
| Ready maps | Merge défensif prep | — |
| Recap TierNight | Nullifié à exit (BUG-MP-NAV) | — |

---

## 11. Navigation / Routing Risks

* Source de vérité MP : `game_sessions.screen` + state interprété localement
* Priorité actuelle : TierNight end prefer → post-game short-circuit → active play → setup declared
* **Live** : `series_end` n’écrase pas prep declared
* **Roster** : `series_end` dans resolve peut encore forcer end si série présente
* `isSessionRouteSuppressed` : browsing scores volontaire
* ARCH-05 : mitigé, résidu AUDIT-006
* Chemins rassurants : BUG-MP-NAV-01, UX-TIERNIGHT-NAV, postGameScreenFollow tests

---

## 12. Tests manquants prioritaires

**AUDIT-TEST-01** — Restart matchScores  
Host termine HotTake → Guest a scores → Host « Recommencer » → launch → Guest `matchScores` doivent être `{}` (pas max local).

**AUDIT-TEST-02** — Reconnect channel  
Simuler CHANNEL_ERROR → assert `removeChannel` appelé sur l’ancien avant nouveau subscribe ; gen callbacks ignorés.

**AUDIT-TEST-03** — Rollback concurrent HotTake  
A commit en vol · B arrive remote · A échoue → map locale conserve B.

**AUDIT-TEST-04** — Custom delete multi-device  
Host delete entry Guest · Guest hydrate · assert absente · push settings n’y republie pas.

**AUDIT-TEST-05** — series_end + declared prep (Roster)  
State `series.phase=series_end` + `screen=tiernight-prep` → effective = prep (comme Live).

**AUDIT-TEST-06** — Replay Live patch fail  
1er `patchGameState` throw → pas de nav prep / rollback / erreur UI.

**AUDIT-TEST-07** — Score soirée after leave  
UID scoré → leave membership → refresh autre client → score encore visible ou tombstoné explicitement.

---

## 13. Dette technique

| Type | Items |
| ---- | ----- |
| Bug probable | AUDIT-001, 002, 003, 004, 005, 008 |
| Fragilité | AUDIT-006, 007, 009 · monolithe `gameSync.js` · merges par jeu |
| Code mort | §6 |
| Refactor souhaitable | Unifier contrats matchScores / rollback · gen sur RT handlers · pas présenté comme bugs |

Tickets ouverts déjà connus (ne pas re-ticketter) : **ARCH-23**, **ARCH-10** (QA mobile), **UX-DEVICE-01**, **ARCH-05** mitigé.

---

## 14. Points rassurants

* Membership A→E5 + AUTH-LEAVE : leave/dissolve atomiques, pas de ghost membership trivial
* ARCH-07 catch-up SUBSCRIBED / foreground
* SYN-VOTE-ROLLBACK ciblé sur Dilemma/SV/WAO/Traitre/GL
* TierNight : `series: null` explicite, runId, ledger scored/completed, Live merge run/list-aware
* Routing Live `series_end` ↔ prep largement durci (04F / MP-NAV)
* Trivia/TruthMeter reveals atomiques + scores run-aware
* Action locks restart / series exit
* Join transition + session cache invalidation (ARCH-10 code)
* Suite de tests large (~200 fichiers) centrée sync/TierNight/lobby
* Codec votes Live ne drop plus si `nameForUserId` null (BUG-TIERNIGHT-04)

---

## 15. Plan d'action recommandé

1. **P0** — aucun immédiat
2. **P1**
   - AUDIT-001 matchScores reset (5 jeux)
   - AUDIT-002 removeChannel + gen sur postgres_changes
   - AUDIT-003 rollback HotTake/Clutch ciblé
   - AUDIT-004 customs / pickRichest vs epoch
3. **P2** — AUDIT-005, 007, 008 ; confirmer 006/009 terrain
4. **Tests terrain** — AUDIT-TEST-01…04 en priorité
5. **Dette** — dead code §6 · unifier contrats · QA ARCH-23/10/UX-DEVICE

---

## Annexe A — Cartographie architecture

```text
USER ACTION → handler → optimistic local → patchGameState / RPC
  → game_sessions → Realtime lobby:<id> → applyRemoteSession
  → *FromRemote + sessionMerge / tierNight*Merge → saveStatePatch
  → getEffectiveSessionScreen → navigate → mount UI
```

**Sources de vérité :**

* Auth / membership / session partagée = Supabase
* UI / nav stack = local
* Contributions joueur = RPC contrôlés + optimistic scoped

### Points d’entrée

* `index.html` → `js/main.js` (`boot`)
* Supabase : `js/config/supabase.js` · `js/core/supabaseClient.js`
* State : `js/core/state.js` (`reveal-app-state`)
* Sync : `js/core/gameSync.js`
* Lobby RT : `js/core/supabaseLobby.js` (`lobby:<id>`)
* Merge : `js/core/sessionMerge.js` + domaines TierNight
* Navigation : `js/core/router.js` · `getEffectiveSessionScreen`

### Jeux

1. Spot the fake — `traitre`
2. Consensus — `consensus`
3. HotTake — `hottake`
4. Guess The Lie — `guesslie`
5. SpeedVote — `speedvote`
6. Clutch — `clutch`
7. Wrong Answer Only — `wronganswer`
8. Dilemma — `dilemma`
9. TruthMeter — `truthmeter`
10. TierNight — `tiernight` (roster / live)
11. Trivia Quiz — `trivia`

---

## Annexe B — Légende de classification

| Libellé | Sens |
| ------- | ---- |
| BUG CONFIRMÉ | Chaîne causale code reproductible |
| BUG PROBABLE | Chemin crédible, conditions de course / terrain à valider |
| RISQUE | Fragilité ou asymétrie pouvant devenir bug |
| HYPOTHÈSE À CONFIRMER | Preuve partielle |
| DETTE TECHNIQUE | Pas un bug produit immédiat |
| DEAD CODE CANDIDAT | Candidat à retrait, ne pas supprimer sans grep/deps |

---

## Annexe C — Patterns de recherche (bugs récents)

Patterns utilisés pour l’audit transversal (sans réouvrir les tickets ✅) :

1. STALE STATE
2. MERGE ADDITIF
3. DECLARED VS EFFECTIVE SCREEN
4. HOST LOCAL NAVIGATION
5. ROUND INDEX AMBIGU
6. SERIES END STALE
7. AUTO ACTION
8. RESET INCOMPLET
9. IDENTITY MISMATCH
10. LAST ROUND LOGIC

Voir aussi le suivi par cause racine : [`AUDIT_REGROUPEMENT_CAUSES_RACINES.md`](./AUDIT_REGROUPEMENT_CAUSES_RACINES.md).
