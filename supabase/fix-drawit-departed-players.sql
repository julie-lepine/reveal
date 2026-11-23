-- =============================================================================
-- AUDIT Draw It n°2 — joueur qui quitte le salon en pleine partie
-- =============================================================================
-- Problème : la liste des joueurs est figée au lancement.
--  * Devineur parti : « tout le monde a trouvé » n'arrivait plus jamais
--    (drawit_all_guessers_found le comptait encore) → chaque manche durait 60 s.
--  * Dessinateur parti : ses manches tournaient quand même → 60 s de toile vide.
--
-- Correctif :
--  1. drawit_all_present_guessers_found(lobby, drawIt) : comme
--     drawit_all_guessers_found, mais ne compte que les devineurs encore membres
--     du salon. L'ancienne fonction reste en place (rien d'autre ne l'appelle).
--  2. reveal_drawit_round : utilise la nouvelle fonction, et termine tout de suite
--     une manche dont le dessinateur n'est plus membre du salon (hôte, remplaçant
--     ou joueur de la partie).
--  3. submit_drawit_guess : modification ciblée EN PLACE (une seule ligne, la
--     fonction fait ~5 300 caractères) : la fin automatique quand tout le monde a
--     trouvé utilise la nouvelle fonction.
-- Rejouable : la fonction 1 et 2 sont en CREATE OR REPLACE ; l'étape 3 ne fait
-- rien si la ligne a déjà été remplacée.
-- Base : version prod du 2026-11-20 (fix-drawit-reveal-any-player.sql inclus).
-- Miroir JS : js/core/drawItRound.js (expectedDrawItGuessers, isDrawItDrawerGone).
-- =============================================================================

