-- FEATURE-DRAWIT-05 — gomme : suppression atomique de strokes par ids
--
-- RPC drawer-only, SECURITY DEFINER, SELECT … FOR UPDATE :
--   erase_drawit_strokes — retire les strokeId fournis s'ils existent
--   dans le round / run / epoch courants.
--
-- Le serveur ne fait pas confiance à drawerUid client.
-- Les ids absents sont ignorés (idempotent).
-- Pas de remplacement générique du tableau strokes.
--
-- QA : appliquer après 02, 03 et 04.
-- Ce fichier NE doit PAS être appliqué automatiquement par le client.

create or replace function public.erase_drawit_strokes(
  p_lobby_id uuid,
  p_run_id text,
  p_round_idx integer,
  p_canvas_epoch integer,
  p_stroke_ids jsonb
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
  v_next jsonb;
  v_ids text[] := '{}';
  v_raw text;
  v_item jsonb;
  v_seen text[] := '{}';
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
  if p_stroke_ids is null or jsonb_typeof(p_stroke_ids) <> 'array' then
    raise exception 'DRAWIT_INVALID_STROKE';
  end if;

  for v_item in select value from jsonb_array_elements(p_stroke_ids)
  loop
    if jsonb_typeof(v_item) = 'string' then
      v_raw := trim(v_item #>> '{}');
    else
      v_raw := trim(coalesce(v_item->>'strokeId', v_item #>> '{}', ''));
    end if;
    if v_raw = '' or length(v_raw) > 128 then
      continue;
    end if;
    if v_raw = any (v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_raw);
    v_ids := array_append(v_ids, v_raw);
    exit when coalesce(array_length(v_ids, 1), 0) >= 25;
  end loop;

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

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return v_row;
  end if;

  v_strokes := coalesce(v_di->'strokes', '[]'::jsonb);
  if jsonb_typeof(v_strokes) <> 'array' then
    return v_row;
  end if;

  select coalesce(jsonb_agg(s order by ordinality), '[]'::jsonb)
  into v_next
  from jsonb_array_elements(v_strokes) with ordinality as t(s, ordinality)
  where coalesce(s->>'strokeId', '') <> all (v_ids);

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

revoke all on function public.erase_drawit_strokes(uuid, text, integer, integer, jsonb) from public;
grant execute on function public.erase_drawit_strokes(uuid, text, integer, integer, jsonb) to authenticated;

notify pgrst, 'reload schema';
