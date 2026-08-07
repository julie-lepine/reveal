-- =============================================================================
-- CLEANUP-FILROUGE-02 — Audit serveur READ ONLY (Supabase SQL Editor)
-- =============================================================================
-- Exécuter tel quel. Aucun DROP / ALTER / UPDATE / DELETE / CREATE OR REPLACE.
-- Coller le résultat dans le chat pour la suite du ticket.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Existence + estimation de volume (sans FROM direct : safe si absente)
-- ---------------------------------------------------------------------------
select
  to_regclass('public.fil_rouge_private') is not null as table_exists,
  (
    select c.reltuples::bigint
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'fil_rouge_private'
      and c.relkind = 'r'
  ) as approx_row_estimate;

-- Compte exact (n’exécuter QUE si table_exists = true) :
--   select count(*)::bigint as exact_row_count from public.fil_rouge_private;

-- ---------------------------------------------------------------------------
-- 2) Colonnes (si table présente)
-- ---------------------------------------------------------------------------
select
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'fil_rouge_private'
order by c.ordinal_position;

-- ---------------------------------------------------------------------------
-- 3) Contraintes / foreign keys dépendantes (vers ou depuis la table)
-- ---------------------------------------------------------------------------
select
  tc.constraint_type,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
left join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.table_name = 'fil_rouge_private'
order by tc.constraint_type, tc.constraint_name, kcu.ordinal_position;

-- FKs d'autres tables qui référencent fil_rouge_private (si existantes)
select
  con.conname as constraint_name,
  rel_from.relname as from_table,
  att_from.attname as from_column,
  rel_to.relname as to_table,
  att_to.attname as to_column
from pg_constraint con
join pg_class rel_from on rel_from.oid = con.conrelid
join pg_namespace nsp_from on nsp_from.oid = rel_from.relnamespace
join pg_class rel_to on rel_to.oid = con.confrelid
join pg_namespace nsp_to on nsp_to.oid = rel_to.relnamespace
join lateral unnest(con.conkey) with ordinality as ck(attnum, ord) on true
join lateral unnest(con.confkey) with ordinality as fk(attnum, ord) on fk.ord = ck.ord
join pg_attribute att_from
  on att_from.attrelid = con.conrelid and att_from.attnum = ck.attnum
join pg_attribute att_to
  on att_to.attrelid = con.confrelid and att_to.attnum = fk.attnum
where con.contype = 'f'
  and nsp_to.nspname = 'public'
  and rel_to.relname = 'fil_rouge_private';

-- ---------------------------------------------------------------------------
-- 4) Policies RLS
-- ---------------------------------------------------------------------------
select
  pol.polname as policy_name,
  case pol.polcmd
    when 'r' then 'SELECT'
    when 'a' then 'INSERT'
    when 'w' then 'UPDATE'
    when 'd' then 'DELETE'
    when '*' then 'ALL'
    else pol.polcmd::text
  end as command,
  pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
  pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expr
from pg_policy pol
join pg_class cls on cls.oid = pol.polrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and cls.relname = 'fil_rouge_private'
order by pol.polname;

-- ---------------------------------------------------------------------------
-- 5) Triggers
-- ---------------------------------------------------------------------------
select
  tg.tgname as trigger_name,
  pg_get_triggerdef(tg.oid, true) as trigger_def
from pg_trigger tg
join pg_class cls on cls.oid = tg.tgrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and cls.relname = 'fil_rouge_private'
  and not tg.tgisinternal
order by tg.tgname;

-- ---------------------------------------------------------------------------
-- 6) Dépendances catalogue (vues / fonctions / etc. liées à la table)
-- ---------------------------------------------------------------------------
select
  dependent_ns.nspname as dependent_schema,
  dependent_obj.relname as dependent_name,
  dependent_obj.relkind as dependent_kind,
  source_ns.nspname as source_schema,
  source_obj.relname as source_name
from pg_depend dep
join pg_rewrite rw on rw.oid = dep.objid
join pg_class dependent_obj on dependent_obj.oid = rw.ev_class
join pg_namespace dependent_ns on dependent_ns.oid = dependent_obj.relnamespace
join pg_class source_obj on source_obj.oid = dep.refobjid
join pg_namespace source_ns on source_ns.oid = source_obj.relnamespace
where source_ns.nspname = 'public'
  and source_obj.relname = 'fil_rouge_private'
  and dependent_obj.oid <> source_obj.oid;

