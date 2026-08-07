# Audit REVEAL — Suivi par cause racine

Vanilla JS + Supabase. Invité = `state.user.isGuest` + `state.supabaseUserId` (auth anonyme).

| Préfixe | Sens |
|---------|------|
| `C-` `I-` `M-` `L-` | Critique / Important / Moyen / Faible |
| `S-` `T-` `R-` `P-` | Sync / Timing / Reconnexion / Perte d’état |
| `SYN-` `ARCH-` | Audit sync / Architecture |

**Règle** : ne pas rouvrir un ticket ✅ sans **régression démontrée**.

---

## Focus — 2026-08-05

| | |
|--|--|
| **Maintenant** | **UX-DEVICE-01** (dernier ticket produit convenu) |
| **En fin de vague** | **ARCH-23** / **ARCH-10** QA natif — **après** clôture produit (code + SQL déjà livrés · QA différée deploy Capacitor) |
| **Dette** | ARCH-05 · ARCH-01/F-01 · ARCH-11–17 / SYN-19–24 / SYN-27 · Fil Rouge / VibeCheck cleanup |
| **Audit** | Transversal 2026-08-02 — optimistic submissions ✅ · Deal ACK ✅ · **FEATURE-CHAT-03 ✅** · **FEATURE-DILEMMA-01 ✅** · **FEATURE-TIERNIGHT-01 ✅** · **FEATURE-TIERNIGHT-02 ✅** · **UX-TIERNIGHT-END-01/02 ✅** · **UX-TIERNIGHT-NAV-01 ✅** QA 2026-08-04/05 |

> ~~« Consensus reveal atomique »~~ — **aucun ticket** à cet intitulé dans l’audit (reliquat probable d’une note type Trivia 01B, jamais formalisé). Ne pas traiter comme chantier ouvert.

---

## File ouverte

### Fin de vague — QA natif différée (pas prioritaire maintenant)

| ID | Cause | Problème | Priorité |
|----|-------|----------|----------|
| **ARCH-23** | 8/11 | Détection compatibilité client (natif) + hard gate | 🟡 Vague 1 · SQL ✅ · **QA après tickets produit** |
| **ARCH-10** | 8 | Clear cache leave lobby trop tard | 🟢 fonctionnel ✅ GH Pages · **mobile QA finale** (même vague qu’ARCH-23) |
| **UX-DEVICE-01** | 11 | Écran verrouillé pendant une partie (Wake Lock API) | 🟡 · **dernier produit** |

### Dette / opportunité 

| ID | Cause | Problème | Priorité | 
|----|-------|----------|----------|
| **ARCH-05** | 5 | Route lobby vs session (`row.screen`) | 🟡 mitigé SYN-28 |
| **ARCH-01 / F-01** | 1 | Démo offline sans avertissement MP | 🟡 partiel |
| **ARCH-11–17, SYN-19–24, SYN-27** | 9–10 | Monolithe / dup / code mort | Dette |
| **FIL ROUGE / VIBECHECK SUPPRESSION** | 10 | Vérifier suppression complète des fichiers/codes des deux jeux retirés | Dette |


## Carte des causes racines

| # | Cause | État | Ouvert notable |
|---|-------|------|----------------|
| 1 | Identité invité / JWT | ✅ | ARCH-01 partiel · **AUTH-LEAVE-*** ✅ |
| 2 | Race auth / profil | ✅ | — |
| 3 | Sources de vérité multiples | Partiel | **BUG-TIERNIGHT-04 ✅** · **BUG-TRUTHMETER-02 ✅** · **Membership A–E5 ✅** · M-14a ✅ · Guess Lie ✅ · **AUTH-LEAVE-*** ✅ |
| 4 | Asymétrie hôte / invité | ✅ | — |
| 5 | Routing + timing sync | ✅ | ARCH-05 mitigé · **UX-NAV-LOBBY ✅** |
| 6 | Async écrans | ✅ | **BUG-WAO-02** ✅ · **BUG-WAO-03** ✅ · **BUG-WAO-04** ✅ |
| 7 | Sync silencieuse / fire-and-forget | Partiel | **BUG-TRUTHMETER-01 ✅** (01A/01B) · **BUG-TIERNIGHT-03** ✅ · **BUG-TRIVIA-01 ✅** (01A/01B/01B-bis/01C) · ARCH-07 ✅ · M-14b ✅ · ARCH-08 ✅ · **SYN-VOTE-ROLLBACK-01 ✅** · **SYN-TRAITRE-DEALACK-01 ✅** |
| 8 | Reset / migration incomplète | Partiel | **BUG-TIERNIGHT-05 ✅** · **OPS-LOBBY-04 ✅** · **BUG-LOBBY-XX-E ✅** · **BUG-TRUTHMETER-02 ✅** · **ARCH-23** · ARCH-10 · **BUG-LOBBY-XX ✅** · I-09/SYN-15/16 ✅ |
| 9 | Sync monolithe / duplication | Dette | ARCH-11… |
| 10 | Code mort | Dette | **FEATURE-VIBECHECK-01 ✅** · **CLEANUP-FILROUGE-01** (app) · SQL ops Fil Rouge hors scope |
| 11 | Friction UX | Partiel | **UX-DEVICE-01** 🟡 · **FEATURE-TIERNIGHT-01 ✅** · **FEATURE-DILEMMA-01 ✅** · **FEATURE-TIERNIGHT-02 ✅** · **UX-TIERNIGHT-END-01/02 ✅** · **UX-TIERNIGHT-NAV-01 ✅** · **FEATURE-CHAT-03 ✅** · **UX-CHAT-01 ✅** · **UX-CHAT-02 ✅** · **UX-HOST-01 ✅** · **BUG-WAO-04** ✅ · **ARCH-23** · ARCH-22/Loader ✅ · **L-04 ✅** |

---

## Détail — tickets ouverts

### Cause 3 — Membership A→E5 ✅

| Vague | Objectif | Statut |
|-------|----------|--------|
| **A–D** | Query · chrome Home · garde create · leave server-only | ✅ QA 2026-07-27 |
| **E1** | Snapshot scoped `userId` + `authGeneration` · reject stale · chrome signed-out | ✅ QA 2026-07-28 |
| **E2** | Alignement asymétrique cache ↔ snapshot · promote confirmé · `commitMembershipRemoved` après preuve · rows canoniques | ✅ QA 2026-07-28 |
| **E3** | Leave polish · soft-hold `post_leave_transition` (pas de checking / faux `none`) | ✅ QA 2026-07-28 |
| **E4** | Multi-onglets INSERT · `create_lobby_atomically` · UNIQUE `user_id` | ✅ smoke 2026-07-28 |
| **E5** | Atomicité dissolve · `dissolve_lobby_atomically` · DISSOLVED/ALREADY_GONE/NOT_ALLOWED/CANONICAL_ELSEWHERE | ✅ QA 2026-07-28 |

