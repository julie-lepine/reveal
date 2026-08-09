-- =============================================================================
-- FEATURE-TIERNIGHT-04E (migration B) — SMOKE B2 (tests A–O) guest ready
-- =============================================================================
--
-- Prérequis : B1 SUCCESS (helpers + tn04eb_smoke_ctx + fixture TN04EB% présents).
--   B1 : supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-bootstrap.sql
--
-- Ce fichier :
--   1) Assert B1 state (ctx + lobby + session + screen=tiernight-prep)
--   2) Scénarios dans l'ordre monolith : A, M, C, N, O, H,
--      transition → tiernight-live-prep, B, L, D, G, I, puis K cleanup
--   3) Cleanup fixtures + drop helpers tn04eb_* + legacy tn04eg_* + drop ctx
--
-- Couverture (J déjà exécuté en B1) :
--   A. ready sur tiernight-prep      → écrit UNIQUEMENT tierNightPrep.ready[uid]
--   B. ready sur tiernight-live-prep → écrit UNIQUEMENT tierNightLivePrep.ready[uid]
--   C. setupEpoch roster périmé      → rejet, state intact
--   D. setupEpoch live périmé        → rejet, state intact
--   E. ready live ne crée/modifie jamais tierNightPrep.ready       (vérifié dans B)
--   F. ready roster ne crée/modifie jamais tierNightLivePrep.ready (vérifié dans A)
--   G. pool_invalidate sur écran live-prep       → rejet
--   H. pool_invalidate roster, custom possédé    → écrit tierNightPrep.poolInvalidateRequestId
--   I. smoke minimal non-TierNight : ready booléen style hottake-prep
--   K. cleanup : 0 fixture TN04EB% (et 0 legacy TN04EG%) restante + drop helpers
--   L. screen=tiernight-live-prep + game_id≠tiernight → rejet
--   M. screen=tiernight-prep      + game_id≠tiernight → rejet
--   N. ready TierNight avec booléen nu (pas d'objet)             → rejet
--   O. ready TierNight avec expectedSetupEpoch de type invalide  → rejet
--
-- Si un test mid-script échoue, le cleanup final ne tourne pas — intentionnel
-- (état B1 reste pour diagnostic). Cleanup d'urgence :
--   supabase/feature-tiernight-04e-live-prep-guest-ready-smoke-cleanup.sql
--
-- Fixtures : lobbies.code LIKE 'TN04EB%' uniquement (+ legacy nommé TN04EG%).
-- Aucun CREATE OR REPLACE de RPC produit. Aucun CASCADE.
-- Context via record + select into strict (pas de %ROWTYPE sur tn04eb_smoke_ctx).
-- =============================================================================

-- ############################################################################
-- B2.0 — Assert B1 prerequisite
-- ############################################################################

do $$
declare
  c record;
begin
  if to_regclass('public.tn04eb_smoke_ctx') is null then
    raise exception 'TN04EB_B1_REQUIRED — run smoke-bootstrap.sql first';
  end if;

  select * into c from public.tn04eb_smoke_ctx where id = 1;
  if not found then
    raise exception 'TN04EB_B1_REQUIRED — ctx id=1 missing';
  end if;

  if c.lobby_id is null or c.session_id is null
     or c.host_id is null or c.guest_id is null then
    raise exception 'TN04EB_B1_REQUIRED — ctx colonnes nulles';
  end if;

  if c.code is null or c.code not like 'TN04EB%' then
    raise exception 'TN04EB_B1_REQUIRED — lobby code LIKE TN04EB%% got %', c.code;
  end if;

  if not exists (select 1 from public.lobbies where id = c.lobby_id and code like 'TN04EB%') then
    raise exception 'TN04EB_B1_REQUIRED — lobby absent';
  end if;

  if not exists (
    select 1 from public.game_sessions where id = c.session_id and lobby_id = c.lobby_id
  ) then
    raise exception 'TN04EB_B1_REQUIRED — session absente';
  end if;

  if not exists (
    select 1 from public.game_sessions
    where id = c.session_id and screen = 'tiernight-prep'
  ) then
    raise exception 'TN04EB_B1_REQUIRED — screen attendu tiernight-prep';
  end if;

  raise notice 'TN04EB B2 — B1 state OK ; démarrage A–O (J déjà en B1)';
end $$;

-- Preuve visible (même shape que fin B1 ; pas de secrets)
select
  to_regclass('public.tn04eb_smoke_ctx') as ctx_table,
  (select count(*) from public.tn04eb_smoke_ctx) as ctx_rows,
  c.lobby_id,
  c.session_id,
  c.host_id,
  c.guest_id,
  c.code
from public.tn04eb_smoke_ctx c
where c.id = 1;

-- ############################################################################
-- A) ready sur tiernight-prep → écrit UNIQUEMENT tierNightPrep.ready[uid]
-- (+ F : ne crée/modifie jamais tierNightLivePrep.ready)
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_prep jsonb;
  v_ready jsonb;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);
  if auth.uid() is distinct from c.guest_id then
    raise exception 'A auth.uid() != guest';
  end if;

  v_before := public.tn04eb_session_state(c.lobby_id);

  perform public.contribute_game_session_player(
    c.lobby_id,
    'tiernight',
    'ready',
    jsonb_build_object('ready', true, 'expectedSetupEpoch', c.roster_epoch)
  );

  v_after := public.tn04eb_session_state(c.lobby_id);
  v_prep := v_after -> 'tierNightPrep';
  v_ready := coalesce(v_prep -> 'ready', '{}'::jsonb);

  if (v_ready ->> c.guest_id::text) is distinct from 'true' then
    raise exception 'A ready[guest] != true : %', v_ready;
  end if;
  if v_ready ? c.host_id::text then
    raise exception 'A ready ne doit pas contenir host_uid';
  end if;
  if (v_prep ->> 'setupEpoch')::int is distinct from c.roster_epoch then
    raise exception 'A setupEpoch muté';
  end if;

  -- F : tierNightLivePrep totalement inchangé par un ready roster (pas créé,
  -- pas modifié — ni .ready ni .setupEpoch).
  if v_after -> 'tierNightLivePrep' is distinct from (v_before -> 'tierNightLivePrep') then
    raise exception 'F(A) tierNightLivePrep muté par ready roster : %', v_after -> 'tierNightLivePrep';
  end if;
  if v_after -> 'customRosterTopics' is distinct from (v_before -> 'customRosterTopics') then
    raise exception 'A customRosterTopics muté';
  end if;
  -- Seule la branche tierNightPrep doit différer.
  if (v_before - 'tierNightPrep') is distinct from (v_after - 'tierNightPrep') then
    raise exception 'A branche hors tierNightPrep mutée';
  end if;

  raise notice 'A+F OK — ready roster écrit uniquement tierNightPrep.ready[guest], tierNightLivePrep intact';
