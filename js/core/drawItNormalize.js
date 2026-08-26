/**
 * Normalisation Draw it ! — identique côté client et miroir SQL
 * `public.normalize_drawit_guess` (feature-drawit-03-guesses.sql,
 * articles : feature-drawit-16-guess-articles.sql).
 *
 * Pas de fuzzy / Levenshtein / synonymes.
 * Articles FR en tête (tokens entiers) : le la les l un une des du.
 */
const APOSTROPHES = /[''`´‘’]/g;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_ALNUM = /[^a-z0-9]+/g;
const LEADING_ARTICLES = new Set(["le", "la", "les", "l", "un", "une", "des", "du"]);

function stripLeadingArticles(normalized) {
  const tokens = String(normalized || "")
    .split(" ")
    .filter(Boolean);
  while (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0])) {
    tokens.shift();
  }
  return tokens.join(" ");
}

export function normalizeDrawItGuess(raw) {
  const base = String(raw ?? "")
    .replace(/œ/gi, "oe")
    .replace(/æ/gi, "ae")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(APOSTROPHES, "")
    .toLowerCase()
    .replace(NON_ALNUM, " ")
    .trim()
    .replace(/\s+/g, " ");
  return stripLeadingArticles(base);
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
