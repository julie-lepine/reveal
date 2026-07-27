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

!!!!! QUID DE "JE CREE UN LOBBY", JE NE LE DEMARRE PAS, J'EN RELANCE UN AUTRE ET SUIS DONC COINCE CAR JE SUIS TJRS CONSIDERE DANS LE 1ER MAIS JE NE LE VOIS PAS DANS MON INTERFACE DE CO

SONDAGE A FERMER PAR LE CREATEUR ET PAS QUE L HOTE

## Focus — 2026-07-27 (PM)

| | Contenu |
|--|---------|
| **Fait** | **Guess Lie UX** ✅ · diagnostic **L-05 joueur fantôme** (requalif. bug vote post-restart) |
| **Prochain** | **L-05** (conception lifecycle lobby/membership) · **M-14a / SYN-14** (TierNight — suspendu) ou **ARCH-22** |
| **Ensuite** | Loader UI join · pré-résolution `get*EntryScreen` |

**Hors file audit**  
Sondages in-chat (`lobby_polls` / UI chat) — feature produit, pas un ticket cause racine.

**Résidus (hors file prioritaire)**  
loader UI join · pré-résolution `get*EntryScreen` · votes optimistic (dilemma / speedVote / …) · `results.js` mount refresh · échec remote rename (doc QA I-09) · instrumentation debug `[GUESSLIE-ID]` (optionnel, hors fix)

**Surveiller**  
Clutch taps figés sous latence (SYN-26) · ready prep après Recommencer · starts sync hydrate → hub hors `mountLobby` (hors périmètre lifecycle IIFE)

---

## File d’attente

### Prioritaires

| # | ID | Cause | Problème | Statut |
|---|----|-------|----------|--------|
| 1 | **L-05** | 1/8 | Joueur fantôme — membership anonyme orpheline après déconnexion ou nouvelle session | Conception |
| 2 | **M-14a / SYN-14** | 3 | TierNight topic / routing | ❌ KO QA — suspendu |
| 3 | Loader UI join | 5/11 | Interstitiel join | Hors T-01/T-02 |
| 4 | Pré-résolution entry screens | 5 | `get*EntryScreen` (filet M-08 conservé) | Hors M-08 |
| 5 | **ARCH-22** | 11 | Pas de feedback sync lente | Ouvert |

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
| 1 | Identité invité / JWT | Partiel | ARCH-01 partiel · **L-05** orphan membership |
| 2 | Race auth / profil | ✅ QA | — |
| 3 | Sources de vérité multiples | ✅ hors TierNight | **M-14a** suspendu · UX-CLUTCH-01 ✅ |
| 4 | Asymétrie hôte / invité | ✅ QA | Guess Lie UX ✅ |
| 5 | Routing + timing sync | ✅ | ARCH-05 mitigé |
| 6 | Async écrans | ✅ QA | **ARCH-06** ✅ (Mode A/B/C · Traître V2 · Lobby IIFE · SYN-12) |
| 7 | Sync silencieuse / fire-and-forget | Partiel | ARCH-07/08, M-14b |
| 8 | Reset / migration incomplète | Partiel | I-09 ✅ ; SYN-15/16 ✅ ; ARCH-10 · **L-05** prune roster |
| 9 | Sync monolithe / duplication | Dette | ARCH-11… |
| 10 | Code mort | Dette | dead exports (hors Fil Rouge app) |
| 11 | Friction UX | Partiel | ARCH-22 ; L-04 |

---

## Détail des tickets ouverts

### Cause 1 / 8 — L-05 — Joueur fantôme — membership anonyme orpheline après déconnexion ou nouvelle session

**Identifiant :** `L-05` · **Causes :** 1 (identité invité) + 8 (reset / migration) · **Statut :** Conception — diagnostic confirmé 2026-07-27 · **Aucun patch applicatif avant validation de la stratégie.**

#### Problème confirmé

Une ligne `lobby_members` peut rester présente alors que le client correspondant n’est plus actif. Le roster affiche alors **deux identités pour un même humain** : l’ancienne membership fantôme et la nouvelle membership active.

**Scénario terrain confirmé (navigation privée) :**

1. Un invité rejoint un lobby depuis une fenêtre de navigation privée.
2. Sa session anonyme possède un premier UID.
3. La fenêtre privée est fermée **sans** appel fiable à `leaveLobbySupabase()`.
4. La ligne `lobby_members` reste présente.
5. Une nouvelle fenêtre privée crée un **nouvel UID** anonyme.
6. Le reclaim ne peut pas fonctionner : le stockage local précédent (`reveal-guest-membership`) a disparu.
7. Le même humain rejoint avec une **nouvelle membership**.
8. Le roster contient l’ancienne identité fantôme **et** la nouvelle identité active.

