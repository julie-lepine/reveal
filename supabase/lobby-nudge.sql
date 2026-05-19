-- REVEAL — Wizz lobby (hôte → joueurs pas prêts). SQL Editor après schema.sql

alter table public.lobbies
  add column if not exists nudge_at timestamptz,
  add column if not exists nudge_for uuid references auth.users(id) on delete set null;

comment on column public.lobbies.nudge_at is 'Dernier wizz envoyé par l''hôte';
comment on column public.lobbies.nudge_for is 'Cible du wizz (null = tous les non-prêts)';
