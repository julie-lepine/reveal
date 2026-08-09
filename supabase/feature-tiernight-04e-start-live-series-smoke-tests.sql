-- =============================================================================
-- FEATURE-TIERNIGHT-04E — SMOKE A2 (tests R1–R18) start_tiernight_live_series
-- =============================================================================
--
-- Prérequis : A1 SUCCESS (helpers + tn04ea_smoke_ctx + fixture TN04EA% présents).
--   A1 : supabase/feature-tiernight-04e-start-live-series-smoke-bootstrap.sql
--
-- Ce fichier :
--   1) Assert A1 state (ctx + lobby + session + screen)
--   2) R1 (vérifie la fixture A1) puis R2–R18
--   3) Cleanup fixtures + drop helpers + drop table ctx + legacy tn04e_*
--
-- Si un test mid-script échoue, le cleanup final ne tourne pas — intentionnel
-- (état A1 reste pour diagnostic). Cleanup d'urgence :
--   supabase/feature-tiernight-04e-start-live-series-smoke-cleanup.sql
--
-- Fixtures : lobbies.code LIKE 'TN04EA%' uniquement (+ legacy nommé TN04EG%).
-- Aucun CREATE OR REPLACE de RPC produit. Aucun CASCADE.
-- Context via record + select into strict (pas de %ROWTYPE sur tn04ea_smoke_ctx ;
-- `public.game_sessions` référencé par son nom composite direct, cf. R3/R4/R10/R12/R17).
-- =============================================================================

-- ############################################################################
-- A2.0 — Assert A1 prerequisite
-- ############################################################################

do $$
declare
  c record;
begin
  if to_regclass('public.tn04ea_smoke_ctx') is null then
    raise exception 'TN04EA_A1_REQUIRED — run smoke-bootstrap.sql first';
  end if;

  select * into c from public.tn04ea_smoke_ctx where id = 1;
  if not found then
    raise exception 'TN04EA_A1_REQUIRED — ctx id=1 missing';
  end if;

  if c.lobby_id is null or c.host_id is null or c.guest_id is null or c.session_id is null then
    raise exception 'TN04EA_A1_REQUIRED — ctx colonnes nulles';
  end if;

  if c.code is null or c.code not like 'TN04EA%' then
    raise exception 'TN04EA_A1_REQUIRED — lobby code LIKE TN04EA%% got %', c.code;
  end if;

  if not exists (select 1 from public.lobbies where id = c.lobby_id and code like 'TN04EA%') then
    raise exception 'TN04EA_A1_REQUIRED — lobby absent';
  end if;

  if not exists (
    select 1 from public.game_sessions where id = c.session_id and lobby_id = c.lobby_id
  ) then
    raise exception 'TN04EA_A1_REQUIRED — session absente';
  end if;

  if not exists (
    select 1 from public.game_sessions
    where id = c.session_id and screen = 'tiernight-live-prep'
  ) then
    raise exception 'TN04EA_A1_REQUIRED — screen attendu tiernight-live-prep';
  end if;

  raise notice 'TN04EA A2 — A1 state OK ; démarrage R1–R18';
end $$;

-- Preuve visible (même shape que fin A1 ; pas de secrets)
select
  to_regclass('public.tn04ea_smoke_ctx') as ctx_table,
  (select count(*) from public.tn04ea_smoke_ctx) as ctx_rows,
  c.lobby_id,
  c.session_id,
  c.code
from public.tn04ea_smoke_ctx c
where c.id = 1;

-- ############################################################################
-- R1) Vérifie la fixture A1 toujours présente — prep ouverte C=0 N=3
-- ############################################################################
-- Pas de respawn ici : la fixture spawnée en A1.3 doit encore exister à
-- l'identique (même lobby/session) tant qu'aucun test n'a encore tourné.
-- ############################################################################

