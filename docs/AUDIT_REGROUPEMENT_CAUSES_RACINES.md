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

## Focus — 2026-07-26

| | Contenu |
|--|---------|
| **Fait** | … · **ARCH-06 V1** ✅ QA · **ARCH-06 mode B** 🔧 (B0+B1+B2+B3+B4) |
| **Prochain** | ARCH-06 revue conception mode C (sans patch) |
| **Ensuite** | ARCH-06 mode C · Traître host V2 · lobby IIFE/SYN-12 |

**Hors file audit**  
Sondages in-chat (`lobby_polls` / UI chat) — feature produit, pas un ticket cause racine.

**Résidus (hors file prioritaire)**  
UI Guess Lie avant `await` · `statsRecordedRoundIdx` · loader UI join · pré-résolution `get*EntryScreen` · votes optimistic (dilemma / speedVote / …) · `results.js` mount refresh · échec remote rename (doc QA I-09)

**Surveiller**  
Clutch taps figés sous latence (SYN-26) · ready prep après Recommencer · Cause 4 seulement si régression · starts sync hors `mountLobby` (hydrate → hub, résidu SYN-12)

---

## File d’attente

### Prioritaires

| # | ID | Cause | Problème | Statut |
|---|----|-------|----------|--------|
| 1 | **ARCH-06** | 6 | Handlers async / unmount / remount | 🟡 V1 ✅ · mode B 🔧 · C/V2/lobby ouverts |
| 2 | **M-14a / SYN-14** | 3 | TierNight topic / routing | ❌ KO QA — suspendu |
| 3 | Guess Lie UX | 4/7 | UI avant await ; stats round local-only | Post I-08 |
| 4 | Loader UI join | 5/11 | Interstitiel join | Hors T-01/T-02 |
| 5 | Pré-résolution entry screens | 5 | `get*EntryScreen` (filet M-08 conservé) | Hors M-08 |
| 6 | **ARCH-22** | 11 | Pas de feedback sync lente | Ouvert |

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
| 3 | Sources de vérité multiples | ✅ hors TierNight | **M-14a** suspendu · UX-CLUTCH-01 ✅ |
| 4 | Asymétrie hôte / invité | ✅ QA | UX Guess Lie séparée |
| 5 | Routing + timing sync | ✅ | ARCH-05 mitigé |
| 6 | Async écrans | Partiel | **ARCH-06** V1 ✅ · mode B 🔧 · C/Traître/lobby ouverts |
| 7 | Sync silencieuse / fire-and-forget | Partiel | ARCH-07/08, M-14b |
| 8 | Reset / migration incomplète | Partiel | I-09 ✅ ; SYN-15/16 ✅ ; ARCH-10 |
| 9 | Sync monolithe / duplication | Dette | ARCH-11… |
| 10 | Code mort | Dette | dead exports (hors Fil Rouge app) |
| 11 | Friction UX | Partiel | ARCH-22 ; L-04 |

---

## Détail des tickets ouverts

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

### Cause 6 — ARCH-06 🟡 partiel · V1 ✅ · mode B 🔧 · C/V2 ouverts

| | |
|--|--|
| **État** | **Pas clos.** V1 ✅ mode A · **mode B couvert** (B0+B1+B2+B3+B4) 🔧 · C / Traître host / lobby IIFE ouverts |
| **Primitive B** | `createMountGuard()` (`js/core/mountLifecycle.js`) — `isMounted` / `dispose` ; pas de timers, pas d’erreurs avalées, pas de router |
| **Règle** | Après `await` : bloquer render / bind / navigate / mutation UI / feedback ancien écran. Commits serveur déjà partis **non** annulés. Timers/RAF : `clear*` existants + `dispose()` en tête + **recheck guard dans la callback**. |

#### Vague B0+B1+B4

