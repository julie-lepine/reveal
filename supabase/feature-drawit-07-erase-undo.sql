-- FEATURE-DRAWIT-07 — Undo d'une opération de gomme partielle
--
-- À appliquer APRÈS :
--   feature-drawit-02-private-word.sql
--   feature-drawit-03-guesses.sql
--   feature-drawit-04-strokes.sql
--   feature-drawit-05-erase.sql
--   feature-drawit-06-partial-erase.sql
--
-- Ce fichier NE doit PAS être appliqué automatiquement par le client.
--
-- RPC nouvelle :
--   undo_drawit_erase(p_lobby_id, p_run_id, p_round_idx, p_canvas_epoch, p_erase_operation_id)
--
-- RPCs mises à jour (CREATE OR REPLACE, même signature) pour porter drawIt.editLog :
--   append_drawit_stroke, undo_drawit_stroke, clear_drawit_canvas, erase_drawit_segments
--
-- editLog : dernières 32 opérations de l'epoch courant
--   { kind: draw|erase, canvasEpoch, strokeId?, operationId?,
--     sourceStrokes?, replacementStrokeIds?, undone }
-- Les sourceStrokes sont copiés depuis l'état verrouillé AU MOMENT de la gomme.
-- Aucun snapshot client complet de drawIt.strokes n'est accepté.
--
-- Guards identiques T8/T9/T06 : auth.uid(), membre, drawit, lobbyStarted,
-- run / round / epoch, phase drawing, drawerUid LU depuis la session.

create or replace function public.drawit_edit_log_append(
  p_log jsonb,
  p_entry jsonb,
  p_epoch integer
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_item jsonb;
  v_key text;
  v_new_key text;
  v_exists boolean := false;
begin
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    return case
      when p_log is null or jsonb_typeof(p_log) <> 'array' then '[]'::jsonb
      else p_log
    end;
  end if;
  v_new_key := case
    when coalesce(p_entry->>'kind', '') = 'erase'
      then 'erase:' || coalesce(p_entry->>'operationId', '')
    else 'draw:' || coalesce(p_entry->>'strokeId', '')
  end;
  if p_log is not null and jsonb_typeof(p_log) = 'array' then
    for v_item in select value from jsonb_array_elements(p_log)
    loop
      if coalesce((v_item->>'canvasEpoch')::int, 0) is distinct from p_epoch then
        continue;
      end if;
      v_key := case
        when coalesce(v_item->>'kind', '') = 'erase'
          then 'erase:' || coalesce(v_item->>'operationId', '')
        else 'draw:' || coalesce(v_item->>'strokeId', '')
      end;
      if v_key = v_new_key then
        v_exists := true;
        if coalesce((p_entry->>'undone')::boolean, false) then
          v_item := v_item || jsonb_build_object('undone', true);
        end if;
      end if;
      v_out := v_out || jsonb_build_array(v_item);
    end loop;
  end if;
  if not v_exists then
    v_out := v_out || jsonb_build_array(
      p_entry || jsonb_build_object('canvasEpoch', p_epoch, 'undone', coalesce((p_entry->>'undone')::boolean, false))
    );
  end if;
  if jsonb_array_length(v_out) > 32 then
    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb)
    into v_out
    from (
      select value, ordinality
      from jsonb_array_elements(v_out) with ordinality as t(value, ordinality)
      order by ordinality desc
      limit 32
    ) last_ops;
  end if;
  return coalesce(v_out, '[]'::jsonb);
end;
$$;

revoke all on function public.drawit_edit_log_append(jsonb, jsonb, integer) from public;
grant execute on function public.drawit_edit_log_append(jsonb, jsonb, integer) to authenticated;

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
    'strokeSeq', v_seq,
    'editLog', public.drawit_edit_log_append(
      v_di->'editLog',
      jsonb_build_object(
        'kind', 'draw',
        'strokeId', v_clean->>'strokeId',
        'canvasEpoch', p_canvas_epoch,
        'undone', false
      ),
      p_canvas_epoch
    )
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

  v_di := v_di || jsonb_build_object(
    'strokes', coalesce(v_next, '[]'::jsonb),
    'editLog', public.drawit_edit_log_append(
      v_di->'editLog',
      jsonb_build_object(
        'kind', 'draw',
        'strokeId', v_id,
        'canvasEpoch', p_canvas_epoch,
        'undone', true
      ),
      p_canvas_epoch
    )
  );

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
    'strokeSeq', 0,
    'editLog', '[]'::jsonb,
    'eraseOpIds', '[]'::jsonb
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

