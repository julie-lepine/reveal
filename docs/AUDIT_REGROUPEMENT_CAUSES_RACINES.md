# Audit REVEAL — Suivi par cause racine

Vanilla JS + Supabase. Invité = `state.user.isGuest` + `state.supabaseUserId` (auth anonyme).

| Préfixe | Sens |
|---------|------|
| `C-` | Critique |
| `I-` | Important |
| `M-` | Moyen |
| `L-` | Faible |
| `S-` / `T-` / `R-` / `P-` | Sync / Timing / Reconnexion / Perte d’état |
| `SYN-` / `ARCH-` | Audit sync / Architecture |

---

## Focus — 2026-07-28

| | Contenu |
|--|---------|
| **Fait (file prioritaire)** | Guess Lie · Sondages · ARCH-06 · Membership A–D · **Membership Vague E1** · M-14a · ARCH-22 · Loader UI join · Pré-résolution entry screens · **UX-NAV-LOBBY (Vague A)** · **ARCH/BUG isolation lobby** · **SYN/ARCH join partiel B orpheline** — tous ✅ |
| **Prochain** | **Membership Vague E2–E5** (cache↔snapshot · leave polish · multi-onglets · SQL) · QA terrain UX-NAV-LOBBY résidus |
| **Ensuite** | ARCH-07/08 · L-04 |

**Décision produit (UX-NAV-LOBBY — actée + livrée Vague A)**  
Une fois le lobby rejoint : **Accueil n’est plus dans le menu principal** (`resolveBottomNavTabs(inLobby)` remplace Home par Paramètres). Le hub soirée = **Jeux** (logo central) + Paramètres. Home reste la destination **après Quitter / Fermer** (`applyLeaveLobbyLocal` → `navigate("home", { reset: true })`).

**Résidus**  
votes optimistic (speedVote / …) · `results.js` mount · rename remote (I-09) · **Membership Vague E2–E5** · Loader join interstitiel (non retenu) · pré-résolution B1 launch getter (non retenue) · chemins programmatiques vers `home` en lobby (deep link / recovery) · revert RPC reclaim anonymous

**Surveiller**  
Clutch taps sous latence (SYN-26) · ready prep après Recommencer · starts sync hydrate → hub hors `mountLobby` · conflit pending join vs chrome Home membership

---

## File d’attente

### Prioritaires

| # | ID | Cause | Problème | Statut |
|---|----|-------|----------|--------|
| 1 | **Membership Vague E2–E5** | 3 | Contradiction cache + snapshot `none` · multi-onglets INSERT · leave polish · atomicité dissolve | Ouvert |

### Clôturés récents (2026-07-28)

| ID | Résumé | Statut |
|----|--------|--------|
| **Membership Vague E1** | Snapshot scoped userId + gen auth · reject stale queries · chrome signed-out | ✅ QA 1119/1119 |
| **UX-NAV-LOBBY** | Home hors menu en lobby · Settings unifié · leave volontaire | ✅ Vague A |
| **ARCH/BUG boundary** | Isolation lobby / résidu partie après changement | ✅ QA |
| **SYN/ARCH join partiel** | Compensation membership B orpheline · guestMembership · pending Home | ✅ QA 1097/1097 |

### Autres ouverts

| ID | Cause | Problème | Statut |
|----|-------|----------|--------|
| **M-14b / SYN-09b** | 7 | `onLocalApplied` si `localFirst: false` | Latent |
| **ARCH-07** | 7 | Catch Realtime silencieux | À traiter |
| **ARCH-08** | 7 | Retry launch silencieux | À traiter |
| **ARCH-10** | 8 | Clear cache leave lobby | 🟡 partiel |
| **ARCH-05** | 5 | Course lobby vs session | 🟡 mitigé SYN-28 |
| **ARCH-01 / F-01** | 1/10 | Démo offline sans MP | 🟡 partiel |
| **L-04** | 11 | « Réinitialiser l’app » trop visible | 🟡 partiel |
| **ARCH-11–17, SYN-19–24, SYN-27** | 9–10 | Monolithe / dup / code mort | Dette |

---

## Carte des causes racines

