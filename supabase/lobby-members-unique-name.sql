-- Un pseudo unique par lobby (insensible à la casse, espaces ignorés en bord).
-- À exécuter dans Supabase → SQL Editor après avoir supprimé les doublons :
--
--   SELECT lobby_id, upper(trim(display_name)), count(*)
--   FROM public.lobby_members
--   GROUP BY 1, 2
--   HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS lobby_members_unique_name_per_lobby_ci
  ON public.lobby_members (lobby_id, upper(trim(display_name)));
