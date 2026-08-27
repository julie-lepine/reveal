# Registre de déploiement SQL

Référence officielle des migrations SQL réellement appliquées sur les projets Supabase REVEAL.

---

## 1. Objectif

Ce registre existe pour arrêter de suivre les migrations « de mémoire ».

Il ne remplace **pas** :

* les fichiers SQL dans [`supabase/`](../supabase/) (source de vérité technique) ;
* les runbooks dans [`supabase/tests/`](../supabase/tests/) et les harness staging ;
* les requêtes de contrôle lecture seule (catalogue Postgres).

Il sert **uniquement** à tracer ce qui a été exécuté dans le SQL Editor (ou équivalent) : quel fichier, quand, sur quel environnement, avec quel résultat.

L’existence d’un fichier `.sql` dans le dépôt **ne prouve pas** qu’il a été appliqué. Seule une ligne de ce journal (ou une vérification catalogue) le prouve.

---

## 2. Légende

| Statut | Signification |
| ------ | ------------- |
| ✅ | Appliqué et validé |
| 🟡 | Appliqué mais QA / runbook en attente |
| ⏳ | Prévu mais non appliqué |
| ❌ | Abandonné ou remplacé |

**Environnements**

| Environnement | Signification |
| ------------- | ------------- |
| Staging | Projet Supabase de test / préprod |
| Production | Projet Supabase servi par l’app live |

**Mentions d’incertitude (historique)**

| Mention | Signification |
| ------- | ------------- |
| ✅ probable | Fortement suggéré par la doc / QA terrain / checklists — **non confirmé** par une ligne de ce registre ni par un dump catalogue |
| 🟡 État à vérifier | Présence ou version active inconnue — contrôler via SQL lecture seule avant toute réexécution |

Ne jamais écrire « confirmé » sans preuve (entrée de ce registre après exécution, ou résultat de requêtes de contrôle collé en commentaire).

---

## 3. Déploiements historiques

Sources : audit SQL du dépôt (`AUDIT-SQL-01`) + docs ops ([`SUPABASE.md`](./SUPABASE.md), [`LAUNCH.md`](./LAUNCH.md)). Aucune date inventée.