| | |
|--|--|
| **E5 livré** | RPC `dissolve_lobby_atomically` · client unifié · ALREADY_GONE succès · `CANONICAL_ELSEWHERE` → recover Y · re-query membership post-transport |
| **Où E5** | `supabase/lobby-membership-e5-*.sql` · `lobbyDissolveContract.js` · `supabaseLobby.js` · `lobby.js` · `traitrePrivate.js` |
| **Preuve E5** | `lobbyMembershipVagueE5` · staging + terrain 2026-07-28 |
| **Ne pas confondre** | `endGameSession` → `deleteGameSession` (hors dissolve) · leave membre = DELETE membership |

### Cause 7 — Sync silencieuse ✅

| ID | Problème | Où | Statut |
|----|----------|-----|--------|
| **ARCH-07** | Catch-up Realtime · foreground · resume · claim · poll | voir clôture ci-dessous | ✅ 2026-07-29 |
| **ARCH-08** | Retry launch silencieux | `mpLaunch.js` | ✅ 2026-07-29 |
| **M-14b** | Contrat `onLocalApplied` | `mpLaunch.js` | ✅ 2026-07-29 |
| **SYN-VOTE-ROLLBACK-01** | États optimistes votes/réponse non rollbackés | sessions + UI jeux | ✅ QA 2026-08-03 |
| **SYN-TRAITRE-DEALACK-01** | Deal ACK optimiste sans rollback | `commitTraitreDealAck` | ✅ QA 2026-08-03 |

#### SYN-VOTE-ROLLBACK-01 ✅ (clôture QA terrain · 2026-08-03)

Optimistic submissions rollback (votes + réponse WAO). **Ne pas rouvrir** sans régression.

| ID | Livré |
|----|--------|
| **01A–01F** | SpeedVote · Dilemma · WAO vote/answer · Traitre vote · TierNight Live |
| **QA fix** | rejet non consommé (`withPatchTimeout` orphan) · convergence Dilemma A→B |

| | |
|--|--|
| **Où** | `optimisticMapEntry.js` · `withPatchTimeout.js` · `sessionMerge.js` · commits + UI jeux |
| **Preuve** | `synVoteRollback01*` · `dilemmaVoteChange` · QA terrain 2026-08-03 |
| **Verdict** | **Ne pas rouvrir** sauf régression vote/rollback démontrée |

#### SYN-TRAITRE-DEALACK-01 ✅ (clôture QA terrain · 2026-08-03)

Rollback Deal ACK Traître. **Ne pas rouvrir** sans régression.

| | |
|--|--|
| **Contrat** | Même helper `optimisticMapEntry` · `attemptId` · garde phase `deal` · rethrow · catch UI terminal |
| **Où** | `traitreSession.js` (`commitTraitreDealAck`) · `traitre.js` (`handleDealAckClick`) |
| **Serveur** | `contribute_game_session_player` / `jsonb_set` UID → `true` : **idempotent** · rejouable |
| **Transition** | `allTraitreDealAcksIn` → `maybeAdvanceFromDeal` (deal → speak) |
| **Preuve** | `synTraitreDealAck01.test.js` · QA terrain 2026-08-03 |
| **Verdict** | **Ne pas rouvrir** sauf régression Deal ACK / rollback démontrée |

#### ARCH-07 ✅ (clôture définitive · 2026-07-29)

P0 livré 2026-07-29 · P1/P2 livré 2026-07-29 — chantiers ARCH-07 clos ; résidu votes → **SYN-VOTE-ROLLBACK-01** ✅ ; résidu Deal ACK → **SYN-TRAITRE-DEALACK-01** ✅.

| | |
|--|--|
| **P0 A** | `runSubscribedSessionCatchUp` — SUBSCRIBED · retry `refresh_session` ×1 · dédup in-flight · gardes stale |
| **P0 B** | Foreground `refresh_lobby` — log `[MP-RT]` · pas de retry |
| **P1** | `lobbyPollChannel` — `logPollRebuildChainFailure` · `[POLL-RT] rebuild failed` · file non empoisonnée |
| **P2a** | `hostClaimOffer` — recovery refresh loggé · alerte claim inchangée |
| **P2b** | `gameResume` — catch terminal refresh · log `phase: game_resume` |
| **Où** | `supabaseLobby.js` · `gameSync.js` · `lobbyPollChannel.js` · `hostClaimOffer.js` · `gameResume.js` |
| **Preuve** | `mpRtCatchup.test.js` (20) · `arch07CatchupResidual.test.js` (10) |
| **Résidus acceptés ↻** | `setLobbyPlaying(...).catch(() => {})` dans `js/games/*` — **M-11**, pas ARCH-07 · retry Guess Lie `state.js` · `_awaitIdle` helper test poll |
| **Verdict** | **Ne pas rouvrir** sauf régression catch-up / launch / resume démontrée |

#### M-14b / SYN-09b ✅ (2026-07-29)

| | |
|--|--|
| **Livré** | Helper `applyLocalWithSideEffects()` — chaque `applyLocal` déclenche `onLocalApplied` une fois (remote-first succès + fallback, local-first, solo) |
| **Où** | `js/core/mpLaunch.js` |
| **Preuve** | `mpLaunchLaunch.test.js` (20) · bloc M-14b (8 tests) |
| **Comportement** | Inchangé call sites actuels (Guess Lie reste `localFirst: true`) · contrat API corrigé pour usages futurs |
| **Verdict** | Ne pas rouvrir sauf régression hook / double navigation launch |

#### ARCH-08 ✅ (2026-07-29)

| | |
|--|--|
| **Livré** | Retry launch observable · isolation commit/applyLocal · 1 retry immédiat background |
| **Où** | `js/core/mpLaunch.js` |
| **Preuve** | `mpLaunchLaunch.test.js` (20) · QA terrain 2026-07-29 |

Hors scope volontaire (autres causes) : rollback votes dilemma/speedVote/truthMeter · `results.js` mount · ARCH-22 ✅.

### Cause 5 / 8 / 1 / 11 — partiels

| ID | Problème | Note |
|----|----------|------|
| **ARCH-23** | Version cliente vs attendue · refresh forcé | 🟡 ouvert — post-mortem 01B-bis |
| **ARCH-05** | `row.screen` en retard vs lobby | 🟡 mitigé ; hors scope routing |
| **ARCH-10** | Cache session clear trop tard au leave | 🟢 QA Pages ✅ · mobile → QA finale |
| **ARCH-01** | Démo locale sans avertissement MP | 🟡 |

#### ARCH-10 — Invalidation précoce cache session MP (ouvert · résidu mobile)

Contrat : après leave/kick/dissolve **confirmé**, `invalidateCurrentLobbySessionCache()` avant `signOut` / teardown — évite UI stale pendant signOut lent.

| | |
|--|--|
| **Livré (code)** | Helper `invalidateCurrentLobbySessionCache` · wiring leave volontaire · kick · dissolve hôte · XX-E exit · `performLobbyBoundaryTeardown` |
| **Preuve** | `arch10SessionCache.test.js` (13) — miroir contrat + source (pas d’import `gameSync` Node) |
| **QA Pages** | ✅ validé fonctionnellement (GitHub Pages) — leave / kick / dissolve / non-régression web |
| **Résidu** | Contrôle **mobile** de non-régression (Capacitor / store test) **à inclure dans la QA finale** (même vague que ARCH-23 natif) |
| **Hors scope** | Leave server-only Vague D |
| **Statut** | 🟢 fonctionnel validé · **pas clôturé** tant que le check mobile QA finale n’est pas fait |

