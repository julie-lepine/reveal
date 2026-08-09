-- =============================================================================
-- FEATURE-TIERNIGHT-04C — SMOKE B2 (tests C1–C25) customLiveTierLists
-- =============================================================================
--
-- Prérequis : B1 SUCCESS (helpers + tn04c_smoke_ctx + fixture TN04C% présents).
--   B1 : supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-bootstrap.sql
--
-- Ce fichier :
--   1) Assert B1 state
--   2) Run C1–C25pre–C25
--   3) Cleanup fixtures + drop helpers + drop table
--
-- Si un test mid-script échoue, le cleanup final ne tourne pas — intentionnel
-- (état B1 reste pour diagnostic). Cleanup d'urgence :
--   supabase/feature-tiernight-04c-custom-live-tier-lists-smoke-cleanup.sql
--
-- Fixtures : lobbies.code LIKE 'TN04C%' uniquement.
-- Aucun CREATE OR REPLACE de RPC produit. Aucun CASCADE. Aucun DELETE auth.users.
-- Context via record + select into strict (pas de row type tied to ctx).
-- =============================================================================

-- ############################################################################
-- B2.0 — Assert B1 prerequisite
-- ############################################################################

do $$
declare
  c record;
begin
  if to_regclass('public.tn04c_smoke_ctx') is null then
    raise exception 'TN04C_B1_REQUIRED — run smoke-bootstrap.sql first';
  end if;

  select * into c from public.tn04c_smoke_ctx where id = 1;
  if not found then
    raise exception 'TN04C_B1_REQUIRED — ctx id=1 missing';
  end if;

  if c.lobby_id is null or c.host_id is null or c.guest_id is null
     or c.session_id is null or c.id_a is null or c.id_b is null then
    raise exception 'TN04C_B1_REQUIRED — ctx colonnes nulles';
  end if;

  if c.code is null or c.code not like 'TN04C%' then
    raise exception 'TN04C_B1_REQUIRED — lobby code LIKE TN04C%% got %', c.code;
  end if;

  if not exists (select 1 from public.lobbies where id = c.lobby_id and code like 'TN04C%') then
    raise exception 'TN04C_B1_REQUIRED — lobby absent';
  end if;

  if not exists (
    select 1 from public.game_sessions where id = c.session_id and lobby_id = c.lobby_id
  ) then
    raise exception 'TN04C_B1_REQUIRED — session absente';
  end if;

  raise notice 'TN04C B2 — B1 state OK ; démarrage C1–C25';
end $$;

-- Preuve visible (même shape que fin B1 ; pas de secrets)
select
  to_regclass('public.tn04c_smoke_ctx')::text as ctx_table,
  (select count(*)::int from public.tn04c_smoke_ctx) as ctx_rows,
  c.lobby_id,
  c.session_id,
  c.code
from public.tn04c_smoke_ctx c
where c.id = 1;

-- ############################################################################
-- C1–C2) Upsert A puis B → A+B
-- ############################################################################

do $$
declare
  c record;
  v_row public.game_sessions;
  v_ids text[];
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;

  perform public.tn04c_set_jwt(c.host_id);
  v_row := public.upsert_player_custom_live_tier_list(
    c.lobby_id,
    public.tn04c_valid_entry(c.id_a, 'List A')
  );
  v_ids := public.tn04c_list_ids(v_row.state);
  if not (c.id_a = any (v_ids)) then
    raise exception 'C1 A absent: %', v_ids;
  end if;
  if cardinality(v_ids) is distinct from 1 then
    raise exception 'C1 len=%', cardinality(v_ids);
  end if;

  perform public.tn04c_set_jwt(c.guest_id);
  v_row := public.upsert_player_custom_live_tier_list(
    c.lobby_id,
    public.tn04c_valid_entry(c.id_b, 'List B')
  );
  v_ids := public.tn04c_list_ids(v_row.state);
  if not (c.id_a = any (v_ids) and c.id_b = any (v_ids)) then
    raise exception 'C2 A+B attendus got %', v_ids;
  end if;
  if cardinality(v_ids) is distinct from 2 then
    raise exception 'C2 len=%', cardinality(v_ids);
  end if;

  raise notice 'C1–C2 OK — upsert A puis B → A+B';
