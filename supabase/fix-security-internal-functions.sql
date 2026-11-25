-- Audit sécurité Supabase d'ensemble (tmp/audit-securite-supabase.md) n°1, 2, 6 et 7.
--
-- n°1 — remap_lobby_user_id ouverte à tous.
--   Fonction interne de la reprise de place d'un invité : elle remplace un identifiant
--   de joueur par un autre dans un salon (traitre_private, auteur des messages, état de
--   la partie). Elle ne vérifie rien et était exécutable par anon et authenticated :
--   n'importe qui connaissant l'identifiant du salon et de deux joueurs pouvait
--   s'attribuer le rôle, les votes ou les messages d'un autre.
--   Seule reclaim_guest_membership l'appelle ; elle tourne avec les droits de son
--   propriétaire (postgres), donc le retrait des droits ne la gêne pas.
--   L'appli ne l'appelle jamais directement.
--
-- n°2 — create_lobby_member jamais fermée.
--   Remplacée par create_lobby_atomically (vague E4). Le retrait des droits prévu
--   (lobby-membership-e4-03b-revoke-create-lobby-member.sql) n'avait pas été lancé.
--   Elle ajoute l'appelant dans n'importe quel salon avec is_host = true.
--   L'appli ne l'appelle plus depuis le 2026-07-28 (commit 6a00cc9).
--
-- postgres et service_role gardent l'accès (opérations seulement).

revoke all on function public.remap_lobby_user_id(uuid, uuid, uuid) from public;
revoke all on function public.remap_lobby_user_id(uuid, uuid, uuid) from anon;
revoke all on function public.remap_lobby_user_id(uuid, uuid, uuid) from authenticated;
grant execute on function public.remap_lobby_user_id(uuid, uuid, uuid) to service_role;

comment on function public.remap_lobby_user_id(uuid, uuid, uuid) is
  'Interne : appelée par reclaim_guest_membership (SECURITY DEFINER). '
  'Pas exécutable par anon / authenticated (audit sécurité Supabase n°1, 2026-11-25).';

revoke all on function public.create_lobby_member(uuid, text, text, text) from public;
revoke all on function public.create_lobby_member(uuid, text, text, text) from anon;
revoke all on function public.create_lobby_member(uuid, text, text, text) from authenticated;
grant execute on function public.create_lobby_member(uuid, text, text, text) to service_role;

comment on function public.create_lobby_member(uuid, text, text, text) is
  'E4 Option B — déprécié, remplacé par create_lobby_atomically. '
  'Pas exécutable par anon / authenticated (audit sécurité Supabase n°2, 2026-11-25).';

-- n°6 — petits outils internes ouverts sans session.
--   Appelés uniquement par d'autres fonctions serveur (droits de postgres) ou par la
--   tâche planifiée cleanup-stale-guests ; l'appli ne les appelle jamais. Ouverts, ils
--   donnaient les identifiants des joueurs d'un salon, disaient si un compte est un
--   invité, ou permettaient de garder n'importe quel salon « vivant ».
--   Appelants vérifiés le 2026-11-25 (tous SECURITY DEFINER) :
--     is_auth_user_anonymous ← peek_lobby_by_membership, reclaim_guest_membership
--     touch_lobby_activity ← déclencheurs touch_lobby_on_*
--     trivia_all_expected_players_answered ← submit_trivia_answer
--     trivia_question_player_uids ← trivia_all_expected_players_answered
--     truth_meter_* ← submit_truth_meter_vote, reveal_truth_meter_round et entre eux
--     cleanup_stale_guest_members ← cron
--   Aucune règle d'accès (policy) ne les utilise.
--
-- n°7 — search_path fixé sur les deux fonctions SECURITY DEFINER qui n'en avaient pas
--   (cleanup_stale_guest_members, update_member_presence). update_member_presence reste
--   ouverte aux joueurs : elle ne touche que la ligne de l'appelant.

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.is_auth_user_anonymous(uuid)',
    'public.touch_lobby_activity(uuid)',
    'public.trivia_all_expected_players_answered(uuid, jsonb)',
    'public.trivia_question_player_uids(uuid, jsonb)',
    'public.truth_meter_all_expected_voters_voted(uuid, jsonb)',
    'public.truth_meter_apply_reveal_scoring(uuid, jsonb)',
    'public.truth_meter_expected_voter_uids(uuid, jsonb)',
    'public.truth_meter_resolve_author_uid(uuid, jsonb)',
    'public.cleanup_stale_guest_members()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

alter function public.cleanup_stale_guest_members() set search_path = pg_catalog, public;
alter function public.update_member_presence(uuid) set search_path = pg_catalog, public;

-- Contrôle après application (anon et authenticated doivent valoir false partout,
-- sauf update_member_presence) :
-- select p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE') anon,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated,
--        p.proconfig
-- from pg_proc p
-- where p.pronamespace = 'public'::regnamespace
--   and p.proname in ('remap_lobby_user_id', 'create_lobby_member',
--     'is_auth_user_anonymous', 'touch_lobby_activity',
--     'trivia_all_expected_players_answered', 'trivia_question_player_uids',
--     'truth_meter_all_expected_voters_voted', 'truth_meter_apply_reveal_scoring',
--     'truth_meter_expected_voter_uids', 'truth_meter_resolve_author_uid',
--     'cleanup_stale_guest_members', 'update_member_presence');
