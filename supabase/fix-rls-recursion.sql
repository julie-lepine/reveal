-- À exécuter dans Supabase → SQL Editor (corrige "infinite recursion" sur lobby_members)

create or replace function public.is_lobby_member(p_lobby_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.lobby_members
    where lobby_id = p_lobby_id
      and user_id = auth.uid()
  );
$$;

create or replace function public.get_lobby_member_count(p_lobby_id uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.lobby_members
  where lobby_id = p_lobby_id;
$$;

grant execute on function public.is_lobby_member(uuid) to authenticated;
grant execute on function public.get_lobby_member_count(uuid) to authenticated;

drop policy if exists "members_select_same_lobby" on public.lobby_members;
create policy "members_select_same_lobby" on public.lobby_members
for select using (public.is_lobby_member(lobby_id));

-- L'hôte doit voir son lobby avant d'être dans lobby_members (insert + .select())
drop policy if exists "lobbies_select_host" on public.lobbies;
create policy "lobbies_select_host" on public.lobbies
for select using (auth.uid() = host_id);

drop policy if exists "lobbies_select_member" on public.lobbies;
create policy "lobbies_select_member" on public.lobbies
for select using (public.is_lobby_member(id));

drop policy if exists "messages_select_same_lobby" on public.lobby_messages;
create policy "messages_select_same_lobby" on public.lobby_messages
for select using (public.is_lobby_member(lobby_id));

drop policy if exists "messages_insert_member" on public.lobby_messages;
create policy "messages_insert_member" on public.lobby_messages
for insert with check (
  auth.uid() = user_id
  and public.is_lobby_member(lobby_id)
);
