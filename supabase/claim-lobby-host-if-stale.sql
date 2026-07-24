-- REVEAL — ARCH-03b : claim_lobby_host_if_stale
-- Transfert explicite du rôle d'hôte quand l'hôte réel est stale ≥ 5 minutes.
-- Ne pas confondre avec l'acting host technique (120 s, session de jeu uniquement).
--
-- Réexécutable. Ne touche PAS aux policies I-08 ni aux RPC joueur.
-- À exécuter dans le SQL Editor Supabase (ou via CLI liée).

create or replace function public.claim_lobby_host_if_stale(p_lobby_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_old_host_id uuid;
  v_elected uuid;
  v_host_present boolean;
  v_stale interval := interval '5 minutes';
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;

  if not public.is_lobby_member(p_lobby_id) then
    raise exception 'Tu n''es pas membre de ce lobby.';
  end if;

  -- Verrou concurrent claims
  select host_id into v_old_host_id
  from public.lobbies
  where id = p_lobby_id
  for update;

  if v_old_host_id is null then
    raise exception 'Lobby introuvable.';
  end if;

  -- Déjà hôte : succès idempotent
  if v_uid = v_old_host_id then
    return true;
  end if;

  -- Hôte réel présent ? (last_seen_at IS NULL = présent, legacy — inchangé)
  select exists (
    select 1
    from public.lobby_members m
    where m.lobby_id = p_lobby_id
      and m.user_id = v_old_host_id
      and (
        m.last_seen_at is null
        or m.last_seen_at >= (now() - v_stale)
      )
  ) into v_host_present;

  if v_host_present then
    raise exception 'L''hôte est encore actif.';
  end if;

  -- Candidat déterministe parmi les présents (même algo que is_acting_host, seuil 5 min)
  select lm.user_id
  into v_elected
  from public.lobby_members lm
  where lm.lobby_id = p_lobby_id
    and lm.user_id is not null
    and (
      lm.last_seen_at is null
      or lm.last_seen_at >= (now() - v_stale)
    )
  order by lm.user_id::text asc
  limit 1;

  if v_elected is null or v_elected is distinct from v_uid then
    raise exception 'Un autre joueur est prioritaire pour reprendre l''hôte.';
  end if;

  update public.lobbies
  set host_id = v_uid
  where id = p_lobby_id;

  -- Normalisation globale : un seul is_host=true (répare aussi un état multi-flags incohérent)
  -- Pas de couleur : évite d'écraser une perso utilisateur
  update public.lobby_members
  set is_host = (user_id = v_uid)
  where lobby_id = p_lobby_id;

  -- Autorité courante I-08 : une session par lobby (unique lobby_id).
  -- Sans cet alignement, le nouveau host ne pourrait pas UPDATE game_sessions.
  update public.game_sessions
  set host_id = v_uid
  where lobby_id = p_lobby_id;

  return true;
end;
$$;

comment on function public.claim_lobby_host_if_stale(uuid) is
  'ARCH-03b : claim atomique du rôle hôte si host stale ≥ 5 min ; candidat déterministe serveur.';

revoke all on function public.claim_lobby_host_if_stale(uuid) from public;
revoke all on function public.claim_lobby_host_if_stale(uuid) from anon;
grant execute on function public.claim_lobby_host_if_stale(uuid) to authenticated;
