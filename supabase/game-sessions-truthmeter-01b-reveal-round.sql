-- BUG-TRUTHMETER-01B — reveal / scoring atomique + submit vote + auto-reveal
-- Réexécutable. Exécuter dans le SQL Editor Supabase après i08-arch03 (contribute + affirmation).
--
-- Contrats :
--   • truth_meter_apply_reveal_scoring : règles miroir awardTruthMeterRound (client)
--   • reveal_truth_meter_round : hôte / acting host, FOR UPDATE, idempotent
--   • submit_truth_meter_vote : membre, FOR UPDATE, rejet post-reveal, auto-reveal si tous ont voté
--
-- Divergence volontaire vs JS (documentée) :
--   mindReader (libellé) en cas d'égalité de distance : uid ASC (JS = ordre Object.entries).
--   Les points attribués aux ex-æquo restent identiques.
--
-- Clés remote : votes / matchScores / lastRound.deltas / mindReader en UID text.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.truth_meter_parse_uuid_text(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_text is null or length(trim(p_text)) = 0 then
    return null;
  end if;
  return trim(p_text)::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

create or replace function public.truth_meter_jsonb_is_number(p jsonb)
returns boolean
language sql
immutable
as $$
  select p is not null and jsonb_typeof(p) = 'number';
$$;

-- Joueurs votants attendus = lobby_members sauf auteur (UID text[])
create or replace function public.truth_meter_expected_voter_uids(
  p_lobby_id uuid,
  p_tm jsonb
)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_author_name text;
  v_author_uid text;
  v_uids text[];
begin
  v_author_name := nullif(trim(coalesce(p_tm #>> '{affirmation,author}', '')), '');

  if v_author_name is not null then
    select lm.user_id::text into v_author_uid
    from public.lobby_members lm
    where lm.lobby_id = p_lobby_id
      and lm.display_name = v_author_name
    limit 1;
  end if;

  select coalesce(array_agg(lm.user_id::text order by lm.user_id::text), '{}'::text[])
    into v_uids
  from public.lobby_members lm
  where lm.lobby_id = p_lobby_id
    and (v_author_uid is null or lm.user_id::text is distinct from v_author_uid);

  return v_uids;
end;
$$;

create or replace function public.truth_meter_all_expected_voters_voted(
  p_lobby_id uuid,
  p_tm jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_expected text[];
  v_votes jsonb;
  v_uid text;
  v_val jsonb;
begin
  v_expected := public.truth_meter_expected_voter_uids(p_lobby_id, p_tm);
  if coalesce(array_length(v_expected, 1), 0) = 0 then
    return false;
  end if;

  v_votes := coalesce(p_tm -> 'votes', '{}'::jsonb);

  foreach v_uid in array v_expected
  loop
    v_val := v_votes -> v_uid;
    if not public.truth_meter_jsonb_is_number(v_val) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scoring partagé (force reveal + auto-reveal) — miroir awardTruthMeterRound
-- Constantes : BLUFF_GAP=40, CONSENSUS_GAP=12, CLOSE_DIST=12, BONUS=15, WIN=10
-- ---------------------------------------------------------------------------

create or replace function public.truth_meter_apply_reveal_scoring(
  p_lobby_id uuid,
  p_tm jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tm jsonb := p_tm;
  v_votes jsonb;
  v_match jsonb;
  v_author_name text;
  v_author_uid text;
  v_est numeric;
  v_sum numeric := 0;
  v_n int := 0;
  v_avg int := 0;
  v_gap int := 0;
  v_rec record;
  v_best_dist numeric;
  v_pts int;
  v_deltas jsonb := '{}'::jsonb;
  v_mind text;
  v_author_pts int := 0;
  v_voter_pts int := 0;
  v_bluff boolean := false;
  v_consensus boolean := false;
  v_last jsonb;
  v_const_bluff constant int := 40;
  v_const_consensus constant int := 12;
  v_const_close constant int := 12;
  v_const_bonus constant int := 15;
  v_const_win constant int := 10;
begin
  v_votes := coalesce(v_tm -> 'votes', '{}'::jsonb);
  v_match := coalesce(v_tm -> 'matchScores', '{}'::jsonb);
  if jsonb_typeof(v_match) <> 'object' then
    v_match := '{}'::jsonb;
  end if;

  v_author_name := nullif(trim(coalesce(v_tm #>> '{affirmation,author}', '')), '');
  if v_author_name is not null then
    select lm.user_id::text into v_author_uid
    from public.lobby_members lm
    where lm.lobby_id = p_lobby_id
      and lm.display_name = v_author_name
    limit 1;
  end if;

  begin
    v_est := (v_tm ->> 'authorEstimate')::numeric;
  exception
    when others then
      v_est := 0;
  end;
  if v_est is null then
    v_est := 0;
  end if;

  -- Moyenne des votes numériques hors auteur (force reveal : absents ignorés)
  for v_rec in
    select e.key as uid, (e.value)::text::numeric as val
    from jsonb_each(v_votes) e
    where public.truth_meter_jsonb_is_number(e.value)
      and (v_author_uid is null or e.key is distinct from v_author_uid)
  loop
    v_sum := v_sum + v_rec.val;
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    v_avg := round(v_sum / v_n)::int;
  else
    v_avg := 0;
  end if;

  v_gap := abs(round(v_est)::int - v_avg);

  -- Auteur : bluff XOR consensus XOR 0
  if v_author_uid is not null then
    if v_gap >= v_const_bluff then
      v_bluff := true;
      v_author_pts := v_const_bonus;
      v_deltas := jsonb_set(v_deltas, array[v_author_uid], to_jsonb(v_const_bonus), true);
      v_match := jsonb_set(
        v_match,
        array[v_author_uid],
        to_jsonb(coalesce((v_match ->> v_author_uid)::numeric, 0) + v_const_bonus),
        true
      );
    elsif v_gap <= v_const_consensus then
      v_consensus := true;
      v_author_pts := v_const_win;
      v_deltas := jsonb_set(v_deltas, array[v_author_uid], to_jsonb(v_const_win), true);
      v_match := jsonb_set(
        v_match,
        array[v_author_uid],
        to_jsonb(coalesce((v_match ->> v_author_uid)::numeric, 0) + v_const_win),
        true
      );
    end if;
  end if;

  -- Votants les plus proches de groupAvg (tous les ex-æquo)
  select min(abs(x.val - v_avg)) into v_best_dist
  from (
    select (e.value)::text::numeric as val
    from jsonb_each(v_votes) e
    where public.truth_meter_jsonb_is_number(e.value)
      and (v_author_uid is null or e.key is distinct from v_author_uid)
  ) x;

  if v_best_dist is not null then
    if v_best_dist <= v_const_close then
      v_pts := v_const_bonus;
    else
      v_pts := v_const_win;
    end if;
    v_voter_pts := v_pts;

    for v_rec in
      select e.key as uid
      from jsonb_each(v_votes) e
      where public.truth_meter_jsonb_is_number(e.value)
        and (v_author_uid is null or e.key is distinct from v_author_uid)
        and abs((e.value)::text::numeric - v_avg) <= v_best_dist + 1e-9
      order by e.key asc
    loop
      if v_mind is null then
        v_mind := v_rec.uid;
      end if;
      v_deltas := jsonb_set(
        v_deltas,
        array[v_rec.uid],
        to_jsonb(coalesce((v_deltas ->> v_rec.uid)::numeric, 0) + v_pts),
        true
      );
      v_match := jsonb_set(
        v_match,
        array[v_rec.uid],
        to_jsonb(coalesce((v_match ->> v_rec.uid)::numeric, 0) + v_pts),
        true
      );
    end loop;
  end if;

  if v_deltas = '{}'::jsonb then
    v_last := null;
  else
    v_last := jsonb_build_object(
      'bluffWin', v_bluff,
      'consensus', v_consensus,
      'mindReader', to_jsonb(v_mind),
      'gap', v_gap,
      'groupAvg', v_avg,
      'authorPoints', v_author_pts,
      'voterPoints', v_voter_pts,
      'deltas', v_deltas
    );
  end if;

  v_tm := v_tm || jsonb_build_object(
    'phase', 'reveal',
    'roundScored', true,
    'voteEndsAt', null,
    'matchScores', v_match,
    'lastRound', v_last
  );

  return v_tm;
end;
$$;

-- ---------------------------------------------------------------------------
-- reveal_truth_meter_round
-- ---------------------------------------------------------------------------

create or replace function public.reveal_truth_meter_round(
  p_lobby_id uuid,
  p_run_id uuid,
  p_round_idx integer
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_tm jsonb;
  v_run_id uuid;
  v_cur_idx int;
  v_phase text;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  perform public.assert_lobby_member(p_lobby_id);

  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    raise exception 'Action réservée à l''hôte ou à l''acting host.';
  end if;

  if p_run_id is null then
    raise exception 'TRUTHMETER_STALE_RUN';
  end if;
  if p_round_idx is null then
    raise exception 'TRUTHMETER_STALE_ROUND';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_row.game_id is distinct from 'truthmeter' then
    raise exception 'TRUTHMETER_INVALID_PHASE';
  end if;

  v_tm := v_row.state -> 'truthMeter';
  if v_tm is null or jsonb_typeof(v_tm) <> 'object' then
    raise exception 'TRUTHMETER_INVALID_STATE';
  end if;

  if jsonb_typeof(v_tm -> 'lobbyStarted') <> 'boolean'
     or (v_tm -> 'lobbyStarted')::boolean is not true then
    raise exception 'TRUTHMETER_INVALID_PHASE';
  end if;

  v_run_id := public.truth_meter_parse_uuid_text(v_tm ->> 'runId');
  if v_run_id is null then
    raise exception 'TRUTHMETER_RUN_REQUIRED';
  end if;

  begin
    v_cur_idx := (v_tm ->> 'roundIdx')::int;
  exception
    when others then
      raise exception 'TRUTHMETER_INVALID_STATE';
  end;

  v_phase := v_tm ->> 'phase';

  if v_run_id <> p_run_id then
    raise exception 'TRUTHMETER_STALE_RUN';
  end if;

  if v_cur_idx is distinct from p_round_idx then
    raise exception 'TRUTHMETER_STALE_ROUND';
  end if;

  -- Idempotence
  if v_phase = 'reveal'
     and coalesce((v_tm ->> 'roundScored')::boolean, false) then
    return v_row;
  end if;

  if v_phase is distinct from 'voting'
     and v_phase is distinct from 'reveal-pending' then
    raise exception 'TRUTHMETER_INVALID_PHASE';
  end if;

  v_tm := public.truth_meter_apply_reveal_scoring(p_lobby_id, v_tm);

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        '{truthMeter}',
        v_tm,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_truth_meter_vote — vote atomique + auto-reveal Option A
-- ---------------------------------------------------------------------------

create or replace function public.submit_truth_meter_vote(
  p_lobby_id uuid,
  p_run_id uuid,
  p_round_idx integer,
  p_value numeric
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_uid_text text;
  v_row public.game_sessions;
  v_tm jsonb;
  v_run_id uuid;
  v_cur_idx int;
  v_phase text;
  v_author_name text;
  v_author_uid text;
  v_path text[];
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  perform public.assert_lobby_member(p_lobby_id);
  v_uid_text := v_uid::text;

  if p_run_id is null then
    raise exception 'TRUTHMETER_STALE_RUN';
  end if;
  if p_round_idx is null then
    raise exception 'TRUTHMETER_STALE_ROUND';
  end if;
  if p_value is null or p_value < 0 or p_value > 100 then
    raise exception 'TRUTHMETER_INVALID_STATE';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_row.game_id is distinct from 'truthmeter' then
    raise exception 'TRUTHMETER_INVALID_PHASE';
  end if;

  v_tm := v_row.state -> 'truthMeter';
  if v_tm is null or jsonb_typeof(v_tm) <> 'object' then
    raise exception 'TRUTHMETER_INVALID_STATE';
  end if;

  if jsonb_typeof(v_tm -> 'lobbyStarted') <> 'boolean'
     or (v_tm -> 'lobbyStarted')::boolean is not true then
    raise exception 'TRUTHMETER_INVALID_PHASE';
  end if;

  v_run_id := public.truth_meter_parse_uuid_text(v_tm ->> 'runId');
  if v_run_id is null then
    raise exception 'TRUTHMETER_RUN_REQUIRED';
  end if;

  begin
    v_cur_idx := (v_tm ->> 'roundIdx')::int;
  exception
    when others then
      raise exception 'TRUTHMETER_INVALID_STATE';
  end;

  v_phase := v_tm ->> 'phase';

  if v_run_id <> p_run_id then
    raise exception 'TRUTHMETER_STALE_RUN';
  end if;

  if v_cur_idx is distinct from p_round_idx then
    raise exception 'TRUTHMETER_STALE_ROUND';
  end if;

  -- Post-reveal : même valeur → idempotent ; sinon rejet métier
  if v_phase = 'reveal'
     and coalesce((v_tm ->> 'roundScored')::boolean, false) then
    if public.truth_meter_jsonb_is_number(v_tm -> 'votes' -> v_uid_text)
       and abs((v_tm -> 'votes' ->> v_uid_text)::numeric - p_value) < 1e-9 then
      return v_row;
    end if;
    raise exception 'TRUTHMETER_INVALID_PHASE';
  end if;

  if v_phase is distinct from 'voting'
     and v_phase is distinct from 'display' then
    -- reveal-pending : trop tard pour un nouveau vote
    raise exception 'TRUTHMETER_INVALID_PHASE';
  end if;

  v_author_name := nullif(trim(coalesce(v_tm #>> '{affirmation,author}', '')), '');
  if v_author_name is not null then
    select lm.user_id::text into v_author_uid
    from public.lobby_members lm
    where lm.lobby_id = p_lobby_id
      and lm.display_name = v_author_name
    limit 1;
  end if;

  if v_author_uid is not null and v_uid_text = v_author_uid then
    raise exception 'TRUTHMETER_INVALID_STATE';
  end if;

  v_path := array['truthMeter', 'votes', v_uid_text];

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        v_path,
        to_jsonb(p_value),
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  v_tm := v_row.state -> 'truthMeter';

  -- Auto-reveal Option A : tous les votants attendus ont un vote numérique
  if v_phase = 'voting'
     and public.truth_meter_all_expected_voters_voted(p_lobby_id, v_tm) then
    v_tm := public.truth_meter_apply_reveal_scoring(p_lobby_id, v_tm);
    update public.game_sessions gs
    set state = jsonb_set(
          coalesce(gs.state, '{}'::jsonb),
          '{truthMeter}',
          v_tm,
          true
        )
    where gs.lobby_id = p_lobby_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.truth_meter_parse_uuid_text(text) from public;
revoke all on function public.truth_meter_jsonb_is_number(jsonb) from public;
revoke all on function public.truth_meter_expected_voter_uids(uuid, jsonb) from public;
revoke all on function public.truth_meter_all_expected_voters_voted(uuid, jsonb) from public;
revoke all on function public.truth_meter_apply_reveal_scoring(uuid, jsonb) from public;
revoke all on function public.reveal_truth_meter_round(uuid, uuid, integer) from public;
revoke all on function public.submit_truth_meter_vote(uuid, uuid, integer, numeric) from public;

grant execute on function public.truth_meter_parse_uuid_text(text) to authenticated;
grant execute on function public.truth_meter_jsonb_is_number(jsonb) to authenticated;
grant execute on function public.truth_meter_expected_voter_uids(uuid, jsonb) to authenticated;
grant execute on function public.truth_meter_all_expected_voters_voted(uuid, jsonb) to authenticated;
grant execute on function public.truth_meter_apply_reveal_scoring(uuid, jsonb) to authenticated;
grant execute on function public.reveal_truth_meter_round(uuid, uuid, integer) to authenticated;
grant execute on function public.submit_truth_meter_vote(uuid, uuid, integer, numeric) to authenticated;

comment on function public.reveal_truth_meter_round(uuid, uuid, integer) is
  'BUG-TRUTHMETER-01B — reveal/scoring atomique (FOR UPDATE). Payload client = lobby/run/round uniquement.';
comment on function public.submit_truth_meter_vote(uuid, uuid, integer, numeric) is
  'BUG-TRUTHMETER-01B — vote atomique + auto-reveal si tous les votants attendus ont voté.';
comment on function public.truth_meter_apply_reveal_scoring(uuid, jsonb) is
  'BUG-TRUTHMETER-01B — scoring partagé force/auto-reveal (miroir awardTruthMeterRound).';