| # | Cause | État | Ouvert notable |
|---|-------|------|----------------|
| 1 | Identité invité / JWT | ✅ QA | ARCH-01 partiel |
| 2 | Race auth / profil | ✅ QA | — |
| 3 | Sources de vérité multiples | ✅ hors TierNight M-14a | UX-CLUTCH-01 ✅ · **Membership A–D** ✅ · **M-14a** ✅ |
| 4 | Asymétrie hôte / invité | ✅ QA | Guess Lie ✅ |
| 5 | Routing + timing sync | ✅ | ARCH-05 mitigé · pré-résolution entry ✅ · **UX-NAV-LOBBY Vague A** ✅ |
| 6 | Async écrans | ✅ QA | **ARCH-06** ✅ |
| 7 | Sync silencieuse / fire-and-forget | Partiel | ARCH-07/08, M-14b |
| 8 | Reset / migration incomplète | Partiel | I-09 ✅ ; SYN-15/16 ✅ ; ARCH-10 |
| 9 | Sync monolithe / duplication | Dette | ARCH-11… |
| 10 | Code mort | Dette | dead exports (hors Fil Rouge app) |
| 11 | Friction UX | Partiel | ARCH-22 ✅ · Loader UI join ✅ · L-04 · **UX-NAV-LOBBY Vague A** ✅ |

---

## Détail des tickets ouverts

### Cause 5 / 11 — UX-NAV-LOBBY (Home hors menu en lobby) ✅ Vague A

| | |
|--|--|
| **Décision produit** | Après rejoindre un lobby, **Home n’est plus dans le menu principal**. Hub soirée = **Jeux** + **Paramètres**. Sortie membership → retour Home (`navigate("home", { reset: true })`). |
| **Livré (Vague A)** | `bottomNavItems.js` : hors lobby `[home, games, logo, results, final]` ; en lobby `[settings, games, logo, results, final]` · `nav.js` : `goToEveningHome()` → hub jeux si lobby actif · ‹ `game-select` sans retour Home · Settings unifié (leave membre / close hôte) · `game-select` : `back: false` |
| **Home écran** | Non promu par le menu en lobby. Si monté (edge case), chrome `cached_active` (Retour au lobby). Leave / Fermer → reset → Home. |
| **Home + join partiel** | `resolveHomeMembership` : retry pending compensation avant query · garde anti-restauration silencieuse de B · bandeau « Quitter B / Rejoindre B » si DELETE échoue (`membership_reconciliation_required`) |
| **Où** | `bottomNavItems.js` · `bottomNav.js` · `nav.js` · `settings.js` · `partySettingsMenu.js` · `voluntaryMemberLeave.js` · `home.js` · `lobbyMembershipCompensation.js` |
| **Preuve** | `tests/uxNavLobby.test.js` · `tests/voluntaryMemberLeave.test.js` · `tests/lobbyJoinCompensation.test.js` |
| **QA** | ✅ Vague A 2026-07-28 |
| **Résidus** | `navigate("home")` programmatique en lobby (recovery, captcha, gameGuard) · piles `navStack` legacy · QA terrain sortie/settings |
| **Ne pas confondre** | SYN-13b (sortie temporaire d’un *jeu* vs sortie du *lobby*) |

### Cause 3 / 5 / 8 — ARCH/BUG isolation lobby + SYN/ARCH join partiel ✅ QA

| | |
|--|--|
| **Symptôme A** | Résidu de partie après changement de lobby (`cachedRow`, `lastGame`, teardown incomplet) |
| **Fix A** | `lobbyBoundary.js` · `lobbyRuntime.js` · join transactionnel · gardes `gameSync` · `lastGame` scopé |
| **Symptôme B** | Join B : mutation serveur OK, échec finalisation locale → membership B orpheline |
| **Fix B** | Journal `lobbyJoinEffects` · compensation DELETE (insert ou reclaim) · restauration `guestMembership` · pending + retry Home |
| **Preuve** | `tests/lobbyBoundarySession.test.js` · `tests/lobbyJoinCompensation.test.js` · **1097/1097** |
| **QA** | ✅ 2026-07-28 |
| **Résidus acceptés** | Pas de revert RPC anonymous · satellites post-DELETE · orphelin **création** lobby |

### Cause 11 — ARCH-22 feedback sync lente (soft pending) ✅

