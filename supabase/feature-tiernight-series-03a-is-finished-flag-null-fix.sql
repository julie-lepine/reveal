-- Patch minimal staging : tiernight_series_is_finished_flag ne renvoie plus NULL.
-- Idempotent. Aucune autre fonction modifiée.
create or replace function public.tiernight_series_is_finished_flag(
  p_finished jsonb,
  p_uid text
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_uid, '') <> ''
    and coalesce(
      (coalesce(p_finished, '{}'::jsonb) -> p_uid) = to_jsonb(true),
      false
    );
$$;
