-- =============================================================================
-- FEATURE-TIERNIGHT-03 — PRÉFLIGHT LECTURE SEULE (AVANT migration clear customs)
-- =============================================================================
-- Exécuter AVANT feature-tiernight-03-clear-custom-roster-topics.sql
-- Aucune mutation : pas de CREATE / DROP / INSERT / UPDATE / fixture / helper.
--
-- Conserver les résultats (export / capture) pour comparaison avec la base
-- canonique : feature-tiernight-02-lost-update-fix.sql
-- (Hot Take + Dilemma multi-append + TierNight authorUid).
--
-- Si staging montre dilemma-01 (pas de branche TierNight) : documenter ;
-- la migration restaure intentionnellement TierNight + gate writable.
-- Si divergence non comprise : ARRÊT — ne pas appliquer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A) upsert_player_custom_entry — identité / DEFINER / search_path / ACL
-- ---------------------------------------------------------------------------
select
  'upsert_identity' as check_id,
  n.nspname as schema,
  p.proname as name,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  p.prosecdef as security_definer,
  p.proconfig as proconfig,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as acl_authenticated,
  has_function_privilege('anon', p.oid, 'EXECUTE') as acl_anon,
  has_function_privilege('public', p.oid, 'EXECUTE') as acl_public,
  md5(pg_get_functiondef(p.oid)) as def_md5,
  length(pg_get_functiondef(p.oid)) as def_len
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'upsert_player_custom_entry'
order by p.oid;

-- Définition complète (à conserver telle quelle)
select
  'upsert_functiondef' as check_id,
  pg_get_functiondef(p.oid) as functiondef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'upsert_player_custom_entry'
order by p.oid;

-- Marqueurs structuraux (inspection, pas d’exécution métier)
select
  'upsert_markers' as check_id,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  (pg_get_functiondef(p.oid) ilike '%hottake%') as has_hottake,
  (pg_get_functiondef(p.oid) ilike '%dilemma%') as has_dilemma,
  (pg_get_functiondef(p.oid) ilike '%tiernight%') as has_tiernight,
  (pg_get_functiondef(p.oid) ilike '%authorUid%') as has_author_uid,
  (pg_get_functiondef(p.oid) ilike '%customRosterTopics%') as has_custom_roster_topics,
  (pg_get_functiondef(p.oid) ilike '%customTakes%') as has_custom_takes,
  (pg_get_functiondef(p.oid) ilike '%customDilemmas%') as has_custom_dilemmas,
  -- dilemma-01 / lost-update : multi-append = pas de raise « déjà soumis un dilemme »
  (pg_get_functiondef(p.oid) ilike '%déjà soumis un dilemme%') as has_dilemma_one_per_author_raise,
  (pg_get_functiondef(p.oid) ilike '%TNS_CUSTOM_ROSTER_CLOSED%') as has_writable_gate_already,
  (pg_get_functiondef(p.oid) ilike '%Customs uniquement pour Hot Take / Dilemma / TierNight%')
    as has_tn_error_message,
  (pg_get_functiondef(p.oid) ilike '%Customs uniquement pour Hot Take / Dilemma.%')
    as has_dilemma01_error_message_without_tn
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'upsert_player_custom_entry'
order by p.oid;

-- Verdict lecture (notice) — ne lève pas d’exception (préflight informatif)
do $$
declare
  v_def text;
  v_has_tn boolean;
  v_dilemma01 boolean;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'upsert_player_custom_entry'
  order by p.oid desc
  limit 1;

  if v_def is null then
    raise notice 'PREFLIGHT: upsert_player_custom_entry ABSENT — migration créera/restaurera via REPLACE';
    return;
  end if;

  v_has_tn := v_def ilike '%tiernight%' and v_def ilike '%customRosterTopics%';
  v_dilemma01 :=
    v_def ilike '%Customs uniquement pour Hot Take / Dilemma.%'
    and not v_has_tn;

  raise notice 'PREFLIGHT upsert: has_tiernight=% dilemma01_sans_tn=% has_authorUid=% has_one_dilemma_raise=%',
    v_has_tn,
    v_dilemma01,
    v_def ilike '%authorUid%',
    v_def ilike '%déjà soumis un dilemme%';

  if v_dilemma01 then
    raise notice 'PREFLIGHT ATTENTION: staging ressemble à dilemma-01 (TierNight retiré). La migration restaure lost-update + gate. Comparer md5 avant apply.';
  elsif v_has_tn then
    raise notice 'PREFLIGHT OK structurelle: TierNight présent — vérifier md5 vs lost-update + absences involontaires.';
  else
    raise notice 'PREFLIGHT ATTENTION: forme upsert inattendue — ARRÊT recommandé si non comprise.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- B) clear_tiernight_custom_roster_topics — signatures existantes (si déjà présentes)
-- ---------------------------------------------------------------------------
select
  'clear_signatures' as check_id,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  p.prosecdef as security_definer,
  p.proconfig as proconfig,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as acl_authenticated,
  has_function_privilege('anon', p.oid, 'EXECUTE') as acl_anon,
  has_function_privilege('public', p.oid, 'EXECUTE') as acl_public,
  case
    when pg_get_function_identity_arguments(p.oid) in (
      'p_lobby_id uuid, p_reopen boolean',
      'uuid, boolean'
    ) then 'LEGACY_2ARG'
    when pg_get_function_identity_arguments(p.oid) in (
      'p_lobby_id uuid, p_expected_session_id uuid, p_reopen boolean',
      'uuid, uuid, boolean'
    ) then 'CAS_3ARG'
    else 'OTHER'
  end as signature_kind
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'clear_tiernight_custom_roster_topics'
order by p.oid;

select
  'clear_legacy_2arg_present' as check_id,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'clear_tiernight_custom_roster_topics'
      and pg_get_function_identity_arguments(p.oid) in (
        'p_lobby_id uuid, p_reopen boolean',
        'uuid, boolean'
      )
  ) as legacy_uuid_boolean_exists;

-- ---------------------------------------------------------------------------
-- C) Helpers éventuels déjà déployés
-- ---------------------------------------------------------------------------
select
  'helper_presence' as check_id,
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as acl_authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'tiernight_parse_custom_roster_epoch',
    'tiernight_parse_custom_roster_writable',
    'tiernight_is_custom_roster_clear_canonical'
  )
order by p.proname, p.oid;

-- Fin préflight — aucune écriture.
select 'preflight_done' as check_id, now() as captured_at;
