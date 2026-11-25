-- Audit contenus perso (tmp/audit-contenus-perso.md) n°2, 3 et 4.
--
-- n°2 — plafonds de nombre.
--   Avant : le serveur bornait la taille d'une entrée mais pas leur nombre. Un joueur
--   pouvait ajouter des centaines de prises / dilemmes / mots / thèmes / tier lists ;
--   la partie (game_sessions.state) grossissait et était renvoyée en entier à chaque
--   joueur à chaque changement.
--   Après (choix de l'utilisatrice, 2026-11-25) :
--     - prises Hot Take, dilemmes, mots Draw It, thèmes Tier Night : 10 par joueur et par jeu ;
--     - tier lists Rank Live : 3 par joueur ;
--     - 50 au total par salon et par jeu ;
--     - pas de limite de rythme.
--   Seul un NOUVEL ajout est compté : renvoyer une entrée existante (nouvel essai) passe.
--   Message lisible dans le texte de l'erreur (versions publiées : elles l'affichent
--   pour Draw It / thèmes / Rank Live) ; code dans `hint` pour la nouvelle version :
--     CUSTOM_LIMIT_PLAYER · CUSTOM_LIMIT_LOBBY.
--
-- n°3 — identifiant déjà pris par un autre joueur.
--   Avant (Hot Take, Dilemma, thèmes) : l'entrée était ajoutée en double avec le même
--   identifiant ; la suppression du vrai auteur tombait ensuite sur le doublon et
--   était refusée en entier. Après : refus (`hint` CUSTOM_ID_TAKEN), comme Rank Live
--   et Draw It ; et la suppression retire les entrées de ce joueur sans être bloquée
--   par celle d'un autre portant le même identifiant (doublons anciens éventuels).
--
-- n°4 — propriétaire reconnu par le compte, plus seulement par le pseudo.
--   Hot Take et Dilemma enregistrent maintenant `authorUid`, comme Draw It et les
--   thèmes. Règle commune aux 4 types, en ajout et en suppression :
--     à moi = même authorUid, ou (pas d'authorUid et même pseudo) — repli pour les
--     entrées écrites par une ancienne version de l'appli.
--   Les votes, eux, restent reconnus par le pseudo (comme partout dans les jeux).
--
-- Fonctions reprises telles qu'en prod le 2026-11-25 ; seuls les blocs marqués
-- « Plafonds », « n°3 » et « n°4 » changent (le calcul de v_arr / v_path est remonté
-- avant l'écriture Draw It, sans changement de comportement).
--
-- Limite connue : l'hôte de Hot Take / Dilemma écrit la partie directement (pas par
-- ces fonctions). Ses plafonds sont appliqués par l'appli (nouvelle version seulement).

create or replace function public.upsert_player_custom_entry(p_lobby_id uuid, p_game text, p_entry jsonb)
 returns game_sessions
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid;
  v_name text;
  v_game text := lower(trim(p_game));
  v_state_key text;
  v_array_key text;
  v_top_level boolean := false;
  v_row public.game_sessions;
  v_arr jsonb;
  v_entry jsonb;
  v_id text;
  v_text_a text;
  v_text_b text;
  v_path text[];
  i int;
  v_found_idx int := null;
  v_writable boolean;
  -- Plafonds
  c_max_per_player constant int := 10;
  c_max_per_lobby constant int := 50;
  v_mine int := 0;
  v_total int := 0;
  v_owned boolean;
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
  elsif v_game = 'drawit' then
    v_state_key := 'drawIt';
    v_array_key := 'customWords';
  elsif v_game = 'tiernight' then
    v_top_level := true;
    v_array_key := 'customRosterTopics';
  else
    raise exception 'Customs uniquement pour Hot Take / Dilemma / Draw it / TierNight.';
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
    -- n°4 : authorUid enregistré.
    v_entry := jsonb_build_object(
      'id', v_id,
      'text', v_text_a,
      'author', v_name,
      'authorUid', v_uid::text
    );
  elsif v_game = 'dilemma' then
    v_text_a := left(trim(coalesce(p_entry ->> 'optionA', '')), 160);
    v_text_b := left(trim(coalesce(p_entry ->> 'optionB', '')), 160);
    if length(v_text_a) < 1 or length(v_text_b) < 1 then
      raise exception 'Options du dilemme requises.';
    end if;
    -- n°4 : authorUid enregistré.
    v_entry := jsonb_build_object(
      'id', v_id,
      'optionA', v_text_a,
      'optionB', v_text_b,
      'author', v_name,
      'authorUid', v_uid::text,
      'tier', 'custom'
    );
  elsif v_game = 'drawit' then
    v_text_a := left(trim(coalesce(p_entry ->> 'text', '')), 160);
    if length(v_text_a) < 1 then
      raise exception 'Texte custom requis.';
    end if;
    -- Public : jamais le texte (Realtime identique pour tous les lecteurs).
    v_entry := jsonb_build_object(
      'id', v_id,
      'author', v_name,
      'authorUid', v_uid::text
    );
  else
    if v_id not like 'custom-roster-%' then
      v_id := 'custom-roster-' || v_id;
    end if;
    v_text_a := left(trim(coalesce(p_entry ->> 'name', '')), 80);
    if length(v_text_a) < 2 then
      raise exception 'Nom de thème requis.';
    end if;
    v_entry := jsonb_build_object(
      'id', v_id,
      'name', v_text_a,
      'author', v_name,
      'authorUid', v_uid::text,
      'custom', true
    );
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_game = 'tiernight' then
    v_writable := public.tiernight_parse_custom_roster_writable(v_row.state);
    if v_writable is not true then
      raise exception 'TNS_CUSTOM_ROSTER_CLOSED';
    end if;
  end if;

  if v_game = 'drawit' then
    if v_row.game_id is distinct from 'drawit' then
      raise exception 'DRAWIT_WRONG_GAME';
    end if;
    if coalesce((v_row.state -> 'drawIt' ->> 'lobbyStarted')::boolean, false) is true then
      raise exception 'DRAWIT_CUSTOM_LOCKED';
    end if;
  end if;

  if v_top_level then
    v_arr := coalesce(v_row.state -> v_array_key, '[]'::jsonb);
    v_path := array[v_array_key];
  else
    v_arr := coalesce(v_row.state -> v_state_key -> v_array_key, '[]'::jsonb);
    v_path := array[v_state_key, v_array_key];
  end if;
  if jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  -- Une seule lecture de la liste : propriétaire (n°4), identifiant pris (n°3),
  -- comptes pour les plafonds.
  for i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    -- n°4 : même règle pour les 4 types.
    v_owned :=
      (v_arr -> i ->> 'authorUid') = v_uid::text
      or (
        coalesce(v_arr -> i ->> 'authorUid', '') = ''
        and (v_arr -> i ->> 'author') = v_name
      );
    if (v_arr -> i ->> 'id') = v_id then
      if not v_owned then
        -- n°3 : identifiant déjà pris par un autre joueur.
        raise exception 'Cet identifiant est déjà utilisé par un autre joueur.'
          using hint = 'CUSTOM_ID_TAKEN';
      end if;
      if v_found_idx is null then
        v_found_idx := i;
      end if;
    end if;
    if v_owned then
      v_mine := v_mine + 1;
    end if;
    v_total := v_total + 1;
  end loop;

  -- Plafonds (nouvel ajout seulement)
  if v_found_idx is null then
    if v_mine >= c_max_per_player then
      raise exception 'Tu as déjà ajouté % contenus perso : supprimes-en un pour en ajouter un autre.', c_max_per_player
        using hint = 'CUSTOM_LIMIT_PLAYER';
    end if;
    if v_total >= c_max_per_lobby then
      raise exception 'Le salon a déjà % contenus perso pour ce jeu : impossible d''en ajouter.', c_max_per_lobby
        using hint = 'CUSTOM_LIMIT_LOBBY';
    end if;
  end if;

  if v_game = 'drawit' then
    insert into public.drawit_custom_words (lobby_id, entry_id, user_id, word_text)
    values (p_lobby_id, v_id, v_uid, v_text_a)
    on conflict (lobby_id, entry_id) do update
      set word_text = excluded.word_text
      where public.drawit_custom_words.user_id = excluded.user_id;
    if not exists (
      select 1 from public.drawit_custom_words w
      where w.lobby_id = p_lobby_id and w.entry_id = v_id and w.user_id = v_uid
    ) then
      raise exception 'Tu ne peux modifier que tes propres customs.';
    end if;
  end if;

  if v_found_idx is not null then
    v_arr := jsonb_set(v_arr, array[v_found_idx::text], v_entry, false);
  else
    v_arr := v_arr || jsonb_build_array(v_entry);
  end if;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        v_path,
        v_arr,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.delete_player_custom_entry(p_lobby_id uuid, p_game text, p_entry_id text)
 returns game_sessions
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid;
  v_name text;
  v_game text := lower(trim(p_game));
  v_state_key text;
  v_array_key text;
  v_top_level boolean := false;
  v_row public.game_sessions;
  v_arr jsonb;
  v_next jsonb := '[]'::jsonb;
  v_path text[];
  i int;
  v_item jsonb;
  v_owned boolean;
  v_matched_other boolean := false;
  v_removed boolean := false;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);

  select display_name into v_name
  from public.lobby_members
  where lobby_id = p_lobby_id and user_id = v_uid;

  if v_game = 'hottake' then
    v_state_key := 'hotTake';
    v_array_key := 'customTakes';
  elsif v_game = 'dilemma' then
    v_state_key := 'dilemma';
    v_array_key := 'customDilemmas';
  elsif v_game = 'drawit' then
    v_state_key := 'drawIt';
    v_array_key := 'customWords';
  elsif v_game = 'tiernight' then
    v_top_level := true;
    v_array_key := 'customRosterTopics';
  else
    raise exception 'Customs uniquement pour Hot Take / Dilemma / Draw it / TierNight.';
  end if;

  if p_entry_id is null or length(trim(p_entry_id)) < 1 then
    raise exception 'Id custom requis.';
  end if;

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if v_game = 'drawit' then
    if v_row.game_id is distinct from 'drawit' then
      raise exception 'DRAWIT_WRONG_GAME';
    end if;
    if coalesce((v_row.state -> 'drawIt' ->> 'lobbyStarted')::boolean, false) is true then
      raise exception 'DRAWIT_CUSTOM_LOCKED';
    end if;
  end if;

  if v_top_level then
    v_arr := coalesce(v_row.state -> v_array_key, '[]'::jsonb);
    v_path := array[v_array_key];
  else
    v_arr := coalesce(v_row.state -> v_state_key -> v_array_key, '[]'::jsonb);
    v_path := array[v_state_key, v_array_key];
  end if;
  if jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  for i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    v_item := v_arr -> i;
    if (v_item ->> 'id') = p_entry_id then
      -- n°4 : même règle pour les 4 types.
      v_owned :=
        (v_item ->> 'authorUid') = v_uid::text
        or (
          coalesce(v_item ->> 'authorUid', '') = ''
          and (v_item ->> 'author') is not distinct from v_name
        );
      if v_owned then
        v_removed := true;
        continue;
      end if;
      -- n°3 : l'entrée d'un autre au même identifiant reste, sans bloquer.
      v_matched_other := true;
    end if;
    v_next := v_next || jsonb_build_array(v_item);
  end loop;

  if v_matched_other and not v_removed then
    raise exception 'Tu ne peux supprimer que tes propres customs.';
  end if;

  if v_game = 'drawit' then
    delete from public.drawit_custom_words w
    where w.lobby_id = p_lobby_id
      and w.entry_id = p_entry_id
      and w.user_id = v_uid;
  end if;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        v_path,
        v_next,
        true
      )
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.upsert_player_custom_live_tier_list(p_lobby_id uuid, p_entry jsonb)
 returns game_sessions
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_uid uuid;
  v_name text;
  v_row public.game_sessions;
  v_arr jsonb;
  v_entry jsonb;
  v_id text;
  v_i int;
  v_found boolean := false;
  v_existing jsonb;
  -- Plafonds
  c_max_per_player constant int := 3;
  c_max_per_lobby constant int := 50;
  v_mine int := 0;
