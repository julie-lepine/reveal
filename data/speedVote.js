import { EVENING_POINTS } from "./eveningScoring.js";

/** Id du thème qui fusionne toutes les banques */
export const SPEED_VOTE_CATALOG_ID = "catalog";

export const SPEED_VOTE_TIMER_SEC = 7;

export const SPEED_VOTE_POINTS_WINNER = EVENING_POINTS.WIN;
export const SPEED_VOTE_ROUND_PRESETS = [3, 5, 8];
export const SPEED_VOTE_ROUND_ALL = -1;

export const SPEED_VOTE_MODIFIERS = {
  normal: { id: "normal", label: "Classique", emoji: "⚡", multiplier: 1 },
  double: { id: "double", label: "Points ×2", emoji: "🔥", multiplier: 2 },
  hidden: { id: "hidden", label: "Votes cachés", emoji: "🙈", multiplier: 1 },
};

/** Questions par thème - vote = choisir un joueur du lobby */
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
      "Qui est le plus mauvais joueur du groupe ?",
      "Qui est le plus drôle ?",
      "Qui a le plus de charisme ?",
      "Qui serait le meilleur capitaine d'équipe ?",
      "Qui raconte les meilleures anecdotes ?",
      "Qui mentirait le plus facilement ?",
      "Qui serait le plus populaire dans une autre vie ?",
      "Qui a le plus gros ego (sans l’assumer) ?",
      "Qui est le plus susceptible ?",
      "Qui ferait le meilleur influenceur ?",
      "Qui est le plus susceptible de trahir le groupe pour un kebab ?",
      "Qui serait le plus riche si la vie était un jeu vidéo ?",
      "Qui serait le plus susceptible de devenir célèbre ?",
      "Qui ferait le meilleur espion ?",
      "Qui survivrait le moins bien à un voyage solo à l’étranger ?",
      "Qui est le plus manipulateur (gentiment) ?",
      "Qui serait le pire menteur dans une enquête policière ?",
      "Qui aurait le plus de chances de devenir patron d’une startup ?",
      "Qui est le plus imprévisible ?",
      "Qui ferait le meilleur présentateur TV ?",
      "Qui est le plus susceptible de répondre « j’arrive » alors qu’il n’est pas prêt ?",
      "Qui serait le plus apprécié par des inconnus en 5 minutes ?",
      "Qui serait élu maire du groupe sans même faire campagne ?",
      "Qui donne les meilleurs conseils mais ne les suit jamais ?",
      "Qui serait le plus dramatique pour une petite contrariété ?",
      "Qui garderait le mieux un secret ?",
      "Qui serait le pire pour garder une surprise ?",
      "Qui répond le plus lentement aux messages ?",
      "Qui a toujours une opinion sur absolument tout ?",
    ],
  },
  {
    id: "survival",
    label: "🧟 Survie",
    questions: [
      "Qui survivrait le moins longtemps en apocalypse zombie ?",
      "Dans un apocalypse zombie, qui serait le premier dévoré ?",
      "Dans un apocalypse zombie, qui trouverait de la nourriture en premier ?",
      "Qui paniquerait le plus vite en se retrouvant devant un zombie ?",
      "Dans un apocalypse zombie, qui deviendrait chef du groupe par accident ?",
      "Qui mourrait en essayant de faire le héros ?",
      "Qui deviendrait rapidement un boulet pour le groupe ?",
      "Qui survivrait seul le plus longtemps ?",
      "Qui ferait confiance au mauvais survivant ?",
      "Qui mourrait en premier en essayant de « faire simple » ?",
      "Qui ferait confiance au premier inconnu suspect ?",
      "Qui paniquerait même dans un tutoriel de survie ?",
      "Qui survivrait le mieux uniquement par chance ?",
      "Qui deviendrait un personnage secondaire dès le début ?",
      "Qui oublierait un objet vital dans une fuite ?",
      "Qui survivrait mais deviendrait complètement paranoïaque ?",
      "Qui sacrifierait le groupe pour sauver un gâteau ?",
      "Qui serait le plus inutile mais optimiste ?",
      "Qui survivrait juste parce que « la chance est de son côté » ?",
      "Qui rationnerait mal la nourriture dès le premier jour ?",
      "Qui construirait l'abri le plus inutile ?",
      "Qui deviendrait le médecin improvisé du groupe ?",
      "Qui ferait du bruit au pire moment possible ?",
      "Qui garderait son téléphone « au cas où » alors qu'il n'y a plus de réseau ?",
      "Qui serait utile pour le moral mais inutile pour tout le reste ?",
      "Qui ferait confiance à un plan manifestement foireux ?",
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
      "Qui ferait une crise pour rien dans un lieu public ?",
      "Qui accepterait un défi totalement débile ?",
      "Qui ruinerait une situation sérieuse en 10 secondes ?",
      "Qui fait le plus de choix catastrophiques par semaine ?",
      "Qui survit le moins bien à la vie adulte ?",
      "Qui est le plus susceptible de se faire avoir par un scam ?",
      "Qui pourrait déclencher un conflit mondial par accident ?",
      "Qui ferait un achat qu'il regretterait immédiatement ?",
      "Qui ferait semblant de comprendre une situation complexe sans l'avoir saisie ?",
      "Qui pourrait transformer une situation simple en catastrophe sans même le savoir ?",
      "Qui ferait rire les gens au pire moment possible ?",
      "Qui dirait « t’inquiète j’ai géré » alors qu'il n'a rien fait ?",
      "Qui oublierait ce qu'il fait en plein milieu d'une action ?",
      "Qui est capable de rater une porte ouverte ?",
      "Qui se perdrait dans sa propre ville ?",
      "Qui mettrait le feu à la cuisine en faisant juste des pâtes ?",
      "Qui cliquerait sur « vous avez gagné un iPhone » ?",
      "Qui transformerait une réunion de 10 minutes en débat sans fin ?",
      "Qui appellerait au mauvais numéro avec une totale assurance ?",
      "Qui répondrait à un message important avec une faute énorme ?",
      "Qui oublierait où il a garé alors qu'il n'a pas de voiture ?",
    ],
  },
  {
    id: "party",
    label: "🍻 Soirée",
    questions: [
      "Qui tient le moins bien sur la piste de danse ?",
      "Qui chanterait en karaoké sans honte ?",
      "Qui finit ses soirée en mode philosophe ?",
      "Qui commande les boissons les plus bizarres ?",
      "Qui disparaît toujours mystérieusement en soirée ?",
      "Qui devient trop sociable après 2 verres ?",
      "Qui raconte toujours la même histoire en boucle ?",
      "Qui perd ses affaires à chaque soirée ?",
      "Qui devient DJ sans être demandé ?",
      "Qui raconte ses pires histoires en soirée sans filtre ?",
      "Qui devient trop confiant après un seul verre ?",
      "Qui finit les discussions philosophiques à 4h du matin ?",
      "Qui devient trop honnête en soirée ?",
      "Qui commande toujours trop de nourriture ?",
      "Qui lance les pires débats en fin de soirée ?",
      "Qui oublie totalement les conversations du lendemain ?",
      "Qui finit toujours par parler à tout le monde sauf à ses amis ?",
      "Qui a tendance à disparaître mystérieusement en soirée ?",
      "Qui s'endort le premier en soirée ?",
      "Qui propose toujours « un dernier verre » ?",
      "Qui prend le plus de photos floues ?",
      "Qui connaît tout le monde à la fin de la soirée ?",
      "Qui lance le karaoké que personne n'a demandé ?",
      "Qui rentre sans dire au revoir à personne ?",
      "Qui drague le plus maladroitement après deux verres ?",
    ],
  },
  {
    id: "awkward",
    label: "😳 Gênant",
    questions: [
      "Qui a déjà envoyé un message et regretté immédiatement ?",
      "Qui a déjà fait semblant de ne pas avoir vu quelqu'un qu'il connaît ?",
      "Qui a déjà ri à un moment totalement inapproprié ?",
      "Qui a déjà stalké quelqu'un puis liké par accident ?",
      "Qui a déjà oublié le prénom de quelqu'un juste après l'avoir entendu ?",
      "Qui a déjà salué quelqu'un qui ne le saluait pas ?",
      "Qui fait semblant de comprendre alors qu'il est perdu ?",
      "Qui a déjà quitté une conversation trop vite par gêne ?",
      "Qui a déjà eu un fou rire dans un moment sérieux ?",
      "Qui a déjà envoyé un vocal qu'il n'aurait jamais dû envoyer ?",
      "Qui a déjà essayé de rester discret… et s'est encore plus fait remarquer ?",
      "Qui a déjà dit « oui » sans avoir entendu la question ?",
      "Qui a déjà regardé quelqu'un trop longtemps sans raison ?",
      "Qui a déjà répondu à côté de la plaque en étant sûr de lui ?",
      "Qui a déjà fait coucou à quelqu'un qui saluait la personne derrière lui ?",
      "Qui a déjà poussé une porte « tirez » avec conviction ?",
      "Qui a déjà tendu la main alors que l'autre allait faire la bise ?",
      "Qui a déjà raconté une histoire à la personne qui l'a vécue ?",
      "Qui a déjà répondu « toi aussi » à un truc qui ne s'y prêtait pas du tout ?",
      "Qui a déjà cherché ses lunettes alors qu'il les portait ?",
    ],
  },
  {
    id: "soft_betrayal",
    label: "🗡️ Trahison douce",
    questions: [
      "Qui serait prêt à trahir le groupe pour gagner un jeu ?",
      "Qui prendrait le dernier morceau d'un gâteau sans demander ?",
      "Qui a déjà fait semblant de ne pas connaître quelqu'un pour éviter un moment gênant ?",
      "Qui choisirait toujours son intérêt avant celui du groupe (gentiment) ?",
      "Qui pourrait mentir pour éviter un plan sans culpabiliser ?",
      "Qui volerait la meilleure place sans rien dire ?",
      "Qui changerait de camp si ça lui arrange ?",
      "Qui abandonnerait le groupe pour une meilleure opportunité sans prévenir ?",
      "Qui oublierait volontairement de partager une info importante ?",
      "Qui ferait croire qu'il aide… mais laisse les autres faire ?",
      "Qui sauverait sa peau en premier dans un jeu de groupe ?",
      "Qui ferait semblant d'être d'accord juste pour éviter un conflit ?",
      "Qui trahirait une alliance dans un jeu pour gagner ?",
      "Qui dirait « je viens » puis disparaît au dernier moment ?",
      "Qui laisserait les autres gérer le sale boulot ?",
      "Qui prendrait toujours le meilleur rôle sans laisser choisir ?",
      "Qui finirait les courses communes sans jamais rien racheter ?",
      "Qui dirait du mal de quelqu'un puis le complimenterait en face ?",
      "Qui te lâcherait pour un meilleur plan à la dernière minute ?",
      "Qui prendrait le crédit du travail des autres ?",
      "Qui voterait contre toi juste pour gagner ?",
      "Qui garderait le meilleur pour lui tout en prétendant partager ?",
    ],
  }
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
