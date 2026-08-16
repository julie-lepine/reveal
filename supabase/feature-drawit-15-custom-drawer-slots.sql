-- =============================================================================
-- FEATURE-DRAWIT-15 — répartition drawers + reveal sans mismatch
--
-- Ordre d'application :
--   02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 13 → 14 → 15
--
-- SQL 14 n'est pas réécrite. Pas de nouvelle table.
--
-- 1) launch_drawit_game
--    Chaque round i : drawerUid === drawerOrder[i % n]
--    Un custom ne peut donc occuper qu'un créneau de son auteur.
--    Conservé : DRAWIT_CUSTOM_DRAWER si drawer ≠ owner.
--
-- 2) reveal_drawit_round
--    Le mot privé est lu par (lobby, run, round_idx), SANS exiger que
--    drawer_uid public == drawer_uid privé. Un mismatch ne freeze plus
--    la fin de manche (DRAWIT_NO_WORD).
-- =============================================================================

create or replace function public.launch_drawit_game(
  p_lobby_id uuid,
  p_drawit jsonb,
  p_rounds jsonb
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_run text;
  v_round_count int;
  v_drawer text;
  v_start timestamptz;
  v_end timestamptz;
  v_di jsonb;
  v_order_len int;
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

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;
  if v_row.game_id is distinct from 'drawit' then
    raise exception 'DRAWIT_WRONG_GAME';
  end if;
  if p_drawit is null or jsonb_typeof(p_drawit) <> 'object' then
    raise exception 'DRAWIT_INVALID_LAUNCH';
  end if;

  v_run := trim(coalesce(p_drawit->>'runId', ''));
  v_round_count := coalesce((p_drawit->>'roundCount')::int, 0);
  v_drawer := coalesce(p_drawit->>'drawerUid', '');
  if v_run = ''
     or coalesce((p_drawit->>'lobbyStarted')::boolean, false) is not true
     or coalesce(p_drawit->>'phase', '') <> 'drawing'
     or coalesce((p_drawit->>'roundIdx')::int, -1) <> 0
     or v_round_count < 1
     or p_rounds is null
     or jsonb_typeof(p_rounds) <> 'array'
     or jsonb_array_length(p_rounds) <> v_round_count
     or jsonb_typeof(coalesce(p_drawit->'drawerOrder', 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_drawit->'drawerOrder') < 1
     or coalesce(p_rounds->0->>'drawerUid', '') is distinct from v_drawer
     or not exists (
       select 1
       from jsonb_array_elements_text(p_drawit->'drawerOrder') as d(uid)
       where d.uid = v_drawer
     )
  then
    raise exception 'DRAWIT_INVALID_LAUNCH';
  end if;
  if p_drawit ?| array['wordId','wordLabel','deck','words','acceptedAnswers'] then
    raise exception 'DRAWIT_PUBLIC_SECRET';
  end if;

  v_order_len := jsonb_array_length(p_drawit->'drawerOrder');
  if exists (
    select 1
    from jsonb_array_elements(p_rounds) with ordinality as r(elem, idx)
    where (elem->>'drawerUid') is distinct from (
      p_drawit->'drawerOrder'->>((idx::int - 1) % v_order_len)
    )
  ) then
    raise exception 'DRAWIT_INVALID_LAUNCH';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rounds) as r(elem)
    join public.drawit_custom_words w
      on w.lobby_id = p_lobby_id
     and (
       (coalesce(elem->>'customId', '') <> '' and w.entry_id = elem->>'customId')
       or (
         coalesce(elem->>'customId', '') = ''
         and w.word_text = left(trim(coalesce(elem->>'wordLabel', '')), 160)
       )
     )
    where (elem->>'drawerUid') is distinct from w.user_id::text
  ) then
    raise exception 'DRAWIT_CUSTOM_DRAWER';
  end if;

  perform public.write_drawit_private_rounds(p_lobby_id, v_run, p_rounds);
  delete from public.drawit_custom_words where lobby_id = p_lobby_id;

  v_start := clock_timestamp();
  v_end := v_start + interval '60 seconds';
  v_di := (p_drawit - 'roundStartAt' - 'roundEndsAt' - 'customWords')
    || jsonb_build_object(
      'roundIdx', 0,
      'phase', 'drawing',
      'roundStartAt', to_jsonb(v_start),
      'roundEndsAt', to_jsonb(v_end),
      'roundScored', false,
      'lastRound', null,
      'matchScores', '{}'::jsonb,
      'foundOrder', '[]'::jsonb,
      'guesses', '[]'::jsonb,
      'strokes', '[]'::jsonb,
      'canvasEpoch', 0,
      'strokeSeq', 0
    );

  update public.game_sessions
  set game_id = 'drawit',
      screen = 'drawit',
      state = jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt}', v_di, true)
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.launch_drawit_game(uuid, jsonb, jsonb) from public;
revoke all on function public.launch_drawit_game(uuid, jsonb, jsonb) from anon;
grant execute on function public.launch_drawit_game(uuid, jsonb, jsonb) to authenticated;

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
  if
    (v_ends is null or clock_timestamp() < v_ends)
    and not public.drawit_all_guessers_found(v_di)
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
