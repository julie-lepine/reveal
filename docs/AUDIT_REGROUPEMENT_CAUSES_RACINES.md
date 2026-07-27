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
| **Fait** | **Guess Lie UX** ✅ · **L-05 invalidé** (pas de fantôme `lobby_members`) · **M-15** ouvert (identité fantôme Guess Lie / submissions) |
| **Prochain** | **M-15a** confirmation terrain (`[GUESSLIE-ID]`) · **M-14a / SYN-14** (suspendu) ou **ARCH-22** |
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
| 1 | **M-15** | 3/8 | Guess Lie — identité fantôme (submissions / merge / rounds) | **M-15a** QA terrain |
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
| 1 | Identité invité / JWT | ✅ QA | ARCH-01 partiel |
| 2 | Race auth / profil | ✅ QA | — |
| 3 | Sources de vérité multiples | Partiel | **M-14a** suspendu · **M-15** submissions GL · UX-CLUTCH-01 ✅ |
| 4 | Asymétrie hôte / invité | ✅ QA | Guess Lie UX ✅ |
| 5 | Routing + timing sync | ✅ | ARCH-05 mitigé |
| 6 | Async écrans | ✅ QA | **ARCH-06** ✅ (Mode A/B/C · Traître V2 · Lobby IIFE · SYN-12) |
| 7 | Sync silencieuse / fire-and-forget | Partiel | ARCH-07/08, M-14b |
| 8 | Reset / migration incomplète | Partiel | I-09 ✅ ; SYN-15/16 ✅ ; ARCH-10 · **M-15** reset submissions GL |
| 9 | Sync monolithe / duplication | Dette | ARCH-11… |
| 10 | Code mort | Dette | dead exports (hors Fil Rouge app) |
| 11 | Friction UX | Partiel | ARCH-22 ; L-04 |

---

## Détail des tickets ouverts

### Cause 3 / 8 — M-15 — Guess Lie — identité fantôme (submissions / merge / rounds)

**Identifiant :** `M-15` · **Causes :** 3 + 8 · **Statut :** **M-15a — confirmation terrain** (aucun patch M-15b/c/d avant log)

Symptôme QA : après Recommencer, vote sur ses propres affirmations ; fantôme gameplay ; **pas** de fantôme `lobby_members` ; nouveau lobby corrige.

Couches : (3–4) submissions distant/local → (6) `getGuessLieRounds()` produit la manche. Instrumentation `[GUESSLIE-ID]` ✅ acceptée.

Découpage : **M-15a** preuve terrain (en cours) → M-15b purge restart → M-15c `getGuessLieRounds` → M-15d `isSubject`.

**Règle patch :** cibler **uniquement la première couche fautive** confirmée par le log. Pas de triple patch préventif (purge + filtre roster + `isSubject`).

---

#### M-15a — Protocole QA terrain (obligatoire avant patch)

**Setup**

| Rôle | Config |
|------|--------|
| Hôte | Navigateur normal |
| Invité A | Normal |
| Invité B (repro) | **Navigation privée** |

**Scénario**

1. Créer lobby · 3 joueurs · lancer Guess Lie.
2. Jouer **partie 1 complète** (toutes les manches).
3. Hôte : **Recommencer**.
4. Tous : **nouvelles soumissions** prep.
5. Hôte : lancer **partie 2**.
6. Sur **invité B** (privé), au moment du symptôme (manche fantôme ou vote sur ses propres affirmations) : capturer le log.

**Activation debug (invité concerné, avant ou dès la prep partie 2)**

```js
localStorage.setItem('reveal-guesslie-identity-debug', '1');
location.reload();
```

Console : filtrer `[GUESSLIE-ID]`

**Champs obligatoires du log** (objet complet `console.warn`)

