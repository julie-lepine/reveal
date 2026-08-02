# Audit REVEAL — Suivi par cause racine

Vanilla JS + Supabase. Invité = `state.user.isGuest` + `state.supabaseUserId` (auth anonyme).

| Préfixe | Sens |
|---------|------|
| `C-` `I-` `M-` `L-` | Critique / Important / Moyen / Faible |
| `S-` `T-` `R-` `P-` | Sync / Timing / Reconnexion / Perte d’état |
| `SYN-` `ARCH-` | Audit sync / Architecture |

**Règle** : ne pas rouvrir un ticket ✅ sans **régression démontrée**.

---

## Focus — 2026-07-31 (soirée-test)

| | |
|--|--|
| **Maintenant** | 🔴 **BUG-TRUTHMETER-01** (QA + migration prod 01B) · BUG-TIERNIGHT-04 · BUG-TIERNIGHT-05 |
| **Ensuite** | 🟠 BUG-WAO-02/03/04 · BUG-TIERNIGHT-03 · BUG-TRUTHMETER-02 · **OPS-LOBBY-04** · **ARCH-23** · ARCH-10 · **UX-HOST-01** |
| **Dernière clôture** | **BUG-TRUTHMETER-01B** code 2026-08-02 (reveal atomique ; parent 01 ouvert jusqu’à QA+migration) · **01A** ✅ |

---

## File ouverte

### Prioritaire

| ID | Cause | Problème | Priorité |
|----|-------|----------|----------|
| **BUG-TRUTHMETER-01** | 7 | Validations de vote intermittentes (parent ; QA+migration) | 🔴 |
| ~~**BUG-TRUTHMETER-01A**~~ | 7 | Soumission fiable + UI honnête | ✅ code 2026-08-02 |
| ~~**BUG-TRUTHMETER-01B**~~ | 7 | Course atomique vote ↔ reveal/scoring | ✅ code 2026-08-02 · migration+QA pendantes |
| **BUG-TIERNIGHT-04** | 3/7 | Joueurs invisibles · listes désynchronisées entre appareils | 🔴 |
| **BUG-TIERNIGHT-05** | 8 | Ancien vote repris après nouvelle partie | 🔴 |

### Autres

