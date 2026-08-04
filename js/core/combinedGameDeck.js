/**
 * Mélange Fisher-Yates et construction de deck prep (customs + banque).
 * Pool combiné → shuffle global → slice(roundCount).
 */

/**
 * @template T
 * @param {T[]} arr
 * @param {() => number} [random]
 * @returns {T[]}
 */
export function shuffleArray(arr, random = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * @template T
 * @param {T[]} customEntries
 * @param {T[]} predefinedEntries
 * @param {number|null|undefined} requestedRoundCount
 * @param {number} totalAvailable — customs.length + predefined.length (redondant mais explicite)
 * @param {(requested: number|null|undefined, poolSize: number) => number} resolveEffectiveRoundCount
 * @param {() => number} [random]
 * @returns {T[]}
 */
export function buildCombinedShuffledDeck(
  customEntries,
  predefinedEntries,
  requestedRoundCount,
  totalAvailable,
  resolveEffectiveRoundCount,
  random = Math.random
) {
  const effective = resolveEffectiveRoundCount(requestedRoundCount, totalAvailable);
  if (effective <= 0) return [];
  const pool = shuffleArray([...customEntries, ...predefinedEntries], random);
  return pool.slice(0, effective);
}

/**
 * Compte les entrées custom dont l'auteur ≠ joueur local (snapshot unique, pas d'incrément).
 * @param {unknown[]} entries
 * @param {string|null|undefined} localAuthor
 * @param {(entry: unknown) => object|null} normalize
 */
export function countOtherAuthorsCustomEntries(entries = [], localAuthor, normalize) {
  const me = localAuthor;
  const seen = new Set();
  let count = 0;
  for (const raw of entries) {
    const item = normalize(raw);
    if (!item) continue;
    const author = item.author;
    if (!author || author === me) continue;
    const id = item.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    count += 1;
  }
  return count;
}
