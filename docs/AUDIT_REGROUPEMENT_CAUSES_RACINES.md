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
| **ARCH-01** | Mode démo offline : pas de MP cross-device | `auth.js`, `lobby.js`, `screens/lobby.js` | Invité local sans Supabase | Croit être en lobby, pas de sync réelle | Message explicite si Supabase non configuré | 🟡 Partiel : hint « Démo locale… » présent ; pas d’avertissement explicite « pas de MP cross-device » ; hors QA Supabase Cause 1 |

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

## Cause 2 — Course entre auth et état local (écrasement profil) ✅ Corrigé + QA validée

**Mécanisme :** `onAuthStateChange` appelle `syncSessionToState()` sans coordination avec `signInAsGuest()` qui écrit le pseudo au join.

État QA :
- M-01 / P-03 validés : le pseudo invité reste stable au join, refresh et recovery.
- M-02a validé sur le chemin critique `commitPrepReadyToggle()` : le prêt immédiat est visible côté hôte.
- S-02 validé sur Hot Take : vote immédiat accepté, compteur hôte OK, pas de doublon pseudo + uid observé.
- Tests complémentaires des autres jeux validés côté QA : pas de symptôme visible de vote/prêt invisible ou doublon merge.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **M-01** | Race nom profil vs pseudo join | `supabaseAuth.js` — `initSupabaseAuth()`, `syncSessionToState()`, `signInAsGuest()` | Profil Supabase écrase `user.name` après join | Pseudo lobby ≠ affiché | Ne pas écraser name si join récent ; séquentialiser auth | ✅ Corrigé + QA validée |
| **P-03** | = M-01 côté perte état | idem | idem | idem | idem | ✅ Corrigé + QA validée |
| **M-02a** | `userIdForName()` null → clé name | `gameSync.js` — `userIdForName()`, `mpLaunch.js` — `commitPrepReadyToggle()` | Participants stale après join | Votes/prêts clé name au lieu uid | Toujours utiliser `getSupabaseUserId()` ; bloquer actions MP jusqu’au refresh participants | ✅ Corrigé + QA validée |
| **S-02** | = M-02a | `hotTakeSession.js` — `commitHotTakeVote()` | Vote avant refresh lobby | Doublon clés vote | idem | ✅ Corrigé + QA validée |

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
- Trivia : podium final conservé sur l'écran `trivia`, puis passage explicite vers l'écran commun `results` ; QA validée.
- Consensus / Hot Take fin MP : parcours podium in-game → « Voir les résultats » → récap soirée (**I-PG-01** clôturé QA 2026-07-22) ; Trivia déjà sur ce contrat.
- Cause 3 considérée clôturée pour les flux validés, hors TierNight isolé en KO QA.
- TierNight : KO QA au 2026-07-10. Résidus confirmés : l'hôte est encore renvoyé vers l'ancien récap pendant le tri de sa seconde tierlist ; l'invité ne voit pas l'écran de choix des tierlists et passe directement du choix des modes à la saisie de sa tierlist. Les patchs précédents restent testés mais ne résolvent pas le scénario réel ; investigation suspendue pour avancer sur les autres tests.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **M-03a** / **S-03** / **SYN-07** | Triple source : local / cache / Supabase | `state.js`, `gameSync.js` — `applyRemoteSession()`, `patchGameStateInner()` | Patch concurrent hôte/invité | Divergence transitoire phase/votes | Tests intégration merge ; documenter autorité | ✅ Stabilisé sur les flux QA validés ; dette d'architecture suivie hors Cause 3 |
| **I-03** / **P-04** | `activeScoringGameId` non reset | `state.js` — `resetScores()`, `getActiveScoringGame()` | Reset soirée puis nouvelle partie | Points crédités au mauvais jeu | `activeScoringGameId = null` dans reset | ✅ Corrigé + test |
| **I-04** / **S-04** / **SYN-02** | Stats soirée incomplètes en MP | `gameSync.js` — `eveningStateToRemote()` | `clutchesPlayed`, `wrongAnswersPlayed` absents du remote | Récap différent hôte/invité | Inclure tous champs stats dans remote | ✅ Corrigé + tests |
| **SYN-03** | `eveningGamesRecorded` local-only | `state.js` — `recordEveningGameOnce()` | Chaque client compte indépendamment | Stats gonflées | Sync dedup map ou dedup serveur | ✅ Corrigé + QA validée |
| **M-13** / **SYN-20** | `hasEveningStatsActivity()` incomplet | `state.js`, `lobby.js` | Clutch/Wrong Answer seuls joués | UI « pas d’activité » | Aligner conditions avec `defaultEveningStats()` | ✅ Corrigé + tests |
| **M-14a** / **SYN-14** | Topic TierNight éclaté | `state.js`, `gameSync.js`, `tierNightLiveSession.js`, `tierNightSelect.js` | Classic vs live + relance | Topic/routing incohérent après sync partiel | Hôte renvoyé vers ancien récap pendant la 2e tierlist ; invité saute le choix des tierlists | Source unique topic + routage par run courant + flow invité choix mode → choix tierlist → saisie | ❌ KO QA : tests unitaires OK mais scénario réel non résolu ; investigation suspendue, à reprendre plus tard |
| **M-02b** | Clés vote/prêt uid vs name | `gameSync.js`, `*-Session.js` | Fallback `userIdForName \|\| name` | Doublons jusqu’au refresh | Canonicaliser sur uid | ✅ Corrigé + QA validée |
| **ARCH-02** | Écran local vs session distante | `router.js`, `gameSync.js`, `games/consensus.js`, `games/hotTake.js`, `games/trivia.js` | Routing vs affichage ; fin de partie | Invité sur écran ≠ session ; prep réinférée (corrigé) ; podium sauté (corrigé I-PG-01) | Contrat Trivia : stay-on-game puis `completeGameSession(results)` | ✅ Consensus + Hot Take + Trivia alignés (I-PG-01, 2026-07-22) |
| **SYN-29** | Jeu terminé sans point absent des résultats | `state.js` — `recordEveningGameOnce()`, `gameScoreOrder` | Hot Take / autre jeu avec 0 point | Carte du jeu absente dans Résultats | Créer l'entrée résultat dès qu'un jeu est compté | ✅ Corrigé + QA validée |

