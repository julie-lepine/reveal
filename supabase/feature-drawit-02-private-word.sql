-- FEATURE-DRAWIT-02 — mot privé Draw it ! (T4)
--
-- Table dédiée : NE PAS réutiliser traitre_private
--   (unique(lobby_id, user_id) collisionnerait ; schéma rôle ≠ mot).
--
-- Invariants :
--   - SELECT client : uniquement le drawer de la manche PUBLIQUE courante
--   - le mot n'est jamais dans game_sessions pendant phase = drawing
--   - reveal_drawit_round (SECURITY DEFINER) publie wordLabel dans lastRound
--     uniquement si now >= roundEndsAt
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
-- reveal_drawit_round — drawing → reveal uniquement si now >= roundEndsAt
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
  v_last jsonb;
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

  v_di := coalesce(v_row.state->'drawIt', '{}'::jsonb);
  v_phase := coalesce(v_di->>'phase', '');

  if v_phase = 'reveal' then
    return v_row;
  end if;

  if v_phase <> 'drawing' then
    raise exception 'Reveal Draw it ! uniquement depuis drawing.';
  end if;

  v_ends := (v_di->>'roundEndsAt')::timestamptz;
  if v_ends is null or clock_timestamp() < v_ends then
    raise exception 'Reveal Draw it ! trop tôt.';
  end if;

  v_run := v_di->>'runId';
  v_idx := coalesce((v_di->>'roundIdx')::int, 0);

  select word_label into v_word
  from public.drawit_private
  where lobby_id = p_lobby_id
    and run_id = v_run
    and round_idx = v_idx;

  v_last := jsonb_build_object(
    'roundIdx', v_idx,
    'drawerUid', v_di->>'drawerUid',
    'wordLabel', coalesce(v_word, ''),
    'foundOrder', coalesce(v_di->'foundOrder', '[]'::jsonb)
  );

  update public.game_sessions
  set state = jsonb_set(
        jsonb_set(
          jsonb_set(coalesce(state, '{}'::jsonb), '{drawIt,phase}', '"reveal"'::jsonb, true),
          '{drawIt,roundScored}',
          'true'::jsonb,
          true
        ),
        '{drawIt,lastRound}',
        v_last,
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
  v_start timestamptz := clock_timestamp();
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

  v_di := coalesce(v_row.state->'drawIt', '{}'::jsonb);
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
  v_len := jsonb_array_length(v_order);
  if v_len < 1 then
    raise exception 'drawerOrder manquant.';
  end if;
  v_drawer := v_order ->> (v_next % v_len);
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