do $$
declare
  c record;
  v_screen text;
  v_state jsonb;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;

  if c.lobby_id is null or c.host_id is null or c.guest_id is null or c.session_id is null then
    raise exception 'R1 ctx colonnes nulles';
  end if;
  if c.code is null or c.code not like 'TN04EA%' then
    raise exception 'R1 code invalide %', c.code;
  end if;

  select screen, state into v_screen, v_state
  from public.game_sessions where id = c.session_id;

  if v_screen is distinct from 'tiernight-live-prep' then
    raise exception 'R1 screen attendu tiernight-live-prep got %', v_screen;
  end if;
  if (v_state -> 'tierNightLivePrep' ->> 'roundCount')::int is distinct from 3 then
    raise exception 'R1 roundCount attendu 3';
  end if;
  if (v_state -> 'tierNightLivePrep' ->> 'setupEpoch')::int is distinct from 0 then
    raise exception 'R1 setupEpoch attendu 0';
  end if;
  if (v_state -> 'customLiveTierLists') is distinct from '[]'::jsonb then
    raise exception 'R1 customLiveTierLists attendu []';
  end if;
  if (v_state ->> 'customLiveTierListsWritable')::boolean is not true then
    raise exception 'R1 customLiveTierListsWritable attendu true';
  end if;

  raise notice 'R1 OK — fixture A1 toujours présente, prep ouverte C=0 N=3 (lobby=%, session=%)', c.lobby_id, c.session_id;
end $$;

-- ############################################################################
-- R2) Guest ne peut pas lancer → TNS_LIVE_HOST_REQUIRED (+ outsider si dispo)
-- ############################################################################

do $$
declare
  c record;
  v_series jsonb;
  v_screen_before text;
  v_screen_after text;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  v_series := public.tn04ea_series(
    'run-' || c.code, 3,
    jsonb_build_array(
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C')
    )
  );

  select screen into v_screen_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.guest_id);
  begin
    perform public.start_tiernight_live_series(c.lobby_id, 0, v_series);
    raise exception 'R2 aurait dû échouer (guest)';
  exception when others then
    v_err := SQLERRM;
    if position('R2 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_HOST_REQUIRED', 'R2 guest');
  end;

  select screen into v_screen_after from public.game_sessions where id = c.session_id;
  if v_screen_after is distinct from v_screen_before then
    raise exception 'R2 screen muté malgré échec attendu';
  end if;

  if c.outsider_id is not null then
    perform public.tn04ea_set_jwt(c.outsider_id);
    begin
      perform public.start_tiernight_live_series(c.lobby_id, 0, v_series);
      raise exception 'R2 aurait dû échouer (outsider)';
    exception when others then
      v_err := SQLERRM;
      if position('R2 aurait dû échouer' in v_err) > 0 then raise; end if;
      -- Non-membre : assert_lobby_member échoue AVANT le check host —
      -- ne doit PAS être HOST_REQUIRED (preuve de l'ordre des gardes).
      if position('TNS_LIVE_HOST_REQUIRED' in v_err) > 0 then
        raise exception 'R2 outsider a atteint le check host (assert_lobby_member contourné) : %', v_err;
      end if;
    end;
    raise notice 'R2 OK — guest HOST_REQUIRED ; outsider rejeté en amont (non-membre)';
  else
    raise notice 'R2 OK — guest HOST_REQUIRED (outsider ignoré : 3e auth.user indisponible)';
  end if;
end $$;

-- ############################################################################
-- R3) Host success — C=0 N=3 tout officiel
-- ############################################################################

