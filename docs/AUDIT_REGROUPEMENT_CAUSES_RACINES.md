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

## Focus — 2026-07-27 (soir)

| | Contenu |
|--|---------|
| **Fait** | **Guess Lie** ✅ · **Sondages** ✅ · **ARCH-06** ✅ · **Membership A–D** ✅ · **M-14a / SYN-14** ✅ · **ARCH-22 A–C** (code) |
| **Prochain** | **ARCH-22** QA terrain Vague C · puis Loader UI join |
| **Ensuite** | Pré-résolution `get*EntryScreen` · Vague E (résidus membership) |

**Résidus (hors file prioritaire)**  
loader UI join · pré-résolution `get*EntryScreen` · votes optimistic (dilemma / speedVote / …) · `results.js` mount refresh · échec remote rename (doc QA I-09) · membership Vague E (voir ticket)

**Surveiller**  
Clutch taps figés sous latence (SYN-26) · ready prep après Recommencer · starts sync hydrate → hub hors `mountLobby` (hors périmètre lifecycle IIFE)

---

## File d’attente

### Prioritaires

| # | ID | Cause | Problème | Statut |
|---|----|-------|----------|--------|
| 1 | **ARCH-22** | 11 | Feedback sync lente | Vague C code ✅ — QA terrain |
| 2 | Loader UI join | 5/11 | Interstitiel join | Hors T-01/T-02 |
| 3 | Pré-résolution entry screens | 5 | `get*EntryScreen` (filet M-08 conservé) | Hors M-08 |

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
| 5 | Routing + timing sync | ✅ | ARCH-05 mitigé |
| 6 | Async écrans | ✅ QA | **ARCH-06** ✅ (Mode A/B/C · Traître V2 · Lobby IIFE · SYN-12) |
| 7 | Sync silencieuse / fire-and-forget | Partiel | ARCH-07/08, M-14b |
| 8 | Reset / migration incomplète | Partiel | I-09 ✅ ; SYN-15/16 ✅ ; ARCH-10 |
| 9 | Sync monolithe / duplication | Dette | ARCH-11… |
| 10 | Code mort | Dette | dead exports (hors Fil Rouge app) |
| 11 | Friction UX | Partiel | ARCH-22 ; L-04 |

---

## Détail des tickets ouverts

### Cause 11 — ARCH-22 feedback sync lente (soft pending)

| | |
|--|--|
| **Primitive** | `createSyncPending` (`js/core/syncPending.js`) — **API figée** : soft delay, tokens, `onChange` ; pas de libellés / DOM / locks |
| **Vague A** | Décisions produit (libellés contextuels, ~500 ms, V1 surfaces) |
| **Vague B** | Hot Take ✅ QA terrain |
| **Vague C** | Extension surfaces (code) — sans changer l’API |
| **Migré C** | Dilemma · Guess Lie · VibeCheck (`playlistGuess`) · `runLaunchButton` (« Lancement… » différé) |
| **Inchangé — Ready** | `usePrepLobby.toggleReady` reste **optimiste** (`readyCommitInFlight` bascule l’UI immédiatement). Un « Synchronisation… » différé dégraderait l’optimisme sans gain clair (toggle binaire déjà visible). **Aucun changement.** |
| **Inchangé — Recommencer** | `bindRestartGameButtons` / `restartGame` : verrou logique ARCH-06 ; bouton souvent remplacé / navigué pendant l’await ; soft « Lancement… » peu visible et complexity inutile. **Aucun changement.** |
| **Hors scope** | SpeedVote · TruthMeter · reveals · next round · host force · Realtime · `patchGameStateWithFeedback` / `withPatchTimeout` · ARCH-07/08 |
| **Preuve** | `tests/syncPending.test.js` · `hotTakeSyncPending` · `dilemmaSyncPending` · `guessLieSyncPending` · `playlistGuessSyncPending` · `runLaunchButtonSyncPending` |
| **QA** | B ✅ Hot Take · C ⏳ terrain (votes + launch) |
| **Résidus** | QA Vague C · éventuelle vague D hors périmètre (autres votes) |

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
| **Résidus → E** | Contradiction cache actif + snapshot `none` · logout / snapshot · multi-onglets INSERT · flash UI invalidate→confirm · atomicité dissolve héritée |

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

**Hors scope volontaire :** rollback votes dilemma/speedVote/truthMeter · `results.js` mount · (ARCH-22 soft pending : voir ticket Cause 11)

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
| 3 | I-03/04, SYN-03, M-13, M-02b, ARCH-02, SYN-29, I-PG-01, ready stale Recommencer, UX-CLUTCH-01 · **M-15** · **L-05↻** · **Membership A–D** · **M-14a / SYN-14** |
| 4 | I-01/02/08, M-03b, M-06a/b, L-01, ARCH-03/03b, UX-VIBE-01, **Guess Lie** |
| 5 | T-01/02, T-03↻, M-07, M-08, P-02, SYN-28, I-PG-01, ARCH-04, UX-VIBE-02 |
| 6 | I-05, SYN-13b↻, SYN-25, **SYN-05 / ARCH-18** ✅, **ARCH-06** ✅ (Mode A/B/C · Traître V2 · Lobby IIFE · SYN-12) |
| 7 | I-07, M-09, L-09, M-11, M-10, T-05, SYN-26, M-04b / SYN-18 |
| 8 | I-06, P-02, ARCH-09, I-09 / SYN-06, SYN-15 / SYN-16 · **M-15** |
| 9 | SYN-12 / M-05b |
| 10 | **SYN-05 / ARCH-18** ✅ QA (Fil Rouge app ; SQL historique hors scope) |
| 11 | L-02, ARCH-21↻, M-12 (cleanup `#join=`, pas auto-join), UX-HIST-01, UX-RESUME-BANNER, UX-VIBE-01/02, **FEATURE-LOBBY-POLL** · **Membership A–D** |

---

## Résidus connus

Hors tickets prioritaires — à traiter si opportunité / régression :

- Lobby `playing` si upsert échoue après `setLobbyPlaying` (M-11)
- `pushGameSession` passe encore `err.message` brut (L-09 mineur)
- Logs debug join dans `lobby.js`
- SYN-28 : `settings` hors scope ; course lobby `playing` vs session menu
- I-PG-01 : autres jeux sans podium dédié (hors scope)
- Policy debug lobby à purger côté Supabase si encore présente
- Optimistic votes hors Hot Take / VibeCheck (dilemma / speedVote / … — même trou que T-05)
- Starts sync hydrate → hub hors `mountLobby` (résidu SYN-12, hors idempotence globale)
- Membership Vague E : contradiction cache+`none` · logout/snapshot · multi-onglets INSERT · flash UI post-leave
- Fil Rouge : résidus SQL historiques (`fil-rouge-private.sql`, clés RPC) — ops Supabase séparée, non faite

---

*Suivi vivant · Dernière MAJ : 2026-07-27 — ARCH-22 Vague C (code)*
