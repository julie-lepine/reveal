-- =============================================================================
-- AUDIT Draw It n°1 — fin de manche au chrono sans l'hôte
-- =============================================================================
-- Problème : quand le temps est écoulé, seul l'hôte (ou son remplaçant) pouvait
-- terminer la manche. Écran de l'hôte éteint → tout le monde bloqué sur 00:00,
-- propositions refusées, jusqu'à 2 min (désignation d'un remplaçant).
--
-- Correctif : un joueur de la partie (membre du salon ET dans drawerOrder) peut
-- aussi terminer la manche, mais SEULEMENT une fois le temps écoulé (heure
-- serveur). L'hôte et le remplaçant gardent la fin anticipée « tout le monde a
-- trouvé ». Un second appel (manche déjà révélée) renvoie la ligne sans rien faire.
--
-- Remplace toute la fonction. Base : version prod du 2026-11-20
-- (feature-drawit-15-custom-drawer-slots.sql). Rejouable.
-- Miroir JS : js/core/drawItRound.js (canCommitDrawItReveal, option memberOnly).
-- =============================================================================

create or replace function public.reveal_drawit_round(p_lobby_id uuid)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.game_sessions;
  v_di jsonb;
  v_phase text;
  v_ends timestamptz;
  v_run text;
  v_idx int;
  v_word text;
  v_player_only boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentification requise.';
  end if;
  if not (public.is_lobby_host(p_lobby_id) or public.is_acting_host(p_lobby_id)) then
    -- Joueur de la partie : seulement après le chrono (vérifié plus bas).
    perform public.assert_lobby_member(p_lobby_id);
    v_player_only := true;
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_row.game_id is distinct from 'drawit' then
    raise exception 'DRAWIT_WRONG_GAME';
  end if;

  v_di := coalesce(v_row.state->'drawIt', '{}'::jsonb);
  if jsonb_typeof(v_di) <> 'object'
     or coalesce((v_di->>'lobbyStarted')::boolean, false) is not true
  then
    raise exception 'DRAWIT_NO_SESSION';
  end if;
  v_phase := coalesce(v_di->>'phase', '');

  if v_phase = 'reveal' then
    return v_row;
  end if;

  if v_phase <> 'drawing' then
    raise exception 'Reveal Draw it ! uniquement depuis drawing.';
  end if;

  v_ends := (v_di->>'roundEndsAt')::timestamptz;

  if v_player_only then
    if jsonb_typeof(coalesce(v_di->'drawerOrder', 'null'::jsonb)) <> 'array'
       or not exists (
         select 1
         from jsonb_array_elements_text(v_di->'drawerOrder') as d(uid)
         where d.uid = v_uid::text
       )
    then
      raise exception 'DRAWIT_NOT_IN_PARTY';
    end if;
    if v_ends is null or clock_timestamp() < v_ends then
      raise exception 'Reveal Draw it ! trop tôt.';
    end if;
  elsif
    (v_ends is null or clock_timestamp() < v_ends)
    and not public.drawit_all_guessers_found(v_di)
  then
    raise exception 'Reveal Draw it ! trop tôt.';
  end if;

  v_run := v_di->>'runId';
  v_idx := coalesce((v_di->>'roundIdx')::int, 0);

  select word_label into v_word
  from public.drawit_private
  where lobby_id = p_lobby_id
    and run_id = v_run
    and round_idx = v_idx;

  if v_word is null then
    raise exception 'DRAWIT_NO_WORD';
  end if;

  v_di := public.drawit_revealed_state(v_di, v_word);

  update public.game_sessions
  set state = jsonb_set(
        coalesce(state, '{}'::jsonb),
        '{drawIt}',
        v_di,
        true
      )
  where lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.reveal_drawit_round(uuid) from public;
revoke all on function public.reveal_drawit_round(uuid) from anon;
grant execute on function public.reveal_drawit_round(uuid) to authenticated;

notify pgrst, 'reload schema';