**Symptômes utilisateur :** scores/récap incohérents ; points au mauvais jeu.

---

## Cause 4 — Asymétrie hôte / invité mal modélisée

**Mécanisme :** `isLobbyHost()` vs `canActAsHost()` ; plusieurs chemins supposent hôte réel ou traitent invité comme hôte local sans commit serveur.

État patch / QA (2026-07-22) :
- **L-01** — bouton « Recommencer » masqué pour non-hôte ; visible côté hôte.
- **M-03b** — guard launch : invité ne démarre pas une UI locale divergente ; seul l’hôte lance.
- **M-06b** — `returnToGameSelect` : hôte reset session remote ; invité quitte sans terminer pour les autres, peut suivre une relance.
- **M-06a** — exit mid-game invité sans `endGameSession` ; bandeau « Rejoindre la partie en cours » + reprise immédiate depuis le cache.
- **I-01** — acting host termine la partie : `host_id` = hôte réel du lobby ; QA acting host OK.
- **I-02** déjà clôturé (2026-07-11).
- Ouverts : **I-08** (RLS UPDATE session), **ARCH-03** (policy acting host — metadata I-01 OK, couche policy encore à traiter).

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **I-01** | `completeGameSession` mauvais `host_id` | `gameSync.js` | Acting guest termine partie | Metadata / RLS incohérente | Persister `lobby.hostId` dans `host_id`, fallback sur acteur si absent | ✅ Corrigé + validé QA (acting host, 2026-07-22) |
| **I-02** / **S-01** | Patch invité sans row `game_sessions` | `gameSync.js`, `mpLaunch.js` | Ready prep avant `startGameSession` | Erreur visible invité | No-op local si invité sans session distante | ✅ Corrigé + QA validée (prep invité sans session, 2026-07-11) |
| **I-08** | RLS : tout membre peut UPDATE session | `supabase/game-sessions.sql` | Client modifié | Triche / corruption | RPC merge serveur ou policies restrictives | À traiter |
| **M-03b** / **SYN-09** | `launchGameWithSync` branche non-hôte | `mpLaunch.js` | Appel par erreur sur invité | UI locale divergente | Guard strict ; ne jamais applyLocal seul en MP | ✅ Corrigé + validé QA (2026-07-22) |
| **M-06a** | Exit invité : pas `endGameSession` | `exitGame.js` — `exitGameToGameSelect()` | Quitter mid-game | Autres continuent (voulu) mais état local stale | Chemin invité aligné sur `returnToGameSelect()` ; bouton Rejoindre réhydrate depuis le cache puis navigue immédiatement | ✅ Corrigé + validé QA (rejoin banner, 2026-07-22) |
| **M-06b** | `returnToGameSelect` asymétrique | `gameSync.js`, `nav.js` | Hôte reset session ; invité suppress | Comportements différents | `returnToGameSelect()` nettoie aussi l'invité ; retour depuis prep réutilise ce chemin | ✅ Corrigé + validé QA (2026-07-22) |
| **L-01** | « Recommencer » visible mais bloqué | `restartGame.js` | Invité clique Recommencer | Alert « Seul l'hôte » | Masquer bouton pour non-hôte | ✅ Corrigé + validé QA (2026-07-22) |
| **ARCH-03** | Acting host sans metadata correcte | `hostPresence.js`, jeux sous `canActAsHost()` | Hôte absent > ~2 min | Fin manche possible, metadata fausse | Combiner I-01 + policy acting host | 🟡 Partiel : metadata `host_id` (I-01) validée QA ; policy acting host encore à traiter |

**Symptômes utilisateur :** erreur prep ; fin partie acting host ; triche théorique ; asymétrie quit/return.

---

## Cause 5 — Routing invité complexe + timing synchronisation

**Mécanisme :** `shouldApplySessionRoute`, `suppressSessionRoute`, `getEffectiveSessionScreen` ; Realtime vs poll.