| | |
|--|--|
| **Primitive** | `createSyncPending` (`js/core/syncPending.js`) — **API figée** : soft delay, tokens, `onChange` ; pas de libellés / DOM / locks |
| **Vague A** | Décisions produit (libellés contextuels, ~500 ms, V1 surfaces) |
| **Vague B** | Hot Take ✅ QA terrain |
| **Vague C** | Dilemma · Guess Lie · VibeCheck · `runLaunchButton` — Ready / Restart volontairement inchangés |
| **Hors scope** | SpeedVote · TruthMeter · reveals · next round · host force · Realtime · `patchGameStateWithFeedback` / `withPatchTimeout` · ARCH-07/08 |
| **Preuve** | `tests/syncPending.test.js` · `*SyncPending.test.js` · suite verte |
| **QA** | ✅ clos 2026-07-27 — B + C terrain |
| **Ne pas rouvrir** | Sans régression démontrée (flash sous réseau rapide / libellé trop tôt) |

### Cause 5 / 11 — Loader UI join ✅

| | |
|--|--|
| **Symptôme** | Join code Home : await long avec seulement `btn.disabled` |
| **Vague A** | Soft « Connexion… » via `createSyncPending` + paint (`#btn-join-lobby` · guest join/rejoin) — pas de `joinInFlight` |
| **Hors A** | Resume · Return · Create · interstitiel · T-01/T-02 · hydrate · Realtime · `navigateAfterLobbyJoin` |
| **Où** | `js/screens/home.js` |
| **Preuve** | `tests/homeJoinSyncPending.test.js` |
| **QA** | ✅ clos 2026-07-27 — Vague A suffisante ; Vague B (interstitiel) non ouverte |
| **Ne pas rouvrir** | Sans régression perception (freeze join malgré soft label) |

### Cause 5 — Pré-résolution `get*EntryScreen` ✅

| | |
|--|--|
| **Douleur initiale** | Mount d’un prep alors que la session est déjà lancée (ou inverse côté play) → nested redirect M-08 ; prep obsolète pouvait peindre / installer listeners avant redirect ; asymétrie entre preps (Trivia/Consensus/Traître avaient la garde, d’autres non) |
| **Correctif livré (Vague A)** | Garde `get*EntryScreen` au mount **avant** paint / controllers / listeners : si entry ≠ prep → `navigate(entry); return null` |
| **Sept preps couverts** | Hot Take · SpeedVote · Clutch · Wrong Answer · **VibeCheck** (`playlistGuessPrep` / `playlistguess-prep`) · Dilemma · TruthMeter — alignés sur Trivia / Consensus / Traître |
| **Preuve** | `tests/prepEntryGuardVagueA.test.js` · `tests/routerNestedRedirect.test.js` (M-08) · suite **1001/1001** à livraison |
| **Filets conservés** | Gardes prep Vague A · redirects play in-mount · `prepGuestFollowOnSession` (déjà getters) · **M-08** inchangé |
| **Vague B (étudiée, non retenue)** | Pré-résolution aux call sites (`gameScreen` play du launch hôte → getter post-`lobbyStarted`). **ROI insuffisant** : pas de mauvaise destination observée ; `gameScreen` fixe reste une intention métier valide après lancement réussi ; B1 imposerait une contrainte d’ordre (getter jamais avant mark). **B2** (Trivia/Consensus open/replay, resume, sync, stacks) : **non lancée** — rouvrir seulement sur bug terrain reproductible |
| **QA / clôture** | ✅ clos 2026-07-27 — Vague A suffit ; B1 documentée comme homogénéisation non prioritaire |
| **Ne pas rouvrir** | Sans régression (prep peint alors que jeu déjà lancé / listeners installés avant redirect) |

### Cause 3 / 11 — Membership lobby orpheline (Créer bloqué) ✅ QA

| | |
|--|--|
| **Symptôme** | Créer un lobby, ne pas le démarrer, en relancer un autre → bloqué (toujours membre du 1er) sans carte Home |
| **Vague A** | Query canonique `none \| found \| unknown` (`lobbyMembershipFetch` / Snapshot) — pas d’hydrate |
| **Vague B** | Chrome Home depuis snapshot ; Resume ; plus de `pendingServerLobby` |
| **Vague C** | Garde `createLobby()` : re-query ; INSERT seulement si `none` |
| **Vague D** | Quitter (membre) / Fermer (hôte) server-only via `leaveLobbyMembershipFromServer` — identité snapshot, pas `state.lobby` |
| **Où** | `lobbyMembership*.js` · `lobbyCreateGuard.js` · `lobbyServerLeave.js` · `homeMembershipChrome.js` · `home.js` · `supabaseLobby.js` (by-id) |
| **Preuve** | `tests/lobbyMembershipVagueA.test.js` · `homeMembershipVagueB.test.js` · `lobbyCreateVagueC.test.js` · `lobbyServerLeaveVagueD.test.js` |
| **QA** | ✅ A–D validé 2026-07-27 (D terrain OK) |
| **Résidus → E2–E5** | Contradiction cache actif + snapshot `none` · multi-onglets INSERT · flash UI invalidate→confirm · atomicité dissolve héritée · **logout/snapshot → E1 ✅** |

