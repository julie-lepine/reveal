-- FEATURE-DRAWIT-02 — mot privé Draw it ! (T4)
--
-- Table dédiée : NE PAS réutiliser traitre_private
--   (unique(lobby_id, user_id) collisionnerait ; schéma rôle ≠ mot).
--
-- Invariants :
--   - SELECT client : uniquement le drawer de la manche PUBLIQUE courante
--   - le mot n'est jamais dans game_sessions pendant phase = drawing
--   - reveal_drawit_round (SECURITY DEFINER) publie wordLabel dans lastRound
--     si now >= roundEndsAt OU si tous les devineurs figés ont trouvé
--
-- Ce fichier NE doit PAS être appliqué automatiquement par le client.

create table if not exists public.drawit_private (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  run_id text not null,
  round_idx int not null,
  drawer_uid uuid not null references auth.users(id) on delete cascade,
  word_label text not null,
  accepted_answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lobby_id, run_id, round_idx)
);

create index if not exists drawit_private_lobby_run_idx
  on public.drawit_private (lobby_id, run_id);

drop trigger if exists drawit_private_updated_at on public.drawit_private;
create trigger drawit_private_updated_at
before update on public.drawit_private
for each row execute function public.set_updated_at();

alter table public.drawit_private enable row level security;

drop policy if exists "drawit_private_select_drawer_current" on public.drawit_private;
create policy "drawit_private_select_drawer_current" on public.drawit_private
for select using (
  drawer_uid = auth.uid()
  and exists (
    select 1
    from public.game_sessions gs
    where gs.lobby_id = drawit_private.lobby_id
      and coalesce((gs.state->'drawIt'->>'roundIdx')::int, -1) = drawit_private.round_idx
      and coalesce(gs.state->'drawIt'->>'phase', '') = 'drawing'
      and coalesce(gs.state->'drawIt'->>'runId', '') = drawit_private.run_id
  )
);

drop policy if exists "drawit_private_insert_host" on public.drawit_private;
create policy "drawit_private_insert_host" on public.drawit_private
for insert with check (
  public.is_lobby_host(lobby_id)
  or public.is_acting_host(lobby_id)
);

drop policy if exists "drawit_private_update_host" on public.drawit_private;
create policy "drawit_private_update_host" on public.drawit_private
for update using (
  public.is_lobby_host(lobby_id)
  or public.is_acting_host(lobby_id)
);

drop policy if exists "drawit_private_delete_host" on public.drawit_private;
create policy "drawit_private_delete_host" on public.drawit_private
for delete using (
  public.is_lobby_host(lobby_id)
  or public.is_acting_host(lobby_id)
);

-- ---------------------------------------------------------------------------
-- write_drawit_private_rounds — hôte / acting host pose les mots (pas de SELECT invité)
-- ---------------------------------------------------------------------------

create or replace function public.write_drawit_private_rounds(
  p_lobby_id uuid,
  p_run_id text,
  p_rounds jsonb
)
returns int
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_written int := 0;
  v_item jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;
  if p_run_id is null or length(trim(p_run_id)) = 0 then
    raise exception 'run_id requis.';
  end if;
  if p_rounds is null or jsonb_typeof(p_rounds) <> 'array' then
    raise exception 'rounds tableau requis.';
  end if;

  for v_item in select value from jsonb_array_elements(p_rounds)
  loop
    insert into public.drawit_private (
      lobby_id, run_id, round_idx, drawer_uid, word_label, accepted_answers
    )
    values (
      p_lobby_id,
      trim(p_run_id),
      (v_item->>'roundIdx')::int,
      (v_item->>'drawerUid')::uuid,
      v_item->>'wordLabel',
      coalesce(v_item->'acceptedAnswers', '[]'::jsonb)
    )
    on conflict (lobby_id, run_id, round_idx) do update
      set drawer_uid = excluded.drawer_uid,
          word_label = excluded.word_label,
          accepted_answers = excluded.accepted_answers,
          updated_at = now();
    v_written := v_written + 1;
  end loop;

  return v_written;
end;
$$;

