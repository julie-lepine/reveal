import { EVENING_POINTS } from "./eveningScoring.js";

/** Id du deck qui fusionne toutes les banques */
export const DILEMMA_CATALOG_ID = "catalog";

export const DILEMMA_VOTE_TIMER_SEC = 10;
export const DILEMMA_REVEAL_HOLD_SEC = 3;
export const DILEMMA_SPLIT_THRESHOLD = 8;
/** Points si le joueur a voté avec la majorité (victoire de manche). */
export const DILEMMA_POINTS_MAJORITY_WIN = EVENING_POINTS.WIN;
/** Points pour chaque joueur en cas d'égalité parfaite A/B. */
export const DILEMMA_POINTS_TIE = 5;
export const DILEMMA_ROUND_PRESETS = [5, 8, 12];
export const DILEMMA_ROUND_ALL = -1;

export const DILEMMA_REACTIONS = [
  { id: "noway", label: "NO WAY", emoji: "🙅" },
  { id: "insane", label: "INSANE", emoji: "🤯" },
  { id: "valid", label: "VALID", emoji: "✅" },
];

export const DILEMMA_DECKS = [
  {
    id: DILEMMA_CATALOG_ID,
    label: "🎲 Tout le catalogue",
    dilemmas: [],
  },
  {
    id: "classic",
    label: "⚖️ Classique",
    dilemmas: [
      {
        id: "sleep-hot",
        optionA: "Ne plus jamais dormir",
        optionB: "Ne plus jamais manger chaud",
      },
      {
        id: "teleport-nude",
        optionA: "Téléportation mais toujours nu",
        optionB: "Vol mais à 1 km/h",
      },
      {
        id: "money-time",
        optionA: "20 € par jour",
        optionB: "1 million dans 30 ans",
      },
      {
        id: "past-future",
        optionA: "Revoir le passé une fois",
        optionB: "Voir le futur une fois",
      },
      {
        id: "no-phone",
        optionA: "Plus jamais de réseaux sociaux",
        optionB: "Plus jamais de séries / films",
      },
      {
        id: "always-late",
        optionA: "Toujours 20 min en retard",
        optionB: "Toujours 1 h en avance",
      },
      {
        id: "read-mind",
        optionA: "Lire dans les pensées de tout le monde",
        optionB: "Que tout le monde lise les tiennes",
      },
      {
        id: "cats-dogs",
        optionA: "Parler aux chats uniquement",
        optionB: "Parler aux chiens uniquement",
      },
      {
        id: "ketchup-mosquito",
        optionA: "Sentir le ketchup toute ta vie",
        optionB: "Entendre le bruit d'un moustique toutes les nuits",
      },
      {
        id: "klaxon-sneeze",
        optionA: "Avoir un rire de klaxon",
        optionB: "Éternuer comme une chèvre",
      },
      {
        id: "cold-soft-food",
        optionA: "Manger uniquement des aliments froids",
        optionB: "Manger uniquement des aliments mous",
      },
      {
        id: "squeak-jacket",
        optionA: "Avoir des chaussures qui couinent",
        optionB: "Avoir une veste qui brille dans le noir",
      },
      {
        id: "rhyme-question",
        optionA: "Parler uniquement en rimes",
        optionB: "Parler uniquement en questions",
      },
      {
        id: "late-early",
        optionA: "Être toujours 1 h en retard",
        optionB: "Être toujours 1 h en avance",
      },
      {
        id: "hot-cold-room",
        optionA: "Dormir dans une chambre à 35 °C",
        optionB: "Dormir dans une chambre à 5 °C",
      },
      {
        id: "long-arms-short-legs",
        optionA: "Avoir des bras très longs",
        optionB: "Avoir des jambes très courtes",
      },
      {
        id: "joke-explain-laugh",
        optionA: "Devoir expliquer chaque blague que tu fais",
        optionB: "Rire avant même de raconter la blague",
      },
      {
        id: "luxury-budget",
        optionA: "Avoir des goûts de luxe mais un budget étudiant",
        optionB: "Avoir un budget de luxe mais des goûts d'étudiant",
      },
    ],
  },
  {
    id: "impossible",
    label: "💀 Impossible tier",
    tier: "impossible",
    dilemmas: [
      {
        id: "toes-fingers",
        optionA: "Doigts de pieds = doigts de main",
        optionB: "Doigts de main = orteils",
        tier: "impossible",
      },
      {
        id: "soup-cereal",
        optionA: "Manger tes céréales dans de la soupe",
        optionB: "Boire ta soupe dans un bol de céréales",
        tier: "impossible",
      },
      {
        id: "wet-socks",
        optionA: "Chaussettes mouillées à vie",
        optionB: "Cheveux collés à vie",
        tier: "impossible",
      },
      {
        id: "laugh-cry",
        optionA: "Rire à chaque enterrement",
        optionB: "Pleurer à chaque anniversaire",
        tier: "impossible",
      },
      {
        id: "wifi-forever",
        optionA: "Wi-Fi public pour toujours",
        optionB: "4G à une barre partout",
        tier: "impossible",
      },
      {
        id: "npc-life",
        optionA: "Vivre dans les Sims sans contrôle",
        optionB: "Vivre dans Minecraft sans contrôle",
        tier: "impossible",
      },
      {
        id: "spaghetti-fries",
        optionA: "Avoir des doigts en spaghettis",
        optionB: "Avoir des cheveux en frites",
        tier: "impossible",
      },
      {
        id: "applause-pigeon",
        optionA: "Applaudir à chaque fois que quelqu'un entre dans une pièce",
        optionB: "Saluer militairement chaque pigeon",
        tier: "impossible",
      },
      {
        id: "dance-sing",
        optionA: "Danser dès qu'il y a de la musique",
        optionB: "Chanter dès qu'il y a du silence",
        tier: "impossible",
      },
      {
        id: "duck-child",
        optionA: "Être poursuivi par un canard une fois par jour",
        optionB: "Être poursuivi par un enfant de 4 ans ultra rapide une fois par semaine",
        tier: "impossible",
      },
      {
        id: "meow-snap",
        optionA: 'Dire « miaou » à la fin de chaque phrase',
        optionB: "Claquer des doigts avant de parler",
        tier: "impossible",
      },
      {
        id: "teeth-ears",
        optionA: "Avoir les dents qui brillent dans le noir",
        optionB: "Avoir les oreilles qui changent de couleur selon ton humeur",
        tier: "impossible",
      },
      {
        id: "pennies-jet",
        optionA: "Être riche mais uniquement en pièces de 1 centime",
        optionB: "Être pauvre mais avec un jet privé inutilisable",
        tier: "impossible",
      },
      {
        id: "w-gps",
        optionA: 'Remplacer tous les « r » par des « w »',
        optionB: "Parler comme un GPS",
        tier: "impossible",
      },
    ],
  },
];

function buildCatalogDilemmas() {
  const seen = new Set();
  const out = [];
  DILEMMA_DECKS.forEach((deck) => {
    if (deck.id === DILEMMA_CATALOG_ID) return;
    (deck.dilemmas || []).forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      out.push(d);
    });
  });
  return out;
}

const catalogBuilt = buildCatalogDilemmas();
const catalogDeck = DILEMMA_DECKS.find((d) => d.id === DILEMMA_CATALOG_ID);
if (catalogDeck) catalogDeck.dilemmas = catalogBuilt;

export function getDilemmaDeckItems(deckId) {
  const id = deckId || DILEMMA_CATALOG_ID;
  const deck = DILEMMA_DECKS.find((d) => d.id === id);
  return deck?.dilemmas || catalogBuilt;
}
