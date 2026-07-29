# Audit REVEAL — Suivi par cause racine

Vanilla JS + Supabase. Invité = `state.user.isGuest` + `state.supabaseUserId` (auth anonyme).

| Préfixe | Sens |
|---------|------|
| `C-` `I-` `M-` `L-` | Critique / Important / Moyen / Faible |
| `S-` `T-` `R-` `P-` | Sync / Timing / Reconnexion / Perte d’état |
| `SYN-` `ARCH-` | Audit sync / Architecture |

**Règle** : ne pas rouvrir un ticket ✅ sans **régression démontrée**.

---

## Focus — 2026-07-29

| | |
|--|--|
| **Maintenant** | ARCH-07 · L-04 · UX-NAV-LOBBY résidus |
| **Ensuite** | Cause 7 résidus (M-14b) · dette ARCH-11… |
| **Dernière clôture** | **ARCH-08** ✅ (retry launch observable · QA terrain 2026-07-29) |

---

## File ouverte

### Prioritaire

| ID | Cause | Problème | Statut |
|----|-------|----------|--------|
| **ARCH-07** | 7 | Catch Realtime silencieux | Ouvert |

### Autres

| ID | Cause | Problème | Statut |
|----|-------|----------|--------|
| **M-14b / SYN-09b** | 7 | `onLocalApplied` si `localFirst: false` | Latent |
| **ARCH-10** | 8 | Clear cache leave lobby trop tard | 🟡 partiel |
| **ARCH-05** | 5 | Course lobby vs session (`row.screen`) | 🟡 mitigé SYN-28 |
| **ARCH-01 / F-01** | 1 | Démo offline sans avertissement MP | 🟡 partiel |
| **L-04** | 11 | « Réinitialiser l’app » trop visible | 🟡 partiel |
| **ARCH-11–17, SYN-19–24, SYN-27** | 9–10 | Monolithe / dup / code mort | Dette |

---

## Carte des causes racines

| # | Cause | État | Ouvert notable |
|---|-------|------|----------------|
| 1 | Identité invité / JWT | ✅ | ARCH-01 partiel |
| 2 | Race auth / profil | ✅ | — |
| 3 | Sources de vérité multiples | ✅ | **Membership A–E5 ✅** · M-14a ✅ · Guess Lie ✅ |
| 4 | Asymétrie hôte / invité | ✅ | — |
| 5 | Routing + timing sync | ✅ | ARCH-05 mitigé · UX-NAV ✅ |
| 6 | Async écrans | ✅ | ARCH-06 ✅ |
| 7 | Sync silencieuse / fire-and-forget | Partiel | ARCH-07 · M-14b |
| 8 | Reset / migration incomplète | Partiel | ARCH-10 · I-09/SYN-15/16 ✅ |
| 9 | Sync monolithe / duplication | Dette | ARCH-11… |
| 10 | Code mort | Dette | hors Fil Rouge app ✅ |
| 11 | Friction UX | Partiel | L-04 · ARCH-22/Loader/UX-NAV ✅ |

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

### Cause 7 — Sync silencieuse

| ID | Problème | Où | Statut |
|----|----------|-----|--------|
| **M-14b** | `onLocalApplied` manquant si `localFirst: false` | `mpLaunch.js` | Latent |
| **ARCH-07** | Catch Realtime silencieux | Realtime | Ouvert — voir étude § ci-dessous |
| **ARCH-08** | Retry launch silencieux | `mpLaunch.js` | ✅ 2026-07-29 |

Hors scope volontaire : rollback votes dilemma/speedVote/truthMeter · `results.js` mount · ARCH-22 ✅.

#### ARCH-08 ✅ (2026-07-29)

| | |
|--|--|
| **Livré** | `logLaunchCommitFailure` · `retryLaunchCommitInBackground` · isolation `commit` / `applyLocal` (fallback uniquement si `commit()` échoue) |
| **Comportement** | Inchangé : 1 commit + 1 retry immédiat non await · alerte « sync est lente » · pas de 2e feedback |
| **Observabilité** | `console.warn` structuré `[MP-LAUNCH] commit failed` · `event: mp_launch_commit_failed` · `phase: initial_commit \| background_retry` |
| **Où** | `js/core/mpLaunch.js` |
| **Preuve** | `tests/mpLaunchLaunch.test.js` (12) · QA terrain fonctionnelle validée |
| **Note QA logs** | DevTools Offline global + jeux à `beforeCommit` n’atteignent pas le catch ARCH-08 ; jeux sans `beforeCommit` (Clutch, Speed Vote, …) · vérifier bundle `mpLaunch.js` en Sources (`mp_launch_commit_failed`) |

#### ARCH-07 — étude (2026-07-29)

**Problème** : échecs Realtime / post-`SUBSCRIBED` / foreground avalés par `.catch(() => {})` — pas de log, pas de replanification catch-up visible.

| Priorité | Fichier | Pattern | Symptôme si échec |
|----------|---------|---------|-------------------|
| **P0** | `supabaseLobby.js` ~2187–2193 | `refreshGameSession().then(…).catch(() => {})` après `SUBSCRIBED` | Invité bloqué prep/menu ; pas de route catch-up |
| **P0** | `gameSync.js` ~3661 | `refreshLobbyFromSupabase?.().catch(() => {})` retour foreground | Désync temporaire après veille onglet |
| **P1** | `lobbyPollChannel.js` ~420–421 | `rebuildChain.catch(() => {})` | Rebuild poll silencieux (polling filet) |
| **P2** | `hostClaimOffer.js` ~80 | `refreshLobbyFromSupabase().catch(() => {})` | Claim hôte |
| **P2** | `gameResume.js` ~136 | `void refreshGameSession().then(…)` **sans catch** | Uncaught promise possible |

