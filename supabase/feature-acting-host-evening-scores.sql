-- =============================================================================
-- AUDIT CLUTCH N°10 — Points de soirée des manches annoncées par l'hôte remplaçant
-- =============================================================================
-- Problème : quand l'hôte réel est absent (> 120 s, même règle que is_acting_host),
-- l'hôte remplaçant annonce les manches via apply_acting_host_play (ou Truth Meter
-- via reveal_truth_meter_round / submit_truth_meter_vote). Ces RPC acceptent le
-- score du jeu (`matchScores`) mais refusent, à raison, les points de soirée
-- (`scores`, `gameScores`). Les points des manches jouées pendant l'absence de
-- l'hôte n'arrivaient donc jamais au classement de la soirée des autres joueurs.
--
-- Correctif : règle BEFORE UPDATE sur game_sessions. Quand un joueur AUTRE que
-- l'hôte réel augmente `matchScores` d'un jeu « manche par manche » pendant que
-- l'hôte réel est absent, le serveur ajoute lui-même la hausse :
--   state.scores[uid]               += hausse
--   state.gameScores[jeu][uid]      += hausse
--   state.gameScoreOrder            += jeu (si absent)
-- La règle de sécurité ne change pas : le client n'envoie toujours aucun point de
-- soirée ; le serveur calcule à partir d'un score qu'il accepte déjà.
--
-- Jeux concernés (points de soirée = points de manche, mêmes deltas côté client) :
--   clutch, dilemma, hottake, speedvote, wronganswer, truthmeter.
-- Hors scope (points de soirée crédités autrement) : trivia, consensus, drawit
-- (crédit en fin de partie), guesslie (pas de matchScores), traitre, tiernight.
--
-- Pas de double comptage :
--   - hôte réel présent ou auteur de l'écriture : rien n'est ajouté (il crédite
--     déjà ses points côté client puis les envoie) ;
--   - écriture sans utilisateur (service / cron) : rien ;
--   - seules les HAUSSES comptent (relance d'un même envoi : hausse nulle) ;
--   - côté client, les points de soirée sont fusionnés au maximum, pas additionnés.
--
-- Clés : matchScores / scores / gameScores[jeu] sont indexés par UID texte côté
-- serveur (scoresToRemote / matchScores remote).
--
-- Tests : feature-acting-host-evening-scores-tests.sql (sur une branche de test).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Calcul pur (sans accès à la base) : testable seul.
-- -----------------------------------------------------------------------------
create or replace function public.evening_credit_from_match_scores(
  p_state jsonb,
  p_game text,
  p_old_match jsonb,
  p_new_match jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_state jsonb := coalesce(p_state, '{}'::jsonb);
  v_old jsonb := case when jsonb_typeof(p_old_match) = 'object' then p_old_match else '{}'::jsonb end;
  v_scores jsonb;
  v_game_scores jsonb;
  v_game_map jsonb;
  v_order jsonb;
  v_player text;
  v_val jsonb;
  v_delta numeric;
  v_changed boolean := false;
begin
  if p_game is null or jsonb_typeof(p_new_match) is distinct from 'object' then
    return v_state;
  end if;
  if jsonb_typeof(v_state) <> 'object' then
    return p_state;
  end if;

  v_scores := case when jsonb_typeof(v_state -> 'scores') = 'object'
    then v_state -> 'scores' else '{}'::jsonb end;
  v_game_scores := case when jsonb_typeof(v_state -> 'gameScores') = 'object'
    then v_state -> 'gameScores' else '{}'::jsonb end;
  v_game_map := case when jsonb_typeof(v_game_scores -> p_game) = 'object'
    then v_game_scores -> p_game else '{}'::jsonb end;

  for v_player, v_val in select key, value from jsonb_each(p_new_match)
  loop
    if jsonb_typeof(v_val) <> 'number' then
      continue;
    end if;
    v_delta := (v_val #>> '{}')::numeric
      - coalesce(
          case when jsonb_typeof(v_old -> v_player) = 'number'
            then (v_old ->> v_player)::numeric end,
          0
        );
    if v_delta is null or v_delta <= 0 then
      continue;
    end if;
    v_scores := jsonb_set(
      v_scores,
      array[v_player],
      to_jsonb(
        coalesce(
          case when jsonb_typeof(v_scores -> v_player) = 'number'
            then (v_scores ->> v_player)::numeric end,
          0
        ) + v_delta
      ),
      true
    );
    v_game_map := jsonb_set(
      v_game_map,
      array[v_player],
      to_jsonb(
        coalesce(
          case when jsonb_typeof(v_game_map -> v_player) = 'number'
            then (v_game_map ->> v_player)::numeric end,
          0
        ) + v_delta
      ),
      true
    );
    v_changed := true;
  end loop;

  if not v_changed then
    return v_state;
  end if;

  v_order := case when jsonb_typeof(v_state -> 'gameScoreOrder') = 'array'
    then v_state -> 'gameScoreOrder' else '[]'::jsonb end;
  if not (v_order @> jsonb_build_array(p_game)) then
    v_order := v_order || jsonb_build_array(p_game);
  end if;

  v_state := jsonb_set(v_state, '{scores}', v_scores, true);
  v_state := jsonb_set(v_state, '{gameScores}', jsonb_set(v_game_scores, array[p_game], v_game_map, true), true);
  v_state := jsonb_set(v_state, '{gameScoreOrder}', v_order, true);
  return v_state;
end;
$$;

revoke all on function public.evening_credit_from_match_scores(jsonb, text, jsonb, jsonb) from public;
revoke all on function public.evening_credit_from_match_scores(jsonb, text, jsonb, jsonb) from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Règle BEFORE UPDATE : qui écrit, hôte absent, jeu concerné, puis calcul pur.
-- -----------------------------------------------------------------------------
create or replace function public.game_sessions_credit_absent_host_evening_scores()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_host_id uuid;
  v_host_present boolean;
  v_game text;
  v_state_key text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op <> 'UPDATE' then
    return NEW;
  end if;

  v_game := NEW.game_id;
  if v_game is null or v_game not in (
    'clutch', 'dilemma', 'hottake', 'speedvote', 'wronganswer', 'truthmeter'
  ) then
    return NEW;
  end if;

  v_state_key := public.game_session_state_key(v_game);
  if v_state_key is null then
    return NEW;
  end if;

  v_old := OLD.state -> v_state_key -> 'matchScores';
  v_new := NEW.state -> v_state_key -> 'matchScores';
  if jsonb_typeof(v_new) is distinct from 'object' or v_new is not distinct from v_old then
    return NEW;
  end if;

  -- Écriture service (cron, admin) : pas de crédit.
  if v_uid is null then
    return NEW;
  end if;

  select host_id into v_host_id
  from public.lobbies
  where id = NEW.lobby_id;

  -- L'hôte réel crédite déjà ses points côté client.
  if v_host_id is null or v_uid = v_host_id then
    return NEW;
  end if;

  -- Même règle de présence que is_acting_host (120 s).
  select exists (
    select 1
    from public.lobby_members m
    where m.lobby_id = NEW.lobby_id
      and m.user_id = v_host_id
      and (m.last_seen_at is null or m.last_seen_at >= (now() - interval '120 seconds'))
  ) into v_host_present;

  if v_host_present then
    return NEW;
  end if;

  NEW.state := public.evening_credit_from_match_scores(NEW.state, v_game, v_old, v_new);
  return NEW;
end;
$$;

revoke all on function public.game_sessions_credit_absent_host_evening_scores() from public;
revoke all on function public.game_sessions_credit_absent_host_evening_scores() from anon, authenticated;

drop trigger if exists game_sessions_credit_absent_host_evening_scores on public.game_sessions;
create trigger game_sessions_credit_absent_host_evening_scores
before update on public.game_sessions
for each row
execute function public.game_sessions_credit_absent_host_evening_scores();
