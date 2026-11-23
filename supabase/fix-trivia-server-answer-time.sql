-- =============================================================================
-- AUDIT Trivia n°2 — bonus vitesse décidé par l'horloge de chaque téléphone
-- =============================================================================
-- Problème : submit_trivia_answer enregistrait l'heure de réponse envoyée par le
-- téléphone (p_answered_at = Date.now() côté appli). Le +5 « bonus vitesse »
-- (trivia_apply_reveal_scoring) va à la bonne réponse la plus ancienne : un
-- téléphone dont l'horloge retarde gagnait le bonus en répondant après les autres.
--
-- Correctif : le serveur note lui-même l'heure de réception, en millisecondes
-- (clock_timestamp()). Le paramètre p_answered_at est gardé (toujours exigé non
-- nul) pour ne pas casser les versions de l'appli déjà installées, mais il n'est
-- plus utilisé pour le classement. Rien à changer dans l'appli.
--
-- Modification ciblée EN PLACE (une seule ligne ; la fonction fait ~4 750
-- caractères). Signature, droits et reste du corps inchangés.
-- Rejouable : ne fait rien si la ligne a déjà été remplacée.
-- Base : version prod du 2026-11-23 (md5 du corps 5e074dc43cc6afd471333e8c1a015a59).
-- =============================================================================

do $migration$
declare
  v_def text;
  v_old text := '''answeredAt'', p_answered_at';
  v_new text := '''answeredAt'', floor(extract(epoch from clock_timestamp()) * 1000)::bigint';
  v_count int;
begin
  v_def := pg_get_functiondef(
    'public.submit_trivia_answer(uuid,uuid,integer,integer,bigint)'::regprocedure
  );

  if position(v_new in v_def) > 0 then
    raise notice 'submit_trivia_answer : déjà à jour, rien à faire.';
    return;
  end if;

  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'submit_trivia_answer : passage attendu trouvé % fois (1 attendu). Migration annulée.', v_count;
  end if;

  execute replace(v_def, v_old, v_new);
end;
$migration$;

notify pgrst, 'reload schema';