do $$
declare
  c record;
  v_run text;
  v_series jsonb;
  v_row public.game_sessions;
  v_state jsonb;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  v_run := 'run-' || c.code;
  v_series := public.tn04ea_series(
    v_run, 3,
    jsonb_build_array(
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C')
    )
  );

  perform public.tn04ea_set_jwt(c.host_id);
  v_row := public.start_tiernight_live_series(c.lobby_id, 0, v_series);
  v_state := v_row.state;

  if v_row.screen is distinct from 'tiernight-live' then
    raise exception 'R3 screen attendu tiernight-live got %', v_row.screen;
  end if;
  if v_row.game_id is distinct from 'tiernight' then
    raise exception 'R3 game_id attendu tiernight got %', v_row.game_id;
  end if;
  if (v_state ->> 'customLiveTierListsWritable')::boolean is not false then
    raise exception 'R3 customLiveTierListsWritable attendu false';
  end if;
  if (v_state -> 'customLiveTierLists') is distinct from '[]'::jsonb then
    raise exception 'R3 customLiveTierLists attendu inchangé []';
  end if;
  if jsonb_array_length(v_state -> 'tierNightLive' -> 'series' -> 'queue') is distinct from 3 then
    raise exception 'R3 queue len attendu 3 got %',
      jsonb_array_length(v_state -> 'tierNightLive' -> 'series' -> 'queue');
  end if;
  if (v_state -> 'tierNightLive' ->> 'topicId')
     is distinct from (v_state -> 'tierNightLive' -> 'series' -> 'queue' -> 0 ->> 'listId') then
    raise exception 'R3 topicId attendu = queue[0].listId';
  end if;
  if (v_state -> 'tierNightLive' -> 'series' ->> 'runId') is distinct from v_run then
    raise exception 'R3 runId attendu % got %', v_run,
      (v_state -> 'tierNightLive' -> 'series' ->> 'runId');
  end if;
  if (v_state -> 'tierNightLive' ->> 'lobbyStarted')::boolean is not true then
    raise exception 'R3 lobbyStarted attendu true';
  end if;

  raise notice 'R3 OK — host success C=0 N=3, screen=tiernight-live, writable=false, queue=3, topicId=queue[0]';
end $$;

-- ############################################################################
-- R4) Idempotence — même runId → retour ok, aucune mutation
-- ############################################################################

do $$
declare
  c record;
  v_run text;
  v_series jsonb;
  v_before jsonb;
  v_row public.game_sessions;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  v_run := 'run-' || c.code;
  v_series := public.tn04ea_series(
    v_run, 3,
    jsonb_build_array(
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C')
    )
  );

  select state into v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  v_row := public.start_tiernight_live_series(c.lobby_id, 0, v_series);

  if v_row.state is distinct from v_before then
    raise exception 'R4 idempotent a muté le state';
  end if;
  if (v_row.state -> 'tierNightLive' -> 'series' ->> 'runId') is distinct from v_run then
    raise exception 'R4 runId inattendu';
  end if;

  raise notice 'R4 OK — idempotence même runId, state inchangé';
end $$;

-- ############################################################################
-- R5) Autre runId → TNS_LIVE_ALREADY_STARTED
-- ############################################################################

do $$
declare
  c record;
  v_series jsonb;
  v_before jsonb;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  v_series := public.tn04ea_series(
    'run-other-' || c.code, 3,
    jsonb_build_array(
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C')
    )
  );

  select state into v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  begin
    perform public.start_tiernight_live_series(c.lobby_id, 0, v_series);
    raise exception 'R5 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('R5 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_ALREADY_STARTED', 'R5');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'R5 state muté malgré échec attendu';
  end if;

  raise notice 'R5 OK — autre runId → ALREADY_STARTED, state inchangé';
end $$;

-- ############################################################################
-- R6) Respawn ; setupEpoch stale → TNS_LIVE_PREP_STALE
-- ############################################################################

select public.tn04ea_spawn_prep('[]'::jsonb, 3, 5) as respawn;

do $$
declare
  c record;
  v_series jsonb;
  v_before jsonb;
  v_screen_before text;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  v_series := public.tn04ea_series(
    'run-' || c.code, 3,
    jsonb_build_array(
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C')
    )
  );

  select screen, state into v_screen_before, v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  begin
    -- Epoch attendu = 4, remote = 5 → stale.
    perform public.start_tiernight_live_series(c.lobby_id, 4, v_series);
    raise exception 'R6 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('R6 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_PREP_STALE', 'R6');
  end;

  if (select screen from public.game_sessions where id = c.session_id) is distinct from v_screen_before
     or (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'R6 state/screen muté malgré échec attendu';
  end if;

  raise notice 'R6 OK — respawn + setupEpoch stale → PREP_STALE';
end $$;

-- ############################################################################
-- R7) roundCount proposition ≠ prep remote → TNS_LIVE_PREP_STALE
-- ############################################################################