### Cause 3 — Membership Vague E1 (snapshot scoped identité auth) ✅ QA

| | |
|--|--|
| **Symptôme** | Logout A → login B : snapshot / chrome Resume / garde création de A survivait ou influençait B |
| **Fix** | `userId` + `authGeneration` sur snapshot · lectures scoped (`getMembershipSnapshotForUser`) · `handleMembershipAuthIdentityTransition` central dans `syncSessionToState` · `retain_found_same_identity` · rejet queries tardives cross-user |
| **Hors scope E1** | Sync cache actif ↔ snapshot (E2) · multi-onglets (E4) · leave polish (E3) · SQL atomicity (E5) |
| **Où** | `lobbyMembershipSnapshot.js` · `lobbyCreateGuard.js` · `supabaseAuth.js` · `home.js` · `lobby.js` · `auth.js` |
| **Preuve** | `tests/lobbyMembershipVagueE1.test.js` · suites A/B/C/D adaptées · **1119/1119** |
| **QA** | ✅ E1 validé 2026-07-28 |
| **Ne pas rouvrir** | Sans régression logout→login autre compte · snapshot cross-user · retain_found cross-user |

### Cause 3 — M-14a / SYN-14 TierNight topic / routing ✅ QA

| | |
|--|--|
| **Symptômes initiaux** | Hôte → ancien récap sur 2ᵉ liste ; invité saute choix tierlists |
| **Fix principal** | `14408da` *tiernight restart game bugfix* — `tierNightRecapBelongsToRun` (refuse end si `runId` ≠ récap) |
| **Où** | `js/core/tierNightConfig.js` · `js/core/gameSync.js` · `js/screens/tierNightEnd.js` |
| **Preuve** | `tests/tierNightRestartRecap.test.js` · `tests/tierNightLive.test.js` |
| **QA** | ✅ 2026-07-27 — Rank it · Recommencer · listes A→B→C · hôte + invité suivent le fil |
| **Ne pas rouvrir** | Sans régression démontrée (récap stale / skip choix liste) |

### Cause 3 / 4 / 7 / 8 — Guess Lie ✅ QA

| | |
|--|--|
| **Périmètre** | UX vote (Vague A/B1) · post-restart identité fantôme (M-15) · hypothèse L-05 |
| **UX — Vague A** | `voteCommitInFlight` + `myVote` + `voteConfirmChrome` ; pas de `saveStatePatch` MP avant RPC ; garde reveal ; rollback si RPC échoue |
| **UX — Vague B1** | `recordGuessLieRoundStats` **après** `await commitGuessLiePlay` |
| **Où (UX)** | `js/games/guessLie.js` · `js/core/guessLieSession.js` · `js/core/guessLieVoteCommit.js` · `js/core/voteConfirm.js` |
| **Preuve (UX)** | `tests/guessLieVoteUx.test.js` · `tests/guessLieVoteCommit.test.js` |
| **M-15 — Symptôme initial** | Après Recommencer : vote sur ses propres affirmations ; manche fantôme ; **pas** de fantôme `lobby_members` ; nouveau lobby corrige |
| **M-15 — Diagnostic** | Instrumentation `[GUESSLIE-ID]` (`guessLieGhostDiagnostic.js`, `guessLieIdentityDebug.js`) — diagnostic uniquement |
| **M-15 — Clôture** | **Non reproduit** avec instrumentation (OUT-5) : symptôme non observé lors des passes QA M-15a ; **aucun patch** M-15b/c/d |
| **L-05** | Hypothèse membership orpheline `lobby_members` **invalidée** pour ce repro — pas de L-05a–d |
| **Réouverture** | Régression démontrée avec log `[GUESSLIE-ID]` complet + classification A/B/C/D |
| **QA** | ✅ UX validé 2026-07-27 · ✅ fil Guess Lie clôturé 2026-07-27 |

