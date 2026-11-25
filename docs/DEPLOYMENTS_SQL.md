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
| 2026-08-27 | [`feature-friends-04.sql`](../supabase/feature-friends-04.sql) | FEATURE-FRIENDS-04 | ✅ | ✅ | [`feature-friends-04-runbook.sql`](../supabase/tests/feature-friends-04-runbook.sql) | Croisés 24 h · runbook **staging only** · voir §17 |
| 2026-08-27 | [`feature-friends-04-dissolve-trigger.sql`](../supabase/feature-friends-04-dissolve-trigger.sql) | FEATURE-FRIENDS-04 hotfix | ✅ | ✅ | — | BEFORE DELETE dissolve + `NOTIFY pgrst` · voir §17 |
| 2026-09-04 | [`feature-profile-01-profile-flag.sql`](../supabase/feature-profile-01-profile-flag.sql) | FEATURE-PROFILE-01 | ✅ | ✅ | — | Colonne `profiles.profile_pack` + trigger · catalogue `boolean` confirmé · voir §18 |
| 2026-09-05 | [`feature-profile-03-identity.sql`](../supabase/feature-profile-03-identity.sql) | FEATURE-PROFILE-03 | ✅ | ✅ | — | `name_color` + snapshot salon + friends_live_* · voir §19 |
| 2026-09-05 | [`feature-profile-03b-emoji-split.sql`](../supabase/feature-profile-03b-emoji-split.sql) | FEATURE-PROFILE-03b | ✅ | ✅ | — | 12 emojis → Signature (😈👻🔥🐸💎🌈 + 😎💜🌟🎯🚀🎈) · coller si 03 déjà en prod |
| 2026-09-05 | [`feature-profile-03c-emoji-fe0f.sql`](../supabase/feature-profile-03c-emoji-fe0f.sql) | FEATURE-PROFILE-03c | ☐ | ☐ | — | Trigger : strip U+FE0F sinon 🦄 → 👤 · coller prod |
| 2026-09-07 | [`feature-profile-id-old.sql`](../supabase/feature-profile-id-old.sql) | ID-OLD | ✅ | ✅ | [`feature-profile-id-old-runbook.sql`](../supabase/tests/feature-profile-id-old-runbook.sql) | UPDATE pack = old OR new · coller après 03c+05 · QA **✅** 7 sept 2026 Anrobensy · voir §30 |
| 2026-09-07 | [`feature-profile-av-storage.sql`](../supabase/feature-profile-av-storage.sql) | AV-STORAGE | ✅ | ✅ | [`feature-profile-av-storage-runbook.sql`](../supabase/tests/feature-profile-av-storage-runbook.sql) | Storage avatars write : owner + pack OR host · coller après 05 + HOST-01 · **ne pas** réexécuter 05 · QA **✅** 7 sept 2026 Anrobensy A/B/C/F · voir §32 |
| 2026-09-05 | [`feature-profile-04-carnet.sql`](../supabase/feature-profile-04-carnet.sql) | FEATURE-PROFILE-04 | ☐ | ☐ | — | Carnet 20 soirées · RPC archive/list · voir §20 |
| 2026-09-05 | [`feature-host-01-profile-flag.sql`](../supabase/feature-host-01-profile-flag.sql) | FEATURE-HOST-01 | ⏳ | ⏳ | — | Colonne `profiles.host_pack` + trigger · 9,99 / 7 € / 3 € · voir §22 |
| 2026-09-06 | [`feature-host-02-invite-cap.sql`](../supabase/feature-host-02-invite-cap.sql) | FEATURE-HOST-02 / H-INVITE | ✅ | ✅ | [`feature-host-02-invite-cap-runbook.sql`](../supabase/tests/feature-host-02-invite-cap-runbook.sql) | `accept_lobby_invite` cap 8/14 via `host_pack` de l’hôte · QA **✅** 7 sept 2026 (1+13 OK, 15ᵉ refusé) · **ne pas** réexécuter friends-02 · voir §23 |
| 2026-09-07 | [`feature-host-04-race-cap.sql`](../supabase/feature-host-04-race-cap.sql) | FEATURE-HOST-04 / H-RACE | ✅ | ✅ | [`feature-host-04-race-cap-runbook.sql`](../supabase/tests/feature-host-04-race-cap-runbook.sql) | BEFORE INSERT `lobby_members` : `FOR UPDATE` lobby puis cap · QA **✅** 7 sept 2026 Pages/SQL Anrobensy (8/8→9ᵉ refusé · cap 14 9ᵉ OK · 9/8 conservés · 10ᵉ refusé) · concurrent 2 appareils **non joué** · voir §33 |
| 2026-09-07 | [`feature-profile-04b-carnet-kick.sql`](../supabase/feature-profile-04b-carnet-kick.sql) | FEATURE-PROFILE-04b / C-KICK | ✅ | ✅ | [`feature-profile-04b-carnet-kick-runbook.sql`](../supabase/tests/feature-profile-04b-carnet-kick-runbook.sql) | Jeton kick + `archive_signature_evening` · QA **✅** 7 sept 2026 · **ne pas** réexécuter 04 / kick-lobby-member · voir §25 |
| 2026-09-07 | [`feature-profile-04c-carnet-dissolve.sql`](../supabase/feature-profile-04c-carnet-dissolve.sql) | FEATURE-PROFILE-04c / C-DISSOLVE | ✅ | ✅ | [`feature-profile-04c-carnet-dissolve-runbook.sql`](../supabase/tests/feature-profile-04c-carnet-dissolve-runbook.sql) | Jetons carnet dans `dissolve_lobby_atomically` · QA **✅** 7 sept 2026 · **ne pas** réexécuter 04 / 04b / xx-e · voir §26 |
| 2026-09-15 | SQL Editor (pas de fichier `supabase/`) | warehouse v1 | ⏳ | ✅ | — | Schéma `warehouse` + triggers + vues + cron `reveal-warehouse-purge` (job 4, 04:15 UTC). Pas de grant `anon`/`authenticated`. Lecture : §34 |

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

---

## 17. FEATURE-FRIENDS-04 — Croisés récents 24 h

Table `lobby_encounters` + trigger `lobby_members` INSERT/DELETE + RPC `list_recent_lobby_peers`. Inscrits déjà co-membres seulement. Pas de Realtime. Pas d’INSERT client.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-friends-04.sql`](../supabase/feature-friends-04.sql) — **✅** 27 août 2026 |
| Hotfix | [`feature-friends-04-dissolve-trigger.sql`](../supabase/feature-friends-04-dissolve-trigger.sql) — **✅** 27 août 2026 (BEFORE DELETE + schema) |
| Runbook | [`tests/feature-friends-04-runbook.sql`](../supabase/tests/feature-friends-04-runbook.sql) — **`FRIENDS04_RUNBOOK_OK`** (staging, **INTERDIT EN PRODUCTION** — **ne pas lancer**) |
| Realtime | **non** (`lobby_encounters` hors publication) |
| Client | [`FRIENDS.md`](./FRIENDS.md) Phase 4 palier 6 — docs ✅ ; web Pages après push `main` ; **pas** le 1.0.0 App Store en review |
| Hors scope | Recherche · invités · historique > 24 h · stores 1.0.0 |

**Statut** : SQL + hotfix + QA **✅** (même projet) · runbook **non** exécuté (prod) · palier 6 docs **27 août 2026** · Pages = push `main`.

---

## 18. FEATURE-PROFILE-01 — Flag Profil (`profiles.profile_pack`)

Deuxième palier Premium (6,99 €) : entitlement serveur, **sans IAP** pour l’instant. Le client lit le flag. `isAdFree()` est aussi vrai si `profile_pack` (Profil inclut Sans pub). L’écriture `profile_pack = true` est bloquée pour `authenticated` / `anon` (trigger). Cette migration **n’écrit pas** `ad_free`.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-profile-01-profile-flag.sql`](../supabase/feature-profile-01-profile-flag.sql) — **✅** 4 sept 2026 |
| Colonne | `public.profiles.profile_pack boolean not null default false` |
| Client | `js/core/entitlements.js` (`isProfilePack`, `isAdFree`) · `js/core/supabaseProfile.js` |
| Test manuel | `update public.profiles set profile_pack = true where id = '<uuid>';` puis recharge |
| Hors scope | Play Billing · App Store · RevenueCat · webhook · UI métier · Hôte 12,99 |

**Statut** : SQL **✅ prod** (même projet) · catalogue `profile_pack` / `boolean` **4 sept 2026**.

---

## 19. FEATURE-PROFILE-03 — Identité Signature