do $$
declare
  c record;
  v_series jsonb;
  v_before jsonb;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  -- prep remote roundCount=3 (spawn R6) ; proposition roundCount=5.
  v_series := public.tn04ea_series(
    'run-' || c.code, 5,
    jsonb_build_array(
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C'),
      public.tn04ea_official_snap('off-d', 'Off D'),
      public.tn04ea_official_snap('off-e', 'Off E')
    )
  );

  select state into v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  begin
    perform public.start_tiernight_live_series(c.lobby_id, 5, v_series);
    raise exception 'R7 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('R7 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_PREP_STALE', 'R7');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'R7 state muté malgré échec attendu';
  end if;

  raise notice 'R7 OK — roundCount proposition ≠ prep remote → PREP_STALE';
end $$;

-- ############################################################################
-- R8) listId dupliqué dans la queue → TNS_LIVE_CORRUPT_STATE
-- ############################################################################

do $$
declare
  c record;
  v_series jsonb;
  v_before jsonb;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  -- off-a réutilisé aux index 0 et 2 (roundIndex/roundId distincts, listId dupliqué).
  v_series := public.tn04ea_series(
    'run-' || c.code, 3,
    jsonb_build_array(
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-a', 'Off A bis')
    )
  );

  select state into v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  begin
    perform public.start_tiernight_live_series(c.lobby_id, 5, v_series);
    raise exception 'R8 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('R8 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_CORRUPT_STATE', 'R8');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'R8 state muté malgré échec attendu';
  end if;

  raise notice 'R8 OK — listId dupliqué → CORRUPT_STATE';
end $$;

-- ############################################################################
-- R9) roundId dupliqué — preuve STRUCTURELLE (chemin mort par construction)
-- ############################################################################
-- HONNÊTETÉ (leçon 04C/C3) : tiernight_live_validate_series_shape lie
-- roundId au format run_id||':'||index AVANT le test de doublon
-- (v_seen_round). Deux entrées à des positions i≠j distinctes ne peuvent
-- donc JAMAIS produire le même roundId formaté valide : le garde anti-
-- doublon roundId est mort par construction, pas atteignable via un
-- payload structurellement valide (un roundId mal formé échoue plus tôt
-- avec le message 'roundId', jamais 'roundId_dup'). On prouve seulement la
-- présence du garde dans le code source plutôt que de simuler un test qui
-- ne peut pas être exercé de bout en bout via le RPC.
-- ############################################################################

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'tiernight_live_validate_series_shape'
  order by p.oid desc limit 1;

  if v_src is null then
    raise exception 'R9 tiernight_live_validate_series_shape introuvable';
  end if;
  if position('roundid_dup' in lower(v_src)) = 0 then
    raise exception 'R9 garde défensif roundId_dup absent du code source';
  end if;

  raise notice 'R9 OK (structurel) — garde roundId_dup présent ; chemin mort par construction (roundId lié à la position via le format run:index), non exerçable via un payload valide — voir commentaire ci-dessus';
end $$;

-- ############################################################################
-- R10) C=2 N=5 — toutes les customs incluses + 3 officiels → ok
-- ############################################################################

do $$
declare
  v_id1 text := public.tn04ea_new_custom_id();
  v_id2 text := public.tn04ea_new_custom_id();
  v_custom1 jsonb;
  v_custom2 jsonb;
  c record;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  v_custom1 := public.tn04ea_custom_entry(v_id1, c.host_id);
  v_custom2 := public.tn04ea_custom_entry(v_id2, c.guest_id);

  perform public.tn04ea_spawn_prep(jsonb_build_array(v_custom1, v_custom2), 5, 0);
end $$;

