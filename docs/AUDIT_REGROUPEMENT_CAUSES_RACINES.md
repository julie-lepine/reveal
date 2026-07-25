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

## Focus — 2026-07-25

| | Contenu |
|--|---------|
| **Fait** | T-01/T-02 · M-08 · ready Recommencer · M-10 / T-05 / SYN-26 · I-09 · M-12 · ARCH-04 (QA terrain) |
| **Prochain** | **SYN-12 / M-05b** — double `startMultiplayerSync` au mount lobby |
| **Ensuite** | M-04b · SYN-15/16 |

**Résidus (hors file prioritaire)**  
UI Guess Lie avant `await` · `statsRecordedRoundIdx` · loader UI join · pré-résolution `get*EntryScreen` · votes optimistic (dilemma / speedVote / …) · `results.js` mount refresh · échec remote rename (doc QA I-09)

**Surveiller**  
Clutch taps figés sous latence · ready prep après Recommencer · Cause 4 seulement si régression

---

## File d’attente

### Prioritaires

| # | ID | Cause | Problème | Statut |
|---|----|-------|----------|--------|
| 1 | **SYN-12 / M-05b** | 9 | Double `startMultiplayerSync` au mount lobby | **Prochain** |
| 2 | **M-14a / SYN-14** | 3 | TierNight topic / routing | ❌ KO QA — suspendu |
| 3 | **ARCH-06** | 6 | Handlers async multiples en vol | Dette |
| 4 | Guess Lie UX | 4/7 | UI avant await ; stats round local-only | Post I-08 |
| 5 | Loader UI join | 5/11 | Interstitiel join | Hors T-01/T-02 |
| 6 | Pré-résolution entry screens | 5 | `get*EntryScreen` (filet M-08 conservé) | Hors M-08 |
| 7 | **M-04b / SYN-18** | 7 | Timers `withPatchTimeout` non cleared | Résidu Cause 7 |
| 8 | **SYN-15 / SYN-16** | 8 | Merge stats/scores stale | Après I-09 |
| 9 | **ARCH-22** | 11 | Pas de feedback sync lente | Ouvert |

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
| **SYN-05 / ARCH-18** | 6/10 | Fil Rouge dormant | Dormant |
| **ARCH-11–17, SYN-19–24, SYN-27** | 9–10 | Monolithe / dup / code mort | Dette |

---

## Carte des causes racines

| # | Cause | État | Ouvert notable |
|---|-------|------|----------------|
| 1 | Identité invité / JWT | ✅ QA | ARCH-01 partiel |
| 2 | Race auth / profil | ✅ QA | — |
| 3 | Sources de vérité multiples | ✅ hors TierNight | **M-14a** suspendu |
| 4 | Asymétrie hôte / invité | ✅ QA (I-08, ARCH-03/03b) | UX Guess Lie séparée |
| 5 | Routing + timing sync | ✅ M-08 · ARCH-04 | — |
| 6 | Async écrans | Partiel | ARCH-06 ; SYN-05 dormant |
| 7 | Sync silencieuse / fire-and-forget | Partiel | M-04b, ARCH-07/08… (M-10 / T-05 / SYN-26 ✅) |
| 8 | Reset / migration incomplète | Partiel | I-09 ✅ ; SYN-15/16 |
| 9 | Sync monolithe / duplication | Dette | SYN-12, ARCH-11… |
| 10 | Code mort | Dette | Fil Rouge, dead exports |
| 11 | Friction UX | Partiel | M-12 ✅ (canal lien abandonné) ; ARCH-22 |

---

## Détail des tickets ouverts

Le détail fichier / fix proposé vit dans le code ou les commits.

### Cause 5 — Routing / timing

| ID | Problème | Où | Action |
|----|----------|-----|--------|
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
| **SYN-15 / SYN-16** | Merge stats/scores avec noms stale | Ouvert |
| **ARCH-10** | Cache session clear trop tard au leave | 🟡 |

### Autres causes

| ID | Cause | Problème |
|----|-------|----------|
| **M-14a** | 3 | TierNight : hôte → ancien récap 2e liste ; invité saute choix tierlists — ❌ suspendu |
| **SYN-12** | 9 | Double `startMultiplayerSync` mount lobby |
| **ARCH-06** | 6 | Double mount / handlers en vol |
| **ARCH-01** | 1 | Démo locale sans avertissement MP |

---

## Clôtures récentes

Ne pas rouvrir sans **régression démontrée**.

