# Supabase — egress (trafic sortant)

L’**egress** compte les octets renvoyés par l’API Postgres (REST), pas la taille de la base. Une DB de ~30 Mo peut générer plusieurs Go d’egress si le même `game_sessions.state` est retéléchargé en boucle.

## Optimisations dans l’app

| Mécanisme | Fichier |
|-----------|---------|
| Polling `game_sessions` : méta sans `state`, fetch complet seulement si `updated_at` change | `js/core/gameSync.js` |
| Hôte : plus de refetch systématique du `state` avant chaque patch (méta + cache comme l’invité) | `loadSessionRowForPatch` |
| Decks déshydratés dans `state` | `js/core/deckCodec.js` |
| Lobby : pas de 100 messages par défaut | `js/core/supabaseLobby.js` |
| Localhost : polling espacé (×3) | `js/config/syncConfig.js` |

Réglages dev : `js/config/syncConfig.js` (`EGRESS_RELAX_POLL_ON_LOCALHOST`, `LOCALHOST_POLL_MULTIPLIER`).

**Recommandation** : projet Supabase **séparé** pour le développement.

## SQL utile (Dashboard → SQL Editor)

Sessions les plus lourdes :

```sql
select
  gs.id,
  gs.lobby_id,
  gs.game_id,
  gs.screen,
  gs.updated_at,
  pg_column_size(gs.state) as state_bytes,
  l.code as lobby_code
from public.game_sessions gs
left join public.lobbies l on l.id = gs.lobby_id
order by state_bytes desc nulls last
limit 20;
```

Lobbies / sessions de test orphelins (à adapter avant `DELETE`) :

```sql
-- Lobbies sans membre (aperçu)
select l.id, l.code, l.updated_at
from public.lobbies l
where not exists (
  select 1 from public.lobby_members m where m.lobby_id = l.id
);

-- Supprimer les game_sessions d’un lobby précis (cascade si tu supprimes le lobby)
-- delete from public.game_sessions where lobby_id = 'UUID_ICI';
```

## Habitudes dev

- Un onglet client en test solo ; fermer le lobby (hôte) en fin de session.
- Éviter les F5 en boucle pendant un lobby actif (chaque boot refetch lobby + session).
- Vérifier **Usage → Egress** (Database), pas seulement Realtime Messages.
