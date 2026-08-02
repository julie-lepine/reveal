-- =============================================================================
-- BUG-LOBBY-XX-E — Tombstones de fermeture de lobby (raison persistante)
--
-- Remplace (CREATE OR REPLACE) les fonctions :
--   public.dissolve_lobby_atomically(uuid)
--     définie historiquement dans lobby-membership-e5-01-dissolve-lobby-atomically.sql
--   public.purge_stale_lobbies()
--     définie historiquement dans lobby-lifecycle.sql
--
-- APRÈS cette migration : ne pas réexécuter E5-01 ni lobby-lifecycle.sql en entier
-- (recréerait une purge/dissolve sans tombstones). Réappliquer uniquement CE fichier
-- pour corriger dissolve/purge/closures.
--
-- Prérequis : schema lobbies + lobby-lifecycle (colonnes) + E5 dissolve déjà en prod.
-- Ordre : après OPS-LOBBY-04 (cron peut rester actif ; corps purge mis à jour ici).
--
-- Rétention tombstones : 14 jours (purge_old_lobby_closures, appelée en fin de
-- purge_stale_lobbies — ne change PAS les critères CTE doomed).
-- =============================================================================

-- ── Table ───────────────────────────────────────────────────────────────────

create table if not exists public.lobby_closures (
  lobby_id uuid primary key,
  reason text not null,
  closed_at timestamptz not null default now(),
  closed_by_uid uuid null,
  constraint lobby_closures_reason_check
    check (reason in ('host_closed', 'inactive_expired')),
  constraint lobby_closures_host_uid_check
    check (
      (reason = 'host_closed' and closed_by_uid is not null)
      or (reason = 'inactive_expired' and closed_by_uid is null)
    )
);

comment on table public.lobby_closures is
  'BUG-LOBBY-XX-E — tombstone post-DELETE lobbies. Pas de FK vers lobbies '
  '(doit survivre à la suppression). Raison canonique = premier INSERT.';

comment on column public.lobby_closures.reason is
  'host_closed | inactive_expired — immutable après INSERT (ON CONFLICT DO NOTHING).';

create index if not exists lobby_closures_closed_at_idx
  on public.lobby_closures (closed_at);

alter table public.lobby_closures enable row level security;

-- Pas de policy SELECT/INSERT pour authenticated : accès via RPC uniquement.
revoke all on table public.lobby_closures from public;
revoke all on table public.lobby_closures from anon;
revoke all on table public.lobby_closures from authenticated;
grant all on table public.lobby_closures to service_role;

-- ── Lecture RPC ─────────────────────────────────────────────────────────────
-- Modèle de menace : lobby_id UUID est un secret de capacité (déjà mémorisé
-- côté client pendant la session). Métadonnées non sensibles (raison + horodatage).
-- Membership CASCADE déjà absente → pas de jointure lobby_members.
-- Auth : JWT authenticated (y compris invité anonymisé Supabase).