Couleur de pseudo (palette fermée), anneau + badge salon, emojis extra. Gate serveur : sans `profile_pack`, `name_color` et emojis extra sont rejetés. `lobby_members.signature` / `name_color` sont un snapshot (trigger), pas une écriture client.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-profile-03-identity.sql`](../supabase/feature-profile-03-identity.sql) puis [`feature-profile-03c-emoji-fe0f.sql`](../supabase/feature-profile-03c-emoji-fe0f.sql) |
| Colonnes | `profiles.name_color` · `lobby_members.name_color` · `lobby_members.signature` |
| Client | `data/signatureIdentity.js` · `js/core/signatureUi.js` |
| Test manuel | `update public.profiles set profile_pack = true, name_color = 'gold' where id = '<uuid>';` puis recharge |
| Hors scope | Carte share · mots perso · Maître de soirée |

**Statut** : SQL **✅ prod** (collé 5 sept 2026). **03c** (U+FE0F → plus de 🦄 écrasée en 👤) : à coller.

---

## 20. FEATURE-PROFILE-04 — Carnet Signature

20 soirées max. `lobby_id` interne (dédup) : jamais dans le payload `list_signature_carnet`. Amis = intersection `peer_user_ids` ∩ `friendships` au moment de la lecture (`friends_live_display_name`). Écriture uniquement via RPC `archive_signature_evening` (encore membre du salon).

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-profile-04-carnet.sql`](../supabase/feature-profile-04-carnet.sql) — à coller prod |
| Table | `public.signature_evenings` (RLS, pas de GRANT SELECT client) |
| RPC | `archive_signature_evening` · `list_signature_carnet` |
| Client | `js/core/signatureCarnet.js` · `js/screens/carnet.js` · `js/core/signatureCarnetCard.js` |
| Test manuel | Signature on → joue une soirée → quitte le salon → Menu → Profil → Mon carnet → Partager ma carte |
| Hors scope | Photo hero carte · mots perso · Maître de soirée |

**Statut** : SQL **à appliquer** · 5 sept 2026.

---

## 21. FEATURE-PROFILE-05 — Photo avatar Signature

Pastille unique : la photo remplace l’emoji partout (lobby, scores, amis, aperçu Profil, carte share). Emoji conservé si l’image ne charge pas. Recadrage dans Menu → Profil, **pas** sur la carte. Le client écrit `profiles.avatar_path` / `avatar_rev` ; le trigger n’accepte que `{user_id}/avatar.jpg` et uniquement avec `profile_pack`. `lobby_members.avatar_*` = snapshot (trigger), comme `name_color` / `signature`.

Canvas share : `img.crossOrigin = "anonymous"`. Si le bucket n’envoie pas CORS, la carte retombe sur l’emoji (les pastilles in-app restent OK). Dashboard Storage → bucket `avatars` → CORS : autoriser GET depuis GitHub Pages et l’app native.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-profile-05-avatar.sql`](../supabase/feature-profile-05-avatar.sql) — à coller **après** 03-identity |
| Colonnes | `profiles.avatar_path` · `profiles.avatar_rev` · snapshot `lobby_members` |
| Storage | bucket public `avatars` · `{uid}/avatar.jpg` · JPEG ≤ 512 Ko |
| Client | `js/core/signatureAvatar.js` · `js/core/signatureUi.js` · Menu → Profil |
| Test manuel | Signature on → Profil → Choisir une photo → recadrer → visible lobby / amis / carte share ; couper le réseau → emoji |
| Hors scope | Photo hero carte · report UGC · Maître de soirée |

**Statut** : SQL **à appliquer** · 5 sept 2026.

---

## 22. FEATURE-HOST-01 — Flag Maître de soirée (`profiles.host_pack`)

Troisième palier Premium (9,99 €) : entitlement serveur. Inclut Signature + Sans pub. Upgrades store : **7,00 €** si Sans pub déjà là (`reveal_host_upgrade_adfree`), **3,00 €** si Signature déjà là (`reveal_host_upgrade_profile`). L’écriture `host_pack = true` est bloquée pour `authenticated` / `anon` (trigger). Cette migration **n’écrit pas** `profile_pack` / `ad_free`.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-host-01-profile-flag.sql`](../supabase/feature-host-01-profile-flag.sql) — **⏳** à coller |
| Colonne | `public.profiles.host_pack boolean not null default false` |
| Client | `js/core/entitlements.js` (`isHostPack`, `isProfilePack`, `isAdFree`) · Forfaits |
| Test manuel | `update public.profiles set host_pack = true, profile_pack = true, ad_free = true where id = '<uuid>';` puis recharge |
| Hors scope | Lobby > 8 · outils de table · privacy |

**Statut** : SQL **⏳** · contrat prix **5 sept 2026**.

---

## 23. FEATURE-HOST-02 — Cap invitation ami 8 / 14 (H-INVITE)

`accept_lobby_invite` (FEATURE-FRIENDS-02, ✅ 27 août 2026) refusait à **8** membres. Le join par code lisait déjà `profiles.host_pack` de **l’hôte du salon**. Cette migration remplace l’RPC (helper `lobby_max_players` : 14 si `host_pack`, sinon 8). `send_lobby_invite` : refus à salon plein = **FEATURE-HOST-03**. Ne **pas** réexécuter `feature-friends-02.sql`.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-host-02-invite-cap.sql`](../supabase/feature-host-02-invite-cap.sql) — **✅** 6 sept 2026 (après HOST-01) |
| Runbook | [`tests/feature-host-02-invite-cap-runbook.sql`](../supabase/tests/feature-host-02-invite-cap-runbook.sql) — catalogue `HOST02_INVITE_CAP_OK` |
| Client | inchangé (`lobby_invite_full` → « Cette soirée est complète. ») |
| QA | **✅** 7 sept 2026 : hôte Maître, 13 invités OK, 15ᵉ refusé |
| Hors scope | Gate SQL du join par code (toujours client) · outils de table |

**Statut** : SQL **✅** · QA **✅** 7 sept 2026.

---

## 24. FEATURE-HOST-03 — Envoi d’invite refusé à salon plein (H-INVITE-FULL)

QA 7 sept 2026 : à 14/14 l’hôte pouvait encore **envoyer** une invitation ; l’ami ne pouvait pas entrer. Cette migration ajoute le même cap `lobby_max_players` sur `send_lobby_invite`. Overbooking des places restantes inchangé. Une invite **déjà pending** après transfert d’hôte n’est pas purgée (ticket **H-INVITE-TRANSFER**).

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-host-03-send-invite-cap.sql`](../supabase/feature-host-03-send-invite-cap.sql) — **✅** 7 sept 2026 (après HOST-02) |
| Runbook | [`tests/feature-host-03-send-invite-cap-runbook.sql`](../supabase/tests/feature-host-03-send-invite-cap-runbook.sql) — catalogue `HOST03_SEND_INVITE_CAP_OK` |
| Client | bouton Amis « Soirée complète » (`isCurrentLobbyFull`) · `lobby_invite_full` → « Cette soirée est complète. » |
| QA | **✅** 7 sept 2026 : salon 14/14, envoi refusé |
| Hors scope | Purge des invites pending · limiter N invites aux sièges restants · gate SQL du join par code |

**Statut** : SQL **✅** · QA **✅** 7 sept 2026.

---

## 25. FEATURE-PROFILE-04b — Carnet après kick (C-KICK)

`archive_signature_evening` exigeait `is_lobby_member`. Le kick supprime la membership avant que le kické puisse archiver. Cette migration : table `signature_carnet_kick_allow` (écriture definer dans `kick_lobby_member`, **avant** DELETE) ; l’RPC archive accepte ce jeton 30 min pour **ce** uid + lobby.

Le client ne doit **pas** SELECT `lobbies` pour distinguer kick / dissolve : RLS masque la ligne au kické, le fetch tombe en « 0 rows » et l’ancien chemin prenait `resolveLobbyClosureAndExit` **sans** archive. Discriminant : tombstone `get_lobby_closure` ; snapshot carnet **avant** les awaits.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-profile-04b-carnet-kick.sql`](../supabase/feature-profile-04b-carnet-kick.sql) — collé (jeton) |
| Runbook | [`tests/feature-profile-04b-carnet-kick-runbook.sql`](../supabase/tests/feature-profile-04b-carnet-kick-runbook.sql) — `CARNET04B_KICK_OK` |
| Client | `js/core/lobby.js` (`handleKickedFromLobby`) · `js/core/supabaseLobby.js` (kick vs gone) |
| Hors scope | C-HOME (voir §27) |

**Statut** : SQL collé · client **fix RLS kick→dissolve** 7 sept 2026.

---

## 26. FEATURE-PROFILE-04c — Carnet après dissolve (C-DISSOLVE)

L’hôte archive tant qu’il est membre, puis `dissolve_lobby_atomically` DELETE le lobby (CASCADE membership). Les autres Signature voient `resolveLobbyClosureAndExit` trop tard : plus membres, pas de jeton → `signature_not_member`. Cette migration réécrit **uniquement** `dissolve_lobby_atomically` : jetons `signature_carnet_kick_allow` pour chaque membre `profile_pack`, **avant** DELETE. L’archive 04b les accepte 30 min. Client : snapshot + archive dans `resolveLobbyClosureAndExit` avant wipe.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-profile-04c-carnet-dissolve.sql`](../supabase/feature-profile-04c-carnet-dissolve.sql) — **✅** 7 sept 2026 (après 04b) |
| Runbook | [`tests/feature-profile-04c-carnet-dissolve-runbook.sql`](../supabase/tests/feature-profile-04c-carnet-dissolve-runbook.sql) — `CARNET04C_DISSOLVE_OK` |
| Client | `js/core/lobby.js` (`resolveLobbyClosureAndExit`) · snapshot Realtime / gone |
| Hors scope | C-HOME (client 04d, §27) · purge `inactive_expired` |

**Statut** : SQL **✅** · QA **✅** 7 sept 2026. **Ne pas** réexécuter `lobby-closures-xx-e.sql` après 04c.

---

## 27. FEATURE-PROFILE-04d — Draft carnet Accueil (C-HOME)