État patch / QA (SYN-28, 2026-07-22) :
- Invariant générique `guestMustFollowSession` : invité encore membre + sync actif + cible prep/play + écran local ≠ cible → suivi obligatoire depuis `results`, `leaderboard`, `home`, `game-select`.
- `sig_unchanged` ne bloque plus une retentative si `mustFollow` (session déjà observée ≠ navigation réussie).
- Suppress scores : avancement détecté même avec baseline `suppressScreen`/`suppressSig` nulle ; `suppressSessionRoute` n’enregistre plus un timer sans écran.
- Listener `home` : plus de court-circuit sur `isSessionRouteSuppressed()` avant `routeToActiveGameIfNeeded`.
- **Cause racine finale QA :** `routeLog` renvoyait `logSessionRouteDecision()` (`undefined`) → `handleSessionRoute` traitait `guest_must_follow` comme refus (`allowed: false`, `nestedReason: "guest_must_follow"`). Correctif : `routeLog` retourne le booléen `allowed`.
- QA validée : relance hôte (ex. Hot Take / Speed Vote) depuis `results` / `leaderboard` / `home` / `game-select` → invité rejoint `*-prep` sans F5 ; hors lobby / même écran → pas de navigation.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **T-01** | Session absente au retry 0 ms au join | `supabaseLobby.js` — `restoreActiveGameSessionOnJoin()` | Join mid-game | Fenêtre sans session 0–400 ms | Retry plus agressif ou await obligatoire avant route | À traiter |
| **M-04** / **T-02** | Realtime SUBSCRIBED catch-up agressif | `supabaseLobby.js` L974-977 | Reconnexion Realtime | Navigation avant paint lobby | Debounce route au subscribe ; loader interstitiel | À traiter |
| **T-03** | Poll pausé en arrière-plan | `gameSync.js` — `initMultiplayerSyncVisibility()` | Tab hidden longtemps | Retard 3–12 s | Acceptable ; resubscribe au retour (déjà fait) | 🔄 Accepté / requalifié — dette produit volontaire ; ne plus prioriser |
| **M-07** / **SYN-** | `guesslie-menu` sans listener local + hub post-soumission inutile | `guessLieMenu.js` | Invité déjà prêt bloqué sur « Salon d'attente… » | Retard suivi / friction UX | Redirect auto vers `guesslie-wait` + `onGameSessionChange` / `prepGuestFollowOnSession` | ✅ Corrigé (2026-07-22) |
| **M-08** / **SYN-13** | Redirect dans `mount*()` | `router.js`, `games/*.js`, `guessLieMenu.js` | Session désync | Flash UI, cleanup fragile | Router avant mount | À traiter (résidu early redirect Guess Lie inclus) |
| **P-02** / **M-06c** | Exit invité sans reset blobs jeu | `exitGame.js` vs `returnToGameSelect()` | Quit prep/play volontaire | Stale state + suppress | `returnToGameSelect()` centralise suppress + reset blobs côté invité | ✅ Corrigé + validé QA (avec M-06a/M-06b, 2026-07-22) |
| **SYN-28** / **L-nav** | Suivi invité hub / post-partie | `gameSync.js` — `guestMustFollowSession`, `shouldApplySessionRoute`, `applyRemoteSession`, `handleSessionRoute` ; `home.js`, `results.js`, `leaderboard.js` | Invité sur `results`/`leaderboard`/`home`/`game-select`, hôte relance prep | Banner lobby à jour mais pas de nav vers `*-prep` ; F5 seul recours | Invariant `mustFollow` + retry `sig_unchanged` + contrat retour booléen `routeLog` ; tests `guestMustFollow`, `shouldApplyReturnContract`, suppress/sig | ✅ Corrigé + validé QA (2026-07-22) ; `settings` hors scope |
| **I-PG-01** | Confusion résultat jeu vs récap soirée | `games/consensus.js`, `games/hotTake.js`, `games/trivia.js` | Fin de partie MP | Podium in-game sauté ; `screen: "results"` immédiat | Stay-on-game `phase: "final"` + CTA « Voir les résultats » → `completeGameSession({ screen: "results" })` ; `game_id: "menu"` inchangé | ✅ Corrigé + validé QA (Consensus A + Hot Take B2, 2026-07-22) ; autres jeux hors scope |
| **ARCH-04** | Suppress actif + même prep | `gameSync.js` — `shouldApplySessionRoute()` L328-330 | Sortie volontaire prep | Boucle évitée (OK) mais re-entry stale | Combiner avec P-02 | À traiter |
| **ARCH-05** | `prepGuestFollowOnSession` fragile si `row.screen` en retard | `mpLaunch.js` | Relance pendant results | Mitigé par `getEffectiveSessionScreen` + `guestMustFollow` / retry sig | Tests relance hôte (couverts via SYN-28) | 🟡 Mitigé par SYN-28 ; retard Event A (lobby) vs Event B (session) hors scope routing |

**Symptômes utilisateur :** retard vs hôte ; bloqué sur écran ; rerouté intempestif.

---

## Cause 6 — Cycle de vie async des écrans non maîtrisé

