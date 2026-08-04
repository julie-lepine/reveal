-- FEATURE-CHAT-03 — réactions éphémères roulette (contribution joueur atomique).

create or replace function public.contribute_chat_roulette_reaction(
  p_lobby_id uuid,
  p_roulette_id text,
  p_attempt_id text,
  p_reaction text
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_uid_text text;
  v_row public.game_sessions;
  v_roulette jsonb;
  v_phase text;
  v_reactions jsonb;
  v_reaction text;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);
  v_uid_text := v_uid::text;

  if coalesce(trim(p_roulette_id), '') = '' or coalesce(trim(p_attempt_id), '') = '' then
    raise exception 'Identifiants roulette requis.';
  end if;

  v_reaction := nullif(lower(trim(p_reaction)), '');
  if v_reaction is not null and v_reaction not in ('in', 'bof', 'funny', 'curious') then
    raise exception 'Réaction non autorisée.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  v_roulette := v_row.state -> 'chatRoulette';
  if v_roulette is null or jsonb_typeof(v_roulette) <> 'object' then
    raise exception 'Aucune roulette active.';
  end if;

  if (v_roulette ->> 'rouletteId') is distinct from p_roulette_id then
    raise exception 'Roulette obsolète.';
  end if;

  if (v_roulette ->> 'attemptId') is distinct from p_attempt_id then
    raise exception 'Tirage obsolète.';
  end if;

  v_phase := v_roulette ->> 'phase';
  if v_phase is distinct from 'result' then
    raise exception 'Réactions indisponibles en phase %.', v_phase;
  end if;

  v_reactions := coalesce(v_roulette -> 'reactionsByUid', '{}'::jsonb);
  if jsonb_typeof(v_reactions) <> 'object' then
    v_reactions := '{}'::jsonb;
  end if;

  if v_reaction is null then
    v_reactions := v_reactions - v_uid_text;
  else
    v_reactions := jsonb_set(v_reactions, array[v_uid_text], to_jsonb(v_reaction), true);
  end if;

  v_roulette := jsonb_set(v_roulette, '{reactionsByUid}', v_reactions, true);

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        '{chatRoulette}',
        v_roulette,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.contribute_chat_roulette_reaction(uuid, text, text, text) from public;
grant execute on function public.contribute_chat_roulette_reaction(uuid, text, text, text) to authenticated;
