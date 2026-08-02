-- BUG-TRUTHMETER-02 — identité auteur canonique (authorUid)
--
-- authorUid est désormais canonique.
-- Le fallback par display_name (affirmation.author / authorOrder legacy) est temporaire.
-- Les doublons de display_name doivent échouer (NULL / exception) — jamais LIMIT 1.
--
-- Compatibilité : lectures legacy conservées. Nouvelles affirmations écrivent authorUid.
-- Ne change pas la sémantique publique vote/reveal (01A/01B) : mêmes codes d'erreur,
-- mêmes gardes runId/phase, idempotence, scoring serveur indexé par UID.

-- ---------------------------------------------------------------------------
-- Résolution auteur : authorUid → authorOrder[idx] UID → legacy name unique
-- ---------------------------------------------------------------------------

create or replace function public.truth_meter_resolve_author_uid(
  p_lobby_id uuid,
  p_tm jsonb
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid text;
  v_name text;
  v_idx int;
  v_entry text;
  v_cnt int;
begin
  -- 1) Canonique : affirmation.authorUid (doit appartenir au lobby)
  v_uid := nullif(trim(coalesce(p_tm #>> '{affirmation,authorUid}', '')), '');
  if v_uid is not null then
    if exists (
      select 1
      from public.lobby_members lm
      where lm.lobby_id = p_lobby_id
        and lm.user_id::text = v_uid
    ) then
      return v_uid;
    end if;
    -- UID présent mais hors lobby : irrésoluble (pas de bascule vers author snapshot)
    return null;
  end if;

  -- 2) authorOrder[roundIdx] si UID membre, sinon legacy name unique
  begin
    v_idx := coalesce((p_tm ->> 'roundIdx')::int, 0);
  exception
    when others then
      v_idx := 0;
  end;

  v_entry := nullif(trim(coalesce(p_tm -> 'authorOrder' ->> v_idx, '')), '');
  if v_entry is not null then
    if exists (
      select 1
      from public.lobby_members lm
      where lm.lobby_id = p_lobby_id
        and lm.user_id::text = v_entry
    ) then
      return v_entry;
    end if;

    select count(*)::int, min(lm.user_id::text)
      into v_cnt, v_uid
    from public.lobby_members lm
    where lm.lobby_id = p_lobby_id
      and lm.display_name = v_entry;

    if v_cnt = 1 then
      return v_uid;
    end if;
    -- 0 ou >1 : irrésoluble / ambigu — ne jamais choisir le premier
    if v_cnt > 1 then
      return null;
    end if;
  end if;

  -- 3) Fallback temporaire : affirmation.author (correspondance unique obligatoire)
  v_name := nullif(trim(coalesce(p_tm #>> '{affirmation,author}', '')), '');
  if v_name is not null then
    select count(*)::int, min(lm.user_id::text)
      into v_cnt, v_uid
    from public.lobby_members lm
    where lm.lobby_id = p_lobby_id
      and lm.display_name = v_name;

    if v_cnt = 1 then
      return v_uid;
    end if;
  end if;

  return null;
end;
$$;

comment on function public.truth_meter_resolve_author_uid(uuid, jsonb) is
  'BUG-TRUTHMETER-02: resolve TruthMeter author UID. authorUid canonical; unique display_name legacy fallback only; never LIMIT 1 on duplicates.';

-- ---------------------------------------------------------------------------
-- Expected voters : exclure l'auteur résolu ; bloquer all-in si irrésoluble
-- ---------------------------------------------------------------------------

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
  v_author_uid text;
  v_uids text[];
begin
  v_author_uid := public.truth_meter_resolve_author_uid(p_lobby_id, p_tm);

  -- Affirmation présente mais auteur irrésoluble → aucun votant attendu
  -- (bloque auto-reveal / all-in plutôt que d'inclure l'auteur par erreur).
  if p_tm -> 'affirmation' is not null
     and jsonb_typeof(p_tm -> 'affirmation') = 'object'
     and v_author_uid is null then
    return '{}'::text[];
  end if;

  select coalesce(array_agg(lm.user_id::text order by lm.user_id::text), '{}'::text[])
    into v_uids
  from public.lobby_members lm
  where lm.lobby_id = p_lobby_id
    and (v_author_uid is null or lm.user_id::text is distinct from v_author_uid);

  return v_uids;
end;
$$;

-- ---------------------------------------------------------------------------
-- Scoring reveal : résolution via resolve (pas de LIMIT 1 sur display_name)
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

  v_author_uid := public.truth_meter_resolve_author_uid(p_lobby_id, v_tm);
  if v_tm -> 'affirmation' is not null
     and jsonb_typeof(v_tm -> 'affirmation') = 'object'
     and v_author_uid is null then
    raise exception 'TRUTHMETER_INVALID_STATE';
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
-- Soumission affirmation : auteur attendu = authorOrder[roundIdx] (UID)
-- ---------------------------------------------------------------------------

create or replace function public.submit_truth_meter_affirmation(
  p_lobby_id uuid,
  p_text text,
  p_author_estimate numeric
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_uid_text text;
  v_name text;
  v_row public.game_sessions;
  v_tm jsonb;
  v_phase text;
  v_expected_uid text;
  v_idx int;
  v_entry text;
  v_cnt int;
  v_clean text;
  v_patch jsonb;
  v_affirmation jsonb;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);
  v_uid_text := v_uid::text;

  select display_name into v_name
  from public.lobby_members
  where lobby_id = p_lobby_id and user_id = v_uid;

  v_clean := left(trim(coalesce(p_text, '')), 160);
  if length(v_clean) < 1 then
    raise exception 'Affirmation vide.';
  end if;

  if p_author_estimate is null or p_author_estimate < 0 or p_author_estimate > 100 then
    raise exception 'Estimation invalide (0–100).';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_row.game_id is distinct from 'truthmeter' then
    raise exception 'Session Truth Meter requise.';
  end if;

  v_tm := coalesce(v_row.state -> 'truthMeter', '{}'::jsonb);
  v_phase := v_tm ->> 'phase';
  if v_phase is distinct from 'writing' then
    raise exception 'Affirmation uniquement en phase writing (phase %).', v_phase;
  end if;

  begin
    v_idx := coalesce((v_tm ->> 'roundIdx')::int, 0);
  exception
    when others then
      v_idx := 0;
  end;

  v_entry := nullif(trim(coalesce(v_tm -> 'authorOrder' ->> v_idx, '')), '');
  if v_entry is null then
    raise exception 'Seul l''auteur du round peut soumettre l''affirmation.';
  end if;

  -- Attendu : UID dans authorOrder, ou legacy name unique
  if exists (
    select 1 from public.lobby_members lm
    where lm.lobby_id = p_lobby_id and lm.user_id::text = v_entry
  ) then
    v_expected_uid := v_entry;
  else
    select count(*)::int, min(lm.user_id::text)
      into v_cnt, v_expected_uid
    from public.lobby_members lm
    where lm.lobby_id = p_lobby_id
      and lm.display_name = v_entry;
    if v_cnt <> 1 then
      raise exception 'Seul l''auteur du round peut soumettre l''affirmation.';
    end if;
  end if;

  if v_expected_uid is distinct from v_uid_text then
    raise exception 'Seul l''auteur du round peut soumettre l''affirmation.';
  end if;

  -- authorUid canonique + author snapshot cosmétique (compat legacy)
  v_affirmation := jsonb_build_object(
    'text', v_clean,
    'authorUid', v_uid_text,
    'author', coalesce(v_name, v_uid_text)
  );

  v_patch := jsonb_build_object(
    'affirmation', v_affirmation,
    'authorEstimate', p_author_estimate,
    'phase', 'display',
    'votes', '{}'::jsonb,
    'roundScored', false
  );

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        '{truthMeter}',
        coalesce(gs.state -> 'truthMeter', '{}'::jsonb) || v_patch,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vote : même corps 01B ; seule la résolution auteur passe par truth_meter_resolve_author_uid
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

  -- BUG-TRUTHMETER-02 : authorUid canonique (plus LIMIT 1 sur display_name)
  v_author_uid := public.truth_meter_resolve_author_uid(p_lobby_id, v_tm);

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

revoke all on function public.truth_meter_resolve_author_uid(uuid, jsonb) from public;
grant execute on function public.truth_meter_resolve_author_uid(uuid, jsonb) to authenticated;

revoke all on function public.truth_meter_expected_voter_uids(uuid, jsonb) from public;
grant execute on function public.truth_meter_expected_voter_uids(uuid, jsonb) to authenticated;

revoke all on function public.submit_truth_meter_affirmation(uuid, text, numeric) from public;
grant execute on function public.submit_truth_meter_affirmation(uuid, text, numeric) to authenticated;

revoke all on function public.submit_truth_meter_vote(uuid, uuid, integer, numeric) from public;
grant execute on function public.submit_truth_meter_vote(uuid, uuid, integer, numeric) to authenticated;
