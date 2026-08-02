-- =============================================================================
-- BUG-TRUTHMETER-02 — Runbook prêt à coller (SQL Editor Supabase)
-- =============================================================================
-- Lobby / hôte :
--   lobby_id    = b1b18d42-bbd2-4eec-aaaa-fd5af353acfd
--   auteur (A)  = Joulaille la GOAT
--   user_id (A) = 1c2146d8-f372-4efc-b265-4b02eed118f5
--
-- Comment faire :
--   1) Mets AU MOINS un 2e joueur dans ce lobby.
--   2) Ctrl+A → Copier → Coller dans SQL Editor → Run.
--   3) Lis le tableau Results (test / resultat / detail).
--
-- Aucune table créée, aucune donnée modifiée.
-- =============================================================================

with
params as (
  select
    'b1b18d42-bbd2-4eec-aaaa-fd5af353acfd'::uuid as lobby_id,
    '1c2146d8-f372-4efc-b265-4b02eed118f5'::text as uid_a,
    'Joulaille la GOAT'::text as name_a
),

member_b as (
  select lm.user_id::text as uid_b, lm.display_name as name_b
  from public.lobby_members lm
  join params p on lm.lobby_id = p.lobby_id
  where lm.user_id::text is distinct from p.uid_a
  order by lm.joined_at asc nulls last
  limit 1
),

setup as (
  select
    p.lobby_id,
    p.uid_a,
    p.name_a,
    b.uid_b,
    b.name_b,
    (select count(*)::int from public.lobby_members m where m.lobby_id = p.lobby_id) as member_count,
    (to_regprocedure('public.truth_meter_resolve_author_uid(uuid,jsonb)') is not null) as fn_ok,
    gen_random_uuid()::text as run_id
  from params p
  left join member_b b on true
),

info as (
  select
    0 as ord,
    'SETUP'::text as test,
    case
      when not s.fn_ok then 'FAIL'
      when s.member_count < 2 then 'ATTENTION'
      else 'OK'
    end as resultat,
    format(
      'membres=%s | A=%s | B=%s | fonction resolve=%s',
      s.member_count,
      s.name_a,
      coalesce(s.name_b, '(aucun — ajoute un 2e joueur)'),
      case when s.fn_ok then 'présente'
           else 'ABSENTE → applique game-sessions-truthmeter-02-author-uid.sql'
      end
    ) as detail
  from setup s
),

a1 as (
  select
    1 as ord,
    'A1'::text as test,
    case
      when not s.fn_ok then 'SKIP'
      when s.uid_b is null then 'SKIP'
      when (s.uid_b = any (v.voters)) and not (s.uid_a = any (v.voters)) then 'PASS'
      else 'FAIL'
    end as resultat,
    case
      when not s.fn_ok then 'Fonction 02 absente'
      when s.uid_b is null then 'Pas de 2e joueur'
      else format('voters=%s (doit contenir B, pas A)', v.voters::text)
    end as detail
  from setup s
  left join lateral (
    select public.truth_meter_expected_voter_uids(
      s.lobby_id,
      jsonb_build_object(
        'affirmation', jsonb_build_object(
          'authorUid', s.uid_a, 'author', 'Bob', 'text', 'x'
        ),
        'authorOrder', jsonb_build_array(s.uid_a, s.uid_b),
        'roundIdx', 0,
        'votes', '{}'::jsonb
      )
    ) as voters
    where s.fn_ok and s.uid_b is not null
  ) v on true
),

a2 as (
  select
    2 as ord,
    'A2'::text as test,
    case
      when not s.fn_ok then 'SKIP'
      when s.uid_b is null then 'SKIP'
      when (s.uid_b = any (v.voters)) and not (s.uid_a = any (v.voters)) then 'PASS'
      else 'FAIL'
    end as resultat,
    case
      when not s.fn_ok then 'Fonction 02 absente'
      when s.uid_b is null then 'Pas de 2e joueur'
      else format('voters=%s (legacy pseudo A)', v.voters::text)
    end as detail
  from setup s
  left join lateral (
    select public.truth_meter_expected_voter_uids(
      s.lobby_id,
      jsonb_build_object(
        'affirmation', jsonb_build_object('author', s.name_a, 'text', 'x'),
        'authorOrder', jsonb_build_array(s.name_a, s.name_b),
        'roundIdx', 0
      )
    ) as voters
    where s.fn_ok and s.uid_b is not null
  ) v on true
),