end $$;

-- ############################################################################
-- C3) Preuve structurelle FOR UPDATE (pas dual-tx concurrent)
-- ############################################################################
-- HONNÊTETÉ : ce script n’ouvre PAS deux transactions parallèles.
-- La course A∥B est garantie structurellement par `select … for update` dans
-- upsert_player_custom_live_tier_list / delete_… (migration A). Ici on assert
-- seulement le résultat séquentiel non last-write-wins : A et B coexistent.
-- ############################################################################

do $$
declare
  c record;
  v_state jsonb;
  v_ids text[];
  v_src text;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;
  select state into v_state from public.game_sessions where id = c.session_id;
  v_ids := public.tn04c_list_ids(v_state);
  if not (c.id_a = any (v_ids) and c.id_b = any (v_ids)) then
    raise exception 'C3 A+B absents (preuve séquentielle) %', v_ids;
  end if;

  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'upsert_player_custom_live_tier_list'
  order by p.oid desc limit 1;
  if position('for update' in lower(coalesce(v_src, ''))) = 0 then
    raise exception 'C3 upsert sans FOR UPDATE dans le corps';
  end if;

  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'delete_player_custom_live_tier_list'
  order by p.oid desc limit 1;
  if position('for update' in lower(coalesce(v_src, ''))) = 0 then
    raise exception 'C3 delete sans FOR UPDATE dans le corps';
  end if;

  raise notice 'C3 OK — FOR UPDATE présent (structurel) + A+B séquentiels ; pas de dual-tx';
end $$;

-- ############################################################################
-- C4) Idempotent même id + même payload
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb; v_after jsonb;
  v_row public.game_sessions;
  v_upd_b timestamptz; v_upd_a timestamptz;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;
  perform public.tn04c_set_jwt(c.host_id);

  select state, updated_at into v_before, v_upd_b
  from public.game_sessions where id = c.session_id;

  v_row := public.upsert_player_custom_live_tier_list(
    c.lobby_id,
    public.tn04c_valid_entry(c.id_a, 'List A')
  );
  v_after := v_row.state;
  select updated_at into v_upd_a from public.game_sessions where id = c.session_id;

  if public.tn04c_list_ids(v_after) is distinct from public.tn04c_list_ids(v_before) then
    raise exception 'C4 ids mutés';
  end if;
  if public.tn04c_find_entry(v_after, c.id_a)
     is distinct from public.tn04c_find_entry(v_before, c.id_a) then
    raise exception 'C4 entrée A mutée';
  end if;
  -- retry idempotent : return early sans UPDATE → updated_at inchangé
  if v_upd_a is distinct from v_upd_b then
    raise exception 'C4 updated_at muté sur idempotent';
  end if;

  raise notice 'C4 OK — idempotent same id same payload';
end $$;

-- ############################################################################
-- C5) Même id payload différent → TNS_LIVE_CUSTOM_EDIT_FORBIDDEN
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb; v_err text;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;
  perform public.tn04c_set_jwt(c.host_id);
  select state into v_before from public.game_sessions where id = c.session_id;

  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        c.id_a, 'List A EDITED', '🎯',
        '["alpha","bravo","charlie","echo"]'::jsonb
      )
    );
    raise exception 'C5 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C5 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'TNS_LIVE_CUSTOM_EDIT_FORBIDDEN', 'C5');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'C5 state muté';
  end if;
  raise notice 'C5 OK — EDIT_FORBIDDEN';
end $$;

-- ############################################################################
-- C6) B ne peut pas prendre l’id de A → TNS_LIVE_CUSTOM_NOT_OWNER
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb; v_err text;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;
  perform public.tn04c_set_jwt(c.guest_id);
  select state into v_before from public.game_sessions where id = c.session_id;

  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(c.id_a, 'Hijack A')
    );
    raise exception 'C6 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C6 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'TNS_LIVE_CUSTOM_NOT_OWNER', 'C6');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'C6 state muté';
  end if;
  raise notice 'C6 OK — NOT_OWNER sur upsert id A par B';
