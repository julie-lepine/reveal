-- =============================================================================
-- FIX-EVENING-SCORES-DECIMAL-01
--
-- Symptôme : 400 « invalid input syntax for type integer: "235.4" » (22P02) en
-- fin de Spot the fake / Draw it, dès qu'une partie de Consensus a eu lieu dans
-- la soirée.
--
-- Cause : Consensus attribue des points au dixième (ex. 121.3). Le cumul de
-- soirée (`state.scores`) devient décimal. `traitre_add_score_deltas` et
-- `drawit_add_score_deltas` relisaient ce cumul avec `::int`, ce qui échoue sur
-- « 235.4 » : les points de la partie n'étaient pas ajoutés et la fin de partie
-- échouait côté serveur.
--
-- Correctif : lecture en `numeric` (cumul et points ajoutés). Sans effet sur les
-- valeurs entières (to_jsonb(25::numeric) = 25) ; un cumul décimal reste décimal
-- (235.4 + 10 = 245.4). Signatures, volatilité, search_path et droits inchangés.
--
-- Idempotent (create or replace). À exécuter dans l'éditeur SQL Supabase.
--
-- Avant d'appliquer : comparer la version en ligne avec les fichiers d'origine
-- (les deux doivent contenir « ::int » sur la lecture du cumul) :
--   select pg_get_functiondef('public.traitre_add_score_deltas(jsonb,jsonb)'::regprocedure);
--   select pg_get_functiondef('public.drawit_add_score_deltas(jsonb,jsonb)'::regprocedure);
-- Vérification : voir le bloc en fin de fichier.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Spot the fake (feature-traitre-01-advance-play.sql)
-- -----------------------------------------------------------------------------
create or replace function public.traitre_add_score_deltas(p_scores jsonb, p_deltas jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_scores jsonb := coalesce(p_scores, '{}'::jsonb);
  v_entry record;
  v_current numeric;
  v_delta numeric;
begin
  if jsonb_typeof(v_scores) <> 'object' then
    v_scores := '{}'::jsonb;
  end if;
  for v_entry in select key, value from jsonb_each(coalesce(p_deltas, '{}'::jsonb))
  loop
    v_current := coalesce((v_scores ->> v_entry.key)::numeric, 0);
    v_delta := coalesce((v_entry.value #>> '{}')::numeric, 0);
    if v_delta > 0 then
      v_scores := jsonb_set(
        v_scores,
        array[v_entry.key],
        to_jsonb(v_current + v_delta),
        true
      );
    end if;
  end loop;
  return v_scores;
end;
$$;

revoke all on function public.traitre_add_score_deltas(jsonb, jsonb) from public;
revoke all on function public.traitre_add_score_deltas(jsonb, jsonb) from anon;
revoke all on function public.traitre_add_score_deltas(jsonb, jsonb) from authenticated;

-- -----------------------------------------------------------------------------
-- Draw it (feature-drawit-02-private-word.sql)
-- -----------------------------------------------------------------------------
create or replace function public.drawit_add_score_deltas(
  p_scores jsonb,
  p_deltas jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_scores jsonb := coalesce(p_scores, '{}'::jsonb);
  v_entry record;
  v_current numeric;
  v_delta numeric;
begin
  if jsonb_typeof(v_scores) <> 'object' then
    v_scores := '{}'::jsonb;
  end if;
  for v_entry in select key, value from jsonb_each(coalesce(p_deltas, '{}'::jsonb))
  loop
    v_current := coalesce((v_scores->>v_entry.key)::numeric, 0);
    v_delta := coalesce((v_entry.value #>> '{}')::numeric, 0);
    v_scores := jsonb_set(
      v_scores,
      array[v_entry.key],
      to_jsonb(v_current + greatest(v_delta, 0)),
      true
    );
  end loop;
  return v_scores;
end;
$$;

revoke all on function public.drawit_add_score_deltas(jsonb, jsonb) from public;

-- =============================================================================
-- Vérification (à lancer après, en tant que postgres dans l'éditeur SQL)
-- =============================================================================
-- 1) Cumul décimal (cas du bug) : attendu {"Julie": 245.4, "Alex": 15}
-- select public.traitre_add_score_deltas('{"Julie": 235.4, "Alex": 5}'::jsonb, '{"Julie": 10, "Alex": 10}'::jsonb);
-- select public.drawit_add_score_deltas('{"Julie": 235.4, "Alex": 5}'::jsonb, '{"Julie": 10, "Alex": 10}'::jsonb);
--
-- 2) Entiers inchangés : attendu {"a": 25}
-- select public.traitre_add_score_deltas('{"a": 15}'::jsonb, '{"a": 10}'::jsonb);
-- select public.drawit_add_score_deltas('{"a": 15}'::jsonb, '{"a": 10}'::jsonb);
--
-- 3) Règles conservées : delta négatif ignoré (traitre) / borné à 0 (drawit)
--    attendu traitre {"a": 15} ; drawit {"a": 15}
-- select public.traitre_add_score_deltas('{"a": 15}'::jsonb, '{"a": -5}'::jsonb);
-- select public.drawit_add_score_deltas('{"a": 15}'::jsonb, '{"a": -5}'::jsonb);