| Date | Migration | Ticket | Staging | Production | Runbook | Commentaires |
| ---- | --------- | ------ | ------- | ---------- | ------- | ------------ |
| Historique (date inconnue) | [`schema.sql`](../supabase/schema.sql) | Fondation | ✅ probable | ✅ probable | — | Base lobbies / members / messages / helpers RLS |
| Historique (date inconnue) | [`fix-rls-recursion.sql`](../supabase/fix-rls-recursion.sql) | RLS recursion | 🟡 État à vérifier | 🟡 État à vérifier | — | Souvent déjà couvert par schema ; ne pas réexécuter sans contrôle policies |
| Historique (date inconnue) | [`fix-lobbies-insert.sql`](../supabase/fix-lobbies-insert.sql) | Select hôte post-insert | 🟡 État à vérifier | 🟡 État à vérifier | — | Correctif ponctuel ; peut être redondant avec schema |
| Historique (date inconnue) | [`lobby-host-close.sql`](../supabase/lobby-host-close.sql) | DELETE lobby hôte | 🟡 État à vérifier | 🟡 État à vérifier | — | Policy souvent déjà dans schema |
| Historique (date inconnue) | [`game-sessions.sql`](../supabase/game-sessions.sql) | Sessions MP | ✅ probable | ✅ probable | — | **Ne pas réexécuter** après I-08 policy host-only (rouvre UPDATE membre) |
| Historique (date inconnue) | [`lobby-lifecycle.sql`](../supabase/lobby-lifecycle.sql) | Expiration / purge | ✅ probable | ✅ probable | — | Colonnes + purge historique ; **corps purge remplacé** par lobby-closures-xx-e (ne pas réexécuter lifecycle entier après XX-E) |
| 2026-08-02 | [`ops-lobby-04-enable-purge-cron.sql`](../supabase/ops-lobby-04-enable-purge-cron.sql) | OPS-LOBBY-04 | ✅ | ✅ | [`ops-lobby-04-purge-cron-runbook.sql`](../supabase/tests/ops-lobby-04-purge-cron-runbook.sql) | Job `reveal-purge-stale-lobbies` */15 — QA terrain ✅ · voir §7 |
| 2026-08-02 | [`lobby-closures-xx-e.sql`](../supabase/lobby-closures-xx-e.sql) | BUG-LOBBY-XX-E | ✅ | ✅ | [`lobby-closures-xx-e-runbook.sql`](../supabase/tests/lobby-closures-xx-e-runbook.sql) | Tombstones + dissolve/purge ; QA terrain ✅ · voir §8 |
| 2026-08-02 | [`app-client-compatibility.sql`](../supabase/app-client-compatibility.sql) | ARCH-23 Vague 1 | ✅ | ✅ | — | Floor `min_client_compatibility_build=1` · **aucun bump cassant** · QA terrain ouverte · voir §9 |
| ✅ Appliqué (projet cible) | [`feature-vibecheck-01-remove-allowlist.sql`](../supabase/feature-vibecheck-01-remove-allowlist.sql) | FEATURE-VIBECHECK-01 | ✅ | ✅ cible | — | Retrait `playlistguess` des allowlists serveur (poll · contribute · acting host play · complete session) · voir §10 |
| Historique (date inconnue) | [`transfer-lobby-host.sql`](../supabase/transfer-lobby-host.sql) | Transfert hôte | ✅ probable | ✅ probable | — | |
| Historique (date inconnue) | [`kick-lobby-member.sql`](../supabase/kick-lobby-member.sql) | Kick membre | ✅ probable | ✅ probable | — | |
| Historique (date inconnue) | [`lobby-members-unique-name.sql`](../supabase/lobby-members-unique-name.sql) | Pseudo unique / lobby | ✅ probable | ✅ probable | — | Échoue si doublons restants |
| Historique (date inconnue) | [`reclaim-guest-membership.sql`](../supabase/reclaim-guest-membership.sql) | Reclaim invité (fondation) | 🟡 État à vérifier | 🟡 État à vérifier | — | Corps reclaim ensuite enrichi par E4-02 |
| Historique (date inconnue) | [`game-sessions-i08-arch03.sql`](../supabase/game-sessions-i08-arch03.sql) | I-08 / ARCH-03 | ✅ probable | ✅ probable | Voir [`MIGRATION_I08_ARCH03.md`](./MIGRATION_I08_ARCH03.md) | RPC contribute / customs / affirmation TM / acting host ; **ne pas réexécuter entier** après Trivia/TM ultérieurs · `playlistguess` retiré via [`feature-vibecheck-01-remove-allowlist.sql`](../supabase/feature-vibecheck-01-remove-allowlist.sql) (✅) |
| Historique (date inconnue) | [`game-sessions-arch03-fix-is-acting-host.sql`](../supabase/game-sessions-arch03-fix-is-acting-host.sql) | Hotfix `min(uuid)` | 🟡 État à vérifier | 🟡 État à vérifier | — | Appliquer seulement si 42883 encore présent ; sinon corps déjà dans i08 actuel |
| Historique (date inconnue) | [`game-sessions-arch03-hotfix-acting-play-keys.sql`](../supabase/game-sessions-arch03-hotfix-acting-play-keys.sql) | Whitelist Hot Take | 🟡 État à vérifier | 🟡 État à vérifier | — | **Remplacé** par Trivia-01A pour `apply_acting_host_play` — ne pas réexécuter après 01A |
| Historique (date inconnue) | [`game-sessions-i08-policy-host-only.sql`](../supabase/game-sessions-i08-policy-host-only.sql) | I-08 étape 4 | ✅ probable | ✅ probable | [`MIGRATION_I08_ARCH03.md`](./MIGRATION_I08_ARCH03.md) | UPDATE `game_sessions` = host réel uniquement |
| Historique (date inconnue) | [`claim-lobby-host-if-stale.sql`](../supabase/claim-lobby-host-if-stale.sql) | ARCH-03b claim hôte | 🟡 État à vérifier | 🟡 État à vérifier | — | Contrôler présence RPC au catalogue |
| Historique (date inconnue) | [`traitre-private.sql`](../supabase/traitre-private.sql) | Spot the fake | ✅ probable | ✅ probable | — | Après `is_lobby_host` |
| Historique (date inconnue) | [`lobby-polls.sql`](../supabase/lobby-polls.sql) | Sondages prochain jeu | ✅ probable | ✅ probable | — | Après I-08 host helpers · allowlist source mise à jour FEATURE-VIBECHECK-01 (retrait `playlistguess-prep`) ; delta prod = [`feature-vibecheck-01-remove-allowlist.sql`](../supabase/feature-vibecheck-01-remove-allowlist.sql) (✅) |
| Historique (date inconnue) | [`game-sessions-trivia-01a-acting-host.sql`](../supabase/game-sessions-trivia-01a-acting-host.sql) | BUG-TRIVIA-01A | ✅ probable | ✅ probable | — | QA terrain 2026-07-31 (doc audit) · `playlistguess` retiré de `apply_acting_host_play` via [`feature-vibecheck-01-remove-allowlist.sql`](../supabase/feature-vibecheck-01-remove-allowlist.sql) (✅) | 
| Historique (date inconnue) | [`game-sessions-trivia-01b-reveal-round.sql`](../supabase/game-sessions-trivia-01b-reveal-round.sql) | BUG-TRIVIA-01B | ✅ probable | ✅ probable | [`trivia-01b-reveal-round-rollback.sql`](../supabase/tests/trivia-01b-reveal-round-rollback.sql) · [`trivia-01b-concurrency-runbook.sql`](../supabase/tests/trivia-01b-concurrency-runbook.sql) | Remplacé partiellement par 01B-bis pour `reveal_trivia_round` |
| Historique (date inconnue) | [`game-sessions-trivia-01b-answer-auto-reveal.sql`](../supabase/game-sessions-trivia-01b-answer-auto-reveal.sql) | BUG-TRIVIA-01B-bis | ✅ probable | ✅ probable | [`trivia-01b-bis-answer-rollback.sql`](../supabase/tests/trivia-01b-bis-answer-rollback.sql) | Définition Trivia attendue |
| Historique (date inconnue) | [`game-sessions-truthmeter-01b-reveal-round.sql`](../supabase/game-sessions-truthmeter-01b-reveal-round.sql) | BUG-TRUTHMETER-01B | ✅ probable | ✅ probable | [`truthmeter-01b-reveal-rollback.sql`](../supabase/tests/truthmeter-01b-reveal-rollback.sql) · [`truthmeter-01b-concurrency-runbook.sql`](../supabase/tests/truthmeter-01b-concurrency-runbook.sql) | Voir §4 — **ne pas réexécuter après 02** |
| Historique (date inconnue) | [`game-sessions-truthmeter-02-author-uid.sql`](../supabase/game-sessions-truthmeter-02-author-uid.sql) | BUG-TRUTHMETER-02 | ✅ | ✅ | [`truthmeter-02-author-uid-runbook.sql`](../supabase/tests/truthmeter-02-author-uid-runbook.sql) ✅ 2026-08-02 | Voir §4 + journal — runbook A1–B2 PASS (lobby `b1b18d42-…`) ; QA app encore ouverte |
| Historique (date inconnue) | [`lobby-membership-e4-01-create-lobby-atomically.sql`](../supabase/lobby-membership-e4-01-create-lobby-atomically.sql) | Membership E4 | ✅ probable | ✅ probable | [`lobby-membership-e4-RUNBOOK.sql`](../supabase/lobby-membership-e4-RUNBOOK.sql) · [`lobby-membership-e4-staging-harness.sql`](../supabase/lobby-membership-e4-staging-harness.sql) | Smoke staging 2026-07-28 (doc audit) |
| Historique (date inconnue) | [`lobby-membership-e4-02-unique-user-index.sql`](../supabase/lobby-membership-e4-02-unique-user-index.sql) | Membership E4 | ✅ probable | ✅ probable | idem | UNIQUE `user_id` + reclaim E4 |
| Historique (date inconnue) | [`lobby-membership-e4-03-deprecate-create-lobby-member.sql`](../supabase/lobby-membership-e4-03-deprecate-create-lobby-member.sql) | Membership E4 Option A | 🟡 État à vérifier | 🟡 État à vérifier | [`lobby-membership-e4-RUNBOOK.sql`](../supabase/lobby-membership-e4-RUNBOOK.sql) étape F | Soft deprecate |
| Historique (date inconnue) | [`lobby-membership-e4-03b-revoke-create-lobby-member.sql`](../supabase/lobby-membership-e4-03b-revoke-create-lobby-member.sql) | Membership E4 Option B | 🟡 État à vérifier | 🟡 État à vérifier | [`lobby-membership-e4-RUNBOOK.sql`](../supabase/lobby-membership-e4-RUNBOOK.sql) | REVOKE conditionnel |
| Historique (date inconnue) | [`lobby-membership-e5-01-dissolve-lobby-atomically.sql`](../supabase/lobby-membership-e5-01-dissolve-lobby-atomically.sql) | Membership E5 | ✅ probable | ✅ probable | [`lobby-membership-e5-RUNBOOK.sql`](../supabase/lobby-membership-e5-RUNBOOK.sql) · [`lobby-membership-e5-staging-harness.sql`](../supabase/lobby-membership-e5-staging-harness.sql) | QA staging + terrain 2026-07-28 (doc audit) |
| Historique (date inconnue) | [`create-lobby-member.sql`](../supabase/create-lobby-member.sql) | Snapshot prod | ❌ | ❌ | — | Legacy / snapshot — **ne pas réappliquer** (réactive create legacy) |
| Historique (date inconnue) | [`fil-rouge-private.sql`](../supabase/fil-rouge-private.sql) | Fil Rouge abandonné | ❌ (ne plus déployer) | ❌ table live retirée | — | Historique uniquement · **DROP** via [`cleanup-filrouge-02-remove-server-legacy.sql`](../supabase/cleanup-filrouge-02-remove-server-legacy.sql) ✅ 2026-08-07 |
| 2026-08-27 | [`feature-friends-01.sql`](../supabase/feature-friends-01.sql) | FEATURE-FRIENDS-01 | ✅ | ✅ | [`feature-friends-01-runbook.sql`](../supabase/tests/feature-friends-01-runbook.sql) | Un seul projet live · runbook **staging only** · voir §13 |
| 2026-08-27 | [`feature-friends-02.sql`](../supabase/feature-friends-02.sql) | FEATURE-FRIENDS-02 | ✅ | ✅ | [`feature-friends-02-runbook.sql`](../supabase/tests/feature-friends-02-runbook.sql) | Invitations lobby · voir §14 |
| 2026-08-27 | [`feature-friends-03.sql`](../supabase/feature-friends-03.sql) | FEATURE-FRIENDS-03 | ✅ | ✅ | [`feature-friends-03-runbook.sql`](../supabase/tests/feature-friends-03-runbook.sql) | Annuler demande envoyée · voir §15 |
| 2026-08-27 | [`feature-friends-03-live-identity.sql`](../supabase/feature-friends-03-live-identity.sql) | FEATURE-FRIENDS-03 identité | ✅ | ✅ | — | Tes amis « Joueur » / 👤 · voir §16 |