end $$;

-- ############################################################################
-- M) screen=tiernight-prep + game_id ≠ tiernight → rejet
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);

  update public.game_sessions set game_id = 'hottake' where lobby_id = c.lobby_id;
  -- screen reste tiernight-prep

  v_before := public.tn04eb_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'ready',
      jsonb_build_object('ready', true, 'expectedSetupEpoch', c.roster_epoch)
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'Jeu de session incompatible pour TierNight prep%' then
      raise exception 'M exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'M aurait dû refuser game_id≠tiernight (écran roster)';
  end if;

  v_after := public.tn04eb_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'M state muté malgré rejet';
  end if;

  update public.game_sessions set game_id = 'tiernight' where lobby_id = c.lobby_id;

  raise notice 'M OK — game_id≠tiernight refusé sur écran tiernight-prep, state intact';
end $$;

-- ############################################################################
-- C) setupEpoch roster périmé → rejet ; state inchangé
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_stale int;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);
  v_stale := c.roster_epoch - 1;
  v_before := public.tn04eb_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'ready',
      jsonb_build_object('ready', true, 'expectedSetupEpoch', v_stale)
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'Ready obsolète%' then
      raise exception 'C exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'C aurait dû lever Ready obsolète (roster)';
  end if;

  v_after := public.tn04eb_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'C state muté malgré rejet stale (roster)';
  end if;

  raise notice 'C OK — stale roster refusé (% vs %), state intact', v_stale, c.roster_epoch;
end $$;

-- ############################################################################
-- N) ready TierNight avec booléen nu (pas d'objet {ready, expectedSetupEpoch}) → rejet
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);
  v_before := public.tn04eb_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id, 'tiernight', 'ready', 'true'::jsonb
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'Ready TierNight: objet {ready, expectedSetupEpoch}%' then
      raise exception 'N exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'N aurait dû refuser le booléen nu';
  end if;

  v_after := public.tn04eb_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'N state muté malgré rejet';
  end if;

  raise notice 'N OK — booléen nu refusé (objet {ready, expectedSetupEpoch} requis)';
end $$;

