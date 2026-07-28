-- =============================================================================
-- Snapshot prod (2026-07-28) — create_lobby_member
-- Définition récupérée via pg_get_functiondef — ne pas inventer.
-- E4 : le chemin create client bascule vers create_lobby_atomically ;
-- cette fonction est dépréciée à l’étape F (voir e4-03).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_lobby_member(
  p_lobby_id uuid,
  p_display_name text,
  p_emoji text,
  p_color text
)
RETURNS public.lobby_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  inserted public.lobby_members;
begin

  insert into public.lobby_members (
    lobby_id,
    user_id,
    display_name,
    emoji,
    color,
    is_host,
    ready
  )
  values (
    p_lobby_id,
    auth.uid(),
    p_display_name,
    p_emoji,
    p_color,
    true,
    false
  )
  returning *
  into inserted;

  return inserted;

end;
$function$;
