/** Id du thème qui fusionne toutes les banques */
export const SPEED_VOTE_CATALOG_ID = "catalog";

export const SPEED_VOTE_TIMER_SEC = 7;
export const SPEED_VOTE_POINTS_WINNER = 10;
export const SPEED_VOTE_ROUND_PRESETS = [3, 5, 8];
export const SPEED_VOTE_ROUND_ALL = -1;

export const SPEED_VOTE_MODIFIERS = {
  normal: { id: "normal", label: "Classique", emoji: "⚡", multiplier: 1 },
  double: { id: "double", label: "Points ×2", emoji: "🔥", multiplier: 2 },
  hidden: { id: "hidden", label: "Votes cachés", emoji: "🙈", multiplier: 1 },
};

/** Questions par thème — vote = choisir un joueur du lobby */
export const SPEED_VOTE_THEMES = [
  {
    id: SPEED_VOTE_CATALOG_ID,
    label: "🎲 Tout le catalogue",
    questions: [],
  },
  {
    id: "group",
    label: "👥 Le groupe",
    questions: [
      "Qui est le meilleur joueur du groupe ?",
      "Qui est le plus drôle ?",
      "Qui a le plus de charisme ?",
      "Qui serait le meilleur capitaine d'équipe ?",
      "Qui raconte les meilleures anecdotes ?",
      "Qui mentirait le plus facilement ?",
    ],
  },
  {
    id: "survival",
    label: "🧟 Survie",
    questions: [
      "Qui survivrait le moins longtemps en apocalypse zombie ?",
      "Dans un apocalypse zombie, qui serait le premier dévoré ?",
      "Dans un apocalypse zombie, qui trouverait la nourriture en premier ?",
      "Qui paniquerait le plus vite en se retrouvant devant un zombie ?",
      "Dans un apocalypse zombie, qui deviendrait chef du groupe par accident ?",
    ],
  },
  {
    id: "chaos",
    label: "🎉 Chaos",
    questions: [
      "Qui ferait le pire discours de mariage ?",
      "Qui finirait en prison pour une bêtise ?",
      "Qui dépenserait un million en une semaine ?",
      "Qui oublierait son propre anniversaire ?",
      "Qui arriverait toujours en retard ?",
      "Qui serait le pire colocataire ?",
    ],
  },
  {
    id: "party",
    label: "🍻 Soirée",
    questions: [
      "Qui tiendrait le moins bien sur la piste de danse ?",
      "Qui chanterait en karaoké sans honte ?",
      "Qui finirait la soirée en mode philosophe ?",
      "Qui commanderait la commande la plus bizarre ?",
    ],
  },
];

function normalizeQuestionKey(text) {
  return String(text).trim().toLowerCase();
}

export function getSpeedVoteCatalogQuestions(themes = SPEED_VOTE_THEMES) {
  const seen = new Set();
  const out = [];
  for (const theme of themes) {
    if (theme.id === SPEED_VOTE_CATALOG_ID) continue;
    for (const text of theme.questions || []) {
      const key = normalizeQuestionKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

export function getSpeedVoteThemeQuestions(themeId, themes = SPEED_VOTE_THEMES) {
  if (themeId === SPEED_VOTE_CATALOG_ID) return getSpeedVoteCatalogQuestions(themes);
  const theme =
    themes.find((t) => t.id === themeId) || themes.find((t) => t.id === "group");
  return [...(theme?.questions || [])];
}
