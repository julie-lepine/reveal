// Fiches de règles affichées dans la modale « Règles » (écrans de paramétrage + cartes).
// Contenu volontairement court et concret. Les points correspondent au barème réel des jeux.

import { TRAITRE_MIN_PLAYERS } from "./traitre.js";

export const GAME_RULES = {
  playlistguess: {
    title: "VibeCheck",
    emoji: "🎵",
    but: "Une chanson tombe au hasard : votez pour la personne du groupe à qui elle correspond le mieux.",
    etapes: [
      "Une chanson s'affiche (titre, artiste, pochette).",
      "Chacun vote pour la personne du lobby à qui la chanson correspond le mieux (tu peux voter pour toi).",
      "La manche se termine quand tout le monde a voté.",
    ],
    points: [
      "Le(s) joueur(s) le plus voté(s) : +15 pts.",
      "Tous ceux qui ont voté pour un joueur le plus voté : +10 pts.",
      "Les deux se cumulent (jusqu'à +25 sur une manche).",
    ],
    exemple:
      "« Djadja » tombe. 4 personnes votent Léa, 2 votent Tom. Léa gagne +15, et les 4 qui ont voté Léa gagnent +10 chacun.",
  },

  consensus: {
    title: "Consensus",
    emoji: "🤝",
    but: "Réponds comme le groupe, pas comme toi : vise la réponse moyenne du lobby.",
    etapes: [
      "Une question avec un curseur de 0 à 100 s'affiche.",
      "Chacun place son curseur en secret.",
      "On révèle tout et on compare au consensus du groupe.",
    ],
    points: [
      "Plus tu es proche du consensus du groupe, plus tu montes dans le classement du jeu.",
      "À la fin, le podium reçoit un bonus de soirée : +50 / +25 / +10 pts.",
    ],
    exemple:
      "« À quel point la pizza ananas est acceptable ? » Le groupe tourne autour de 35. Tu as mis 33 : tu es tout proche → top score sur la manche.",
  },

  hottake: {
    title: "HotTake",
    emoji: "🔥",
    but: "Une opinion clivante : vote Valide, Acceptable ou Criminel - suis le troupeau (+10) ou assume ton côté outsider (+15).",
    etapes: [
      "Une affirmation s'affiche (ex. « Le sucré-salé, c'est non »).",
      "Chacun vote : Valide (d'accord), Acceptable (bof), ou Criminel (non).",
      "On révèle la répartition - et qui a joué outsider.",
    ],
    points: [
      "Si une majorité se dégage : le troupeau gagne +10 pts.",
      "Les outsiders (minorité) gagnent +15 pts - c'est eux qui cartonnent.",
      "En cas d'égalité parfaite : personne ne marque.",
    ],
    exemple:
      "5 votent « Valide », 1 « Criminel ». Les 5 du troupeau gagnent +10, l'outsider solo empoche +15.",
  },

  guesslie: {
    title: "Guess The Lie",
    emoji: "🕵️",
    but: "Deux vérités et un mensonge : démasque le bluff des autres.",
    etapes: [
      "Un joueur présente 3 affirmations sur lui : 2 vraies, 1 fausse.",
      "Les autres votent pour celle qu'ils pensent être le mensonge.",
      "On révèle la vraie réponse.",
    ],
    points: [
      "Chaque détective qui trouve le mensonge : +10 pts.",
      "Le menteur : +15 pts s'il trompe au moins la moitié du groupe.",
    ],
    exemple:
      "Tom prétend avoir sauté en parachute. 4 joueurs sur 6 se trompent → Tom gagne +15, et les 2 qui ont trouvé gagnent +10.",
  },

  speedvote: {
    title: "SpeedVote",
    emoji: "⚡",
    but: "Vote instantané : qui colle le mieux à la question ?",
    etapes: [
      "Une question « Qui est le plus… ? » s'affiche.",
      "Vote pour un joueur du lobby (tu peux voter pour toi).",
      "La manche se clôt quand tout le monde a voté.",
    ],
    points: [
      "Le(s) joueur(s) le plus voté(s) : +10 pts.",
      "Certaines manches « bonus » doublent les points.",
    ],
    exemple:
      "« Qui rirait à un enterrement ? » La majorité vote Sarah → Sarah gagne +10.",
  },

  dilemma: {
    title: "Dilemma",
    emoji: "⚖️",
    but: "Choix A ou B, sans demi-mesure : rejoins le camp majoritaire.",
    etapes: [
      "Un dilemme « A vs B » s'affiche.",
      "Chacun choisit son camp.",
      "On révèle la répartition.",
    ],
    points: [
      "Les joueurs du camp majoritaire : +10 pts.",
      "Égalité parfaite (50/50) : +5 pts pour chaque votant.",
    ],
    exemple:
      "« Sans téléphone 1 an, ou sans musique 1 an ? » 4 choisissent « sans musique » → ces 4 gagnent +10.",
  },

  truthmeter: {
    title: "TruthMeter",
    emoji: "📏",
    but: "Une affirmation chiffrée et un curseur Faux → Vrai : le groupe estime, l'auteur bluffe ou non. Minimum 2 joueurs.",
    etapes: [
      "Un joueur écrit une affirmation et garde son estimation secrète.",
      "Chacun place son curseur entre Faux (0%) et Vrai (100%).",
      "On compare l'estimation de l'auteur et la moyenne du groupe.",
    ],
    points: [
      "L'auteur : +15 si le groupe se trompe loin de son estimation (bluff réussi), +10 si le groupe tombe juste.",
      "Le joueur le plus proche de la moyenne du groupe : +15 pts, sinon +10 pts.",
    ],
    exemple:
      "Léa affirme un chiffre. Le groupe vise très loin de son estimation → Léa a bluffé : +15.",
  },

  tiernight: {
    title: "TierNight",
    emoji: "🏆",
    but: "Classe des éléments en tiers (S / A / B / C / D) en visant le consensus du groupe.",
    etapes: [
      "Une tier list est choisie (ex. « fast-foods »).",
      "Chacun classe les éléments de S à D.",
      "On révèle le classement consensus du groupe.",
    ],
    points: [
      "Chaque élément placé au même tier que le consensus (ou mieux) : +15 pts.",
      "À un tier d'écart : +10 pts. Au-delà : 0.",
    ],
    exemple:
      "Tu mets « McDo » en tier A. Le consensus du groupe le place aussi en A → +15 pour cet élément.",
  },

  trivia: {
    title: "Trivia Quiz",
    emoji: "🧠",
    but: "Quiz de culture générale : réponds juste, et vite.",
    etapes: [
      "Une question à choix multiple s'affiche.",
      "Chacun choisit sa réponse.",
      "On révèle la bonne réponse.",
    ],
    points: [
      "Pendant la partie : bonne réponse +10, et le plus rapide à répondre juste +10 (classement du jeu).",
      "À la fin, le podium reçoit un bonus de soirée : +50 / +25 / +10 pts.",
    ],
    exemple:
      "« Capitale de l'Australie ? » Tu réponds Canberra en premier et juste → +10 (bonne) +10 (rapide).",
  },

  traitre: {
    title: "Spot the fake",
    emoji: "🎭",
    but: "Tous reçoivent un mot secret - sauf un, qui a un mot proche. À l'oral, donnez des indices sans prononcer votre mot. Trouvez le fake avant qu'il ne finisse dans le duo final.",
    etapes: [
      `${TRAITRE_MIN_PLAYERS} joueurs minimum. Tour de révélation : chacun lit son mot en privé sur son téléphone, puis valide.`,
      "Manche 1 : chacun dit un indice à voix haute, dans l'ordre libre. L'hôte finalise le tour quand tout le monde a parlé.",
      "Fin de manche 1 : l'hôte choisit « Continuer » (nouvelle manche d'indices) ou « Voter ».",
      "À partir de la manche 2, un vote d'élimination est obligatoire après les indices.",
      "Les indices d'une nouvelle manche doivent être différents des précédents.",
      "Égalité au vote : nouvelle manche d'indices (mêmes mots) jusqu'à obtenir une majorité.",
      "La partie continue jusqu'à l'élimination du fake ou s'il reste dans les 2 derniers survivants.",
    ],
    points: [
      "Fake encore présent dans les 2 derniers : +50 pts (+10 pts par vote survécu, cumulés).",
      "Fake éliminé : 0 pt pour lui.",
      "Civil qui a voté pour le fake au vote de son élimination : +20 pts.",
      "Les autres civils (mauvais vote ou pas le bon au bon moment) : 0 pt, même si le groupe gagne.",
    ],
    exemple:
      "Mot majorité « Android », fake « iOS ». M1 : indices oraux. M2 : vote - le fake survit (+10). M3 : vote - Léa et Tom votent le fake, il est éliminé : Léa et Tom +20 chacun, les autres 0.",
  },
};

/** Correspondance entre l'id de navigation (cartes / écrans) et la clé de règles. */
export const RULES_KEY_BY_NAV = {
  "traitre-prep": "traitre",
  "playlistguess-prep": "playlistguess",
  "consensus-prep": "consensus",
  "hottake-prep": "hottake",
  guesslie: "guesslie",
  "speedvote-prep": "speedvote",
  "dilemma-prep": "dilemma",
  "truthmeter-prep": "truthmeter",
  "tiernight-select": "tiernight",
  "trivia-prep": "trivia",
};

export function getGameRules(key) {
  return GAME_RULES[key] || null;
}