#### ARCH-23 — Compatibilité client native + hard gate (Vague 1 · ouvert)

Canal principal = **iOS / Android Capacitor**. Web = tests seulement. Autorité du floor = **Supabase** (`min_client_compatibility_build`), pas `version.json`.

| | |
|--|--|
| **Vague 1 livrée** | `APP_COMPATIBILITY_BUILD` (=1) · identité build · RPC/table floor · service `clientCompatibility` · gate UI · boot/create/join/resume/foreground · tests `arch23ClientCompatibility` |
| **SQL** | [`app-client-compatibility.sql`](../supabase/app-client-compatibility.sql) — **✅ appliquée** · floor **1** · aucun bump cassant |
| **Stores** | `IOS_APP_STORE_URL` / `ANDROID_PLAY_STORE_URL` vides tant que non configurés (bouton « Mettre à jour » masqué) |
| **Périmètre** | boot · create · join · resume · foreground — **pas** chaque write in-game mid-partie |
| **Contrat retry** | `unknown` après incompatibilité confirmée → gate conservé + feedback réseau ; seul `compatible` lève le gate |
| **Hors Vague 1** | Bumper le floor · publier stores · SW · feature flags · guard global writes in-game |
| **Statut** | Code + SQL prêts · **QA différée** au prochain déploiement Android/iOS de test · **pas clôturé** |

#### AUTH-LEAVE-* ✅ (clôture QA terrain · 2026-08-03)

Cluster audit transversal : leave sans preuve membership / cleanup guest incomplet. Ne pas rouvrir sans régression.

| ID | Livré |
|----|--------|
| **AUTH-LEAVE-SILENT-OK-01** | `leaveLobbySupabase` → `ok:false` si identité manquante · DELETE `.select` + requery ciblée |
| **AUTH-LOGOUT-MEMBER-01** | Logout membre bloque `signOut` si leave `!ok` / cancelled / invalide |
| **AUTH-SERVER-LEAVE-GUEST-01** | `finalizeGuestAfterAuthoritativeLeave` après leave Home server-only (sauf `CANONICAL_ELSEWHERE`) |
| **AUTH-JOIN-GUEST-LEAVE-01** | `joinLobbyAsGuest` abort join si leave préalable `!ok` |

| | |
|--|--|
| **Où** | `lobbyLeaveContract.js` · `lobbyMembershipDelete.js` · `finalizeGuestLeave.js` · `supabaseLobby.js` · `voluntaryMemberLeave.js` · `lobby.js` · `auth.js` |
| **Preuve** | `authLeaveOrphans.test.js` · QA terrain 2026-08-03 |
| **Résidus acceptés** | multitab · logout snapshot `found` sans cache · SQL/RLS inchangés |
| **Verdict** | **Ne pas rouvrir** sauf régression leave / logout / join guest démontrée |

---

#### L-04 ✅ (accepté — UI déjà livrée)

Ticket historique : le bouton « Réinitialiser l’app » était trop proéminent sur les parcours principaux.

| | |
|--|--|
| **Livré** | Lien discret `app-reset-bar` / `app-reset-bar__link` (12px, opacité faible) en bas de **Home** et **Lobby** · libellé contextualisé (« Problème d’affichage ? » / « Blocage ? ») |
| **Settings** | Carte **Dépannage** avec bouton secondaire — **volontaire** : chemin support explicite, hors flux jeu |
| **Garde** | Modale confirm avant `resetAppToCleanHome()` sur les 3 entrées |
| **Verdict** | **Aucun chantier restant** — ne pas rouvrir sauf régression visuelle ou reset accidentel mesuré |

#### UX-NAV-LOBBY ✅ (clôture définitive · 2026-07-29)

Vague A livrée 2026-07-28 · résidus audit (navigate home / navStack / QA) **acceptés** 2026-07-29 — aucun chantier code restant.

| | |
|--|--|
| **Livré Vague A** | Home hors bottom nav en lobby · Paramètres à la place · écran `settings` unique (profil + soirée + support) · leave invité pipeline canonique · hub Jeux sans Accueil |
| **Où** | `bottomNavItems.js` · `bottomNav.js` · `nav.js` · `settings.js` · `lobby.js` · `voluntaryMemberLeave.js` |
| **Preuve** | `uxNavLobby.test.js` · `uxNavSettings.test.js` · `voluntaryMemberLeave.test.js` |
| **Résidus acceptés ↻** | `navigate("home")` post-teardown ou edges boot (`cached_active`) — comportement voulu · piles `navStack` explicites `["home","lobby",…]` — dette maintien, pas bug produit · QA terrain couverte par contrats source |
| **Verdict** | **Ne pas rouvrir** sauf régression navigation démontrée (back incorrect, Home visible en lobby via menu, leave cassé) |

#### BUG-LOBBY-XX ✅ (clôture diagnostic · 2026-07-31)

Symptôme terrain : lobby inactif jamais fermé automatiquement. **Aucun correctif code/SQL livré** — clôture = analyse + runbook prod validés.

| | |
|--|--|
| **Cause racine (architecture)** | Pas de timer client. Purge serveur = `purge_stale_lobbies()` (`supabase/lobby-lifecycle.sql`) **non exposée aux clients** ; planification = **pg_cron manuel** (bloc `cron.schedule` commenté dans le repo · voir `SUPABASE_SETUP.md` §7bis) |
| **Hypothèse prod H1** | Job `reveal-purge-stale-lobbies` probablement absent ou inactif — **à confirmer** via runbook SQL (étapes lecture seule 0–6) |
| **Gaps secondaires (hors scope diagnostic)** | Hôte ignoré par `handleLobbyDissolvedForGuest()` → **BUG-LOBBY-XX-E ✅** · heartbeat legacy · vieillissement `last_activity_at` via trigger |
| **Runbook prod** | Validé v3 — exécution dashboard faite via **OPS-LOBBY-04 ✅** |
| **Chantiers ouverts** | **BUG-LOBBY-XX-F** (si Realtime invité KO) · **GAME-LOBBY-01** (politique heartbeat / inactif) |
| **Verdict** | **Ne pas rouvrir BUG-LOBBY-XX** — chaîne **OPS-LOBBY-04 ✅** + **BUG-LOBBY-XX-E ✅** |

#### OPS-LOBBY-04 ✅ (clôture QA · 2026-08-02)

Activation du job pg_cron `reveal-purge-stale-lobbies` (`*/15`) appelant `purge_stale_lobbies()`.

| | |
|--|--|
| **Livré** | Script [`ops-lobby-04-enable-purge-cron.sql`](../supabase/ops-lobby-04-enable-purge-cron.sql) · runbook [`ops-lobby-04-purge-cron-runbook.sql`](../supabase/tests/ops-lobby-04-purge-cron-runbook.sql) · doc [`DEPLOYMENTS_SQL.md`](./DEPLOYMENTS_SQL.md) §7 |
| **Preuve** | QA terrain : job actif · purge stale · Realtime DELETE reçu · sortie joueurs |
| **Hors scope** | Messages de fermeture → **BUG-LOBBY-XX-E** · seuils / heartbeat |
| **Verdict** | **Ne pas rouvrir** sauf job cron absent/inactif en prod |

