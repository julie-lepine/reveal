-- =============================================================================
-- ARCH-23 Vague 1 — Floor de compatibilité client (autoritaire Supabase)
--
-- Table + RPC lecture anonyme/authenticated.
-- Valeur initiale : min_client_compatibility_build = 1
--   (= APP_COMPATIBILITY_BUILD embarqué Vague 1)
-- NE PAS relever en production dans cette vague sans instruction explicite
-- et sans clients stores déjà disponibles (voir docs ARCH-23 / DEPLOYMENTS_SQL).
-- =============================================================================

create table if not exists public.app_client_compatibility (
  id int primary key default 1 check (id = 1),
  min_client_compatibility_build integer not null
    check (min_client_compatibility_build >= 1),
  updated_at timestamptz not null default now(),
  note text null
);

comment on table public.app_client_compatibility is
  'ARCH-23 — singleton floor de compatibilité. Une seule ligne (id=1). '
  'Bump uniquement après dispo effective des builds stores compatibles.';

comment on column public.app_client_compatibility.min_client_compatibility_build is
  'Clients avec APP_COMPATIBILITY_BUILD < cette valeur → incompatible (hard gate).';

insert into public.app_client_compatibility (id, min_client_compatibility_build, note)
values (1, 1, 'ARCH-23 vague 1 — floor initial (= clients actuels). Ne pas bumper sans instruction.')
on conflict (id) do nothing;

alter table public.app_client_compatibility enable row level security;

-- Lecture publique minimale (boot peut précéder la session). Pas d'écriture client.
drop policy if exists app_client_compatibility_select on public.app_client_compatibility;
create policy app_client_compatibility_select
  on public.app_client_compatibility
  for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.app_client_compatibility from anon, authenticated;
grant select on public.app_client_compatibility to anon, authenticated;
grant all on public.app_client_compatibility to service_role;

-- RPC typée (préférée au SELECT direct pour contrat stable)
create or replace function public.get_client_compatibility_config()
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  select jsonb_build_object(
    'min_compatibility_build', c.min_client_compatibility_build,
    'updated_at', c.updated_at
  )
  from public.app_client_compatibility c
  where c.id = 1;
$$;

comment on function public.get_client_compatibility_config() is
  'ARCH-23 — lit le floor min_client_compatibility_build. Pas de secret. '
  'Invoker + RLS SELECT anon/authenticated.';

revoke all on function public.get_client_compatibility_config() from public;
grant execute on function public.get_client_compatibility_config() to anon;
grant execute on function public.get_client_compatibility_config() to authenticated;
grant execute on function public.get_client_compatibility_config() to service_role;
