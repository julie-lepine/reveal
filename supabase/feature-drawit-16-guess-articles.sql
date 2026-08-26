-- =============================================================================
-- FEATURE-DRAWIT-16 — articles FR optionnels sur les propositions
--
-- Ordre d'application :
--   02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 13 → 14 → 15 → 16
--
-- SQL 03 n'est pas réécrite. Remplace seulement normalize_drawit_guess.
-- Miroir de js/core/drawItNormalize.js : tokens entiers en tête
--   le | la | les | l | un | une | des | du
-- ignorés s'il reste au moins un mot. Pas de fuzzy.
-- "un poireau" == "poireau" ; "descendre" et "landes" inchangés.
-- =============================================================================

create or replace function public.normalize_drawit_guess(p_raw text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select coalesce(nullif(v.rest, ''), v.base)
  from (
    select
      v.base,
      trim(both from regexp_replace(
        v.base,
        '^(les|le|la|une|un|des|du|l)( (les|le|la|une|un|des|du|l))* ',
        ''
      )) as rest
    from (
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
      )) as base
    ) v
  ) v;
$$;

revoke all on function public.normalize_drawit_guess(text) from public;
grant execute on function public.normalize_drawit_guess(text) to authenticated;