| Groupe | Champs |
|--------|--------|
| Couche | `firstGhostLayerHint`, `triggers` |
| Session | `sessionId`, `phase`, `roundIdx`, `gameSessionRowId` |
| Roster | `lobbyMemberNames`, `localParticipant`, `localParticipantUid` |
| Identité locale | `getLocalDisplayName`, `getLocalPlayerName`, `localNameClosure` |
| Submissions | `remoteSubmissionKeys`, `localSubmissionKeys`, `keysNotInLobbyRoster`, `localOnlyValidKeys`, `remoteOnlyValidKeys`, `keysForLocalIdentity` |
| Rounds | `roundPlayers`, `roundPlayersNotInRoster`, `rounds` (avec `stmtHash`) |
| Manche courante | `roundPlayer`, `roundPlayerUid`, `roundStmtHash`, `isSubject`, `isSubjectFormula` |

Pas de texte brut des affirmations — hashes uniquement (`stmtHash` par clé dans `localSubmissionKeys` / `remoteSubmissionKeys`).

**Points de capture recommandés**

| Moment | Pourquoi |
|--------|----------|
| Fin prep partie 2 (avant lancement) | État submissions post-merge prep |
| 1er render vote partie 2 | Symptôme UI |
| Manche où l’invité voit boutons vote sur **ses** affirmations | Cas critique |

---

#### M-15a — Arbre de classification (après log)

**A. Distant fautif** — clé fantôme déjà dans `remoteSubmissionKeys` (`valid: true`, `inRoster: false` ou clé stale)

À documenter dans le rapport :

- Quand la clé aurait dû être purgée (fin partie 1 / Recommencer / lancement prep).
- Payload restart reçu côté client : `getCachedGameSession()?.state?.guessLie` (submissions UID).
- Résultat attendu de `shouldApplyGuessLieLobbyReset(local, remote)` au moment du merge.
- Branche `patchGameStateInner` : est-ce que `incGl.submissions === {}` a conservé `curGl.submissions` ?

→ Patch cible : **M-15b** uniquement.

**B. Local fautif** — `remoteSubmissionKeys` propres ; clé dans `localSubmissionKeys` ou `localOnlyValidKeys`

À documenter :

- Origine probable : `localStorage` persistant · merge **play** (union) · réinjection **prep** sous `localName`.
- Au moment du log : comparer `localOnlyValidKeys` vs `remoteOnlyValidKeys`.
- Si prep : vérifier si `getLocalDisplayName()` ≠ `localParticipant.name` (double clé).

→ Patch cible : **M-15b** (purge local au restart) et/ou merge prep — **pas** M-15c en premier.

**C. Rounds fautifs** — distant **et** local propres (`keysNotInLobbyRoster` vide) mais `roundPlayersNotInRoster` non vide

À documenter :

- `rounds` dans le log = recalcul live ; l’écran play fige `const rounds = getGuessLieRounds()` **au mount** (`guessLie.js` L47) — vérifier décalage mount vs état courant.
- Cache : `roundIdx` local vs session ; remount après sync ?
- Source exacte de la liste affichée.

→ Patch cible : selon source (remount / sync / construction rounds) — **pas** filtre roster aveugle.

**D. Identité fautive** — aucune clé fantôme ; `isSubject === false` sur sa propre manche

À documenter :

- `round.player` vs `localNameClosure` (figé mount L77) vs `getLocalDisplayName()` live vs `localParticipant.name`.
- `roundPlayerUid` vs `localParticipantUid` (match UID mais mismatch pseudo → cas identité pure).

→ Patch cible : **M-15d** uniquement — **après** confirmation qu’aucune clé submission fantôme n’existe.

---

#### M-15c — Vigilance avant filtre roster (documenter, ne pas implémenter)

Une soumission valide peut **temporairement** exister sous une clé ∉ `lobbyMemberNames` si :

| Cas | Risque filtre roster |
|-----|---------------------|
| Soumission optimiste prep avant ack remote | Clé locale du joueur courant — **légitime** |
| Roster local en retard vs session (sync ordre inversé) | Faux positif purge |
| Rename mid-soirée (I-09) | Ancienne clé migrée — maps soirée |
| Joueur parti après soumission | Clé peut rester en session ; UX-HIST-01 scores |
| Reconnexion / F5 mid-prep | Merge prep + localStorage |
| `roundIdx` / ordre manches | Union roster+clés garantit ordre stable si clés = roster |

