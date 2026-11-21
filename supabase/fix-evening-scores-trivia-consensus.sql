-- =============================================================================
-- AUDIT n°4 (points de soirée en fin de partie) — Trivia et Consensus
-- =============================================================================
-- Problème : Trivia et Consensus ajoutaient les points de soirée sur le téléphone
-- de celui qui termine la partie, puis le vrai hôte les envoyait avec la fin de
-- partie. Un hôte remplaçant termine par complete_game_session_as_actor, qui
-- n'écrit aucun point (voulu) : les points de la partie étaient perdus pour tout
-- le monde sauf lui. Trivia pouvait aussi compter deux fois (écran rouvert entre
-- deux essais).
--
-- Correctif (même principe que finalize_drawit_scores) : le serveur ajoute
-- lui-même les points de soirée, UNE fois par partie, à l'appel de l'hôte ou du
-- remplaçant, juste avant la fin de partie :
--   Trivia    : score du quiz + bonus podium (15 / 10 / 5, rang « compétition » :
--               ex aequo = même rang) pour chaque membre du salon ;
--   Consensus : score de la partie (pas de bonus podium).
-- Ajoute aussi : score du jeu (gameScores), ordre des jeux, jeu enregistré dans
-- la soirée, compteur de parties (une fois par soirée, comme côté appli).
--
-- Une seule fois par partie : marqueur state.eveningFinalized[jeu] =
--   Trivia    : runId de la partie ;
--   Consensus : empreinte (md5) du jeu de questions de la partie.
-- La fin de partie n'est acceptée qu'en phase « final » d'une partie en cours.
--
-- Miroir JS : js/core/eveningFinalize.js. Rejouable (CREATE OR REPLACE).
-- =============================================================================

