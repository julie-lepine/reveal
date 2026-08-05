# FEATURE-TIERNIGHT-SERIES-05B — Rapport

**Statut** : smoke JWT dédié livré · restore hôte · non branché · gate OFF  
**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## 1. Verdict

Script `scripts/tiernight-series-05-smoke.mjs` + lib testable. Fixture verrouillée (`TNS05*` + confirm), dry-read, finalize optionnel, advance + `ALREADY_ADVANCED`, concurrence optionnelle, **restore obligatoire** via UPDATE hôte (pas de `service_role`).

## 2. Pourquoi le runbook précédent n’était pas suffisant

Pas de script Node 05 ; 03A sans fixture/restore ; SQL Editor sans JWT hôte naturel ; construction manuelle de `state` trop risquée.

## 3. Stratégie de fixture

- `TNS05_CONFIRM_STAGING_FIXTURE=YES`
- `TNS05_LOBBY_ID` + `TNS05_EXPECTED_LOBBY_CODE` (doit matcher `lobbies.code`, préfixe **`TNS05`**)
- Membre + **hôte réel** (restore RLS)
- `game_id=tiernight` + `series` v1 + 3/5/7 + manche non finale

## 4. Stratégie de restauration

**Choix : UPDATE `game_sessions` en JWT hôte** (policy `host_id`), snapshot mémoire (+ fichier optionnel `tmp/tns05-smoke/`, gitignoré).  
Pas de nouvelle RPC staging (Option A non nécessaire). Pas de `service_role`.  
Échec restore → exit ≠ 0 + procédure manuelle.

## 5. Contrat dry-read

`TNS05_DRY_READ=1` : auth, validations, résumé (uid/lobby/phase/runId/index/readiness), **zéro RPC / zéro update**.

## 6. Contrat finalize optionnel

Si `ranking` + placements/finished conformes + non dernière → `finalize_tiernight_series_round`.  
Sinon arrêt sans inventer de placements. Si déjà `between_rounds` prêt → pas de finalize.

## 7. Contrat advance

Args lus depuis l’état : lobby, runId, currentRoundId/index, `expectedPhase=between_rounds`. Pas de thème via env.

## 8. Assertions d’immutabilité

Queue, roster, items, modifier, ledgers, history, scores, playerStats, gameScores, stats, eveningGamesRecorded strictement identiques ; topic/index/phase/screen/maps/recap selon contrat advance.

## 9. Retry idempotent

Même appel N → `ALREADY_ADVANCED`, index N+1, état inchangé vs post-1ʳᵉ avance.

## 10. Test de concurrence

`TNS05_RUN_CONCURRENCY=1` (off par défaut) : deux appels `Promise.allSettled` sur fixture déjà `between_rounds` ; 1× applied + 1× ALREADY_ADVANCED ; jamais N+2 ; puis restore.

## 11. Gestion des erreurs

Étape + erreurs sans secrets ; relecture ; flags mutate/ambiguous ; restore dans `finally` ; pas de replay aveugle après timeout.

## 12. Variables d’environnement

| Variable | Sensible |
|----------|----------|
| `SUPABASE_URL` | non |
| `SUPABASE_ANON_KEY` | faible (client) |
| `TNS05_HOST_EMAIL` | selon contexte |
| `TNS05_HOST_PASSWORD` | **oui** |
| `TNS05_LOBBY_ID` | non |
| `TNS05_EXPECTED_LOBBY_CODE` | non |
| `TNS05_CONFIRM_STAGING_FIXTURE=YES` | non |
| `TNS05_DRY_READ=1` | non |
| `TNS05_RUN_CONCURRENCY=1` | non |
| `TNS05_SAVE_SNAPSHOT_FILE=1` | non |
| `SUPABASE_SERVICE_ROLE_KEY` | **interdit** (script refuse) |

## 13. Commandes PowerShell

```powershell
cd "c:\Users\Lepin\Documents\000_PROJETS\PARTYGAMES APP"

$env:SUPABASE_URL = "<Dashboard>"
$env:SUPABASE_ANON_KEY = "<Dashboard anon>"
$env:TNS05_HOST_EMAIL = "<hôte staging>"
$env:TNS05_HOST_PASSWORD = "<mdp>"
$env:TNS05_LOBBY_ID = "<uuid>"
$env:TNS05_EXPECTED_LOBBY_CODE = "TNS05...."
$env:TNS05_CONFIRM_STAGING_FIXTURE = "YES"
$env:TNS05_SAVE_SNAPSHOT_FILE = "1"

$env:TNS05_DRY_READ = "1"
node scripts/tiernight-series-05-smoke.mjs

Remove-Item Env:TNS05_DRY_READ
node scripts/tiernight-series-05-smoke.mjs

# optionnel concurrence (fixture already between_rounds) :
# $env:TNS05_RUN_CONCURRENCY = "1"
# node scripts/tiernight-series-05-smoke.mjs

Remove-Item Env:TNS05_HOST_PASSWORD, Env:SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
```

Ne pas coller les secrets dans le chat.

## 14. Fichiers créés/modifiés

| Fichier | Action |
|---------|--------|
| `scripts/tiernight-series-05-smoke.mjs` | **Créé** CLI |
| `scripts/lib/tiernightSeries05SmokeLib.mjs` | **Créé** logique |
| `tests/featureTierNightSeries05bSmoke.test.js` | **Créé** |
| `package.json` | suite test |
| `.gitignore` | `tmp/` |
| `supabase/feature-tiernight-series-05-smoke-runbook.sql` | pointeur script |
| `docs/FEATURE-TIERNIGHT-SERIES-05B.md` | rapport |

## 15. Tests ajoutés

24 tests : env/fixture, analyse, assertions, dry-read, advance+restore, RPC error ambiguous, secrets, non-branchement, gate.

## 16. Résultats ciblés

05B : **24 pass**. Non-régression SERIES-01→05 + TierNight/Live/BUG/NAV/restart/mpLaunch/AH : exécutée avec 05B.

## 17. Résultat global

Ticket acceptable : smoke JWT reproductible, fixture confirmée, snapshot+restore réels, pas de service_role, pas de SQL Editor JWT magique.

## 18. Limites restantes

- Ne crée pas la session série (lobby TNS05 + état déjà en ranking prêt ou between).
- Restore exige hôte réel (pas AH seul).
- Concurrence = mode séparé, pas enchaîné automatiquement après séquentiel.

## 19. Confirmation script non branché

Oui.

## 20. Confirmation gate OFF

Oui.

## 21. Confirmation aucune opération Git

Oui.