-- 1. Devineurs encore présents ------------------------------------------------
create or replace function public.drawit_all_present_guessers_found(
  p_lobby_id uuid,
  p_drawit jsonb
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  v_drawer text := coalesce(p_drawit->>'drawerUid', '');
  v_source jsonb := coalesce(p_drawit->'participants', '[]'::jsonb);
  v_found jsonb := coalesce(p_drawit->'foundOrder', '[]'::jsonb);
  v_uids text[];
begin
  if jsonb_typeof(v_found) <> 'array' then
    v_found := '[]'::jsonb;
  end if;

  if jsonb_typeof(v_source) = 'array' and jsonb_array_length(v_source) > 0 then
    select array_agg(distinct p->>'userId')
      into v_uids
    from jsonb_array_elements(v_source) p
    where length(trim(coalesce(p->>'userId', ''))) > 0;
  else
    v_source := coalesce(p_drawit->'drawerOrder', '[]'::jsonb);
    if jsonb_typeof(v_source) <> 'array' then
      return false;
    end if;
    select array_agg(distinct t.uid)
      into v_uids
    from jsonb_array_elements_text(v_source) as t(uid)
    where length(trim(t.uid)) > 0;
  end if;

  -- Devineurs attendus : hors dessinateur, et encore membres du salon.
  select array_agg(u)
    into v_uids
  from unnest(coalesce(v_uids, array[]::text[])) as u
  where u is distinct from v_drawer
    and exists (
      select 1
      from public.lobby_members m
      where m.lobby_id = p_lobby_id
        and m.user_id::text = u
    );

  if coalesce(array_length(v_uids, 1), 0) = 0 then
    return false;
  end if;

  return not exists (
    select 1
    from unnest(v_uids) as u
    where not exists (
      select 1
      from jsonb_array_elements(v_found) f
      where f->>'uid' = u
    )
  );
end;
$$;

revoke all on function public.drawit_all_present_guessers_found(uuid, jsonb) from public;
revoke all on function public.drawit_all_present_guessers_found(uuid, jsonb) from anon;
revoke all on function public.drawit_all_present_guessers_found(uuid, jsonb) from authenticated;

-- 2. Fin de manche ------------------------------------------------------------
create or replace function public.reveal_drawit_round(p_lobby_id uuid)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_di jsonb;
  v_phase text;
  v_ends timestamptz;
  v_run text;
  v_idx int;
  v_word text;
  v_player_only boolean := false;
  v_time_up boolean;
  v_drawer_gone boolean;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    -- Joueur de la partie : seulement après le chrono ou si le dessinateur est parti.
    perform public.assert_lobby_member(p_lobby_id);
    v_player_only := true;
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_row.game_id is distinct from 'drawit' then
    raise exception 'DRAWIT_WRONG_GAME';
  end if;

  v_di := coalesce(v_row.state->'drawIt', '{}'::jsonb);
  if jsonb_typeof(v_di) <> 'object'
     or coalesce((v_di->>'lobbyStarted')::boolean, false) is not true
  then
    raise exception 'DRAWIT_NO_SESSION';
  end if;
  v_phase := coalesce(v_di->>'phase', '');

  if v_phase = 'reveal' then
    return v_row;
  end if;

  if v_phase <> 'drawing' then
    raise exception 'Reveal Draw it ! uniquement depuis drawing.';
  end if;

  v_ends := (v_di->>'roundEndsAt')::timestamptz;
  v_time_up := v_ends is not null and clock_timestamp() >= v_ends;
  -- Dessinateur parti du salon : personne ne peut plus dessiner cette manche.
  v_drawer_gone := coalesce(v_di->>'drawerUid', '') <> ''
    and not exists (
      select 1
      from public.lobby_members m
      where m.lobby_id = p_lobby_id
        and m.user_id::text = v_di->>'drawerUid'
    );

  if v_player_only then
    if jsonb_typeof(coalesce(v_di->'drawerOrder', 'null'::jsonb)) <> 'array'
       or not exists (
         select 1
         from jsonb_array_elements_text(v_di->'drawerOrder') as d(uid)
         where d.uid = v_uid::text
       )
    then
      raise exception 'DRAWIT_NOT_IN_PARTY';
    end if;
    if not v_time_up and not v_drawer_gone then
      raise exception 'Reveal Draw it ! trop tôt.';
    end if;
  elsif
    not v_time_up
    and not v_drawer_gone
    and not public.drawit_all_present_guessers_found(p_lobby_id, v_di)
  then
    raise exception 'Reveal Draw it ! trop tôt.';
  end if;

  v_run := v_di->>'runId';
  v_idx := coalesce((v_di->>'roundIdx')::int, 0);

  select word_label into v_word
  from public.drawit_private
  where lobby_id = p_lobby_id
    and run_id = v_run
    and round_idx = v_idx;

  if v_word is null then
    raise exception 'DRAWIT_NO_WORD';
  end if;

  v_di := public.drawit_revealed_state(v_di, v_word);

  update public.game_sessions
  set state = jsonb_set(
        coalesce(state, '{}'::jsonb),
        '{drawIt}',
        v_di,
        true
      )
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.reveal_drawit_round(uuid) from public;
revoke all on function public.reveal_drawit_round(uuid) from anon;
grant execute on function public.reveal_drawit_round(uuid) to authenticated;

-- 3. Propositions : fin automatique quand tous les présents ont trouvé --------
do $migration$
declare
  v_def text;
  v_old text := 'v_all_found := public.drawit_all_guessers_found(v_di);';
  v_new text := 'v_all_found := public.drawit_all_present_guessers_found(p_lobby_id, v_di);';
  v_count int;
begin
  v_def := pg_get_functiondef(
    'public.submit_drawit_guess(uuid,text,integer,text)'::regprocedure
  );

  if position(v_new in v_def) > 0 then
    raise notice 'submit_drawit_guess : déjà à jour, rien à faire.';
    return;
  end if;

  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'submit_drawit_guess : passage attendu trouvé % fois (1 attendu). Migration annulée.', v_count;
  end if;

  execute replace(v_def, v_old, v_new);
end;
$migration$;

notify pgrst, 'reload schema';