-- ############################################################################
-- O) ready TierNight avec expectedSetupEpoch de type invalide (string) → rejet
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);
  v_before := public.tn04eb_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'ready',
      jsonb_build_object('ready', true, 'expectedSetupEpoch', 'abc')
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'Ready TierNight: expectedSetupEpoch entier requis%' then
      raise exception 'O exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'O aurait dû refuser expectedSetupEpoch de type string';
  end if;

  v_after := public.tn04eb_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'O state muté malgré rejet';
  end if;

  raise notice 'O OK — expectedSetupEpoch string refusé (entier requis)';
end $$;

-- ############################################################################
-- H) pool_invalidate_request sur roster, custom possédé
-- → écrit tierNightPrep.poolInvalidateRequestId (comportement historique 03/04D)
-- ############################################################################

do $$
declare
  c record;
  v_s0 jsonb;
  v_after jsonb;
  v_prep0 jsonb;
  v_prep jsonb;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);

  if not exists (
    select 1
    from jsonb_array_elements(
      coalesce(public.tn04eb_session_state(c.lobby_id) -> 'customRosterTopics', '[]'::jsonb)
    ) e
    where e->>'id' = c.guest_custom_id
      and e->>'authorUid' = c.guest_id::text
  ) then
    raise exception 'H prérequis custom guest absent';
  end if;

  v_s0 := public.tn04eb_session_state(c.lobby_id);
  v_prep0 := v_s0 -> 'tierNightPrep';

  perform public.contribute_game_session_player(
    c.lobby_id,
    'tiernight',
    'pool_invalidate_request',
    jsonb_build_object('requestId', 'inv-tn04eb-guest-1', 'customEntryId', c.guest_custom_id)
  );

  v_after := public.tn04eb_session_state(c.lobby_id);
  v_prep := v_after -> 'tierNightPrep';

  if (v_prep ->> 'poolInvalidateRequestId') is distinct from 'inv-tn04eb-guest-1' then
    raise exception 'H poolInvalidateRequestId attendu inv-tn04eb-guest-1, got %',
      v_prep -> 'poolInvalidateRequestId';
  end if;
  if jsonb_typeof(v_prep -> 'poolInvalidateRequestId') is distinct from 'string' then
    raise exception 'H doit persister une string, pas un objet';
  end if;
  if v_prep ? 'customEntryId' or v_prep ? 'requestId' then
    raise exception 'H ne doit pas stocker customEntryId/requestId sous prep';
  end if;
  if v_prep -> 'ready' is distinct from (v_prep0 -> 'ready') then
    raise exception 'H ready muté';
  end if;
  if (v_prep ->> 'setupEpoch') is distinct from (v_prep0 ->> 'setupEpoch') then
    raise exception 'H setupEpoch muté';
  end if;
  if v_after -> 'tierNightLivePrep' is distinct from (v_s0 -> 'tierNightLivePrep') then
    raise exception 'H tierNightLivePrep muté par pool_invalidate roster';
  end if;
  if v_after -> 'customRosterTopics' is distinct from (v_s0 -> 'customRosterTopics') then
    raise exception 'H customRosterTopics muté';
  end if;
  if (v_s0 - 'tierNightPrep') is distinct from (v_after - 'tierNightPrep') then
    raise exception 'H branche hors tierNightPrep mutée';
  end if;

  raise notice 'H OK — pool_invalidate roster écrit uniquement tierNightPrep.poolInvalidateRequestId (historique)';
end $$;

-- ############################################################################
-- Transition d'écran → tiernight-live-prep (pour B, L, D, G)
-- ############################################################################

update public.game_sessions
set screen = 'tiernight-live-prep'
where lobby_id = (select lobby_id from public.tn04eb_smoke_ctx where id = 1);

-- ############################################################################
-- B) ready sur tiernight-live-prep → écrit UNIQUEMENT tierNightLivePrep.ready[uid]
-- (+ E : ne crée/modifie jamais tierNightPrep.ready)
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_live jsonb;
  v_ready jsonb;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);

  v_before := public.tn04eb_session_state(c.lobby_id);

  perform public.contribute_game_session_player(
    c.lobby_id,
    'tiernight',
    'ready',
    jsonb_build_object('ready', true, 'expectedSetupEpoch', c.live_epoch)
  );

  v_after := public.tn04eb_session_state(c.lobby_id);
  v_live := v_after -> 'tierNightLivePrep';
  v_ready := coalesce(v_live -> 'ready', '{}'::jsonb);

  if (v_ready ->> c.guest_id::text) is distinct from 'true' then
    raise exception 'B ready[guest] != true : %', v_ready;
  end if;
  if v_ready ? c.host_id::text then
    raise exception 'B ready ne doit pas contenir host_uid';
  end if;
  if (v_live ->> 'setupEpoch')::int is distinct from c.live_epoch then
    raise exception 'B setupEpoch (live) muté';
  end if;

  -- E : tierNightPrep totalement inchangé par un ready live-prep (y compris
  -- le ready[guest] déjà posé par A doit rester intact, pas de fuite).
  if v_after -> 'tierNightPrep' is distinct from (v_before -> 'tierNightPrep') then
    raise exception 'E(B) tierNightPrep muté par ready live : %', v_after -> 'tierNightPrep';
  end if;
  if v_after -> 'customRosterTopics' is distinct from (v_before -> 'customRosterTopics') then
    raise exception 'B customRosterTopics muté';
  end if;
  if (v_before - 'tierNightLivePrep') is distinct from (v_after - 'tierNightLivePrep') then
    raise exception 'B branche hors tierNightLivePrep mutée';
  end if;

  raise notice 'B+E OK — ready live-prep écrit uniquement tierNightLivePrep.ready[guest], tierNightPrep intact';