create or replace function public.erase_drawit_segments(
  p_lobby_id uuid,
  p_run_id text,
  p_round_idx integer,
  p_canvas_epoch integer,
  p_operation_id text,
  p_replacements jsonb
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
  v_strokes jsonb;
  v_next jsonb := '[]'::jsonb;
  v_ops jsonb;
  v_op text;
  v_item jsonb;
  v_src jsonb;
  v_src_id text;
  v_frag jsonb;
  v_clean jsonb;
  v_repl jsonb;
  v_seen text[] := '{}';
  v_source_ids text[] := '{}';
  v_sources jsonb := '[]'::jsonb;
  v_repl_ids jsonb := '[]'::jsonb;
  v_count int := 0;
  v_untouched int := 0;
  v_budget int := 25;
  v_added int;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  v_uid_text := v_uid::text;
  perform public.assert_lobby_member(p_lobby_id);

  v_op := trim(coalesce(p_operation_id, ''));
  if v_op = '' or length(v_op) > 64 then
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
  if p_replacements is null or jsonb_typeof(p_replacements) <> 'array' then
    raise exception 'DRAWIT_INVALID_STROKE';
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

  v_ops := coalesce(v_di->'eraseOpIds', '[]'::jsonb);
  if jsonb_typeof(v_ops) <> 'array' then
    v_ops := '[]'::jsonb;
  end if;
  if exists (
       select 1 from jsonb_array_elements_text(v_ops) x where x = v_op
     )
  then
    return v_row;
  end if;

  v_strokes := coalesce(v_di->'strokes', '[]'::jsonb);
  if jsonb_typeof(v_strokes) <> 'array' then
    return v_row;
  end if;

  for v_item in select value from jsonb_array_elements(p_replacements)
  loop
    v_src_id := trim(coalesce(v_item->>'sourceStrokeId', ''));
    if v_src_id = '' or length(v_src_id) > 128 then
      continue;
    end if;
    if v_src_id = any (v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_src_id);
    v_source_ids := array_append(v_source_ids, v_src_id);
    exit when coalesce(array_length(v_source_ids, 1), 0) >= 25;
  end loop;

  select coalesce(jsonb_agg(s.value order by s.ordinality), '[]'::jsonb)
  into v_sources
  from jsonb_array_elements(v_strokes) with ordinality as s(value, ordinality)
  where coalesce(s.value->>'strokeId', '') = any (coalesce(v_source_ids, '{}'));

  select count(*)::int
  into v_untouched
  from jsonb_array_elements(v_strokes) s
  where coalesce(s->>'strokeId', '') <> all (coalesce(v_source_ids, '{}'));
  v_budget := greatest(0, 25 - coalesce(v_untouched, 0));

  for v_src in
    select value from jsonb_array_elements(v_strokes) with ordinality as t(value, ordinality)
    order by ordinality
  loop
    v_src_id := coalesce(v_src->>'strokeId', '');
    if v_src_id <> all (coalesce(v_source_ids, '{}')) then
      if v_count < 25 then
        v_next := v_next || jsonb_build_array(v_src);
        v_count := v_count + 1;
      end if;
      continue;
    end if;

    v_repl := null;
    for v_item in select value from jsonb_array_elements(p_replacements)
    loop
      if trim(coalesce(v_item->>'sourceStrokeId', '')) = v_src_id then
        v_repl := v_item;
        exit;
      end if;
    end loop;

    if v_repl is null or jsonb_typeof(v_repl->'fragments') <> 'array' then
      continue;
    end if;

    v_added := 0;
    for v_frag in select value from jsonb_array_elements(v_repl->'fragments')
    loop
      if v_budget <= 0 then
        exit;
      end if;
      v_clean := public.drawit_sanitize_completed_stroke(
        jsonb_build_object(
          'strokeId', v_frag->>'strokeId',
          'seq', coalesce(v_src->'seq', v_frag->'seq'),
          'canvasEpoch', v_src->'canvasEpoch',
          'points', v_frag->'points',
          'color', v_src->>'color',
          'width', v_src->'width'
        )
      );
      if v_clean is null then
        continue;
      end if;
      v_next := v_next || jsonb_build_array(v_clean);
      v_repl_ids := v_repl_ids || jsonb_build_array(v_clean->>'strokeId');
      v_count := v_count + 1;
      v_budget := v_budget - 1;
      v_added := v_added + 1;
      exit when v_count >= 25;
    end loop;
  end loop;

  if v_next is not distinct from v_strokes then
    return v_row;
  end if;

  v_ops := coalesce(v_ops, '[]'::jsonb) || jsonb_build_array(v_op);
  if jsonb_array_length(v_ops) > 32 then
    select coalesce(jsonb_agg(value), '[]'::jsonb)
    into v_ops
    from (
      select value
      from jsonb_array_elements(v_ops) with ordinality as t(value, ordinality)
      order by ordinality desc
      limit 32
    ) last_ops;
  end if;

  v_di := v_di || jsonb_build_object(
    'strokes', coalesce(v_next, '[]'::jsonb),
    'eraseOpIds', v_ops,
    'editLog', public.drawit_edit_log_append(
      v_di->'editLog',
      jsonb_build_object(
        'kind', 'erase',
        'operationId', v_op,
        'canvasEpoch', p_canvas_epoch,
        'sourceStrokes', coalesce(v_sources, '[]'::jsonb),
        'replacementStrokeIds', coalesce(v_repl_ids, '[]'::jsonb),
        'undone', false
      ),
      p_canvas_epoch
    )
  );

  update public.game_sessions
  set state = jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt}', v_di, true)
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.erase_drawit_segments(uuid, text, integer, integer, text, jsonb) from public;
grant execute on function public.erase_drawit_segments(uuid, text, integer, integer, text, jsonb) to authenticated;