Pas de SQL. Snapshot d’archive Signature en localStorage (`reveal-signature-carnet-drafts`), isolé `(userId, lobbyId)`, **hors** `reveal-app-state` pour survivre à `resetEveningState` / kill. LIVE > draft. Accueil `leaveLobbyMembershipFromServer` archive (live ou draft) **puis** DELETE/dissolve. Échec RPC réel bloque le leave (draft conservé). Skip / codes silencieux : leave inchangé, pas d’archive fictive. Draft **local à l’appareil** (pas de sync cross-device). TTL 14 j. `runId` n’est pas une clé de soirée.

| Élément | Valeur |
| ------- | ------ |
| Client | `js/core/signatureCarnetDraftLogic.js` · `signatureCarnetDraftStore.js` · `signatureCarnet.js` · `leaveLobbyMembershipFromServer` |
| Tests | `tests/featureProfile04dCarnetDraft.test.js` |
| Hors scope | Realtime draft · table Supabase |

**Statut** : client **✅** · QA **✅** 7 sept 2026 (Pages A/D/E/F ; B/C non reproductibles tant que la reprise réhydrate le salon / Accueil inaccessible en lobby).

---

## 28. RC-RESTORE — Overlay Maître si Signature déjà en base

Pas de SQL. Restore / already-owned : si RevenueCat a l’entitlement `host`, le poll n’est plus coupé par `profile_pack`. Overlay session (`applyPremiumFromStore`) fusionné après chaque `fetchProfile`. Timeout 8×1 s : overlay conservé, message d’activation différée. Le client n’écrit jamais `host_pack`.

| Élément | Valeur |
| ------- | ------ |
| Client | `js/core/premiumStoreOverlay.js` · `entitlements.js` · `purchases.js` (`reconcilePremiumAfterStore`) |
| Tests | `tests/featureRcRestore.test.js` |
| Hors scope | RC-SKU-ADF · webhook SQL · GitHub Pages · écriture `host_pack` |

**Statut** : client **✅** · QA **✅** 7 sept 2026 (Pages/SQL Anrobensy A–F : overlay, `fetchProfile` ne wipe pas, grant `host_pack`, cap 14). Restore Google Play **non exécuté**.

---

## 29. RC-SKU-ADF — SKU Premium + hydrate

Pas de SQL. Helpers SKU restent purs (`user` snapshot). Sans pub effectif = `adFree OR profilePack OR hostPack` via `isAdFreeForUser(user)` (pas `isAdFree()` / `getState`). Login et `refreshAdFreeFromServer` partagent `premiumFlagsFromProfile` : `ad_free` **ou** pack inclus. Pas d’écriture `ad_free` / `host_pack`. Overlay RC-RESTORE inchangé.

| Élément | Valeur |
| ------- | ------ |
| Client | `js/core/entitlements.js` · `purchases.js` · `supabaseAuth.js` |
| Tests | `tests/featureRcSkuAdf.test.js` · `featureProfile02a` · `featureHost02a` · `featureRcRestore` |
| Hors scope | webhook · product IDs · overlay store · cap 14 |

**Statut** : client **✅** · QA **✅** 7 sept 2026 (Pages/SQL Anrobensy B–F). Achat Play natif **non exécuté**.

---

## 30. ID-OLD — Cosmetics Signature au refund → re-grant

Pas de colonnes nouvelles. Les triggers `profiles_signature_cosmetics` et `profiles_signature_avatar` lisaient `coalesce(old.profile_pack, new.profile_pack)` : au grant (`false` → `true`) PostgreSQL évalue `coalesce(false, true) = false` et **wipe** couleur / emoji extra / photo. Correctif : sur UPDATE, `old.profile_pack OR new.profile_pack`. Branche INSERT 03c inchangée. Webhook inchangé. Coller **uniquement** le patch (pas tout 05).

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-profile-id-old.sql`](../supabase/feature-profile-id-old.sql) — coller après 03c + 05 |
| Preuve | `03c-persist-v4` · `id-old-v1` |
| Runbook | [`tests/feature-profile-id-old-runbook.sql`](../supabase/tests/feature-profile-id-old-runbook.sql) — `IDOLD_FUNCTIONS_OK` |
| Tests | `tests/featureProfileIdOld.test.js` |
| Hors scope | ID-OVERLAY · AV-STORAGE · AV-REPLACE · webhook · gating lecture |

**QA Anrobensy** (après collage) : compte Signature avec `name_color`, emoji extra, `avatar_path`. `update … set profile_pack = false` → cosmetics **encore là**. Puis `profile_pack = true` → **mêmes valeurs**. F5 → Profil : couleur + photo + emoji. Remettre `profile_pack = true` (et les autres flags) à la fin.

**Statut** : SQL **✅** collé · QA **✅** 7 sept 2026 (Pages/SQL Anrobensy A–E : lime · 🐉 · photo conservés). Refund Play **non exécuté**.

---

## 31. ID-OVERLAY — Pending cosmetics pendant overlay Signature

Pas de SQL. Overlay RC débloque l’UI avant `profile_pack` serveur ; un choix couleur/photo est gardé en **pending session** (même cycle de vie que l’overlay, namespacé `userId`, vidé au logout). `refreshAdFreeFromServer` n’écrase plus par un `null` serveur. Replay `upsertProfile` **seulement** si la colonne SQL `profile_pack` est true. Pending retiré après succès. Triggers inchangés. Pas d’écriture `profile_pack`. Badge lobby partagé reste le snapshot SQL.

| Élément | Valeur |
| ------- | ------ |
| Client | `js/core/signatureCosmeticsPending.js` · `entitlements.js` · `auth.js` · `state.js` · `settings.js` |
| Tests | `tests/featureIdOverlay.test.js` |
| Hors scope | webhook · AV-STORAGE · AV-REPLACE · snapshot `lobby_members.signature` |

**QA Anrobensy** : overlay `__revealPremium` + `profile_pack=false` → lime → refresh conserve → grant SQL `name_color` encore null → refresh replay → `lime` en base → F5 OK.

**Statut** : client **✅** · QA **✅** 7 sept 2026 (Pages/SQL couleur). Avatar pending **non rejoué** sur Pages. Achat Play natif **non exécuté**.

---

## 32. AV-STORAGE — écriture Storage avatars gated Signature / Maître

Pas de colonnes nouvelles. Les policies `avatars owner insert/update/delete` n’exigeaient que `{auth.uid()}/avatar.jpg`. Un inscrit **sans** pack pouvait uploader un JPEG public. Correctif : helper `can_write_own_avatar()` (`profile_pack OR host_pack`, `auth.uid()` uniquement) + mêmes noms de policies (drop/create, pas de policy permissive oubliée). SELECT public **inchangé**. Bucket public **inchangé**. Triggers `profiles` / ID-OLD inchangés. Client inchangé. AV-REPLACE hors scope.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-profile-av-storage.sql`](../supabase/feature-profile-av-storage.sql) — coller après 05 + HOST-01 |
| Preuve | `av-storage-v1` dans `can_write_own_avatar` |
| Runbook | [`tests/feature-profile-av-storage-runbook.sql`](../supabase/tests/feature-profile-av-storage-runbook.sql) — `AVSTORAGE_POLICIES_OK` |
| Tests | `tests/featureAvStorage.test.js` |
| Hors scope | AV-REPLACE · orphelins delete-account · ID-OVERLAY · webhook |

**QA** (après collage) : compte `profile_pack=false` `host_pack=false` → console `storage.from("avatars").upload(...)` → **403**. Signature ou Maître seul → upload OK. GET public inchangé. **Ne pas** réexécuter `feature-profile-05-avatar.sql` ensuite (remettrait owner-only).

**Statut** : SQL **✅** collé · QA **✅** 7 sept 2026 (Pages/SQL Anrobensy A/B/C/F). D (autre uid) et GET public **non rejoués**. AV-REPLACE hors scope.

---

## 33. FEATURE-HOST-04 — Cap sièges concurrent-safe (H-RACE)

Le join par code lisait `get_lobby_member_count` puis `INSERT lobby_members`. Deux clients au dernier siège pouvaient tous les deux passer. `accept_lobby_invite` avait déjà un count SQL + advisory lock, mais l’INSERT client restait ouvert.