#### BUG-LOBBY-XX-E ✅ (clôture QA · 2026-08-02)

Raison persistante de fermeture (`host_closed` / `inactive_expired`) via tombstones + modales distinctes.

| | |
|--|--|
| **Livré** | [`lobby-closures-xx-e.sql`](../supabase/lobby-closures-xx-e.sql) · `resolveLobbyClosureAndExit` · copies `lobbyClosureCopy.js` · runbook [`lobby-closures-xx-e-runbook.sql`](../supabase/tests/lobby-closures-xx-e-runbook.sql) |
| **Preuve** | `lobbyClosureXxE.test.js` · QA terrain (manuel vs purge / hôte+invités) |
| **Hors scope** | Seuils purge · cron · soft-close lifecycle · **BUG-LOBBY-XX-F** |
| **Verdict** | **Ne pas rouvrir** sauf attribution fausse sans tombstone ou double modale démontrée |

#### FEATURE-DILEMMA-01 ✅ (clôture QA terrain · 2026-08-04)

Multi-custom Dilemma : plusieurs propositions par joueur, deck cohérent, sync MP. **Ne pas rouvrir** sans régression démontrée.

| | |
|--|--|
| **Produit** | Formulaire prep toujours visible · suppression individuelle · aucun plafond par auteur · customs prioritaires dans le deck (pas noyés dans le catalogue) · shuffle global du sous-ensemble sélectionné |
| **Politique deck** | `C ≥ R` → R customs aléatoires · `C < R` → tous les customs + `(R−C)` prédéfinis · `C = 0` → R prédéfinis · déduplication ID · collision custom/banque → custom gagne (`{ c }` codec) |
| **Correctifs QA** | Compteur « dilemmes d'autres » (merge stale) · leave prep sans F5 (`runPrepRefreshOnLobbyChange`) · régression deck slice sur huge catalog |
| **Où** | `combinedGameDeck.js` · `dilemmaSession.js` · `deckCodec.js` · `sessionMerge.js` · `dilemmaPrep.js` · `prepOthersCustomHint.js` · `prepScreen.js` |
| **SQL** | [`feature-dilemma-01-multi-custom.sql`](../supabase/feature-dilemma-01-multi-custom.sql) — append RPC sans limite par auteur |
| **Preuve** | `featureDilemma01MultiCustom` · `featureDilemma01QaFixes` · `featureDilemma01DeckRegression` (61 tests dilemma) · QA terrain 2026-08-04 |
| **Hors scope** | Hot Take deck (schéma inchangé) · votes · scoring · round count · contrat leave customs persistants |
| **Verdict** | **Ne pas rouvrir** sauf régression multi-custom / deck / compteur / sync prep démontrée |

#### FEATURE-TIERNIGHT-02 ✅ (clôture QA terrain · 2026-08-04)

Thèmes roster « Classe le groupe » multi-joueurs : sync lobby-scoped, anti lost-update, hydratation hôte après changement de jeu. **Ne pas rouvrir** sans régression démontrée.

| | |
|--|--|
| **Produit** | Tous les joueurs créent · tous voient tous les thèmes · delete auteur-only · seul l’hôte lance · cycle de vie lobby (pas bibliothèque permanente) |
| **Écriture** | RPC unique hôte=invité (`upsert`/`delete_player_custom_entry`, `game: "tiernight"`) · jamais de republication tableau complet via `patchGameState` |
| **Anti lost-update** | Strip collection des patches génériques · préservation SQL sur replace (`upsert_game_session_preserving_roster_topics`) · **même filet sur `pushGameSessionInner`** (launch mode push) |
| **Hydratation** | `mergeCustomRosterTopics` remote-first · ownership `authorUid` · garde remote `[]` vs local multi-auteurs |
| **Où** | `customRosterTopicSession.js` · `customRosterTopicsSyncGuard.js` · `sessionMerge.js` · `gameSync.js` · `tierNightSelect.js` · `supabaseGame.js` |
| **SQL** | [`feature-tiernight-02-custom-roster-sync.sql`](../supabase/feature-tiernight-02-custom-roster-sync.sql) · [`feature-tiernight-02-lost-update-fix.sql`](../supabase/feature-tiernight-02-lost-update-fix.sql) |
| **Preuve** | `featureTierNight02CustomRosterSync` · `featureTierNight01CustomRoster` · QA terrain 2026-08-04 (créations · transition jeu · refresh · deletes · nouveau lobby vide) |
| **Hors scope** | Séries de tierlists / catégories (autre chantier produit si besoin) · Rank Live `customTierLists` |
| **Verdict** | **Ne pas rouvrir** sauf régression sync thèmes / amputation hôte après changement de jeu démontrée |

#### UX-TIERNIGHT-END-01 ✅ (clôture QA terrain · 2026-08-04)

Allègement récap `tiernight-end` : retrait du leaderboard redondant « Points de la manche ». **Ne pas rouvrir** sans régression démontrée.

| | |
|--|--|
| **Produit** | Plus de classement intermédiaire rang/avatar/nom/+pts entre breakdown et cumul |
| **Conservé** | Intro locale · board consensus · item clivant · cartes `recap-card` (+pts) · cumul soirée |
| **Où** | `tierNightEnd.js` · helpers morts retirés (`tierNightRoundScoresHtml`, `getTierNightRoundPointsSorted`) |
| **Preuve** | `uxTierNightEnd01` · QA terrain 2026-08-04 |
| **Verdict** | **Ne pas rouvrir** sauf réapparition du bloc « Points de la manche » |

#### UX-TIERNIGHT-END-02 ✅ (clôture QA terrain · 2026-08-04)

Fusion du détail scoring dans la carte récap **locale** uniquement ; cumul placé juste au-dessus de « Recommencer ». **Ne pas rouvrir** sans régression démontrée.

| | |
|--|--|
| **Produit** | Carte locale : tierlist item-par-item + `groupe X · +pts` + outsider · cartes adverses compactes · plus de card « Détail de tes points » |
| **Ordre** | intro → consensus → clivant → cartes → cumul → recommencer → résultats |
| **Où** | `tierNightEnd.js` (`recapCardHtml`) · styles `recap-card--local` / `recap-tier--scored` |
| **Preuve** | `uxTierNightEnd01` (END-01 + END-02) · QA terrain 2026-08-04 |
| **Hors scope** | Scoring / sync / barème |
| **Verdict** | **Ne pas rouvrir** sauf régression détail local / cartes adverses |

#### UX-TIERNIGHT-NAV-01 ✅ (clôture QA terrain · 2026-08-04)

Hiérarchie de navigation TierNight : retour après création de thème + un seul chevron classique par niveau. **Ne pas rouvrir** sans régression démontrée.

