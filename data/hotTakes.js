import { EVENING_POINTS } from "./eveningScoring.js";

/** Id du thème qui fusionne toutes les banques (sauf lui-même) */
export const HOT_TAKE_CATALOG_ID = "catalog";

/** Mix : tirage aléatoire parmi les banques des autres thèmes (pas de liste locale). */
export const HOT_TAKE_MIX_ID = "mix";

/** Opinions par thème - utilisées en banque Hot Take */
export const HOT_TAKE_THEMES = [
  {
    id: HOT_TAKE_CATALOG_ID,
    label: "📚 Tout le catalogue",
    takes: [],
  },
  {
    id: "food",
    label: "🍕 Food",
    takes: [
      "Les chips dans un sandwich, c’est du génie.",
      "Commander une salade au resto pour piquer les frites des autres, c’est stratégique.",
      "Les goûters de 16h méritent plus de respect.",
      "Les gens qui aiment les raisins secs dans les pâtisseries ne sont pas dignes de confiance.",
      "Le pain un peu brûlé a meilleur goût.",
      "Les frites sans sauce, c’est triste.",
      "Le café sans sucre c'est pas du vrai café.",
      "Les céréales dans l'eau c'est meilleur.",
      "L'ananas sur la pizza, c'est objectivement bon.",
      "La mayonnaise est meilleure que le ketchup.",
      "Le pain rassis fait de meilleurs croûtons.",
      "Les sushis du supermarché sont sous-estimés.",
      "Réchauffer une pizza au micro-ondes, c'est un crime.",
      "Le chocolat blanc n'est pas du chocolat.",
      "Les restes du lendemain sont meilleurs que le plat d'origine.",
      "Mettre du ketchup sur les pâtes devrait être puni par la loi.",
      "Le fromage qui sent fort est le meilleur fromage.",
      "La coriandre gâche absolument tout.",
      "Tremper ses biscuits dans le thé est un art.",
      "Boire le jus de la boîte de cornichons, c'est validé.",
      "Manger des pâtes sans sauce, c'est de la survie, pas un repas.",
    ],
  },
  {
    id: "habits",
    label: "🧠 Habitudes étranges",
    takes: [
      "Les chats savent exactement quand déranger.",
      "Les gens qui mâchent fort devraient être mutés dans une autre galaxie.",
      "Ouvrir le frigo sans raison précise est une activité à part entière.",
      "Les gens qui courent pour le plaisir me font peur.",
      "Refaire son lit est une perte de temps.",
      "Les crocs sont moches… mais confortables donc validées.",
      "Garder 47 onglets ouverts est une forme d'optimisme.",
      "Sentir un vêtement pour savoir s'il est propre est une science exacte.",
      "Repousser l'alarme cinq fois fait partie intégrante du réveil.",
      "Avoir une chaise couverte de vêtements est un choix de vie assumé.",
      "Garder des sacs plastique dans un autre sac plastique est nécessaire.",
      "Parler à ses plantes les fait pousser, c'est prouvé dans ma tête.",
      "Mettre la même chanson en boucle 30 fois, c'est parfaitement sain.",
    ],
  },
  {
    id: "culture",
    label: "🎬 Culture",
    takes: [
      "Les films d’horreur sont surtout des séances de cardio.",
      "Le cinéma c'est surfait, Netflix c'est mieux.",
      "Les films en noir et blanc sont ennuyeux.",
      "Les gens qui regardent les sous-titres sont plus intelligents.",
      "Les livres sont toujours meilleurs que les adaptations.",
      "Les suites sont presque toujours moins bonnes que l'original.",
      "Écouter un album dans l'ordre est la seule façon correcte.",
      "Les gens qui spoilent méritent une punition sévère.",
      "Un bon générique vaut mieux qu'une intrigue moyenne.",
      "Aller au cinéma tout seul est totalement sous-coté.",
      "La plupart des remakes ne servent strictement à rien.",
      "Une série sans bonne fin ne mérite pas qu'on la commence.",
      "Les podcasts ont remplacé la radio, et c'est tant mieux.",
    ],
  },
  {
    id: "life",
    label: "☕ Vie quotidienne",
    takes: [
      "Les gens qui mettent des réveils sans se lever sont des artistes du chaos.",
      "Les gens qui mettent leur réveil avec une musique douce aiment souffrir lentement.",
      "Dormir avec des chaussettes c'est correct.",
      "Les réveils à 6h rendent plus productif.",
      "Les discussions après 23h deviennent automatiquement philosophiques.",
      "Les stories « happy birthdayyy » sont une obligation sociale étrange.",
      "Les « mdrrr » sans rire derrière devraient être taxés",
      "Dire « je suis à 5 minutes » en étant encore chez soi est une tradition.",
      "Les « on doit parler » enlèvent 5 ans d’espérance de vie.",
      "Les « tu fais la gueule ? » donnent instantanément envie de faire la gueule.",
      "Les vocaux de 7 minutes devraient être illégaux.",
      "Les gens qui répondent « ok » sont inquiétants.",
      "Le mode silencieux devrait être obligatoire en public.",
      "Les couvertures lourdes donnent un faux sentiment de sécurité mais ça fonctionne.",
      "Regarder la pluie par la fenêtre, c’est une activité.",
      "Le lundi ne devrait pas exister.",
      "Arriver seulement 30 minutes en avance à l’aéroport, c’est vivre dangereusement.",
      "Les gens qui aiment l’été n’ont jamais pris les transports en commun sous canicule.",
      "Mettre « vu » sans répondre est une déclaration de guerre.",
      "Dire « je t'envoie ça demain » veut dire dans deux semaines.",
      "Faire semblant de chercher dans son sac pour éviter quelqu'un est légitime.",
      "Les gens toujours en retard pensent que le temps les attend.",
      "Répondre à un message pro le soir, c'est trahir tous les autres.",
      "Le check du téléphone aux toilettes est universel mais personne ne l'avoue.",
      "Les groupes de discussion familiale devraient avoir un mode silencieux permanent.",
    ],
  },
  {
    id: "relationships",
    label: "💘 Relations",
    takes: [
      "Le ghosting est parfois le plus grand acte de gentillesse.",
      "Répondre trop vite à un crush, c'est montrer trop d'intérêt.",
      "Les couples qui publient tout sur les réseaux cachent quelque chose.",
      "Rester ami avec son ex, c'est jouer avec le feu.",
      "Un date sans dessert n'est pas un vrai date.",
      "Les gens qui disent « on verra où ça nous mène » savent très bien que ça ne mène nulle part.",
      "Offrir des fleurs, c'est offrir une plante mourante.",
      "Connaître le signe astro de quelqu'un avant son prénom, c'est valide.",
      "Faire le premier pas est surcoté.",
      "Avouer qu'on a déjà stalké le profil de quelqu'un, c'est juste de l'honnêteté.",
      "Demander « on est quoi ? » tue instantanément la relation.",
      "Un couple qui ne se chamaille jamais cache forcément ses problèmes.",
      "Liker une très vieille photo, c'est une déclaration assumée.",
      "Mettre du temps à répondre rend objectivement plus désirable.",
      "Les relations longue distance, c'est surtout s'écrire beaucoup.",
      "Garder une photo de son ex, c'est suspect.",
    ],
  },
  {
    id: "money",
    label: "💸 Argent",
    takes: [
      "Prêter de l'argent à un ami, c'est en réalité lui en offrir.",
      "Calculer au centime près une addition de groupe, c'est radin.",
      "Acheter en promo un truc inutile, c'est perdre de l'argent, pas en gagner.",
      "Payer son café 6 €, c'est un crime contre soi-même.",
      "Les abonnements qu'on oublie de résilier financent l'économie mondiale.",
      "Négocier au marché, c'est un sport à part entière.",
      "Avoir une épargne « vacances » qu'on vide pour autre chose est universel.",
      "Dépenser pour des expériences plutôt que des objets, c'est juste une excuse marketing.",
      "Vérifier son compte en banque les yeux à moitié fermés est une stratégie valable.",
      "Un abonnement à la salle de sport, c'est un don mensuel à une association.",
      "Le « je te rembourse » est rarement honoré.",
      "Acheter d'occasion plutôt que neuf, c'est toujours plus malin.",
      "Garder de la monnaie dans un bocal, c'est un vrai plan d'épargne.",
      "Commander pour 40 € de plus pour éviter 3 € de livraison, c'est parfaitement logique.",
      "Compter sur un futur héritage, c'est un plan de retraite valable.",
    ],
  },
  {
    id: "tech",
    label: "📱 Technologie",
    takes: [
      "Redémarrer l'appareil règle 90 % des problèmes.",
      "Le mode sombre est objectivement supérieur.",
      "Garder son téléphone à 15 % de batterie est un mode de vie.",
      "Mettre son téléphone face contre table est une marque de respect.",
      "Les gens qui n'utilisent pas de coque vivent dangereusement.",
      "Une story de plus de 30 secondes ne sera jamais regardée en entier.",
      "Désactiver les accusés de réception est un aveu.",
      "Garder des milliers de photos floues qu'on ne triera jamais est parfaitement normal.",
      "Le wifi des autres est toujours plus rapide que le sien.",
      "Les gens qui éteignent leur téléphone la nuit viennent d'un autre monde.",
      "Fermer toutes ses applis en arrière-plan pour économiser la batterie ne sert à rien.",
      "Personne ne se souvient de ses mots de passe, et ce n'est la faute de personne.",
      "Faire une capture d'écran « pour plus tard », c'est ne jamais y revenir.",
      "Avoir 3 % de batterie et continuer à scroller, c'est de la bravoure.",
      "Mettre à jour ses applis à la main, c'est du contrôle, pas de la paranoïa.",
      "Avoir des centaines de mails non lus est une forme de paix intérieure.",
    ],
  },
  {
    id: HOT_TAKE_MIX_ID,
    label: "🎲 Mix",
    takes: [],
  },
];