end $$;

-- ############################################################################
-- C7) Delete A par A
-- ############################################################################

do $$
declare
  c record;
  v_row public.game_sessions;
  v_ids text[];
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;
  perform public.tn04c_set_jwt(c.host_id);
  v_row := public.delete_player_custom_live_tier_list(c.lobby_id, c.id_a);
  v_ids := public.tn04c_list_ids(v_row.state);
  if c.id_a = any (v_ids) then
    raise exception 'C7 A encore présent %', v_ids;
  end if;
  if not (c.id_b = any (v_ids)) then
    raise exception 'C7 B disparu à tort %', v_ids;
  end if;
  if cardinality(v_ids) is distinct from 1 then
    raise exception 'C7 len=%', cardinality(v_ids);
  end if;
  raise notice 'C7 OK — delete A par A ; B reste';
end $$;

-- ############################################################################
-- C8) Delete A par B → NOT_OWNER
-- ############################################################################

do $$
declare
  c record;
  v_row public.game_sessions;
  v_before jsonb; v_err text;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;

  -- Repose A pour le test ownership delete
  perform public.tn04c_set_jwt(c.host_id);
  v_row := public.upsert_player_custom_live_tier_list(
    c.lobby_id,
    public.tn04c_valid_entry(c.id_a, 'List A')
  );
  if public.tn04c_find_entry(v_row.state, c.id_a) is null then
    raise exception 'C8 setup A manquant';
  end if;

  select state into v_before from public.game_sessions where id = c.session_id;
  perform public.tn04c_set_jwt(c.guest_id);
  begin
    perform public.delete_player_custom_live_tier_list(c.lobby_id, c.id_a);
    raise exception 'C8 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C8 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'TNS_LIVE_CUSTOM_NOT_OWNER', 'C8');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'C8 state muté';
  end if;
  raise notice 'C8 OK — delete A par B → NOT_OWNER';
end $$;

-- ############################################################################
-- C9–C10) Forged authorUid / author ignorés (serveur impose membership/auth)
-- ############################################################################

do $$
declare
  c record;
  v_row public.game_sessions;
  v_id text := public.tn04c_new_id();
  v_entry jsonb;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;
  perform public.tn04c_set_jwt(c.host_id);

  v_entry := public.tn04c_valid_entry(
    v_id, 'Forged Meta', '🎯',
    '["w","x","y","z"]'::jsonb,
    'TOTALLY_FORGED_AUTHOR',
    '00000000-0000-0000-0000-000000000000'
  );

  v_row := public.upsert_player_custom_live_tier_list(c.lobby_id, v_entry);
  v_entry := public.tn04c_find_entry(v_row.state, v_id);
  if v_entry is null then
    raise exception 'C9/C10 entrée absente';
  end if;
  if (v_entry ->> 'authorUid') is distinct from c.host_id::text then
    raise exception 'C9 forged authorUid stocké=%', v_entry ->> 'authorUid';
  end if;
  if (v_entry ->> 'author') is distinct from 'TN04C Host' then
    raise exception 'C10 forged author stocké=%', v_entry ->> 'author';
  end if;

  raise notice 'C9–C10 OK — forged authorUid/author écrasés par auth.uid()/display_name';
end $$;