| | |
|--|--|
| **Produit** | Création thème → sélection thèmes roster (pas choix des modes) · un seul retour contextuel · chevron shell unifié · libellés `Classe le groupe · modes de jeu` / `Rank live · modes de jeu` |
| **Causes** | `navigate("tiernight-select")` remontait `step=mode` · double contrôle shell + `btn-back-inline` |
| **Où** | `tierNightNav.js` · `tierNightCreateRoster.js` · `tierNightCreate.js` · `tierNightSelect.js` |
| **Preuve** | `uxTierNightNav01` · QA terrain 2026-08-04 |
| **Hors scope** | Sync thèmes · permissions lancement · scoring |
| **Verdict** | **Ne pas rouvrir** sauf mauvais retour après création ou double bouton retour |

#### BUG-TRIVIA-01A ✅ (clôture QA terrain · 2026-07-31)

Acting host Trivia : transitions `question → reveal → next → final` via patches explicites + validation SQL.

| | |
|--|--|
| **Livré** | `triviaPlayPatch.js` · `commitTriviaPlay` · reveal/next/final builders · migration SQL · derive `currentQuestion` depuis `deck[questionIdx]` · alertes erreur réseau |
| **Où** | `js/core/triviaPlayPatch.js` · `triviaSession.js` · `trivia.js` · `gameSync.js` · `gameSessionSecurity.js` · `supabase/game-sessions-trivia-01a-acting-host.sql` |
| **Preuve** | `tests/triviaActingHostPlay.test.js` (18) · QA scénarios A/B/C acting host validés |
| **Hors scope (01B/01C)** | Course hôte réel post-fresh-read · UX réponse invité · restart « Recommencer » · atomicité contribution tardive |
| **Réserve acceptée ↻** | Bonus podium (+10/+5) pour joueur AFK sans réponse — barème actuel · ticket produit séparé si besoin |
| **Verdict** | **Ne pas rouvrir 01A** sauf régression acting host démontrée |

#### BUG-TRIVIA-01B-bis ✅ (clôture QA · 2026-07-31)

Réponse Trivia MP : `submit_trivia_answer` + sélection UI locale (pending) sans ghost answers.

| | |
|--|--|
| **Livré** | RPC answer + auto-reveal · `pendingAnswerIndex` conservé si échec · alerte `TRIVIA_RPC_NOT_DEPLOYED` · lookup UID/pseudo · `triviaAnswerUi.js` |
| **Où** | `supabase/game-sessions-trivia-01b-answer-auto-reveal.sql` · `triviaSession.js` · `trivia.js` · `triviaAnswerUi.js` · `triviaRevealErrors.js` |
| **Preuve** | `triviaAnswerUi` · `triviaAnswerCommit` · QA terrain 2026-07-31 |
| **Hors scope** | **01B** course reveal hôte réel · **01C** polish UX restant |
| **Leçon ops** | Client déployé avant migration SQL → KO silencieux historique → ticket **ARCH-23** |
| **Verdict** | **Ne pas rouvrir 01B-bis** sauf régression réponse / sélection |

#### BUG-TRIVIA-01C ✅ (clôture revue · 2026-07-31)

UX réponse invité + replay podium sécurisé.

| | |
|--|--|
| **Livré** | Hint honnête (`answerCommitFailed` + confirmed distant) · `mapTriviaAnswerRpcError` · `startTriviaRemoteRestart` + lock · `persistDeck: false` au replay MP |
| **Où** | `triviaAnswerUi.js` · `triviaRevealErrors.js` · `trivia.js` · `triviaSession.js` · `triviaRevealRecovery.js` |
| **Preuve** | `triviaAnswerUi` · `triviaAnswerErrors` · `triviaReplayRestart` · suites Trivia 96/96 |
| **Hors scope** | ARCH-23 · UX-HOST-01 |
| **Verdict** | **Ne pas rouvrir 01C** sauf régression hint / replay |

#### BUG-TRIVIA-01B ✅ (clôture QA · 2026-07-31)

Reveal Trivia atomique (hôte réel + acting host + auto-reveal) — plus de scoring client MP sur snapshot stale.

| | |
|--|--|
| **Livré** | RPC `reveal_trivia_round` · `FOR UPDATE` · scoring `trivia_apply_reveal_scoring` partagé force/auto · `commitTriviaRevealPlay` · UX late-answer `TRIVIA_INVALID_PHASE` · runbook concurrence |
| **Où** | `supabase/game-sessions-trivia-01b-reveal-round.sql` · `game-sessions-trivia-01b-answer-auto-reveal.sql` · `triviaSession.js` · `triviaRevealErrors.js` · `trivia.js` |
| **Preuve** | `triviaRevealCommit` · `triviaRevealAtomicity` · SQL rollback + runbook · **QA terrain 2026-07-31** |
| **Hors scope** | Solo `scoreRound` · ARCH-23 · UX-HOST-01 · cleanup `buildTriviaRevealExplicitPatch` (tests only) |
| **Verdict** | **Ne pas rouvrir 01B** sauf régression course answer↔reveal démontrée |

#### BUG-TRIVIA-01 ✅ (clôture parent · 2026-07-31)

Ensemble 01A + 01B + 01B-bis + 01C. Ne pas rouvrir le parent sans régression Trivia MP démontrée.

### Soirée-test 2026-07-31 — tickets ouverts

Retour terrain multi-jeux. Priorités : 🔴 critique · 🟠 haute · 🟡 moyenne · ⚪ produit.

#### 🔴 Critique

| ID | Problème | Analyse / attendu |
|----|----------|-------------------|
| ~~**BUG-LOBBY-XX**~~ | ~~Fermeture auto lobby inactif~~ | ✅ **Clôturé diagnostic 2026-07-31** — suites **OPS-LOBBY-04 ✅** · **BUG-LOBBY-XX-E ✅** |
| ~~**BUG-TRIVIA-01**~~ | ~~Dernière question bloquée~~ | ✅ **Clôturé QA 2026-07-31** — 01A · 01B · 01B-bis · 01C. |
| ~~**BUG-TRIVIA-01A**~~ | ~~Acting host Trivia transitions~~ | ✅ **Clôturé QA 2026-07-31** |
| ~~**BUG-TRIVIA-01B-bis**~~ | ~~Impossible de répondre (sélection flash)~~ | ✅ **Clôturé QA 2026-07-31** |
| ~~**BUG-TRIVIA-01B**~~ | ~~Course read-modify-write reveal~~ | ✅ **Clôturé QA 2026-07-31** — RPC atomique + QA terrain. |
| ~~**BUG-TRIVIA-01C**~~ | ~~UX réponse invité Trivia~~ | ✅ **Clôturé revue 2026-07-31** |
| ~~**BUG-TRUTHMETER-01**~~ | ~~Validations de vote instables (parent)~~ | ✅ **Clôturé QA 2026-08-02** — 01A · 01B. |
| ~~**BUG-TRUTHMETER-01A**~~ | ~~Faux succès UI / perte submit~~ | ✅ **Clôturé QA 2026-08-02** |
| ~~**BUG-TRUTHMETER-01B**~~ | ~~Course vote ↔ reveal~~ | ✅ **Clôturé QA 2026-08-02** — RPC atomique · hydrate scores serveur · compteur `lastRenderedVotesJson`. |
| ~~**BUG-TIERNIGHT-05**~~ | ~~Ancien vote repris dans nouvelle partie~~ | ✅ **Clôturé QA 2026-08-02** — `isNewTierNightLiveVoteRound` · hydrate + patch remote-only sur nouveau `runId` · SpeedVote inchangé. |
| ~~**BUG-TIERNIGHT-04**~~ | ~~Joueurs invisibles~~ | ✅ **Clôturé QA 2026-08-02** — roster/deck figés · UID Live · X/Y sur snapshot · hydratation votes-only. |