**Hors migrations (tracés ailleurs si besoin)** : préflight [`lobby-membership-e4-00-preflight-duplicates.sql`](../supabase/lobby-membership-e4-00-preflight-duplicates.sql) (lecture seule) ; runbooks / harness sous [`supabase/tests/`](../supabase/tests/) et [`lobby-membership-e4-RUNBOOK.sql`](../supabase/lobby-membership-e4-RUNBOOK.sql) / [`lobby-membership-e5-RUNBOOK.sql`](../supabase/lobby-membership-e5-RUNBOOK.sql) — ce ne sont pas des migrations. Voir aussi [`lobby-membership-e4-tests-manual.sql`](../supabase/lobby-membership-e4-tests-manual.sql).

---

## 4. TruthMeter

Chaîne attendue : I-08 (affirmation) → **01B** (reveal / vote / scoring / runId) → **02** (authorUid).

Il n’existe **pas** de fichier SQL dédié BUG-TRUTHMETER-01A (correctif client uniquement).

| Migration | Statut |
| --------- | ------ |
| [`game-sessions-truthmeter-01b-reveal-round.sql`](../supabase/game-sessions-truthmeter-01b-reveal-round.sql) | ✅ probable (QA doc 2026-08-02) — **ne pas réexécuter après 02** |
| [`game-sessions-truthmeter-02-author-uid.sql`](../supabase/game-sessions-truthmeter-02-author-uid.sql) | ✅ appliquée + runbook SQL validé 2026-08-02 |

