-- Audit carnet et cosmétiques (tmp/audit-carnet-cosmetiques.md) n°1.
--
-- Avant : l'emoji et la couleur d'un membre du salon (lobby_members) étaient écrits
-- par le joueur lui-même, coupés à 16 caractères mais sans contrôle du contenu.
-- L'appli les insérait tels quels dans la page : une appli modifiée pouvait afficher
-- du HTML court à tout le salon, et un joueur sans Signature pouvait prendre un emoji
-- Signature. L'emoji d'un profil Signature acceptait n'importe quel texte (32 octets).
--
-- Après :
--   - lobby_members (lobby_members_stamp_signature, qui lit déjà le pack) :
--       emoji : un emoji gratuit, ou un emoji Signature si le compte a le pack,
--               sinon 👤 ;
--       couleur : #rgb, #rrggbb ou #rrggbbaa, sinon la couleur d'avant (modification)
--                 ou #60A5FA (arrivée).
--   - profiles (profiles_signature_cosmetics) : avec le pack, emoji gratuit ou
--     Signature seulement, sinon 👤. Sans le pack : inchangé (gratuits seulement).
--   Comparaison en UTF-8 hexadécimal sans le sélecteur FE0F, comme avant.
--
-- Les listes doivent rester alignées sur data/profileEmojis.js et
-- data/signatureIdentity.js (test : tests/fixMemberCosmetics.test.js).
-- Idempotent (create or replace). Consigner dans docs/DEPLOYMENTS_SQL.md (fiche 57).

create or replace function public.lobby_members_stamp_signature()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_ver constant text := 'member-cosmetics-v1';
  v_free_hex text[] := array[
    'f09f9880','f09fa4a9','f09fa5b3','f09f8ead','f09f8eae','f09f838f',
    'f09f91a4','f09f8dba','e29abd','e2ad90','f09f8eb2','f09fa68a',
    'f09f90b1','f09f90b6','f09fa681','f09f8d95','f09f8eb8','f09f95b5'
  ];
  v_signature_hex text[] := array[
    'f09f9191','f09fa684','f09f9089','f09fa68b','f09f8c99','e29aa1',
    'f09fa582','f09f8f86','f09f92ab','f09fa7bf','f09f96a4','f09fa9b7',
    'f09f9888','f09f91bb','f09f94a5','f09f90b8','f09f928e','f09f8c88',
    'f09f988e','f09f929c','f09f8c9f','f09f8eaf','f09f9a80','f09f8e88'
  ];
  v_pack boolean;
  v_color text;
  v_path text;
  v_rev integer;
  v_raw text;
  v_hex text;
begin
  select p.profile_pack, p.name_color, p.avatar_path, p.avatar_rev
    into v_pack, v_color, v_path, v_rev
  from public.profiles p
  where p.id = new.user_id;

  new.signature := coalesce(v_pack, false);
  new.name_color := case when new.signature then v_color else null end;
  new.avatar_path := case when new.signature then v_path else null end;
  new.avatar_rev := case when new.signature then coalesce(v_rev, 0) else 0 end;

  v_raw := nullif(trim(coalesce(new.emoji, '')), '');
  v_hex := lower(replace(encode(convert_to(coalesce(v_raw, ''), 'UTF8'), 'hex'), 'efb88f', ''));
  if v_raw is null
     or not (
       v_hex = any (v_free_hex)
       or (new.signature and v_hex = any (v_signature_hex))
     ) then
    new.emoji := convert_from(decode('f09f91a4', 'hex'), 'utf8');
  end if;

  if new.color is null or new.color !~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$' then
    if tg_op = 'UPDATE' and old.color ~ '^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$' then
      new.color := old.color;
    else
      new.color := '#60A5FA';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.profiles_signature_cosmetics()
returns trigger
language plpgsql
as $function$
declare
  v_ver constant text := 'member-cosmetics-v1';
  v_allowed_colors text[] := array['gold','rose','violet','cyan','lime','amber','coral','ice'];
  v_free_hex text[] := array[
    'f09f9880','f09fa4a9','f09fa5b3','f09f8ead','f09f8eae','f09f838f',
    'f09f91a4','f09f8dba','e29abd','e2ad90','f09f8eb2','f09fa68a',
    'f09f90b1','f09f90b6','f09fa681','f09f8d95','f09f8eb8','f09f95b5'
  ];
  v_signature_hex text[] := array[
    'f09f9191','f09fa684','f09f9089','f09fa68b','f09f8c99','e29aa1',
    'f09fa582','f09f8f86','f09f92ab','f09fa7bf','f09f96a4','f09fa9b7',
    'f09f9888','f09f91bb','f09f94a5','f09f90b8','f09f928e','f09f8c88',
    'f09f988e','f09f929c','f09f8c9f','f09f8eaf','f09f9a80','f09f8e88'
  ];
  v_raw text;
  v_hex text;
  v_pack boolean;
  v_existing boolean;
begin
  v_pack := coalesce(new.profile_pack, false);
  if tg_op = 'UPDATE' then
    -- ID-OLD : conservé si old OU new a le pack (refund true→false et grant false→true).
    -- coalesce(old, new) est faux : coalesce(false, true) = false en PostgreSQL.
    v_pack := coalesce(old.profile_pack, false) or coalesce(new.profile_pack, false);
  elsif new.id is not null then
    select p.profile_pack into v_existing
    from public.profiles p
    where p.id = new.id;
    if found then
      v_pack := coalesce(v_existing, false);
    end if;
  end if;

  if not v_pack then
    new.name_color := null;
  elsif new.name_color is not null and not (new.name_color = any (v_allowed_colors)) then
    new.name_color := null;
  end if;

  v_raw := nullif(trim(coalesce(new.emoji, '')), '');
  if v_raw is not null and octet_length(v_raw) > 32 then
    v_raw := null;
  end if;
  v_hex := lower(replace(encode(convert_to(coalesce(v_raw, ''), 'UTF8'), 'hex'), 'efb88f', ''));

  if v_raw is not null
     and (v_hex = any (v_free_hex) or (v_pack and v_hex = any (v_signature_hex))) then
    new.emoji := v_raw;
  else
    new.emoji := convert_from(decode('f09f91a4', 'hex'), 'utf8');
  end if;
  return new;
end;
$function$;

-- Contrôles après application :
-- select pg_get_functiondef('public.lobby_members_stamp_signature()'::regprocedure) like '%member-cosmetics-v1%';
-- select pg_get_functiondef('public.profiles_signature_cosmetics()'::regprocedure) like '%member-cosmetics-v1%';