**Conséquence :** M-15c (filtrer `getGuessLieRounds` par roster) n’est un filet **qu’après** purge confirmée (M-15b) ; sinon risque de masquer race sync légitime.

---

#### M-15a — Critères de sortie

| # | Critère |
|---|---------|
| OUT-1 | Log `[GUESSLIE-ID]` complet capturé au moment du symptôme |
| OUT-2 | Classification A / B / C / D assignée avec preuve |
| OUT-3 | `firstGhostLayerHint` confirmé ou corrigé par le log (pas seulement hypothèse code) |
| OUT-4 | Patch unique recommandé (b, c ou d) — pas de combo |
| OUT-5 | Si non-repro : noter config exacte + absence de log |

---

### L-05 — Invalidé pour ce cas terrain

Hypothèse membership orpheline `lobby_members` **invalidée**. Pas de L-05a–d pour ce bug.

---

### Cause 4 / 7 — Guess Lie UX ✅ QA

| | |
|--|--|
| **Problème** | **Vague A** : après « Valider mon vote », pas d’état « Envoi… » ; risque reveal sur vote optimiste non confirmé RPC. **Vague B1** : `recordGuessLieRoundStats` avant confirmation serveur |
| **Fix Vague A** | Alignement VibeCheck : `voteCommitInFlight` + `myVote` + `voteConfirmChrome` ; `render()` avant `await` ; `shouldDeferGuessLieVoteLocalWrite` (pas de `saveStatePatch` MP avant RPC) ; garde `voteCommitInFlight` sur `tryAdvanceToReveal` ; rollback `rollbackGuessLieOptimisticVote` si RPC échoue |
| **Fix Vague B1** | `recordGuessLieRoundStats` **après** `await commitGuessLiePlay` ; flag `statsRecordedRoundIdx` sur session |
| **Où** | `js/games/guessLie.js` · `js/core/guessLieSession.js` · `js/core/guessLieVoteCommit.js` · `js/core/voteConfirm.js` |
| **Preuve** | `tests/guessLieVoteUx.test.js` · `tests/guessLieVoteCommit.test.js` |
| **Requalification** | Symptôme post-restart « vote sur ses propres affirmations » → **M-15** (submissions / merge), pas L-05 |
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
| 1 | C-01/02, R-01–05, M-05a |
| 2 | M-01, P-03, M-02a, S-02 |
| 3 | I-03/04, SYN-03, M-13, M-02b, ARCH-02, SYN-29, I-PG-01, ready stale Recommencer, UX-CLUTCH-01 · **M-15 ouvert** |
| 4 | I-01/02/08, M-03b, M-06a/b, L-01, ARCH-03/03b, UX-VIBE-01, **Guess Lie UX** |
| 5 | T-01/02, T-03↻, M-07, M-08, P-02, SYN-28, I-PG-01, ARCH-04, UX-VIBE-02 |
| 6 | I-05, SYN-13b↻, SYN-25, **SYN-05 / ARCH-18** ✅, **ARCH-06** ✅ (Mode A/B/C · Traître V2 · Lobby IIFE · SYN-12) |
| 7 | I-07, M-09, L-09, M-11, M-10, T-05, SYN-26, M-04b / SYN-18 |
| 8 | I-06, P-02, ARCH-09, I-09 / SYN-06, SYN-15 / SYN-16 · **M-15 ouvert** |
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
- Bug vote post-restart Guess Lie → **M-15** (submissions / merge), L-05 invalidé pour ce repro
- Instrumentation debug `[GUESSLIE-ID]` (`guessLieIdentityDebug.js`) — optionnel, hors fix produit

- Fil Rouge : résidus SQL historiques (`fil-rouge-private.sql`, clés RPC) — ops Supabase séparée, non faite

---

*Suivi vivant · Dernière MAJ : 2026-07-27 — M-15a QA terrain (pas de patch b/c/d)*