-- ############################################################################
-- C11–C17) Rejets de validation structurelle (contrat 04B/04C — pas de troncature)
-- Chaque rejet : erreur attendue + state inchangé.
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_err text;
  v_pad text;
  v_big jsonb;
  v_items jsonb;
  v_entry jsonb;
  i int;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;
  perform public.tn04c_set_jwt(c.host_id);
  select state into v_before from public.game_sessions where id = c.session_id;

  -- C11 mauvais préfixe id
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry('bad-prefix-not-live', 'Bad Id')
    );
    raise exception 'C11 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C11 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'ID custom live invalide', 'C11');
  end;

  -- C11b prefix seul sans suffixe
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry('custom-live-', 'Empty Suffix')
    );
    raise exception 'C11b aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C11b aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'ID custom live invalide', 'C11b');
  end;

  -- C11c custom absent
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(public.tn04c_new_id(), 'No Custom') - 'custom'
    );
    raise exception 'C11c aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C11c aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Flag custom live invalide', 'C11c');
  end;

  -- C11d custom:false
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(public.tn04c_new_id(), 'Custom False')
        || jsonb_build_object('custom', false)
    );
    raise exception 'C11d aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C11d aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Flag custom live invalide', 'C11d');
  end;

  -- C11e custom:"true" (string)
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(public.tn04c_new_id(), 'Custom String')
        || jsonb_build_object('custom', 'true')
    );
    raise exception 'C11e aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C11e aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Flag custom live invalide', 'C11e');
  end;

  -- C11f name <2
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(public.tn04c_new_id(), 'x')
    );
    raise exception 'C11f aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C11f aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Nom de tier list requis', 'C11f');
  end;

  -- C11g name >40 — reject, pas de troncature
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(public.tn04c_new_id(), repeat('N', 41))
    );
    raise exception 'C11g aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C11g aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Nom de tier list trop long', 'C11g');
  end;

  -- C11h emoji trop long — reject, pas de troncature
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        public.tn04c_new_id(),
        'Emoji Long',
        'ABCDEFGH',
        '["a","b","c","d"]'::jsonb
      )
    );
    raise exception 'C11h aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C11h aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Emoji custom live trop long', 'C11h');
  end;

  -- C12 <4 items
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        public.tn04c_new_id(),
        'Too Few', '🎯', '["a","b","c"]'::jsonb
      )
    );
    raise exception 'C12 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C12 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Nombre d''items custom live invalide', 'C12');
  end;

  -- C13 >16 items
  v_items := '[]'::jsonb;
  for i in 1 .. 17 loop
    v_items := v_items || jsonb_build_array('item' || i::text);
  end loop;
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        public.tn04c_new_id(),
        'Too Many', '🎯', v_items
      )
    );
    raise exception 'C13 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C13 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Nombre d''items custom live invalide', 'C13');
  end;

  -- C14 blank item
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        public.tn04c_new_id(),
        'Blank Item', '🎯', '["a","b","c","   "]'::jsonb
      )
    );
    raise exception 'C14 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C14 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Item custom live vide', 'C14');
  end;

  -- C15 doublons case/trim
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        public.tn04c_new_id(),
        'Dup Items', '🎯', '["Foo"," foo ","BAR","baz"]'::jsonb
      )
    );
    raise exception 'C15 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C15 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Items custom live en doublon', 'C15');
  end;

  -- C16 item >40 chars
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        public.tn04c_new_id(),
        'Long Item', '🎯',
        jsonb_build_array('ok1', 'ok2', 'ok3', repeat('x', 41))
      )
    );
    raise exception 'C16 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C16 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Item custom live trop long', 'C16');
  end;

  -- C17 payload >4096 octets
  v_pad := repeat('P', 4200);
  v_big := public.tn04c_valid_entry(
    public.tn04c_new_id(),
    'Huge', '🎯', '["a","b","c","d"]'::jsonb
  ) || jsonb_build_object('pad', v_pad);
  if octet_length(v_big::text) <= 4096 then
    raise exception 'C17 fixture pad trop petit octet_length=%', octet_length(v_big::text);
  end if;
  begin
    perform public.upsert_player_custom_live_tier_list(c.lobby_id, v_big);
    raise exception 'C17 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C17 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Entrée custom live trop volumineuse', 'C17');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'C11–C17 state muté par rejets validation';
  end if;

  raise notice 'C11–C17 OK — rejets id/custom/name/emoji/items/4096 ; state intact';
end $$;

-- ############################################################################
-- C18) 13+ customs — pas de plafond count
-- ############################################################################

