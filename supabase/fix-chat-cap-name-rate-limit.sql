-- Audit chat et sondages n°1, 2 et 3 (2026-11-24) — chat du salon.
--
-- n°1 : l'appli charge les 100 PREMIERS messages du salon ; au 101e le chat se
--       figeait. La base ne garde plus que les 50 derniers messages par salon :
--       les versions déjà publiées reçoivent donc toujours les plus récents.
-- n°2 : le nom affiché était envoyé par l'appli de l'envoyeur (imitation
--       possible). La base le remplace par le pseudo du joueur dans le salon.
-- n°3 : au plus 5 messages en 10 secondes par joueur et par salon
--       (erreur « chat_rate_limited », traduite dans l'appli).

create or replace function public.lobby_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
  v_recent int;
begin
  -- chat-guard-v1
  select m.display_name
  into v_name
  from public.lobby_members m
  where m.lobby_id = new.lobby_id
    and m.user_id = new.user_id;

  if v_name is not null and length(trim(v_name)) > 0 then
    new.display_name := v_name;
  end if;

  select count(*)
  into v_recent
  from public.lobby_messages lm
  where lm.lobby_id = new.lobby_id
    and lm.user_id = new.user_id
    and lm.created_at > now() - interval '10 seconds';

  if v_recent >= 5 then
    raise exception 'chat_rate_limited' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.lobby_messages_keep_latest()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- chat-cap-v1 : 50 derniers messages par salon
  delete from public.lobby_messages lm
  where lm.lobby_id = new.lobby_id
    and lm.id not in (
      select k.id
      from public.lobby_messages k
      where k.lobby_id = new.lobby_id
      order by k.created_at desc, k.id desc
      limit 50
    );
  return null;
end;
$$;

revoke all on function public.lobby_messages_before_insert() from public, anon, authenticated;
revoke all on function public.lobby_messages_keep_latest() from public, anon, authenticated;

drop trigger if exists lobby_messages_guard on public.lobby_messages;
create trigger lobby_messages_guard
before insert on public.lobby_messages
for each row execute function public.lobby_messages_before_insert();

drop trigger if exists lobby_messages_keep_latest on public.lobby_messages;
create trigger lobby_messages_keep_latest
after insert on public.lobby_messages
for each row execute function public.lobby_messages_keep_latest();

-- Rattrapage unique : salons qui ont déjà plus de 50 messages (aucun au 2026-11-24).
delete from public.lobby_messages lm
where lm.id in (
  select r.id
  from (
    select x.id,
           row_number() over (partition by x.lobby_id order by x.created_at desc, x.id desc) as rn
    from public.lobby_messages x
  ) r
  where r.rn > 50
);