revoke all on function public.write_drawit_private_rounds(uuid, text, jsonb) from public;
grant execute on function public.write_drawit_private_rounds(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- launch_drawit_game — mots privés + manche 1 publique dans une transaction.
-- Le timer ne démarre qu'après l'écriture des mots, à l'instant serveur du commit.
-- ---------------------------------------------------------------------------

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
     or (p_drawit->'drawerOrder'->>0) is distinct from v_drawer
  then
    raise exception 'DRAWIT_INVALID_LAUNCH';
  end if;
  if p_drawit ?| array['wordId','wordLabel','deck','words','acceptedAnswers'] then
    raise exception 'DRAWIT_PUBLIC_SECRET';
  end if;

  -- Même transaction : aucun état drawing n'est visible avant que les mots existent.
  perform public.write_drawit_private_rounds(p_lobby_id, v_run, p_rounds);

  v_start := clock_timestamp();
  v_end := v_start + interval '60 seconds';
  v_di := (p_drawit - 'roundStartAt' - 'roundEndsAt')
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
grant execute on function public.launch_drawit_game(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- drawit_all_guessers_found — participants figés moins drawerUid.
-- Repli drawerOrder uniquement pour les anciennes sessions sans participants.
-- ---------------------------------------------------------------------------

create or replace function public.drawit_all_guessers_found(p_drawit jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_drawer text := coalesce(p_drawit->>'drawerUid', '');
  v_participants jsonb := coalesce(p_drawit->'participants', '[]'::jsonb);
  v_order jsonb := coalesce(p_drawit->'drawerOrder', '[]'::jsonb);
  v_found jsonb := coalesce(p_drawit->'foundOrder', '[]'::jsonb);
  v_expected_count int := 0;
  v_all_found boolean := false;
begin
  if jsonb_typeof(v_found) <> 'array' then
    v_found := '[]'::jsonb;
  end if;

  if jsonb_typeof(v_participants) = 'array' then
    select count(distinct p->>'userId')
      into v_expected_count
    from jsonb_array_elements(v_participants) p
    where length(trim(coalesce(p->>'userId', ''))) > 0
      and p->>'userId' is distinct from v_drawer;

    if v_expected_count > 0 then
      select not exists (
        select 1
        from (
          select distinct p->>'userId' as uid
          from jsonb_array_elements(v_participants) p
          where length(trim(coalesce(p->>'userId', ''))) > 0
            and p->>'userId' is distinct from v_drawer
        ) expected
        where not exists (
          select 1
          from jsonb_array_elements(v_found) f
          where f->>'uid' = expected.uid
        )
      ) into v_all_found;
      return v_all_found;
    end if;
  end if;

  if jsonb_typeof(v_order) <> 'array' then
    return false;
  end if;

  select count(distinct uid)
    into v_expected_count
  from jsonb_array_elements_text(v_order) as t(uid)
  where length(trim(uid)) > 0
    and uid is distinct from v_drawer;

  if v_expected_count < 1 then
    return false;
  end if;

  select not exists (
    select 1
    from (
      select distinct uid
      from jsonb_array_elements_text(v_order) as t(uid)
      where length(trim(uid)) > 0
        and uid is distinct from v_drawer
    ) expected
    where not exists (
      select 1
      from jsonb_array_elements(v_found) f
      where f->>'uid' = expected.uid
    )
  ) into v_all_found;

  return v_all_found;
end;
$$;

revoke all on function public.drawit_all_guessers_found(jsonb) from public;

-- ---------------------------------------------------------------------------
-- drawit_revealed_state — unique construction de l'état public de reveal.
-- Utilisée par le timeout acting-host ET par le dernier guess correct.
-- ---------------------------------------------------------------------------

create or replace function public.drawit_revealed_state(
  p_drawit jsonb,
  p_word_label text
)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(p_drawit, '{}'::jsonb) || jsonb_build_object(
    'phase', 'reveal',
    'roundScored', true,
    'lastRound', jsonb_build_object(
      'roundIdx', coalesce((p_drawit->>'roundIdx')::int, 0),
      'drawerUid', p_drawit->>'drawerUid',
      'wordLabel', coalesce(p_word_label, ''),
      'foundOrder', coalesce(p_drawit->'foundOrder', '[]'::jsonb)
    )
  );
$$;

revoke all on function public.drawit_revealed_state(jsonb, text) from public;

-- ---------------------------------------------------------------------------
-- reveal_drawit_round — drawing → reveal sur timeout OU tous trouvés.
-- Publie lastRound.wordLabel. Idempotent si déjà reveal.
-- ---------------------------------------------------------------------------

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
    and round_idx = v_idx
    and drawer_uid::text = coalesce(v_di->>'drawerUid', '');

  if not found then
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
grant execute on function public.reveal_drawit_round(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- advance_drawit_round — reveal → manche suivante (pas de mot public)
-- ---------------------------------------------------------------------------

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
  v_len int;
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
  if jsonb_typeof(v_order) <> 'array' then
    raise exception 'drawerOrder invalide.';
  end if;
  v_len := jsonb_array_length(v_order);
  if v_len < 1 then
    raise exception 'drawerOrder manquant.';
  end if;
  v_drawer := v_order ->> (v_next % v_len);
  if v_drawer is null or length(trim(v_drawer)) = 0 then
    raise exception 'drawerUid suivant invalide.';
  end if;
  -- Un seul instant serveur, pris sous verrou, définit toute la nouvelle manche.
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
      'strokeSeq', 0
    );

  update public.game_sessions
  set state = jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt}', v_next_di, true)
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.advance_drawit_round(uuid) from public;
grant execute on function public.advance_drawit_round(uuid) to authenticated;