**Déjà instrumenté (hors patch strict)** : handlers `game_sessions` (`console.warn` ~2139–2140) · `CHANNEL_ERROR` / `TIMED_OUT` → `scheduleRealtimeReconnect()` · polling adaptatif `gameSync.js` · diagnostics `realtimeSocketDiagnose.js` · gate join `shouldRouteAfterRealtimeSubscribed` (T-01/T-02).

**Scope minimal recommandé (aligné ARCH-08)** :
1. Remplacer P0 `.catch(() => {})` par log structuré `[MP-RT]` / `event: mp_rt_catchup_failed` (phase `subscribed_catchup` \| `foreground_refresh`).
2. P0 SUBSCRIBED : option replanifier catch-up (debounce existant `subscribedCatchUpRoute`) ou `scheduleRealtimeReconnect` si échec refresh — sans 2e feedback UI.
3. P1 poll : log erreur rebuild **puis** continuer la chaîne (ne pas confondre reset vs échec).
4. Tests : contrat source + unitaire mock `refreshGameSession` reject → log visible ; pas de test E2E Realtime obligatoire.

**Hors scope ARCH-07** : `setLobbyPlaying(...).catch(() => {})` jeux (M-11) · ARCH-08 ✅ · bannière globale · refonte sync.

### Cause 5 / 8 / 1 / 11 — partiels

| ID | Problème | Note |
|----|----------|------|
| **ARCH-05** | `row.screen` en retard vs lobby | 🟡 mitigé ; hors scope routing |
| **ARCH-10** | Cache session clear trop tard au leave | 🟡 |
| **ARCH-01** | Démo locale sans avertissement MP | 🟡 |
| **L-04** | « Réinitialiser l’app » trop visible | 🟡 |

---

## Contrats produit (référence)

### SYN-13b — sortie jeu

- **Retour** = sortie temporaire (reste membre, suit la progression)
- **Quitter → Menu des jeux** = sortie définitive du jeu courant (suit les jeux suivants)

### UX-NAV-LOBBY — Vague A ✅ 2026-07-28

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
| **ARCH-08** | 7 | Retry launch observable · isolation commit/applyLocal · 1 retry immédiat | `mpLaunchLaunch.test.js` · QA terrain 2026-07-29 |
| **Membership E5** | 3 | `dissolve_lobby_atomically` · ALREADY_GONE · CANONICAL_ELSEWHERE | `lobbyMembershipVagueE5` · staging+terrain 2026-07-28 |
| **Membership E4** | 3 | Create atomique + UNIQUE user_id + mapping conflit + recover E2 | Staging e4-01/02 · smoke UI 2026-07-28 |
| **Membership E3** | 3 | Soft-hold post-leave · pas de checking générique | `lobbyMembershipVagueE3` · QA terrain |
| **Membership A→E2** | 3 | Query→chrome→create→leave · E1 scoped auth · E2 align asymétrique + remove après preuve | VagueA–E2 · 2026-07-28 |
| **Membership E1** | 3 | Snapshot scoped auth · reject stale | `lobbyMembershipVagueE1` · 2026-07-28 |
| **UX-NAV-LOBBY** | 5/11 | Home hors menu en lobby · Settings · leave | `uxNavLobby` · `voluntaryMemberLeave` |
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
| 5 | T-01/02, T-03↻, M-07/08, P-02, SYN-28, ARCH-04, UX-VIBE-02, pré-résolution entry, UX-NAV-LOBBY |
| 6 | I-05, SYN-13b↻, SYN-25, SYN-05/ARCH-18, ARCH-06 |
| 7 | I-07, M-09, L-09, M-11, M-10, T-05, SYN-26, M-04b/SYN-18, **ARCH-08** |
| 8 | I-06, P-02, ARCH-09, I-09/SYN-06, SYN-15/16, M-15 |
| 9 | SYN-12 / M-05b |
| 10 | SYN-05 / ARCH-18 (Fil Rouge app) |
| 11 | L-02, ARCH-21↻, M-12, UX-HIST/RESUME/VIBE, POLL, **Membership A–E5**, ARCH-22, Loader join, UX-NAV, join partiel |

---

## Résidus connus

Hors file prioritaire — opportunité / régression :

- Votes optimistic hors Hot Take / VibeCheck / Dilemma (speedVote / …)
- `results.js` mount · rename remote résiduel
- Lobby `playing` si upsert échoue après `setLobbyPlaying` (M-11)
- `pushGameSession` : `err.message` brut (L-09)
- Logs debug join · policy debug lobby Supabase
- SYN-28 : `settings` hors scope ; course lobby `playing` vs session menu
- I-PG-01 : autres jeux sans podium dédié
- Starts sync hydrate → hub hors `mountLobby` (hors périmètre ARCH-06)
- UX-NAV : `navigate("home")` programmatique en lobby · `navStack` legacy · QA terrain
- Membership **E4** (reporté) : course RPC pure ALREADY_EXISTS · join↔join concurrent · reclaim X/Y · JSON 23505 · e4-03/03b
- Join partiel : revert RPC reclaim anonymous · orphelin **création** · E2E Supabase
- Pré-résolution B1 (getter post-mark launch) — étudiée, **non retenue**
- Loader join interstitiel — **non retenu**
- Fil Rouge SQL historique — ops Supabase séparée · fail docs `filRougeVague3Cleanup` hors Membership

**Surveiller** : Clutch taps sous latence (SYN-26) · ready prep après Recommencer · conflit pending join vs chrome Home membership · leave multi-onglets après dissolve (modale « connexion a empêché »)

---

*Suivi vivant · MAJ 2026-07-29 — **ARCH-08 ✅ QA** · prochain = **ARCH-07** · L-04*
