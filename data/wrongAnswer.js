// WRONG ANSWER ONLY ↩️ - chaque manche affiche une question, chacun écrit SECRÈTEMENT
// la pire réponse possible. Les réponses sont anonymisées, puis tout le monde vote pour
// la pire. Score : 3 points par vote reçu sur sa réponse.

export const WRONG_ANSWER_ROUND_PRESETS = [3, 5, 8];

/** Points attribués à un auteur par vote reçu sur sa réponse. */
export const WRONG_ANSWER_POINTS_PER_VOTE = 3;

/** Longueur maximale d'une réponse saisie. */
export const WRONG_ANSWER_MAX_LEN = 80;

/** Délai max avant abandon d'un patch Supabase (révélation, etc.). */
export const WRONG_ANSWER_SYNC_PATCH_TIMEOUT_MS = 20000;

/** Réponses « bidon » jouées par les NPC en mode solo. */
export const WRONG_ANSWER_NPC_ANSWERS = [
  "Une chaussette mouillée",
  "Du gravier",
  "Lundi matin",
  "Un parpaing",
  "La 5G",
  "Un cactus dans le dos",
  "Du lait périmé",
  "Mon ex",
  "Une moustache",
  "Le bruit de la craie",
  "Un radiateur en panne",
  "Des frites froides",
  "Un PDF de 400 pages",
  "Le wifi de la SNCF",
  "Une guêpe énervée",
  "Du sable partout",
];

export const WRONG_ANSWER_PROMPTS = [
  { id: 1, prompt: "Quel est le meilleur animal de compagnie ?", category: "Random" },
  { id: 2, prompt: "Quel est le cadeau d'anniversaire idéal ?", category: "Random" },
  { id: 3, prompt: "Quel est le meilleur endroit pour un premier rendez-vous ?", category: "Romance" },
  { id: 4, prompt: "Quel est le super-pouvoir le plus utile ?", category: "Random" },
  { id: 5, prompt: "Que mettre absolument dans une valise de vacances ?", category: "Voyage" },
  { id: 6, prompt: "Quel est le meilleur prénom pour un enfant ?", category: "Random" },
  { id: 7, prompt: "Quel est le plat parfait pour impressionner quelqu'un ?", category: "Food" },
  { id: 8, prompt: "Quelle est la meilleure excuse pour annuler une soirée ?", category: "Social" },
  { id: 9, prompt: "Quel est le meilleur métier du monde ?", category: "Random" },
  { id: 10, prompt: "Comment bien commencer sa journée ?", category: "Lifestyle" },
  { id: 11, prompt: "Quel est le meilleur film à regarder en couple ?", category: "Culture pop" },
  { id: 12, prompt: "Quelle est la qualité la plus importante chez un ami ?", category: "Social" },
  { id: 13, prompt: "Quel est le meilleur conseil à donner à un nouveau-né ?", category: "Random" },
  { id: 14, prompt: "Que faire en cas de zombie apocalypse ?", category: "Chaos" },
  { id: 15, prompt: "Quel est le meilleur déguisement pour Halloween ?", category: "Party" },
  { id: 16, prompt: "Comment séduire son crush en une phrase ?", category: "Romance" },
  { id: 17, prompt: "Quel est le secret d'une longue relation ?", category: "Romance" },
  { id: 18, prompt: "Quelle est la boisson parfaite pour un lendemain de fête ?", category: "Party" },
  { id: 19, prompt: "Que dire pour rassurer quelqu'un de stressé ?", category: "Psychologie" },
  { id: 20, prompt: "Quel est le meilleur nom pour un groupe de musique ?", category: "Musique" },
  { id: 21, prompt: "Quel est le passe-temps le plus relaxant ?", category: "Lifestyle" },
  { id: 22, prompt: "Comment se faire des amis rapidement ?", category: "Social" },
  { id: 23, prompt: "Quel est l'ingrédient secret d'une bonne pizza ?", category: "Food" },
  { id: 24, prompt: "Quel objet emporter sur une île déserte ?", category: "Voyage" },
  { id: 25, prompt: "Quelle est la meilleure façon de gérer son argent ?", category: "Argent" },
  { id: 26, prompt: "Comment impressionner ses beaux-parents ?", category: "Social" },
  { id: 27, prompt: "Quel est le meilleur moyen de transport ?", category: "Voyage" },
  { id: 28, prompt: "Que faire quand on s'ennuie un dimanche ?", category: "Lifestyle" },
  { id: 29, prompt: "Quel est le meilleur surnom pour son ou sa partenaire ?", category: "Romance" },
  { id: 30, prompt: "Comment bien dormir la nuit ?", category: "Lifestyle" },
  { id: 31, prompt: "Quel est le meilleur cadeau pour la fête des mères ?", category: "Random" },
  { id: 32, prompt: "Quelle est la règle d'or en colocation ?", category: "Lifestyle" },
  { id: 33, prompt: "Comment réussir un entretien d'embauche ?", category: "Argent" },
  { id: 34, prompt: "Quel est le dessert parfait ?", category: "Food" },
  { id: 35, prompt: "Que faire pour rester en forme ?", category: "Lifestyle" },
  { id: 36, prompt: "Quel est le meilleur thème pour une fête d'anniversaire ?", category: "Party" },
  { id: 37, prompt: "Comment calmer un enfant qui pleure ?", category: "Psychologie" },
  { id: 38, prompt: "Quelle est la meilleure activité à faire sous la pluie ?", category: "Lifestyle" },
  { id: 39, prompt: "Quel est le meilleur slogan pour vendre une voiture ?", category: "Random" },
  { id: 40, prompt: "Comment se réconcilier après une dispute ?", category: "Romance" },
  { id: 41, prompt: "Quel est le meilleur animal pour garder une maison ?", category: "Random" },
  { id: 42, prompt: "Que dire dans un discours de mariage ?", category: "Social" },
  { id: 43, prompt: "Quel est le petit-déjeuner idéal ?", category: "Food" },
  { id: 44, prompt: "Comment occuper un long trajet en voiture ?", category: "Voyage" },
  { id: 45, prompt: "Quelle est la meilleure résolution de nouvelle année ?", category: "Lifestyle" },
  { id: 46, prompt: "Quel est le meilleur moyen de se vider la tête ?", category: "Psychologie" },
  { id: 47, prompt: "Comment décorer son salon avec style ?", category: "Lifestyle" },
  { id: 48, prompt: "Quel est le meilleur cadeau à offrir à son patron ?", category: "Argent" },
];

function shuffleWithRandom(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Mélange la banque et garde `count` prompts. Échoue si la banque est trop petite. */
export function prepareWrongAnswerDeck(count, bank = WRONG_ANSWER_PROMPTS, random = Math.random) {
  const pool = bank.filter(Boolean);
  if (pool.length < count) {
    return { ok: false, requested: count, poolSize: pool.length, missing: count - pool.length, deck: [] };
  }
  return {
    ok: true,
    requested: count,
    poolSize: pool.length,
    missing: 0,
    deck: shuffleWithRandom(pool, random).slice(0, count),
  };
}

/** Réponse NPC pseudo-aléatoire pour le mode solo. */
export function pickWrongAnswerNpcAnswer(seed = 0) {
  const idx = Math.abs(Math.floor(seed)) % WRONG_ANSWER_NPC_ANSWERS.length;
  return WRONG_ANSWER_NPC_ANSWERS[idx];
}