### FEATURE-LOBBY-POLL — Sondages in-chat ✅ QA

| | |
|--|--|
| **Périmètre** | Sondages « prochain jeu » in-chat (`lobby_polls` / UI sheet FAB) — feature produit, hors file cause racine |
| **Où** | `js/core/lobbyPoll*.js` · `supabase/lobby-polls.sql` |
| **Preuve** | `tests/lobbyPollsAllowlist.test.js` · `tests/lobbyPollsVague2.test.js` · `tests/lobbyPollRejoinWatch.test.js` · `tests/lobbyPollRealtimeChannel.test.js` |
| **QA** | ✅ validé 2026-07-27 |

### Cause 11 / 4 — UX-VIBE-01 ✅ QA

| | |
|--|--|
| **Problème** | Après « Valider mon vote » : bouton reste primaire ; pas d’« en attente… » invité ; hôte sans `x/y` |
| **Cause** | Pas de modèle `selected`/`committed` ; condition UI `hasCommitted && selected === null` impossible car `syncFromSession` remet `selected = serverPick` ; pas de `voteConfirmChrome` |
| **Fix** | Aligner Hot Take/Dilemma : `myVote` + `selected = null` après commit ; `voteConfirmChrome` ; hint + force `(voted/total)` |
| **Où** | `js/games/playlistGuess.js` · `voteConfirm.js` |
| **QA** | ✅ validé 2026-07-26 |

### Cause 5 / 11 — UX-VIBE-02 ✅ QA

| | |
|--|--|
| **Problème** | Joueur ne peut pas rejoindre le menu des jeux pendant VibeCheck (‹ reboucle prep↔play ; exit enfoui ; Jeux sans suppress) |
| **Décision** | ‹ en **play** = même flux que la barre d’exit (`exitGameToGameSelect` + confirm). Invité Jeux = `returnToGameSelect` (suppress). Hôte Jeux en play = confirm arrêt |
| **Fix** | `handleBackNavigation` play → exit ; `goGames` play ; ordre vote = Valider/Attente → Révéler → Arrêter ; cumul **reveal only** |
| **Où** | `nav.js` · `bottomNav.js` · `playlistGuess.js` |
| **QA** | ✅ validé 2026-07-26 (layout exit + cumul refine) |

### Cause 5 — Routing / timing

| ID | Problème | Où | Action |
|----|----------|-----|--------|
| **ARCH-05** | `row.screen` en retard vs lobby | `mpLaunch.js` | 🟡 mitigé ; hors scope routing |

### Cause 7 — résidus

| ID | Problème | Où | Statut |
|----|----------|-----|--------|
| **M-14b** | `onLocalApplied` manquant | `mpLaunch.js` | Latent |
| **ARCH-07 / ARCH-08** | Catch / retry silencieux | Realtime, launch | Ouvert |

**Hors scope volontaire :** rollback votes dilemma/speedVote/truthMeter · `results.js` mount · (ARCH-22 ✅ clos)

### Cause 6 / 10 — SYN-05 / ARCH-18 ✅ QA

| | |
|--|--|
| **Problème** | Fil Rouge / Mot interdit dormant (`FIL_ROUGE_ENABLED`) : modules, sync, state, CSS et docs encore présents |
| **Décision** | Abandon définitif — pas de stubs d’architecture ; suppression applicative en 3 vagues |
| **Vague 1** | Modules UI/écrans orphelins ; gardes `isEveningGameplayPaused` retirées ; scoring mort ; CSS exclusif |
| **Vague 2** | Branches `gameSync` / propriétés `state` ; `data/filRouge.js` ; `stripLegacyFilRougeKeys` (LS non mutant) |
| **Vague 3** | CSS partagé → `prep-min-players*` ; message Traître ; docs actives ; tickets clôturés |
| **Preuve** | Contrats `filRougeVague1/2/3Cleanup.test.js` · suite **661/661** |
| **Hors scope** | SQL / table `fil_rouge_private` / clés RPC historiques / `is_lobby_host` — ops Supabase séparée |
| **QA** | ✅ validé 2026-07-26 (suppression applicative ; pas de feature réactivable) |