| Runbook | Statut |
| ------- | ------ |
| [`truthmeter-02-author-uid-runbook.sql`](../supabase/tests/truthmeter-02-author-uid-runbook.sql) | ✅ **PASS** 2026-08-02 (SETUP OK, A1–B2 PASS, 3 membres, resolve présente) |
| [`truthmeter-01b-reveal-rollback.sql`](../supabase/tests/truthmeter-01b-reveal-rollback.sql) | Optionnel (régression) — non exigé pour clôturer 02 |
| [`truthmeter-01b-concurrency-runbook.sql`](../supabase/tests/truthmeter-01b-concurrency-runbook.sql) | Optionnel (régression) — non exigé pour clôturer 02 |

**QA applicative BUG-TRUTHMETER-02** : encore ouverte (rename pseudo / authorUid pendant une vraie partie).

Définitions actives attendues après 02 : `truth_meter_resolve_author_uid`, `submit_truth_meter_*` / expected voters / scoring issus de 02 ; `reveal_truth_meter_round` reste le corps 01B.

---

## 5. Procédure pour les prochaines migrations

Workflow officiel :

1. **Créer** un nouveau fichier SQL dans [`supabase/`](../supabase/) (ne pas réécrire une ancienne migration pour « corriger » — nouveau fichier `…-03-….sql` si remplacement).
2. **Appliquer** la migration sur **Staging** (SQL Editor).
3. **Exécuter** le runbook associé ([`supabase/tests/`](../supabase/tests/) ou harness) sur Staging.
4. **Effectuer** la QA applicative (app branchée sur Staging).
5. **Appliquer** la même migration sur **Production**.
6. **Ajouter** immédiatement une entrée dans ce registre (section journal ci-dessous ou tableau §3) avec date réelle, environnements, résultat runbook / QA.