**Mécanisme :** `unsub()` retire le listener ; promesses async en vol continuent après navigate away.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **I-05** / **P-05** | Handlers async post-unmount | `traitre.js`, `tierNight.js`, `dilemma.js` | Nav rapide mid-sync | navigate/render fantôme | `mountAlive` / `alive` / `unmounted` + guards post-`await` (résidus `resolveVoteRound` finally, `advanceTierNight…` `isMounted`, RAF dilemma) | ✅ Corrigé + clôturé (2026-07-22) |
| **SYN-05** | Listeners Fil Rouge globaux sans unsub | `filRougeToast.js`, `filRougeResultsModal.js` | Si réactivé | Work + rejections forever | Cleanup ou guard écran | À traiter (dormant : `FIL_ROUGE_ENABLED=false`) ; lié à ARCH-18 |
| **SYN-13b** | Confusion Retour vs Quitter (reroute après « sortie ») | `traitre.js` / routing suppress — ticket initial : listener après sortie | Interprété à tort comme bug de re-pull | — | Contrat produit clarifié (voir ci-dessous) | ✅ QA validée / faux positif de qualification (contrat produit clarifié, 2026-07-22) |
| **SYN-25** | `mountGuessLieMenu` return null sans cleanup | `guessLieMenu.js` | Navigate away pendant click | Handler sans listener session | Retourner cleanup ; listener follow | ✅ Corrigé (2026-07-22) : listener + `unsub` sur chemin interactif ; early `return null` post-redirect → suivi via **M-08** |
| **ARCH-06** | Transitions rapides : handlers multiples en vol | `gameSync.js` listeners + router | Double mount | État incohérent | AbortController / mounted par écran | À traiter (guards partiels Traitre / Dilemma / TierNight) |
| **M-08** | Early redirect mount sans cleanup propre | `router.js` L59-64 | Redirect imbriqué | `currentCleanup` ambigu | Routing pré-mount | 🔁 Doublon de **M-08 / SYN-13** (cause 5) — une seule fiche |

**SYN-13b — contrat produit retenu (clôture) :**
- **Retour** : sortie temporaire ; le joueur reste membre de la partie ; il continue à suivre la progression lorsque la partie avance.
- **Quitter la partie → Menu des jeux** : sortie définitive du jeu courant ; le joueur ne revient plus dans ce jeu ; il rejoint automatiquement les jeux suivants.
- QA : les deux comportements sont conformes. Plus de scénario fonctionnel reproductible justifiant de maintenir SYN-13b ouvert.
- **Indépendants (ne pas fusionner) :** I-05, M-08 (résidu redirect), bug Fake / scoring.

**Symptômes utilisateur :** bugs intermittents ; navigation fantôme.

---

## Cause 7 — Erreurs réseau silencieuses et sync fire-and-forget

**Mécanisme :** `void (async...)`, `.then()` sans `.catch()`, optimistic local sans rollback.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **I-07** / **S-05** / **SYN-08** | Guess The Lie fire-and-forget | `guessLieSession.js`, `state.js` — `syncGuessLieLobbyCompleteRemote()` | Patch échoue au launch | Hôte en jeu, invités sur wait | `launchGameWithSync` + sync legacy attendable | ✅ Corrigé + QA validée (2026-07-11) |
| **M-09** / **T-04** / **SYN-11** | `commitPrepReadyToggle` sans try/catch | `mpLaunch.js`, `prepReadyMaps.js` | Timeout / offline patch ready | Prêt local ≠ serveur ; rejet silencieux | try/catch + rollback + `patchGameStateWithFeedback` | ✅ Corrigé + QA validée (2026-07-11) ; bloc B (message réseau) clôturé avec L-09 (2026-07-12) |
| **L-09** | Message patch / alerte réseau incompréhensible | `authErrors.js`, `dialog.js`, `patchGameStateFeedback.js` | Offline / fetch fail | Alert « TypeError: failed to fetch » ; titre jeu incohérent | `formatSyncErrorMessage` + titre « Connexion » si erreur réseau | ✅ Corrigé + QA (2026-07-12) ; 🟡 résidu mineur : `pushGameSession` passe encore `err.message` (reformatté ensuite par `showAppAlert`) |
| **M-10** / **SYN-10** | `syncPrepOnMount` sans catch | `prepScreen.js`, `dilemmaPrep.js`, `leaderboard.js` | Réseau down au mount | UI stale | `.catch()` + feedback | À traiter (confirmé code 2026-07-22) |
| **M-11** / **SYN-17** | `restartGame` reset local avant remote | `restartGame.js`, `restartGameRollback.js` | `startGameSession` throw | Hôte prep vide, remote ancien | Snapshot + rollback en catch ; clear Traitre private après succès | ✅ Corrigé + validé QA (2026-07-22) ; résidu hors scope : lobby `playing` si upsert échoue après `setLobbyPlaying` |
| **M-04b** / **SYN-18** | `withPatchTimeout` timers non cleared | `gameSync.js` | Votes intensifs | Accumulation timers | `clearTimeout` dans finally | À traiter (confirmé : `Promise.race` sans `clearTimeout`) |
| **T-05** | Vote optimistic vs patch timeout | `hotTakeSession.js` — `commitHotTakeVote()` | Patch 20 s timeout | Vote local ≠ serveur | Rollback ou indicateur « sync… » | À traiter (optimistic local sans rollback) |
| **SYN-26** | `clutch.js` tap sans catch | `clutch.js` | Tap sync fail | Unhandled rejection | `.catch()` sur handler | À traiter |
| **M-14b** / **SYN-09b** | `onLocalApplied` absent si `localFirst: false` | `mpLaunch.js` L124-127 | Succès remote sans callback | Navigation manquante | Appeler `onLocalApplied` après succès | À traiter (latent : Guess Lie use `localFirst: true`) |
| **ARCH-07** | Realtime catch `.catch(() => {})` silencieux | `supabaseLobby.js` (catch-up `SUBSCRIBED`) | Erreur refresh | Pas de feedback | Log + retry UI optionnel | À traiter |
| **ARCH-08** | `commitMultiplayerLaunch` retry `void commit().catch()` | `mpLaunch.js` L131 | Launch fallback | Échec silencieux second commit | Metric / notify user | À traiter |