| Date | IDs | Note |
|------|-----|------|
| 07-25 | **ARCH-04** | ✅ QA terrain — bandeau Rejoindre étendu aux prep ; `isResumableSessionDestination` partagé |
| 07-25 | **M-12** | ✅ cleanup — canal `#join=` abandonné (décision produit) |
| 07-25 | **I-09 / SYN-06** | ✅ QA terrain — `renameLocalPlayer` migre scores / baseline / `*Game` ; tests dédiés |
| 07-25 | **M-10 / SYN-10** | ✅ QA — `bb8f71c` : catch `syncPrepOnMount` + leaderboard |
| 07-25 | **T-05** | ✅ QA — `faeb33f` : rollback vote Hot Take |
| 07-25 | **SYN-26** | ✅ QA — catch/rollback tap Clutch ; freeze `{ms,at}` au clic + merge first-wins |
| 07-25 | **M-08 / SYN-13** | `6b85d84` — nested redirect / navStack / cleanup |
| 07-25 | Ready prep (Recommencer) | ✅ QA — `c27e604` : `mergeReadyMapsLocal` + `ready: {}` fin de partie |
| 07-25 | **T-01**, **T-02** | `5c1b61d` — hydrate → sync ; debounce SUBSCRIBED |
| 07-24 | **I-08**, **ARCH-03**, **ARCH-03b** | RLS host-only ; acting UI ; Guess Lie RPC |
| 07-22 | **SYN-28**, Cause 4 UX, **I-PG-01**, **I-05/06**, **M-11**, **SYN-13b**… | Suivi hub sans F5 ; podium ; ready lobby ; rollback restart |
| 07-12 | **L-09**, **M-09**, **M-11** | Messages réseau ; rollback restart |
| 07-11 | **I-07**, **M-09**, **I-02** | Guess Lie launch ; prep ready ; prep sans session |

### Bilan Cause 7 — M-10 / T-05 / SYN-26

| Ticket | Problème | Fix |
|--------|----------|-----|
| **M-10** | `void refresh…().then()` sans catch au mount | `runSyncPrepOnMount` + catch/feedback |
| **T-05** | Vote Hot Take local avant patch ; UI gardait le vote | Snapshot + rollback |
| **SYN-26** | Tap Clutch optimistic + rejet non géré ; dérive des `ms` | Rollback + freeze au clic ; merge first-wins |

**Hors scope volontaire :** rollback votes dilemma/speedVote/truthMeter · `results.js` mount · indicateur « Sync… » (ARCH-22)

### Contrat produit (SYN-13b)

- **Retour** = sortie temporaire (reste membre, suit la progression)
- **Quitter → Menu des jeux** = sortie définitive du jeu courant (suit les jeux suivants)

### Chaînes utiles

```
Exit invité (M-06a ✅)
  → suppressSessionRoute
    → bandeau Rejoindre prep (ARCH-04 ✅)

Join mid-game (T-01 ✅) → SUBSCRIBED (T-02 ✅)
```

---

## Résidus connus

Hors tickets prioritaires — à traiter si opportunité / régression :

- Lobby `playing` si upsert échoue après `setLobbyPlaying` (M-11)
- `pushGameSession` passe encore `err.message` brut (L-09 mineur)
- Logs debug join dans `lobby.js`
- SYN-28 : `settings` hors scope ; course lobby `playing` vs session menu
- I-PG-01 : autres jeux sans podium dédié (hors scope)
- Policy debug lobby à purger côté Supabase si encore présente
- Optimistic votes hors Hot Take (même trou que T-05, tickets séparés)

---

## Décision produit — égalités Wrong Answer Only

**Date :** 2026-07-25 · Pas une correction technique silencieuse.

| | |
|--|--|
| **Avant** | À égalité de votes, départage par la réponse enregistrée la plus tôt (`answers[name].at`) |
| **Décision** | Cette règle de départage temporel est **volontairement abandonnée** |
| **Désormais** | Seuls les votes déterminent le rang. Mêmes votes → même rang compétition (`1, 1, 3`) et même palier de points (`+15` / `+10` / `+5`) |
| **Doc joueur** | `data/gameRules.js` (`wronganswer.points`) aligné |

Clutch conserve son départage temporel (règle produit explicite inchangée).

---

## Historique fermé

Pas de re-travail sauf régression. `↻` = accepté / requalifié (pas un bug à fixer).

| Cause | Fermés (sélection) |
|-------|-------------------|
| 1 | C-01/02, R-01–05, M-05a |
| 2 | M-01, P-03, M-02a, S-02 |
| 3 | I-03/04, SYN-03, M-13, M-02b, ARCH-02, SYN-29, I-PG-01, ready stale Recommencer |
| 4 | I-01/02/08, M-03b, M-06a/b, L-01, ARCH-03/03b |
| 5 | T-01/02, T-03↻, M-07, M-08, P-02, SYN-28, I-PG-01, ARCH-04 |
| 6 | I-05, SYN-13b↻, SYN-25 |
| 7 | I-07, M-09, L-09, M-11, M-10, T-05, SYN-26 |
| 8 | I-06, P-02, ARCH-09, I-09 / SYN-06 |
| 11 | L-02, ARCH-21↻, M-12 (cleanup `#join=`, pas auto-join) |

---

*Suivi vivant · Dernière MAJ : 2026-07-25 — ARCH-04 ✅ QA terrain · prochain = SYN-12*
