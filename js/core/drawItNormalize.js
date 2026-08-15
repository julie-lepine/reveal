/**
 * Normalisation Draw it ! — identique côté client et miroir SQL
 * `public.normalize_drawit_guess` (feature-drawit-03-guesses.sql).
 *
 * Pas de fuzzy / Levenshtein / synonymes.
 */
const APOSTROPHES = /[''`´‘’]/g;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_ALNUM = /[^a-z0-9]+/g;

export function normalizeDrawItGuess(raw) {
  return String(raw ?? "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(APOSTROPHES, "")
    .toLowerCase()
    .replace(NON_ALNUM, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function collectDrawItAcceptedAnswers(wordLabel, acceptedAnswers = []) {
  const out = [];
  const seen = new Set();
  const push = (value) => {
    const raw = value != null ? String(value) : "";
    if (!raw) return;
    const key = normalizeDrawItGuess(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(raw);
  };
  if (Array.isArray(acceptedAnswers)) {
    for (const item of acceptedAnswers) push(item);
  }
  push(wordLabel);
  return out;
}

export function drawItGuessMatches(value, acceptedAnswers = []) {
  const norm = normalizeDrawItGuess(value);
  if (!norm) return false;
  return acceptedAnswers.some((item) => normalizeDrawItGuess(item) === norm);
}