do $$
declare
  c record;
  v_row public.game_sessions;
  v_id text;
  v_len int;
  i int;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;
  perform public.tn04c_set_jwt(c.host_id);

  -- Reset pool via UPDATE direct (postgres) pour isoler le test de count
  update public.game_sessions
  set state = jsonb_set(
        coalesce(state, '{}'::jsonb),
        '{customLiveTierLists}',
        '[]'::jsonb,
        true
      )
  where id = c.session_id;

  for i in 1 .. 13 loop
    v_id := public.tn04c_new_id();
    v_row := public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        v_id,
        'Bulk ' || i::text,
        '🎯',
        jsonb_build_array(
          'a' || i::text, 'b' || i::text, 'c' || i::text, 'd' || i::text
        )
      )
    );
  end loop;

  v_len := jsonb_array_length(v_row.state -> 'customLiveTierLists');
  if v_len < 13 then
    raise exception 'C18 attendu ≥13 got %', v_len;
  end if;

  raise notice 'C18 OK — % customs acceptés (pas de cap count)', v_len;
end $$;

-- ############################################################################
-- C19–C20) Ready N/A SQL — maps ready présentes n’empêchent pas l’upsert
-- ############################################################################

do $$
declare
  c record;
  v_row public.game_sessions;
  v_id text := public.tn04c_new_id();
  v_state jsonb;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;

  -- Documenté N/A : aucune RPC Ready côté SQL 04C. On injecte des maps ready
  -- et on vérifie que le pool reste writable + upsert OK.
  update public.game_sessions
  set state = coalesce(state, '{}'::jsonb)
    || jsonb_build_object(
         'customLiveTierListsWritable', true,
         'tierNightLivePrep', jsonb_build_object(
           'ready', jsonb_build_object(
             c.host_id::text, true,
             c.guest_id::text, true
           )
         ),
         'tierNightLive', jsonb_build_object(
           'readyByUid', jsonb_build_object(c.host_id::text, true)
         )
       )
  where id = c.session_id;

  select state into v_state from public.game_sessions where id = c.session_id;
  if public.tiernight_live_custom_pool_writable(v_state) is not true then
    raise exception 'C19 predicate fermé à tort avec Ready maps';
  end if;

  perform public.tn04c_set_jwt(c.guest_id);
  v_row := public.upsert_player_custom_live_tier_list(
    c.lobby_id,
    public.tn04c_valid_entry(v_id, 'Ready Ignored')
  );
  if public.tn04c_find_entry(v_row.state, v_id) is null then
    raise exception 'C20 upsert bloqué par Ready (ne devrait pas)';
  end if;

  raise notice 'C19–C20 OK — Ready N/A SQL ; writable + upsert OK avec ready maps';
end $$;

-- ############################################################################
-- C21–C22) writable=false → TNS_LIVE_CUSTOM_LOCKED (upsert + delete)
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb; v_err text;
  v_victim text;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;

  select e ->> 'id' into v_victim
  from public.game_sessions gs,
       jsonb_array_elements(coalesce(gs.state -> 'customLiveTierLists', '[]'::jsonb)) e
  where gs.id = c.session_id
  limit 1;
  if v_victim is null then
    raise exception 'C21/C22 besoin d’au moins 1 entrée existante';
  end if;

  update public.game_sessions
  set state = jsonb_set(
        coalesce(state, '{}'::jsonb),
        '{customLiveTierListsWritable}',
        'false'::jsonb,
        true
      )
  where id = c.session_id;

  select state into v_before from public.game_sessions where id = c.session_id;
  perform public.tn04c_set_jwt(c.host_id);

  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        public.tn04c_new_id(),
        'Should Lock'
      )
    );
    raise exception 'C21 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C21 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'TNS_LIVE_CUSTOM_LOCKED', 'C21');
  end;

  begin
    perform public.delete_player_custom_live_tier_list(c.lobby_id, v_victim);
    raise exception 'C22 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C22 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'TNS_LIVE_CUSTOM_LOCKED', 'C22');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'C21–C22 state muté sous lock writable=false';
  end if;

  raise notice 'C21–C22 OK — writable=false LOCK upsert+delete';
end $$;