#### 🟠 Haute

| ID | Problème | Analyse / attendu |
|----|----------|-------------------|
| **BUG-WAO-02** | Clavier fermé pendant rédaction | ✅ **QA validé 2026-08-02** — hard-gate composition · bouton host pré-monté · `#wrong-input` réattaché. Ne pas rouvrir. |
| **BUG-WAO-03** | Scroll réinitialisé pendant votes | ✅ QA validé — ne pas rouvrir. |
| **BUG-WAO-04** | Réponses vides validables | ✅ **QA validé 2026-08-02** — `#wrong-submit` disabled si trim vide · sync input + refresh hôte · `cap:sync` + `?v=97`. Ne pas rouvrir. |
| **BUG-TIERNIGHT-03** | Révélation non automatique | ✅ **QA validé 2026-08-02** — `commitTierNightLiveRevealSafely` · verrou auto/manuel · chrome pending · retry one-shot · recovery refresh. Item suivant reste manuel. Ne pas rouvrir. |
| **BUG-TRUTHMETER-02** | Changement de pseudo casse le jeu | ✅ **Clôturé QA 2026-08-02** — UID canonique · merge clear `affirmation:null` · writing≠submitted author · skip présence. |

#### 🟡 Moyenne

| ID | Problème | Analyse / attendu |
|----|----------|-------------------|
| **ARCH-23** | Version cliente vs déploiement | Au boot et/ou au join lobby : comparer version locale à une version attendue (manifest / endpoint / config distante). Si décalage : bloquer le flux jeu et forcer reload, message du type « Une nouvelle version de REVEAL est disponible. Rechargez l'application pour continuer. ». Motive : soirées-test avec client GH Pages / PWA en retard sur migrations SQL → bugs indiagnosticables (ex. 01B-bis). |
| **UX-HOST-01** | CTA hôte — hiérarchie reveal mid-round | ✅ QA validée · reveal → action → cumul · `uxHost01RevealHierarchy` |
| ~~**UX-CHAT-01**~~ | ~~Message système au choix / prep~~ | ✅ **Clôturé QA Pages 2026-08-02** — annonce à `commitPrepSessionLaunch` · `🎮 L'hôte lance la préparation de {title}.` · Recommencer = oui · sondage close ≠ annonce. Ne pas rouvrir. |
| **UX-CHAT-02** | Clavier auto à l'ouverture chat | ✅ **QA validée 2026-08-02** — `openChatSheet` focus panel seul · re-focus post-send · `chatInGameVagueA`. Ne pas rouvrir. |
| **UX-DEVICE-01** | Mise en veille pendant partie | Écran verrouillé si téléphone posé. À étudier : Screen Wake Lock API (ou équivalent) tant que lobby actif · relâcher au leave · fallback propre si API indisponible. |
| ~~**GAME-SPEEDVOTE-01**~~ | ~~Récompense gagnant~~ | ❌ **Annulé 2026-08-02** — barème actuel **+10** (`EVENING_POINTS.WIN`) déjà harmonisé ; +15 / podium 15-10-5 non retenus. |
| ~~**GAME-WAO-01**~~ | Barème Wrong Answer Only | ✅ **Décision 2026-08-03** — podium **15/10/5** conservé **+ 5 pts / vote reçu**. `WRONG_ANSWER_POINTS_PER_VOTE` · `wrongAnswerScoring` · `gameRules`. **QA terrain** avant clôture. |
| ~~**FEATURE-DILEMMA-01**~~ | ~~Plusieurs dilemmes par joueur~~ | ✅ **Clôturé QA 2026-08-04** — multi-custom sans plafond · deck customs prioritaires + shuffle global · correctifs compteur / leave / sync. Ne pas rouvrir. |
| ~~**FEATURE-TIERNIGHT-01**~~ | ~~Thèmes personnalisés~~ | ✅ **Clôturé / validé 2026-08-05** — thèmes custom « Classer le groupe » · create-roster · sync FEATURE-02. Ne pas rouvrir. |
| ~~**FEATURE-TIERNIGHT-02**~~ | ~~Thèmes roster multi-joueurs + sync~~ | ✅ **Clôturé QA terrain 2026-08-04** — tous créent · RPC atomique · strip patch · préservation `push`/`start`/`complete` · merge remote-first · delete auteur-only · lancement hôte-only. Ne pas rouvrir. |
| ~~**UX-TIERNIGHT-END-01**~~ | ~~Points de la manche redondant~~ | ✅ **Clôturé QA terrain 2026-08-04** — leaderboard intermédiaire retiré · cartes + cumul conservés. Ne pas rouvrir. |
| ~~**UX-TIERNIGHT-END-02**~~ | ~~Détail scoring vs carte récap~~ | ✅ **Clôturé QA terrain 2026-08-04** — détail fusionné dans la carte locale · cumul sous les cartes. Ne pas rouvrir. |
| ~~**UX-TIERNIGHT-NAV-01**~~ | ~~Hiérarchie nav TierNight~~ | ✅ **Clôturé QA terrain 2026-08-04** — retour création → thèmes roster · chevron unique · libellés modes de jeu. Ne pas rouvrir. |
| ~~**FEATURE-CHAT-03**~~ | ~~Roulette « Jeu aléatoire »~~ | ✅ **Clôturé QA terrain 2026-08-03** — CTA chat · soft voice · bridge sondage · tirage libre + anti-répétition immédiate · TTL hybride · `rouletteId`/`attemptId` · permit launch · sync Realtime · fermeture chat→prep. Ne pas rouvrir. |

---

## Contrats produit (référence)

### SYN-13b — sortie jeu

- **Retour** = sortie temporaire (reste membre, suit la progression)
- **Quitter → Menu des jeux** = sortie définitive du jeu courant (suit les jeux suivants)

### UX-NAV-LOBBY — contrat produit (référence · ✅ clôturé)

- **Sans lobby** : Home dans le menu (`BOTTOM_NAV_TAB.HOME`).
- **Avec lobby** : Home **absent** ; **Paramètres** à la place ; hub = **Jeux**.
- Ordre actuel : hors lobby `[games, results, logo, final, home]` · en lobby `[games, results, logo, final, settings]`.
- **Fin membership** (Quitter / Fermer) : `navigate("home", { reset: true })`.
- **Home monté en lobby** (edge) : chrome `cached_active` (Retour au lobby).
- **Join partiel (Home)** : retry compensation avant query · garde anti-restauration silencieuse de B · bandeau conflit si DELETE échoue.
- **≠ SYN-13b** (sortie *jeu* vs sortie *lobby*).

### Wrong Answer — égalités (2026-07-25) · barème GAME-WAO-01 (2026-08-03)

