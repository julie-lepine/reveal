-- FEATURE-DILEMMA-01 — Autoriser plusieurs dilemmes custom par joueur (alignement Hot Take)
--
-- Supprime la branche dilemma qui refusait un 2e append par auteur dans upsert_player_custom_entry.
-- Hot Take n'avait jamais cette limite ; Dilemma adopte le même contrat append + upsert par id.
--
-- Compatibilité :
--   • Nouveau client + ancienne SQL → RPC raise 'Tu as déjà soumis un dilemme custom.' (2e append)
--   • Ancien client + nouvelle SQL → 1 seul dilemme côté UI client (guard retiré après deploy client)
--
-- Ne pas modifier delete_player_custom_entry ni le reste du contrat.

create or replace function public.upsert_player_custom_entry(
  p_lobby_id uuid,
  p_game text,
  p_entry jsonb
)
returns public.game_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid;
  v_name text;
  v_game text := lower(trim(p_game));
  v_state_key text;
  v_array_key text;
  v_row public.game_sessions;
  v_arr jsonb;
  v_entry jsonb;
  v_id text;
  v_text_a text;
  v_text_b text;
  i int;
  v_found boolean := false;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);

  select display_name into v_name
  from public.lobby_members
  where lobby_id = p_lobby_id and user_id = v_uid;

  if v_name is null or length(trim(v_name)) < 1 then
    raise exception 'Pseudo introuvable.';
  end if;

  if v_game = 'hottake' then
    v_state_key := 'hotTake';
    v_array_key := 'customTakes';
  elsif v_game = 'dilemma' then
    v_state_key := 'dilemma';
    v_array_key := 'customDilemmas';
  else
    raise exception 'Customs uniquement pour Hot Take / Dilemma.';
  end if;

  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    raise exception 'Entrée custom invalide.';
  end if;

  if octet_length(p_entry::text) > 2048 then
    raise exception 'Entrée custom trop volumineuse.';
  end if;

  v_id := coalesce(nullif(trim(p_entry ->> 'id'), ''), 'custom-' || gen_random_uuid()::text);

  if v_game = 'hottake' then
    v_text_a := left(trim(coalesce(p_entry ->> 'text', '')), 160);
    if length(v_text_a) < 1 then
      raise exception 'Texte custom requis.';
    end if;
    v_entry := jsonb_build_object(
      'id', v_id,
      'text', v_text_a,
      'author', v_name
    );
  else
    v_text_a := left(trim(coalesce(p_entry ->> 'optionA', '')), 160);
    v_text_b := left(trim(coalesce(p_entry ->> 'optionB', '')), 160);
    if length(v_text_a) < 1 or length(v_text_b) < 1 then
      raise exception 'Options du dilemme requises.';
    end if;
    v_entry := jsonb_build_object(
      'id', v_id,
      'optionA', v_text_a,
      'optionB', v_text_b,
      'author', v_name,
      'tier', 'custom'
    );
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  v_arr := coalesce(v_row.state -> v_state_key -> v_array_key, '[]'::jsonb);
  if jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  -- Remplace si même id + même auteur, sinon append (plusieurs entrées par auteur autorisées — FEATURE-DILEMMA-01)
  for i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    if (v_arr -> i ->> 'id') = v_id and (v_arr -> i ->> 'author') = v_name then
      v_arr := jsonb_set(v_arr, array[i::text], v_entry, false);
      v_found := true;
      exit;
    end if;
  end loop;

  if not v_found then
    v_arr := v_arr || jsonb_build_array(v_entry);
  end if;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        array[v_state_key, v_array_key],
        v_arr,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_player_custom_entry(uuid, text, jsonb) from public;
grant execute on function public.upsert_player_custom_entry(uuid, text, jsonb) to authenticated;
