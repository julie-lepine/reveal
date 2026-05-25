import { EVENING_POINTS } from "./eveningScoring.js";

export const TRIVIA_RANDOM_THEME_ID = "random";
export const TRIVIA_TIMER_SEC = 15;
export const TRIVIA_QUESTION_COUNT_PRESETS = [5, 10, 15, 20];
export const TRIVIA_POINTS_CORRECT = EVENING_POINTS.WIN;
export const TRIVIA_POINTS_FASTEST = EVENING_POINTS.WIN;
export const TRIVIA_LOBBY_PODIUM_POINTS = [50, 25, 10];

export const TRIVIA_THEMES = [
  { id: "cinema", label: "Cinéma" },
  { id: "music", label: "Musique" },
  { id: "geography", label: "Géographie" },
  { id: "sport", label: "Sport" },
  { id: "videogames", label: "Jeux vidéo" },
  { id: "series", label: "Séries" },
  { id: "food", label: "Food" },
  { id: "general", label: "Culture Générale" },
  { id: "memes", label: "Internet / Mèmes" },
  { id: "hottakes", label: "Hot Takes" },
  { id: TRIVIA_RANDOM_THEME_ID, label: "Aléatoire" },
];

export const TRIVIA_QUESTIONS = [
  {
    id: "cinema-001",
    theme: "cinema",
    question: "Quel film a remporté l'Oscar du meilleur film en 1998 ?",
    answers: ["Titanic", "Gladiator", "Forrest Gump", "Braveheart"],
    correct: 0,
    difficulty: "medium",
  },
  {
    id: "music-001",
    theme: "music",
    question: "Quel groupe a sorti l'album 'A Night at the Opera' ?",
    answers: ["ABBA", "Queen", "Coldplay", "U2"],
    correct: 1,
    difficulty: "medium",
  },
  {
    id: "geography-001",
    theme: "geography",
    question: "Quelle est la capitale du Canada ?",
    answers: ["Toronto", "Vancouver", "Ottawa", "Montreal"],
    correct: 2,
    difficulty: "easy",
  },
  {
    id: "sport-001",
    theme: "sport",
    question: "Dans quel sport remporte-t-on la Coupe Stanley ?",
    answers: ["Basketball", "Baseball", "Rugby", "Hockey sur glace"],
    correct: 3,
    difficulty: "medium",
  },
  {
    id: "videogames-001",
    theme: "videogames",
    question: "Quel studio a cree la saga 'The Legend of Zelda' ?",
    answers: ["Capcom", "Sega", "Nintendo", "Square Enix"],
    correct: 2,
    difficulty: "easy",
  },
  {
    id: "series-001",
    theme: "series",
    question: "Dans 'Breaking Bad', quel est le surnom de Walter White ?",
    answers: ["Heisenberg", "Saul Good", "El Camino", "Blue Sky"],
    correct: 0,
    difficulty: "easy",
  },
  {
    id: "food-001",
    theme: "food",
    question: "Quel fromage est traditionnellement utilise dans une salade grecque ?",
    answers: ["Feta", "Mozzarella", "Cheddar", "Comte"],
    correct: 0,
    difficulty: "easy",
  },
  {
    id: "general-001",
    theme: "general",
    question: "Combien de continents compte la Terre ?",
    answers: ["5", "6", "7", "8"],
    correct: 2,
    difficulty: "easy",
  },
  {
    id: "memes-001",
    theme: "memes",
    question: "Quel mot est souvent associe au meme du chien Shiba Inu ?",
    answers: ["Bruh", "Doge", "Sus", "Ratio"],
    correct: 1,
    difficulty: "easy",
  },
  {
    id: "hottakes-001",
    theme: "hottakes",
    question: "Lequel de ces hot takes est generalement vu comme le plus provocant ?",
    answers: [
      "Les frites sont meilleures sans sauce",
      "Le petit-dej est le meilleur repas",
      "Les ananas sur pizza, c'est elite",
      "Dormir tot fait du bien",
    ],
    correct: 2,
    difficulty: "medium",
  },
];

function normalizeTriviaId(question) {
  const raw = question?.id || `${question?.theme || ""}:${question?.question || ""}`;
  return String(raw).trim().toLowerCase();
}

export function getTriviaThemeLabel(themeId) {
  return TRIVIA_THEMES.find((theme) => theme.id === themeId)?.label || "Trivia";
}

export function getTriviaQuestionPool(themeId, bank = TRIVIA_QUESTIONS) {
  const source =
    themeId === TRIVIA_RANDOM_THEME_ID
      ? bank
      : bank.filter((question) => question.theme === themeId);

  const seen = new Set();
  const unique = [];
  source.forEach((question) => {
    const key = normalizeTriviaId(question);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(question);
  });
  return unique;
}

function shuffleWithRandom(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function shuffleQuestionAnswers(question, random = Math.random) {
  const answers = (question.answers || []).map((text, idx) => ({
    text,
    isCorrect: idx === question.correct,
  }));
  const shuffled = shuffleWithRandom(answers, random);
  return {
    ...question,
    answers: shuffled.map((answer) => answer.text),
    correct: shuffled.findIndex((answer) => answer.isCorrect),
  };
}

export function prepareTriviaDeck(themeId, questionCount, bank = TRIVIA_QUESTIONS, random = Math.random) {
  const pool = getTriviaQuestionPool(themeId, bank);
  if (pool.length < questionCount) {
    return {
      ok: false,
      themeId,
      themeLabel: getTriviaThemeLabel(themeId),
      requested: questionCount,
      poolSize: pool.length,
      missing: Math.max(0, questionCount - pool.length),
      deck: [],
    };
  }

  const deck = shuffleWithRandom(pool, random)
    .slice(0, questionCount)
    .map((question) => shuffleQuestionAnswers(question, random));

  return {
    ok: true,
    themeId,
    themeLabel: getTriviaThemeLabel(themeId),
    requested: questionCount,
    poolSize: pool.length,
    missing: 0,
    deck,
  };
}