Avant toute réexécution d’un fichier historique : vérifier le catalogue (fonctions / policies) et ce registre. En cas de doute → **ne pas** coller l’ancien SQL.

---

## 6. Modèle vierge

Copier pour chaque prochain ticket :

```markdown
## YYYY-MM-DD

Migration :
Ticket :

Staging :
Production :

Runbook :

Résultat :

Commentaires :
```

### Journal des déploiements (nouveaux)

## 2026-08-02

Migration : [`game-sessions-truthmeter-02-author-uid.sql`](../supabase/game-sessions-truthmeter-02-author-uid.sql)  
Ticket : BUG-TRUTHMETER-02

Staging : ✅ (si le SQL Editor utilisé = Staging ; sinon N/A — un seul projet)  
Production : ✅ (projet contenant le lobby `b1b18d42-bbd2-4eec-aaaa-fd5af353acfd`)

Runbook : [`truthmeter-02-author-uid-runbook.sql`](../supabase/tests/truthmeter-02-author-uid-runbook.sql)

Résultat : SETUP OK · A1 PASS · A2 PASS · A3 PASS · A4 PASS · A5 PASS · B1 PASS · B2 PASS  
Auteur test : Joulaille la GOAT (`1c2146d8-…`) · 3 membres · `truth_meter_resolve_author_uid` présente

Commentaires : Migration déjà appliquée manuellement auparavant ; runbook SQL validé. QA applicative TruthMeter-02 clôturée. Ne pas réexécuter `truthmeter-01b` après cette version.

## 2026-08-02 (suite)

Migration : [`ops-lobby-04-enable-purge-cron.sql`](../supabase/ops-lobby-04-enable-purge-cron.sql) (ops / pas de schéma)  
Ticket : OPS-LOBBY-04

Staging : ✅  
Production : ✅

Runbook : [`ops-lobby-04-purge-cron-runbook.sql`](../supabase/tests/ops-lobby-04-purge-cron-runbook.sql)

Résultat : job `reveal-purge-stale-lobbies` actif · `*/15 * * * *` · purge stale + Realtime OK (QA terrain)

Commentaires : Ticket **clôturé**.

## 2026-08-02 (suite)

Migration : [`lobby-closures-xx-e.sql`](../supabase/lobby-closures-xx-e.sql)  
Ticket : BUG-LOBBY-XX-E