-- ############################################################################
-- C23) series.kind=live → LOCKED
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb; v_err text;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;

  update public.game_sessions
  set state = coalesce(state, '{}'::jsonb)
    || jsonb_build_object(
         'customLiveTierListsWritable', true,
         'tierNightLive', jsonb_build_object(
           'series', jsonb_build_object('kind', 'live', 'phase', 'playing_list'),
           'lobbyStarted', false
         )
       )
  where id = c.session_id;

  select state into v_before from public.game_sessions where id = c.session_id;
  if public.tiernight_live_custom_pool_writable(v_before) is not false then
    raise exception 'C23 predicate devrait être false';
  end if;

  perform public.tn04c_set_jwt(c.host_id);
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        public.tn04c_new_id(),
        'Series Lock'
      )
    );
    raise exception 'C23 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C23 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'TNS_LIVE_CUSTOM_LOCKED', 'C23');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'C23 state muté';
  end if;
  raise notice 'C23 OK — series.kind=live LOCKED';
end $$;

-- ############################################################################
-- C24) Legacy lobbyStarted && !finished → LOCKED
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb; v_err text;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;

  update public.game_sessions
  set state = coalesce(state, '{}'::jsonb)
    || jsonb_build_object(
         'customLiveTierListsWritable', true,
         'tierNightLive', jsonb_build_object(
           'lobbyStarted', true,
           'finished', false
         )
       )
  where id = c.session_id;

  select state into v_before from public.game_sessions where id = c.session_id;
  if public.tiernight_live_custom_pool_writable(v_before) is not false then
    raise exception 'C24 predicate devrait être false';
  end if;

  perform public.tn04c_set_jwt(c.host_id);
  begin
    perform public.upsert_player_custom_live_tier_list(
      c.lobby_id,
      public.tn04c_valid_entry(
        public.tn04c_new_id(),
        'Mono Lock'
      )
    );
    raise exception 'C24 aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C24 aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'TNS_LIVE_CUSTOM_LOCKED', 'C24');
  end;

  if (select state from public.game_sessions where id = c.session_id) is distinct from v_before then
    raise exception 'C24 state muté';
  end if;
  raise notice 'C24 OK — lobbyStarted legacy LOCKED';
end $$;

-- ############################################################################
-- C25pre) clear host-only + CAS stale (avant clear host réussi C25)
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb;
  v_after jsonb;
  v_res jsonb;
  v_err text;
  v_outsider uuid := gen_random_uuid();
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;

  -- Pool non vide pour détecter toute mutation indésirable
  update public.game_sessions
  set state = public.tn04c_build_state(
        c.host_id,
        c.guest_id,
        jsonb_build_array(
          public.tn04c_valid_entry(c.id_a, 'List A', '🎯',
            '["alpha","bravo","charlie","delta"]'::jsonb,
            'TN04C Host', c.host_id::text)
        ),
        3,
        'true'::jsonb
      )
  where id = c.session_id;

  select state into v_before from public.game_sessions where id = c.session_id;

  -- A) guest → refus
  perform public.tn04c_set_jwt(c.guest_id);
  begin
    perform public.clear_tiernight_custom_live_tier_lists(c.lobby_id, c.session_id, false);
    raise exception 'C25pre guest aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C25pre guest aurait dû échouer' in v_err) > 0 then raise; end if;
    perform public.tn04c_assert_err(v_err, 'Hôte requis', 'C25pre-guest');
  end;

  select state into v_after from public.game_sessions where id = c.session_id;
  if v_after is distinct from v_before then
    raise exception 'C25pre guest a muté state';
  end if;

  -- B) outsider (uid non host / hors lobby) → refus
  perform public.tn04c_set_jwt(v_outsider);
  begin
    perform public.clear_tiernight_custom_live_tier_lists(c.lobby_id, c.session_id, false);
    raise exception 'C25pre outsider aurait dû échouer';
  exception when others then
    v_err := SQLERRM;
    if position('C25pre outsider aurait dû échouer' in v_err) > 0 then raise; end if;
    -- JWT outsider : is_lobby_host false → Hôte requis
    -- (tn04c_set_jwt exige auth.uid()=v_outsider ; pas besoin que l'user existe en auth.users
    --  pour SECURITY DEFINER qui lit auth.uid() depuis claims)
    perform public.tn04c_assert_err(v_err, 'Hôte requis', 'C25pre-outsider');
  end;

  select state into v_after from public.game_sessions where id = c.session_id;
  if v_after is distinct from v_before then
    raise exception 'C25pre outsider a muté state';
  end if;

  -- C) host + stale expected_session_id → STALE_SESSION, pas de mutation
  perform public.tn04c_set_jwt(c.host_id);
  v_res := public.clear_tiernight_custom_live_tier_lists(
    c.lobby_id,
    '00000000-0000-4000-8000-00000000dead'::uuid,
    false
  );
  if v_res ->> 'ok' is distinct from 'false'
     or v_res ->> 'code' is distinct from 'STALE_SESSION' then
    raise exception 'C25pre stale attendu STALE_SESSION got %', v_res;
  end if;

  select state into v_after from public.game_sessions where id = c.session_id;
  if v_after is distinct from v_before then
    raise exception 'C25pre stale a muté state';
  end if;

  raise notice 'C25pre OK — guest/outsider refusés ; STALE_SESSION sans mutation';