create or replace function public.get_lobby_closure(p_lobby_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.lobby_closures%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object(
      'found', false,
      'lobby_id', p_lobby_id,
      'error', 'UNAUTHENTICATED'
    );
  end if;

  if p_lobby_id is null then
    return jsonb_build_object(
      'found', false,
      'lobby_id', null
    );
  end if;

  select * into v_row
  from public.lobby_closures c
  where c.lobby_id = p_lobby_id;

  if not found then
    return jsonb_build_object(
      'found', false,
      'lobby_id', p_lobby_id
    );
  end if;

  return jsonb_build_object(
    'found', true,
    'lobby_id', v_row.lobby_id,
    'reason', v_row.reason,
    'closed_at', v_row.closed_at,
    'closed_by_uid', v_row.closed_by_uid
  );
end;
$function$;

comment on function public.get_lobby_closure(uuid) is
  'BUG-LOBBY-XX-E — lit un tombstone de fermeture. found true|false. '
  'Pas de données sensibles. SECURITY DEFINER + search_path public.';

revoke all on function public.get_lobby_closure(uuid) from public;
revoke all on function public.get_lobby_closure(uuid) from anon;
grant execute on function public.get_lobby_closure(uuid) to authenticated;
grant execute on function public.get_lobby_closure(uuid) to service_role;

-- ── Rétention ───────────────────────────────────────────────────────────────

create or replace function public.purge_old_lobby_closures()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  deleted_count integer;
begin
  delete from public.lobby_closures
  where closed_at < now() - interval '14 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$function$;

comment on function public.purge_old_lobby_closures() is
  'BUG-LOBBY-XX-E — rétention 14 j (reconnexion tardive / lendemain). '
  'Appelée en fin de purge_stale_lobbies ; n''altère pas les critères lobby.';

revoke all on function public.purge_old_lobby_closures() from public;
revoke all on function public.purge_old_lobby_closures() from anon;
revoke all on function public.purge_old_lobby_closures() from authenticated;
grant execute on function public.purge_old_lobby_closures() to service_role;

-- ── dissolve_lobby_atomically (remplace E5-01) ───────────────────────────────
-- Conflit de raison : INSERT ON CONFLICT DO NOTHING → première raison canonique.
-- Pas de tombstone host_closed si l''hôte n''a pas réellement DELETE le lobby.

create or replace function public.dissolve_lobby_atomically(p_lobby_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid;
  v_host_id uuid;
  v_deleted_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return jsonb_build_object(
      'status', 'UNAUTHENTICATED',
      'lobby_id', p_lobby_id
    );
  end if;

  if p_lobby_id is null then
    return jsonb_build_object(
      'status', 'ALREADY_GONE',
      'lobby_id', null
    );
  end if;

  select l.host_id into v_host_id
  from public.lobbies as l
  where l.id = p_lobby_id
  for update;

  if not found then
    return jsonb_build_object(
      'status', 'ALREADY_GONE',
      'lobby_id', p_lobby_id
    );
  end if;

  if v_host_id is distinct from v_uid then
    return jsonb_build_object(
      'status', 'NOT_ALLOWED',
      'lobby_id', p_lobby_id
    );
  end if;

  delete from public.lobbies as l
  where l.id = p_lobby_id
    and l.host_id = v_uid
  returning l.id into v_deleted_id;

  if v_deleted_id is null then
    return jsonb_build_object(
      'status', 'ALREADY_GONE',
      'lobby_id', p_lobby_id
    );
  end if;

  -- Même transaction que le DELETE : tombstone seulement si suppression réelle.
  -- ON CONFLICT DO NOTHING → première raison canonique (pas d'écrasement).
  insert into public.lobby_closures (lobby_id, reason, closed_at, closed_by_uid)
  values (v_deleted_id, 'host_closed', now(), v_uid)
  on conflict (lobby_id) do nothing;

  return jsonb_build_object(
    'status', 'DISSOLVED',
    'lobby_id', v_deleted_id
  );
end;
$function$;

comment on function public.dissolve_lobby_atomically(uuid) is
  'E5 + BUG-LOBBY-XX-E — dissolution hôte atomique + tombstone host_closed '
  'uniquement si DELETE réussi. DISSOLVED | ALREADY_GONE | NOT_ALLOWED | UNAUTHENTICATED. '
  'ON CONFLICT DO NOTHING : première raison persistée reste canonique.';

revoke all on function public.dissolve_lobby_atomically(uuid) from public;
revoke all on function public.dissolve_lobby_atomically(uuid) from anon;
grant execute on function public.dissolve_lobby_atomically(uuid) to authenticated;
grant execute on function public.dissolve_lobby_atomically(uuid) to service_role;

-- ── purge_stale_lobbies (remplace lobby-lifecycle) ───────────────────────────
-- Seuils CTE doomed INCHANGÉS. Tombstones liés aux lignes réellement DELETE.

create or replace function public.purge_stale_lobbies()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  deleted_ids uuid[];
  deleted_count integer;
begin
  -- 1) DELETE réel (seuils CTE inchangés) → ids dans deleted_ids
  with doomed as (
    select l.id
    from public.lobbies l
    where
      not exists (
        select 1 from public.lobby_members m where m.lobby_id = l.id
      )
      or (
        l.status = 'waiting'
        and coalesce(l.last_activity_at, l.updated_at, l.created_at)
          < now() - interval '2 hours'
      )
      or (
        l.status = 'playing'
        and coalesce(l.last_activity_at, l.updated_at, l.created_at)
          < now() - interval '12 hours'
      )
      or (
        l.status = 'waiting'
        and exists (select 1 from public.lobby_members m where m.lobby_id = l.id)
        and not exists (
          select 1 from public.lobby_members m
          where m.lobby_id = l.id
            and coalesce(m.last_seen_at, m.joined_at) > now() - interval '45 minutes'
        )
      )
  ),
  deleted as (
    delete from public.lobbies l
    using doomed d
    where l.id = d.id
    returning l.id
  )
  select coalesce(array_agg(d.id), array[]::uuid[])
  into deleted_ids
  from deleted d;

  -- 2) Tombstones uniquement pour les lignes réellement supprimées (même txn)
  insert into public.lobby_closures (lobby_id, reason, closed_at, closed_by_uid)
  select u.id, 'inactive_expired', now(), null
  from unnest(deleted_ids) as u(id)
  on conflict (lobby_id) do nothing;

  deleted_count := coalesce(cardinality(deleted_ids), 0);

  -- 3) Rétention tombstones (ne touche pas aux critères lobby)
  perform public.purge_old_lobby_closures();

  return deleted_count;
end;
$function$;

comment on function public.purge_stale_lobbies() is
  'Lifecycle + BUG-LOBBY-XX-E — purge stale (seuils inchangés) + tombstone '
  'inactive_expired pour chaque ligne réellement supprimée + rétention 14 j.';

revoke all on function public.purge_stale_lobbies() from public;
revoke all on function public.purge_stale_lobbies() from anon;
revoke all on function public.purge_stale_lobbies() from authenticated;
-- cron / SQL Editor (postgres / service_role) uniquement
