-- =============================================================================
-- CLEANUP-FILROUGE-02 — Contrôle post-deploy READ ONLY (après migration)
-- =============================================================================
-- Un seul résultat. Copier TOUT le tableau.
-- SELECT uniquement.
-- =============================================================================

select *
from (
  select
    10 as sort_key,
    'table'::text as section,
    'public.fil_rouge_private'::text as object_name,
    'absent'::text as key,
    (to_regclass('public.fil_rouge_private') is null)::text as value

  union all
  select
    100 + row_number() over (order by p.proname),
    'rpc',
    p.proname,
    'markers',
    jsonb_build_object(
      'args', pg_get_function_identity_arguments(p.oid),
      'has_filRouge_literal_key',
        position('''filRouge''' in pg_get_functiondef(p.oid)) > 0
        or position(',''filRouge''' in pg_get_functiondef(p.oid)) > 0
        or position('''filRouge'',' in pg_get_functiondef(p.oid)) > 0,
      'has_filRougeScores', position('filRougeScores' in pg_get_functiondef(p.oid)) > 0,
      'has_filRouge_substring', position('filRouge' in pg_get_functiondef(p.oid)) > 0,
      'has_fil_rouge_private', position('fil_rouge_private' in pg_get_functiondef(p.oid)) > 0,
      'has_playlistGuess_camel', position('playlistGuess' in pg_get_functiondef(p.oid)) > 0,
      'has_playlistguess_lower', position('playlistguess' in lower(pg_get_functiondef(p.oid))) > 0,
      'has_tiernight_end_screen', position('tiernight-end' in pg_get_functiondef(p.oid)) > 0,
      'has_tierNight', position('''tierNight''' in pg_get_functiondef(p.oid)) > 0
        or position('tierNight' in pg_get_functiondef(p.oid)) > 0,
      'has_tierNightLive', position('tierNightLive' in pg_get_functiondef(p.oid)) > 0,
      'has_traitre_private', position('traitre_private' in pg_get_functiondef(p.oid)) > 0,
      'has_lobby_messages', position('lobby_messages' in pg_get_functiondef(p.oid)) > 0,
      'has_game_sessions', position('game_sessions' in pg_get_functiondef(p.oid)) > 0,
      'has_jsonb_replace_uid', position('jsonb_replace_uid' in pg_get_functiondef(p.oid)) > 0
    )::text
  from pg_proc p
  where p.oid in (
    to_regprocedure('public.apply_acting_host_play(uuid, text, text, jsonb, text, text)'),
    to_regprocedure('public.complete_game_session_as_actor(uuid, text)'),
    to_regprocedure('public.remap_lobby_user_id(uuid, uuid, uuid)'),
    to_regprocedure('public.game_session_state_key(text)'),
    to_regprocedure('public.game_session_expected_game_id(text)'),
    to_regprocedure('public.contribute_game_session_player(uuid, text, text, jsonb)')
  )

  union all
  select
    200,
    'expect',
    'apply_acting_host_play',
    'pass_criteria',
    'filRougeScores=false; filRouge_substring=false; playlist=false; tiernight-end=true'

  union all
  select
    201,
    'expect',
    'complete_game_session_as_actor',
    'pass_criteria',
    'filRouge_literal=false; playlistGuess=false; tiernight-end=true; tierNight/tierNightLive present'

  union all
  select
    202,
    'expect',
    'remap_lobby_user_id',
    'pass_criteria',
    'fil_rouge_private=false; traitre_private=true; lobby_messages=true; game_sessions=true; jsonb_replace_uid=true'

  union all
  select
    203,
    'expect',
    'maps_contribute',
    'pass_criteria',
    'state_key/expected/contribute: no filRouge / no playlistguess'
) t
order by sort_key, section, object_name;
