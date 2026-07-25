# Audit REVEAL — Suivi par cause racine

Vanilla JS + Supabase. Invité = `state.user.isGuest` + `state.supabaseUserId` (auth anonyme).

**Légende :** `C-` critique · `I-` important · `M-` moyen · `L-` faible · `S-` sync · `T-` timing · `R-` reconnexion · `P-` perte d’état · `SYN-` audit sync · `ARCH-` architecture

---

## Focus actuel — 2026-07-25

| | |
|---|---|
| **Fait** | T-01/T-02 · M-08 · ready Recommencer · M-10 / T-05 / SYN-26 · **I-09 / SYN-06** (QA terrain OK) |
| **Prochain** | **M-12** — `#join=` sans auto-join |
| **Ensuite** | ARCH-04 · SYN-12 · M-04b |

**Résidus séparés :** UI Guess Lie avant `await` · `statsRecordedRoundIdx` · loader UI join · pré-résolution `get*EntryScreen` · votes optimistic autres jeux (dilemma / speedVote / …) · `results.js` mount refresh · échec remote rename (doc QA I-09)

**Surveiller :** Clutch taps figés sous latence · ready prep après Recommencer · Cause 4 seulement si régression

---

## Priorités ouvertes

| # | ID | Cause | Problème | Note |
|---|----|-------|----------|------|
| 1 | **M-12** | 11 | `#join=` sans auto-join | **prochain** |
| 2 | **ARCH-04** | 5 | Re-entry prep bloquée par suppress | |
| 3 | **SYN-12 / M-05b** | 9 | Double `startMultiplayerSync` au mount lobby | |
| 4 | **M-14a / SYN-14** | 3 | TierNight topic / routing | ❌ KO QA — suspendu |
| 5 | **ARCH-06** | 6 | Handlers async multiples en vol | Dette |
| 6 | Guess Lie UX | 4/7 | UI avant await ; stats round local-only | Post I-08 |
| 7 | Loader UI join | 5/11 | Interstitiel join | Hors T-01/T-02 |
| 8 | Pré-résolution entry screens | 5 | `get*EntryScreen` (filet M-08 conservé) | Hors M-08 |
| 9 | **M-04b / SYN-18** | 7 | Timers `withPatchTimeout` non cleared | Résidu Cause 7 |
| 10 | **SYN-15 / SYN-16** | 8 | Merge stats/scores stale | Après I-09 |

### Autres ouverts (hors Top 10)

| ID | Cause | Problème | Statut |
|----|-------|----------|--------|
| **M-14b / SYN-09b** | 7 | `onLocalApplied` si `localFirst: false` | Latent |
| **ARCH-07** | 7 | Catch Realtime silencieux | À traiter |
| **ARCH-08** | 7 | Retry launch silencieux | À traiter |
| **SYN-15 / SYN-16** | 8 | Merge stats/scores stale | À traiter |
| **ARCH-10** | 8 | Clear cache leave lobby | 🟡 partiel |
| **ARCH-05** | 5 | Course lobby vs session | 🟡 mitigé SYN-28 |
| **ARCH-01 / F-01** | 1/10 | Démo offline sans MP | 🟡 partiel |
| **L-04** | 11 | « Réinitialiser l’app » trop visible | 🟡 partiel |
| **ARCH-22** | 11 | Pas de feedback sync lente | À traiter |
| **SYN-05 / ARCH-18** | 6/10 | Fil Rouge dormant | Dormant |
| **ARCH-11–17, SYN-19–24, SYN-27** | 9–10 | Monolithe / dup / code mort | Dette |

---

## Causes racines (carte)