end $$;

-- ############################################################################
-- L) screen=tiernight-live-prep + game_id ≠ tiernight → rejet
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);

  update public.game_sessions set game_id = 'hottake' where lobby_id = c.lobby_id;
  -- screen reste tiernight-live-prep

  v_before := public.tn04eb_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'ready',
      jsonb_build_object('ready', true, 'expectedSetupEpoch', c.live_epoch)
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'Jeu de session incompatible pour TierNight prep%' then
      raise exception 'L exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'L aurait dû refuser game_id≠tiernight (écran live-prep)';
  end if;

  v_after := public.tn04eb_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'L state muté malgré rejet';
  end if;

  update public.game_sessions set game_id = 'tiernight' where lobby_id = c.lobby_id;

  raise notice 'L OK — game_id≠tiernight refusé sur écran tiernight-live-prep, state intact';
end $$;

-- ############################################################################
-- D) setupEpoch live périmé → rejet ; state inchangé (écran toujours live-prep)
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_stale int;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);
  v_stale := c.live_epoch - 1;
  v_before := public.tn04eb_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'ready',
      jsonb_build_object('ready', true, 'expectedSetupEpoch', v_stale)
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'Ready obsolète%' then
      raise exception 'D exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'D aurait dû lever Ready obsolète (live)';
  end if;

  v_after := public.tn04eb_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'D state muté malgré rejet stale (live)';
  end if;

  raise notice 'D OK — stale live refusé (% vs %), state intact', v_stale, c.live_epoch;
end $$;

-- ############################################################################
-- G) pool_invalidate_request sur écran tiernight-live-prep → rejet
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_caught boolean := false;
  v_msg text;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);
  v_before := public.tn04eb_session_state(c.lobby_id);

  begin
    perform public.contribute_game_session_player(
      c.lobby_id,
      'tiernight',
      'pool_invalidate_request',
      jsonb_build_object('requestId', 'inv-live-reject', 'customEntryId', c.guest_custom_id)
    );
  exception when others then
    v_caught := true;
    v_msg := SQLERRM;
    if v_msg not like 'pool_invalidate_request uniquement sur tiernight-prep%' then
      raise exception 'G exception inattendue: %', v_msg;
    end if;
  end;

  if not v_caught then
    raise exception 'G aurait dû refuser pool_invalidate sur écran live-prep';
  end if;

  v_after := public.tn04eb_session_state(c.lobby_id);
  if v_after is distinct from v_before then
    raise exception 'G state muté malgré rejet (écran live-prep)';
  end if;

  raise notice 'G OK — pool_invalidate refusé sur tiernight-live-prep, state intact';
end $$;

-- ############################################################################
-- I) Smoke minimal non-TierNight : ready booléen style hottake-prep
-- Repurpose léger de la fixture existante (pas de nouveau spawn lourd), puis
-- restauration de l'état TierNight (roster + live, epochs canoniques) pour
-- laisser le cleanup K cohérent.
-- ############################################################################

do $$
declare
  c record;
  v_state jsonb;
  v_uid text;