do $$
declare
  c record;
  v_customs jsonb;
  v_series jsonb;
  v_row public.game_sessions;
  v_custom_count int;
  v_i int;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  select state -> 'customLiveTierLists' into v_customs
  from public.game_sessions where id = c.session_id;

  if jsonb_array_length(v_customs) is distinct from 2 then
    raise exception 'R10 canon customs attendu 2 got %', jsonb_array_length(v_customs);
  end if;

  v_series := public.tn04ea_series(
    'run-' || c.code, 5,
    jsonb_build_array(
      v_customs -> 0,
      v_customs -> 1,
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C')
    )
  );

  perform public.tn04ea_set_jwt(c.host_id);
  v_row := public.start_tiernight_live_series(c.lobby_id, 0, v_series);

  if v_row.screen is distinct from 'tiernight-live' then
    raise exception 'R10 screen attendu tiernight-live got %', v_row.screen;
  end if;
  if jsonb_array_length(v_row.state -> 'tierNightLive' -> 'series' -> 'queue') is distinct from 5 then
    raise exception 'R10 queue len attendu 5';
  end if;

  v_custom_count := 0;
  for v_i in 0 .. 4 loop
    if (v_row.state -> 'tierNightLive' -> 'series' -> 'queue' -> v_i -> 'listSnapshot' -> 'custom') = 'true'::jsonb then
      v_custom_count := v_custom_count + 1;
    end if;
  end loop;
  if v_custom_count is distinct from 2 then
    raise exception 'R10 customs dans queue attendu 2 got %', v_custom_count;
  end if;
  if (v_row.state -> 'customLiveTierLists') is distinct from v_customs then
    raise exception 'R10 customLiveTierLists canon doit rester inchangé (clear = 04F)';
  end if;

  raise notice 'R10 OK — C=2 N=5, toutes customs incluses + 3 officiels';
end $$;

-- ############################################################################
-- R11) C=2 N=5 — une custom omise → TNS_LIVE_CUSTOM_POOL_STALE
-- ############################################################################

do $$
declare
  v_id3 text := public.tn04ea_new_custom_id();
  v_id4 text := public.tn04ea_new_custom_id();
  v_custom3 jsonb;
  v_custom4 jsonb;
  c record;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  v_custom3 := public.tn04ea_custom_entry(v_id3, c.host_id);
  v_custom4 := public.tn04ea_custom_entry(v_id4, c.guest_id);

  perform public.tn04ea_spawn_prep(jsonb_build_array(v_custom3, v_custom4), 5, 0);
end $$;

do $$
declare
  c record;
  v_customs jsonb;
  v_series jsonb;
  v_before jsonb;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  select state -> 'customLiveTierLists' into v_customs
  from public.game_sessions where id = c.session_id;

  -- Seule la 1ère custom canon est incluse ; la 2e est omise (4 officiels comblent).
  v_series := public.tn04ea_series(
    'run-' || c.code, 5,
    jsonb_build_array(
      v_customs -> 0,
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C'),
      public.tn04ea_official_snap('off-d', 'Off D')
    )
  );

  select state into v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  begin
    perform public.start_tiernight_live_series(c.lobby_id, 0, v_series);
    raise exception 'R11 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('R11 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_CUSTOM_POOL_STALE', 'R11');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'R11 state muté malgré échec attendu';
  end if;

  raise notice 'R11 OK — C=2 N=5, custom omise → CUSTOM_POOL_STALE';
end $$;

-- ############################################################################
-- R12) C=4 N=3 — sous-ensemble tout-custom → ok
-- ############################################################################

do $$
declare
  v_c5 text := public.tn04ea_new_custom_id();
  v_c6 text := public.tn04ea_new_custom_id();
  v_c7 text := public.tn04ea_new_custom_id();
  v_c8 text := public.tn04ea_new_custom_id();
  c record;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  perform public.tn04ea_spawn_prep(
    jsonb_build_array(
      public.tn04ea_custom_entry(v_c5, c.host_id),
      public.tn04ea_custom_entry(v_c6, c.guest_id),
      public.tn04ea_custom_entry(v_c7, c.host_id),
      public.tn04ea_custom_entry(v_c8, c.guest_id)
    ),
    3, 0
  );
end $$;