### Cause 8 — SYN-15 / SYN-16 ✅ QA

| | |
|--|--|
| **Fix** | `detectParticipantRenames` + migrate two-phase dans `applyLobbyToState` (avant `saveStatePatch` lobby) |
| **Maps** | `scores`/`gameScores` = Math.max · `playerStats` = maxStats · baseline = preferOld (I-09) |
| **Où** | `rosterRenameMigrate.js` · `replaceEveningScoreMaps` (`state.js`) · hook `supabaseLobby.js` |
| **Hors scope** | applyRemote* · prune · I-09 local · résidus SQL Fil Rouge (ops séparée) |
| **QA** | ✅ terrain rename multi-device |

### Cause 11 / affichage — UX-HIST-01 ✅ QA

| | |
|--|--|
| **Fix** | `getEveningStandingPlayers` = actifs ∪ contributeurs (`scores !== 0` ou clé `gameScores[*]`) |
| **Surfaces** | `eveningRecap` · `leaderboard` · `eveningGameLeaderboardsHtml` (par `gameId`) |
| **Inchangé** | `getActivePlayers` / `getSortedActivePlayers` (lobby, ready, présence, HUD) |
| **Limite** | parti avec seul `ensurePlayerScore` (0) exclu ; collision pseudo/UID hors scope |
| **QA** | ✅ validé 2026-07-26 |

### Cause 3 — UX-CLUTCH-01 ✅ QA

| | |
|--|--|
| **Fix** | Snapshot `participants: [{ userId, name }]` figé au lancement ; gates via `getClutchParticipantNames` |
| **Launch** | `executePrepLaunch` passe toujours `rosterNames` ; `markClutchLobbyStarted` exige le roster (`CLUTCH_ROSTER_REQUIRED`) |
| **Wire** | `clutchToRemote` / `FromRemote` + merge non destructif |
| **Leave** | Reste dans le snapshot jusqu’au verdict |
| **Rename** | I-09 migre `participants[].name` + taps ; résolution UID → nom live |
| **Hors scope** | Autres jeux live-roster · SYN-26 · UX-HIST-01 · `getActivePlayers` |
| **QA** | ✅ validé 2026-07-26 |

### Cause 11 — UX-RESUME-BANNER ✅ QA

| | |
|--|--|
| **Symptôme** | « Rester ici » sur bandeau game-select ne masquait pas le bandeau |
| **Fix** | `resumeBannerDismissedKey` (mémoire) + gate dans `shouldShowGameSelectResumeBanner` + `scheduleRender(true)` |
| **Routing** | `suppressRoutingForScoreView` inchangé |
| **Nouvelle session** | clear si `!éligible` ; re-show si clé `game:` / `family:` change |
| **Résidu** | interstitial lobby `#game-resume-stay` hors scope |
| **QA** | ✅ validé 2026-07-26 |

### Cause 8 — autres

| ID | Problème | Note |
|----|----------|------|
| **I-09 / SYN-06** | Rename mid-soirée — migration blobs locaux | ✅ QA |
| **ARCH-10** | Cache session clear trop tard au leave | 🟡 |

### Cause 6 — ARCH-06 ✅ QA

| | |
|--|--|
| **État** | **Clos 2026-07-27.** Mode A ✅ · Mode B ✅ · Mode C ✅ · Traître V2 ✅ · Lobby IIFE ✅ · SYN-12 ✅ |
| **Primitive B/C** | `createMountGuard()` dans `mountLifecycle.js` : `isMounted` / `isCurrentMount` / `dispose` ; compteur de génération **dans** lifecycle ; routeur appelle seulement `advanceMountGeneration()` (pas l’inverse) |
| **Règle post-await / listener** | `isMounted()` puis `isCurrentMount()` avant effet local ou nouveau commit. Commits déjà partis **non** annulés. Helpers métier : `shouldContinue()` opaque. |
| **Ne pas rouvrir** | Sans régression démontrée (handlers async / unmount / remount / double commit) |

#### Mode A

| | |
|--|--|
| **Scope** | launch / restart / PG+TierLive next · locks `withClickLock` (lobby ready/start, Traître hôte) |
| **QA** | ✅ validé 2026-07-27 |

#### Mode B

| Vague | Contenu | Statut |
|-------|---------|--------|
| **B0–B4** | `createMountGuard` · câblage · timers/RAF · tierNightLive | ✅ QA |