Staging : ✅  
Production : ✅

Runbook : [`lobby-closures-xx-e-runbook.sql`](../supabase/tests/lobby-closures-xx-e-runbook.sql)

Résultat : tombstones `host_closed` / `inactive_expired` · modales distinctes · QA terrain OK

Commentaires : Remplace dissolve E5 + corps purge lifecycle. Rétention 14 j. Ticket **clôturé**. Ne pas réexécuter E5-01 ni lifecycle entier après XX-E.

---

## 7. OPS-LOBBY-04 — Purge automatique des lobbies (`pg_cron`)

| Élément | Fichier / valeur |
| ------- | ---------------- |
| Fonction | `select public.purge_stale_lobbies();` |
| Jobname | `reveal-purge-stale-lobbies` |
| Fréquence | `*/15 * * * *` |
| Activation | [`ops-lobby-04-enable-purge-cron.sql`](../supabase/ops-lobby-04-enable-purge-cron.sql) |
| Runbook | [`ops-lobby-04-purge-cron-runbook.sql`](../supabase/tests/ops-lobby-04-purge-cron-runbook.sql) |

**Statut** : ✅ appliqué + QA terrain 2026-08-02 (ticket clôturé).

---

## 8. BUG-LOBBY-XX-E — Tombstones de fermeture (`lobby_closures`)

| Élément | Fichier / valeur |
| ------- | ---------------- |
| Migration | [`lobby-closures-xx-e.sql`](../supabase/lobby-closures-xx-e.sql) |
| Runbook | [`lobby-closures-xx-e-runbook.sql`](../supabase/tests/lobby-closures-xx-e-runbook.sql) |
| Table | `public.lobby_closures` (pas de FK CASCADE vers `lobbies`) |
| Reasons | `host_closed` \| `inactive_expired` |
| RPC | `get_lobby_closure(uuid)` |
| Remplace | dissolve E5-01 · purge lifecycle |
**Statut** : ✅ appliqué + QA terrain 2026-08-02 (ticket clôturé).

---

## 9. ARCH-23 Vague 1 — Compatibilité client (`app_client_compatibility`)

Canal principal = apps **iOS / Android**. Floor autoritaire = Supabase.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`app-client-compatibility.sql`](../supabase/app-client-compatibility.sql) — **✅ appliquée 2026-08-02** |
| Table | `app_client_compatibility` (singleton id=1) |
| Floor actuel | `min_client_compatibility_build = **1**` (= `APP_COMPATIBILITY_BUILD` Vague 1) — **aucun bump cassant** |
| RPC | `get_client_compatibility_config()` — grant **anon + authenticated** |
| Client | `js/config/appCompatibility.js` · `clientCompatibility.js` · gate UI |
| Heuristiques (centralisées) | `CLIENT_COMPAT_FRESH_MS` = 5 min · `CLIENT_COMPAT_TIMEOUT_MS` = 8 s · foreground ≥ 10 min hidden |

**Périmètre Vague 1** : boot · create · join · resume · retour foreground.

**Hors périmètre** : writes in-game pendant une partie déjà active (votes, commits, scores, phases). Si le floor est relevé mid-soirée, un ancien client peut encore envoyer ces writes jusqu’au prochain gate. Ops : conserver une fenêtre de rétrocompatibilité backend pour les parties engagées ; ne pas bumper un floor cassant au milieu d’une soirée ; ne pas ajouter un guard à chaque helper de jeu dans cette vague (ticket distinct après audit transversal).

**Contrat cache** : une incompatibilité confirmée (`lastConfirmedIncompatible`) n’est **jamais** levée par un recheck `unknown` (timeout / réseau / payload). Le hard gate reste ; feedback réseau distinct ; retry possible. Seul un recheck `compatible` vide le cache et masque le gate.

**Bump floor (ops ultérieure, PAS Vague 1)** :

1. Publier clients compatibles iOS + Android  
2. Vérifier dispo stores  
3. Puis seulement `UPDATE … SET min_client_compatibility_build = N`  
4. Contrôler logs `[ARCH-23]` refus

**Statut** : ✅ SQL appliquée · floor = **1** · **ne pas bumper** sans instruction · QA terrain ouverte · ticket **non clôturé**.