| Fichier | Effets UI bloqués | Commits conservés |
|---------|-------------------|-------------------|
| `hotTake.js` | `render()` gate + navigate / enterRevealUi / sync UI après await ; listener session | `commitHotTake*` / `completeGameSession` |
| `wrongAnswer.js` | idem transitions + submits + next | `commitWrongAnswer*` |
| `guessLie.js` | reveal display / render / navigate | `commitGuessLie*` / scoring avant await |
| `speedVote.js` | render / navigate après vote & next | `commitSpeedVote*` |
| `playlistGuess.js` (B4) | `nextRound` : recheck `unmounted` avant render/navigate | `startPlaylistGuessRound` / `completeGameSession` |

**Inchangés (déjà OK)** : traitre · tierNight · dilemma — pas d’uniformisation cosmétique.

#### Vague B2

| Fichier | Effets protégés | Timers / RAF | Commits conservés |
|---------|-----------------|--------------|-------------------|
| `consensus.js` | render / navigate / alerts / session listener | NPC · reveal-pending · scheduleRender · RAF scroll | `commitPlay` / `commitReveal` / `completeGameSession` |
| `trivia.js` | render / navigate / answer finally / next / setup | NPC timeouts | `commitAnswer` / `commitPlay` / `completeGameSession` |
| `clutch.js` | render / tap then-catch-finally / next / grace UI | clock RAF · countdown RAF · copyInterval · graceTimer | `commitClutchTap` / `commitClutchPlay` / `completeGameSession` |
| `truthMeter.js` | render / votes / reveal / next / focus RAF | gauge `step` RAF · reveal-pending · display timeouts | `commitTruthMeter*` / `finishTruthMeterGameSession` |

#### Vague B3 (cette livraison)

| Fichier | Effets protégés | Commits conservés |
|---------|-----------------|-------------------|
| `tierNightLive.js` `mountMp` only | `render` · reveal/next après await · `pickTier` · session listener · `navigate("tiernight-end")` via `finalize…({ isMounted })` | `commitTierNightLivePlay` / `commitTierNightLiveVote` / `patchGameState` dans finalize |
| `gameSync.js` `finalizeTierNightLiveToResults` | navigate post-patch seulement si `stillMounted()` | patch déjà lancé non annulé |

**Solo `mountSolo`** : hors périmètre B3 (pas de guard ajouté).

**Preuve** : `tests/mountLifecycle.test.js` (runtime B0–B3 + contrats)

#### Suite ARCH-06

| Vague | Scope | Statut |
|-------|-------|--------|
| V1 mode A | launch / restart / PG+TierLive next | ✅ QA |
| B0+B1+B4 | guard + 4 jeux + gap PG | 🔧 |
| B2 | consensus · trivia · clutch · truthMeter | 🔧 |
| **B3** | tierNightLive `mountMp` | 🔧 livré → QA |
| **mode B** | périmètre B retenu | 🔧 **couvert** (ticket ARCH-06 non clos) |
| **C** | génération router (revue conception puis impl) | Prochain |
| V2 / lobby | Traître host · lobby IIFE/SYN-12 | Après C |

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
| 3 | I-03/04, SYN-03, M-13, M-02b, ARCH-02, SYN-29, I-PG-01, ready stale Recommencer, UX-CLUTCH-01 |
| 4 | I-01/02/08, M-03b, M-06a/b, L-01, ARCH-03/03b, UX-VIBE-01 |
| 5 | T-01/02, T-03↻, M-07, M-08, P-02, SYN-28, I-PG-01, ARCH-04, UX-VIBE-02 |
| 6 | I-05, SYN-13b↻, SYN-25, **SYN-05 / ARCH-18** ✅, **ARCH-06 V1** ✅, **ARCH-06 mode B** 🔧 (C/Traître/lobby ouverts) |
| 7 | I-07, M-09, L-09, M-11, M-10, T-05, SYN-26, M-04b / SYN-18 |
| 8 | I-06, P-02, ARCH-09, I-09 / SYN-06, SYN-15 / SYN-16 |
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
- Fil Rouge : résidus SQL historiques (`fil-rouge-private.sql`, clés RPC) — ops Supabase séparée, non faite

---

*Suivi vivant · Dernière MAJ : 2026-07-26 — ARCH-06 Vague B3 / mode B couvert (ticket non clos)*