#### Mode C

| Vague | Contenu | Statut |
|-------|---------|--------|
| **C0–C3** | génération + double garde + shouldContinue TierNight + inventaire | ✅ QA |

#### Traître host V2 (étape 4)

| | |
|--|--|
| **Scope** | `js/games/traitre.js` hôte + acting host (`canActAsHost`) |
| **QA** | ✅ validé 2026-07-27 |

#### Lobby IIFE / SYN-12 (étape 5)

| | |
|--|--|
| **Scope** | `js/screens/lobby.js` bootstrap IIFE + listeners session/bundle |
| **Mode B/C** | `createMountGuard` ; double garde post-await IIFE + listeners ; `dispose` en tête cleanup |
| **Mode A** | `readyLock` / `startEveningLock` via `withClickLock` |
| **Helpers** | `routeToActiveGameIfNeeded({ shouldContinue })` · `rejoinGameResumeTarget` · `mountGameResumeInterstitial` (défaut historique) |
| **SYN-12** | contrat `planLobbyMountMultiplayerSync` inchangé (1× `startMultiplayerSync` pre-refresh) ; fuites post-await / remount corrigées |
| **Hors scope** | starts sync hydrate→hub hors `mountLobby` (résidu doc) · SQL/RPC/RLS |
| **Preuve** | `tests/arch06LobbyIife.test.js` · `tests/lobbyMountSyncPlan.test.js` |
| **QA** | ✅ validé 2026-07-27 |

**Preuve globale** : `tests/mountLifecycle.test.js` · `tests/routerNestedRedirect.test.js` · `tests/arch06TraitreHostV2.test.js` · `tests/arch06LobbyIife.test.js` · `tests/arch06ActionLocks.test.js`

**Résidu hors clôture** : starts sync hydrate → hub hors `mountLobby` (doc / opportunité, pas un trou lifecycle A/B/C du périmètre ARCH-06).

### Autres causes

| ID | Cause | Problème |
|----|-------|----------|
| **ARCH-01** | 1 | Démo locale sans avertissement MP |

---

## Clôtures & contrats (référence)

Ne pas rouvrir sans **régression démontrée**.

### Contrat produit (SYN-13b)

- **Retour** = sortie temporaire (reste membre, suit la progression)
- **Quitter → Menu des jeux** = sortie définitive du jeu courant (suit les jeux suivants)

### Contrat produit (UX-NAV-LOBBY) — 2026-07-27 · Vague A livrée 2026-07-28

- **Sans lobby actif** : Accueil / Home dans le menu (`BOTTOM_NAV_TAB.HOME`).
- **Avec lobby actif** (membre ou hôte) : Home **absent** du menu ; **Paramètres** à la place ; hub = onglet **Jeux** (`returnToEveningGames`).
- **Fin de membership** (Quitter membre / Fermer hôte) : `navigate("home", { reset: true })` — Accueil redevient accessible.
- **Écran Home en lobby** : non promu par le menu ; si monté (edge case), chrome `cached_active` (Retour au lobby) + membership query inchangée.
- **Join partiel (Home)** : retry pending compensation **avant** `queryActiveLobbyMembership` ; garde anti-restauration silencieuse de B ; bandeau conflit « Quitter B / Rejoindre B » si DELETE échoue.
- **Ne pas confondre** avec SYN-13b (sortie temporaire d’un *jeu* vs sortie du *lobby*).

### Chaînes utiles

```
Exit invité (M-06a ✅)
  → suppressSessionRoute
    → bandeau Rejoindre prep (ARCH-04 ✅)

Join mid-game (T-01 ✅) → SUBSCRIBED (T-02 ✅)

Mount lobby waiting (SYN-12 ✅) → 1× startMultiplayerSync pre-refresh
Mount lobby IIFE (ARCH-06 ✅) → createMountGuard + shouldContinue route/rejoin

Rename local (I-09 ✅) → roster observe rename (SYN-15/16 ✅) → maps evening migrées

Standings soirée (UX-HIST-01 ✅) → getEveningStandingPlayers (pas getSortedActivePlayers)
```

### Décision produit — égalités Wrong Answer Only

**Date :** 2026-07-25 · Pas une correction technique silencieuse.