begin
  select * into strict c from public.tn04eb_smoke_ctx where id = 1;
  perform public.tn04eb_set_jwt(c.guest_id);
  v_uid := c.guest_id::text;

  update public.game_sessions
  set game_id = 'hottake',
      screen = 'hottake-prep',
      state = jsonb_build_object(
        'hotTake', jsonb_build_object('phase', null, 'ready', '{}'::jsonb)
      )
  where lobby_id = c.lobby_id;

  perform public.contribute_game_session_player(
    c.lobby_id, 'hottake', 'ready', 'true'::jsonb
  );

  v_state := public.tn04eb_session_state(c.lobby_id);
  if (v_state #>> array['hotTake', 'ready', v_uid]) is distinct from 'true' then
    raise exception 'I ready hottake-prep path fail: %', v_state -> 'hotTake' -> 'ready';
  end if;

  -- Restauration fixture TierNight (écran roster, epochs canoniques,
  -- tierNightPrep + tierNightLivePrep tous deux reconstruits neufs).
  update public.game_sessions
  set game_id = 'tiernight',
      screen = 'tiernight-prep',
      state = public.tn04eb_build_state(
        c.host_id, c.guest_id, c.guest_custom_id, c.host_custom_id,
        c.roster_epoch, c.live_epoch
      )
  where lobby_id = c.lobby_id;

  raise notice 'I OK — contribute accepte toujours ready booléen hors TierNight (hottake-prep)';
end $$;

-- ############################################################################
-- K) Cleanup + vérifs zéro fixture (TN04EB% et legacy TN04EG%) + drop helpers
-- ############################################################################

select public.tn04eb_cleanup_fixtures() as cleanup_final;

do $$
declare
  v_lobbies int;
  v_sessions int;
  v_members int;
  v_ctx int;
  v_legacy_lobbies int;
begin
  select count(*) into v_lobbies from public.lobbies where code like 'TN04EB%';
  select count(*) into v_sessions
  from public.game_sessions gs
  join public.lobbies l on l.id = gs.lobby_id
  where l.code like 'TN04EB%';
  select count(*) into v_members
  from public.lobby_members lm
  join public.lobbies l on l.id = lm.lobby_id
  where l.code like 'TN04EB%';
  select count(*) into v_ctx from public.tn04eb_smoke_ctx;
  select count(*) into v_legacy_lobbies from public.lobbies where code like 'TN04EG%';

  if v_lobbies <> 0 or v_sessions <> 0 or v_members <> 0 or v_ctx <> 0 then
    raise exception
      'K fixtures TN04EB%% restantes lobbies=% sessions=% members=% ctx=%',
      v_lobbies, v_sessions, v_members, v_ctx;
  end if;
  if v_legacy_lobbies <> 0 then
    raise exception 'K fixtures legacy TN04EG%% restantes lobbies=%', v_legacy_lobbies;
  end if;

  raise notice 'K OK — fixtures TN04EB%%=0, legacy TN04EG%%=0';
end $$;

-- Drop helpers (après vérif fixtures ; pas de CASCADE)
drop function if exists public.tn04eb_spawn_fixture(text, int, int);
drop function if exists public.tn04eb_cleanup_fixtures();
drop function if exists public.tn04eb_build_state(uuid, uuid, text, text, int, int);
drop function if exists public.tn04eb_session_state(uuid);
drop function if exists public.tn04eb_resolve_actors();
drop function if exists public.tn04eb_user_has_living_membership(uuid);
drop function if exists public.tn04eb_set_jwt(uuid);
drop table if exists public.tn04eb_smoke_ctx;

-- Legacy brouillon tn04eg_* — drop explicite au teardown B2
drop function if exists public.tn04eg_spawn_fixture(text, int, int);
drop function if exists public.tn04eg_cleanup_fixtures();
drop function if exists public.tn04eg_build_state(uuid, uuid, text, text, int, int);
drop function if exists public.tn04eg_session_state(uuid);
drop function if exists public.tn04eg_resolve_actors();
drop function if exists public.tn04eg_set_jwt(uuid);
drop table if exists public.tn04eg_smoke_ctx;

do $$
declare
  v_helpers int;
  v_legacy_helpers int;
begin
  select count(*) into v_helpers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'tn04eb_%';

  select count(*) into v_legacy_helpers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'tn04eg_%';

  if v_helpers <> 0 then
    raise exception 'K helpers tn04eb_%% restants: %', v_helpers;
  end if;
  if v_legacy_helpers <> 0 then
    raise exception 'K helpers legacy tn04eg_%% restants: %', v_legacy_helpers;
  end if;

  if to_regclass('public.tn04eb_smoke_ctx') is not null then
    raise exception 'K tn04eb_smoke_ctx encore présente';
  end if;
  if to_regclass('public.tn04eg_smoke_ctx') is not null then
    raise exception 'K tn04eg_smoke_ctx encore présente (legacy)';
  end if;

  raise notice 'K OK — remaining_helpers tn04eb=0 tn04eg=0, tables ctx absentes';
end $$;

do $$
begin
  raise notice 'TN04EB B2 SUCCESS';
end $$;
