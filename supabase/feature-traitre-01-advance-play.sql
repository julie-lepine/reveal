-- REVEAL — Spot the Fake : transitions d'acting host
-- À exécuter dans l'éditeur SQL Supabase APRÈS :
--   traitre-private.sql
--   game-sessions-arch03-fix-is-acting-host.sql (is_acting_host)
--   cleanup-filrouge-02-remove-server-legacy.sql (apply_acting_host_play inchangée)
--
-- Ce fichier n'est pas appliqué par le client. Ne pas le marquer déployé
-- tant qu'il n'a pas été lancé sur le projet.
--
-- Contrat de public.advance_traitre_play :
--   * l'appelant est l'hôte réel OU l'acting host (is_lobby_host / is_acting_host)
--   * la ligne game_sessions est verrouillée (FOR UPDATE) : deux appelants
--     concurrents sont sérialisés, le second voit déjà la phase nouvelle
--   * p_expected_* refuse une transition calculée sur un état périmé
--   * un retry (timeout, double clic, second acting host) retourne la ligne
--     courante SANS second effet : pas de second tour, pas de seconde
--     élimination, pas de second ajout de points
--   * le fake est lu dans traitre_private (is_impostor), jamais dans l'argument
--   * impostorName / impostorUid ne sont écrits qu'au passage en phase final
--   * les points de soirée sont ajoutés dans la même transaction que la finale,
--     une seule fois (garde scoresApplied)
--
-- Actions : deal_to_speak | finish_speak | continue_speak | start_vote | resolve_vote
-- Le client n'envoie pas le blob de partie, seulement l'action et les gardes.

create or replace function public.traitre_text_in_jsonb_array(p_arr jsonb, p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(p_value, '') <> ''
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(p_arr, '[]'::jsonb)) as elem(value)
      where elem.value = p_value
    );
$$;