Départage temporel (`answers[name].at`) **abandonné**. Votes seuls → rang compétition (`1, 1, 3`) + paliers podium. Score manche = **podium 15/10/5 + 5 × votes reçus**. Doc : `data/gameRules.js`. Clutch conserve son départage temporel.

### FEATURE-DILEMMA-01 — deck prep (référence · ✅ clôturé)

Customs **prioritaires** sur les places disponibles ; ordre final = **shuffle Fisher-Yates** du sous-ensemble sélectionné (pas de concat déterministe customs→banque).

| Cas | Règle |
|-----|--------|
| `C = 0` | `R` prédéfinis aléatoires |
| `C < R` | tous les `C` customs + `(R−C)` prédéfinis → shuffle |
| `C = R` | tous les customs → shuffle |
| `C > R` | `R` customs tirés aléatoirement · aucun prédéfini |

Déduplication par `id` · collision custom/banque → custom gagne · consume one-shot après manche · auteur quitte prep → custom reste éligible. Impl : `combinedGameDeck.js` · `buildDilemmaDeckEntries`.

### Chaînes utiles

```
Exit invité (M-06a ✅) → suppressSessionRoute → bandeau Rejoindre prep (ARCH-04 ✅)
Join mid-game (T-01 ✅) → SUBSCRIBED (T-02 ✅)
Mount lobby (SYN-12 ✅ / ARCH-06 ✅) → 1× startMultiplayerSync pre-refresh + createMountGuard
Rename local (I-09 ✅) → roster migrate (SYN-15/16 ✅)
Standings soirée (UX-HIST-01 ✅) → getEveningStandingPlayers (pas getSortedActivePlayers)
```

---

## Clôtures récentes (compact)

Ne pas rouvrir sans régression. Détail historique dans git / tests cités.

| ID | Cause | Livré | Preuve / QA |
|----|-------|-------|-------------|
| **FEATURE-DILEMMA-01** | 11 | Multi-custom prep · deck customs prioritaires · shuffle global · QA compteur/leave/sync | QA terrain 2026-08-04 · `featureDilemma01*` (61) · SQL `feature-dilemma-01-multi-custom` |
| **SYN-TRAITRE-DEALACK-01** | 7 | Rollback Deal ACK · `optimisticMapEntry` · catch UI terminal | QA terrain 2026-08-03 · `synTraitreDealAck01` |
| **SYN-VOTE-ROLLBACK-01** | 7 | Rollback soumissions optimistes votes + réponse WAO | QA terrain 2026-08-03 · `synVoteRollback01*` |
| **AUTH-LEAVE-*** | 1/3 | Preuve DELETE membership · logout membre strict · finalize guest Home · join switch abort | QA terrain 2026-08-03 · `authLeaveOrphans` |
| **UX-CHAT-01** | 11 | Annonce chat à l'entrée prep (`commitPrepSessionLaunch`) · titre catalogue | QA Pages 2026-08-02 · `uxChat01GameLaunchAnnounce` · `announceGameStartedInChat` |
| **FEATURE-VIBECHECK-01** | 10 | Retrait produit VibeCheck (`playlistguess`) · allowlists SQL · fallback sessions orphelines | QA GitHub Pages 2026-08-02 · `featureVibecheck01OrphanSession` · SQL `feature-vibecheck-01-remove-allowlist` |
| **UX-CHAT-02** | 11 | Sheet chat : pas de focus input à l'ouverture (clavier) | QA Pages 2026-08-02 · `chatInGameVagueA` |
| **GAME-SPEEDVOTE-01** | — | Annulé — barème +10 conservé (harmonisé `EVENING_POINTS.WIN`) | Décision produit 2026-08-02 |
| **GAME-WAO-01** | — | Podium 15/10/5 + 5/vote · code livré · QA terrain | Décision produit 2026-08-03 |
| **BUG-TIERNIGHT-03** | 7 | Auto-reveal Rank live sécurisé · verrou · recovery timeout · retry one-shot | QA terrain 2026-08-02 |
| **BUG-WAO-04** | 11 | CTA « Valider » disabled si trim vide · sync input + refresh hôte | QA terrain 2026-08-02 |
| **BUG-WAO-02** | 6/11 | Hard-gate composition · host CTA pré-monté · `#wrong-input` réattaché | QA terrain 2026-08-02 |
| **BUG-WAO-03** | 6/11 | Chrome vote ciblé · scroll liste conservé | QA terrain 2026-08-02 |
| **BUG-TRIVIA-01** | 7 | Parent 01A+01B+01B-bis+01C — reveal/answer atomiques · UX · replay | QA terrain 2026-07-31 |
| **BUG-TRIVIA-01B** | 7 | Reveal atomique RPC · scoring partagé · late-answer UX · runbook concurrence | `triviaRevealAtomicity` · SQL rollback/runbook · QA 2026-07-31 |
| **BUG-TRIVIA-01C** | 7 | Hint honnête · mapper answer · replay `startGameSession` sécurisé · persistDeck MP | `triviaAnswerUi` · `triviaAnswerErrors` · `triviaReplayRestart` · 2026-07-31 |
| **BUG-TRIVIA-01B-bis** | 7 | Réponse Trivia atomique · pending UI · alerte RPC absente | `triviaAnswerUi` · `triviaAnswerCommit` · QA 2026-07-31 |
| **BUG-TRIVIA-01A** | 7 | Acting host Trivia : reveal / next / final · patches explicites · derive `currentQuestion` | `triviaActingHostPlay.test.js` (18) · migration `game-sessions-trivia-01a-acting-host.sql` · QA terrain 2026-07-31 |
| **BUG-LOBBY-XX-E** | 4/8 | Tombstones `lobby_closures` · modales host_closed / inactive_expired · pipeline unifié | QA 2026-08-02 · `lobbyClosureXxE` · SQL `lobby-closures-xx-e` |
| **OPS-LOBBY-04** | 8 | pg_cron `reveal-purge-stale-lobbies` */15 · purge stale | QA 2026-08-02 · runbook ops-lobby-04 |
| **BUG-LOBBY-XX** | 8 | Diagnostic + runbook prod validés · cause = purge pg_cron · gaps E/F documentés | Analyse 2026-07-31 · `lobby-lifecycle.sql` · `lobbyLifecycle.js` · runbook v3 |
| **ARCH-07** | 7 | Clôture définitive P0+P1/P2 · observabilité sync complète | `mpRtCatchup` (20) · `arch07CatchupResidual` (10) · 2026-07-29 |
| **M-14b / SYN-09b** | 7 | Contrat `onLocalApplied` · helper centralisé | `mpLaunchLaunch.test.js` (20) · 2026-07-29 |
| **UX-NAV-LOBBY** | 5/11 | Clôture définitive · Vague A + résidus acceptés | `uxNavLobby` · `uxNavSettings` · `voluntaryMemberLeave` · 2026-07-29 |
| **L-04** | 11 | Reset app atténué · lien discret Home/Lobby · Dépannage Settings | `app-reset-bar` · `style.css` |
| **ARCH-08** | 7 | Retry launch observable · isolation commit/applyLocal · 1 retry immédiat | `mpLaunchLaunch.test.js` · QA terrain 2026-07-29 |
| **Membership E5** | 3 | `dissolve_lobby_atomically` · ALREADY_GONE · CANONICAL_ELSEWHERE | `lobbyMembershipVagueE5` · staging+terrain 2026-07-28 |
| **Membership E4** | 3 | Create atomique + UNIQUE user_id + mapping conflit + recover E2 | Staging e4-01/02 · smoke UI 2026-07-28 |
| **Membership E3** | 3 | Soft-hold post-leave · pas de checking générique | `lobbyMembershipVagueE3` · QA terrain |
| **Membership A→E2** | 3 | Query→chrome→create→leave · E1 scoped auth · E2 align asymétrique + remove après preuve | VagueA–E2 · 2026-07-28 |
| **Membership E1** | 3 | Snapshot scoped auth · reject stale | `lobbyMembershipVagueE1` · 2026-07-28 |
| **ARCH/BUG boundary** | 3/5/8 | Isolation lobby · teardown | `lobbyBoundarySession` |
| **Join partiel B** | 3/5/8 | Compensation membership orpheline | `lobbyJoinCompensation` · 1097 |
| **Membership A–D** | 3/11 | Query · chrome · create guard · server leave | VagueA–D tests · 2026-07-27 |
| **ARCH-22** | 11 | Soft pending sync (API figée) | `syncPending` · HT/Dilemma/GL/Vibe/launch |
| **Loader UI join** | 5/11 | Soft « Connexion… » Home | `homeJoinSyncPending` · Vague B non retenue |
| **Pré-résolution entry** | 5 | Garde `get*EntryScreen` avant paint | `prepEntryGuardVagueA` · B1 non retenue |
| **M-14a / SYN-14** | 3 | TierNight récap `runId` | `tierNightRestartRecap` |
| **Guess Lie** | 3/4/7/8 | UX vote A/B1 · M-15 non repro · L-05 invalidée | `guessLieVote*` |
| **FEATURE-LOBBY-POLL** | — | Sondages in-chat | `lobbyPolls*` |
| **UX-VIBE-01/02** | 4/5/11 | Vote chrome · exit play | 2026-07-26 |
| **ARCH-06** | 6 | Mount guard A/B/C · Traître V2 · Lobby IIFE | `mountLifecycle` · `arch06*` |
| **SYN-05 / ARCH-18** | 6/10 | Fil Rouge app supprimé (SQL ops hors scope) · CLEANUP-FILROUGE-01 | `filRougeVague*` |
| **SYN-15/16 · I-09** | 8 | Rename migrate maps evening | `rosterRenameMigrate` |
| **UX-CLUTCH-01** | 3 | Roster figé au launch | 2026-07-26 |
| **UX-HIST-01** | 11 | Standings actifs ∪ contributeurs | 2026-07-26 |
| **UX-RESUME-BANNER** | 11 | Dismiss « Rester ici » | 2026-07-26 |