Correctif : trigger `BEFORE INSERT` `lobby_members_enforce_seat_cap` — `SELECT … FROM lobbies WHERE id = NEW.lobby_id FOR UPDATE`, puis `lobby_max_players` + `get_lobby_member_count`, puis `raise exception 'lobby_full'`. Pas de `DELETE` membres (H-TRANSFER : cap 14→8, les présents restent). RLS `members_insert_self` inchangée. `send_lobby_invite` / HOST-02 / HOST-03 non réécrits.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-host-04-race-cap.sql`](../supabase/feature-host-04-race-cap.sql) — coller après HOST-02 |
| Preuve | `h-race-v1` dans `lobby_members_enforce_seat_cap` |
| Runbook | [`tests/feature-host-04-race-cap-runbook.sql`](../supabase/tests/feature-host-04-race-cap-runbook.sql) — `HRACE_SEAT_CAP_OK` |
| Concurrence | [`tests/feature-host-04-race-cap-concurrent.sql`](../supabase/tests/feature-host-04-race-cap-concurrent.sql) — **2 sessions SQL**, pas `npm test` |
| Tests | `tests/featureHost04RaceCap.test.js` |
| Client | check count = UX ; `isLobbyFullServerError` → `LOBBY_FULL_MSG` |
| Hors scope | RevenueCat · avatars · ID-OVERLAY · ID-OLD · `send_lobby_invite` |

**QA** : coller le SQL · runbook catalogue · Pages 8/8 → 9ᵉ refusé · (optionnel) 7/8 deux appareils. Ne pas réexécuter HOST-02/03.

**Statut** : SQL **✅** collé 7 sept 2026 · runbook `HRACE_SEAT_CAP_OK` · QA Pages **✅** 7 sept 2026 Anrobensy (séquentiel). Concurrent 2 backends **non joué** sur Pages.

---

## 34. warehouse v1 — Stats d’usage (SQL Editor, 15 sept 2026)

Pas de fichier dans `supabase/`. Collé dans le SQL Editor du projet **production** (triggers + vues + cron). Staging **non** recollé (⏳). L’app joueur n’a **aucun** accès au schéma `warehouse` (`anon` / `authenticated` révoqués).

**Lecture hebdo** : [WAREHOUSE_WEEKLY.md](./WAREHOUSE_WEEKLY.md) (rituel lundi, requêtes à coller). Ci-dessous : trace de déploiement.

| Élément | Valeur |
| ------- | ------ |
| Objets | `warehouse.events` · `warehouse.lobby_live` · vues `v_daily` / `v_games` / `v_lobby_quality` / `v_live_now` |
| Triggers | `public.lobbies` (create) · `lobby_members` (peak) · `lobby_closures` (close) · `game_sessions.game_id` · `profiles` (signup + IAP) |
| Cron | `reveal-warehouse-purge` — job **4** — `15 4 * * *` UTC — events > 90 j sauf IAP |
| Hors scope | plateforme web/iOS/Android · Metabase · rollup > 90 j · recettes € (RevenueCat / stores) |
| Ne pas | `cron.schedule` une 2ᵉ fois · grant PostgREST · réutiliser le carnet Signature |

**QA 15 sept 2026** : salon `170d3da3-7886-4aca-961b-3038a8b88636` vu dans `lobby_live` (`peak_members` 2, `host_guest` false) puis cycle fermeture / vues / cron `active`.

**Comment lire (prod)** — [Dashboard Supabase](https://supabase.com/dashboard) → le projet **live** → **SQL Editor** → New query. **Un seul** `select` par Run (l’éditeur n’affiche que le dernier résultat). Rôle postgres. Les vues ne sont pas dans Table Editor sous `public`.

| Question | Requête |
| -------- | ------- |
| Soirées / jeux / inscrits / IAP par jour (Paris) | `select * from warehouse.v_daily limit 14;` |
| Quels jeux ont été lancés (7 j) | `select * from warehouse.v_games where day >= current_date - 7;` |
| Qualité des salons fermés (raison, taille, durée) | `select * from warehouse.v_lobby_quality limit 20;` |
| Combien de salons **en ce moment** | `select * from warehouse.v_live_now;` |
| Salons encore ouverts (détail) | `select * from warehouse.lobby_live;` |
| Derniers événements bruts | voir ci-dessous |

```sql
select event_type, game_id, props, occurred_at
from warehouse.events
order by id desc
limit 20;
```

Colonnes utiles : `v_daily.lobbies` / `closed` / `games` / `signups` (comptes) / `guest_profiles` (invités) / `iap_grants`. `v_lobby_quality.close_reason` = `host_closed` ou `inactive_expired`. `avg_min` = durée moyenne en minutes. Les stats **commencent le 15 sept 2026** (rien avant les triggers). Recettes € : RevenueCat / stores, pas ici.

Signet : dans le SQL Editor, enregistrer chaque requête (étoile / snippet) pour ne pas les retaper.

---

## 35. Sondages — allowlist 12 jeux

`reveal_poll_allowed_game_ids` en prod vient de FEATURE-VIBECHECK-01 : Wrong Answer Only, sans Draw it !. Le catalogue client a maintenant les deux.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-poll-allowlist-12-games.sql`](../supabase/feature-poll-allowlist-12-games.sql) — **à coller** |
| Fonction | `reveal_poll_allowed_game_ids` |
| Contrat | même liste que `GAMES_AVAILABLE` dans `data/games.js` · test `tests/lobbyPollsAllowlist.test.js` lit `lobby-polls.sql` |
| Ne pas | réexécuter `feature-vibecheck-01-remove-allowlist.sql` ensuite (retire Draw it !) |

**Statut** : SQL repo ✅ · **pas encore collé** en base.

---

## 36. Le Traître — joueur qui quitte le salon en pleine partie

Un joueur parti du salon restait dans les survivants : fake parti → partie impossible à finir (`TRAITRE_ROLE_MISSING`), autre joueur parti → jamais votant, impossible à éliminer.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-traitre-departed-players.sql`](../supabase/fix-traitre-departed-players.sql) (remplace toute la fonction, inclut `feature-traitre-force-deal.sql`) |
| Fonction | `advance_traitre_play` (action `resolve_vote`) |
| Contrat | miroir `js/core/traitreAdvance.js` · test `tests/traitreDepartedPlayers.test.js` |
| Prod | appliquée le 2026-11-20 (migration `fix_traitre_departed_players`) · contrôle : md5 du corps = fichier, `authenticated` seul en exécution |

**Statut** : SQL repo ✅ · prod ✅.

---

## 37. Draw It — fin de manche au chrono sans l'hôte

À 00:00, seul l'hôte (ou son remplaçant) pouvait terminer la manche : écran de l'hôte éteint → tout le monde bloqué jusqu'à 2 min.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-drawit-reveal-any-player.sql`](../supabase/fix-drawit-reveal-any-player.sql) (remplace toute la fonction) |
| Fonction | `reveal_drawit_round` : tout joueur de la partie (membre + `drawerOrder`) après l'heure de fin ; fin anticipée « tout le monde a trouvé » réservée à l'hôte |
| Contrat | `canPlayerCommitDrawItReveal` (`js/core/drawItRound.js`) · test `tests/drawItPlayerReveal.test.js` |
| Prod | appliquée le 2026-11-20 (migration `fix_drawit_reveal_any_player`) · contrôle : md5 du corps = fichier, `authenticated` seul en exécution |

**Statut** : SQL repo ✅ · prod ✅ (à appliquer avant de publier l'appli : fait).

---

## 38. Draw It — joueur qui quitte le salon en pleine partie

Liste des joueurs figée au lancement : devineur parti → « tout le monde a trouvé » jamais atteint (60 s par manche) ; dessinateur parti → 60 s de toile vide.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-drawit-departed-players.sql`](../supabase/fix-drawit-departed-players.sql) |
| Fonctions | nouvelle `drawit_all_present_guessers_found(uuid, jsonb)` (aucun rôle client n'a le droit d'exécution) · `reveal_drawit_round` réécrite (inclut le n°37) · `submit_drawit_guess` : une ligne remplacée en place |
| Contrat | `expectedDrawItGuessers` / `isDrawItDrawerGone` (`js/core/drawItRound.js`) · test `tests/drawItDepartedPlayers.test.js` |
| Prod | appliquée le 2026-11-20 (migration `fix_drawit_departed_players`), après essai annulé · contrôle : md5 des corps = fichier, `submit_drawit_guess` +20 caractères (la seule ligne visée), droits inchangés |

**Statut** : SQL repo ✅ · prod ✅.

---

## 39. Points de soirée de fin de partie — Trivia et Consensus

Points ajoutés sur le téléphone de celui qui termine : perdus pour les autres si c'est l'hôte remplaçant (`complete_game_session_as_actor` n'écrit aucun point), et Trivia pouvait compter deux fois.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-evening-scores-trivia-consensus.sql`](../supabase/fix-evening-scores-trivia-consensus.sql) |
| Fonctions | `finalize_trivia_scores(uuid)` (quiz + podium 15/10/5) · `finalize_consensus_scores(uuid)` · `evening_finalize_credit` (interne, aucun rôle client) ; une fois par partie (`state.eveningFinalized`) |
| Contrat | `js/core/eveningFinalize.js` · test `tests/eveningFinalizeTriviaConsensus.test.js` |
| Prod | appliquée le 2026-11-20 (migration `fix_evening_scores_trivia_consensus`), après essai annulé (exemple de calcul vérifié) · contrôle : md5 des corps = fichier, droits OK |

**Statut** : SQL repo ✅ · prod ✅ — à appliquer **avant** de publier l'appli : fait.

---

## 40. Guess the Lie — manches annoncées par l'hôte remplaçant (points de soirée)