-- Calcul pur : ajoute les points de soirée d'une partie à l'état. --------------
create or replace function public.evening_finalize_credit(
  p_state jsonb,
  p_game text,
  p_deltas jsonb,
  p_stat_key text,
  p_marker text
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_state jsonb := case when jsonb_typeof(p_state) = 'object' then p_state else '{}'::jsonb end;
  v_deltas jsonb := case when jsonb_typeof(p_deltas) = 'object' then p_deltas else '{}'::jsonb end;
  v_game_scores jsonb;
  v_order jsonb;
  v_recorded jsonb;
  v_stats jsonb;
  v_finalized jsonb;
begin
  v_game_scores := case when jsonb_typeof(v_state->'gameScores') = 'object'
    then v_state->'gameScores' else '{}'::jsonb end;
  v_game_scores := jsonb_set(
    v_game_scores,
    array[p_game],
    public.drawit_add_score_deltas(v_game_scores->p_game, v_deltas),
    true
  );

  v_order := case when jsonb_typeof(v_state->'gameScoreOrder') = 'array'
    then v_state->'gameScoreOrder' else '[]'::jsonb end;
  if not v_order @> jsonb_build_array(p_game) then
    v_order := v_order || jsonb_build_array(p_game);
  end if;

  v_recorded := case when jsonb_typeof(v_state->'eveningGamesRecorded') = 'object'
    then v_state->'eveningGamesRecorded' else '{}'::jsonb end;
  v_stats := case when jsonb_typeof(v_state->'stats') = 'object'
    then v_state->'stats' else '{}'::jsonb end;
  -- Compteur de parties : une fois par soirée (même règle que recordEveningGameOnce).
  if coalesce((v_recorded->>p_game)::boolean, false) is not true then
    v_stats := jsonb_set(
      v_stats,
      array[p_stat_key],
      to_jsonb(coalesce((v_stats->>p_stat_key)::int, 0) + 1),
      true
    );
  end if;
  v_recorded := v_recorded || jsonb_build_object(p_game, true);

  v_finalized := case when jsonb_typeof(v_state->'eveningFinalized') = 'object'
    then v_state->'eveningFinalized' else '{}'::jsonb end;
  v_finalized := v_finalized || jsonb_build_object(p_game, p_marker);

  return v_state || jsonb_build_object(
    'scores', public.drawit_add_score_deltas(v_state->'scores', v_deltas),
    'gameScores', v_game_scores,
    'gameScoreOrder', v_order,
    'eveningGamesRecorded', v_recorded,
    'stats', v_stats,
    'eveningFinalized', v_finalized
  );
end;
$$;

revoke all on function public.evening_finalize_credit(jsonb, text, jsonb, text, text) from public;
revoke all on function public.evening_finalize_credit(jsonb, text, jsonb, text, text) from anon;
revoke all on function public.evening_finalize_credit(jsonb, text, jsonb, text, text) from authenticated;

-- Trivia ----------------------------------------------------------------------
create or replace function public.finalize_trivia_scores(p_lobby_id uuid)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_state jsonb;
  v_blob jsonb;
  v_run text;
  v_match jsonb;
  v_deltas jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found or v_row.game_id is distinct from 'trivia' then
    raise exception 'TRIVIA_WRONG_GAME';
  end if;

  v_state := coalesce(v_row.state, '{}'::jsonb);
  v_blob := coalesce(v_state->'trivia', '{}'::jsonb);
  v_run := coalesce(v_blob->>'runId', '');

  -- Déjà fait pour cette partie (même après la fin de partie) : rien de plus.
  if v_run <> '' and coalesce(v_state->'eveningFinalized'->>'trivia', '') = v_run then
    return v_row;
  end if;

  if v_run = ''
     or coalesce((v_blob->>'lobbyStarted')::boolean, false) is not true
     or coalesce(v_blob->>'phase', '') <> 'final'
  then
    raise exception 'TRIVIA_NOT_FINAL';
  end if;

  v_match := case when jsonb_typeof(v_blob->'matchScores') = 'object'
    then v_blob->'matchScores' else '{}'::jsonb end;

  -- Membres du salon (comme l'appli : joueurs du salon, 0 si pas de score),
  -- rang « compétition » (ex aequo = même rang), bonus 15 / 10 / 5.
  with m as (
    select
      lm.user_id::text as uid,
      case
        when jsonb_typeof(v_match->lm.user_id::text) = 'number'
          then (v_match->>lm.user_id::text)::numeric
        else 0
      end as s
    from public.lobby_members lm
    where lm.lobby_id = p_lobby_id
  ),
  r as (
    select uid, s, rank() over (order by s desc) as rk
    from m
  ),
  t as (
    select uid, s + case rk when 1 then 15 when 2 then 10 when 3 then 5 else 0 end as total
    from r
  )
  select coalesce(jsonb_object_agg(uid, total) filter (where total > 0), '{}'::jsonb)
    into v_deltas
  from t;

  v_state := public.evening_finalize_credit(v_state, 'trivia', v_deltas, 'triviaGamesPlayed', v_run);

  update public.game_sessions
  set state = v_state
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.finalize_trivia_scores(uuid) from public;
revoke all on function public.finalize_trivia_scores(uuid) from anon;
grant execute on function public.finalize_trivia_scores(uuid) to authenticated;

-- Consensus -------------------------------------------------------------------
create or replace function public.finalize_consensus_scores(p_lobby_id uuid)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_state jsonb;
  v_blob jsonb;
  v_marker text;
  v_match jsonb;
  v_deltas jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found or v_row.game_id is distinct from 'consensus' then
    raise exception 'CONSENSUS_WRONG_GAME';
  end if;

  v_state := coalesce(v_row.state, '{}'::jsonb);
  v_blob := coalesce(v_state->'consensus', '{}'::jsonb);
  if jsonb_typeof(v_blob->'deck') is distinct from 'array' then
    raise exception 'CONSENSUS_NOT_FINAL';
  end if;

  -- Consensus n'a pas d'identifiant de partie : empreinte du jeu de questions.
  -- Déjà fait pour cette partie (même après la fin de partie) : rien de plus.
  v_marker := md5((v_blob->'deck')::text);
  if coalesce(v_state->'eveningFinalized'->>'consensus', '') = v_marker then
    return v_row;
  end if;

  if coalesce((v_blob->>'lobbyStarted')::boolean, false) is not true
     or coalesce(v_blob->>'phase', '') <> 'final'
  then
    raise exception 'CONSENSUS_NOT_FINAL';
  end if;

  v_match := case when jsonb_typeof(v_blob->'matchScores') = 'object'
    then v_blob->'matchScores' else '{}'::jsonb end;

  -- Score de la partie des membres du salon, s'il est positif (pas de bonus).
  select coalesce(
      jsonb_object_agg(lm.user_id::text, (v_match->>lm.user_id::text)::numeric)
        filter (
          where jsonb_typeof(v_match->lm.user_id::text) = 'number'
            and (v_match->>lm.user_id::text)::numeric > 0
        ),
      '{}'::jsonb
    )
    into v_deltas
  from public.lobby_members lm
  where lm.lobby_id = p_lobby_id;

  v_state := public.evening_finalize_credit(v_state, 'consensus', v_deltas, 'consensusGamesPlayed', v_marker);

  update public.game_sessions
  set state = v_state
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.finalize_consensus_scores(uuid) from public;
revoke all on function public.finalize_consensus_scores(uuid) from anon;
grant execute on function public.finalize_consensus_scores(uuid) to authenticated;

notify pgrst, 'reload schema';
