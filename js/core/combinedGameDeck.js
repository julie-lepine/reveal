/**
 * Mélange Fisher-Yates et construction de deck prep (customs + banque).
 * Politique : customs prioritaires sur les places disponibles, shuffle global du sous-ensemble sélectionné.
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
 * Déduplique par id (première occurrence conservée).
 * @template {{ id?: unknown }}
 * @param {T[]} entries
 * @returns {T[]}
 */
export function dedupeEntriesById(entries = []) {
  const seen = new Set();
  const out = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const id = item.id != null ? String(item.id) : null;
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(item);
  }
  return out;
}

/**
 * Prépare customs + banque : déduplication, collision id → le custom gagne.
 * @template T
 * @param {T[]} customEntries
 * @param {T[]} predefinedEntries
 * @returns {{ customs: T[], bank: T[] }}
 */
export function prepareCombinedDeckPool(customEntries, predefinedEntries) {
  const customs = dedupeEntriesById((customEntries || []).filter(Boolean));
  const customIds = new Set(
    customs.map((c) => (c.id != null ? String(c.id) : null)).filter(Boolean)
  );
  const bank = dedupeEntriesById((predefinedEntries || []).filter(Boolean)).filter((item) => {
    const id = item.id != null ? String(item.id) : null;
    return !id || !customIds.has(id);
  });
  return { customs, bank };
}

/**
 * Construit le deck joué : customs prioritaires, complément banque, shuffle global.
 *
 * Cas 0 custom → N prédéfinis aléatoires.
 * Cas C < R → tous les customs + (R−C) prédéfinis → shuffle.
 * Cas C === R → tous les customs → shuffle.
 * Cas C > R → R customs aléatoires, aucun prédéfini.
 *
 * @template T
 * @param {T[]} customEntries — déjà normalisés
 * @param {T[]} predefinedEntries
 * @param {number|null|undefined} requestedRoundCount
 * @param {(requested: number|null|undefined, poolSize: number) => number} resolveEffectiveRoundCount
 * @param {() => number} [random]
 * @returns {T[]}
 */
export function buildCombinedShuffledDeck(
  customEntries,
  predefinedEntries,
  requestedRoundCount,
  resolveEffectiveRoundCount,
  random = Math.random
) {
  const { customs, bank } = prepareCombinedDeckPool(customEntries, predefinedEntries);
  const totalAvailable = customs.length + bank.length;
  const effective = resolveEffectiveRoundCount(requestedRoundCount, totalAvailable);
  if (effective <= 0) return [];

  if (customs.length >= effective) {
    return shuffleArray(customs, random).slice(0, effective);
  }

  const missing = effective - customs.length;
  const pickedBank = shuffleArray(bank, random).slice(0, Math.min(missing, bank.length));
  return shuffleArray([...customs, ...pickedBank], random);
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

/**
 * Chemin pur buildDilemmaDeck (testable sans gameSync).
 * @param {object} opts
 */
export function buildDilemmaDeckEntries({
  customDilemmas = [],
  bankItems = [],
  roundCount = 8,
  normalizeCustom,
  resolveEffectiveRoundCount,
  random = Math.random,
}) {
  const customs = dedupeEntriesById(
    (customDilemmas || []).map(normalizeCustom).filter(Boolean)
  );
  const bank = bankItems || [];
  return buildCombinedShuffledDeck(
    customs,
    bank,
    roundCount,
    resolveEffectiveRoundCount,
    random
  );
}

/** Marqueur deck runtime — custom joueur vs banque catalogue. */
export function isDilemmaCustomDeckEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.tier === "custom" || entry.author) return true;
  const id = String(entry.id || "");
  return id.startsWith("custom-");
}