create or replace function public.traitre_add_score_deltas(p_scores jsonb, p_deltas jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_scores jsonb := coalesce(p_scores, '{}'::jsonb);
  v_entry record;
  v_current int;
  v_delta int;
begin
  if jsonb_typeof(v_scores) <> 'object' then
    v_scores := '{}'::jsonb;
  end if;
  for v_entry in select key, value from jsonb_each(coalesce(p_deltas, '{}'::jsonb))
  loop
    v_current := coalesce((v_scores ->> v_entry.key)::int, 0);
    v_delta := coalesce((v_entry.value #>> '{}')::int, 0);
    if v_delta > 0 then
      v_scores := jsonb_set(
        v_scores,
        array[v_entry.key],
        to_jsonb(v_current + v_delta),
        true
      );
    end if;
  end loop;
  return v_scores;
end;
$$;

revoke all on function public.traitre_text_in_jsonb_array(jsonb, text) from public;
revoke all on function public.traitre_text_in_jsonb_array(jsonb, text) from anon;
revoke all on function public.traitre_text_in_jsonb_array(jsonb, text) from authenticated;
revoke all on function public.traitre_add_score_deltas(jsonb, jsonb) from public;
revoke all on function public.traitre_add_score_deltas(jsonb, jsonb) from anon;
revoke all on function public.traitre_add_score_deltas(jsonb, jsonb) from authenticated;

drop function if exists public.advance_traitre_play(uuid, text, text, int, text, int, boolean);

create or replace function public.advance_traitre_play(
  p_lobby_id uuid,
  p_match_id uuid,
  p_action text,
  p_expected_phase text,
  p_expected_speak_round int,
  p_expected_pair_id text,
  p_expected_alive_count int,
  p_force boolean default false
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_action text := lower(trim(coalesce(p_action, '')));
  v_row public.game_sessions;
  v_state jsonb;
  v_tr jsonb;
  v_blob_match text;
  v_phase text;
  v_round int;
  v_pair text;
  v_alive jsonb;
  v_alive_count int;
  v_expected_round int := coalesce(p_expected_speak_round, -1);
  v_expected_alive int := coalesce(p_expected_alive_count, -1);
  v_name_by_uid jsonb := '{}'::jsonb;
  v_uid_by_name jsonb := '{}'::jsonb;
  v_mem record;
  v_name text;
  v_member_uid text;
  v_acked boolean;
  v_waiting boolean;
  v_vote record;
  v_voter_name text;
  v_target_name text;
  v_seen jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_named_votes jsonb := '{}'::jsonb;
  v_voted int := 0;
  v_max int := 0;
  v_leader_count int := 0;
  v_leader text := null;
  v_n int;
  v_entry record;
  v_imp_count int := 0;
  v_imp_uid uuid;
  v_impostor_name text;
  v_eliminated_name text;
  v_new_alive jsonb;
  v_new_eliminated jsonb;
  v_awards jsonb;
  v_award_pts int;
  v_survivals int;
  v_snap jsonb := '{}'::jsonb;
  v_deltas_name jsonb := '{}'::jsonb;
  v_breakdown jsonb := '{}'::jsonb;
  v_pts int;
  v_label text;
  v_who text;
  v_uid_deltas jsonb := '{}'::jsonb;
  v_scores jsonb;
  v_game_scores jsonb;
  v_traitre_scores jsonb;
  v_player_stats jsonb;
  v_stat_row jsonb;
  v_evening jsonb;
  v_order jsonb;
  v_stats jsonb;
  v_last_game jsonb;
  v_summary text;
  v_target_uid text;
  v_voter_uid text;
  v_pts_win constant int := 10;
  v_pts_bonus constant int := 15;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;
  if v_action not in (
    'deal_to_speak', 'finish_speak', 'continue_speak', 'start_vote', 'resolve_vote'
  ) then
    raise exception 'TRAITRE_BAD_ACTION';
  end if;
  if p_expected_pair_id is null or length(trim(p_expected_pair_id)) = 0 then
    raise exception 'TRAITRE_STALE_PHASE';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;
  if v_row.game_id is distinct from 'traitre' then
    raise exception 'TRAITRE_WRONG_GAME';
  end if;

  v_state := coalesce(v_row.state, '{}'::jsonb);
  v_tr := coalesce(v_state->'traitre', '{}'::jsonb);
  if jsonb_typeof(v_tr) <> 'object'
     or coalesce((v_tr->>'lobbyStarted')::boolean, false) is not true
  then
    raise exception 'TRAITRE_NO_SESSION';
  end if;

  v_blob_match := nullif(btrim(coalesce(v_tr->>'matchId', '')), '');
  if p_match_id is null
     or v_blob_match is null
     or v_blob_match is distinct from p_match_id::text
  then
    raise exception 'TRAITRE_STALE_MATCH';
  end if;

  v_phase := coalesce(v_tr->>'phase', '');
  v_round := coalesce((v_tr->>'speakRound')::int, 1);
  v_pair := coalesce(v_tr->>'pairId', '');
  v_alive := coalesce(v_tr->'alive', '[]'::jsonb);
  if jsonb_typeof(v_alive) <> 'array' then
    raise exception 'TRAITRE_NO_SESSION';
  end if;
  v_alive_count := jsonb_array_length(v_alive);

  if v_pair is distinct from p_expected_pair_id then
    raise exception 'TRAITRE_STALE_PHASE';
  end if;

  -- Retry : la transition a déjà été appliquée. Aucune écriture.
  if v_action = 'deal_to_speak'
     and coalesce(p_expected_phase, '') = 'deal'
     and v_phase = 'speak'
     and v_round = v_expected_round
     and v_alive_count = v_expected_alive
     and jsonb_array_length(coalesce(v_tr->'eliminated', '[]'::jsonb)) = 0
     and coalesce(v_tr->>'lastEliminated', '') = ''
  then
    return v_row;
  end if;

  if v_action = 'finish_speak'
     and coalesce(p_expected_phase, '') = 'speak'
     and v_expected_round = 1
     and v_phase = 'decision'
     and v_round = 1
     and v_alive_count = v_expected_alive
  then
    return v_row;
  end if;

  if v_action = 'finish_speak'
     and coalesce(p_expected_phase, '') = 'speak'
     and v_expected_round > 1
     and v_phase = 'vote'
     and v_round = v_expected_round
     and v_alive_count = v_expected_alive
  then
    return v_row;
  end if;

  if v_action = 'continue_speak'
     and coalesce(p_expected_phase, '') = 'decision'
     and v_phase = 'speak'
     and v_round = v_expected_round + 1
     and v_alive_count = v_expected_alive
  then
    return v_row;
  end if;

  if v_action = 'start_vote'
     and coalesce(p_expected_phase, '') = 'decision'
     and v_phase = 'vote'
     and v_round = v_expected_round
     and v_alive_count = v_expected_alive
  then
    return v_row;
  end if;

  if v_action = 'resolve_vote'
     and coalesce(p_expected_phase, '') = 'vote'
     and v_phase = 'speak'
     and v_round = v_expected_round + 1
     and coalesce((v_tr->>'tieAfterVote')::boolean, false) is true
     and v_alive_count = v_expected_alive
  then
    return v_row;
  end if;

  if v_action = 'resolve_vote'
     and coalesce(p_expected_phase, '') = 'vote'
     and v_phase = 'speak'
     and v_round = v_expected_round + 1
     and coalesce((v_tr->>'tieAfterVote')::boolean, false) is not true
     and v_alive_count = v_expected_alive - 1
     and coalesce(v_tr->>'lastEliminated', '') <> ''
  then
    return v_row;
  end if;

  if v_action = 'resolve_vote'
     and coalesce(p_expected_phase, '') = 'vote'
     and v_phase = 'final'
     and v_round = v_expected_round
     and v_alive_count = v_expected_alive - 1
     and coalesce((v_tr->>'impostorRevealed')::boolean, false) is true
     and coalesce((v_tr->>'scoresApplied')::boolean, false) is true
  then
    return v_row;
  end if;

  for v_mem in
    select user_id, display_name
    from public.lobby_members
    where lobby_id = p_lobby_id
  loop
    v_name_by_uid := v_name_by_uid || jsonb_build_object(v_mem.user_id::text, v_mem.display_name);
    if not (v_uid_by_name ? v_mem.display_name) then
      v_uid_by_name := v_uid_by_name || jsonb_build_object(v_mem.display_name, v_mem.user_id::text);
    end if;
  end loop;

  if v_action = 'deal_to_speak' then
    if v_phase <> 'deal'
       or coalesce(p_expected_phase, '') <> 'deal'
       or v_round <> v_expected_round
       or v_alive_count <> v_expected_alive
       or v_alive_count < 1
    then
      raise exception 'TRAITRE_STALE_PHASE';
    end if;
    v_waiting := false;
    for v_name in select value from jsonb_array_elements_text(v_alive)
    loop
      v_member_uid := v_uid_by_name ->> v_name;
      v_acked := false;
      if v_member_uid is not null
         and coalesce((v_tr->'dealAcks' ->> v_member_uid)::boolean, false)
      then
        v_acked := true;
      elsif coalesce((v_tr->'dealAcks' ->> v_name)::boolean, false) then
        v_acked := true;
      end if;
      if not v_acked then
        v_waiting := true;
      end if;
    end loop;
    if v_waiting then
      raise exception 'TRAITRE_WAITING_ACKS';
    end if;
    v_tr := (v_tr || jsonb_build_object('phase', 'speak', 'speakerIndex', 0))
      - 'impostorName' - 'impostorUid' - 'rolesByUid' - 'isLocalImpostor';

  elsif v_action = 'finish_speak' then
    if v_phase <> 'speak'
       or coalesce(p_expected_phase, '') <> 'speak'
       or v_round <> v_expected_round
       or v_alive_count <> v_expected_alive
    then
      raise exception 'TRAITRE_STALE_PHASE';
    end if;
    if v_round = 1 then
      v_tr := (v_tr || jsonb_build_object(
        'phase', 'decision',
        'speakerIndex', 0,
        'lastEliminated', null
      )) - 'impostorName' - 'impostorUid' - 'rolesByUid' - 'isLocalImpostor';
    else
      v_tr := (v_tr || jsonb_build_object(
        'phase', 'vote',
        'speakerIndex', 0,
        'lastEliminated', null,
        'votes', '{}'::jsonb,
        'revotePending', false,
        'revoteCount', 0,
        'tieAfterVote', false
      )) - 'impostorName' - 'impostorUid' - 'rolesByUid' - 'isLocalImpostor';
    end if;

  elsif v_action = 'continue_speak' then
    if v_phase <> 'decision'
       or coalesce(p_expected_phase, '') <> 'decision'
       or v_round <> v_expected_round
       or v_alive_count <> v_expected_alive
    then
      raise exception 'TRAITRE_STALE_PHASE';
    end if;
    v_tr := (v_tr || jsonb_build_object(
      'phase', 'speak',
      'speakRound', v_round + 1,
      'speakerIndex', 0
    )) - 'impostorName' - 'impostorUid' - 'rolesByUid' - 'isLocalImpostor';

  elsif v_action = 'start_vote' then
    if v_phase <> 'decision'
       or coalesce(p_expected_phase, '') <> 'decision'
       or v_round <> v_expected_round
       or v_alive_count <> v_expected_alive
    then
      raise exception 'TRAITRE_STALE_PHASE';
    end if;
    v_tr := (v_tr || jsonb_build_object(
      'phase', 'vote',
      'votes', '{}'::jsonb,
      'revotePending', false,
      'revoteCount', 0,
      'tieAfterVote', false
    )) - 'impostorName' - 'impostorUid' - 'rolesByUid' - 'isLocalImpostor';

  else
    -- resolve_vote
    if v_phase <> 'vote'
       or coalesce(p_expected_phase, '') <> 'vote'
       or v_round <> v_expected_round
       or v_alive_count <> v_expected_alive
    then
      raise exception 'TRAITRE_STALE_PHASE';
    end if;

    for v_vote in select key, value from jsonb_each(coalesce(v_tr->'votes', '{}'::jsonb))
    loop
      v_voter_name := v_name_by_uid ->> v_vote.key;
      if v_voter_name is null and public.traitre_text_in_jsonb_array(v_alive, v_vote.key) then
        v_voter_name := v_vote.key;
      end if;
      v_target_name := v_name_by_uid ->> (v_vote.value #>> '{}');
      if v_target_name is null
         and public.traitre_text_in_jsonb_array(v_alive, v_vote.value #>> '{}')
      then
        v_target_name := v_vote.value #>> '{}';
      end if;
      if v_voter_name is null or v_target_name is null then
        continue;
      end if;
      if v_seen ? v_voter_name then
        continue;
      end if;
      if not public.traitre_text_in_jsonb_array(v_alive, v_voter_name)
         or not public.traitre_text_in_jsonb_array(v_alive, v_target_name)
      then
        continue;
      end if;
      v_seen := v_seen || jsonb_build_object(v_voter_name, true);
      v_named_votes := jsonb_set(v_named_votes, array[v_voter_name], to_jsonb(v_target_name), true);
      v_counts := jsonb_set(
        v_counts,
        array[v_target_name],
        to_jsonb(coalesce((v_counts ->> v_target_name)::int, 0) + 1),
        true
      );
      v_voted := v_voted + 1;
    end loop;

    if coalesce(p_force, false) is not true and v_voted <> v_alive_count then
      raise exception 'TRAITRE_VOTES_INCOMPLETE';
    end if;
    if v_voted = 0 then
      raise exception 'TRAITRE_NO_VOTES';
    end if;

    for v_entry in select key, value from jsonb_each(v_counts)
    loop
      v_n := coalesce((v_entry.value #>> '{}')::int, 0);
      if v_n > v_max then
        v_max := v_n;
        v_leader_count := 1;
        v_leader := v_entry.key;
      elsif v_n = v_max and v_max > 0 then
        v_leader_count := v_leader_count + 1;
      end if;
    end loop;

    if v_leader_count > 1 then
      v_tr := (v_tr || jsonb_build_object(
        'phase', 'speak',
        'speakRound', v_round + 1,
        'speakerIndex', 0,
        'votes', '{}'::jsonb,
        'revotePending', false,
        'revoteCount', 0,
        'tieAfterVote', true
      )) - 'impostorName' - 'impostorUid' - 'rolesByUid' - 'isLocalImpostor';
    elsif v_leader is null or v_max = 0 then
      raise exception 'TRAITRE_NO_MAJORITY';
    else
      select count(*) into v_imp_count
      from public.traitre_private
      where lobby_id = p_lobby_id
        and match_id = p_match_id
        and pair_id = v_pair
        and is_impostor is true;
      if v_imp_count <> 1 then
        raise exception 'TRAITRE_ROLE_MISSING';
      end if;
      select user_id into v_imp_uid
      from public.traitre_private
      where lobby_id = p_lobby_id
        and match_id = p_match_id
        and pair_id = v_pair
        and is_impostor is true
      limit 1;
      v_impostor_name := v_name_by_uid ->> v_imp_uid::text;
      if coalesce(v_impostor_name, '') = ''
         or not (
           public.traitre_text_in_jsonb_array(v_alive, v_impostor_name)
           or public.traitre_text_in_jsonb_array(coalesce(v_tr->'eliminated', '[]'::jsonb), v_impostor_name)
         )
      then
        raise exception 'TRAITRE_ROLE_MISSING';
      end if;

      v_eliminated_name := v_leader;
      select coalesce(jsonb_agg(elem.value order by elem.ord), '[]'::jsonb)
        into v_new_alive
      from jsonb_array_elements_text(v_alive) with ordinality as elem(value, ord)
      where elem.value <> v_eliminated_name;
      v_new_eliminated := coalesce(v_tr->'eliminated', '[]'::jsonb)
        || jsonb_build_array(v_eliminated_name);
      v_awards := coalesce(v_tr->'intuitionAwards', '{}'::jsonb);
      if jsonb_typeof(v_awards) <> 'object' then
        v_awards := '{}'::jsonb;
      end if;
      if v_eliminated_name is distinct from v_impostor_name
         and v_named_votes ->> v_eliminated_name = v_impostor_name
      then
        v_award_pts := coalesce((v_awards ->> v_eliminated_name)::int, 0) + v_pts_win;
        v_awards := jsonb_set(v_awards, array[v_eliminated_name], to_jsonb(v_award_pts), true);
      end if;
      v_survivals := coalesce((v_tr->>'voteSurvivals')::int, 0);

      v_tr := v_tr || jsonb_build_object(
        'eliminated', v_new_eliminated,
        'alive', v_new_alive,
        'lastEliminated', v_eliminated_name,
        'votes', '{}'::jsonb,
        'revotePending', false,
        'revoteCount', 0,
        'tieAfterVote', false,
        'intuitionAwards', v_awards
      );

      if v_eliminated_name = v_impostor_name then
        for v_entry in select key, value from jsonb_each(v_named_votes)
        loop
          v_voter_uid := v_uid_by_name ->> v_entry.key;
          v_target_uid := v_uid_by_name ->> (v_entry.value #>> '{}');
          v_snap := v_snap || jsonb_build_object(
            coalesce(v_voter_uid, v_entry.key),
            coalesce(v_target_uid, v_entry.value #>> '{}')
          );
        end loop;
        v_tr := v_tr || jsonb_build_object(
          'phase', 'final',
          'impostorRevealed', true,
          'winner', 'civilians',
          'lastVoteSnapshot', v_snap,
          'impostorName', v_impostor_name,
          'impostorUid', v_imp_uid::text,
          'scoresApplied', true
        );
      elsif jsonb_array_length(v_new_alive) <= 2
            and public.traitre_text_in_jsonb_array(v_new_alive, v_impostor_name)
      then
        v_tr := v_tr || jsonb_build_object(
          'phase', 'final',
          'impostorRevealed', true,
          'winner', 'traitre',
          'impostorName', v_impostor_name,
          'impostorUid', v_imp_uid::text,
          'scoresApplied', true
        );
      else
        v_tr := (v_tr || jsonb_build_object(
          'phase', 'speak',
          'speakRound', v_round + 1,
          'speakerIndex', 0,
          'voteSurvivals', v_survivals + 1
        )) - 'impostorName' - 'impostorUid' - 'rolesByUid' - 'isLocalImpostor';
      end if;

      if coalesce(v_tr->>'phase', '') = 'final' then
        if coalesce(v_tr->>'winner', '') = 'traitre' then
          v_pts := v_pts_bonus;
          v_who := v_impostor_name;
          v_label := 'Victoire fake';
          v_deltas_name := jsonb_set(v_deltas_name, array[v_who], to_jsonb(v_pts), true);
          v_breakdown := jsonb_set(
            v_breakdown,
            array[v_who],
            jsonb_build_array(jsonb_build_object('label', v_label, 'pts', v_pts)),
            true
          );
          if v_survivals > 0 then
            v_pts := v_survivals * v_pts_win;
            v_deltas_name := jsonb_set(
              v_deltas_name,
              array[v_who],
              to_jsonb(coalesce((v_deltas_name ->> v_who)::int, 0) + v_pts),
              true
            );
            v_breakdown := jsonb_set(
              v_breakdown,
              array[v_who],
              coalesce(v_breakdown->v_who, '[]'::jsonb)
                || jsonb_build_array(jsonb_build_object('label', 'Votes survécus', 'pts', v_pts)),
              true
            );
          end if;
        elsif coalesce(v_tr->>'winner', '') = 'civilians' then
          if v_survivals > 0 then
            v_pts := v_survivals * v_pts_win;
            v_deltas_name := jsonb_set(v_deltas_name, array[v_impostor_name], to_jsonb(v_pts), true);
            v_breakdown := jsonb_set(
              v_breakdown,
              array[v_impostor_name],
              jsonb_build_array(jsonb_build_object('label', 'Votes survécus', 'pts', v_pts)),
              true
            );
          end if;
          for v_name in select value from jsonb_array_elements_text(v_new_alive)
          loop
            v_pts := v_pts_win;
            v_deltas_name := jsonb_set(
              v_deltas_name,
              array[v_name],
              to_jsonb(coalesce((v_deltas_name ->> v_name)::int, 0) + v_pts),
              true
            );
            v_breakdown := jsonb_set(
              v_breakdown,
              array[v_name],
              coalesce(v_breakdown->v_name, '[]'::jsonb)
                || jsonb_build_array(jsonb_build_object('label', 'Survivant', 'pts', v_pts)),
              true
            );
            if v_named_votes ->> v_name = v_impostor_name then
              v_deltas_name := jsonb_set(
                v_deltas_name,
                array[v_name],
                to_jsonb(coalesce((v_deltas_name ->> v_name)::int, 0) + v_pts_bonus),
                true
              );
              v_breakdown := jsonb_set(
                v_breakdown,
                array[v_name],
                coalesce(v_breakdown->v_name, '[]'::jsonb)
                  || jsonb_build_array(jsonb_build_object('label', 'Détective', 'pts', v_pts_bonus)),
                true
              );
            end if;
          end loop;
        end if;

        for v_entry in select key, value from jsonb_each(v_awards)
        loop
          v_award_pts := coalesce((v_entry.value #>> '{}')::int, 0);
          if v_award_pts > 0 then
            v_deltas_name := jsonb_set(
              v_deltas_name,
              array[v_entry.key],
              to_jsonb(coalesce((v_deltas_name ->> v_entry.key)::int, 0) + v_award_pts),
              true
            );
            v_breakdown := jsonb_set(
              v_breakdown,
              array[v_entry.key],
              coalesce(v_breakdown->v_entry.key, '[]'::jsonb)
                || jsonb_build_array(jsonb_build_object('label', 'Bonne intuition', 'pts', v_award_pts)),
              true
            );
          end if;
        end loop;

        v_tr := v_tr || jsonb_build_object(
          'lastRound', jsonb_build_object(
            'deltas', v_deltas_name,
            'breakdown', v_breakdown,
            'winner', v_tr->>'winner',
            'impostorName', v_impostor_name,
            'voteSurvivals', v_survivals,
            'pairId', v_pair
          )
        );

        for v_entry in select key, value from jsonb_each(v_deltas_name)
        loop
          v_member_uid := v_uid_by_name ->> v_entry.key;
          if v_member_uid is null then
            continue;
          end if;
          v_uid_deltas := jsonb_set(
            v_uid_deltas,
            array[v_member_uid],
            v_entry.value,
            true
          );
        end loop;

        v_scores := public.traitre_add_score_deltas(v_state->'scores', v_uid_deltas);
        v_game_scores := coalesce(v_state->'gameScores', '{}'::jsonb);
        if jsonb_typeof(v_game_scores) <> 'object' then
          v_game_scores := '{}'::jsonb;
        end if;
        v_traitre_scores := public.traitre_add_score_deltas(v_game_scores->'traitre', v_uid_deltas);
        v_game_scores := jsonb_set(v_game_scores, '{traitre}', v_traitre_scores, true);

        v_player_stats := coalesce(v_state->'playerStats', '{}'::jsonb);
        if jsonb_typeof(v_player_stats) <> 'object' then
          v_player_stats := '{}'::jsonb;
        end if;
        for v_entry in select key, value from jsonb_each(v_breakdown)
        loop
          if v_entry.key = v_impostor_name then
            continue;
          end if;
          if v_entry.value::text like '%Détective%' then
            v_member_uid := v_uid_by_name ->> v_entry.key;
            if v_member_uid is null then
              continue;
            end if;
            v_stat_row := coalesce(v_player_stats->v_member_uid, '{}'::jsonb);
            v_stat_row := jsonb_set(
              v_stat_row,
              '{traitreDetections}',
              to_jsonb(coalesce((v_stat_row->>'traitreDetections')::int, 0) + 1),
              true
            );
            v_player_stats := jsonb_set(v_player_stats, array[v_member_uid], v_stat_row, true);
          end if;
        end loop;
        if coalesce(v_tr->>'winner', '') = 'traitre'
           and coalesce((v_deltas_name ->> v_impostor_name)::int, 0) > 0
        then
          v_member_uid := v_uid_by_name ->> v_impostor_name;
          if v_member_uid is not null then
            v_stat_row := coalesce(v_player_stats->v_member_uid, '{}'::jsonb);
            v_stat_row := jsonb_set(
              v_stat_row,
              '{traitreWins}',
              to_jsonb(coalesce((v_stat_row->>'traitreWins')::int, 0) + 1),
              true
            );
            v_player_stats := jsonb_set(v_player_stats, array[v_member_uid], v_stat_row, true);
          end if;
        end if;

        v_evening := coalesce(v_state->'eveningGamesRecorded', '{}'::jsonb);
        if jsonb_typeof(v_evening) <> 'object' then
          v_evening := '{}'::jsonb;
        end if;
        v_stats := coalesce(v_state->'stats', '{}'::jsonb);
        if jsonb_typeof(v_stats) <> 'object' then
          v_stats := '{}'::jsonb;
        end if;
        if coalesce((v_evening->>'traitre')::boolean, false) is not true then
          v_stats := jsonb_set(
            v_stats,
            '{traitreGamesPlayed}',
            to_jsonb(coalesce((v_stats->>'traitreGamesPlayed')::int, 0) + 1),
            true
          );
          v_evening := v_evening || jsonb_build_object('traitre', true);
        end if;
        v_order := coalesce(v_state->'gameScoreOrder', '[]'::jsonb);
        if jsonb_typeof(v_order) <> 'array' then
          v_order := '[]'::jsonb;
        end if;
        if not (v_order @> '["traitre"]'::jsonb) then
          v_order := v_order || '["traitre"]'::jsonb;
        end if;
        if coalesce(v_tr->>'winner', '') = 'traitre' then
          v_summary := 'Victoire du fake · ' || v_impostor_name;
        else
          v_summary := 'Fake éliminé · ' || v_eliminated_name;
        end if;
        v_last_game := jsonb_build_object(
          'gameId', 'traitre',
          'title', 'Spot the fake',
          'summary', v_summary,
          'at', (extract(epoch from clock_timestamp()) * 1000)::bigint
        );
        v_state := v_state || jsonb_build_object(
          'scores', v_scores,
          'gameScores', v_game_scores,
          'playerStats', v_player_stats,
          'eveningGamesRecorded', v_evening,
          'gameScoreOrder', v_order,
          'stats', v_stats,
          'lastGame', v_last_game
        );
      end if;
    end if;
  end if;

  v_state := jsonb_set(v_state, '{traitre}', v_tr, true);
  update public.game_sessions
  set state = v_state
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.advance_traitre_play(uuid, uuid, text, text, int, text, int, boolean) from public;
revoke all on function public.advance_traitre_play(uuid, uuid, text, text, int, text, int, boolean) from anon;
grant execute on function public.advance_traitre_play(uuid, uuid, text, text, int, text, int, boolean) to authenticated;

notify pgrst, 'reload schema';
