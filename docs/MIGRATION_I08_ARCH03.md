# Migration I-08 + ARCH-03 — game_sessions sécurisé

## Objectif

- Plus d’UPDATE libre `game_sessions` pour les invités.
- Contributions joueur via RPC atomiques (`jsonb_set`).
- Acting host via RPC host-play + complete dédiée (pas d’UPDATE générique).
- UPDATE direct réservé au **host réel** (`auth.uid() = host_id`).

## Fichiers SQL

| Fichier | Rôle |
|---------|------|
| `supabase/game-sessions-i08-arch03.sql` | Fonctions + RPC (étapes 1–3) ; policy finale **commentée** |
| `supabase/game-sessions-i08-policy-host-only.sql` | Étape 4 : resserrer UPDATE |

## Ordre d’application (obligatoire)

1. **SQL Editor** : exécuter `game-sessions-i08-arch03.sql` en entier (sans la policy finale, déjà commentée).
2. Vérifier `GRANT EXECUTE` (script le fait) ; rôles `authenticated` (anon Supabase inclus si auth anonyme).
3. **Déployer le client** (JS) qui route vers les RPC.
4. QA manuelle des flux RPC (ready, votes, customs, affirmation, acting host play/complete) **avec l’ancienne policy membre encore active** (filet de transition).
5. **SQL Editor** : exécuter `game-sessions-i08-policy-host-only.sql`.
6. Re-QA : confirmer qu’aucun flux nominal ne dépend d’un UPDATE membre ; tester qu’un UPDATE direct invité est refusé.
7. Mettre à jour l’audit uniquement après QA OK.

## Rollback

1. Restaurer la policy membre :

```sql
drop policy if exists "game_sessions_update" on public.game_sessions;
create policy "game_sessions_update" on public.game_sessions
for update
using (public.is_lobby_member(lobby_id))
with check (public.is_lobby_member(lobby_id));
```

2. Revert client (git) vers la version pré-RPC.
3. Les fonctions RPC peuvent rester (inoffensives) ou être droppées séparément.

**Le client ne contient aucun fallback automatique vers UPDATE membre.**

## RPC (contrats)

| RPC | Acteur | Effet |
|-----|--------|-------|
| `contribute_game_session_player(lobby, game, kind, value)` | joueur membre | `jsonb_set` sur `state.<gameMap>.<kindMap>[auth.uid()]` |
| `upsert_player_custom_entry` / `delete_player_custom_entry` | joueur | customs Hot Take / Dilemma |
| `submit_truth_meter_affirmation` | auteur du round | affirmation + phase display |
| `apply_acting_host_play` | host réel **ou** `is_acting_host` | merge play whitelist / set_screen borné |
| `complete_game_session_as_actor` | host réel **ou** acting | between-games + session menu ; `host_id` = vrai hôte ; pas de scores client |
| `is_acting_host(lobby)` | lecture | élection serveur 120 s |

## Droits

| Acteur | UPDATE direct | Chemin |
|--------|---------------|--------|
| Host réel | Oui | `update` / `upsert` / `delete` existants |
| Acting host | **Non** | `apply_acting_host_play`, `complete_game_session_as_actor` |
| Joueur | **Non** | contribute / customs / truth meter affirmation |

## `last_seen_at IS NULL`

Traité comme **présent** (aligné client) pour éviter un acting host fantôme sur données legacy.