Guess the Lie n'avait pas de score de partie : la règle « hôte absent » ne le couvrait pas, ses manches annoncées par un remplaçant ne comptaient pour personne d'autre que lui.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-guesslie-evening-scores.sql`](../supabase/fix-guesslie-evening-scores.sql) (modification ciblée en place, rejouable) |
| Fonction | `game_sessions_credit_absent_host_evening_scores` : `'guesslie'` ajouté à la liste des jeux (rien d'autre) |
| Contrat | appli : `state.guessLie.matchScores` mis à jour à chaque révélation · test `tests/eveningScoresOverwriteAndGuessLie.test.js` |
| Prod | appliquée le 2026-11-20 (migration `fix_guesslie_evening_scores`), après essai annulé · contrôle : +12 caractères (la seule liste visée), trigger toujours actif |

**Statut** : SQL repo ✅ · prod ✅ — ordre de mise en ligne indifférent.

---

## 41. Webhook RevenueCat — achats de test ignorés (Edge Function, pas de SQL)

Le webhook RevenueCat envoie tous les environnements ; la fonction traitait un achat de test (gratuit : TestFlight, testeurs Play, Test Store) comme un vrai achat → droits gratuits et définitifs en prod.

| Élément | Valeur |
| ------- | ------ |
| Fonction | Edge Function `revenuecat-webhook` ([`index.ts`](../supabase/functions/revenuecat-webhook/index.ts)) : ignore `environment: SANDBOX` |
| Secret optionnel | `REVENUECAT_SANDBOX_ALLOWED_USER_IDS` (uids séparés par des virgules) : comptes qui gardent les droits sur achat de test |
| Contrat | `isIgnoredSandboxEvent` ([`revenuecat-entitlement-patch.js`](../supabase/revenuecat-entitlement-patch.js)) · test `tests/revenuecatSandboxIgnored.test.js` |
| Prod | déployée le 2026-11-22 (version 21, `verify_jwt` false comme avant) · contrôle : contenu en ligne = fichier, réponse 405 sur GET |

**Statut** : repo ✅ · prod ✅. Droits déjà obtenus par achat de test : non nettoyés.

---

## 42. Webhook RevenueCat — droits relus chez RevenueCat, et suppression de compte (Edge Functions, pas de SQL)

Audit achats (tmp/audit-achats-premium.md) n°1 à n°5 : transfert d'achat entre comptes ignoré (transfert confirmé actif dans RevenueCat), événements dans le désordre, profil absent, réponses d'erreur trop bavardes, mise à niveau gardée après remboursement de sa base, client RevenueCat gardé après suppression du compte.

| Élément | Valeur |
| ------- | ------ |
| Fonctions | `revenuecat-webhook` v22 (`index.ts` + [`premium.js`](../supabase/functions/revenuecat-webhook/premium.js), `verify_jwt` false) · `delete-account` v10 (`verify_jwt` true, inchangé) |
| Secrets à créer | `REVENUECAT_SECRET_API_KEY` (clé API v2, lecture des achats ; + suppression de client si option) · `REVENUECAT_PROJECT_ID` = `proj5ef4ccd9` · optionnels : `REVENUECAT_SANDBOX_ALLOWED_USER_IDS`, `REVENUECAT_DELETE_ON_ACCOUNT_DELETE=true` |
| Sans les secrets | webhook en repli : ancien calcul + achats de test ignorés + 500 si profil absent + 401 muet ; suppression de compte inchangée |
| Contrat | `tests/revenuecatPremiumFromPurchases.test.js`, `tests/revenuecatSandboxIgnored.test.js` |
| Prod | déployées le 2026-11-22 · contrôle : webhook 405 (GET), 401 `{"ok":false}` sans secret et avec secret dans l'adresse ; delete-account 200 (OPTIONS), 401 sans jeton |

**Statut** : repo ✅ · prod ✅ · secrets RevenueCat : **à créer** (relecture inactive tant qu'ils manquent).

---

## 43. Droits offerts (Maître / Signature / Sans pub par e-mail)

| Élément | Valeur |
| ------- | ------ |
| Migration | [`feature-premium-manual-grants.sql`](../supabase/feature-premium-manual-grants.sql) : table `premium_manual_grants` (RLS, aucun accès appli), `grant_premium_by_email(email, 'host'\|'profile'\|'ad_free', raison)`, `revoke_premium_by_email(email)` (éditeur SQL seulement) |
| Webhook | `revenuecat-webhook` v25 : droits offerts ajoutés aux droits des achats, jamais retirés |
| Contrat | `tests/premiumManualGrants.test.js` |
| Prod | appliquée le 2026-11-22 (migration `feature_premium_manual_grants`) après essai annulé ; webhook redéployé ensuite · contrôle : table + RLS, appli sans accès, service_role en lecture ; webhook 405 (GET), 401 sans secret |

**Statut** : repo ✅ · prod ✅. Aucun droit offert pour l'instant.

---

## 44. Trivia — joueur qui quitte le salon en pleine question

Liste des joueurs attendus figée au début de la question (`questionPlayerUids`) : un joueur parti bloquait la révélation automatique, les invités restaient sur « Révélation en cours… ».

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-trivia-departed-players.sql`](../supabase/fix-trivia-departed-players.sql) : `trivia_all_expected_players_answered(uuid, jsonb)` réécrite (seuls les joueurs attendus encore dans `lobby_members` comptent) ; seul appelant : `submit_trivia_answer` |
| Appli | `js/core/triviaPresentPlayers.js` (miroir JS) · `js/games/trivia.js` : l'hôte ou le remplaçant lance `reveal_trivia_round` quand un joueur part après les réponses des autres |
| Contrat | `tests/auditFollowups.test.js` |
| Prod | appliquée le 2026-11-23 (migration `fix_trivia_departed_players`), après essai annulé · contrôle : la fonction ne compte que les membres du salon |

**Statut** : SQL repo ✅ · prod ✅.

---

## 45. Trivia — heure de réponse notée par le serveur (bonus vitesse)

Le bonus vitesse (+5) se jouait sur l'heure envoyée par chaque téléphone : une horloge en retard gagnait en répondant après les autres.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-trivia-server-answer-time.sql`](../supabase/fix-trivia-server-answer-time.sql) : `submit_trivia_answer`, une ligne remplacée en place (`'answeredAt', p_answered_at` → heure serveur `clock_timestamp()` en ms) ; paramètre gardé pour les anciennes versions de l'appli |
| Appli | rien à changer |
| Contrat | `tests/auditFollowups.test.js` (bloc n°2) |
| Prod | appliquée le 2026-11-23 (migration `fix_trivia_server_answer_time`), après essai annulé (base : md5 du corps `5e074dc43cc6afd471333e8c1a015a59`) · contrôle : heure serveur, +46 caractères (la seule ligne visée), droits inchangés |

**Statut** : SQL repo ✅ · prod ✅.

---

## 46. Amis — délai qui s'allonge après chaque refus

Refuser une demande d'ami ne bloquait la même personne que 60 s : elle pouvait redemander chaque minute.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-friends-decline-escalation.sql`](../supabase/fix-friends-decline-escalation.sql) : colonne `friend_request_cooldowns.decline_count` ; `decline_friend_request` (1er refus 1 jour, 2e 7 jours, 3e définitif) ; `send_friend_request` ne purge plus les délais expirés |
| Appli | rien à changer (délai déjà silencieux pour celui qui demande) |
| Contrat | `tests/auditFollowups.test.js` (bloc « Amis n°1 ») |
| Prod | appliquée le 2026-11-23 (migration `fix_friends_decline_escalation`), après essai annulé (base : md5 `decline_friend_request` `6ff57c3a2d9eb7d28cfde64a3477e3b6`, `send_friend_request` `1b03d1b486c1b4b0b21fdc45c3c9dc7e`) · contrôle : colonne `decline_count`, délai 1 j / 7 j / définitif, plus d'effacement des délais à la demande |

**Statut** : SQL repo ✅ · prod ✅.

---

## 47. Invitations — vérifier avant « Quitter et rejoindre »

« Quitter et rejoindre » quittait le salon actuel avant d'essayer l'invitation : invitation périmée = plus de salon, et l'hôte cédait le sien pour rien.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-lobby-invite-check-before-leave.sql`](../supabase/fix-lobby-invite-check-before-leave.sql) : nouvelle `check_lobby_invite(uuid)` (lecture seule ; `authenticated` seulement) |
| Appli | `js/core/lobbyInviteJoin.js` l'appelle avant `leaveLobby` ; si elle manque en prod (avant la migration), l'appli fait comme avant |
| Contrat | `tests/auditFollowups.test.js` (bloc « Invitations n°2 ») |
| Prod | appliquée le 2026-11-23 (migration `fix_lobby_invite_check_before_leave`), après la 48, après essai annulé · contrôle : `authenticated` seulement (pas `anon`) |

**Statut** : SQL repo ✅ · prod ✅.

---

## 48. Amis et invitations — invitations périmées et droits en trop