| | |
|--|--|
| **Avant** | À égalité de votes, départage par la réponse enregistrée la plus tôt (`answers[name].at`) |
| **Décision** | Cette règle de départage temporel est **volontairement abandonnée** |
| **Désormais** | Seuls les votes déterminent le rang. Mêmes votes → même rang compétition (`1, 1, 3`) et même palier de points (`+15` / `+10` / `+5`) |
| **Doc joueur** | `data/gameRules.js` (`wronganswer.points`) aligné |

Clutch conserve son départage temporel (règle produit explicite inchangée).

### Historique fermé

`↻` = accepté / requalifié (pas un bug à fixer).

| Cause | Fermés (sélection) |
|-------|-------------------|
| 1 | C-01/02, R-01–05, M-05a |
| 2 | M-01, P-03, M-02a, S-02 |
| 3 | I-03/04, SYN-03, M-13, M-02b, ARCH-02, SYN-29, I-PG-01, ready stale Recommencer, UX-CLUTCH-01 · **M-15** · **L-05↻** · **Membership A–D** · **Membership Vague E1** · **M-14a / SYN-14** · **ARCH/BUG boundary** · **SYN/ARCH join partiel** |
| 4 | I-01/02/08, M-03b, M-06a/b, L-01, ARCH-03/03b, UX-VIBE-01, **Guess Lie** |
| 5 | T-01/02, T-03↻, M-07, M-08, P-02, SYN-28, I-PG-01, ARCH-04, UX-VIBE-02 · **Pré-résolution `get*EntryScreen`** (Vague A ; B1 non retenue) · **UX-NAV-LOBBY Vague A** |
| 6 | I-05, SYN-13b↻, SYN-25, **SYN-05 / ARCH-18** ✅, **ARCH-06** ✅ (Mode A/B/C · Traître V2 · Lobby IIFE · SYN-12) |
| 7 | I-07, M-09, L-09, M-11, M-10, T-05, SYN-26, M-04b / SYN-18 |
| 8 | I-06, P-02, ARCH-09, I-09 / SYN-06, SYN-15 / SYN-16 · **M-15** |
| 9 | SYN-12 / M-05b |
| 10 | **SYN-05 / ARCH-18** ✅ QA (Fil Rouge app ; SQL historique hors scope) |
| 11 | L-02, ARCH-21↻, M-12 (cleanup `#join=`, pas auto-join), UX-HIST-01, UX-RESUME-BANNER, UX-VIBE-01/02, **FEATURE-LOBBY-POLL** · **Membership A–D** · **Membership Vague E1** · **ARCH-22** · **Loader UI join** · **UX-NAV-LOBBY Vague A** · **SYN/ARCH join partiel** |

---

## Résidus connus

Hors tickets prioritaires — à traiter si opportunité / régression :

- Lobby `playing` si upsert échoue après `setLobbyPlaying` (M-11)
- `pushGameSession` passe encore `err.message` brut (L-09 mineur)
- Logs debug join dans `lobby.js`
- SYN-28 : `settings` hors scope ; course lobby `playing` vs session menu
- I-PG-01 : autres jeux sans podium dédié (hors scope)
- Policy debug lobby à purger côté Supabase si encore présente
- Optimistic votes hors Hot Take / VibeCheck / Dilemma (speedVote / … — même trou que T-05)
- Starts sync hydrate → hub hors `mountLobby` (résidu SYN-12, hors idempotence globale)
- Membership Vague **E2–E5** : contradiction cache+`none` · multi-onglets INSERT · flash UI post-leave · atomicité dissolve — **E1 logout/snapshot ✅**
- UX-NAV-LOBBY résidus : `navigate("home")` programmatique en lobby · piles `navStack` legacy avec `"home"` · QA terrain sortie/settings
- Join partiel : revert RPC reclaim anonymous · orphelin création lobby · E2E Supabase
- Homogénéisation launch hôte via getter post-mark (pré-résolution B1) — **étudiée, non retenue** (ROI insuffisant)
- Fil Rouge : résidus SQL historiques (`fil-rouge-private.sql`, clés RPC) — ops Supabase séparée, non faite

---

*Suivi vivant · Dernière MAJ : 2026-07-28 — **Membership Vague E1 ✅** · UX-NAV-LOBBY Vague A · SYN/ARCH join partiel · ARCH/BUG boundary · prochain = Membership Vague E2*
