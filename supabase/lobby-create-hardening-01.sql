-- =============================================================================
-- Durcissement création de lobby (anti-abus sans captcha)
--   1) Plus d'INSERT direct sur public.lobbies : création uniquement via
--      create_lobby_atomically (SECURITY DEFINER, non concernée par la révocation).
--   2) Limite de fréquence : 5 créations / heure / compte (journal dédié, car
--      un lobby supprimé disparaît de public.lobbies).
--
-- Prérequis : le client actuel ne crée plus de lobby que via la RPC (vérifié dans
-- js/core/supabaseLobby.js). Les anciens builds qui insèrent directement dans
-- lobbies seront refusés -> relever app_client_compatibility si besoin.
--
-- Rollback : voir bloc commenté en bas de fichier.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Journal de créations (invisible du client)
-- ---------------------------------------------------------------------------
create table if not exists public.lobby_create_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists lobby_create_log_user_created_idx
  on public.lobby_create_log (user_id, created_at desc);

alter table public.lobby_create_log enable row level security;
-- Aucune policy : aucun accès client. Seule la fonction SECURITY DEFINER écrit/lit.
revoke all on table public.lobby_create_log from anon, authenticated;

comment on table public.lobby_create_log is
  'Anti-abus : journal des créations de lobby (limite 5/h/compte). Pas d''accès client.';

-- ---------------------------------------------------------------------------
-- 2) create_lobby_atomically : même contrat qu'avant + limite de fréquence
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_lobby_atomically(p_display_name text, p_emoji text, p_color text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_attempt int;
  v_i int;
  v_idx int;
  v_lobby public.lobbies%ROWTYPE;
  v_member public.lobby_members%ROWTYPE;
  v_canon_lobby_id uuid;
  v_canon_code text;
  v_living_count integer;
  v_recent_count integer;
  c_max_per_hour constant integer := 5;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié.'
      USING ERRCODE = '42501';
  END IF;

  -- Sérialise create ↔ create pour ce user (join PostgREST hors lock — UNIQUE en D).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- Même ordre que compareMembershipRowsDeterministic (joined_at DESC, lobby_id ASC).
  SELECT
    count(*)::integer,
    (
      SELECT m.lobby_id
      FROM public.lobby_members m
      INNER JOIN public.lobbies l ON l.id = m.lobby_id
      WHERE m.user_id = v_uid
      ORDER BY m.joined_at DESC NULLS LAST, m.lobby_id ASC
      LIMIT 1
    ),
    (
      SELECT l.code
      FROM public.lobby_members m
      INNER JOIN public.lobbies l ON l.id = m.lobby_id
      WHERE m.user_id = v_uid
      ORDER BY m.joined_at DESC NULLS LAST, m.lobby_id ASC
      LIMIT 1
    )
  INTO v_living_count, v_canon_lobby_id, v_canon_code
  FROM public.lobby_members m
  INNER JOIN public.lobbies l ON l.id = m.lobby_id
  WHERE m.user_id = v_uid;

  IF v_living_count IS NULL THEN
    v_living_count := 0;
  END IF;

  IF v_canon_lobby_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'ALREADY_EXISTS',
      'lobby_id', v_canon_lobby_id,
      'lobby_code', v_canon_code,
      'extra_count', GREATEST(v_living_count - 1, 0)
    );
  END IF;

  -- Limite de fréquence (après ALREADY_EXISTS : retrouver son lobby n'est jamais bloqué).
  DELETE FROM public.lobby_create_log
  WHERE user_id = v_uid AND created_at < now() - interval '1 day';

  SELECT count(*)::integer INTO v_recent_count
  FROM public.lobby_create_log
  WHERE user_id = v_uid AND created_at > now() - interval '1 hour';

  IF v_recent_count >= c_max_per_hour THEN
    RAISE EXCEPTION 'Trop de lobbies créés récemment. Réessaie dans quelques minutes.'
      USING ERRCODE = 'P0001';
  END IF;

  v_code := NULL;
  FOR v_attempt IN 1..12 LOOP
    v_code := '';
    FOR v_i IN 1..6 LOOP
      v_idx := 1 + floor(random() * length(v_chars))::integer;
      v_code := v_code || substr(v_chars, v_idx, 1);
    END LOOP;
    IF NOT EXISTS (
      SELECT 1
      FROM public.lobbies l
      WHERE upper(trim(l.code)) = upper(trim(v_code))
    ) THEN
      EXIT;
    END IF;
    v_code := NULL;
  END LOOP;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Impossible de générer un code lobby.';
  END IF;

  INSERT INTO public.lobbies (code, host_id, status, game_id)
  VALUES (v_code, v_uid, 'waiting', NULL)
  RETURNING * INTO v_lobby;

  INSERT INTO public.lobby_create_log (user_id) VALUES (v_uid);

  -- Contrat create_lobby_member (hôte).
  INSERT INTO public.lobby_members (
    lobby_id,
    user_id,
    display_name,
    emoji,
    color,
    is_host,
    ready
  )
  VALUES (
    v_lobby.id,
    v_uid,
    p_display_name,
    p_emoji,
    p_color,
    true,
    false
  )
  RETURNING * INTO v_member;

  RETURN jsonb_build_object(
    'status', 'CREATED',
    'lobby_id', v_lobby.id,
    'lobby_code', v_lobby.code,
    'extra_count', 0,
    'member', to_jsonb(v_member)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- APPLIQUÉ en production le 2026-11-10 (migration « lobby_create_rate_limit »).
-- La fermeture de l'INSERT direct est dans lobby-create-hardening-02-close-insert.sql
-- (à lancer plus tard, après relèvement du floor de compatibilité).
--
-- Vérification : select position('c_max_per_hour' in
--   pg_get_functiondef('public.create_lobby_atomically(text,text,text)'::regprocedure)) > 0;
-- Test appli : créer puis dissoudre 5 lobbies d'affilée avec le même compte,
--   le 6e doit être refusé (« Trop de lobbies créés récemment… »).
--
-- ROLLBACK : rejouer lobby-membership-e4-01-create-lobby-atomically.sql
--   (ancienne fonction) ; la table lobby_create_log peut rester (inoffensive).
-- ---------------------------------------------------------------------------
