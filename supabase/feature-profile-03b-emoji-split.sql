-- FEATURE-PROFILE-03b — emojis déplacés de gratuit vers Signature
--
-- Lots extra : 😈👻🔥🐸💎🌈 + 😎💜🌟🎯🚀🎈
-- Trigger : coller 03c (03c-persist-v4).

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