| # | Cause | État | Ouvert notable |
|---|-------|------|----------------|
| 1 | Identité invité / JWT | ✅ QA | ARCH-01 partiel |
| 2 | Race auth / profil | ✅ QA | — |
| 3 | Sources de vérité multiples | ✅ hors TierNight | **M-14a** suspendu |
| 4 | Asymétrie hôte / invité | ✅ QA (I-08, ARCH-03/03b) | UX Guess Lie séparée |
| 5 | Routing + timing sync | ✅ M-08 | ARCH-04 |
| 6 | Async écrans | Partiel | ARCH-06 ; SYN-05 dormant |
| 7 | Sync silencieuse / fire-and-forget | Partiel | M-04b, ARCH-07/08… (**M-10 / T-05 / SYN-26** ✅) |
| 8 | Reset / migration incomplète | Partiel | **I-09 ✅** ; SYN-15/16 |
| 9 | Sync monolithe / duplication | Dette | SYN-12, ARCH-11… |
| 10 | Code mort | Dette | Fil Rouge, dead exports |
| 11 | Friction UX | Partiel | **M-12**, ARCH-22 |

---

## Détail des tickets ouverts

Colonnes réduites : le détail fichier / fix proposé vit dans le code ou les commits.

### Cause 5 — Routing / timing

| ID | Problème | Où | Action |
|----|----------|-----|--------|
| **ARCH-04** | Suppress + même prep → re-entry stale | `shouldApplySessionRoute` | Après P-02 |
| **ARCH-05** | `row.screen` en retard vs lobby | `mpLaunch.js` | 🟡 mitigé ; hors scope routing |

### Cause 7 — Sync silencieuse (résidus)

| ID | Problème | Où |
|----|----------|-----|
| **M-04b / SYN-18** | Timers timeout non cleared | `gameSync.js` |
| **M-14b** | `onLocalApplied` manquant | `mpLaunch.js` |
| **ARCH-07 / ARCH-08** | Catch / retry silencieux | Realtime, launch |

### Cause 8 — Reset / rename

| ID | Problème | Note |
|----|----------|------|
| **I-09 / SYN-06** | Rename mid-soirée — migration blobs locaux | ✅ QA terrain — `renameLocalPlayer` complet (`state.js`) |
| **SYN-15 / SYN-16** | Merge stats/scores avec noms stale | |
| **ARCH-10** | Cache session clear trop tard au leave | 🟡 |

### Autres causes

| ID | Cause | Problème |
|----|-------|----------|
| **M-14a** | 3 | TierNight : hôte → ancien récap 2e liste ; invité saute choix tierlists — ❌ suspendu |
| **M-12** | 11 | Lien `#join=` préremplit seulement — **prochain** |
| **SYN-12** | 9 | Double `startMultiplayerSync` mount lobby |
| **ARCH-06** | 6 | Double mount / handlers en vol |
| **ARCH-01** | 1 | Démo locale sans avertissement MP |

---

## Clôtures récentes (condensé)

| Date | IDs | Commit / note |
|------|-----|---------------|
| 07-25 | **I-09 / SYN-06** | ✅ QA terrain — `renameLocalPlayer` migre `gameScores` / baseline / `*Game` (clés, valeurs, tableaux, scalaires) ; collisions `preferOld` / `maxStats` / `or` ; tests `renameLocalPlayer.test.js` |
| 07-25 | **M-10 / SYN-10** | ✅ QA — `bb8f71c` : catch `syncPrepOnMount` + leaderboard ; `syncPrepMount.js` |
| 07-25 | **T-05** | ✅ QA — `faeb33f` : rollback vote Hot Take (`hotTakeVoteCommit.js`) |
| 07-25 | **SYN-26** | ✅ QA — `428ced1` → `66f08c0` → `4856b7e` : catch/rollback tap ; retapable ; **freeze `{ms,at}` au clic** + merge first-wins |
| 07-25 | **M-08 / SYN-13** | `6b85d84` — nested redirect / navStack / cleanup |
| 07-25 | faux ready prep (Recommencer) | ✅ QA — `c27e604` : `mergeReadyMapsLocal` remote-authoritative + `ready: {}` fin de partie |
| 07-25 | **T-01**, **T-02** | `5c1b61d` — hydrate → sync ; debounce SUBSCRIBED |
| 07-24 | **I-08**, **ARCH-03**, **ARCH-03b** | RLS host-only ; acting UI `566ae11` ; Guess Lie RPC `a686876` |
| 07-22 | **SYN-28**, Cause 4 UX, **I-PG-01**, **I-05**, **I-06**, **M-11**, **SYN-13b**… | Suivi hub sans F5 ; podium ; ready lobby ; rollback restart |
| 07-12 | **L-09**, **M-09** (fin), **M-11** | Messages réseau ; rollback restart |
| 07-11 | **I-07**, **M-09**, **I-02** | Guess Lie launch ; prep ready ; prep sans session |