**Symptômes utilisateur :** prêt/vote local non sync ; invités bloqués Guess Lie ; promises non gérées.

---

## Cause 8 — Opérations reset / migration incomplètes

**Mécanisme :** rename, reset soirée, leave game ne touchent pas tous les champs.

Revue code (2026-07-22) : **I-06 / ARCH-09** corrigés (mount non destructif) ; **P-02** et **I-03** déjà couverts ailleurs ; **I-09** partiel.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **I-09** / **SYN-06** | `renameLocalPlayer` incomplet | `state.js` — `renameLocalPlayer()` | Rename mid-soirée | Votes/scores orphelins | Migrer tous `*Game` + `gameScores` | 🟡 Partiel : scores/stats + HotTake/Dilemma/Consensus/GuessLie submissions/TierNight recaps OK ; manque `gameScores` + plusieurs `*Game` |
| **I-06** / **P-01** | Reset ready à chaque mount lobby | `screens/lobby.js`, `lobby.js` — `resetAllParticipantsReady()` | Retour lobby avant soirée | Prêt local perdu | Reset seulement création lobby / action hôte | ✅ Corrigé + **QA validée** (2026-07-22) : mount → `reconcileLobbyReadyOnMount()` (non destructif) |
| **P-02** | Exit invité blobs non cleared | `exitGame.js` | Quit partie | Stale prep state | `resetLocalGamePrepState()` via `returnToGameSelect()` | ✅ / 🔁 Doublon M-06a–c (clôturé QA 2026-07-22) |
| **SYN-15** | `applyRemotePlayerStats` double merge | `playerStatsSync.js` | Noms stale remote | State bloat | Merge participants only | À traiter |
| **SYN-16** | `applyRemoteLobbyScores` idem | `gameSync.js` | Anciens membres | Scores fantômes | Filtrer par participants actifs | À traiter |
| **I-03** | (aussi cause 3) reset scoring module | `state.js` | Reset scores | mauvais bucket | `activeScoringGameId = null` dans reset | ✅ Corrigé + test (voir cause 3) |
| **ARCH-09** | `resetAllParticipantsReady` seulement local en Supabase | `lobby.js`, `lobbyReadyMount.js` | Remount lobby | Ready DB peut différer | Sync ready depuis serveur au mount | ✅ Léger + **QA validée** (2026-07-22) : refresh bundle au mount, pas de wipe DB |
| **ARCH-10** | Leave lobby : `clearCachedGameSession` timing | `lobby.js` — `leaveLobby()` | Leave mid-game | Cache stale bref | Ordre stop sync → clear → navigate | 🟡 Partiel : sync stoppé d’abord ; cache clear seulement après `await leaveLobbySupabase()` |

**Symptômes utilisateur :** état incohérent après rename/quit/remount.

---

## Cause 9 — Couche sync monolithique et duplication

**Mécanisme :** `gameSync.js` ~4800+ lignes ; patterns non factorisés entre jeux.

| ID | Problème | Fichier / fonction | Scénario | Impact | Correction proposée | Statut |
|----|----------|-------------------|----------|--------|---------------------|--------|
| **ARCH-11** | Monolithe `gameSync.js` | `gameSync.js` (~4829 LOC) | Toute évolution | Régression, review difficile | Split merge / routing / serializers | À traiter (dette) |
| **ARCH-12** | `isLocalLobbyHost()` ×3 | `lobby.js`, `traitrePrivate.js`, `tierNightSession.js` | Checks divergents | Comportement offline vs MP | Une seule export `isLobbyHost()` | À traiter (logiques divergentes confirmées) |
| **ARCH-13** | `userIdForDisplayName()` duplicate | `traitrePrivate.js` | Lookup participant | Incohérence mapping | Réutiliser `userIdForName()` | À traiter |
| **SYN-22** | 11× `launch*Prep()` identiques | `restartGame.js` | Fix un jeu | Oublier les 10 autres | Helper local `commitPrepSessionLaunch` (M-11) ; factory optionnelle plus tard | 🟡 Réduit par M-11 (2026-07-12) ; ~12 wrappers restent |
| **SYN-23** | 10× `sync*Session` wrappers | `gameSync.js` | idem | Drift error handling | Helper générique | À traiter (~14 wrappers) |
| **SYN-24** | Pattern vote/reveal dupliqué | `games/*.js`, `sessionMerge.js` | Nouveau jeu | Copy-paste bugs | Hook `useGameSessionSync` vanilla | À traiter |
| **M-05b** / **SYN-12** | Double `startMultiplayerSync` lobby | `screens/lobby.js` | Mount lobby | Churn polling | Un seul appel | À traiter (L417 + L454 si pas de resume) |
| **SYN-21** / **ARCH-14** | `__trackSessionWrite` no-op / faux throttle | `gameSync.js` | Attente throttling | Fausse protection | Retirer ou implémenter | 🟡 Partiel : log loop warn ≥12/3s ; toujours `return false` (pas de throttle) |
| **ARCH-15** | `__writeTimes` diagnostic temporaire | `gameSync.js` | Prod | Bruit / confusion | Retirer ou flag dev | À traiter |
| **SYN-27** / **ARCH-16** | `JSON.stringify` hot paths | `gameSync.js` — `applyRemoteSession()` | Poll fréquent | CPU mobile | Compare shallow / hash champs play | À traiter |
| **ARCH-17** | Boilerplate prep screens | `*-prep.js`, `prepScreen.js` | Nouveau prep | Oublier guest follow | Composant prep base | 🟡 Partiel : helpers partagés ; chaque prep duplique encore le mount |
| **I-07** | Guess Lie hors pattern unifié | (voir cause 7) | idem | idem | `launchGameWithSync` | ✅ Corrigé + QA validée (2026-07-11) |