Invitations encore utilisables après la fin de l'amitié, le départ de l'invitant ou un retrait par l'hôte ; invitations vers des soirées fermées affichées ; droits d'écriture (dont `TRUNCATE`) donnés par défaut sur 3 tables.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-friends-invites-cleanup.sql`](../supabase/fix-friends-invites-cleanup.sql) : `unfriend` et `kick_lobby_member` réécrites (suppriment les invitations concernées) ; `accept_lobby_invite` : un bloc ajouté en place (invitant encore membre) ; `list_incoming_lobby_invites` réécrite (soirée active + invitant présent) ; `revoke insert, update, delete, truncate, references, trigger` sur `friend_requests`, `friendships`, `lobby_invites` pour `authenticated` (lecture gardée) |
| Ordre | **avant** ou avec la fiche 47 (`check_lobby_invite` reprend la règle « invitant encore membre ») |
| Appli | rien à changer |
| Contrat | `tests/auditFollowups.test.js` (bloc « Amis et invitations n°3 à 6 ») |
| Prod | appliquée le 2026-11-23 (migration `fix_friends_invites_cleanup`), après essai annulé (base : md5 accept `84c69e03dce9928362b9dd31c4b3692d`, kick `0e259dd21dfc9e605af6c385be0b4b3f`, unfriend `6da3782d3563879007ce23181ef47051`, list_incoming `da5a33ae0cac3f91f23ca63042efa7b3`) · contrôle : acceptation +292 caractères (le bloc visé), unfriend et retrait suppriment les invitations, liste filtrée, `authenticated` n'a plus que SELECT sur les 3 tables, droits d'exécution inchangés |

**Statut** : SQL repo ✅ · prod ✅.

---

## 49. Photo de profil — effacée avec le compte, au remboursement, et quand on la retire

Audit compte et profil (tmp/audit-compte-profil.md) n°1 et 2 : la photo restait publique après la suppression du compte (Supabase n'efface pas les fichiers d'un compte supprimé), après un remboursement de Signature (le joueur ne pouvait plus l'effacer : la règle exigeait Signature) et quand « Retirer la photo » échouait sans le dire.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-avatar-delete-without-pack.sql`](../supabase/fix-avatar-delete-without-pack.sql) : règle `avatars owner delete` sans `can_write_own_avatar()` (son propre fichier seulement) ; envoyer et remplacer exigent toujours Signature ou Maître · **ne pas** réexécuter `feature-profile-av-storage.sql` ensuite |
| Fonctions | `delete-account` : efface `avatars/<id>/avatar.jpg` après la suppression du compte (échec noté dans le journal, la suppression reste faite ; réponse `avatar: deleted / failed`) · `revenuecat-webhook` : sans Signature ni Maître, retire la photo du profil et efface le fichier (sans bloquer l'événement) |
| Appli | `js/core/auth.js` `removeProfileAvatar` : fichier d'abord, erreur regardée (message « Impossible de retirer la photo… »), profil vidé ensuite |
| Contrôle | [`tests/feature-profile-av-storage-runbook.sql`](../supabase/tests/feature-profile-av-storage-runbook.sql) mis à jour (`AVSTORAGE_POLICIES_OK` : effacement sans Signature exigé) |
| Contrat | `tests/featureAvReplace.test.js`, `tests/auditFollowups.test.js` (bloc « Compte n°1 et 2 ») |
| Changement voulu | après un remboursement puis un nouvel achat, la photo ne revient plus : il faut la remettre (couleur et cadre reviennent toujours, ID-OLD) |
| Prod | migration appliquée le 2026-11-24 (`fix_avatar_delete_without_pack`), après essai annulé · contrôle : runbook `AVSTORAGE_POLICIES_OK` · fonctions déployées le 2026-11-24 : `delete-account` v14 (`verify_jwt` true), `revenuecat-webhook` v27 (`verify_jwt` false) · contrôle : webhook 405 (GET), 401 `{"ok":false}` sans secret ; delete-account 200 (OPTIONS), 401 sans jeton |
| Nettoyage | 1 fichier sans photo au profil (compte qui a encore Signature et Maître, id des tests du dépôt) effacé le 2026-11-24 avec accord (`supabase storage rm`) · contrôle : son adresse publique ne répond plus (400), il reste 1 fichier dans `avatars`, affiché au profil de son compte |

**Statut** : repo ✅ · prod ✅.

---

## 50. Profils et photos lisibles seulement par qui en a besoin

Audit compte et profil (tmp/audit-compte-profil.md) n°7 : avec la clé publique de l'appli, même sans session, on lisait tous les profils (pseudo, emoji, achats, chemin de la photo) et on listait toutes les photos du bucket.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-profiles-avatars-read-scope.sql`](../supabase/fix-profiles-avatars-read-scope.sql) : `can_see_profile(uuid)` (SECURITY DEFINER, `authenticated` seulement) ; `profiles_select` réservée aux comptes connectés (invités compris) : son profil, ceux des joueurs du même salon, ceux des hôtes d'un salon existant ; plus aucun droit `anon` sur `profiles`, plus d'effacement ni de `TRUNCATE` pour `authenticated` ; `avatars public read` remplacée par `avatars owner read` (son propre fichier) |
| Pourquoi l'hôte | l'appli lit `host_pack` de l'hôte **avant** de rejoindre (« salon plein » à 8 ou 14) : sans ça, les versions déjà publiées refuseraient le 9ᵉ joueur d'un salon Maître |
| Ce qui ne change pas | bucket public : les adresses des photos s'affichent toujours ; fonctions serveur (amis, carnet, salons) |
| Appli | rien à changer |
| Contrôle | [`tests/feature-profile-av-storage-runbook.sql`](../supabase/tests/feature-profile-av-storage-runbook.sql) mis à jour (`AVSTORAGE_SELECT_STILL_PUBLIC`) |
| Contrat | `tests/auditFollowups.test.js` (bloc « Compte n°7 ») |
| Essai annulé (2026-11-24) | joueur connecté : 1 profil visible sur 165 (le sien), peut modifier le sien, 1 photo listable (la sienne) ; visiteur : 0 photo listable ; faux salon : un membre voit lui + l'hôte, pas un joueur hors salon ; hors salon : voit l'hôte (et son `host_pack`), pas les autres membres |
| Prod | appliquée le 2026-11-24 (migration `fix_profiles_avatars_read_scope`), après essai annulé · contrôle : runbook `AVSTORAGE_POLICIES_OK` ; droits `profiles` : `authenticated` INSERT/SELECT/UPDATE, rien pour `anon` ; `can_see_profile` exécutable par `authenticated` seulement ; avec la clé publique sans session : profils refusés (42501), liste des photos vide, photo par son adresse publique 200 |

**Statut** : repo ✅ · prod ✅.

---

## 51. Comptes invités supprimés après 30 jours sans activité

Audit compte et profil (tmp/audit-compte-profil.md) n°8 : la politique disait que les données du mode invité expirent toutes seules, mais aucun compte invité n'était supprimé (472 au 2026-11-24, dont 427 sans activité depuis plus de 30 jours, le plus ancien du 19 mai).

| Élément | Valeur |
| ------- | ------ |
| Migration | [`purge-stale-anonymous-users.sql`](../supabase/purge-stale-anonymous-users.sql) : `purge_stale_anonymous_users(p_limit int default 500)` (SECURITY DEFINER, appelable par personne d'autre que le serveur) ; supprime les comptes `is_anonymous` sans activité depuis 30 jours (connexion, mise à jour, session ou jeton renouvelés), jamais un invité encore membre d'un salon ; le reste part en cascade · tâche planifiée `reveal-purge-stale-anonymous-users` chaque nuit à 04:45 UTC |
| Pourquoi pas la date de connexion seule | un invité qui garde l'appli renouvelle sa session sans se reconnecter : 3 invités actifs auraient été supprimés |
| Appli | texte de la politique (Conservation + Suppression de compte, date 24 novembre 2026) et d'Aide & légal : « supprimé après 30 jours sans utilisation » |
| Site public | à mettre à jour aussi : https://havefuncorp.fr/reveal/privacy (pas dans ce dépôt) |
| Contrat | `tests/auditFollowups.test.js` (bloc « Compte n°8 ») |
| Essai annulé (2026-11-24) | 1er lot (limite 200) : 200 ; 2e lot : 227 ; 3e lot : 0 · invités 472 → 45, inscrits 88 → 88, profils 165 → 131, aucun profil sans compte |
| Prod | appliquée le 2026-11-24 (migration `purge_stale_anonymous_users`), après essai annulé · contrôle : 1 tâche `reveal-purge-stale-anonymous-users` active (`45 4 * * *`), fonction exécutable par `postgres` et `service_role` seulement · 1er passage : nuit du 2026-11-25, environ 427 comptes invités (472 avant) · à vérifier : `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'reveal-purge-stale-anonymous-users') order by start_time desc limit 3;` |

**Statut** : repo ✅ · prod ✅ (1er passage à vérifier le 2026-11-25).

---

## 52. Carnet — id d'un compte supprimé retiré du carnet des autres

Audit compte et profil (tmp/audit-compte-profil.md) n°11 : `signature_evenings.peer_user_ids` (tableau, sans clé étrangère) gardait l'id d'un compte supprimé dans le carnet des autres joueurs. Il n'était jamais affiché, mais il était conservé.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-carnet-peer-ids-on-account-delete.sql`](../supabase/fix-carnet-peer-ids-on-account-delete.sql) : `signature_evenings_forget_deleted_user()` (SECURITY DEFINER) + déclencheur `on_auth_user_deleted_forget_carnet_peer` (AFTER DELETE sur `auth.users`) ; rattrapage unique des ids de comptes déjà supprimés (aucun au 2026-11-24) |
| Couvre | suppression depuis l'appli (`delete-account`), nettoyage des invités (fiche 51), suppression dans le tableau de bord |
| Appli | rien à changer |
| Contrat | `tests/auditFollowups.test.js` (bloc « Compte n°11 ») |
| Essai annulé (2026-11-24) | compte cité dans 12 soirées d'autres joueurs : 12 → 0 ; ids 22 → 2 (ses 9 propres soirées parties en cascade) ; annulation vérifiée |
| Prod | appliquée le 2026-11-24 (migration `fix_carnet_peer_ids_on_account_delete`), avant le 1er nettoyage des invités · contrôle : déclencheur actif, fonction exécutable par `postgres` et `service_role` seulement, carnets intacts (25 soirées, 22 ids, aucun à rattraper) |

**Statut** : repo ✅ · prod ✅.

## 53. Chat du salon — 50 derniers messages, nom imposé, limite d'envoi

Audit chat et sondages (tmp/audit-chat-sondages.md) n°1 à 3 :
- n°1 : l'appli charge les 100 **premiers** messages du salon ; au 101e message le chat se figeait pour tout le monde ;
- n°2 : le nom affiché était envoyé par l'appli de l'envoyeur, donc on pouvait écrire sous le nom d'un autre ;
- n°3 : aucune limite d'envoi, alors que chaque message fait tout recharger chez chaque joueur.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-chat-cap-name-rate-limit.sql`](../supabase/fix-chat-cap-name-rate-limit.sql) : `lobby_messages_before_insert()` + déclencheur `lobby_messages_guard` (BEFORE INSERT : nom pris dans `lobby_members`, refus `chat_rate_limited` au-delà de 5 messages en 10 s par joueur et par salon) ; `lobby_messages_keep_latest()` + déclencheur `lobby_messages_keep_latest` (AFTER INSERT : garde les 50 derniers messages du salon) ; les deux SECURITY DEFINER, exécution retirée à `anon` / `authenticated` ; rattrapage unique des salons à plus de 50 messages (aucun au 2026-11-24) |
| Versions publiées | corrigées sans mise à jour : avec 50 messages au plus, leur chargement des « 100 premiers » renvoie toujours les derniers |
| Appli | `js/core/chatPanel.js` : refus « trop de messages » traduit (« Doucement ! … »), le texte reste dans le champ. Les versions publiées ne l'ont pas : le message ne part pas, sans explication (seulement en cas d'abus) |
| Appli (suite, même jour) | `js/core/supabaseLobby.js` + `js/core/lobbyMessagesMerge.js` : charge les 50 derniers messages (comme la base) ; un message reçu par Realtime est ajouté directement au lieu de recharger tout le salon chez chaque joueur ; l’envoyeur ajoute le message enregistré (sans rechargement) ; un seul rechargement des messages à chaque (re)connexion du canal, pour ceux manqués pendant une coupure |
| Contrat | `tests/auditFollowups.test.js` (bloc « Chat n°1 à 3 ») | + bloc « Chat — 50 derniers messages et pas de rechargement complet »
| Essai annulé (2026-11-24) | salon d'essai à 2 joueurs : message envoyé sous « Faux nom » enregistré sous le pseudo du salon ; 6e message en 10 s refusé (`chat_rate_limited`), l'autre joueur écrit toujours ; 66 messages envoyés → 50 gardés (les 6 récents + les 44 plus récents des anciens) ; fonctions non exécutables par `anon` / `authenticated` ; annulation vérifiée (aucun déclencheur, aucune fonction, aucun salon d'essai) |
| Prod | appliquée le 2026-11-24 (migration `fix_chat_cap_name_rate_limit`) · contrôle : déclencheurs `lobby_messages_guard` (avant) et `lobby_messages_keep_latest` (après) actifs, fonctions SECURITY DEFINER non exécutables par `anon` / `authenticated`, 0 message à rattraper |

**Statut** : repo ✅ · prod ✅.

## 54. Contenus perso — plafonds de nombre, identifiants et propriétaire

Audit contenus perso (tmp/audit-contenus-perso.md) n°2 : le serveur bornait la taille d'une prise, d'un dilemme, d'un mot, d'un thème ou d'une tier list, pas leur nombre. Un joueur pouvait en ajouter des centaines ; la partie grossissait et était renvoyée en entier à chaque joueur à chaque changement.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-custom-entries-caps.sql`](../supabase/fix-custom-entries-caps.sql) : `upsert_player_custom_entry` (Hot Take, Dilemma, Draw It, thèmes Tier Night) et `upsert_player_custom_live_tier_list` (Rank Live) reprises telles qu'en prod le 2026-11-25, avec en plus : 10 entrées par joueur et par jeu (3 tier lists Rank Live), 50 par salon et par jeu ; seul un nouvel ajout est compté ; refus avec message lisible et `hint` `CUSTOM_LIMIT_PLAYER` / `CUSTOM_LIMIT_LOBBY` ; plafond vérifié avant l'écriture du mot Draw It |
| Choix | de l'utilisatrice le 2026-11-25 : 10 / 3 / 50, pas de limite de rythme |
| Versions publiées | protégées côté invités sans mise à jour. Elles affichent le message du serveur pour Draw It, les thèmes et Rank Live ; pour Hot Take et Dilemma elles n'affichent rien (défaut corrigé par le n°1 dans la nouvelle version) |
| Appli | `js/core/customEntryLimits.js` (mêmes chiffres) : vérification avant envoi dans les 5 fonctions d'ajout ; seule barrière pour l'hôte de Hot Take / Dilemma, qui écrit la partie directement (nouvelle version seulement) |
| Contrat | `tests/customEntryLimits.test.js` (chiffres appli = migration), `tests/customEntryRpcRollback.test.js` |
| Essai annulé (2026-11-25) | un seul bloc annulé par une erreur finale ; salon à 2 joueurs, parties de départ avec leur objet de jeu (`{"hotTake":{}}`…) : Hot Take 10 OK, 11e refusée (`CUSTOM_LIMIT_PLAYER`, message lisible), renvoi d'une prise existante accepté (total 10, texte mis à jour), l'autre joueur ajoute encore ; salon à 50 → 51e refusée (`CUSTOM_LIMIT_LOBBY`), à 49 → 50e acceptée ; Dilemma, Draw It et thèmes : 11e refusée ; Draw It : 10 mots dans la table privée et dans la partie (le 11e n'est pas écrit) ; Rank Live : 3 OK, renvoi identique accepté, 4e refusée, l'autre joueur ajoute encore ; annulation vérifiée (fonctions d'origine en place, aucun compte, salon ni mot d'essai) · à savoir : sur une partie sans objet de jeu (`{}`), la fonction n'écrit rien (déjà le cas avant : `jsonb_set` ne crée pas le parent), ce qui n'arrive pas en vrai |
| n°3 et n°4 (même migration, ajoutés le 2026-11-25) | `upsert_player_custom_entry` refuse un identifiant déjà pris par un autre joueur (`hint` `CUSTOM_ID_TAKEN`) au lieu d'ajouter un doublon ; `delete_player_custom_entry` (reprise aussi) retire les entrées du joueur sans être bloquée par celle d'un autre au même identifiant ; Hot Take et Dilemma enregistrent `authorUid` ; propriétaire = même compte, ou (pas de compte et même pseudo) pour les entrées d'anciennes versions, pour les 4 types. Les votes restent reconnus par le pseudo. Appli : `normalizeHotTakeEntry` / `normalizeDilemmaEntry` (et leurs copies dans les sessions) gardent `authorUid` ; `isAuthorOwnedEntryMine` (`js/core/customEntryLimits.js`) pour « mes prises », la suppression et le plafond. Une ancienne version d'hôte qui réenregistre la partie retire `authorUid` : on retombe alors sur le pseudo, comme avant |
| Essai annulé n°3-4 (2026-11-25) | 3 comptes : `authorUid` enregistré ; l'hôte reprend l'identifiant de l'invité → refus `CUSTOM_ID_TAKEN`, prise d'origine intacte ; l'hôte ne peut pas supprimer la prise de l'invité ; ancien doublon : l'invité supprime la sienne, celle de l'hôte reste ; invité parti, un autre compte arrive avec le même pseudo → ne peut pas supprimer la prise de l'ancien, et elle ne compte pas dans son plafond (10 ajoutées, 11e refusée) ; ancienne entrée sans compte supprimée par repli sur le pseudo ; Draw It : identifiant pris refusé, mot d'origine intact, suppression OK ; annulation vérifiée |
| Prod | appliquée le 2026-11-25 (migration `fix_custom_entries_caps`, version 20261125192307) · contrôle : 3 fonctions SECURITY DEFINER exécutables par `authenticated` et `service_role` seulement (pas `anon`) ; `upsert_player_custom_entry` avec plafonds et `CUSTOM_ID_TAKEN`, `delete_player_custom_entry` non bloquée par un doublon, `upsert_player_custom_live_tier_list` à 3 par joueur ; 0 partie en cours au moment de l'application |

**Statut** : repo ✅ · essai ✅ · prod ✅.

---

## 55. Fonctions internes fermées — reprise de place, ancienne création de membre, outils internes

Audit sécurité Supabase d'ensemble (tmp/audit-securite-supabase.md) n°1 et n°2 : `remap_lobby_user_id` (remplace un joueur par un autre dans un salon : rôle secret, messages, état de partie) ne vérifiait rien et était exécutable par `anon` et `authenticated` ; `create_lobby_member` (remplacée par `create_lobby_atomically`, ajoute l'appelant comme hôte) n'avait jamais été fermée (fiche E4-03b restée « à vérifier »).

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-security-internal-functions.sql`](../supabase/fix-security-internal-functions.sql) : retrait des droits `public`, `anon`, `authenticated` sur les deux fonctions ; `service_role` garde l'accès. Reprend aussi [`lobby-membership-e4-03b-revoke-create-lobby-member.sql`](../supabase/lobby-membership-e4-03b-revoke-create-lobby-member.sql) |
| Appli | aucun changement : `remap_lobby_user_id` n'est appelée que par `reclaim_guest_membership` (droits du propriétaire `postgres`) ; `create_lobby_member` n'est plus appelée depuis le 2026-07-28 (commit 6a00cc9) |
| Versions publiées | une version installée avant le 2026-07-28 et jamais mise à jour ne pourrait plus créer de salon (le minimum de version est à 1). Journaux du 2026-11-22 au 25 : aucun appel à `create_lobby_member` ni à `remap_lobby_user_id` |
| n°6 et n°7 (même migration, ajoutés le 2026-11-25) | outils internes fermés à `public`, `anon`, `authenticated` (`service_role` garde l'accès) : `is_auth_user_anonymous`, `touch_lobby_activity`, `trivia_all_expected_players_answered`, `trivia_question_player_uids`, `truth_meter_all_expected_voters_voted`, `truth_meter_apply_reveal_scoring`, `truth_meter_expected_voter_uids`, `truth_meter_resolve_author_uid`, `cleanup_stale_guest_members`. Appelants vérifiés : tous SECURITY DEFINER appartenant à `postgres` (ou la tâche planifiée), aucune règle d'accès ne les utilise, l'appli ne les appelle pas. `search_path` fixé sur `cleanup_stale_guest_members` et `update_member_presence` (qui reste ouverte aux joueurs) |
| Contrat | `tests/fixSecurityInternalFunctions.test.js` |
| Essai annulé (2026-11-25) | un seul bloc annulé par une erreur finale ; 3 comptes (hôte, ancien invité, nouvel invité), salon, partie et rôle Spot the fake de l'ancien invité ; après les retraits : droits `anon` / `authenticated` à faux, `service_role` à vrai ; appel direct de `remap_lobby_user_id` refusé en invité connecté et sans session ; `create_lobby_member` refusée (aucun intrus ajouté) ; reprise de place normale (`reclaim_guest_membership`) OK : place, état de partie et rôle secret passés au nouvel invité, plus aucune trace de l'ancien ; annulation vérifiée (droits d'origine en place, aucun compte ni salon d'essai) |
| Essai annulé n°6-7 (2026-11-25) | migration complète (n°1, 2, 6, 7) dans un bloc annulé : les 11 fonctions refusées à `anon` / `authenticated`, permises à `service_role` ; appels directs refusés en invité connecté ; parcours normal OK : création de salon, arrivée d'un invité et présence (salon rafraîchi par les déclencheurs), message du chat, `peek_lobby_by_membership` (`reclaimable` vrai), ménage des invités lancé comme la tâche planifiée ; annulation vérifiée |
| Prod | appliquée le 2026-11-25 (migration `fix_security_internal_functions`, version 20261125195417) · contrôle : les 11 fonctions refusées à `anon` et `authenticated`, permises à `service_role`, `search_path` fixé partout ; `update_member_presence` toujours ouverte aux joueurs ; 0 salon ouvert au moment de l'application |

**Statut** : repo ✅ · essai ✅ · prod ✅.

---

## 56. Membres du salon — un joueur ne change plus son salon, son rôle d'hôte ni son arrivée

Audit sécurité Supabase d'ensemble (tmp/audit-securite-supabase.md) n°4 : les règles `members_insert_self` / `members_update_self` laissaient un joueur écrire toutes les colonnes de sa ligne (en appelant la base directement) : se marquer hôte (les téléphones des autres le croyaient), passer dans un autre salon sans code ni plafond de places, pseudo / emoji / couleur sans limite de longueur.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-lobby-members-player-guard.sql`](../supabase/fix-lobby-members-player-guard.sql) : déclencheur `lobby_members_guard_player_write` (avant ajout et modification, SECURITY INVOKER). Écriture directe d'un joueur (`current_user` = `authenticated` / `anon`) : à l'arrivée `is_host` forcé à faux ; en modification `id`, `lobby_id`, `user_id`, `is_host`, `joined_at` gardent leur valeur. Toujours : pseudo coupé à 24, emoji et couleur à 16 |
| Appli | aucun changement : elle envoie déjà `is_host: false` à l'arrivée et ne modifie que `last_seen_at`, `ready`, `display_name`, `emoji`. Les fonctions serveur (création, transfert d'hôte, reprise de place) tournent avec les droits de `postgres` et gardent la main |
| Contrat | `tests/fixLobbyMembersPlayerGuard.test.js` |
| Essai annulé (2026-11-25) | 4 comptes, 2 salons créés par `create_lobby_atomically` (hôtes à `is_host` vrai) ; invité qui arrive en se déclarant hôte → enregistré non-hôte ; invité qui tente de changer salon, `is_host`, `joined_at`, pseudo de 100, emoji de 40, couleur de 50 → reste dans son salon, non-hôte, arrivée inchangée, `ready` accepté, longueurs 24 / 16 / 16, l'autre salon toujours à 1 membre ; usage normal (pseudo, emoji, `ready`, `last_seen_at`, `update_member_presence`) OK ; transfert d'hôte OK (`is_host` et `lobbies.host_id`) ; reprise de place par un autre invité OK ; annulation vérifiée |
| Prod | appliquée le 2026-11-25 (migration `fix_lobby_members_player_guard`, version 20261125195427) · contrôle : déclencheur `lobby_members_guard_player_write` en place sur `lobby_members` ; 0 salon ouvert au moment de l'application |

