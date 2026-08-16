-- FEATURE-DRAWIT-06 — gomme partielle vectorielle
--
-- RPC drawer-only, SECURITY DEFINER, SELECT … FOR UPDATE :
--   erase_drawit_segments — remplace des strokes ciblés par des fragments
--   restants. Pas de snapshot client complet de drawIt.strokes.
--
-- Paramètres :
--   p_lobby_id, p_run_id, p_round_idx, p_canvas_epoch,
--   p_operation_id text,
--   p_replacements jsonb  -- [{ sourceStrokeId, fragments: [stroke V1, ...] }]
--
-- Guards : auth.uid() vs drawerUid session, membre, game_id, lobbyStarted,
-- run / round / epoch / phase drawing.
-- Idempotence : p_operation_id déjà dans drawIt.eraseOpIds → no-op.
-- Stroke source absent : ignoré (retry / déjà appliqué).
-- Metadata color/width/epoch copiées depuis le stroke source, pas le client.
-- Cap 25 strokes / 80 points (sanitize V1).
--
-- QA : appliquer après 02, 03, 04 et 05.
-- Ce fichier NE doit PAS être appliqué automatiquement par le client.

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
    'eraseOpIds', v_ops
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

notify pgrst, 'reload schema';