**Conséquence observée :** Guess Lie a interprété les deux lignes comme deux joueurs distincts et a produit une manche incohérente (affirmations / vote attribués à l’ancienne identité).

**Périmètre du ticket :** lifecycle **lobby / membership** uniquement. **Hors scope :** correctifs Guess Lie (`isSubject`, helpers UID, merge submissions) tant que la duplication roster n’est pas résolue.

#### Cause racine

| Mécanisme | Comportement actuel |
|-----------|---------------------|
| `leaveLobbySupabase()` | Ne s’exécute pas de manière fiable lors d’une fermeture d’onglet, d’un crash ou d’une perte réseau |
| Heartbeat (`last_seen_at`) | Met uniquement `last_seen_at` à jour — **ne supprime jamais** la row |
| Éviction individuelle | **Aucune** suppression automatique d’un membre stale |
| Reclaim invité | Dépend du stockage local (`reveal-guest-membership`) + RPC `reclaim_guest_membership` |
| Nouvelle session anonymous | Peut créer une **seconde** membership (`unique lobby_id+user_id`, `unique display_name` respectés) |
| Purge serveur | `purge_stale_lobbies` supprime le **lobby entier** — pas un membre isolé mid-partie ; pg_cron souvent inactif |
| UI lobby | Affiche tout le bundle sans filtre présence (`screens/lobby.js`) |

#### Surfaces impactées (roster live)

| Surface | Fonctions / modules | Exposition |
|---------|---------------------|------------|
| **Guess Lie** | `getLobbyMemberNames`, `getGuessLieRounds`, `allLobbySubmitted`, `isSubject` (pseudo) | **Élevée** |
| **Tier Night** | `getActiveMemberUserIds`, `getTierNightLobbyProgress`, gates `finished` | **Élevée** |
| **Votes / compteurs « tous les joueurs »** | `allMembersVoted`, `allMembersReady`, compteurs x/y dans les jeux MP | **Moyenne** |
| **Ready maps** | `allMembersReady`, prep launch, merge ready post-Recommencer | **Moyenne** |
| **Acting host** | `resolveActingHostUserId`, `isMemberPresent` (120 s) — fantôme peut compter comme « présent » si `lastSeenAt` null/legacy | **Moyenne** |
| **Écran lobby** | `getLobbyParticipants`, ready count, kick | **Visibilité directe** |
| **Jeux live-roster** | Hot Take, Dilemma, Speed Vote, Wrong Answer, Truth Meter, Consensus, Trivia, Playlist Guess — `getActivePlayers()` / `getActiveMemberUserIds()` | **Moyenne** |
| **Clutch** | Snapshot `participants[]` figé au lancement (`clutchParticipants.js`) | **Faible en play** (post-launch) |
| **Scores soirée** | `getEveningStandingPlayers` (UX-HIST-01) | **Hors scope suppression** — contributeurs historiques conservés volontairement |

#### Risque produit

- Faux nombre de joueurs affiché et compté dans les gates.
- Blocage « tous prêts » ou « tous ont voté » (fantôme attendu indéfiniment).
- Rounds supplémentaires ou manches incohérentes (Guess Lie : union roster + clés submissions).
- Affirmation ou vote attribué à une **ancienne identité** du même humain.
- Acting host potentiellement faussé si présence mal interprétée.
- Confusion visuelle dans le lobby (deux pseudos pour une personne).

#### Requalifications

| Ticket | Statut |
|--------|--------|
| **Guess Lie UX** | ✅ Validé — bug post-restart « vote sur ses propres affirmations » **requalifié L-05** |
| **Instrumentation `[GUESSLIE-ID]`** | Debug optionnel derrière flag ; retrait possible en nettoyage séparé |
| **Merge restart Guess Lie** | ✅ Déjà livré — indépendant de L-05 |

#### Découpage recommandé (sous-tickets)

| ID | Titre | Objectif | Contraintes |
|----|-------|----------|-------------|
| **L-05a** | Visibilité et action hôte | Exposer l’absence ; ne plus afficher un stale comme actif ; kick explicite | **Purement UX/lobby** — ne modifie **pas** les données de session jeu |
| **L-05b** | Récupération membership invité | Reprise explicite et sûre d’une place existante après changement de session anonymous | Pseudo seul **≠** preuve d’identité — analyser usurpation, SQL, RPC, `reveal-guest-membership` |
| **L-05c** | Éviction individuelle | Définir si/quand une row stale peut être supprimée ou marquée inactive | **Ne pas** réutiliser le seuil acting-host 120 s comme seuil de suppression ; distinguer absence temporaire / F5 / arrière-plan / session perdue / waiting vs playing / contributions existantes |
| **L-05d** | Nettoyage maps de session | Étudier le retrait des UID absents du roster dans les structures de jeu | **Séparé de L-05c** — pas de prune auto avant matrice historique vs progression ; scores soirée historiques conservés (UX-HIST-01) |

