-- =============================================================================
-- AUDIT « hôte qui quitte » n°2 — Le Traître : départ forcé après la distribution
-- =============================================================================
-- Problème : advance_traitre_play('deal_to_speak') exige que TOUS les joueurs
-- vivants aient confirmé leur mot (TRAITRE_WAITING_ACKS). Si un joueur (souvent
-- l'hôte) quitte avant de confirmer, la partie reste bloquée sur la distribution,
-- même quand l'hôte remplaçant est désigné : aucune option pour passer outre.
--
-- Correctif : avec p_force = true (bouton « Commencer sans attendre » de l'hôte ou
-- du remplaçant), le départ est accepté dès qu'au moins un joueur a confirmé.
-- Sans p_force, rien ne change. Les autres actions ne changent pas (p_force ne
-- sert déjà qu'au vote).
--
-- Méthode : modification ciblée de la fonction EN PLACE (elle fait ~25 000
-- caractères ; la recopier risquerait une erreur). Le script relit la définition
-- en production, vérifie que le passage visé existe une seule fois, le remplace,
-- puis réexécute la définition (CREATE OR REPLACE : droits conservés).
-- Rejouable : si le passage a déjà été remplacé, le script ne fait rien.
--
-- Miroir JS : js/core/traitreAdvance.js (resolveTraitreAdvance, dealAcksAny).
-- =============================================================================

do $migration$
declare
  v_def text;
  v_old text := E'    if v_waiting then\r\n      raise exception ''TRAITRE_WAITING_ACKS'';\r\n    end if;';
  v_new text := E'    -- Départ forcé (hôte / remplaçant) : au moins un joueur a confirmé.\r\n'
    || E'    if v_waiting\r\n'
    || E'       and not (\r\n'
    || E'         coalesce(p_force, false)\r\n'
    || E'         and exists (\r\n'
    || E'           select 1\r\n'
    || E'           from jsonb_each(coalesce(v_tr->''dealAcks'', ''{}''::jsonb)) as e(key, value)\r\n'
    || E'           where e.value = ''true''::jsonb\r\n'
    || E'         )\r\n'
    || E'       )\r\n'
    || E'    then\r\n'
    || E'      raise exception ''TRAITRE_WAITING_ACKS'';\r\n'
    || E'    end if;';
  v_count int;
begin
  v_def := pg_get_functiondef(
    'public.advance_traitre_play(uuid,uuid,text,text,integer,text,integer,boolean)'::regprocedure
  );

  if position('Départ forcé (hôte / remplaçant)' in v_def) > 0 then
    raise notice 'advance_traitre_play : départ forcé déjà présent, rien à faire.';
    return;
  end if;

  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'advance_traitre_play : passage attendu trouvé % fois (1 attendu). Migration annulée.', v_count;
  end if;

  execute replace(v_def, v_old, v_new);
end;
$migration$;
