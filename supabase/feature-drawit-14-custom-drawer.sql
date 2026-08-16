-- =============================================================================
-- FEATURE-DRAWIT-14 — custom rounds : drawer = authorUid
--
-- Ordre d'application :
--   02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 13 → 14
--
-- Pas de nouvelle table : drawit_private.drawer_uid + drawit_custom_words.user_id
-- suffisent. On ne réécrit pas SQL 10 / 13.
--
-- 1) launch_drawit_game
--    - drawerUid public de la manche 0 = p_rounds[0].drawerUid
--    - drawerUid doit appartenir au roster figé (drawerOrder)
--    - PLUS d'exigence drawerOrder[0] === drawerUid (un custom guest peut ouvrir)
--    - si le mot est un custom du lobby, drawerUid === owner (aucun fallback)
--
-- 2) advance_drawit_round
--    - drawerUid lu dans drawit_private (posé au launch), pas recalculé par rotation
--    - catalogue : la rotation a déjà été matérialisée dans drawit_private au launch
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

create or replace function public.advance_drawit_round(p_lobby_id uuid)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_di jsonb;
  v_idx int;
  v_next int;
  v_total int;
  v_order jsonb;
  v_drawer text;
  v_start timestamptz;
  v_end timestamptz;
  v_next_di jsonb;
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
  if coalesce(v_di->>'phase', '') <> 'reveal' then
    raise exception 'Manche suivante Draw it ! uniquement depuis reveal.';
  end if;

  v_idx := coalesce((v_di->>'roundIdx')::int, 0);
  v_total := coalesce((v_di->>'roundCount')::int, 0);
  v_next := v_idx + 1;
  if v_next >= v_total then
    raise exception 'Dernière manche Draw it ! : complete_game_session.';
  end if;

  v_order := coalesce(v_di->'drawerOrder', '[]'::jsonb);
  if jsonb_typeof(v_order) <> 'array' or jsonb_array_length(v_order) < 1 then
    raise exception 'drawerOrder manquant.';
  end if;

  select p.drawer_uid::text
    into v_drawer
  from public.drawit_private p
  where p.lobby_id = p_lobby_id
    and p.run_id = coalesce(v_di->>'runId', '')
    and p.round_idx = v_next;

  if v_drawer is null or length(trim(v_drawer)) = 0 then
    raise exception 'drawerUid suivant invalide.';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements_text(v_order) as d(uid)
    where d.uid = v_drawer
  ) then
    raise exception 'drawerUid suivant invalide.';
  end if;

  v_start := clock_timestamp();
  v_end := v_start + interval '60 seconds';

  v_next_di := v_di
    || jsonb_build_object(
      'roundIdx', v_next,
      'phase', 'drawing',
      'drawerUid', v_drawer,
      'roundStartAt', to_jsonb(v_start),
      'roundEndsAt', to_jsonb(v_end),
      'roundScored', false,
      'foundOrder', '[]'::jsonb,
      'guesses', '[]'::jsonb,
      'strokes', '[]'::jsonb,
      'canvasEpoch', 0,
      'strokeSeq', 0,
      'editLog', '[]'::jsonb,
      'eraseOpIds', '[]'::jsonb
    );

  update public.game_sessions
  set state = jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt}', v_next_di, true)
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.advance_drawit_round(uuid) from public;
revoke all on function public.advance_drawit_round(uuid) from anon;
grant execute on function public.advance_drawit_round(uuid) to authenticated;
