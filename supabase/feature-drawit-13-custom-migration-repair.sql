-- =============================================================================
-- FEATURE-DRAWIT-13 — repair customs : authorUid legacy + complete acting host
--
-- Ordre d'application :
--   02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 13
--
-- SQL 10 est considérée comme déjà appliquée : NE PAS la réécrire.
-- Cette migration est idempotente et sûre sur une base déjà migrée par 10.
--
-- 1) Customs legacy sans authorUid UUID
--    SQL 10 copiait uniquement les UUID valides puis retirait TOUS les textes
--    publics, d'où une perte silencieuse possible.
--    Ici :
--      - UUID valide + texte encore présent → table privée, méta publique sans texte
--      - authorUid absent/invalide + texte encore présent
--          → quarantaine drawit_custom_words_unassigned (pas d'attribution)
--          → retiré du blob public (non jouable, texte conservé)
--      - méta publique sans texte, sans ligne privée, sans UUID
--          → ghost SQL 10, texte déjà irrécupérable : retrait explicite du public
--            pour ne pas bloquer le launch fail-closed
--    On n'invente JAMAIS un authorUid.
--
-- 2) complete_game_session_as_actor
--    Draw it entre dans v_game_keys :
--      lobbyStarted = false, customWords = [], ready = {}
--      DELETE drawit_custom_words pour le lobby
--    Les autres jeux gardent le contrat CLEANUP-FILROUGE-02.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quarantaine : textes legacy sans propriétaire UUID fiable
-- RLS activée, aucune policy SELECT/INSERT client → lecture via postgres / definer.
-- -----------------------------------------------------------------------------
create table if not exists public.drawit_custom_words_unassigned (
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  entry_id text not null,
  word_text text not null,
  author_name text,
  raw_author_uid text,
  created_at timestamptz not null default now(),
  primary key (lobby_id, entry_id)
);

alter table public.drawit_custom_words_unassigned enable row level security;

drop policy if exists "drawit_custom_words_unassigned_no_client" on public.drawit_custom_words_unassigned;

-- Copier les textes encore présents sans UUID valide (idempotent).
insert into public.drawit_custom_words_unassigned (
  lobby_id, entry_id, word_text, author_name, raw_author_uid
)
select
  gs.lobby_id,
  e.elem ->> 'id',
  left(trim(e.elem ->> 'text'), 160),
  nullif(trim(e.elem ->> 'author'), ''),
  nullif(trim(e.elem ->> 'authorUid'), '')
from public.game_sessions gs
cross join lateral jsonb_array_elements(
  coalesce(gs.state -> 'drawIt' -> 'customWords', '[]'::jsonb)
) as e(elem)
where jsonb_typeof(gs.state -> 'drawIt' -> 'customWords') = 'array'
  and coalesce(e.elem ->> 'id', '') <> ''
  and coalesce(e.elem ->> 'text', '') <> ''
  and coalesce(e.elem ->> 'authorUid', '') !~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict (lobby_id, entry_id) do update
  set word_text = excluded.word_text,
      author_name = excluded.author_name,
      raw_author_uid = excluded.raw_author_uid;

-- Compléter la table privée si un texte public UUID a survécu à SQL 10.
insert into public.drawit_custom_words (lobby_id, entry_id, user_id, word_text)
select
  gs.lobby_id,
  e.elem ->> 'id',
  (e.elem ->> 'authorUid')::uuid,
  left(trim(e.elem ->> 'text'), 160)
from public.game_sessions gs
cross join lateral jsonb_array_elements(
  coalesce(gs.state -> 'drawIt' -> 'customWords', '[]'::jsonb)
) as e(elem)
where jsonb_typeof(gs.state -> 'drawIt' -> 'customWords') = 'array'
  and coalesce(e.elem ->> 'id', '') <> ''
  and coalesce(e.elem ->> 'text', '') <> ''
  and coalesce(e.elem ->> 'authorUid', '') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict (lobby_id, entry_id) do nothing;