function normalizeTakeKey(text) {
  return String(text).trim().toLowerCase();
}

const AGGREGATE_THEME_IDS = new Set([HOT_TAKE_CATALOG_ID, HOT_TAKE_MIX_ID]);

/** Toutes les takes des thèmes « banque » (hors catalogue / mix), sans doublon. */
export function getCatalogTakes(themes = HOT_TAKE_THEMES) {
  const seen = new Set();
  const out = [];
  for (const theme of themes) {
    if (AGGREGATE_THEME_IDS.has(theme.id)) continue;
    for (const text of theme.takes || []) {
      const key = normalizeTakeKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

/** Banque d’un thème (catalogue / mix = fusion des autres thèmes ; le deck est mélangé à la volée). */
export function getThemeBankTexts(themeId, themes = HOT_TAKE_THEMES) {
  if (themeId === HOT_TAKE_CATALOG_ID || themeId === HOT_TAKE_MIX_ID) {
    return getCatalogTakes(themes);
  }
  const theme = themes.find((t) => t.id === themeId);
  return [...(theme?.takes || [])];
}

export const HOT_TAKE_OPTIONS = ["VALIDE", "ACCEPTABLE", "CRIMINEL"];

export const HOT_TAKE_OPTION_COLORS = {
  VALIDE: "#4ADE80",
  ACCEPTABLE: "#FBBF24",
  CRIMINEL: "#F87171",
};

export const HOT_TAKE_TIMER_SEC = 7;

/** Nombre de manches proposées en préparation (-1 = tout le deck) */
export const HOT_TAKE_ROUND_PRESETS = [3, 5, 8];
/** @deprecated - défini dans js/games/hotTake.js */
export const HOT_TAKE_INTERMISSION_SEC = 5;

/** @deprecated - utiliser EVENING_POINTS depuis data/eveningScoring.js */
export const HOT_TAKE_POINTS_MAJORITY = EVENING_POINTS.WIN;
/** @deprecated */
export const HOT_TAKE_POINTS_DISSENT = EVENING_POINTS.BONUS;
/** Points pour chaque votant en cas d'égalité parfaite (pas de majorité). */
export const HOT_TAKE_POINTS_TIE = 5;

export const HOT_TAKE_FORBIDDEN_WORDS = [
  "nègre",
  "negre",
  "nigger",
  "nigga",
  "bougnoule",
  "raton",
  "youpin",
  "pédé",
  "pede",
  "tapette",
  "gouine",
  "travelo",
  "tranny",
  "faggot",
  "fag",
  "pd",
];

export const HOT_TAKE_MODERATION_NOTICE =
  "Les insultes et termes racistes, homophobes, transphobes ou haineux sont interdits. Si ton texte en contient, il sera refusé.";

/** @deprecated - utiliser getThemeBankTexts */
export const HOT_TAKES = getCatalogTakes();