| ID | Cause | Problème | Priorité |
|----|-------|----------|----------|
| **ARCH-23** | 8/11 | Détection version cliente + refresh obligatoire post-déploiement | 🟡 ops/UX |
| **UX-HOST-01** | 11 | CTA hôte « manche / question suivante » au-dessus du classement (fin de manche) | 🟡 |
| **BUG-WAO-02** | 6/11 | Clavier fermé quand un autre joueur envoie sa réponse | 🟠 |
| **BUG-WAO-03** | 6/11 | Scroll réinitialisé en haut pendant les votes | 🟠 |
| **BUG-WAO-04** | 11 | Validation d'une réponse vide possible | 🟠 |
| **BUG-TIERNIGHT-03** | 7 | Révélation non automatique en mode direct | 🟠 |
| **BUG-TRUTHMETER-02** | 3/8 | Changement de pseudo casse la saisie suivante | 🟠 |
| **UX-CHAT-01** | 11 | Pas de message système au lancement d'un jeu | 🟡 |
| **UX-CHAT-02** | 11 | Clavier s'ouvre automatiquement à l'ouverture du chat | 🟡 |
| **UX-DEVICE-01** | 11 | Écran verrouillé pendant une partie (Wake Lock API) | 🟡 |
| **GAME-SPEEDVOTE-01** | — | Gagnant +15 pts au lieu de +10 | 🟡 |
| **GAME-WAO-01** | — | Revoir le barème Wrong Answer Only (doc d'abord) | 🟡 |
| **FEATURE-DILEMMA-01** | — | Plusieurs dilemmes par joueur | 🟡 |
| **FEATURE-TIERNIGHT-01** | — | Thèmes personnalisés (Classer le groupe) | 🟡 |
| **FEATURE-TIERNIGHT-02** | — | Séries de tierlists par catégories | 🟡 |
| **FEATURE-CHAT-03** | — | Bouton « Futur jeu aléatoire » dans le chat | 🟡 |
| **OPS-LOBBY-04** | 8 | Activer pg_cron + job `reveal-purge-stale-lobbies` (suite BUG-LOBBY-XX) | 🟡 ops |
| **BUG-LOBBY-XX-E** | 4/8 | Hôte non notifié quand lobby expiré / supprimé (suite BUG-LOBBY-XX) | 🟡 |
| **FEATURE-VIBECHECK-01** | 10 | Suppression complète du jeu VibeCheck | ⚪ produit |
| **ARCH-10** | 8 | Clear cache leave lobby trop tard | 🟡 partiel |
| **ARCH-05** | 5 | Course lobby vs session (`row.screen`) | 🟡 mitigé SYN-28 |
| **ARCH-01 / F-01** | 1 | Démo offline sans avertissement MP | 🟡 partiel |
| **ARCH-11–17, SYN-19–24, SYN-27** | 9–10 | Monolithe / dup / code mort | Dette |

---

## Carte des causes racines

| # | Cause | État | Ouvert notable |
|---|-------|------|----------------|
| 1 | Identité invité / JWT | ✅ | ARCH-01 partiel |
| 2 | Race auth / profil | ✅ | — |
| 3 | Sources de vérité multiples | Partiel | **BUG-TIERNIGHT-04** 🔴 · **BUG-TRUTHMETER-02** 🟠 · **Membership A–E5 ✅** · M-14a ✅ · Guess Lie ✅ |
| 4 | Asymétrie hôte / invité | ✅ | — |
| 5 | Routing + timing sync | ✅ | ARCH-05 mitigé · **UX-NAV-LOBBY ✅** |
| 6 | Async écrans | Partiel | **BUG-WAO-02/03** 🟠 |
| 7 | Sync silencieuse / fire-and-forget | Partiel | **BUG-TRUTHMETER-01** 🔴 · **BUG-TIERNIGHT-03** 🟠 · **BUG-TRIVIA-01 ✅** (01A/01B/01B-bis/01C) · ARCH-07 ✅ · M-14b ✅ · ARCH-08 ✅ |
| 8 | Reset / migration incomplète | Partiel | **BUG-TIERNIGHT-05** 🔴 · **OPS-LOBBY-04** · **BUG-LOBBY-XX-E** · **BUG-TRUTHMETER-02** 🟠 · **ARCH-23** · ARCH-10 · **BUG-LOBBY-XX ✅** · I-09/SYN-15/16 ✅ |
| 9 | Sync monolithe / duplication | Dette | ARCH-11… |
| 10 | Code mort | Dette | **FEATURE-VIBECHECK-01** ⚪ · hors Fil Rouge app ✅ |
| 11 | Friction UX | Partiel | **UX-CHAT-01/02** 🟡 · **UX-DEVICE-01** 🟡 · **UX-HOST-01** 🟡 · **BUG-WAO-04** 🟠 · **ARCH-23** · ARCH-22/Loader ✅ · **L-04 ✅** |

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

#### ARCH-07 ✅ (clôture définitive · 2026-07-29)

P0 livré 2026-07-29 · P1/P2 livré 2026-07-29 — **aucun chantier Cause 7 restant** hors résidus acceptés ↻.

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
| **ARCH-10** | Cache session clear trop tard au leave | 🟡 |
| **ARCH-01** | Démo locale sans avertissement MP | 🟡 |

#### ARCH-23 — Version cliente + refresh obligatoire (ouvert)

Contexte : soirées-test où un onglet / PWA / cache GH Pages tourne encore sur un ancien bundle alors que Supabase a déjà les nouvelles RPC (ex. `submit_trivia_answer` en 01B-bis) → KO silencieux ou trompeurs, très coûteux à diagnostiquer.

| | |
|--|--|
| **Objectif** | Au démarrage app et/ou à l’entrée / join lobby : comparer une version locale embarquée à une version distante attendue |
| **Si décalage** | Bloquer le jeu · message du type « Une nouvelle version de REVEAL est disponible. Rechargez l'application pour continuer. » · CTA reload (`location.reload` / bypass cache si possible) |
| **Sources possibles** | Fichier statique versionné (`version.json` / build id) · config lue au boot · en-tête / row légère côté Supabase — à trancher en design |
| **Hors scope** | Hot-reload partiel · feature flags fins · migration SQL auto |
| **Priorité** | 🟡 ops/UX — après file 🔴 soirée-test, avant ou avec **OPS-LOBBY-04** |
| **Statut** | Ouvert · pas encore de code |

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
| **Gaps secondaires (hors scope diagnostic)** | Hôte ignoré par `handleLobbyDissolvedForGuest()` (`isLocalLobbyHost()` → return) → **BUG-LOBBY-XX-E** · `lobbyHeartbeat.js` importé jamais appelé · vieillissement artificiel `lobbies.last_activity_at` impossible (`set_lobbies_timestamps()` force `now()`) |
| **Runbook prod** | Validé v3 — R0 prioritaire (0 membre) · R3 conditionnel (membres seulement) · Realtime principal = DELETE ciblé 8B-2 · exécution dashboard **reste à faire** |
| **Chantiers ouverts** | **OPS-LOBBY-04** activer pg_cron + job · **BUG-LOBBY-XX-E** client hôte à l'expiration · **BUG-LOBBY-XX-F** si Realtime invité KO (test 8B-2) · **GAME-LOBBY-01** ↻ politique heartbeat vs « inactif » (produit, séparé) |
| **Verdict** | **Ne pas rouvrir BUG-LOBBY-XX** — rouvrir **OPS-LOBBY-04** ou **BUG-LOBBY-XX-E** selon résultats runbook prod |

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
| ~~**BUG-LOBBY-XX**~~ | ~~Fermeture auto lobby inactif~~ | ✅ **Clôturé diagnostic 2026-07-31** — voir section BUG-LOBBY-XX ✅ · suite **OPS-LOBBY-04** |
| ~~**BUG-TRIVIA-01**~~ | ~~Dernière question bloquée~~ | ✅ **Clôturé QA 2026-07-31** — 01A · 01B · 01B-bis · 01C. |
| ~~**BUG-TRIVIA-01A**~~ | ~~Acting host Trivia transitions~~ | ✅ **Clôturé QA 2026-07-31** |
| ~~**BUG-TRIVIA-01B-bis**~~ | ~~Impossible de répondre (sélection flash)~~ | ✅ **Clôturé QA 2026-07-31** |
| ~~**BUG-TRIVIA-01B**~~ | ~~Course read-modify-write reveal~~ | ✅ **Clôturé QA 2026-07-31** — RPC atomique + QA terrain. |
| ~~**BUG-TRIVIA-01C**~~ | ~~UX réponse invité Trivia~~ | ✅ **Clôturé revue 2026-07-31** |
| **BUG-TRUTHMETER-01** | Validations de vote instables (parent) | **01A** ✅ · **01B** ✅ code 2026-08-02 — `reveal_truth_meter_round` + `submit_truth_meter_vote` + `truth_meter_apply_reveal_scoring` (FOR UPDATE) · MP sans score client · auto-reveal Option A. **Parent ouvert** jusqu’à migration prod + QA terrain. |
| ~~**BUG-TRUTHMETER-01A**~~ | ~~Faux succès UI / perte submit~~ | ✅ **Code 2026-08-02** |
| ~~**BUG-TRUTHMETER-01B**~~ | ~~Course vote ↔ reveal~~ | ✅ **Code 2026-08-02** — SQL `game-sessions-truthmeter-01b-reveal-round.sql` · runbooks `supabase/tests/truthmeter-01b-*.sql` · `commitTruthMeterReveal`. Migration prod + QA à confirmer. |
| **BUG-TIERNIGHT-04** | Joueurs invisibles | Pendant certaines manches : certains joueurs ne voient plus un participant · listes différentes selon appareils. Vérifier sync listes joueurs pendant toute la manche. |
| **BUG-TIERNIGHT-05** | Ancien vote repris dans nouvelle partie | Après nouvelle partie : sélection précédente réapparaît. Attendu : état entièrement vierge. Vérifier : reset local · reset Supabase · caches · état mémoire. |

#### 🟠 Haute

| ID | Problème | Analyse / attendu |
|----|----------|-------------------|
| **BUG-WAO-02** | Clavier fermé pendant rédaction | Quand un autre joueur envoie sa réponse, le clavier disparaît · le joueur doit recliquer. Attendu : les mises à jour réseau ne doivent jamais faire perdre le focus du champ. |
| **BUG-WAO-03** | Scroll réinitialisé pendant votes | Phase vote : quand d'autres joueurs votent, la liste revient en haut. Attendu : conserver la position de scroll lors des mises à jour temps réel. |
| **BUG-WAO-04** | Réponses vides validables | Validation possible avec chaîne vide / espaces seuls. Attendu : bouton désactivé si longueur utile = 0. |
| **BUG-TIERNIGHT-03** | Révélation non automatique | Mode direct : révélation ne passe parfois pas auto à l'étape suivante. Analyser sync de transition. |
| **BUG-TRUTHMETER-02** | Changement de pseudo casse le jeu | Repro : lancer TruthMeter → changer pseudo → affirmation suivante : impossible d'écrire. L'UI garde l'ancien état (ex. « Joulaille » → « Joulaille la Goat »). Vérifier toutes les références utilisant `username` comme clé métier. |

#### 🟡 Moyenne

| ID | Problème | Analyse / attendu |
|----|----------|-------------------|
| **ARCH-23** | Version cliente vs déploiement | Au boot et/ou au join lobby : comparer version locale à une version attendue (manifest / endpoint / config distante). Si décalage : bloquer le flux jeu et forcer reload, message du type « Une nouvelle version de REVEAL est disponible. Rechargez l'application pour continuer. ». Motive : soirées-test avec client GH Pages / PWA en retard sur migrations SQL → bugs indiagnosticables (ex. 01B-bis). |
| **UX-HOST-01** | CTA hôte au-dessus du classement | En fin de manche (écran reveal / récap), le bouton hôte « Question / manche suivante » (ou équivalent podium) est **sous** le classement → scroll inutile. Attendu : CTA principal hôte **au-dessus** du classement, visible sans scroller. Périmètre : jeux avec reveal + standings + action hôte (ex. Trivia `btn-trivia-next`) · inventorier les autres jeux concernés avant patch. |
| **UX-CHAT-01** | Message système au lancement jeu | Joueurs dans le chat au moment du launch ne voient pas le changement. Attendu : message auto ex. « 🎮 L'hôte a lancé une partie de Trivia. » visible quelques secondes dans le chat. |
| **UX-CHAT-02** | Clavier auto à l'ouverture chat | Le champ prend le focus immédiatement · clavier apparaît. Attendu : ouvrir le chat sans focus · clavier uniquement après clic volontaire. |
| **UX-DEVICE-01** | Mise en veille pendant partie | Écran verrouillé si téléphone posé. À étudier : Screen Wake Lock API (ou équivalent) tant que lobby actif · relâcher au leave · fallback propre si API indisponible. |
| **GAME-SPEEDVOTE-01** | Récompense gagnant | Gagnant : **+15 pts** au lieu de +10. Vérifier qu'aucune autre règle de score n'est impactée. |
| **GAME-WAO-01** | Barème Wrong Answer Only | Barème actuel non convaincant en test. **Ne pas modifier le code immédiatement** — documenter le fonctionnement actuel puis proposer plusieurs variantes avant implémentation. |
| **FEATURE-DILEMMA-01** | Plusieurs dilemmes par joueur | Actuellement 1 seul par joueur. Autoriser plusieurs propositions · le système doit rester cohérent avec plusieurs dilemmes d'un même auteur. |
| **FEATURE-TIERNIGHT-01** | Thèmes personnalisés | Mode « Classer le groupe » : créer son propre thème (ex. « Qui survivrait le plus longtemps sur une île ? ») comme base de la tierlist. |
| **FEATURE-TIERNIGHT-02** | Séries de tierlists | Plus de tierlists officielles · organisées par catégories · enchaînement de plusieurs tierlists dans une manche · révélation finale classement global. UX à définir. |
| **FEATURE-CHAT-03** | Bouton « Futur jeu aléatoire » | Action rapide dans le chat : 🎲 Futur jeu aléatoire — proposer le prochain jeu aléatoire sans navigation classique. |

#### ⚪ Produit

| ID | Problème | Analyse / attendu |
|----|----------|-------------------|
| **FEATURE-VIBECHECK-01** | Suppression VibeCheck | Décision produit. Retrait : sélection · votes · navigation · assets · tests · stats associées éventuelles. |

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

### Wrong Answer — égalités (2026-07-25)

Départage temporel (`answers[name].at`) **abandonné**. Votes seuls → rang compétition (`1, 1, 3`) + paliers points. Doc : `data/gameRules.js`. Clutch conserve son départage temporel.

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
| **BUG-TRIVIA-01** | 7 | Parent 01A+01B+01B-bis+01C — reveal/answer atomiques · UX · replay | QA terrain 2026-07-31 |
| **BUG-TRIVIA-01B** | 7 | Reveal atomique RPC · scoring partagé · late-answer UX · runbook concurrence | `triviaRevealAtomicity` · SQL rollback/runbook · QA 2026-07-31 |
| **BUG-TRIVIA-01C** | 7 | Hint honnête · mapper answer · replay `startGameSession` sécurisé · persistDeck MP | `triviaAnswerUi` · `triviaAnswerErrors` · `triviaReplayRestart` · 2026-07-31 |
| **BUG-TRIVIA-01B-bis** | 7 | Réponse Trivia atomique · pending UI · alerte RPC absente | `triviaAnswerUi` · `triviaAnswerCommit` · QA 2026-07-31 |
| **BUG-TRIVIA-01A** | 7 | Acting host Trivia : reveal / next / final · patches explicites · derive `currentQuestion` | `triviaActingHostPlay.test.js` (18) · migration `game-sessions-trivia-01a-acting-host.sql` · QA terrain 2026-07-31 |
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
| **SYN-05 / ARCH-18** | 6/10 | Fil Rouge app supprimé (SQL ops hors scope) | `filRougeVague*` |
| **SYN-15/16 · I-09** | 8 | Rename migrate maps evening | `rosterRenameMigrate` |
| **UX-CLUTCH-01** | 3 | Roster figé au launch | 2026-07-26 |
| **UX-HIST-01** | 11 | Standings actifs ∪ contributeurs | 2026-07-26 |
| **UX-RESUME-BANNER** | 11 | Dismiss « Rester ici » | 2026-07-26 |

---

## Historique fermé (par cause)

`↻` = accepté / requalifié (pas un bug à fixer).

| Cause | Fermés (sélection) |
|-------|-------------------|
| 1 | C-01/02, R-01–05, M-05a |
| 2 | M-01, P-03, M-02a, S-02 |
| 3 | I-03/04, SYN-03, M-13, M-02b, ARCH-02, SYN-29, I-PG-01, ready stale, UX-CLUTCH-01, M-15, L-05↻, **Membership A–E5**, M-14a, boundary, join partiel |
| 4 | I-01/02/08, M-03b, M-06a/b, L-01, ARCH-03/03b, UX-VIBE-01, Guess Lie |
| 5 | T-01/02, T-03↻, M-07/08, P-02, SYN-28, ARCH-04, UX-VIBE-02, pré-résolution entry, **UX-NAV-LOBBY** |
| 6 | I-05, SYN-13b↻, SYN-25, SYN-05/ARCH-18, ARCH-06 |
| 7 | I-07, M-09, L-09, M-11, M-10, T-05, SYN-26, M-04b/SYN-18, **ARCH-08**, **ARCH-07** (P0+P1/P2), **M-14b**, **BUG-TRIVIA-01** (01A/01B/01B-bis/01C) |
| 8 | I-06, P-02, ARCH-09, I-09/SYN-06, SYN-15/16, M-15, **BUG-LOBBY-XX ✅** |
| 9 | SYN-12 / M-05b |
| 10 | SYN-05 / ARCH-18 (Fil Rouge app) |
| 11 | L-02, ARCH-21↻, M-12, UX-HIST/RESUME/VIBE, POLL, **Membership A–E5**, ARCH-22, Loader join, **UX-NAV-LOBBY**, join partiel, **L-04** |

---

## Résidus connus

Hors file prioritaire — opportunité / régression :

- Votes optimistic hors Hot Take / VibeCheck / Dilemma (speedVote / …) — **BUG-TRUTHMETER-01A/01B** ✅ code · parent **01** 🔴 jusqu’à QA+migration
- `results.js` mount · rename remote résiduel — **BUG-TRUTHMETER-02** 🟠
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
- Fil Rouge SQL historique — ops Supabase séparée · fail docs `filRougeVague3Cleanup` hors Membership
- **ARCH-23** : clients / PWA / cache Pages en retard sur migrations (leçon 01B-bis)

**Surveiller** : Clutch taps sous latence (SYN-26) · ready prep après Recommencer · conflit pending join vs chrome Home membership · leave multi-onglets après dissolve (modale « connexion a empêché ») · **ARCH-23** (clients stale post-deploy) · **OPS-LOBBY-04** après runbook prod

---

*Suivi vivant · MAJ 2026-08-02 — **BUG-TRUTHMETER-01B** ✅ code · parent **01** 🔴 (migration+QA) · TierNight-04/05*