---

## Historique fermé (par cause)

`↻` = accepté / requalifié (pas un bug à fixer).

| Cause | Fermés (sélection) |
|-------|-------------------|
| 1 | C-01/02, R-01–05, M-05a, **AUTH-LEAVE-*** |
| 2 | M-01, P-03, M-02a, S-02 |
| 3 | I-03/04, SYN-03, M-13, M-02b, ARCH-02, SYN-29, I-PG-01, ready stale, UX-CLUTCH-01, M-15, L-05↻, **Membership A–E5**, M-14a, boundary, join partiel, **AUTH-LEAVE-*** |
| 4 | I-01/02/08, M-03b, M-06a/b, L-01, ARCH-03/03b, UX-VIBE-01, Guess Lie |
| 5 | T-01/02, T-03↻, M-07/08, P-02, SYN-28, ARCH-04, UX-VIBE-02, pré-résolution entry, **UX-NAV-LOBBY** |
| 6 | I-05, SYN-13b↻, SYN-25, SYN-05/ARCH-18, ARCH-06 |
| 7 | I-07, M-09, L-09, M-11, M-10, T-05, SYN-26, M-04b/SYN-18, **ARCH-08**, **ARCH-07** (P0+P1/P2), **M-14b**, **BUG-TRIVIA-01** (01A/01B/01B-bis/01C), **SYN-VOTE-ROLLBACK-01**, **SYN-TRAITRE-DEALACK-01** |
| 8 | I-06, P-02, ARCH-09, I-09/SYN-06, SYN-15/16, M-15, **BUG-LOBBY-XX ✅** |
| 9 | SYN-12 / M-05b |
| 10 | SYN-05 / ARCH-18 (Fil Rouge app) |
| 11 | L-02, ARCH-21↻, M-12, UX-HIST/RESUME/VIBE, POLL, **Membership A–E5**, ARCH-22, Loader join, **UX-NAV-LOBBY**, join partiel, **L-04**, **UX-CHAT-01**, **UX-CHAT-02**, **UX-HOST-01**, **FEATURE-DILEMMA-01** |

---

## Résidus connus

Hors file prioritaire — opportunité / régression :

- ~~Votes optimistic hors Hot Take / Guess Lie~~ → **SYN-VOTE-ROLLBACK-01** ✅
- ~~`commitTraitreDealAck` sans rollback~~ → **SYN-TRAITRE-DEALACK-01** ✅
- `results.js` mount async — résidu bas (TruthMeter-02 ✅ clôturé)
- Lobby `playing` si upsert échoue après `setLobbyPlaying` (M-11)
- `pushGameSession` : `err.message` brut (L-09)
- Logs debug join · policy debug lobby Supabase
- SYN-28 : `settings` hors scope ; course lobby `playing` vs session menu
- I-PG-01 : autres jeux sans podium dédié
- Starts sync hydrate → hub hors `mountLobby` (hors périmètre ARCH-06)
- Membership **E4** (reporté) : course RPC pure ALREADY_EXISTS · join↔join concurrent · reclaim X/Y · JSON 23505 · e4-03/03b
- Join partiel : revert RPC reclaim anonymous · orphelin **création** · E2E Supabase
- Pré-résolution B1 (getter post-mark launch) — étudiée, **non retenue**
- Loader join interstitiel — **non retenu**
- Fil Rouge SQL historique — ops Supabase séparée (table `fil_rouge_private` / clés allowlist éventuelles) ; garde-fous app verts via `filRougeVague*`
- **ARCH-23** : clients / PWA / cache Pages en retard sur migrations (leçon 01B-bis)
- Logout snapshot `found` sans cache hydraté (hors AUTH-LEAVE Vague 1)
- Leave multi-onglets sans BroadcastChannel

**Surveiller** : Clutch taps sous latence (SYN-26) · ready prep après Recommencer · conflit pending join vs chrome Home membership · leave multi-onglets après dissolve · **ARCH-23** (clients stale) · **ARCH-10** non-régression mobile (QA finale)

---

*Suivi vivant · MAJ 2026-08-05 — **FEATURE-TIERNIGHT-01** ✅ · **UX-TIERNIGHT-NAV-01** ✅ · **UX-TIERNIGHT-END-01/02** ✅ · **FEATURE-TIERNIGHT-02** ✅ · prochain produit = **UX-DEVICE-01** · **ARCH-23** / **ARCH-10** QA natif en fin de vague*