a3 as (
  select
    3 as ord,
    'A3'::text as test,
    case
      when not s.fn_ok then 'SKIP'
      when coalesce(array_length(v.voters, 1), 0) = 0 then 'PASS'
      else 'FAIL'
    end as resultat,
    case
      when not s.fn_ok then 'Fonction 02 absente'
      else format('voters=%s (attendu vide)', v.voters::text)
    end as detail
  from setup s
  left join lateral (
    select public.truth_meter_expected_voter_uids(
      s.lobby_id,
      jsonb_build_object(
        'affirmation', jsonb_build_object('author', 'NomInexistantXYZ', 'text', 'x'),
        'roundIdx', 0
      )
    ) as voters
    where s.fn_ok
  ) v on true
),

a4 as (
  select
    4 as ord,
    'A4'::text as test,
    case
      when not s.fn_ok then 'SKIP'
      when coalesce(array_length(v.voters, 1), 0) = 0 then 'PASS'
      else 'FAIL'
    end as resultat,
    case
      when not s.fn_ok then 'Fonction 02 absente'
      else format('voters=%s (SamDup inconnu → vide)', v.voters::text)
    end as detail
  from setup s
  left join lateral (
    select public.truth_meter_expected_voter_uids(
      s.lobby_id,
      jsonb_build_object(
        'affirmation', jsonb_build_object('author', 'SamDup', 'text', 'x'),
        'roundIdx', 0
      )
    ) as voters
    where s.fn_ok
  ) v on true
),

a5 as (
  select
    5 as ord,
    'A5'::text as test,
    case
      when not s.fn_ok then 'SKIP'
      when s.uid_b is null then 'SKIP'
      when v.resolved is not distinct from s.uid_a then 'PASS'
      else 'FAIL'
    end as resultat,
    case
      when not s.fn_ok then 'Fonction 02 absente'
      when s.uid_b is null then 'Pas de 2e joueur'
      else format('resolve=%s (attendu %s)', v.resolved, s.uid_a)
    end as detail
  from setup s
  left join lateral (
    select public.truth_meter_resolve_author_uid(
      s.lobby_id,
      jsonb_build_object(
        'affirmation', jsonb_build_object(
          'authorUid', s.uid_a, 'author', s.name_b, 'text', 'x'
        ),
        'authorOrder', jsonb_build_array(s.uid_a, s.uid_b),
        'roundIdx', 0
      )
    ) as resolved
    where s.fn_ok and s.uid_b is not null
  ) v on true
),

b1 as (
  select
    6 as ord,
    'B1'::text as test,
    case
      when not s.fn_ok then 'SKIP'
      when s.uid_b is null then 'SKIP'
      when (v.scored ->> 'phase') = 'reveal'
        and (v.scored ->> 'roundScored')::boolean is true
        and jsonb_typeof(v.scored -> 'matchScores') = 'object'
      then 'PASS'
      else 'FAIL'
    end as resultat,
    case
      when not s.fn_ok then 'Fonction 02 absente'
      when s.uid_b is null then 'Pas de 2e joueur'
      else format(
        'phase=%s roundScored=%s deltas=%s',
        v.scored ->> 'phase',
        v.scored ->> 'roundScored',
        v.scored -> 'lastRound' -> 'deltas'
      )
    end as detail
  from setup s
  left join lateral (
    select public.truth_meter_apply_reveal_scoring(
      s.lobby_id,
      jsonb_build_object(
        'affirmation', jsonb_build_object(
          'authorUid', s.uid_a, 'author', s.name_a, 'text', 'x'
        ),
        'authorEstimate', 90,
        'authorOrder', jsonb_build_array(s.uid_a, s.uid_b),
        'roundIdx', 0,
        'votes', jsonb_build_object(s.uid_b, 20),
        'matchScores', '{}'::jsonb,
        'phase', 'voting',
        'runId', s.run_id
      )
    ) as scored
    where s.fn_ok and s.uid_b is not null
  ) v on true
),

-- B2 allégé : on vérifie que l’auteur « Ghost » est irrésoluble (NULL).
-- (évite une exception qui ferait échouer toute la requête)
b2 as (
  select
    7 as ord,
    'B2'::text as test,
    case
      when not s.fn_ok then 'SKIP'
      when v.resolved is null then 'PASS'
      else 'FAIL'
    end as resultat,
    case
      when not s.fn_ok then 'Fonction 02 absente'
      else format('resolve(Ghost)=%s (attendu NULL)', coalesce(v.resolved, 'NULL'))
    end as detail
  from setup s
  left join lateral (
    select public.truth_meter_resolve_author_uid(
      s.lobby_id,
      jsonb_build_object(
        'affirmation', jsonb_build_object('author', 'Ghost', 'text', 'x'),
        'roundIdx', 0
      )
    ) as resolved
    where s.fn_ok
  ) v on true
)

select test, resultat, detail
from (
  select * from info
  union all select * from a1
  union all select * from a2
  union all select * from a3
  union all select * from a4
  union all select * from a5
  union all select * from b1
  union all select * from b2
) r
order by ord;