##### L-05a — Visibilité et action hôte

- Indicateur visuel « Absent » / « Déconnecté » basé sur `last_seen_at`.
- Fréquence de re-render / rafraîchissement (poll 12–20 s, realtime meaningful changes).
- Action kick existante (`kick_lobby_member`) — rendre l’intention claire pour l’hôte.
- Comportement si le joueur revient (heartbeat reprend) **avant** kick : retour visuel « actif ».

##### L-05b — Récupération membership invité

- Cas : pseudo déjà présent mais membre stale → proposition « Reprendre cette place ».
- Gardes anti-usurpation (compte non-anonymous, preuve membership, code lobby, etc.).
- Contraintes SQL : `unique (lobby_id, user_id)`, `lobby_members_unique_name`.
- RPC existante `reclaim_guest_membership` + `peek_lobby_by_membership` — étendre ou nouveau flow ?
- Comportement **sans** accès à l’ancien UID ni `localStorage`.

##### L-05c — Éviction individuelle

Proposer explicitement :

- Seuils et **grace period** (distincts de `HOST_PRESENCE_STALE_MS` = 120 s et `HOST_TRANSFER_STALE_MS` = 5 min).
- Statut `inactive` vs `DELETE` immédiat.
- Responsabilité : serveur (RPC/cron) vs action hôte vs les deux.
- Conséquences sur ready, votes, submissions, scores, reprise mid-partie.

##### L-05d — Nettoyage maps de session

Matrice à produire **avant** implémentation :

| Question | Exemples |
|----------|----------|
| Champs historiques (ne pas prune) | `scores`, `gameScores`, contributions UX-HIST-01 |
| Champs progression (candidats prune) | ready maps, votes en cours, submissions prep, `finished` Tier Night |
| Joueur temporairement absent | Doit-il disparaître des gates « tous voté » ? |
| Scores / contributions du fantôme | Conserver soirée ; retirer des gates actifs seulement ? |

#### Reproduction QA (inscrite)

**Cas principal — navigation privée**

1. Créer un lobby.
2. Rejoindre en invité depuis une fenêtre privée.
3. Relever UID, pseudo et ligne `lobby_members`.
4. Fermer brutalement la fenêtre **sans** « Quitter ».
5. Vérifier : row présente, `last_seen_at` cesse d’évoluer.
6. Rouvrir une **nouvelle** fenêtre privée.
7. Rejoindre le même lobby.
8. Vérifier : nouvel UID créé.
9. Vérifier : **deux memberships simultanées** (ancienne fantôme + nouvelle active).
10. Lancer plusieurs jeux — observer compteurs, ready, votes, rounds.

**Non-régressions indispensables**

- F5 normal : le joueur reprend sa place (même UID / reclaim).
- Coupure réseau courte : pas d’expulsion prématurée.
- Arrière-plan mobile : pas de suppression abusive.
- Leave explicite : membership supprimée.
- Kick hôte : membership supprimée.
- Scores historiques conservés (contrat UX-HIST-01).
- **Aucun** traitement spécifique détectant la navigation privée.

#### Critères d’acceptation (ticket parent L-05)

| # | Critère |
|---|---------|
| AC-1 | Un membre dont le heartbeat a cessé est **visuellement distingué** de membre actif (L-05a livré ou spec validée). |
| AC-2 | L’hôte peut **retirer** un membre absent sans ambiguïté (kick existant documenté + UX claire). |
| AC-3 | Un invité dont la session anonymous a changé peut **reprendre** une membership stale de façon **explicite et sûre**, sans usurpation de compte connecté (L-05b). |
| AC-4 | Aucune **deuxième membership** ne subsiste pour le même humain après rejoin réussi (roster = 1 entrée / personne physique en QA nav. privée). |
| AC-5 | Les gates « tous prêts / tous voté » et les compteurs x/y **ignorent ou excluent** les membres évacués selon la spec L-05c/L-05d — sans bloquer une partie légitime. |
| AC-6 | F5, coupure courte, arrière-plan mobile : **pas** d’expulsion ni de perte de place pour un joueur actif (non-régressions QA). |
| AC-7 | Guess Lie (et jeux live-roster) ne produisent **plus** de manche incohérente due à une duplication roster (QA cas principal étapes 1–10). |
| AC-8 | Scores et standings soirée **historiques** inchangés (UX-HIST-01) sauf décision produit explicite contraire. |
| AC-9 | Aucun patch Guess Lie (`isSubject`, helpers UID) livré **en contournement** — correction au niveau membership. |

#### Ordre d’implémentation recommandé

