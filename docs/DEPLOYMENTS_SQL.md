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

Sources : audit SQL du dépôt (`AUDIT-SQL-01`) + docs ops ([`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md), [`LAUNCH_CHECKLIST.md`](./LAUNCH_CHECKLIST.md), [`MIGRATION_I08_ARCH03.md`](./MIGRATION_I08_ARCH03.md), [`AUDIT_REGROUPEMENT_CAUSES_RACINES.md`](./AUDIT_REGROUPEMENT_CAUSES_RACINES.md)). Aucune date inventée.

| Date | Migration | Ticket | Staging | Production | Runbook | Commentaires |
| ---- | --------- | ------ | ------- | ---------- | ------- | ------------ |
| Historique (date inconnue) | [`schema.sql`](../supabase/schema.sql) | Fondation | ✅ probable | ✅ probable | — | Base lobbies / members / messages / helpers RLS |
| Historique (date inconnue) | [`fix-rls-recursion.sql`](../supabase/fix-rls-recursion.sql) | RLS recursion | 🟡 État à vérifier | 🟡 État à vérifier | — | Souvent déjà couvert par schema ; ne pas réexécuter sans contrôle policies |
| Historique (date inconnue) | [`fix-lobbies-insert.sql`](../supabase/fix-lobbies-insert.sql) | Select hôte post-insert | 🟡 État à vérifier | 🟡 État à vérifier | — | Correctif ponctuel ; peut être redondant avec schema |
| Historique (date inconnue) | [`lobby-host-close.sql`](../supabase/lobby-host-close.sql) | DELETE lobby hôte | 🟡 État à vérifier | 🟡 État à vérifier | — | Policy souvent déjà dans schema |
| Historique (date inconnue) | [`game-sessions.sql`](../supabase/game-sessions.sql) | Sessions MP | ✅ probable | ✅ probable | — | **Ne pas réexécuter** après I-08 policy host-only (rouvre UPDATE membre) |
| Historique (date inconnue) | [`lobby-lifecycle.sql`](../supabase/lobby-lifecycle.sql) | Expiration / purge | ✅ probable | ✅ probable | — | Colonnes + purge historique ; **corps purge remplacé** par lobby-closures-xx-e (ne pas réexécuter lifecycle entier après XX-E) |
| — (non déployé) | [`ops-lobby-04-enable-purge-cron.sql`](../supabase/ops-lobby-04-enable-purge-cron.sql) | OPS-LOBBY-04 | ⏳ | ⏳ | [`ops-lobby-04-purge-cron-runbook.sql`](../supabase/tests/ops-lobby-04-purge-cron-runbook.sql) | Activation scheduler uniquement — **pas une migration de schéma** ; voir §7 |
| — (non déployé) | [`lobby-closures-xx-e.sql`](../supabase/lobby-closures-xx-e.sql) | BUG-LOBBY-XX-E | ⏳ | ⏳ | [`lobby-closures-xx-e-runbook.sql`](../supabase/tests/lobby-closures-xx-e-runbook.sql) | Tombstones `lobby_closures` + RPC + replace dissolve/purge ; voir §8 |
| Historique (date inconnue) | [`transfer-lobby-host.sql`](../supabase/transfer-lobby-host.sql) | Transfert hôte | ✅ probable | ✅ probable | — | |
| Historique (date inconnue) | [`kick-lobby-member.sql`](../supabase/kick-lobby-member.sql) | Kick membre | ✅ probable | ✅ probable | — | |
| Historique (date inconnue) | [`lobby-members-unique-name.sql`](../supabase/lobby-members-unique-name.sql) | Pseudo unique / lobby | ✅ probable | ✅ probable | — | Échoue si doublons restants |
| Historique (date inconnue) | [`reclaim-guest-membership.sql`](../supabase/reclaim-guest-membership.sql) | Reclaim invité (fondation) | 🟡 État à vérifier | 🟡 État à vérifier | — | Corps reclaim ensuite enrichi par E4-02 |
| Historique (date inconnue) | [`game-sessions-i08-arch03.sql`](../supabase/game-sessions-i08-arch03.sql) | I-08 / ARCH-03 | ✅ probable | ✅ probable | Voir [`MIGRATION_I08_ARCH03.md`](./MIGRATION_I08_ARCH03.md) | RPC contribute / customs / affirmation TM / acting host ; **ne pas réexécuter entier** après Trivia/TM ultérieurs |
| Historique (date inconnue) | [`game-sessions-arch03-fix-is-acting-host.sql`](../supabase/game-sessions-arch03-fix-is-acting-host.sql) | Hotfix `min(uuid)` | 🟡 État à vérifier | 🟡 État à vérifier | — | Appliquer seulement si 42883 encore présent ; sinon corps déjà dans i08 actuel |
| Historique (date inconnue) | [`game-sessions-arch03-hotfix-acting-play-keys.sql`](../supabase/game-sessions-arch03-hotfix-acting-play-keys.sql) | Whitelist Hot Take | 🟡 État à vérifier | 🟡 État à vérifier | — | **Remplacé** par Trivia-01A pour `apply_acting_host_play` — ne pas réexécuter après 01A |
| Historique (date inconnue) | [`game-sessions-i08-policy-host-only.sql`](../supabase/game-sessions-i08-policy-host-only.sql) | I-08 étape 4 | ✅ probable | ✅ probable | [`MIGRATION_I08_ARCH03.md`](./MIGRATION_I08_ARCH03.md) | UPDATE `game_sessions` = host réel uniquement |
| Historique (date inconnue) | [`claim-lobby-host-if-stale.sql`](../supabase/claim-lobby-host-if-stale.sql) | ARCH-03b claim hôte | 🟡 État à vérifier | 🟡 État à vérifier | — | Contrôler présence RPC au catalogue |
| Historique (date inconnue) | [`traitre-private.sql`](../supabase/traitre-private.sql) | Spot the fake | ✅ probable | ✅ probable | — | Après `is_lobby_host` |
| Historique (date inconnue) | [`lobby-polls.sql`](../supabase/lobby-polls.sql) | Sondages prochain jeu | ✅ probable | ✅ probable | — | Après I-08 host helpers |
| Historique (date inconnue) | [`game-sessions-trivia-01a-acting-host.sql`](../supabase/game-sessions-trivia-01a-acting-host.sql) | BUG-TRIVIA-01A | ✅ probable | ✅ probable | — | QA terrain 2026-07-31 (doc audit) |
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
| Historique (date inconnue) | [`fil-rouge-private.sql`](../supabase/fil-rouge-private.sql) | Fil Rouge abandonné | ❌ (ne plus déployer) | 🟡 État à vérifier (legacy éventuel) | — | Jeu retiré de l’app ; ne pas exécuter sur install neuve |

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

Commentaires : Migration déjà appliquée manuellement auparavant ; runbook SQL validé. **Reste la QA applicative** (changement de pseudo en partie TruthMeter). Ne pas réexécuter `truthmeter-01b` après cette version.

---

## 7. OPS-LOBBY-04 — Purge automatique des lobbies (`pg_cron`)

**Constat audit (repo)** : `public.purge_stale_lobbies()` est définie dans [`lobby-lifecycle.sql`](../supabase/lobby-lifecycle.sql) ; le `cron.schedule` y est **volontairement commenté**. Aucun autre scheduler dans le dépôt. Sans job actif en base, la purge auto ne tourne pas.

| Élément | Fichier / valeur |
| ------- | ---------------- |
| Fonction | `select public.purge_stale_lobbies();` |
| Jobname | `reveal-purge-stale-lobbies` |
| Fréquence recommandée | `*/15 * * * *` (15 min) — plus court seuil métier = 45 min |
| Activation (idempotente) | [`ops-lobby-04-enable-purge-cron.sql`](../supabase/ops-lobby-04-enable-purge-cron.sql) |
| Runbook QA Ops | [`ops-lobby-04-purge-cron-runbook.sql`](../supabase/tests/ops-lobby-04-purge-cron-runbook.sql) |
| Prérequis | Extension `pg_cron` (Dashboard → Extensions) ; `lobby-lifecycle.sql` déjà appliqué |

**Procédure Ops (ne pas inventer de date ici)** :

1. Staging : vérifier `pg_cron` + fonction (runbook A–D lecture seule).
2. Staging : exécuter [`ops-lobby-04-enable-purge-cron.sql`](../supabase/ops-lobby-04-enable-purge-cron.sql).
3. Staging : runbook E–F (lobby stale / lobby actif).
4. Production : mêmes étapes A–D puis activation + E–F contrôlé.
5. Ajouter une entrée journal ci-dessous avec **date réelle** d’activation et résultats.

**Statut** : ⏳ activation **non tracée** dans ce registre (à faire après exécution Ops).

### Modèle d’entrée journal (après activation)

```markdown
## YYYY-MM-DD

Migration : ops-lobby-04-enable-purge-cron.sql (ops / pas de schéma)
Ticket : OPS-LOBBY-04

Staging :
Production :

Runbook : ops-lobby-04-purge-cron-runbook.sql (A–F)

Résultat :

Commentaires : job reveal-purge-stale-lobbies · schedule */15 * * * *
```

---

## 8. BUG-LOBBY-XX-E — Tombstones de fermeture (`lobby_closures`)

**Problème** : purge et dissolve produisent le même `DELETE lobbies` ; le client affichait une attribution fausse à l’hôte.

| Élément | Fichier / valeur |
| ------- | ---------------- |
| Migration | [`lobby-closures-xx-e.sql`](../supabase/lobby-closures-xx-e.sql) — statut **⏳** tant que non appliquée |
| Runbook | [`lobby-closures-xx-e-runbook.sql`](../supabase/tests/lobby-closures-xx-e-runbook.sql) |
| Table | `public.lobby_closures` (PK `lobby_id`, **pas** de FK CASCADE vers `lobbies`) |
| Reasons | `host_closed` \| `inactive_expired` |
| RPC lecture | `get_lobby_closure(uuid)` — authenticated ; table non SELECT publique |
| Remplace | `dissolve_lobby_atomically` (E5-01) · `purge_stale_lobbies` (lifecycle) |
| Rétention | **14 jours** via `purge_old_lobby_closures()` en fin de `purge_stale_lobbies` |
| Ne pas réexécuter après XX-E | `lobby-membership-e5-01-dissolve-lobby-atomically.sql` · `lobby-lifecycle.sql` (corps fonctions) |

**Statut** : ⏳ migration **non appliquée** (pas de date inventée). Après exécution Ops : journal + runbook A–F.

### Modèle d’entrée journal (après application)

```markdown
## YYYY-MM-DD

Migration : lobby-closures-xx-e.sql
Ticket : BUG-LOBBY-XX-E

Staging :
Production :

Runbook : lobby-closures-xx-e-runbook.sql

Résultat :

Commentaires : remplace dissolve E5 + purge lifecycle ; rétention 14 j
```
