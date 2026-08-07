-- =============================================================================
-- CLEANUP-FILROUGE-02 — Audit serveur READ ONLY v2 (résultat UNIQUE)
-- =============================================================================
-- Pourquoi v2 : l’éditeur SQL Supabase n’affiche souvent que le DERNIER SELECT
-- d’un script multi-statements. Ce fichier produit UN SEUL résultat tabular.
--
-- Copier TOUT le tableau retourné (colonnes section / object_name / key / value).
--
-- Strictement READ ONLY : SELECT uniquement.
-- Aucun DROP / ALTER / UPDATE / DELETE / INSERT / CREATE / CREATE OR REPLACE.
-- Aucune table temporaire.
-- =============================================================================

select *
from (
  -- =========================================================================
  -- 1) TABLE fil_rouge_private
  -- =========================================================================
  select
    10 as sort_key,
    'table'::text as section,
    'public.fil_rouge_private'::text as object_name,
    'table_exists'::text as key,
    (to_regclass('public.fil_rouge_private') is not null)::text as value

  union all
  select
    11,
    'table',
    'public.fil_rouge_private',
    'exact_row_count',
    (select count(*)::text from public.fil_rouge_private)

  union all
  select
    12,
    'table',
    'public.fil_rouge_private',
    'relkind',
    coalesce(
      (
        select c.relkind::text
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'fil_rouge_private'
        limit 1
      ),
      'missing'
    )

  -- =========================================================================
  -- 2) RLS
  -- =========================================================================
  union all
  select
    20,
    'rls',
    'public.fil_rouge_private',
    'row_security_enabled',
    coalesce(
      (
        select c.relrowsecurity::text
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'fil_rouge_private'
        limit 1
      ),
      'n/a'
    )

  union all
  select
    21,
    'rls',
    'public.fil_rouge_private',
    'row_security_forced',
    coalesce(
      (
        select c.relforcerowsecurity::text
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'fil_rouge_private'
        limit 1
      ),
      'n/a'
    )

  union all
  select
    22 + row_number() over (order by pol.polname),
    'rls_policy',
    pol.polname,
    'detail',
    jsonb_build_object(
      'command', case pol.polcmd
        when 'r' then 'SELECT'
        when 'a' then 'INSERT'
        when 'w' then 'UPDATE'
        when 'd' then 'DELETE'
        when '*' then 'ALL'
        else pol.polcmd::text
      end,
      'permissive', case when pol.polpermissive then 'PERMISSIVE' else 'RESTRICTIVE' end,
      'roles', coalesce(
        (
          select array_agg(r.rolname order by r.rolname)
          from unnest(pol.polroles) as u(oid)
          join pg_roles r on r.oid = u.oid
        ),
        array['public']::name[]
      ),
      'using', pg_get_expr(pol.polqual, pol.polrelid),
      'with_check', pg_get_expr(pol.polwithcheck, pol.polrelid)
    )::text
  from pg_policy pol
  join pg_class cls on cls.oid = pol.polrelid
  join pg_namespace nsp on nsp.oid = cls.relnamespace
  where nsp.nspname = 'public'
    and cls.relname = 'fil_rouge_private'

  -- =========================================================================
  -- 3) TRIGGERS
  -- =========================================================================
  union all
  select
    40 + row_number() over (order by tg.tgname),
    'trigger',
    tg.tgname,
    'definition',
    pg_get_triggerdef(tg.oid, true)
  from pg_trigger tg
  join pg_class cls on cls.oid = tg.tgrelid
  join pg_namespace nsp on nsp.oid = cls.relnamespace
  where nsp.nspname = 'public'
    and cls.relname = 'fil_rouge_private'
    and not tg.tgisinternal

  -- =========================================================================
  -- 4a) FK sortantes (depuis fil_rouge_private)
  -- =========================================================================
  union all
  select
    50 + row_number() over (order by con.conname),
    'fk_outgoing',
    con.conname,
    'detail',
    format(
      '%s.%s(%s) -> %s.%s(%s)',
      nsp_from.nspname,
      rel_from.relname,
      att_from.attname,
      nsp_to.nspname,
      rel_to.relname,
      att_to.attname
    )
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
    and nsp_from.nspname = 'public'
    and rel_from.relname = 'fil_rouge_private'

  -- =========================================================================
  -- 4b) FK entrantes (autres tables -> fil_rouge_private)
  -- =========================================================================
  union all
  select
    60 + row_number() over (order by con.conname),
    'fk_incoming',
    con.conname,
    'detail',
    format(
      '%s.%s(%s) -> %s.%s(%s)',
      nsp_from.nspname,
      rel_from.relname,
      att_from.attname,
      nsp_to.nspname,
      rel_to.relname,
      att_to.attname
    )
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
    and rel_to.relname = 'fil_rouge_private'

  -- =========================================================================
  -- 4c) Dépendances catalogue fortes (vues / rewrite)
  -- =========================================================================
  union all
  select
    70 + row_number() over (order by dependent_ns.nspname, dependent_obj.relname),
    'dep_view_or_rule',
    dependent_ns.nspname || '.' || dependent_obj.relname,
    'kind',
    dependent_obj.relkind::text
  from pg_depend dep
  join pg_rewrite rw on rw.oid = dep.objid
  join pg_class dependent_obj on dependent_obj.oid = rw.ev_class
  join pg_namespace dependent_ns on dependent_ns.oid = dependent_obj.relnamespace
  join pg_class source_obj on source_obj.oid = dep.refobjid
  join pg_namespace source_ns on source_ns.oid = source_obj.relnamespace
  where source_ns.nspname = 'public'
    and source_obj.relname = 'fil_rouge_private'
    and dependent_obj.oid <> source_obj.oid

  -- =========================================================================
  -- 4d) Dépendances catalogue fortes (fonctions -> OID table)
  -- =========================================================================
  union all
  select
    80 + row_number() over (order by nsp.nspname, p.proname),
    'dep_function_oid',
    nsp.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    'deptype',
    d.deptype::text
  from pg_depend d
  join pg_proc p on p.oid = d.objid
  join pg_namespace nsp on nsp.oid = p.pronamespace
  join pg_class c on c.oid = d.refobjid
  join pg_namespace cn on cn.oid = c.relnamespace
  where d.deptype in ('n', 'a')
    and cn.nspname = 'public'
    and c.relname = 'fil_rouge_private'

  -- =========================================================================
  -- 5) Fonctions public dont le corps mentionne Fil Rouge (réf. dynamique possible)
  -- =========================================================================
  union all
  select
    90 + row_number() over (order by p.proname, pg_get_function_identity_arguments(p.oid)),
    'function_body_hit',
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    'markers',
    jsonb_build_object(
      'has_filRouge', position('filRouge' in pg_get_functiondef(p.oid)) > 0,
      'has_filRougeScores', position('filRougeScores' in pg_get_functiondef(p.oid)) > 0,
      'has_fil_rouge', position('fil_rouge' in pg_get_functiondef(p.oid)) > 0,
      'has_fil_rouge_private', position('fil_rouge_private' in pg_get_functiondef(p.oid)) > 0
    )::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and (
      position('filRouge' in pg_get_functiondef(p.oid)) > 0
      or position('filRougeScores' in pg_get_functiondef(p.oid)) > 0
      or position('fil_rouge' in pg_get_functiondef(p.oid)) > 0
    )

  -- =========================================================================
  -- 6) RPC CRITIQUES — vérité live (section à lire en priorité)
  -- =========================================================================
  union all
  select
    200 + row_number() over (order by p.proname, pg_get_function_identity_arguments(p.oid)),
    'rpc_critical',
    p.proname,
    'markers',
    jsonb_build_object(
      'args', pg_get_function_identity_arguments(p.oid),
      'has_filRouge', position('filRouge' in pg_get_functiondef(p.oid)) > 0,
      'has_filRougeScores', position('filRougeScores' in pg_get_functiondef(p.oid)) > 0,
      'has_fil_rouge_private', position('fil_rouge_private' in pg_get_functiondef(p.oid)) > 0,
      'has_playlistGuess', position('playlistGuess' in pg_get_functiondef(p.oid)) > 0,
      'has_tiernight_end_screen', position('tiernight-end' in pg_get_functiondef(p.oid)) > 0,
      'has_gameScoreSessionKey', position('gameScoreSessionKey' in pg_get_functiondef(p.oid)) > 0
    )::text
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

  -- Lecture rapide complète / QA-01
  union all
  select
    300,
    'rpc_critical_summary',
    'complete_game_session_as_actor',
    'qa01_fingerprint',
    coalesce(
      (
        select jsonb_build_object(
          'args', pg_get_function_identity_arguments(p.oid),
          'has_tiernight_end_screen', position('tiernight-end' in pg_get_functiondef(p.oid)) > 0,
          'has_playlistGuess', position('playlistGuess' in pg_get_functiondef(p.oid)) > 0,
          'has_filRouge', position('filRouge' in pg_get_functiondef(p.oid)) > 0,
          'looks_like_qa01',
            position('tiernight-end' in pg_get_functiondef(p.oid)) > 0
        )::text
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'complete_game_session_as_actor'
        order by p.oid
        limit 1
      ),
      '{"missing":true}'
    )

  -- =========================================================================
  -- 7) GRANTS (déjà observés ; repris pour synthèse)
  -- =========================================================================
  union all
  select
    400 + row_number() over (order by g.grantee, g.privilege_type),
    'grant',
    g.grantee,
    g.privilege_type,
    'grantable=' || g.is_grantable
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name = 'fil_rouge_private'
) audit
order by sort_key, section, object_name, key;