**Statut** : repo ✅ · essai ✅ · prod ✅.

## 57. Membres du salon — emoji et couleur limités aux valeurs connues

Audit carnet et cosmétiques (tmp/audit-carnet-cosmetiques.md) n°1 : l'emoji et la couleur d'un membre (`lobby_members`) étaient écrits par le joueur, coupés à 16 caractères mais sans contrôle du contenu, puis insérés tels quels dans la page : une appli modifiée pouvait afficher du HTML court à tout le salon, et un joueur sans Signature pouvait prendre un emoji Signature. L'emoji d'un profil Signature acceptait n'importe quel texte (32 octets).

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-member-cosmetics.sql`](../supabase/fix-member-cosmetics.sql) : `lobby_members_stamp_signature` (déjà SECURITY DEFINER, lit le pack) n'accepte qu'un emoji gratuit, ou Signature si le compte a le pack, sinon 👤 ; couleur `#rgb` / `#rrggbb` / `#rrggbbaa`, sinon la couleur d'avant (modification) ou `#60A5FA` (arrivée). `profiles_signature_cosmetics` : avec le pack, emoji gratuit ou Signature seulement, sinon 👤. Marqueur `member-cosmetics-v1` |
| Appli | `js/core/memberCosmetics.js` : `mapMember` (`supabaseLobby.js`) ne garde qu'un emoji connu et une couleur #hex ; emoji et couleur passés par `escapeHtml` à l'affichage (salon, écran des jeux, Clutch, Consensus, Dilemma, Speed Vote, Tier Night Live, Le Traître, Truth Meter, Wrong Answer) |
| Contrat | `tests/fixMemberCosmetics.test.js` (listes SQL alignées sur `data/profileEmojis.js` et `data/signatureIdentity.js`) |
| Essai annulé (2026-11-25) | 1 compte Signature, 1 compte gratuit, 1 salon créé pour l'essai. Membre Signature 👑 / `#A78BFA` → gardé ; membre gratuit 👑 / `red;"><b>` → 👤 / `#60A5FA` ; 🦊 / `#123456` → gardé ; `<a href=//x.yz>` / `url(//x)` → 👤 / `#123456` (couleur d'avant) ; 🕵️ → gardé ; battement de présence du membre Signature → 👑 et `signature` inchangés. Profil gratuit 👑 → 👤, 🦊 → gardé ; profil Signature `<b>x</b>` → 👤, 🐉 → gardé. Annulation vérifiée (empreintes des 2 fonctions inchangées, aucun salon d'essai restant) |
| Effet à connaître | un compte qui perd le pack (remboursement) repasse à 👤 dans le salon s'il avait un emoji Signature ; pendant l'attente du webhook après un achat, un emoji Signature choisi apparaît en 👤 dans le salon jusqu'au prochain changement d'emoji (le profil se comportait déjà ainsi) |
| Prod | pas appliquée |

**Statut** : repo ✅ · essai ✅ · prod ⏳.

## 58. Carnet — jetons d'archive nettoyés, plus de jeton pour l'hôte qui ferme

Audit carnet et cosmétiques (tmp/audit-carnet-cosmetiques.md) n°2 : les jetons d'archive carnet (`signature_carnet_kick_allow`, valables 30 min) n'étaient effacés que si la personne archivait ensuite (46 jetons expirés le 2026-11-25, le plus ancien du 2026-09-07), et l'hôte Signature en recevait un inutile à chaque fermeture.

| Élément | Valeur |
| ------- | ------ |
| Migration | [`fix-carnet-kick-allow-cleanup.sql`](../supabase/fix-carnet-kick-allow-cleanup.sql) : `dissolve_lobby_atomically` (reprise de 04c) efface les jetons de plus de 30 min avant d'en créer, et n'en crée plus pour l'hôte ; nettoyage unique des jetons déjà expirés. `archive_signature_evening` et `kick_lobby_member` inchangés |
| Appli | aucun changement |
| Contrat | `tests/fixCarnetKickAllowCleanup.test.js` |
| Essai annulé (2026-11-25) | 2 comptes Signature (hôte, membre) et 1 compte gratuit dans un salon créé pour l'essai ; fermeture par le membre → `NOT_ALLOWED` ; par l'hôte → `DISSOLVED`, jeton pour le membre Signature seulement (hôte 0, gratuit 0), jetons expirés 46 → 0, salon et membres supprimés, fermeture notée ; 2e appel → `ALREADY_GONE`. Annulation vérifiée (empreinte inchangée, 46 jetons, aucun salon d'essai) |
| Prod | pas appliquée |

**Statut** : repo ✅ · essai ✅ · prod ⏳.
