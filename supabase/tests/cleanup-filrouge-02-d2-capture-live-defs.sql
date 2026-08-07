-- =============================================================================
-- CLEANUP-FILROUGE-02 — D2 : capture définitions LIVE (READ ONLY)
-- =============================================================================
-- Un seul résultat. Copier TOUT le tableau (surtout definition_full + def_md5).
-- SELECT uniquement. Aucun DROP / ALTER / UPDATE / DELETE / INSERT / CREATE.
--
-- Note marqueurs :
--   has_filRouge_substring  = vrai si "filRouge" apparaît n'importe où
--                             (y compris dans filRougeScores → faux positif fréquent)
--   has_filRouge_literal_key = heuristique clé state 'filRouge' / ,'filRouge'
--   has_playlistguess_lower  = game_id / screen lowercase (VibeCheck)
--   has_playlistGuess_camel  = clé state JSON playlistGuess
-- =============================================================================

select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  md5(pg_get_functiondef(p.oid)) as def_md5,
  length(pg_get_functiondef(p.oid)) as def_chars,
  pg_get_functiondef(p.oid) as definition_full,
  (
    position('''filRouge''' in pg_get_functiondef(p.oid)) > 0
    or position(',''filRouge''' in pg_get_functiondef(p.oid)) > 0
    or position('''filRouge'',' in pg_get_functiondef(p.oid)) > 0
  ) as has_filRouge_literal_key,
  (position('filRougeScores' in pg_get_functiondef(p.oid)) > 0) as has_filRougeScores,
  (position('filRouge' in pg_get_functiondef(p.oid)) > 0) as has_filRouge_substring,
  (position('fil_rouge_private' in pg_get_functiondef(p.oid)) > 0) as has_fil_rouge_private,
  (position('playlistGuess' in pg_get_functiondef(p.oid)) > 0) as has_playlistGuess_camel,
  (position('playlistguess' in lower(pg_get_functiondef(p.oid))) > 0) as has_playlistguess_lower,
  (position('tiernight-end' in pg_get_functiondef(p.oid)) > 0) as has_tiernight_end_screen,
  (position('gameScoreSessionKey' in pg_get_functiondef(p.oid)) > 0) as has_gameScoreSessionKey
from pg_proc p
where p.oid in (
  to_regprocedure('public.apply_acting_host_play(uuid, text, text, jsonb, text, text)'),
  to_regprocedure('public.complete_game_session_as_actor(uuid, text)'),
  to_regprocedure('public.remap_lobby_user_id(uuid, uuid, uuid)')
)
order by p.proname;