-- Reconstruire le blob public : méta uniquement, jamais de texte.
-- Conservé : id avec UUID valide, ou ligne privée correspondante.
-- Retiré : quarantaine (texte ailleurs) et ghosts sans texte ni privé.
update public.game_sessions gs
set state = jsonb_set(
  gs.state,
  '{drawIt,customWords}',
  coalesce((
    select jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'id', e.elem ->> 'id',
          'author', e.elem ->> 'author',
          'authorUid', e.elem ->> 'authorUid'
        )
      )
    )
    from jsonb_array_elements(
      coalesce(gs.state -> 'drawIt' -> 'customWords', '[]'::jsonb)
    ) as e(elem)
    where coalesce(e.elem ->> 'id', '') <> ''
      and (
        coalesce(e.elem ->> 'authorUid', '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or exists (
          select 1 from public.drawit_custom_words w
          where w.lobby_id = gs.lobby_id and w.entry_id = e.elem ->> 'id'
        )
      )
  ), '[]'::jsonb),
  true
)
where jsonb_typeof(gs.state -> 'drawIt' -> 'customWords') = 'array';

-- -----------------------------------------------------------------------------
-- complete_game_session_as_actor — + drawIt (contrat CLEANUP-FILROUGE-02 conservé)
-- -----------------------------------------------------------------------------
create or replace function public.complete_game_session_as_actor(
  p_lobby_id uuid,
  p_screen text default 'results'
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_host_id uuid;
  v_row public.game_sessions;
  v_state jsonb;
  v_key text;
  v_game_keys text[] := array[
    'hotTake','speedVote','clutch','wrongAnswer','traitre','trivia','consensus',
    'dilemma','truthMeter','guessLie','tierNight','tierNightLive','drawIt'
  ];
  v_blob jsonb;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Clôture réservée à l''hôte ou à l''acting host.';
  end if;

  if p_screen is null or p_screen not in ('results','leaderboard','game-select','tiernight-end') then
    raise exception 'Écran de clôture non autorisé.';
  end if;

  select host_id into v_host_id from public.lobbies where id = p_lobby_id;
  if v_host_id is null then
    raise exception 'Lobby introuvable.';
  end if;

  update public.lobbies
  set status = 'playing',
      game_id = 'menu'
  where id = p_lobby_id;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  v_state := coalesce(v_row.state, '{}'::jsonb);

  foreach v_key in array v_game_keys
  loop
    v_blob := v_state -> v_key;
    if v_blob is not null and jsonb_typeof(v_blob) = 'object' then
      v_blob := v_blob || jsonb_build_object('lobbyStarted', false);
      if v_key = 'guessLie' then
        v_blob := v_blob || jsonb_build_object('lobbyComplete', false);
      end if;
      if v_key in ('tierNight','tierNightLive') then
        v_blob := v_blob || jsonb_build_object('finished', true);
      end if;
      if v_key = 'drawIt' then
        v_blob := v_blob || jsonb_build_object(
          'customWords', '[]'::jsonb,
          'ready', '{}'::jsonb
        );
      end if;
      v_state := jsonb_set(v_state, array[v_key], v_blob, true);
    end if;
  end loop;

  if to_regclass('public.drawit_custom_words') is not null then
    delete from public.drawit_custom_words where lobby_id = p_lobby_id;
  end if;
  if to_regclass('public.drawit_custom_words_unassigned') is not null then
    delete from public.drawit_custom_words_unassigned where lobby_id = p_lobby_id;
  end if;

  update public.game_sessions gs
  set game_id = 'menu',
      screen = p_screen,
      host_id = v_host_id,
      state = v_state
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.complete_game_session_as_actor(uuid, text) from public;
revoke all on function public.complete_game_session_as_actor(uuid, text) from anon;
grant execute on function public.complete_game_session_as_actor(uuid, text) to authenticated;

-- Host complete / restart : même contrat (privés + quarantaine).
create or replace function public.clear_drawit_custom_words(p_lobby_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;
  delete from public.drawit_custom_words where lobby_id = p_lobby_id;
  if to_regclass('public.drawit_custom_words_unassigned') is not null then
    delete from public.drawit_custom_words_unassigned where lobby_id = p_lobby_id;
  end if;
end;
$$;

revoke all on function public.clear_drawit_custom_words(uuid) from public;
revoke all on function public.clear_drawit_custom_words(uuid) from anon;
grant execute on function public.clear_drawit_custom_words(uuid) to authenticated;
