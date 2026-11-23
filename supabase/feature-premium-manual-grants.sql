-- =============================================================================
-- Droits offerts (Maître de soirée, Signature, Sans pub) à des comptes précis
-- =============================================================================
-- Besoin : offrir un droit à quelqu'un sans achat (par adresse e-mail).
-- Problème si on coche seulement les cases de `profiles` : le webhook RevenueCat
-- recalcule les droits d'après les vrais achats (audit achats n°1) et retirerait
-- un droit offert au premier achat / restauration du joueur.
--
-- Correctif :
--  * table `premium_manual_grants` : un droit offert par compte, avec la raison ;
--    lisible et modifiable seulement côté serveur (RLS sans règle, droits retirés
--    aux rôles de l'appli) ;
--  * le webhook ajoute ces droits à ceux des achats : il ne les retire jamais ;
--  * `grant_premium_by_email` / `revoke_premium_by_email` : à lancer dans l'éditeur
--    SQL (jamais depuis l'appli). Le droit est écrit aussitôt dans `profiles`.
--    Maître inclut Signature et Sans pub ; Signature inclut Sans pub.
--
-- Exemple :
--   select public.grant_premium_by_email('amie@example.com', 'host', 'Bêta-testeuse');
--   select public.revoke_premium_by_email('amie@example.com');
--
-- Miroir JS : supabase/functions/revenuecat-webhook/premium.js (applyManualGrant).
-- Rejouable.
-- =============================================================================

create table if not exists public.premium_manual_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  host_pack boolean not null default false,
  profile_pack boolean not null default false,
  ad_free boolean not null default false,
  reason text,
  granted_at timestamptz not null default now()
);

comment on table public.premium_manual_grants is
  'Droits premium offerts (sans achat). Lus par le webhook RevenueCat, qui ne les retire jamais. Écriture : éditeur SQL / service_role seulement.';

alter table public.premium_manual_grants enable row level security;
revoke all on table public.premium_manual_grants from public;
revoke all on table public.premium_manual_grants from anon;
revoke all on table public.premium_manual_grants from authenticated;

-- Droit offert : 'host' (Maître : tout), 'profile' (Signature + Sans pub), 'ad_free'.
create or replace function public.grant_premium_by_email(
  p_email text,
  p_pack text default 'host',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_pack text := lower(trim(coalesce(p_pack, '')));
  v_user uuid;
  v_host boolean;
  v_profile boolean;
  v_ad boolean;
begin
  if v_pack not in ('host', 'profile', 'ad_free') then
    raise exception 'Droit inconnu : % (host, profile ou ad_free).', p_pack;
  end if;

  select u.id into v_user
  from auth.users u
  where lower(u.email) = lower(trim(coalesce(p_email, '')))
    and coalesce(u.is_anonymous, false) is false
  limit 1;
  if v_user is null then
    return jsonb_build_object('ok', false, 'email', p_email, 'error', 'compte introuvable');
  end if;

  v_host := v_pack = 'host';
  v_profile := v_pack in ('host', 'profile');
  v_ad := true;

  insert into public.premium_manual_grants as g (user_id, host_pack, profile_pack, ad_free, reason)
  values (v_user, v_host, v_profile, v_ad, nullif(trim(coalesce(p_reason, '')), ''))
  on conflict (user_id) do update
    set host_pack = g.host_pack or excluded.host_pack,
        profile_pack = g.profile_pack or excluded.profile_pack,
        ad_free = g.ad_free or excluded.ad_free,
        reason = coalesce(excluded.reason, g.reason),
        granted_at = now();

  -- Écrit aussitôt (le joueur le voit en rouvrant l'appli). Ne retire rien.
  update public.profiles
  set host_pack = host_pack or v_host,
      profile_pack = profile_pack or v_profile,
      ad_free = ad_free or v_ad
  where id = v_user;

  return jsonb_build_object(
    'ok', true, 'email', p_email, 'user_id', v_user, 'pack', v_pack,
    'profile_found', found
  );
end;
$$;

-- Retire le droit offert. Les droits issus d'achats réels seront remis par le
-- webhook au prochain événement du compte (ou tout de suite : relancer une
-- restauration dans l'appli).
create or replace function public.revoke_premium_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user uuid;
  v_grant public.premium_manual_grants;
begin
  select u.id into v_user
  from auth.users u
  where lower(u.email) = lower(trim(coalesce(p_email, '')))
  limit 1;
  if v_user is null then
    return jsonb_build_object('ok', false, 'email', p_email, 'error', 'compte introuvable');
  end if;

  delete from public.premium_manual_grants where user_id = v_user returning * into v_grant;
  if v_grant.user_id is null then
    return jsonb_build_object('ok', false, 'email', p_email, 'error', 'aucun droit offert');
  end if;

  update public.profiles
  set host_pack = case when v_grant.host_pack then false else host_pack end,
      profile_pack = case when v_grant.profile_pack then false else profile_pack end,
      ad_free = case when v_grant.ad_free then false else ad_free end
  where id = v_user;

  return jsonb_build_object('ok', true, 'email', p_email, 'user_id', v_user);
end;
$$;

revoke all on function public.grant_premium_by_email(text, text, text) from public;
revoke all on function public.grant_premium_by_email(text, text, text) from anon;
revoke all on function public.grant_premium_by_email(text, text, text) from authenticated;
revoke all on function public.revoke_premium_by_email(text) from public;
revoke all on function public.revoke_premium_by_email(text) from anon;
revoke all on function public.revoke_premium_by_email(text) from authenticated;