**Symptômes utilisateur :** indirect — maintenance, régressions cross-jeux, perf mobile.

---

## Cause 10 — Dette technique et code mort

| ID | Problème | Fichier | Scénario | Impact | Correction proposée | Statut |
|----|----------|---------|----------|--------|---------------------|--------|
| **ARCH-18** | Fil Rouge désactivé, code conservé | `data/filRouge.js`, `filRouge*.js`, `main.js` | Réactivation | Listeners globaux non nettoyés | Supprimer ou feature flag propre | À traiter (lié SYN-05) |
| **SYN-19** / **L-dead** | `recordLieGuess` jamais appelé | `state.js` | — | Confusion | Supprimer ou brancher | À traiter (zéro call site ; live = `recordGuessLieRoundStats`) |
| **L-dead-2** | `markGuessLieLobbyComplete` unused | `state.js` | — | idem | Supprimer | À traiter (launch via `applyGuessLieLobbyCompleteLocal`) |
| **ARCH-19** | Stats soirée commentées home | `home.js` — `homeStatsHtml()` | — | Dead code UI | Supprimer ou réactiver | À traiter |
| **F-01** | Mode démo sans Supabase | `auth.js`, `lobby.js` | Test local | Pas de MP (voir ARCH-01) | Message UI | 🔁 Doublon / voir **ARCH-01** (🟡 partiel) |
| **ARCH-20** | `openLobbies` localStorage parallèle | `lobby.js` | Demo same-browser | Confusion prod vs demo | Isoler demo mode | À traiter |
| **SYN-21** | Branche morte `__trackSessionWrite` | `gameSync.js` | — | Lisibilité | Nettoyer | 🔁 Doublon **SYN-21 / ARCH-14** (cause 9) |

---

## Cause 11 — Friction produit / UX amplifiant les failles techniques

| ID | Problème | Fichier | Scénario | Impact | Correction proposée | Statut |
|----|----------|---------|----------|--------|---------------------|--------|
| **M-12** | Lien `#join=` sans auto-join | `main.js`, `home.js` | Ouverture lien | Friction ; reste sur home | Auto-join si pseudo+code ; CTA explicite | À traiter (préremplissage seul) |
| **L-02** | Turnstile sur rejoin inutile | `home.js`, `supabaseAuth.js` | Session anon existante | Friction rejoin | Skip captcha si `hadSession` | ✅ Corrigé (skip si `getLiveSupabaseUserId` / session anon) |
| **L-04** | « Réinitialiser l'app » = seul recours | `lobby.js`, `home.js` | Blocage invité | UX dégradée | Fix cause 1 réduit le besoin | 🟡 Partiel : Cause 1 a réduit le besoin ; bouton encore très visible |
| **ARCH-21** | Invité ne peut pas créer lobby | `auth.js` — `canCreateLobby()` | — | Comportement voulu | Copy UI claire | 🔄 Requalifié — règle produit ; copy déjà claire |
| **ARCH-22** | Pas de feedback sync lente invité | Global | Poll seul actif | Impression freeze | Indicateur « Sync… » / latence | À traiter |

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

La matrice ci-dessous liste les points encore ouverts ou résiduels **après revue code 2026-07-22**. Les éléments corrigés / requalifiés restent historisés dans chaque section de cause.

| Cause | Critique | Important | Moyen | Faible |
|-------|----------|-----------|-------|--------|
| 1 Identité invité | — | — | — | ARCH-01 (🟡 partiel, hors QA Supabase) |
| 2 Auth race | — | — | — | — |
| 3 Multi-sources | — | — | M-14a (KO QA TierNight — suspendu) | — |
| 4 Hôte/invité | — | I-08 | — | ARCH-03 (🟡 policy acting host) |
| 5 Routing/timing | — | T-02 | T-01, M-08, ARCH-04 | ARCH-05 (🟡 mitigé SYN-28) |
| 6 Async écrans | — | — | ARCH-06 | SYN-05 (dormant) |
| 7 Erreurs silencieuses | — | — | M-10, T-05, M-14b, M-04b | SYN-26, ARCH-07, ARCH-08 |
| 8 Reset incomplet | — | — | I-09 (🟡), SYN-15, SYN-16 | ARCH-10 (🟡) |
| 9 Monolithe/dup | — | — | SYN-12, SYN-23–24 | ARCH-11–16, SYN-21 (🟡), SYN-22 (🟡), ARCH-17 (🟡), SYN-27 |
| 10 Dette | — | — | — | ARCH-18–20, SYN-19, L-dead-2 |
| 11 UX | — | M-12 | ARCH-22 | L-04 (🟡) |