Ne pas rouvrir sans **régression démontrée**.

### Cause 7 — bilan M-10 / T-05 / SYN-26

| Ticket | Cause | Fix |
|--------|-------|-----|
| **M-10** | `void refresh…().then()` sans catch au mount | `runSyncPrepOnMount` + catch/feedback ; dilemma via helper ; leaderboard catch |
| **T-05** | Vote Hot Take local avant patch ; UI gardait le vote | Snapshot + rollback ; catch UI (`hotTake.js`) |
| **SYN-26** | Tap Clutch optimistic + rejet non géré ; puis dérive des `ms` sous latence | Rollback + `tapCommitInFlight` ; transport tap figé au clic ; `mergeClutchTapsFrozen` (first-wins) |

**Hors scope volontaire :** rollback votes dilemma/speedVote/truthMeter ; `results.js` mount ; indicateur « Sync… » (ARCH-22).

### Contrat produit (SYN-13b)

- **Retour** = sortie temporaire (reste membre, suit la progression)
- **Quitter → Menu des jeux** = sortie définitive du jeu courant (suit les jeux suivants)

### Chaînes encore utiles

```
Exit invité (M-06a ✅)
  → suppressSessionRoute
    → re-entry prep stale (ARCH-04 🔓)

Join mid-game (T-01 ✅) → SUBSCRIBED (T-02 ✅)
```

---

## Résidus connus (hors tickets prioritaires)

- Lobby `playing` si upsert échoue après `setLobbyPlaying` (M-11)
- `pushGameSession` passe encore `err.message` brut (L-09 mineur)
- Logs debug join dans `lobby.js`
- SYN-28 : `settings` hors scope ; course lobby `playing` vs session menu
- I-PG-01 : autres jeux sans podium dédié (hors scope)
- Policy debug lobby à purger côté Supabase si encore présente
- Optimistic votes hors Hot Take (même trou que T-05, tickets séparés)

---

## Historique fermé (référence rapide)

Pas de re-travail sauf régression. Doublons notés une seule fois.

| Cause | Fermés (sélection) |
|-------|-------------------|
| 1 | C-01/02, R-01–05, M-05a |
| 2 | M-01, P-03, M-02a, S-02 |
| 3 | I-03/04, SYN-03, M-13, M-02b, ARCH-02, SYN-29, I-PG-01, ready stale Recommencer |
| 4 | I-01/02/08, M-03b, M-06a/b, L-01, ARCH-03/03b |
| 5 | T-01/02, T-03↻, M-07, M-08, P-02, SYN-28, I-PG-01 |
| 6 | I-05, SYN-13b↻, SYN-25 |
| 7 | I-07, M-09, L-09, M-11, **M-10**, **T-05**, **SYN-26** |
| 8 | I-06, P-02, ARCH-09, **I-09 / SYN-06** |
| 11 | L-02, ARCH-21↻ |

↻ = accepté / requalifié (pas un bug à fixer)

---

*Suivi vivant. Dernière MAJ : 2026-07-25 — I-09 / SYN-06 clôturé QA terrain ; prochain = M-12.*
