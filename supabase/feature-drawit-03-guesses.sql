-- FEATURE-DRAWIT-03 — guesses atomiques + foundOrder (T5)
--
-- RPC submit_drawit_guess :
--   - SELECT game_sessions … FOR UPDATE (anti lost-update)
--   - valide contre drawit_private (jamais le mot dans le payload client)
--   - foundOrder = ordre d'acceptation serveur (clock_timestamp)
--   - le dernier devineur correct passe atomiquement phase à reveal
--   - ne modifie jamais roundEndsAt
--
-- Normalisation : miroir de js/core/drawItNormalize.js
--   trim, lowercase, accents FR/EN, apostrophes, ponctuation, espaces.
--   Pas de fuzzy / Levenshtein.
--
-- QA MP : 01b (ready) ne suffit PAS. Appliquer aussi :
--   feature-drawit-02-private-word.sql
--   ce fichier (submit_drawit_guess).
-- Sans 03, le client appelle une RPC inexistante → feed vide.
--
-- Ce fichier NE doit PAS être appliqué automatiquement par le client.

create or replace function public.normalize_drawit_guess(p_raw text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select trim(both from regexp_replace(
    regexp_replace(
      lower(
        replace(
          replace(
            replace(
              replace(
                translate(
                  coalesce(p_raw, ''),
                  'ÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝŸÑÇàáâãäåèéêëìíîïòóôõöùúûüýÿñç''`´‘’',
                  'AAAAAAEEEEIIIIOOOOOUUUUYYNCaaaaaaeeeeiiiiooooouuuuyync'
                ),
                'Œ',
                'oe'
              ),
              'œ',
              'oe'
            ),
            'Æ',
            'ae'
          ),
          'æ',
          'ae'
        )
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    ),
    '\s+',
    ' ',
    'g'
  ));
$$;

revoke all on function public.normalize_drawit_guess(text) from public;
grant execute on function public.normalize_drawit_guess(text) to authenticated;

create or replace function public.submit_drawit_guess(
  p_lobby_id uuid,
  p_run_id text,
  p_round_idx integer,
  p_value text
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
  v_phase text;
  v_ends timestamptz;
  v_run text;
  v_idx int;
  v_drawer text;
  v_norm text;
  v_trimmed text;
  v_correct boolean := false;
  v_at timestamptz;
  v_found jsonb;
  v_guesses jsonb;
  v_priv record;
  v_answer text;
  v_order jsonb;
  v_in_party boolean := false;
  v_all_found boolean := false;
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

  v_trimmed := trim(both from coalesce(p_value, ''));
  if length(v_trimmed) = 0 then
    raise exception 'DRAWIT_EMPTY_GUESS';
  end if;
  if length(v_trimmed) > 200 then
    raise exception 'DRAWIT_GUESS_TOO_LONG';
  end if;
  v_norm := public.normalize_drawit_guess(v_trimmed);
  if v_norm is null or length(v_norm) = 0 then
    raise exception 'DRAWIT_EMPTY_GUESS';
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
  if jsonb_typeof(v_di) <> 'object' then
    raise exception 'DRAWIT_NO_SESSION';
  end if;

  if coalesce((v_di->>'lobbyStarted')::boolean, false) is not true then
    raise exception 'DRAWIT_NO_SESSION';
  end if;

  v_run := v_di->>'runId';
  if v_run is distinct from trim(p_run_id) then
    raise exception 'DRAWIT_STALE_RUN';
  end if;

  v_idx := coalesce((v_di->>'roundIdx')::int, -1);
  if v_idx is distinct from p_round_idx then
    raise exception 'DRAWIT_STALE_ROUND';
  end if;

  v_phase := coalesce(v_di->>'phase', '');
  if v_phase <> 'drawing' then
    raise exception 'DRAWIT_NOT_DRAWING';
  end if;

  -- Instant d'acceptation pris sous FOR UPDATE : deadline et ordre cohérents.
  v_at := clock_timestamp();
  v_ends := (v_di->>'roundEndsAt')::timestamptz;
  if v_ends is null or v_at >= v_ends then
    raise exception 'DRAWIT_EXPIRED';
  end if;

  v_order := coalesce(v_di->'drawerOrder', '[]'::jsonb);
  if jsonb_typeof(v_order) = 'array' then
    select exists (
      select 1
      from jsonb_array_elements_text(v_order) t
      where t = v_uid_text
    ) into v_in_party;
  end if;
  if not v_in_party then
    raise exception 'DRAWIT_NOT_IN_PARTY';
  end if;

  v_drawer := coalesce(v_di->>'drawerUid', '');
  if v_drawer = v_uid_text then
    raise exception 'DRAWIT_DRAWER';
  end if;

  v_found := coalesce(v_di->'foundOrder', '[]'::jsonb);
  if jsonb_typeof(v_found) <> 'array' then
    v_found := '[]'::jsonb;
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_found) e
    where e->>'uid' = v_uid_text
  ) then
    raise exception 'DRAWIT_ALREADY_FOUND';
  end if;

  select word_label, accepted_answers
    into v_priv
  from public.drawit_private
  where lobby_id = p_lobby_id
    and run_id = v_run
    and round_idx = v_idx;

  if not found then
    raise exception 'DRAWIT_NO_WORD';
  end if;

  if public.normalize_drawit_guess(v_priv.word_label) = v_norm then
    v_correct := true;
  elsif jsonb_typeof(v_priv.accepted_answers) = 'array' then
    for v_answer in
      select value
      from jsonb_array_elements_text(v_priv.accepted_answers)
    loop
      if public.normalize_drawit_guess(v_answer) = v_norm then
        v_correct := true;
        exit;
      end if;
    end loop;
  end if;

  v_guesses := coalesce(v_di->'guesses', '[]'::jsonb);
  if jsonb_typeof(v_guesses) <> 'array' then
    v_guesses := '[]'::jsonb;
  end if;
  v_guesses := v_guesses || jsonb_build_array(
    jsonb_build_object(
      'uid', v_uid_text,
      -- Ne jamais publier le mot correct tant que la phase était drawing.
      'value', case when v_correct then '' else v_trimmed end,
      'at', to_jsonb(v_at),
      'correct', v_correct
    )
  );
  if jsonb_array_length(v_guesses) > 20 then
    select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
      into v_guesses
    from (
      select elem, ord
      from jsonb_array_elements(v_guesses) with ordinality as t(elem, ord)
      order by ord desc
      limit 20
    ) kept;
  end if;

  if v_correct then
    v_found := v_found || jsonb_build_array(
      jsonb_build_object(
        'uid', v_uid_text,
        'at', to_jsonb(v_at)
      )
    );
  end if;

  v_di := v_di || jsonb_build_object(
    'foundOrder', v_found,
    'guesses', v_guesses
  );

  if v_correct then
    v_all_found := public.drawit_all_guessers_found(v_di);
  end if;

  if v_all_found then
    v_di := public.drawit_revealed_state(v_di, v_priv.word_label);
  end if;

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

revoke all on function public.submit_drawit_guess(uuid, text, integer, text) from public;
grant execute on function public.submit_drawit_guess(uuid, text, integer, text) to authenticated;