do $$
declare
  c record;
  v_customs jsonb;
  v_series jsonb;
  v_row public.game_sessions;
  v_i int;
  v_custom_count int;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  select state -> 'customLiveTierLists' into v_customs
  from public.game_sessions where id = c.session_id;

  if jsonb_array_length(v_customs) is distinct from 4 then
    raise exception 'R12 canon customs attendu 4 got %', jsonb_array_length(v_customs);
  end if;

  -- Sous-ensemble arbitraire de 3 des 4 customs canon (0-indexé 0,1,2) ; 0 officiel.
  v_series := public.tn04ea_series(
    'run-' || c.code, 3,
    jsonb_build_array(v_customs -> 0, v_customs -> 1, v_customs -> 2)
  );

  perform public.tn04ea_set_jwt(c.host_id);
  v_row := public.start_tiernight_live_series(c.lobby_id, 0, v_series);

  if v_row.screen is distinct from 'tiernight-live' then
    raise exception 'R12 screen attendu tiernight-live got %', v_row.screen;
  end if;

  v_custom_count := 0;
  for v_i in 0 .. 2 loop
    if (v_row.state -> 'tierNightLive' -> 'series' -> 'queue' -> v_i -> 'listSnapshot' -> 'custom') = 'true'::jsonb then
      v_custom_count := v_custom_count + 1;
    end if;
  end loop;
  if v_custom_count is distinct from 3 then
    raise exception 'R12 customs dans queue attendu 3 got %', v_custom_count;
  end if;

  raise notice 'R12 OK — C=4 N=3, sous-ensemble tout-custom (3/4)';
end $$;

-- ############################################################################
-- R13) C=4 N=3 — un officiel glissé → TNS_LIVE_CUSTOM_POOL_STALE
-- ############################################################################

do $$
declare
  v_c9 text := public.tn04ea_new_custom_id();
  v_c10 text := public.tn04ea_new_custom_id();
  v_c11 text := public.tn04ea_new_custom_id();
  v_c12 text := public.tn04ea_new_custom_id();
  c record;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  perform public.tn04ea_spawn_prep(
    jsonb_build_array(
      public.tn04ea_custom_entry(v_c9, c.host_id),
      public.tn04ea_custom_entry(v_c10, c.guest_id),
      public.tn04ea_custom_entry(v_c11, c.host_id),
      public.tn04ea_custom_entry(v_c12, c.guest_id)
    ),
    3, 0
  );
end $$;

do $$
declare
  c record;
  v_customs jsonb;
  v_series jsonb;
  v_before jsonb;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  select state -> 'customLiveTierLists' into v_customs
  from public.game_sessions where id = c.session_id;

  -- C(4) >= N(3) exige EXACTEMENT 3 customs ; ici 2 customs + 1 officiel = 3 → stale.
  v_series := public.tn04ea_series(
    'run-' || c.code, 3,
    jsonb_build_array(v_customs -> 0, v_customs -> 1, public.tn04ea_official_snap('off-a', 'Off A'))
  );

  select state into v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  begin
    perform public.start_tiernight_live_series(c.lobby_id, 0, v_series);
    raise exception 'R13 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('R13 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_CUSTOM_POOL_STALE', 'R13');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'R13 state muté malgré échec attendu';
  end if;

  raise notice 'R13 OK — C=4 N=3, un officiel glissé → CUSTOM_POOL_STALE';
end $$;

-- ############################################################################
-- R14) Snapshot custom items ≠ canon → TNS_LIVE_CUSTOM_SNAPSHOT_MISMATCH
-- ############################################################################

do $$
declare
  v_c13 text := public.tn04ea_new_custom_id();
  c record;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  perform public.tn04ea_spawn_prep(
    jsonb_build_array(public.tn04ea_custom_entry(v_c13, c.host_id)),
    3, 0
  );
end $$;