begin
  v_uid := public.assert_lobby_member(p_lobby_id);

  select display_name into v_name
  from public.lobby_members
  where lobby_id = p_lobby_id and user_id = v_uid;

  if v_name is null or length(trim(v_name)) < 1 then
    raise exception 'Pseudo introuvable.';
  end if;

  v_entry := public.tiernight_live_build_custom_entry(
    p_entry,
    v_name,
    v_uid::text
  );
  v_id := v_entry ->> 'id';

  select * into v_row
  from public.game_sessions
  where lobby_id = p_lobby_id
  for update;

  if not found then
    raise exception 'Session de jeu introuvable.';
  end if;

  if not public.tiernight_live_custom_pool_writable(v_row.state) then
    raise exception 'TNS_LIVE_CUSTOM_LOCKED';
  end if;

  v_arr := coalesce(v_row.state -> 'customLiveTierLists', '[]'::jsonb);
  if jsonb_typeof(v_arr) <> 'array' then
    v_arr := '[]'::jsonb;
  end if;

  for v_i in 0 .. greatest(jsonb_array_length(v_arr) - 1, -1) loop
    if (v_arr -> v_i ->> 'id') = v_id then
      v_found := true;
      v_existing := v_arr -> v_i;
      if coalesce(v_existing ->> 'authorUid', '') is distinct from v_uid::text then
        raise exception 'TNS_LIVE_CUSTOM_NOT_OWNER';
      end if;
      -- Create/delete only : même contenu = retry idempotent ; sinon refuse l''édition.
      if v_existing is not distinct from v_entry then
        return v_row;
      end if;
      raise exception 'TNS_LIVE_CUSTOM_EDIT_FORBIDDEN';
    end if;
    if coalesce(v_arr -> v_i ->> 'authorUid', '') = v_uid::text then
      v_mine := v_mine + 1;
    end if;
  end loop;

  if not v_found then
    -- Plafonds (nouvel ajout seulement)
    if v_mine >= c_max_per_player then
      raise exception 'Tu as déjà ajouté % tier lists : supprimes-en une pour en ajouter une autre.', c_max_per_player
        using hint = 'CUSTOM_LIMIT_PLAYER';
    end if;
    if jsonb_array_length(v_arr) >= c_max_per_lobby then
      raise exception 'Le salon a déjà % tier lists perso : impossible d''en ajouter.', c_max_per_lobby
        using hint = 'CUSTOM_LIMIT_LOBBY';
    end if;
    v_arr := v_arr || jsonb_build_array(v_entry);
  end if;

  update public.game_sessions gs
  set state = jsonb_set(
        coalesce(gs.state, '{}'::jsonb),
        '{customLiveTierLists}',
        v_arr,
        true
      ),
      updated_at = now()
  where gs.lobby_id = p_lobby_id
  returning * into v_row;

  return v_row;
end;
$function$;

-- create or replace garde les droits existants (authenticated, service_role) ; on les
-- réaffirme pour être sûr que anon / public ne les ont pas.
revoke all on function public.upsert_player_custom_entry(uuid, text, jsonb) from public, anon;
grant execute on function public.upsert_player_custom_entry(uuid, text, jsonb) to authenticated, service_role;
revoke all on function public.delete_player_custom_entry(uuid, text, text) from public, anon;
grant execute on function public.delete_player_custom_entry(uuid, text, text) to authenticated, service_role;
revoke all on function public.upsert_player_custom_live_tier_list(uuid, jsonb) from public, anon;
grant execute on function public.upsert_player_custom_live_tier_list(uuid, jsonb) to authenticated, service_role;
