-- FEATURE-DRAWIT-04 — persistance durable des strokes terminés (T8)
--
-- RPC drawer-only, SECURITY DEFINER, SELECT … FOR UPDATE :
--   append_drawit_stroke  — append idempotent d'un stroke terminé
--   undo_drawit_stroke    — retrait durable ciblé
--   clear_drawit_canvas   — nouvel canvasEpoch + strokes vides
--
-- currentStroke n'entre jamais dans game_sessions.
-- Caps métier : 80 points / stroke, 25 strokes / manche.
-- Pas de contribute générique, pas d'acting host requis.
--
-- QA : appliquer après 02 et 03.
-- Ce fichier NE doit PAS être appliqué automatiquement par le client.

create or replace function public.drawit_sanitize_completed_stroke(p_stroke jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_id text;
  v_seq int;
  v_epoch int;
  v_color text;
  v_width numeric;
  v_points jsonb := '[]'::jsonb;
  v_pt jsonb;
  v_x numeric;
  v_y numeric;
begin
  if p_stroke is null or jsonb_typeof(p_stroke) <> 'object' then
    return null;
  end if;
  if p_stroke ?| array[
    'lobbyId','game','pseudo','wordLabel','wordId','acceptedAnswers',
    'foundOrder','guesses','score','currentStroke'
  ] then
    return null;
  end if;

  v_id := trim(coalesce(p_stroke->>'strokeId', ''));
  if v_id = '' or length(v_id) > 128 then
    return null;
  end if;

  begin
    v_seq := (p_stroke->>'seq')::int;
  exception when others then
    return null;
  end;
  if v_seq is null or v_seq < 1 then
    return null;
  end if;

  begin
    v_epoch := (p_stroke->>'canvasEpoch')::int;
  exception when others then
    return null;
  end;
  if v_epoch is null or v_epoch < 0 then
    return null;
  end if;

  v_color := coalesce(nullif(trim(p_stroke->>'color'), ''), '#f4f4f5');
  if length(v_color) > 32 then
    return null;
  end if;

  begin
    v_width := coalesce((p_stroke->>'width')::numeric, 4);
  exception when others then
    return null;
  end;
  if v_width is null or v_width <= 0 or v_width > 64 then
    return null;
  end if;

  if jsonb_typeof(p_stroke->'points') <> 'array' then
    return null;
  end if;
  if jsonb_array_length(p_stroke->'points') < 1 then
    return null;
  end if;
  if jsonb_array_length(p_stroke->'points') > 80 then
    return null;
  end if;

  for v_pt in select value from jsonb_array_elements(p_stroke->'points')
  loop
    if jsonb_typeof(v_pt) <> 'array' or jsonb_array_length(v_pt) <> 2 then
      return null;
    end if;
    begin
      v_x := (v_pt->>0)::numeric;
      v_y := (v_pt->>1)::numeric;
    exception when others then
      return null;
    end;
    if v_x is null or v_y is null then
      return null;
    end if;
    if v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1 then
      return null;
    end if;
    v_points := v_points || jsonb_build_array(
      jsonb_build_array(round(v_x, 3), round(v_y, 3))
    );
  end loop;

  return jsonb_build_object(
    'strokeId', v_id,
    'seq', v_seq,
    'canvasEpoch', v_epoch,
    'points', v_points,
    'color', v_color,
    'width', v_width
  );
end;
$$;

revoke all on function public.drawit_sanitize_completed_stroke(jsonb) from public;
grant execute on function public.drawit_sanitize_completed_stroke(jsonb) to authenticated;

create or replace function public.append_drawit_stroke(
  p_lobby_id uuid,
  p_run_id text,
  p_round_idx integer,
  p_canvas_epoch integer,
  p_stroke jsonb
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_uid_text text;
  v_row public.game_sessions;
  v_di jsonb;
  v_clean jsonb;
  v_strokes jsonb;
  v_exists boolean := false;
  v_count int := 0;
  v_seq int;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  v_uid_text := v_uid::text;
  perform public.assert_lobby_member(p_lobby_id);

  if p_run_id is null or length(trim(p_run_id)) = 0 then
    raise exception 'DRAWIT_STALE_RUN';
  end if;
  if p_round_idx is null then
    raise exception 'DRAWIT_STALE_ROUND';
  end if;
  if p_canvas_epoch is null or p_canvas_epoch < 0 then
    raise exception 'DRAWIT_STALE_EPOCH';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'DRAWIT_NO_SESSION';
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
  if coalesce(v_di->>'runId', '') is distinct from trim(p_run_id) then
    raise exception 'DRAWIT_STALE_RUN';
  end if;
  if coalesce((v_di->>'roundIdx')::int, -1) is distinct from p_round_idx then
    raise exception 'DRAWIT_STALE_ROUND';
  end if;
  if coalesce(v_di->>'phase', '') <> 'drawing' then
    raise exception 'DRAWIT_NOT_DRAWING';
  end if;
  if coalesce(v_di->>'drawerUid', '') is distinct from v_uid_text then
    raise exception 'DRAWIT_NOT_DRAWER';
  end if;
  if coalesce((v_di->>'canvasEpoch')::int, 0) is distinct from p_canvas_epoch then
    raise exception 'DRAWIT_STALE_EPOCH';
  end if;

  v_clean := public.drawit_sanitize_completed_stroke(p_stroke);
  if v_clean is null then
    if jsonb_typeof(p_stroke->'points') = 'array'
       and jsonb_array_length(p_stroke->'points') > 80
    then
      raise exception 'DRAWIT_STROKE_TOO_LONG';
    end if;
    raise exception 'DRAWIT_INVALID_STROKE';
  end if;
  if coalesce((v_clean->>'canvasEpoch')::int, -1) is distinct from p_canvas_epoch then
    raise exception 'DRAWIT_STALE_EPOCH';
  end if;

  v_strokes := coalesce(v_di->'strokes', '[]'::jsonb);
  if jsonb_typeof(v_strokes) <> 'array' then
    v_strokes := '[]'::jsonb;
  end if;

  select exists (
    select 1
    from jsonb_array_elements(v_strokes) s
    where s->>'strokeId' = v_clean->>'strokeId'
  ) into v_exists;

  if v_exists then
    return v_row;
  end if;

  select coalesce(jsonb_array_length(v_strokes), 0) into v_count;
  if v_count >= 25 then
    raise exception 'DRAWIT_STROKE_CAP';
  end if;

  v_strokes := v_strokes || jsonb_build_array(v_clean);
  v_seq := greatest(
    coalesce((v_di->>'strokeSeq')::int, 0),
    coalesce((v_clean->>'seq')::int, 0)
  );
  v_di := v_di || jsonb_build_object(
    'strokes', v_strokes,
    'strokeSeq', v_seq
  );

  update public.game_sessions
  set state = jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt}', v_di, true)
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.append_drawit_stroke(uuid, text, integer, integer, jsonb) from public;
grant execute on function public.append_drawit_stroke(uuid, text, integer, integer, jsonb) to authenticated;

create or replace function public.undo_drawit_stroke(
  p_lobby_id uuid,
  p_run_id text,
  p_round_idx integer,
  p_canvas_epoch integer,
  p_stroke_id text
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_uid_text text;
  v_row public.game_sessions;
  v_di jsonb;
  v_id text;
  v_strokes jsonb;
  v_next jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  v_uid_text := v_uid::text;
  perform public.assert_lobby_member(p_lobby_id);

  v_id := trim(coalesce(p_stroke_id, ''));
  if v_id = '' or length(v_id) > 128 then
    raise exception 'DRAWIT_INVALID_STROKE';
  end if;
  if p_run_id is null or length(trim(p_run_id)) = 0 then
    raise exception 'DRAWIT_STALE_RUN';
  end if;
  if p_round_idx is null then
    raise exception 'DRAWIT_STALE_ROUND';
  end if;
  if p_canvas_epoch is null or p_canvas_epoch < 0 then
    raise exception 'DRAWIT_STALE_EPOCH';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'DRAWIT_NO_SESSION';
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
  if coalesce(v_di->>'runId', '') is distinct from trim(p_run_id) then
    raise exception 'DRAWIT_STALE_RUN';
  end if;
  if coalesce((v_di->>'roundIdx')::int, -1) is distinct from p_round_idx then
    raise exception 'DRAWIT_STALE_ROUND';
  end if;
  if coalesce(v_di->>'phase', '') <> 'drawing' then
    raise exception 'DRAWIT_NOT_DRAWING';
  end if;
  if coalesce(v_di->>'drawerUid', '') is distinct from v_uid_text then
    raise exception 'DRAWIT_NOT_DRAWER';
  end if;
  if coalesce((v_di->>'canvasEpoch')::int, 0) is distinct from p_canvas_epoch then
    raise exception 'DRAWIT_STALE_EPOCH';
  end if;

  v_strokes := coalesce(v_di->'strokes', '[]'::jsonb);
  if jsonb_typeof(v_strokes) <> 'array' then
    return v_row;
  end if;

  select coalesce(jsonb_agg(s order by ordinality), '[]'::jsonb)
  into v_next
  from jsonb_array_elements(v_strokes) with ordinality as t(s, ordinality)
  where s->>'strokeId' is distinct from v_id;

  if v_next is not distinct from v_strokes then
    return v_row;
  end if;

  v_di := v_di || jsonb_build_object('strokes', coalesce(v_next, '[]'::jsonb));

  update public.game_sessions
  set state = jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt}', v_di, true)
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.undo_drawit_stroke(uuid, text, integer, integer, text) from public;
grant execute on function public.undo_drawit_stroke(uuid, text, integer, integer, text) to authenticated;

create or replace function public.clear_drawit_canvas(
  p_lobby_id uuid,
  p_run_id text,
  p_round_idx integer,
  p_canvas_epoch integer
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_uid_text text;
  v_row public.game_sessions;
  v_di jsonb;
  v_epoch int;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  v_uid_text := v_uid::text;
  perform public.assert_lobby_member(p_lobby_id);

  if p_run_id is null or length(trim(p_run_id)) = 0 then
    raise exception 'DRAWIT_STALE_RUN';
  end if;
  if p_round_idx is null then
    raise exception 'DRAWIT_STALE_ROUND';
  end if;
  if p_canvas_epoch is null or p_canvas_epoch < 0 then
    raise exception 'DRAWIT_STALE_EPOCH';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'DRAWIT_NO_SESSION';
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
  if coalesce(v_di->>'runId', '') is distinct from trim(p_run_id) then
    raise exception 'DRAWIT_STALE_RUN';
  end if;
  if coalesce((v_di->>'roundIdx')::int, -1) is distinct from p_round_idx then
    raise exception 'DRAWIT_STALE_ROUND';
  end if;
  if coalesce(v_di->>'phase', '') <> 'drawing' then
    raise exception 'DRAWIT_NOT_DRAWING';
  end if;
  if coalesce(v_di->>'drawerUid', '') is distinct from v_uid_text then
    raise exception 'DRAWIT_NOT_DRAWER';
  end if;

  v_epoch := coalesce((v_di->>'canvasEpoch')::int, 0);
  if v_epoch is distinct from p_canvas_epoch then
    raise exception 'DRAWIT_STALE_EPOCH';
  end if;

  v_di := v_di || jsonb_build_object(
    'canvasEpoch', v_epoch + 1,
    'strokes', '[]'::jsonb,
    'strokeSeq', 0
  );

  update public.game_sessions
  set state = jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt}', v_di, true)
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.clear_drawit_canvas(uuid, text, integer, integer) from public;
grant execute on function public.clear_drawit_canvas(uuid, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