do $$
declare
  c record;
  v_customs jsonb;
  v_canon jsonb;
  v_forged_snap jsonb;
  v_series jsonb;
  v_before jsonb;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  select state -> 'customLiveTierLists' into v_customs
  from public.game_sessions where id = c.session_id;

  if jsonb_array_length(v_customs) is distinct from 1 then
    raise exception 'R14 canon customs attendu 1';
  end if;

  v_canon := v_customs -> 0;
  -- items altérés vs canon (id/name/emoji/authorUid/custom conservés).
  v_forged_snap := jsonb_set(v_canon, '{items}', '["forged1","forged2","forged3","forged4"]'::jsonb);

  -- C=1 < N=3 : policy exige exactement la seule custom canon présente (v_q=1=v_c=1) ;
  -- le mismatch survient APRÈS la policy, à la comparaison snapshot ↔ canon.
  v_series := public.tn04ea_series(
    'run-' || c.code, 3,
    jsonb_build_array(
      v_forged_snap,
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B')
    )
  );

  select state into v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  begin
    perform public.start_tiernight_live_series(c.lobby_id, 0, v_series);
    raise exception 'R14 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('R14 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_CUSTOM_SNAPSHOT_MISMATCH', 'R14');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'R14 state muté malgré échec attendu';
  end if;

  raise notice 'R14 OK — snapshot custom items ≠ canon → CUSTOM_SNAPSHOT_MISMATCH';
end $$;

-- ############################################################################
-- R15) id custom-live-* avec custom:false → TNS_LIVE_CORRUPT_CUSTOM
-- ############################################################################

select public.tn04ea_spawn_prep('[]'::jsonb, 3, 0) as respawn_r15;

do $$
declare
  c record;
  v_forged jsonb;
  v_series jsonb;
  v_before jsonb;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  -- Invariant violé : préfixe custom-live- mais custom:false.
  v_forged := public.tn04ea_official_snap(public.tn04ea_new_custom_id(), 'Forged');

  v_series := public.tn04ea_series(
    'run-' || c.code, 3,
    jsonb_build_array(
      v_forged,
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C')
    )
  );

  select state into v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  begin
    perform public.start_tiernight_live_series(c.lobby_id, 0, v_series);
    raise exception 'R15 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('R15 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_CORRUPT_CUSTOM', 'R15');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'R15 state muté malgré échec attendu';
  end if;

  raise notice 'R15 OK — id custom-live-* + custom:false → CORRUPT_CUSTOM';
end $$;

-- ############################################################################
-- R16) version string "abc" (jsonb_set) → TNS_LIVE_CORRUPT_STATE (pas 22P02)
-- ############################################################################

do $$
declare
  c record;
  v_series jsonb;
  v_corrupt jsonb;
  v_before jsonb;
  v_err text;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  v_series := public.tn04ea_series(
    'run-' || c.code, 3,
    jsonb_build_array(
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C')
    )
  );
  -- version doit être un entier (1) ; on injecte une string "abc" via jsonb_set.
  v_corrupt := jsonb_set(v_series, '{version}', to_jsonb('abc'::text));

  select state into v_before from public.game_sessions where id = c.session_id;

  perform public.tn04ea_set_jwt(c.host_id);
  begin
    perform public.start_tiernight_live_series(c.lobby_id, 0, v_corrupt);
    raise exception 'R16 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('R16 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04ea_assert_err(v_err, 'TNS_LIVE_CORRUPT_STATE', 'R16');
    if position('22P02' in v_err) > 0 then
      raise exception 'R16 erreur PG brute 22P02 fuitée (attendu code applicatif propre) : %', v_err;
    end if;
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'R16 state muté malgré échec attendu';
  end if;

  raise notice 'R16 OK — version string "abc" → CORRUPT_STATE applicatif (pas 22P02 brut)';
end $$;

-- ############################################################################
-- R17) Acting host — host stale (>120s), guest élu, launch OK
-- ############################################################################

select public.tn04ea_spawn_prep('[]'::jsonb, 3, 0) as respawn_r17;

do $$
declare
  c record;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  update public.lobby_members
  set last_seen_at = now() - interval '10 minutes'
  where lobby_id = c.lobby_id and user_id = c.host_id;
end $$;

do $$
declare
  c record;
  v_series jsonb;
  v_row public.game_sessions;