**Requalifiés / clôturés hors matrice :** T-03 (accepté), L-02 (corrigé), ARCH-21 (contrat produit), SYN-25 / M-07 (corrigés), P-02 / I-03 (déjà couverts).

---

## Top 10 corrections prioritaires (état actuel — post-revue 2026-07-22)

| # | ID(s) | Cause | Pourquoi |
|---|-------|-------|----------|
| 1 | **I-08** | 4 | Sécurité : tout membre peut UPDATE `game_sessions` |
| 2 | **ARCH-03** | 4 | Policy acting host manquante (metadata I-01 OK) ; traiter avec/après I-08 |
| 3 | **T-01** + **M-04 / T-02** | 5 | Join / Realtime : route possible avant données complètes |
| 4 | **M-08 / SYN-13** | 5 | Redirects in-mount (résidu Guess Lie / préps) |
| 5 | **M-10** + **T-05** + **SYN-26** | 7 | Sync silencieuse / optimistic sans rollback |
| 6 | **I-09 / SYN-06** | 8 | Rename mid-soirée incomplet — corruption d’état partielle |
| 7 | **M-12** | 11 | Lien `#join=` sans auto-join |
| 8 | **ARCH-04** | 5 | Re-entry prep bloquée par suppress après sortie volontaire |
| 9 | **M-05b / SYN-12** | 9 | Double `startMultiplayerSync` au mount lobby |
| 10 | **M-14a / SYN-14** | 3 | KO QA TierNight — suspendu ; remonter si priorité produit |

**Retirés du Top 10 :** I-06 / P-01 + ARCH-09 (✅ 2026-07-22) ; SYN-25, M-07 (✅) ; SYN-22–24 (dette).

### Clôtures récentes (2026-07-11)

- **I-07 / S-05 / SYN-08** — Guess The Lie : `launchGameWithSync`, QA E1 OK
- **M-09 / T-04 / SYN-11** — Toggle prêt prep : rollback + feedback ; QA blocs A/C/D/E OK
- **I-02 / S-01** — Prep invité sans `game_sessions` : QA bloc C OK

### Clôtures récentes (2026-07-12)

- **L-09** — Messages réseau FR (`formatSyncErrorMessage`, titre « Connexion » dans `showAppAlert`)
- **M-09** — Clôture complète (message réseau inclus)
- **M-11 / SYN-17** — `commitPrepSessionLaunch` + rollback 12 jeux ; Traitre : clear private après succès ; tests `restartGameRollback`
- **Consensus prep** — `finishConsensusGame` → `screen: "results"` + `game_id=menu` (inférence `consensus-prep` corrigée) ; régression podium → **I-PG-01** (clôturé 2026-07-22)
- **SYN-28 volet 2 (partiel)** — `results.js` / `leaderboard.js` : `routeToActiveGameIfNeeded` ; tests `postGameScreenFollow` (QA complète → 2026-07-22)

### Clôtures récentes (2026-07-22)

- **I-05 / P-05** — ✅ Corrigé + clôturé : résidus post-démontage fermés
  - `traitre.js` : `resolveVoteRound` `finally` ne `render()` plus si `!mountAlive`
  - `tierNight.js` / `advanceTierNightToResultsWhenReady` : option `isMounted` sur finishGame, forceResults, listener session
  - `dilemma.js` : guard `unmounted` avant `render()` de la dernière frame RAF
  - Flags de mount déjà en place ; ne pas fusionner avec M-08 (redirect) ni Fake/scoring
- **SYN-13b** — ✅ QA validée / faux positif de qualification (contrat produit clarifié)
  - **Retour** = sortie temporaire (reste membre, suit la progression)
  - **Quitter → Menu des jeux** = sortie définitive du jeu courant (pas de retour dans ce jeu ; suit les jeux suivants)
  - Les QA confirment les deux comportements ; plus de scénario fonctionnel reproductible
  - Ne pas fusionner avec **I-05**, **M-08**, ni le bug Fake / scoring
- **SYN-28** — Suivi invité générique hub/post-partie sans F5 ; QA validée (`results` / `leaderboard` / `home` / `game-select` → `*-prep`)
  - `guestMustFollowSession` + early allow dans `shouldApplySessionRoute`
  - retry navigation sur `sig_unchanged` si écran local ≠ cible force-follow
  - suppress scores / home listener (plus de gate `isSessionRouteSuppressed` avant route)
  - **contrat `routeLog` → booléen `allowed`** (bug : `undefined` → `handleSessionRoute` refusait malgré `guest_must_follow`)
  - tests : `guestMustFollow`, `shouldApplyReturnContract`, `scoresSuppressFollow`, `sessionRouteSigRetry`
- **Cause 4 (asymétrie hôte/invité)** — QA validée :
  - **L-01** — « Recommencer » masqué pour invité
  - **M-03b / SYN-09** — guard launch non-hôte
  - **M-06b** — `returnToGameSelect` hôte vs invité
  - **M-06a** (+ **P-02 / M-06c**) — exit mid-game + bandeau Rejoindre
  - **I-01** — acting host / `host_id` = hôte réel du lobby
  - Résidus Cause 4 : **I-08** (RLS), **ARCH-03** (policy acting host)