end $$;

-- ############################################################################
-- C25) clear → [] + epoch++ ; preserve ne ressuscite pas ; roster/snapshots OK
-- ############################################################################

do $$
declare
  c record;
  v_before jsonb; v_after jsonb; v_preserved jsonb;
  v_res jsonb;
  v_epoch_before int;
  v_roster jsonb;
  v_series jsonb;
  v_catalog jsonb;
  v_stale jsonb;
  v_row public.game_sessions;
begin
  select * into strict c from public.tn04c_smoke_ctx where id = 1;

  -- Prep ouverte avec pool non vide + roster/snapshots à préserver
  update public.game_sessions
  set state = public.tn04c_build_state(
        c.host_id,
        c.guest_id,
        jsonb_build_array(
          public.tn04c_valid_entry(c.id_a, 'List A', '🎯',
            '["alpha","bravo","charlie","delta"]'::jsonb,
            'TN04C Host', c.host_id::text),
          public.tn04c_valid_entry(c.id_b, 'List B', '🎯',
            '["alpha","bravo","charlie","delta"]'::jsonb,
            'TN04C Guest', c.guest_id::text)
        ),
        4,
        'true'::jsonb
      )
      || jsonb_build_object(
           'tierNightLive', jsonb_build_object('lobbyStarted', false)
         )
  where id = c.session_id;

  select state into v_before from public.game_sessions where id = c.session_id;
  v_epoch_before := coalesce((v_before ->> 'customLiveTierListsEpoch')::int, 0);
  v_roster := v_before -> 'customRosterTopics';
  v_series := v_before #>'{tierNight,series}';
  v_catalog := v_before -> 'customTierLists';

  if jsonb_array_length(v_before -> 'customLiveTierLists') < 2 then
    raise exception 'C25 setup lists';
  end if;

  perform public.tn04c_set_jwt(c.host_id);
  v_res := public.clear_tiernight_custom_live_tier_lists(c.lobby_id, c.session_id, false);
  if v_res ->> 'ok' is distinct from 'true' or v_res ->> 'code' is distinct from 'CLEARED' then
    raise exception 'C25 clear: %', v_res;
  end if;
  if (v_res ->> 'epoch')::int is distinct from v_epoch_before + 1 then
    raise exception 'C25 epoch want %+1 got %', v_epoch_before, v_res ->> 'epoch';
  end if;
  if (v_res ->> 'writable')::boolean is not false then
    raise exception 'C25 writable après clear(false)';
  end if;

  select state into v_after from public.game_sessions where id = c.session_id;
  if jsonb_typeof(v_after -> 'customLiveTierLists') is distinct from 'array'
     or jsonb_array_length(v_after -> 'customLiveTierLists') is distinct from 0 then
    raise exception 'C25 lists non vides après clear';
  end if;
  if (v_after ->> 'customLiveTierListsEpoch')::int is distinct from v_epoch_before + 1 then
    raise exception 'C25 state epoch';
  end if;
  if (v_after -> 'customLiveTierListsWritable') is distinct from 'false'::jsonb then
    raise exception 'C25 state writable';
  end if;

  -- Roster / snapshots / catalog Rank Live intacts
  if (v_after -> 'customRosterTopics') is distinct from v_roster then
    raise exception 'C25 roster touché';
  end if;
  if (v_after #>'{tierNight,series}') is distinct from v_series then
    raise exception 'C25 series/snapshots touchés';
  end if;
  if (v_after -> 'customTierLists') is distinct from v_catalog then
    raise exception 'C25 customTierLists touché';
  end if;

  update public.tn04c_smoke_ctx
  set epoch_after_clear = (v_res ->> 'epoch')::int
  where id = 1;

  -- Preserve : client stale tente de ressusciter les lists post-clear → refusé
  v_stale := jsonb_build_object(
    'screenHint', 'stale-client',
    'customLiveTierLists', jsonb_build_array(
      public.tn04c_valid_entry(c.id_a, 'Zombie A', '🎯',
        '["alpha","bravo","charlie","delta"]'::jsonb,
        'TN04C Host', c.host_id::text)
    ),
    'customRosterTopics', jsonb_build_array(
      jsonb_build_object('id', 'custom-roster-zombie', 'name', 'Zombie Roster', 'custom', true)
    ),
    'customLiveTierListsEpoch', 0,
    'customLiveTierListsWritable', true
  );

  v_row := public.upsert_game_session_preserving_roster_topics(
    c.lobby_id, 'tiernight', 'tiernight-live-prep', v_stale
  );
  v_preserved := v_row.state;

  if jsonb_array_length(coalesce(v_preserved -> 'customLiveTierLists', '[]'::jsonb))
     is distinct from 0 then
    raise exception 'C25 preserve a ressuscité customLiveTierLists: %',
      v_preserved -> 'customLiveTierLists';
  end if;
  if (v_preserved ->> 'customLiveTierListsEpoch')::int
     is distinct from v_epoch_before + 1 then
    raise exception 'C25 preserve a écrasé epoch';
  end if;
  if (v_preserved -> 'customLiveTierListsWritable') is distinct from 'false'::jsonb then
    raise exception 'C25 preserve a écrasé writable';
  end if;
  -- Roster serveur non vide → preserve garde le serveur (pas le zombie client)
  if (v_preserved -> 'customRosterTopics') is distinct from v_roster then
    raise exception 'C25 preserve roster serveur perdu';
  end if;

  raise notice 'C25 OK — clear [] epoch++ ; anti-resurrect preserve ; roster/snapshots OK';
end $$;

-- ############################################################################
-- CLEANUP — drop helpers harness + fixtures TN04C%
-- ############################################################################

do $$
declare
  v_clean jsonb; v_left int;
begin
  -- Tolérant si table déjà absente ; nettoie toujours lobbies TN04C%.
  if to_regprocedure('public.tn04c_cleanup_fixtures()') is not null then
    v_clean := public.tn04c_cleanup_fixtures();
  else
    v_clean := jsonb_build_object('skipped', true);
  end if;

  select count(*)::int into v_left from public.lobbies where code like 'TN04C%';
  if v_left <> 0 then raise exception 'CLEANUP left %', v_left; end if;

  drop function if exists public.tn04c_set_jwt(uuid);
  drop function if exists public.tn04c_user_has_living_membership(uuid);
  drop function if exists public.tn04c_resolve_actors();
  drop function if exists public.tn04c_new_id();
  drop function if exists public.tn04c_valid_entry(text, text, text, jsonb, text, text);
  drop function if exists public.tn04c_build_state(uuid, uuid, jsonb, int, jsonb);
  drop function if exists public.tn04c_cleanup_fixtures();
  drop function if exists public.tn04c_spawn_fixture();
  drop function if exists public.tn04c_assert_rpc_acl(text, text);
  drop function if exists public.tn04c_assert_helper_owner_only(text);
  drop function if exists public.tn04c_list_ids(jsonb);
  drop function if exists public.tn04c_find_entry(jsonb, text);
  drop function if exists public.tn04c_assert_err(text, text, text);
  drop table if exists public.tn04c_smoke_ctx;

  raise notice 'CLEANUP OK % — harness TN04C terminé', v_clean;
end $$;
