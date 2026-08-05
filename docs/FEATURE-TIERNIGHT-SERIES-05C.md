# FEATURE-TIERNIGHT-SERIES-05C — Rapport

**Statut** : restore CAS fail-closed · hôte strict · JSON canonique · erreurs classées  
**Date** : 2026-08-05  
**Git** : aucune opération Git

---

## 1. Verdict

Le restore aveugle par `lobby_id` est remplacé par un **CAS** (`lobby_id` + `updated_at` du dernier état attribué au smoke) + décision fail-closed. Une modification concurrente ne peut plus être écrasée. Hôte = `lobbies.host_id` uniquement.

## 2. Défaut de restore confirmé

L’UPDATE précédent ne conditionnait que `lobby_id` → overwrite possible d’un état externe post-RPC.

## 3. Stratégie CAS retenue

1. Relire la session  
2. `decideRestoreState` : current doit matcher un **owned** (contenu + `updated_at`)  
3. Sinon `RESTORE_CONCURRENT_CHANGE` / `RESTORE_SKIPPED_AMBIGUOUS_STATE` — **aucun UPDATE**  
4. Sinon `UPDATE … WHERE lobby_id AND updated_at = expected` + `.select()`  
5. Exiger exactement 1 ligne ; vérifier `state`/`screen` restaurés  

## 4. Suivi des états attribuables au smoke

`rememberOwned` après validations réussies : `pre_mutation`, `post_finalize`, `post_advance`, `post_retry`, `post_concurrency`.  
Le CAS utilise le dernier owned reconnu.

## 5. Contrat hôte réel

`isStrictLobbyHost` : **`lobby.host_id === authUid` uniquement**.  
`membership.is_host` diagnostic seulement. Acting host refusé pour ce smoke restaurable.

## 6. Classification des erreurs RPC

`classifySmokeRpcError` : codes `TNS_*` / `ALREADY_*` → `ambiguous=false` ; timeout/transport → `ambiguous=true`. Plus de « toute RPC = ambigu ».

## 7. Comparaison JSON canonique

`canonicalizeJson` (clés d’objets triées, tableaux stables) + `deepEqualJson`. Utilisée pour immutabilité, pré-restore, post-restore.

## 8. Contrat `updated_at`

Pré-restore : preuve CAS. Post-restore : **nouvelle** valeur serveur attendue ; on ne réécrit pas l’ancien `updated_at`.

## 9. Codes de résultat restore

`RESTORE_OK` · `RESTORE_NOT_NEEDED` · `RESTORE_CONCURRENT_CHANGE` · `RESTORE_CAS_MISS` · `RESTORE_VERIFY_MISMATCH` · `RESTORE_SKIPPED_AMBIGUOUS_STATE` · `RESTORE_RLS_DENIED`

## 10. Changements CLI

Wording snapshot corrigé ; log `restoreCode` ; exit ≠ 0 si mutation sans restore sûr ; tip cleanup `tmp/tns05-smoke` ; `mode 0o600` sur fichier snapshot.

## 11. Changements bibliothèque

Helpers testables : `decideRestoreState`, `buildRestoreCas`, `canRestoreAutomatically`, `interpretRestoreUpdateResult`, `classifySmokeRpcError`, `isStrictLobbyHost`, `canonicalizeJson`, etc. Restore orchestrateur CAS.

## 12. Snapshot local et données applicatives

« Pas de credentials ni tokens ; peut contenir des données applicatives de la fixture. »  
`tmp/` gitignoré ; warning à l’écriture ; commande de suppression après succès.

## 13. Tests ajoutés

Hôte strict · JSON canonique · classify RPC · decide/CAS/RLS/miss · dry-read zéro I/O · advance+CAS restore · concurrent no overwrite · TNS non ambigu · timeout ambigu · source CAS `updated_at`.

## 14. Résultats ciblés

`featureTierNightSeries05bSmoke` : **36 pass**. Slice 03/04/05/05B : verts.

## 15. Résultat global

SERIES-05C acceptable : pas d’UPDATE lobby-only, pas d’overwrite concurrent, hôte strict, ambiguïté transport-only, JSON canonique, wording snapshot exact.

## 16. Commandes PowerShell mises à jour

```powershell
cd "c:\Users\Lepin\Documents\000_PROJETS\PARTYGAMES APP"
# SUPABASE_* + TNS05_* (CONFIRM=YES, code TNS05…)
$env:TNS05_SAVE_SNAPSHOT_FILE = "1"
$env:TNS05_DRY_READ = "1"
node scripts/tiernight-series-05-smoke.mjs
Remove-Item Env:TNS05_DRY_READ
node scripts/tiernight-series-05-smoke.mjs
# après succès :
# Remove-Item -Recurse -Force .\tmp\tns05-smoke
Remove-Item Env:TNS05_HOST_PASSWORD, Env:SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
```

## 17. Risques résiduels

- CAS repose sur `updated_at` (horloge DB) ; collision théorique si écriture externe sans changer le contenu au même timestamp (improbable).  
- Si assert échoue après mutation RPC, restore auto peut être skippé (fail-closed) → snapshot fichier recommandé.  
- Acting-host smoke toujours hors scope.

## 18. Confirmation script non branché

Oui.

## 19. Confirmation gate OFF

Oui.

## 20. Confirmation aucune opération Git

Oui.