- **I-PG-01** — Fin de partie podium → récap soirée ; QA validée :
  - **Consensus (étape A)** — `finishConsensusGame` stay-on-game + `showEveningResults`
  - **Hot Take (B2)** — phase `"final"` + podium + reset uniquement à la clôture
  - Trivia déjà conforme ; autres jeux hors scope ; ne pas rouvrir sans régression démontrée
- **M-11 / SYN-17** — Rollback « Recommencer » si `startGameSession` échoue ; QA validée ; ne pas rouvrir sauf régression
  - Résidu hors scope : lobby peut rester `playing` si upsert échoue après `setLobbyPlaying`
- **Hygiène logs SYN-28** — retrait instrumentation temporaire `[SESSION-ROUTE]` / `hub-prep-v5` ; contrat `routeLog → boolean` conservé

### Revue code vs audit (2026-07-22, soir)

Comparaison tickets encore ouverts ↔ code actuel (aucune fermeture automatique hors constat) :

- **I-06 / P-01** + **ARCH-09** — ✅ Corrigé + **QA validée** (2026-07-22 soir) :
  - Invité prêt → quitte lobby → revient → reste prêt
  - Remount répété / refresh page / sync croisée ready serveur OK
  - Nouveau lobby / nouvel invité non prêt sans écraser les autres
  - Lancement soirée inchangé ; multi-joueurs OK ; console propre
  - Non applicable QA : « hôte quitte lobby » (ferme pour tous) ; « retour lobby après jeu » (pas de retour lobby une fois la soirée lancée)
  - **Ne plus rouvrir / ne plus modifier ce périmètre** sans régression démontrée
- **SYN-25** — ✅ Corrigé : `guessLieMenu.js` listener + cleanup ; early redirect suivi via **M-08**
- **M-07** — ✅ confirmé corrigé (déjà noté) ; retiré du Top 10 / matrice ouverte
- **L-02** — ✅ Turnstile rejoin skip si session anon live
- **T-03** — 🔄 Accepté / requalifié (dette volontaire)
- **ARCH-21** — 🔄 Requalifié (règle produit, copy OK)
- **P-02** (cause 8) / **I-03** — ✅ / 🔁 déjà couverts (M-06 / cause 3)
- **F-01** — 🔁 voir ARCH-01 ; **SYN-21** cause 10 — 🔁 voir ARCH-14
- Confirmés **toujours ouverts** : I-08, T-01, T-02, M-08, M-10, T-05, SYN-26, M-14a, M-12, ARCH-04, SYN-12, etc. (voir matrice)

### Résidus connus (hors scope des patchs 2026-07-22)

- **M-11 résidu** — lobby `playing` si upsert échoue après `setLobbyPlaying` (hors rollback local)
- **L-09 partiel** — `pushGameSession` passe encore `err.message` ; reformattage réseau déjà dans `showAppAlert`
- **Dette debug** — logs `[DEBUG JOIN LOBERY START]` dans `lobby.js` (hors campagne SESSION-ROUTE)
- **SYN-28 hors scope** — écran `settings` ; retard éventuel lobby `playing` vs row `game_sessions` encore menu (Cas B)
- **I-PG-01 hors scope** — autres jeux qui clôturent encore directement vers `results` sans podium dédié (pas touchés sans preuve)
- **M-14a** — KO QA TierNight toujours présent dans le code ; investigation suspendue
- **ARCH-05** — mitigé SYN-28 ; course Event A (lobby) vs Event B (session) hors scope routing

---

## Éléments exclus volontairement (forces / descriptifs)

Non listés comme problèmes — présents dans les audits comme points positifs ou documentation :

| Élément | Fichier / zone |
|---------|----------------|
| `formatSyncErrorMessage` + titre « Connexion » sur erreurs réseau | `authErrors.js`, `dialog.js`, `patchGameStateFeedback.js` |
| `notify()` anti-réentrance + `NOTIFY_MAX_DRAIN` | `gameSync.js` |
| Garde-fous merge par phase | `sessionMerge.js` |
| Cleanup routeur `currentCleanup()` | `router.js` |
| `runLaunchButton` + `btn?.isConnected` | `mpLaunch.js` |
| `confirmMissingSessionThenRoute` | `gameSync.js` |
| `handleLobbyDissolvedForGuest` + guard | `lobby.js` |
| `prepGuestFollowOnSession` + `getEffectiveSessionScreen` | `mpLaunch.js`, `gameSync.js` |
| Suivi hub/post-partie : `guestMustFollowSession` + `routeToActiveGameIfNeeded` | `gameSync.js`, `results.js`, `leaderboard.js`, `home.js`, `gameSelect.js` |
| Podium in-game → récap soirée (Trivia / Consensus / Hot Take) | `games/trivia.js`, `games/consensus.js`, `games/hotTake.js` |
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
| L-09 | 7, 11 |
| I-PG-01 | 3, 5 |
| SYN #1–#28 | Voir sections par ID SYN-XX |
| T-01–T-05 | 5, 7 |
| R-01–R-05 | 1 |
| S-01–S-05 | 3, 4, 7 |
| P-01–P-05 | 2, 5, 6, 8 |

---

*Document généré à partir des audits du 2026-07-06. Dernière mise à jour suivi : 2026-07-22 (revue code vs tickets ouverts).*
