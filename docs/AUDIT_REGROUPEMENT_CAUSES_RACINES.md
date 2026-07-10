# Audit REVEAL — Regroupement par cause racine

Document de synthèse consolidant :

- l’audit global de l’application ;
- l’audit approfondi du parcours invité ;
- le parcours invité simulé étape par étape ;
- les points absents ou implicites du premier regroupement.

**Mode : document de suivi — mis à jour au fil des patchs et validations QA.**
**Stack réelle :** vanilla JS + Supabase (Postgres + Realtime)

**Identité invité :** `state.user.isGuest` + `state.supabaseUserId` (auth anonyme Supabase). Pas de `guestId` ni `roomId`.

---

## Légende des références

| Préfixe | Source |
|---------|--------|
| **C-** | Critique (audit global) |
| **I-** | Important (audit global) |
| **M-** | Moyen (audit global) |
| **L-** | Faible (audit global) |
| **S-** | Sync (parcours invité) |
| **T-** | Timing (parcours invité) |
| **R-** | Reconnexion (parcours invité) |
| **P-** | Perte d’état (parcours invité) |
| **SYN-** | Audit sync (numérotation #1–#28) |
| **ARCH-** | Architecture / dette (audit explore) |

---

## Vue d’ensemble des causes racines

| # | Cause racine | Gravité dominante | Nb. problèmes |
|---|--------------|-------------------|---------------|
| 1 | Cycle de vie de l’identité invité fragile | Critique | 8 |
| 2 | Course entre auth et état local | Important | 4 |
| 3 | Sources de vérité multiples non alignées | Important | 9 |
| 4 | Asymétrie hôte / invité mal modélisée | Important | 10 |
| 5 | Routing invité complexe + timing sync | Important / Moyen | 10 |
| 6 | Cycle de vie async des écrans non maîtrisé | Important | 6 |
| 7 | Erreurs réseau silencieuses et sync fire-and-forget | Important | 10 |
| 8 | Opérations reset / migration incomplètes | Important / Moyen | 8 |
| 9 | Couche sync monolithique et duplication | Moyen | 12 |
| 10 | Dette technique et code mort | Faible | 7 |
| 11 | Friction produit / UX amplifiant les failles | Moyen | 5 |

**Total problèmes listés : 99** (certaines entrées apparaissent dans plusieurs causes par lien causal).

---

## Cause 1 — Cycle de vie de l’identité invité fragile

**Mécanisme :** toute récupération (lobby, membership, reconnexion) dépend de la persistance du JWT anonyme (`supabaseUserId`). Pas de re-liaison lobby ↔ invité indépendante de cet UUID.

Point de référence :
Les utilisateurs sont identifiés par leur UUID Supabase (`supabaseUserId`).
Il n'existe pas de re-liaison lobby ↔ invité indépendante de cet UUID actuellement.

## État actuel : Lobby / membership

### Corrigé aujourd'hui
- Création de lobby fonctionnelle
- Création du membre host via RPC `create_lobby_member`
- Join lobby fonctionnel pour :
  - utilisateur connecté
  - utilisateur anonyme
- Correction RLS sur `lobby_members`
- Ajout de la capacité pour un joueur de lire sa propre ligne après insertion (`auth.uid() = user_id`)
- Validation que le blocage venait du `.select().single()` avec policy SELECT insuffisante
- Policies finales attendues sur `lobby_members` :
  - `members_insert_self`
  - `members_select_same_lobby`
  - `members_update_self`
  - `members_delete_self`

Clôture QA :
- perte des clés Supabase `sb-*` validée : Turnstile remonte sans F5, session anonyme régénérée, lobby reclaim.
- rejoin avec le même pseudo validé pour le même invité ; pseudo identique refusé pour un autre invité réel.
- refresh / timing auth validé sans wipe local prématuré.
- carte / formulaire de reprise validés.
- échec de join avec code incorrect validé avec message persistant et lisible.
- garde-fou création lobby validé : impossible de créer un nouveau lobby sans quitter l'actuel.

À vérifier hors clôture Cause 1 :
- suppression de l'ancienne policy de debug `debug_allow_insert_lobby_members`
- remettre `.select().single()` après validation finale si ce n'est pas déjà fait côté Supabase

---

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **C-01** | Perte session anon → membership orpheline | `supabaseAuth.js`, `lobby.js`, `supabaseLobby.js` | JWT expiré / reset → nouveau `signInAnonymously()` → ancienne row `lobby_members` orpheline | Reconnexion impossible ; `display_name_taken` au re-join | Recovery par refresh token ; RPC re-liaison code+nom ; bouton hôte « libérer pseudo » | ✅ Corrigé + validé QA |
| **C-02** | `reconcileLobbyMembership` wipe si `!uid` | `lobby.js` — `reconcileLobbyMembership()` L338-340 | `inLobby` true mais uid momentanément absent au boot | Lobby effacé avant recovery | Attendre `recoverAuthSession()` avec timeout avant `forceClearClientLobbyState` | ✅ Corrigé + validé QA |
| **R-01** | = C-01 côté reconnexion | idem | idem | idem | idem C-01 | ✅ Corrigé + validé QA |
| **R-02** | Re-join `display_name_taken` | `supabaseLobby.js` — `joinLobbySupabase()` | Même pseudo, nouvel uid | Blocage join | Gestion d'une ancienne membership ou récupération session | ✅ Corrigé + validé QA |
| **R-03** | = C-02 | `lobby.js` | Race auth au boot | idem C-02 | idem C-02 | ✅ Corrigé + validé QA |
| **R-05 / L-03** | `peekServerLobbyForUser` invisible sans uid | `home.js` | Session cleared, pas de uid | Pas de carte « Reprendre la soirée » | Afficher rejoin par code même sans uid local ; guider reset ou re-auth | ✅ Corrigé + validé QA |
| **M-05a** | Échec join avec `hadSession: true` : auth conservée | `lobby.js` — `joinLobbyAsGuest()` | Join échoue mais session anon existante | Reste invité sans lobby, état ambigu | UX explicite + option sign out ; ou rollback conditionnel | ✅ Corrigé + validé QA |
| **ARCH-01** | Mode démo offline : pas de MP cross-device | `auth.js`, `lobby.js` | Invité local sans Supabase | Croit être en lobby, pas de sync réelle | Message explicite si Supabase non configuré | ↪️ Reporté : hors QA Supabase Cause 1 |

---

## Prochaine étape recommandée

### Phase suivante : stabilisation lobby realtime

À traiter avant les jeux :

1. Vérifier synchronisation `lobby_members`
   - arrivée d'un joueur visible instantanément
   - départ d'un joueur supprimé
   - refresh sans perte de lobby

2. Gestion du ready
   - update `ready`
   - synchronisation realtime
   - validation avant lancement

3. Gestion recovery session anon
   - éviter les memberships orphelines
   - éviter suppression automatique au boot
   - permettre reprise de soirée

---

## Symptômes utilisateur actuels à surveiller

- « Je ne peux plus rejoindre »
- « Mon pseudo est déjà pris »
- « Reprendre la soirée » absent
- « Réinitialiser l'app » seul recours
- Lobby créé mais perdu après refresh/session

---

## Cause 2 — Course entre auth et état local (écrasement profil)

**Mécanisme :** `onAuthStateChange` appelle `syncSessionToState()` sans coordination avec `signInAsGuest()` qui écrit le pseudo au join.

État QA :
- M-01 / P-03 validés : le pseudo invité reste stable au join, refresh et recovery.
- M-02a validé sur le chemin critique `commitPrepReadyToggle()` : le prêt immédiat est visible côté hôte.
- S-02 validé sur Hot Take : vote immédiat accepté, compteur hôte OK, pas de doublon pseudo + uid observé.
- Tests complémentaires des autres jeux validés côté QA : pas de symptôme visible de vote/prêt invisible ou doublon merge.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée |
|----|----------|-------------------|----------|--------|---------------------|
| **M-01** | Race nom profil vs pseudo join | `supabaseAuth.js` — `initSupabaseAuth()`, `syncSessionToState()`, `signInAsGuest()` | Profil Supabase écrase `user.name` après join | Pseudo lobby ≠ affiché | Ne pas écraser name si join récent ; séquentialiser auth |
| **P-03** | = M-01 côté perte état | idem | idem | idem | idem |
| **M-02a** | `userIdForName()` null → clé name | `gameSync.js` — `userIdForName()`, `mpLaunch.js` — `commitPrepReadyToggle()` | Participants stale après join | Votes/prêts clé name au lieu uid | Toujours utiliser `getSupabaseUserId()` ; bloquer actions MP jusqu’au refresh participants |
| **S-02** | = M-02a | `hotTakeSession.js` — `commitHotTakeVote()` | Vote avant refresh lobby | Doublon clés vote | idem |

**Symptômes utilisateur :** pseudo incorrect ; vote/prêt invisible ; doublons merge.

---

## Cause 3 — Sources de vérité multiples non alignées

**Mécanisme :** même donnée dans localStorage, `cachedRow`, Postgres, variables closure d’écran ; merges différents selon le chemin.

État patch / QA :
- `activeScoringGameId` reset : corrigé et couvert par test.
- Stats soirée MP : `clutchesPlayed`, `wrongAnswersPlayed` et activité distante alignés.
- `eveningGamesRecorded` : synchronisé dans l'état distant, fusionné sans régression locale.
- Résultats par jeu : un jeu terminé apparaît même sans point marqué ; réparation prévue pour les soirées déjà dans cet état.
- Clés joueur : écritures Supabase canonicalisées sur `userId`; les pseudos restent côté UI/local.
- Pages résultats / classement : reroute intempestive vers `game-select` corrigée pour les écrans post-partie.
- Trivia : podium final conservé sur l'écran `trivia`, puis passage explicite vers l'écran commun `results` ; QA dédiée encore à valider.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **M-03a** / **S-03** / **SYN-07** | Triple source : local / cache / Supabase | `state.js`, `gameSync.js` — `applyRemoteSession()`, `patchGameStateInner()` | Patch concurrent hôte/invité | Divergence transitoire phase/votes | Tests intégration merge ; documenter autorité | 🟡 Partiellement réduit : merges/votes/résultats renforcés, dette d'architecture restante |
| **I-03** / **P-04** | `activeScoringGameId` non reset | `state.js` — `resetScores()`, `getActiveScoringGame()` | Reset soirée puis nouvelle partie | Points crédités au mauvais jeu | `activeScoringGameId = null` dans reset | ✅ Corrigé + test |
| **I-04** / **S-04** / **SYN-02** | Stats soirée incomplètes en MP | `gameSync.js` — `eveningStateToRemote()` | `clutchesPlayed`, `wrongAnswersPlayed` absents du remote | Récap différent hôte/invité | Inclure tous champs stats dans remote | ✅ Corrigé + tests |
| **SYN-03** | `eveningGamesRecorded` local-only | `state.js` — `recordEveningGameOnce()` | Chaque client compte indépendamment | Stats gonflées | Sync dedup map ou dedup serveur | ✅ Corrigé + QA validée |
| **M-13** / **SYN-20** | `hasEveningStatsActivity()` incomplet | `state.js`, `lobby.js` | Clutch/Wrong Answer seuls joués | UI « pas d’activité » | Aligner conditions avec `defaultEveningStats()` | ✅ Corrigé + tests |
| **M-14a** / **SYN-14** | Topic TierNight éclaté | `state.js`, `gameSync.js`, `tierNightLiveSession.js` | Classic vs live | Topic incohérent après sync partiel | Source unique topic + apply cohérent | 🟡 Corrigé + tests ; QA Rank it validée, finalisation live + anti-flash + bootstrap récap + reset relance + snapshot live/placements fallback patchés, QA live à refaire |
| **M-02b** | Clés vote/prêt uid vs name | `gameSync.js`, `*-Session.js` | Fallback `userIdForName \|\| name` | Doublons jusqu’au refresh | Canonicaliser sur uid | ✅ Corrigé + QA validée |
| **ARCH-02** | Écran local vs session distante | `router.js`, `gameSync.js`, `games/trivia.js` | Routing vs affichage | Invité sur écran ≠ session serveur | Documenter ; réduire exceptions suppress | 🟡 Partiellement corrigé : post-game/résultats stabilisés, Trivia repasse par son podium avant `results`, QA Trivia à faire |
| **SYN-29** | Jeu terminé sans point absent des résultats | `state.js` — `recordEveningGameOnce()`, `gameScoreOrder` | Hot Take / autre jeu avec 0 point | Carte du jeu absente dans Résultats | Créer l'entrée résultat dès qu'un jeu est compté | ✅ Corrigé + QA validée |

**Symptômes utilisateur :** scores/récap incohérents ; points au mauvais jeu.

---

## Cause 4 — Asymétrie hôte / invité mal modélisée

**Mécanisme :** `isLobbyHost()` vs `canActAsHost()` ; plusieurs chemins supposent hôte réel ou traitent invité comme hôte local sans commit serveur.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée |
|----|----------|-------------------|----------|--------|---------------------|
| **I-01** | `completeGameSession` mauvais `host_id` | `gameSync.js` L3965-3991 | Acting guest termine partie | Metadata / RLS incohérente | Persister `lobby.hostId` dans `host_id` |
| **I-02** / **S-01** | Patch invité sans row `game_sessions` | `gameSync.js` — `patchGameStateInner()` L3573-3577 | Ready prep avant `startGameSession` | Erreur visible invité | Queue/retry ; no-op ready pré-session |
| **I-08** | RLS : tout membre peut UPDATE session | `supabase/game-sessions.sql` | Client modifié | Triche / corruption | RPC merge serveur ou policies restrictives |
| **M-03b** / **SYN-09** | `launchGameWithSync` branche non-hôte | `mpLaunch.js` L109-112 | Appel par erreur sur invité | UI locale divergente | Guard strict ; ne jamais applyLocal seul en MP |
| **M-06a** | Exit invité : pas `endGameSession` | `exitGame.js` — `exitGameToGameSelect()` | Quitter mid-game | Autres continuent (voulu) mais état local stale | + reset blobs locaux (voir P-02) |
| **M-06b** | `returnToGameSelect` asymétrique | `gameSync.js` | Hôte reset session ; invité suppress | Comportements différents | Documenter ; aligner reset local invité |
| **L-01** | « Recommencer » visible mais bloqué | `restartGame.js` | Invité clique Recommencer | Alert « Seul l'hôte » | Masquer bouton pour non-hôte |
| **ARCH-03** | Acting host sans metadata correcte | `hostPresence.js`, jeux sous `canActAsHost()` | Hôte absent > ~2 min | Fin manche possible, metadata fausse | Combiner I-01 + policy acting host |

**Symptômes utilisateur :** erreur prep ; fin partie acting host ; triche théorique ; asymétrie quit/return.

---

## Cause 5 — Routing invité complexe + timing synchronisation

**Mécanisme :** `shouldApplySessionRoute`, `suppressSessionRoute`, `getEffectiveSessionScreen` ; Realtime vs poll.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée |
|----|----------|-------------------|----------|--------|---------------------|
| **T-01** | Session absente au retry 0 ms au join | `supabaseLobby.js` — `restoreActiveGameSessionOnJoin()` | Join mid-game | Fenêtre sans session 0–400 ms | Retry plus agressif ou await obligatoire avant route |
| **M-04** / **T-02** | Realtime SUBSCRIBED catch-up agressif | `supabaseLobby.js` L974-977 | Reconnexion Realtime | Navigation avant paint lobby | Debounce route au subscribe ; loader interstitiel |
| **T-03** | Poll pausé en arrière-plan | `gameSync.js` — `initMultiplayerSyncVisibility()` | Tab hidden longtemps | Retard 3–12 s | Acceptable ; resubscribe au retour (déjà fait) |
| **M-07** / **SYN-** | `guesslie-menu` sans listener local | `guessLieMenu.js` | Invité sur menu, hôte lance | Retard suivi vs autres preps | Ajouter `onGameSessionChange` + `prepGuestFollowOnSession` |
| **M-08** / **SYN-13** | Redirect dans `mount*()` | `router.js`, `games/*.js` | Session désync | Flash UI, cleanup fragile | Router avant mount |
| **P-02** / **M-06c** | Exit invité sans reset blobs jeu | `exitGame.js` vs `returnToGameSelect()` | Quit prep/play volontaire | Stale state + suppress | `resetLocalGamePrepState()` côté invité |
| **SYN-28** / **L-nav** | `navAccess` suppress 15 min scores | `navAccess.js`, `gameSync.js` | Invité consulte classement, hôte relance | Pas de reroute nouvelle prep | Affiner `isSessionAdvancedFromSuppress` |
| **ARCH-04** | Suppress actif + même prep | `gameSync.js` — `shouldApplySessionRoute()` L328-330 | Sortie volontaire prep | Boucle évitée (OK) mais re-entry stale | Combiner avec P-02 |
| **ARCH-05** | `prepGuestFollowOnSession` fragile si `row.screen` en retard | `mpLaunch.js` | Relance pendant results | Mitigé par `getEffectiveSessionScreen` | Tests relance hôte |

**Symptômes utilisateur :** retard vs hôte ; bloqué sur écran ; rerouté intempestif.

---

## Cause 6 — Cycle de vie async des écrans non maîtrisé

**Mécanisme :** `unsub()` retire le listener ; promesses async en vol continuent après navigate away.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée |
|----|----------|-------------------|----------|--------|---------------------|
| **I-05** / **P-05** | Handlers async post-unmount | `traitre.js`, `tierNight.js`, `dilemma.js` | Nav rapide mid-sync | navigate/render fantôme | `let mounted = true` + early return |
| **SYN-05** | Listeners Fil Rouge globaux sans unsub | `filRougeToast.js`, `filRougeResultsModal.js` | Si réactivé | Work + rejections forever | Cleanup ou guard écran |
| **SYN-13b** | `traitre.js` listener reroute après sortie | `traitre.js` — `onGameSessionChange` L608-612 | Invité quitte traitre volontairement | Renvoyé vers traitre | Guard suppress + check écran intentionnel |
| **SYN-25** | `mountGuessLieMenu` return null sans cleanup | `guessLieMenu.js` | Navigate away pendant click | Handler sans listener session | Retourner cleanup ; listener follow |
| **ARCH-06** | Transitions rapides : handlers multiples en vol | `gameSync.js` listeners + router | Double mount | État incohérent | AbortController / mounted par écran |
| **M-08** | Early redirect mount sans cleanup propre | `router.js` L59-64 | Redirect imbriqué | `currentCleanup` ambigu | Routing pré-mount |

**Symptômes utilisateur :** bugs intermittents ; navigation fantôme.

---

## Cause 7 — Erreurs réseau silencieuses et sync fire-and-forget

**Mécanisme :** `void (async...)`, `.then()` sans `.catch()`, optimistic local sans rollback.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée |
|----|----------|-------------------|----------|--------|---------------------|
| **I-07** / **S-05** / **SYN-08** | Guess The Lie fire-and-forget | `guessLieSession.js`, `state.js` — `syncGuessLieLobbyCompleteRemote()` | Patch échoue au launch | Hôte en jeu, invités sur wait | Migrer vers `launchGameWithSync` |
| **M-09** / **T-04** / **SYN-11** | `commitPrepReadyToggle` sans try/catch | `mpLaunch.js` | Timeout patch ready | Rejection silencieuse | try/catch + rollback + toast |
| **M-10** / **SYN-10** | `syncPrepOnMount` sans catch | `prepScreen.js`, `dilemmaPrep.js`, `leaderboard.js` | Réseau down au mount | UI stale | `.catch()` + feedback |
| **M-11** / **SYN-17** | `restartGame` reset local avant remote | `restartGame.js` | `startGameSession` throw | Hôte prep vide, remote ancien | Remote d’abord ou rollback |
| **M-04b** / **SYN-18** | `withPatchTimeout` timers non cleared | `gameSync.js` | Votes intensifs | Accumulation timers | `clearTimeout` dans finally |
| **T-05** | Vote optimistic vs patch timeout | `hotTakeSession.js` — `commitHotTakeVote()` | Patch 20 s timeout | Vote local ≠ serveur | Rollback ou indicateur « sync… » |
| **SYN-26** | `clutch.js` tap sans catch | `clutch.js` | Tap sync fail | Unhandled rejection | `.catch()` sur handler |
| **M-14b** / **SYN-09b** | `onLocalApplied` absent si `localFirst: false` | `mpLaunch.js` L124-127 | Succès remote sans callback | Navigation manquante | Appeler `onLocalApplied` après succès |
| **ARCH-07** | Realtime catch `.catch(() => {})` silencieux | `supabaseLobby.js` L978 | Erreur refresh | Pas de feedback | Log + retry UI optionnel |
| **ARCH-08** | `commitMultiplayerLaunch` retry `void commit().catch()` | `mpLaunch.js` L131 | Launch fallback | Échec silencieux second commit | Metric / notify user |

**Symptômes utilisateur :** prêt/vote local non sync ; invités bloqués Guess Lie ; promises non gérées.

---

## Cause 8 — Opérations reset / migration incomplètes

**Mécanisme :** rename, reset soirée, leave game ne touchent pas tous les champs.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée |
|----|----------|-------------------|----------|--------|---------------------|
| **I-09** / **SYN-06** | `renameLocalPlayer` incomplet | `state.js` L430-499 | Rename mid-soirée | Votes/scores orphelins | Migrer tous `*Game` + `gameScores` |
| **I-06** / **P-01** | Reset ready à chaque mount lobby | `lobby.js`, `screens/lobby.js` L430-432 | Retour lobby avant soirée | Prêt local perdu | Reset seulement création lobby / action hôte |
| **P-02** | Exit invité blobs non cleared | `exitGame.js` | Quit partie | Stale prep state | `resetLocalGamePrepState()` |
| **SYN-15** | `applyRemotePlayerStats` double merge | `playerStatsSync.js` | Noms stale remote | State bloat | Merge participants only |
| **SYN-16** | `applyRemoteLobbyScores` idem | `gameSync.js` | Anciens membres | Scores fantômes | Filtrer par participants actifs |
| **I-03** | (aussi cause 3) reset scoring module | `state.js` | Reset scores | mauvais bucket | voir cause 3 |
| **ARCH-09** | `resetAllParticipantsReady` seulement local en Supabase | `lobby.js` L243-249 | Remount lobby | Ready DB peut différer | Sync ready depuis serveur au mount |
| **ARCH-10** | Leave lobby : `clearCachedGameSession` timing | `gameSync.js` | Leave mid-game | Cache stale bref | Ordre stop sync → clear → navigate |

**Symptômes utilisateur :** état incohérent après rename/quit/remount.

---

## Cause 9 — Couche sync monolithique et duplication

**Mécanisme :** `gameSync.js` ~4300 lignes ; patterns non factorisés entre jeux.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée |
|----|----------|-------------------|----------|--------|---------------------|
| **ARCH-11** | Monolithe `gameSync.js` | `gameSync.js` | Toute évolution | Régression, review difficile | Split merge / routing / serializers |
| **ARCH-12** | `isLocalLobbyHost()` ×3 | `lobby.js`, `traitrePrivate.js`, `tierNightSession.js` | Checks divergents | Comportement offline vs MP | Une seule export `isLobbyHost()` |
| **ARCH-13** | `userIdForDisplayName()` duplicate | `traitrePrivate.js` | Lookup participant | Incohérence mapping | Réutiliser `userIdForName()` |
| **SYN-22** | 11× `launch*Prep()` identiques | `restartGame.js` | Fix un jeu | Oublier les 10 autres | Factory `launchGamePrep(gameId)` |
| **SYN-23** | 10× `sync*Session` wrappers | `gameSync.js` | idem | Drift error handling | Helper générique |
| **SYN-24** | Pattern vote/reveal dupliqué | `games/*.js`, `sessionMerge.js` | Nouveau jeu | Copy-paste bugs | Hook `useGameSessionSync` vanilla |
| **M-05b** / **SYN-12** | Double `startMultiplayerSync` lobby | `screens/lobby.js` L398 + L435 | Mount lobby | Churn polling | Un seul appel |
| **SYN-21** / **ARCH-14** | `__trackSessionWrite` no-op | `gameSync.js` | Attente throttling | Fausse protection | Retirer ou implémenter |
| **ARCH-15** | `__writeTimes` diagnostic temporaire | `gameSync.js` | Prod | Bruit / confusion | Retirer ou flag dev |
| **SYN-27** / **ARCH-16** | `JSON.stringify` hot paths | `gameSync.js` — `applyRemoteSession()` | Poll fréquent | CPU mobile | Compare shallow / hash champs play |
| **ARCH-17** | Boilerplate prep screens | `*-prep.js` | Nouveau prep | Oublier guest follow | Composant prep base |
| **I-07** | Guess Lie hors pattern unifié | (voir cause 7) | idem | idem | idem |

**Symptômes utilisateur :** indirect — maintenance, régressions cross-jeux, perf mobile.

---

## Cause 10 — Dette technique et code mort

| ID | Problème | Fichier | Scénario | Impact | Correction proposée |
|----|----------|---------|----------|--------|---------------------|
| **ARCH-18** | Fil Rouge désactivé, code conservé | `data/filRouge.js`, `filRouge*.js`, `main.js` | Réactivation | Listeners globaux non nettoyés | Supprimer ou feature flag propre |
| **SYN-19** / **L-dead** | `recordLieGuess` jamais appelé | `state.js` | — | Confusion | Supprimer ou brancher |
| **L-dead-2** | `markGuessLieLobbyComplete` unused | `state.js` | — | idem | Supprimer |
| **ARCH-19** | Stats soirée commentées home | `home.js` — `homeStatsHtml()` | — | Dead code UI | Supprimer ou réactiver |
| **F-01** | Mode démo sans Supabase | `auth.js`, `lobby.js` | Test local | Pas de MP (voir ARCH-01) | Message UI |
| **ARCH-20** | `openLobbies` localStorage parallèle | `lobby.js` | Demo same-browser | Confusion prod vs demo | Isoler demo mode |
| **SYN-21** | Branche morte `__trackSessionWrite` | `gameSync.js` | — | Lisibilité | Nettoyer |

---

## Cause 11 — Friction produit / UX amplifiant les failles techniques

| ID | Problème | Fichier | Scénario | Impact | Correction proposée |
|----|----------|---------|----------|--------|---------------------|
| **M-12** | Lien `#join=` sans auto-join | `main.js`, `home.js` | Ouverture lien | Friction ; reste sur home | Auto-join si pseudo+code ; CTA explicite |
| **L-02** | Turnstile sur rejoin inutile | `home.js`, `turnstile.js` | Session anon existante | Friction rejoin | Skip captcha si `hadSession` |
| **L-04** | « Réinitialiser l'app » = seul recours | `lobby.js`, `home.js` | Blocage invité | UX dégradée | Fix cause 1 réduit le besoin |
| **ARCH-21** | Invité ne peut pas créer lobby | `auth.js` — `canCreateLobby()` | — | Comportement voulu | Copy UI claire |
| **ARCH-22** | Pas de feedback sync lente invité | Global | Poll seul actif | Impression freeze | Indicateur « Sync… » / latence |

---

## Chaînes causales (effet domino)

```
JWT perdu (C-01)
  → reconcileLobbyMembership wipe (C-02)
    → re-join display_name_taken (R-02)
      → « Réinitialiser l'app » (L-04)

Participants stale (M-02a)
  → userIdForName null
    → vote clé name (S-02)
      → merge vote incomplet (M-03a)

Hôte absent > 2 min (ARCH-03)
  → canActAsHost invité
    → completeGameSession mauvais host_id (I-01)
      → fin partie / metadata cassée

Exit invité (M-06a)
  → suppressSessionRoute (cause 5)
    → blobs locaux non reset (P-02)
      → re-entrée prep stale (ARCH-04)

Join mid-game (T-01)
  → session absente 0 ms
    → Realtime SUBSCRIBED route (T-02)
      → navigation avant données complètes
```

---

## Matrice cause → gravité

La matrice ci-dessous liste les points encore ouverts ou résiduels. Les éléments corrigés restent historisés dans chaque section de cause.

| Cause | Critique | Important | Moyen | Faible |
|-------|----------|-----------|-------|--------|
| 1 Identité invité | C-01, C-02 | R-01–R-03, L-03 | M-05a | ARCH-01 |
| 2 Auth race | — | M-01, M-02a, S-02 | — | — |
| 3 Multi-sources | — | — | M-03a (résiduel), ARCH-02 (résiduel QA Trivia podium → results), M-14a (QA TierNight live à valider) | — |
| 4 Hôte/invité | — | I-01, I-02, I-08 | M-03b, M-06a-c | L-01 |
| 5 Routing/timing | — | T-02, P-02 | T-01, T-03, M-07, M-08 | SYN-28 |
| 6 Async écrans | — | I-05 | SYN-13b, SYN-25 | SYN-05, M-08 |
| 7 Erreurs silencieuses | — | I-07, M-09, M-11 | M-10, T-05, M-14b | SYN-26 |
| 8 Reset incomplet | — | I-09, I-06 | SYN-15, SYN-16 | ARCH-09, ARCH-10 |
| 9 Monolithe/dup | — | — | SYN-12, SYN-22–24 | ARCH-11–17, SYN-21, SYN-27 |
| 10 Dette | — | — | — | ARCH-18–20, SYN-19 |
| 11 UX | — | M-12 | ARCH-22 | L-02, L-04 |

---

## Top 10 corrections prioritaires (état actuel)

| # | ID(s) | Cause | Pourquoi |
|---|-------|-------|----------|
| 1 | I-02, S-01 | 4 | Erreur immédiate en prep invité |
| 2 | I-07, S-05 | 7 | Seul jeu avec launch non fiable |
| 3 | I-05, SYN-13b, SYN-25 | 6 | Bugs intermittents navigation |
| 4 | I-06, P-01 | 8 | UX lobby invité dégradée |
| 5 | I-01 | 4 | Fin partie acting host fragile |
| 6 | I-08 | 4 | Sécurité intégrité session MP |
| 7 | ARCH-02 | 3, 5 | Résiduel à valider sur le flux Trivia podium → résultats communs |
| 8 | M-14a, SYN-14 | 3 | QA live à valider sur le topic TierNight après validation Rank it |
| 9 | T-02, P-02 | 5 | Navigation possible avant données complètes ou avec blobs locaux obsolètes |
| 10 | M-12 | 11 | Dette UX importante après les corrections de stabilité |

---

## Éléments exclus volontairement (forces / descriptifs)

Non listés comme problèmes — présents dans les audits comme points positifs ou documentation :

| Élément | Fichier / zone |
|---------|----------------|
| `notify()` anti-réentrance + `NOTIFY_MAX_DRAIN` | `gameSync.js` |
| Garde-fous merge par phase | `sessionMerge.js` |
| Cleanup routeur `currentCleanup()` | `router.js` |
| `runLaunchButton` + `btn?.isConnected` | `mpLaunch.js` |
| `confirmMissingSessionThenRoute` | `gameSync.js` |
| `handleLobbyDissolvedForGuest` + guard | `lobby.js` |
| `prepGuestFollowOnSession` + `getEffectiveSessionScreen` | `mpLaunch.js`, `gameSync.js` |
| Debounce lobby refresh 250 ms | `supabaseLobby.js` |
| **R-04** — reprise F5 OK si JWT intact | Parcours invité (happy path) |
| Cartographie listeners / tables Supabase | Parcours invité (doc) |
| Matrice capacités hôte vs invité | Parcours invité (doc) |

---

## Index croisé audit initial → cause racine

| Audit initial | Cause(s) |
|---------------|----------|
| C-01, C-02 | 1 |
| I-01 | 4 |
| I-02 | 4 |
| I-03 | 3, 8 |
| I-04 | 3 |
| I-05 | 6 |
| I-06 | 8 |
| I-07 | 7, 9 |
| I-08 | 4 |
| I-09 | 8 |
| M-01 | 2 |
| M-02 | 2, 3 |
| M-03 (#7) | 3 |
| M-03 (#9) | 4 |
| M-04 | 5 |
| M-05 (hadSession) | 1 |
| M-05 (#12 double sync) | 9 |
| M-06 | 4, 5, 8 |
| M-07 | 5 |
| M-08 | 5, 6 |
| M-09 | 7 |
| M-10 | 7 |
| M-11 | 7 |
| M-12 | 11 |
| M-13 | 3 |
| M-14 (TierNight) | 3 |
| M-14 (onLocalApplied) | 7 |
| L-01 | 4 |
| L-02 | 11 |
| L-03 | 1 |
| L-04 | 11 |
| SYN #1–#28 | Voir sections par ID SYN-XX |
| T-01–T-05 | 5, 7 |
| R-01–R-05 | 1 |
| S-01–S-05 | 3, 4, 7 |
| P-01–P-05 | 2, 5, 6, 8 |

---

*Document généré à partir des audits du 2026-07-06. Aucun fichier applicatif modifié.*
