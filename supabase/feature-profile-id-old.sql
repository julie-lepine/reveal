-- ID-OLD — Préserver cosmetics Signature au refund → re-grant
--
-- À coller dans SQL Editor (prod) APRÈS 03c + 05. Idempotent.
-- CREATE OR REPLACE uniquement : ne drop pas les triggers, pas de Storage.
--
-- UPDATE : v_pack = old.profile_pack OR new.profile_pack
--   refund true→false : conservé
--   grant  false→true : conservé (l’ancien coalesce(old, new) wipait ici)
-- INSERT 03c : inchangé (lecture du pack déjà en base pendant UPSERT).
--
-- Preuve :
--   select pg_get_functiondef('public.profiles_signature_cosmetics()'::regprocedure)
--     like '%03c-persist-v4%';
--   select pg_get_functiondef('public.profiles_signature_avatar()'::regprocedure)
--     like '%id-old-v1%';

create or replace function public.profiles_signature_cosmetics()
returns trigger
language plpgsql
as $$
declare
  v_ver constant text := '03c-persist-v4';
  v_allowed_colors text[] := array['gold','rose','violet','cyan','lime','amber','coral','ice'];
  v_free_hex text[] := array[
    'f09f9880','f09fa4a9','f09fa5b3','f09f8ead','f09f8eae','f09f838f',
    'f09f91a4','f09f8dba','e29abd','e2ad90','f09f8eb2','f09fa68a',
    'f09f90b1','f09f90b6','f09fa681','f09f8d95','f09f8eb8','f09f95b5'
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

  if v_pack then
    if v_raw is null then
      new.emoji := convert_from(decode('f09f91a4', 'hex'), 'utf8');
    else
      new.emoji := v_raw;
    end if;
    return new;
  end if;

  if v_raw is null or v_hex = '' or not (v_hex = any (v_free_hex)) then
    new.emoji := convert_from(decode('f09f91a4', 'hex'), 'utf8');
  else
    new.emoji := v_raw;
  end if;
  return new;
end;
$$;

create or replace function public.profiles_signature_avatar()
returns trigger
language plpgsql
as $$
declare
  v_ver constant text := 'id-old-v1';
  v_pack boolean;
  v_existing boolean;
  v_expected text;
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

  new.avatar_path := nullif(trim(coalesce(new.avatar_path, '')), '');
  v_expected := new.id::text || '/avatar.jpg';

  if not v_pack then
    new.avatar_path := null;
    new.avatar_rev := 0;
  elsif new.avatar_path is not null then
    if new.avatar_path is distinct from v_expected then
      new.avatar_path := null;
      new.avatar_rev := 0;
    elsif coalesce(new.avatar_rev, 0) < 1 then
      new.avatar_rev := 1;
    end if;
  else
    new.avatar_rev := 0;
  end if;

  return new;
end;
$$;