create or replace function public.undo_drawit_erase(
  p_lobby_id uuid,
  p_run_id text,
  p_round_idx integer,
  p_canvas_epoch integer,
  p_erase_operation_id text
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
  v_op text;
  v_log jsonb;
  v_entry jsonb;
  v_last jsonb;
  v_strokes jsonb;
  v_next jsonb := '[]'::jsonb;
  v_src jsonb;
  v_clean jsonb;
  v_remove text[] := '{}';
  v_count int := 0;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  v_uid_text := v_uid::text;
  perform public.assert_lobby_member(p_lobby_id);

  v_op := trim(coalesce(p_erase_operation_id, ''));
  if v_op = '' or length(v_op) > 64 then
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

  v_log := coalesce(v_di->'editLog', '[]'::jsonb);
  if jsonb_typeof(v_log) <> 'array' then
    v_log := '[]'::jsonb;
  end if;

  v_entry := null;
  for v_src in select value from jsonb_array_elements(v_log)
  loop
    if coalesce(v_src->>'kind', '') = 'erase'
       and coalesce(v_src->>'operationId', '') = v_op
    then
      v_entry := v_src;
    end if;
  end loop;

  if v_entry is null then
    raise exception 'DRAWIT_STALE_EPOCH';
  end if;
  if coalesce((v_entry->>'canvasEpoch')::int, -1) is distinct from p_canvas_epoch then
    raise exception 'DRAWIT_STALE_EPOCH';
  end if;
  if coalesce((v_entry->>'undone')::boolean, false) then
    return v_row;
  end if;

  select value
  into v_last
  from jsonb_array_elements(v_log) with ordinality as t(value, ordinality)
  where coalesce((value->>'canvasEpoch')::int, 0) = p_canvas_epoch
    and coalesce((value->>'undone')::boolean, false) is not true
  order by ordinality desc
  limit 1;

  if v_last is null
     or coalesce(v_last->>'kind', '') <> 'erase'
     or coalesce(v_last->>'operationId', '') is distinct from v_op
  then
    raise exception 'DRAWIT_NOT_LAST_EDIT';
  end if;

  select coalesce(array_agg(x), '{}')
  into v_remove
  from jsonb_array_elements_text(coalesce(v_entry->'replacementStrokeIds', '[]'::jsonb)) x;

  v_strokes := coalesce(v_di->'strokes', '[]'::jsonb);
  if jsonb_typeof(v_strokes) <> 'array' then
    v_strokes := '[]'::jsonb;
  end if;

  for v_src in
    select value from jsonb_array_elements(v_strokes) with ordinality as t(value, ordinality)
    order by ordinality
  loop
    if coalesce(v_src->>'strokeId', '') = any (coalesce(v_remove, '{}')) then
      continue;
    end if;
    if v_count < 25 then
      v_next := v_next || jsonb_build_array(v_src);
      v_count := v_count + 1;
    end if;
  end loop;

  for v_src in select value from jsonb_array_elements(coalesce(v_entry->'sourceStrokes', '[]'::jsonb))
  loop
    exit when v_count >= 25;
    v_clean := public.drawit_sanitize_completed_stroke(v_src);
    if v_clean is null then
      continue;
    end if;
    if exists (
         select 1 from jsonb_array_elements(v_next) s
         where s->>'strokeId' = v_clean->>'strokeId'
       )
    then
      continue;
    end if;
    v_next := v_next || jsonb_build_array(v_clean);
    v_count := v_count + 1;
  end loop;

  select coalesce(
           jsonb_agg(value order by coalesce((value->>'seq')::int, 0), ordinality),
           '[]'::jsonb
         )
  into v_next
  from jsonb_array_elements(coalesce(v_next, '[]'::jsonb)) with ordinality as t(value, ordinality);

  v_di := v_di || jsonb_build_object(
    'strokes', coalesce(v_next, '[]'::jsonb),
    'editLog', public.drawit_edit_log_append(
      v_log,
      v_entry || jsonb_build_object('undone', true),
      p_canvas_epoch
    )
  );

  update public.game_sessions
  set state = jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt}', v_di, true)
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.undo_drawit_erase(uuid, text, integer, integer, text) from public;
grant execute on function public.undo_drawit_erase(uuid, text, integer, integer, text) to authenticated;

notify pgrst, 'reload schema';