---

## 10. FEATURE-VIBECHECK-01 — Retrait VibeCheck / PlaylistGuess (allowlists serveur)

Suppression produit du jeu VibeCheck (`game_id` client `playlistguess`, écran `playlistguess-prep`). Code client déjà retiré (sélection, nav, sync, scoring, assets, tests). Ce fichier ne touche que les **fonctions serveur** qui listaient explicitement `playlistguess`/`playlistGuess`.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-vibecheck-01-remove-allowlist.sql`](../supabase/feature-vibecheck-01-remove-allowlist.sql) — **✅ appliquée** (projet Supabase cible, confirmé) |
| Fonctions redéfinies | `reveal_poll_allowed_game_ids` · `game_session_state_key` · `game_session_expected_game_id` · `contribute_game_session_player` · `apply_acting_host_play` · `complete_game_session_as_actor` |
| Effet | Retrait des entrées `playlistguess` / `playlistGuess` uniquement ; corps sinon identique aux versions actuellement en production |
| Sessions orphelines | Aucune donnée supprimée/modifiée par ce fichier ; une session `game_id='playlistguess'` existante devient simplement injoignable via ces RPC (refus explicite) jusqu'à sa clôture naturelle (purge / dissolve / leave) |
| Client | Ne propose plus ce jeu ; fallback hub si session orpheline (`isScreenRegistered` / `routeToSessionScreen` → `game-select`) |
| Hors scope | Table `lobby_polls` / `game_sessions` (schéma inchangé) · aucun DELETE de lignes existantes |

**Statut** : Client + SQL + QA GitHub Pages ✅ · ticket **clôturé** (2026-08-02).

---

## 11. CLEANUP-FILROUGE-02 — Retrait legacy serveur Fil Rouge

Nettoyage serveur après retrait produit Fil Rouge (app déjà propre via CLEANUP-FILROUGE-01). Base = définitions LIVE D2 + garde MD5 ; deltas minimaux uniquement.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`cleanup-filrouge-02-remove-server-legacy.sql`](../supabase/cleanup-filrouge-02-remove-server-legacy.sql) — **✅ appliquée** (projet cible, 2026-08-07) |
| Post-deploy | [`tests/cleanup-filrouge-02-postdeploy-check.sql`](../supabase/tests/cleanup-filrouge-02-postdeploy-check.sql) — **PASS** |
| Fonctions | `apply_acting_host_play` (− `filRougeScores` deny) · `complete_game_session_as_actor` (− `filRouge` / `playlistGuess` ; **`tiernight-end` conservé**) · `remap_lobby_user_id` (− branche `fil_rouge_private`) |
| Table | `DROP TABLE IF EXISTS public.fil_rouge_private` (sans CASCADE) — absente live |
| Client | `stripLegacyFilRougeKeys` **conservé** (localStorage) · `gameScoreSessionKey` inchangé |
| Hors scope | Migrations historiques non réécrites · aucun REVOKE/GRANT (ACL live préservées) |

**Statut** : SQL + post-deploy ✅ · ticket **CLEANUP-FILROUGE-02** clôturable (2026-08-07).

---

## 12. FEATURE-ADFREE-01 — Flag Sans pub (`profiles.ad_free`)

Premier palier Premium (2,99 €) : entitlement serveur, **sans IAP** pour l’instant. Le client lit le flag et masque la bannière AdMob. L’écriture `ad_free = true` est bloquée pour `authenticated` / `anon` (trigger).

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-adfree-01-profile-flag.sql`](../supabase/feature-adfree-01-profile-flag.sql) — **⏳ à appliquer** (SQL Editor staging puis prod) |
| Colonne | `public.profiles.ad_free boolean not null default false` |
| Client | `js/core/entitlements.js` · `js/core/ads.js` · Menu → Profil |
| Test manuel | `update public.profiles set ad_free = true where id = '<uuid>';` puis Actualiser le statut |
| Hors scope | Play Billing · App Store · RevenueCat · palier 6,99 / 12,99 |

**Statut** : code client dans le repo · SQL **non appliquée** tant que cette ligne n’est pas passée à ✅.

---

## 13. FEATURE-FRIENDS-01 — Graphe d’amis (Palier 1 SQL)