```
L-05a (visibilité + kick UX)  →  valeur immédiate, risque faible, pas de mutation session
        ↓
L-05b (reclaim explicite)     →  prévient la création de fantômes à la source
        ↓
L-05c (éviction individuelle) →  nettoie les fantômes existants ; spec seuils avant code
        ↓
L-05d (prune maps session)    →  après matrice historique vs progression ; dépend de L-05c
```

#### Fichiers de référence (sans patch)

`js/core/supabaseLobby.js` · `js/core/guestMembership.js` · `js/core/lobby.js` · `js/screens/lobby.js` · `js/core/hostPresence.js` · `js/core/gameSync.js` · `js/core/guessLieSession.js` · `js/config/lobbyLifecycle.js` · `supabase/lobby-lifecycle.sql` · `supabase/reclaim-guest-membership.sql`

#### Décision actuelle

- Guess Lie UX : **validé ✅** — aucun patch Guess Lie pour ce fantôme.
- Instrumentation `[GUESSLIE-ID]` : flag debug ; retrait optionnel en nettoyage séparé.
- **Prochain travail :** conception puis implémentation lifecycle lobby/membership (L-05a → b → c → d).

### Cause 4 / 7 — Guess Lie UX ✅ QA

| | |
|--|--|
| **Problème** | **Vague A** : après « Valider mon vote », pas d’état « Envoi… » ; risque reveal sur vote optimiste non confirmé RPC. **Vague B1** : `recordGuessLieRoundStats` avant confirmation serveur |
| **Fix Vague A** | Alignement VibeCheck : `voteCommitInFlight` + `myVote` + `voteConfirmChrome` ; `render()` avant `await` ; `shouldDeferGuessLieVoteLocalWrite` (pas de `saveStatePatch` MP avant RPC) ; garde `voteCommitInFlight` sur `tryAdvanceToReveal` ; rollback `rollbackGuessLieOptimisticVote` si RPC échoue |
| **Fix Vague B1** | `recordGuessLieRoundStats` **après** `await commitGuessLiePlay` ; flag `statsRecordedRoundIdx` sur session |
| **Où** | `js/games/guessLie.js` · `js/core/guessLieSession.js` · `js/core/guessLieVoteCommit.js` · `js/core/voteConfirm.js` |
| **Preuve** | `tests/guessLieVoteUx.test.js` · `tests/guessLieVoteCommit.test.js` |
| **Requalification** | Symptôme post-restart « vote sur ses propres affirmations » → **L-05** (joueur fantôme), pas périmètre UX vote |
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

**Hors scope volontaire :** rollback votes dilemma/speedVote/truthMeter · `results.js` mount · indicateur « Sync… » (ARCH-22)

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

### Autres causes

| ID | Cause | Problème |
|----|-------|----------|
| **M-14a** | 3 | TierNight : hôte → ancien récap 2e liste ; invité saute choix tierlists — ❌ suspendu |
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
| 1 | C-01/02, R-01–05, M-05a — **L-05 ouvert** |
| 2 | M-01, P-03, M-02a, S-02 |
| 3 | I-03/04, SYN-03, M-13, M-02b, ARCH-02, SYN-29, I-PG-01, ready stale Recommencer, UX-CLUTCH-01 |
| 4 | I-01/02/08, M-03b, M-06a/b, L-01, ARCH-03/03b, UX-VIBE-01, **Guess Lie UX** |
| 5 | T-01/02, T-03↻, M-07, M-08, P-02, SYN-28, I-PG-01, ARCH-04, UX-VIBE-02 |
| 6 | I-05, SYN-13b↻, SYN-25, **SYN-05 / ARCH-18** ✅, **ARCH-06** ✅ (Mode A/B/C · Traître V2 · Lobby IIFE · SYN-12) |
| 7 | I-07, M-09, L-09, M-11, M-10, T-05, SYN-26, M-04b / SYN-18 |
| 8 | I-06, P-02, ARCH-09, I-09 / SYN-06, SYN-15 / SYN-16 — **L-05 ouvert** |
| 9 | SYN-12 / M-05b |
| 10 | **SYN-05 / ARCH-18** ✅ QA (Fil Rouge app ; SQL historique hors scope) |
| 11 | L-02, ARCH-21↻, M-12 (cleanup `#join=`, pas auto-join), UX-HIST-01, UX-RESUME-BANNER, UX-VIBE-01/02 |

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
- Bug vote post-restart Guess Lie → **L-05** (joueur fantôme), pas correctif identité Guess Lie
- Instrumentation debug `[GUESSLIE-ID]` (`guessLieIdentityDebug.js`) — optionnel, hors fix produit

- Fil Rouge : résidus SQL historiques (`fil-rouge-private.sql`, clés RPC) — ops Supabase séparée, non faite

---

*Suivi vivant · Dernière MAJ : 2026-07-27 — L-05 formalisé (conception) · Guess Lie UX clôturé*