begin
  select * into strict c from public.tn04ea_smoke_ctx where id = 1;
  v_series := public.tn04ea_series(
    'run-' || c.code, 3,
    jsonb_build_array(
      public.tn04ea_official_snap('off-a', 'Off A'),
      public.tn04ea_official_snap('off-b', 'Off B'),
      public.tn04ea_official_snap('off-c', 'Off C')
    )
  );

  -- Preuve préalable : le guest est bien élu acting host côté serveur.
  perform public.tn04ea_set_jwt(c.guest_id);
  if public.is_acting_host(c.lobby_id) is not true then
    raise exception 'R17 guest devrait être acting host (host stale >120s)';
  end if;

  v_row := public.start_tiernight_live_series(c.lobby_id, 0, v_series);
  if v_row.screen is distinct from 'tiernight-live' then
    raise exception 'R17 screen attendu tiernight-live got %', v_row.screen;
  end if;

  raise notice 'R17 OK — acting host (guest) autorisé à lancer, host stale';
end $$;

-- ############################################################################
-- R18) Cleanup final → 0 fixtures TN04EA%
-- ############################################################################

do $$
declare
  v_clean jsonb;
  v_lobbies int;
  v_members int;
  v_sessions int;
begin
  v_clean := public.tn04ea_cleanup_fixtures();

  select count(*)::int into v_lobbies from public.lobbies where code LIKE 'TN04EA%';
  select count(*)::int into v_members
  from public.lobby_members lm join public.lobbies l on l.id = lm.lobby_id
  where l.code LIKE 'TN04EA%';
  select count(*)::int into v_sessions
  from public.game_sessions gs join public.lobbies l on l.id = gs.lobby_id
  where l.code LIKE 'TN04EA%';

  if v_lobbies <> 0 or v_members <> 0 or v_sessions <> 0 then
    raise exception 'R18 fixtures résiduelles lobbies=% members=% sessions=%',
      v_lobbies, v_members, v_sessions;
  end if;

  raise notice 'R18 OK — cleanup final, 0 fixture TN04EA%% résiduelle (%)', v_clean;
end $$;

-- ############################################################################
-- A2.1 — Teardown harness (helpers + table ctx, sans CASCADE)
-- ############################################################################

drop function if exists public.tn04ea_set_jwt(uuid);
drop function if exists public.tn04ea_user_has_living_membership(uuid);
drop function if exists public.tn04ea_resolve_actors();
drop function if exists public.tn04ea_new_custom_id();
drop function if exists public.tn04ea_official_snap(text, text);
drop function if exists public.tn04ea_custom_entry(text, uuid);
drop function if exists public.tn04ea_queue_entry(int, text, jsonb);
drop function if exists public.tn04ea_series(text, int, jsonb);
drop function if exists public.tn04ea_cleanup_fixtures();
drop function if exists public.tn04ea_spawn_prep(jsonb, int, int);
drop function if exists public.tn04ea_assert_err(text, text, text);
drop function if exists public.tn04ea_assert_rpc_acl(text, text);
drop function if exists public.tn04ea_assert_helper_owner_only(text);

drop table if exists public.tn04ea_smoke_ctx;

-- Legacy draft names (tn04e_* / TN04E% era) — safe leftover cleanup, no CASCADE
drop function if exists public.tn04e_set_jwt(uuid);
drop function if exists public.tn04e_user_has_living_membership(uuid);
drop function if exists public.tn04e_resolve_actors();
drop function if exists public.tn04e_new_custom_id();
drop function if exists public.tn04e_official_snap(text, text);
drop function if exists public.tn04e_custom_entry(text, uuid);
drop function if exists public.tn04e_queue_entry(int, text, jsonb);
drop function if exists public.tn04e_series(text, int, jsonb);
drop function if exists public.tn04e_cleanup_fixtures();
drop function if exists public.tn04e_spawn_prep(jsonb, int, int);
drop function if exists public.tn04e_assert_err(text, text, text);
drop function if exists public.tn04e_assert_rpc_acl(text, text);
drop function if exists public.tn04e_assert_helper_owner_only(text);
drop table if exists public.tn04e_smoke_ctx;

do $$
begin
  raise notice 'TN04EA A2 SUCCESS';
end $$;