Tables `friend_requests` / `friendships` / `friend_request_cooldowns` + RPC. Découverte lobby only. Pas de fil public.

Un seul projet Supabase (`ojzxbvpdfnwagrvbhfll`) : staging QA = prod app.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-friends-01.sql`](../supabase/feature-friends-01.sql) — **✅** 27 août 2026 (dont hotfix `friends_lock_pair` 1-arg) |
| Runbook | [`tests/feature-friends-01-runbook.sql`](../supabase/tests/feature-friends-01-runbook.sql) — **`FRIENDS01_RUNBOOK_OK`** (staging, **ne pas relancer**) |
| Realtime | `friend_requests` + `friendships` on (Publications). Pas les cooldowns |
| Client | [`FRIENDS.md`](./FRIENDS.md) Palier 10 — web Pages ; pas le build App Store 1.0.0 en review |
| Hors scope | Invites lobby (FEATURE-FRIENDS-02) · push · DM |

**Statut** : SQL + Realtime **✅ prod** (même projet) · Palier 10 **27 août 2026**.

---

## 14. FEATURE-FRIENDS-02 — Invitations de lobby

Table `lobby_invites` + RPC send/decline/accept/list. Join **sans** le code. CASCADE à la mort du lobby. Pas de colonnes d’invite sur `lobby_members`.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-friends-02.sql`](../supabase/feature-friends-02.sql) — **✅** 27 août 2026 |
| Runbook | [`tests/feature-friends-02-runbook.sql`](../supabase/tests/feature-friends-02-runbook.sql) — **`FRIENDS02_RUNBOOK_OK`** (staging, **ne pas relancer**) |
| Realtime | `lobby_invites` on (Publications). Même topic client `friends:${userId}` |
| Client | [`FRIENDS.md`](./FRIENDS.md) Palier 9 — web Pages ; pas le build App Store 1.0.0 en review |
| Hors scope | Push · QR · deep link · présence hors lobby |

**Statut** : SQL + Realtime **✅ prod** (même projet) · Palier 9 **27 août 2026**.

---

## 15. FEATURE-FRIENDS-03 — Annuler une demande envoyée

RPC `cancel_friend_request` / `list_outgoing_friend_requests`. Pas de nouvelle table. Realtime inchangé (`friend_requests`). Pas de cooldown à l’annulation.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-friends-03.sql`](../supabase/feature-friends-03.sql) — **✅** 27 août 2026 |
| Runbook | [`tests/feature-friends-03-runbook.sql`](../supabase/tests/feature-friends-03-runbook.sql) — **`FRIENDS03_RUNBOOK_OK`** (staging, **ne pas relancer**) |
| Realtime | inchangé (`friend_requests` déjà on) |
| Client | [`FRIENDS.md`](./FRIENDS.md) Phase 3 palier 5 — web Pages ; pas le build App Store 1.0.0 en review |
| Hors scope | Annuler une invitation de soirée · toast destinataire · cooldown |

**Statut** : SQL **✅** (même projet) · Palier 5 Pages **27 août 2026**.

---

## 16. FEATURE-FRIENDS-03 — Identité live (Tes amis)

Les listes d’amis relisaient uniquement `profiles`. Un compte dont la ligne était absente ou restée sur le fallback « Joueur » / 👤 s’affichait en placeholder, alors que le pseudo d’inscription (`raw_user_meta_data.display_name`) et/ou `lobby_members` étaient bons.

Helpers `friends_live_display_name` / `friends_live_emoji` + relit `list_my_friends`, `list_incoming_friend_requests`, `list_outgoing_friend_requests`, `list_incoming_lobby_invites`. UPDATE des profils placeholder. Pas de nouvelle table. Realtime inchangé.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-friends-03-live-identity.sql`](../supabase/feature-friends-03-live-identity.sql) — **✅** 27 août 2026 |
| Runbook | aucun (idempotent, pas de comptes de test) |
| Realtime | inchangé |
| Client | login soigne `profiles` si encore placeholder ; inscription n’échoue plus si upsert sans session |
| Hors scope | FEATURE-FRIENDS-04 · stores 1.0.0 |

**Statut** : SQL **✅** (même projet) · QA Tes amis **27 août 2026**.