-- Dépendances pg_proc (fonctions) référencant l'OID de la table si présentes
select
  nsp.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args
from pg_depend d
join pg_proc p on p.oid = d.objid
join pg_namespace nsp on nsp.oid = p.pronamespace
join pg_class c on c.oid = d.refobjid
join pg_namespace cn on cn.oid = c.relnamespace
where d.deptype in ('n', 'a')
  and cn.nspname = 'public'
  and c.relname = 'fil_rouge_private'
order by 1, 2, 3;

-- ---------------------------------------------------------------------------
-- 7) Fonctions dont le corps mentionne Fil Rouge / fil_rouge*
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prokind as kind,
  (
    position('filRouge' in pg_get_functiondef(p.oid)) > 0
    or position('filRougeScores' in pg_get_functiondef(p.oid)) > 0
    or position('fil_rouge' in pg_get_functiondef(p.oid)) > 0
  ) as mentions_fil_rouge,
  case
    when position('filRougeScores' in pg_get_functiondef(p.oid)) > 0 then 'filRougeScores'
    when position('''filRouge''' in pg_get_functiondef(p.oid)) > 0 then 'filRouge_key'
    when position('fil_rouge_private' in pg_get_functiondef(p.oid)) > 0 then 'fil_rouge_private'
    when position('filRouge' in pg_get_functiondef(p.oid)) > 0 then 'filRouge'
    when position('fil_rouge' in pg_get_functiondef(p.oid)) > 0 then 'fil_rouge'
    else null
  end as primary_hit
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
  and (
    position('filRouge' in pg_get_functiondef(p.oid)) > 0
    or position('filRougeScores' in pg_get_functiondef(p.oid)) > 0
    or position('fil_rouge' in pg_get_functiondef(p.oid)) > 0
  )
order by p.proname, 3;

-- ---------------------------------------------------------------------------
-- 8) Objets nommés Fil Rouge (tables, indexes, sequences, etc.)
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  c.relname as object_name,
  c.relkind as kind
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and (
    c.relname ilike '%fil_rouge%'
    or c.relname ilike '%filrouge%'
  )
order by c.relkind, c.relname;

-- ---------------------------------------------------------------------------
-- 9) Signatures + extraits utiles des RPC critiques
--     (corps tronqué pour lisibilité ; full def via query suivante si besoin)
-- ---------------------------------------------------------------------------
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  left(pg_get_functiondef(p.oid), 4000) as definition_prefix
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'apply_acting_host_play',
    'complete_game_session_as_actor',
    'game_session_state_key',
    'game_session_expected_game_id',
    'contribute_game_session_player',
    'remap_lobby_user_id',
    'reclaim_guest_membership',
    'reveal_poll_allowed_game_ids'
  )
order by p.proname, 2;

-- Markers booléens ciblés (contrat actif réel)
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  (position('filRouge' in pg_get_functiondef(p.oid)) > 0) as has_filRouge,
  (position('filRougeScores' in pg_get_functiondef(p.oid)) > 0) as has_filRougeScores,
  (position('fil_rouge_private' in pg_get_functiondef(p.oid)) > 0) as has_fil_rouge_private,
  (position('playlistGuess' in pg_get_functiondef(p.oid)) > 0) as has_playlistGuess,
  (position('tiernight-end' in pg_get_functiondef(p.oid)) > 0) as has_tiernight_end_screen,
  (position('gameScoreSessionKey' in pg_get_functiondef(p.oid)) > 0) as has_gameScoreSessionKey
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'apply_acting_host_play',
    'complete_game_session_as_actor',
    'game_session_state_key',
    'game_session_expected_game_id',
    'contribute_game_session_player',
    'remap_lobby_user_id',
    'reveal_poll_allowed_game_ids'
  )
order by p.proname, 2;

-- ---------------------------------------------------------------------------
-- 10) Grants sur fil_rouge_private (si table)
-- ---------------------------------------------------------------------------
select
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'fil_rouge_private'
order by grantee, privilege_type;
