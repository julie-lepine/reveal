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
        id: "spotify-youtube",
        optionA: "Perdre Spotify",
        optionB: "Perdre YouTube",
      },
      {
        id: "voice-note-call",
        optionA: "Recevoir uniquement des vocaux",
        optionB: "Recevoir uniquement des appels",
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
        optionB: "Avoir un budget de luxe mais des goûts simples",
      },
      {
        id: "viral-cancel",
        optionA: "Devenir viral une fois",
        optionB: "Rester anonyme toute ta vie",
      },
      {
        id: "horse-size-cat",
        optionA: "Combattre un chat de la taille d'un cheval",
        optionB: "Combattre 100 chevaux de la taille d'un chat",
      },
      {
        id: "banana-slip",
        optionA: "Glisser sur une peau de banane une fois par semaine",
        optionB: "Éternuer à chaque selfie",
      },
      {
        id: "random-costume",
        optionA: "Porter un costume de pirate chaque lundi",
        optionB: "Porter un costume de licorne chaque vendredi",
      },
      {
        id: "villain-laugh",
        optionA: "Rire comme un méchant de dessin animé",
        optionB: "Marcher comme un mannequin",
      },
      
      {
        id: "cereal-water",
        optionA: "Manger tes céréales avec de l'eau",
        optionB: "Boire ton café avec du sel",
      },
      {
        id: "cheese-rain",
        optionA: "Qu'il pleuve du fromage râpé",
        optionB: "Qu'il neige du popcorn",
      },
      {
        id: "invisible-fart",
        optionA: "Péter très fort mais sans odeur",
        optionB: "Péter silencieusement mais avec une odeur atroce",
      },
      {
        id: "frog-money",
        optionA: "Recevoir 100 € à chaque grenouille touchée",
        optionB: "Recevoir 100 € à chaque pigeon touché",
      },
      {
        id: "theme-song",
        optionA: "Avoir une musique de boss à chaque entrée dans une pièce",
        optionB: "Avoir des rires enregistrés après chaque blague",
      },
      {
        id: "clown-shadow",
        optionA: "Avoir un clown qui te suit partout",
        optionB: "Avoir ton ombre qui te parle",
      },
      {
        id: "ai-boss",
        optionA: "Ton patron est une IA",
        optionB: "Ton collègue pref est une IA",
      },
      {
        id: "truth-lie",
        optionA: "Ne pouvoir dire que la vérité",
        optionB: "Ne jamais pouvoir dire la vérité",
      },
      {
        id: "famous-broke",
        optionA: "Être ultra célèbre mais fauché",
        optionB: "Être riche mais totalement inconnu",
      },
      {
        id: "languages-instruments",
        optionA: "Parler toutes les langues",
        optionB: "Jouer de tous les instruments",
      },
      {
        id: "pause-rewind",
        optionA: "Mettre le temps sur pause 10 min par jour",
        optionB: "Revenir 10 secondes en arrière à volonté",
      },
      {
        id: "weather-animals",
        optionA: "Contrôler la météo",
        optionB: "Parler à tous les animaux",
      },
      {
        id: "perfect-memory-forget",
        optionA: "Avoir une mémoire parfaite",
        optionB: "Pouvoir oublier ce que tu veux",
      },
      {
        id: "win-lose-argument",
        optionA: "Gagner chaque débat mais agacer tout le monde",
        optionB: "Perdre chaque débat mais être adoré de tous",
      },
      {
        id: "summer-winter-forever",
        optionA: "Vivre en été éternel",
        optionB: "Vivre en hiver éternel",
      },
      {
        id: "free-flights-hotels",
        optionA: "Avions gratuits à vie",
        optionB: "Hôtels gratuits à vie",
      },
      {
        id: "invisible-fly",
        optionA: "Être invisible quand tu veux",
        optionB: "Voler quand tu veux",
      },
      {
        id: "no-pain-no-tired",
        optionA: "Ne plus jamais ressentir la douleur",
        optionB: "Ne plus jamais ressentir la fatigue",
      },
      {
        id: "choose-dreams",
        optionA: "Choisir tes rêves chaque nuit",
        optionB: "Te souvenir parfaitement de chaque rêve",
      },
      {
        id: "skip-queue-buffer",
        optionA: "Ne plus jamais faire la queue",
        optionB: "Ne plus jamais attendre un chargement",
      },
      {
        id: "best-friend-rich",
        optionA: "Que ton meilleur ami devienne riche",
        optionB: "Que tu deviennes riche mais seul",
      },
      {
        id: "first-alone-last-together",
        optionA: "Toujours arriver premier mais seul",
        optionB: "Toujours arriver dernier mais bien accompagné",
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
        id: "itch-sneeze",
        optionA: "Avoir le nez qui gratte à vie",
        optionB: "Avoir une envie d'éternuer permanente",
        tier: "impossible",
      },
      {
        id: "queue-redlight",
        optionA: "Faire la queue partout",
        optionB: "Tomber sur tous les feux rouges",
        tier: "impossible",
      },
      {
        id: "cold-pillow",
        optionA: "Dormir sur un oreiller humide",
        optionB: "Dormir avec des miettes dans le lit",
        tier: "impossible",
      },
      {
        id: "sneeze-hiccup",
        optionA: "Hoqueter à chaque éternuement",
        optionB: "Éternuer à chaque hoquet",
        tier: "impossible",
      },
      
      {
        id: "clown-elevator",
        optionA: "Partager chaque ascenseur avec un clown silencieux",
        optionB: "Partager chaque ascenseur avec un magicien bavard",
        tier: "impossible",
      },
      {
        id: "lego-floor",
        optionA: "Marcher sur un Lego chaque matin",
        optionB: "Te cogner le petit orteil chaque soir",
        tier: "impossible",
      },
      {
        id: "whisper-shout",
        optionA: "Parler uniquement en chuchotant",
        optionB: "Parler uniquement en criant",
        tier: "impossible",
      },
      {
        id: "sticky-hands",
        optionA: "Avoir les mains collantes à vie",
        optionB: "Avoir les pieds humides à vie",
        tier: "impossible",
      },
      {
        id: "alarm-hour",
        optionA: "Entendre un réveil fantôme chaque nuit",
        optionB: "Entendre une notification fantôme chaque heure",
        tier: "impossible",
      },
      {
        id: "wet-sleeves",
        optionA: "Manches mouillées après chaque lavage de mains",
        optionB: "Chaussettes humides après chaque douche",
        tier: "impossible",
      },
      {
        id: "door-handle",
        optionA: "Toutes les poignées sont collantes",
        optionB: "Tous les écrans sont gras",
        tier: "impossible",
      },
      {
        id: "cold-pizza",
        optionA: "Pizza toujours froide",
        optionB: "Frites toujours molles",
        tier: "impossible",
      },
      {
        id: "duck-shadow",
        optionA: "Être suivi par un canard agressif",
        optionB: "Être suivi par ton propre clone gênant",
        tier: "impossible",
      },
      {
        id: "warm-water",
        optionA: "Boire uniquement de l'eau tiède",
        optionB: "Boire uniquement du café froid",
        tier: "impossible",
      },
      
      {
        id: "hair-food",
        optionA: "Trouver un cheveu dans chaque repas",
        optionB: "Trouver une coquille d'œuf dans chaque repas",
        tier: "impossible",
      },
      {
        id: "mustache-eyebrows",
        optionA: "Avoir une moustache permanente",
        optionB: "Avoir des sourcils géants",
        tier: "impossible",
      },
      {
        id: "one-song",
        optionA: "Entendre la même chanson chaque jour",
        optionB: "Entendre le même rire chaque jour",
        tier: "impossible",
      },
      {
        id: "sand-bed",
        optionA: "Toujours avoir du sable dans ton lit",
        optionB: "Toujours avoir un caillou dans ta chaussure",
        tier: "impossible",
      },
      {
        id: "ads-life",
        optionA: "Voir une pub avant chaque repas",
        optionB: "Voir une pub avant chaque douche",
        tier: "impossible",
      },
      {
        id: "wet-socks",
        optionA: "Chaussettes mouillées à vie",
        optionB: "Cheveux collés à vie",
        tier: "impossible",
      },
      {
        id: "netflix-spoil",
        optionA: "Spoiler toutes les séries",
        optionB: "Être spoilé sur toutes les séries",
        tier: "impossible",
      },
      {
        id: "online-date",
        optionA: "Premier rendez-vous en visio",
        optionB: "Premier rendez-vous avec les parents présents",
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
      {
        id: "chewing-amplified",
        optionA: "Entendre tout le monde mâcher et très fort",
        optionB: "Que tout le monde t'entende mâcher amplifié",
        tier: "impossible",
      },
      {
        id: "sock-seam",
        optionA: "Sentir la couture des chaussettes en permanence",
        optionB: "Avoir une étiquette qui gratte dans le dos à vie",
        tier: "impossible",
      },
      {
        id: "phantom-vibration",
        optionA: "Sentir ton téléphone vibrer alors qu'il ne se passe rien",
        optionB: "Ne jamais sentir les vraies notifications",
        tier: "impossible",
      },
      {
        id: "greasy-screen",
        optionA: "Écran de téléphone toujours un peu gras",
        optionB: "Lunettes toujours légèrement embuées",
        tier: "impossible",
      },
      {
        id: "pebble-hair",
        optionA: "Avoir un petit caillou dans la chaussure en permanence",
        optionB: "Avoir toujours un cheveu dans la bouche",
        tier: "impossible",
      },
      {
        id: "buffer-99",
        optionA: "Toutes tes vidéos qui arrêtent de charger à 99 %",
        optionB: "Les pages qui chargent juste après que tu abandonnes",
        tier: "impossible",
      },
      {
        id: "lukewarm-salty",
        optionA: "Toutes tes boissons tièdes",
        optionB: "Toute ta nourriture légèrement trop salée",
        tier: "impossible",
      },
      {
        id: "autocorrect-curse",
        optionA: "Un autocorrect qui change toujours ton mot",
        optionB: "Un clavier avec la touche « espace » qui répond mal",
        tier: "impossible",
      },
      {
        id: "stuck-song-name",
        optionA: "Avoir une chanson coincée dans la tête à vie",
        optionB: "Oublier le prénom des gens 2 secondes après",
        tier: "impossible",
      },
      {
        id: "crumbs-sand",
        optionA: "Toujours des miettes dans ton lit",
        optionB: "Toujours un grain de sable dans l'œil",
        tier: "impossible",
      },
      {
        id: "lace-sleeve",
        optionA: "Un lacet qui se défait toutes les 10 minutes",
        optionB: "Une manche qui remonte sans arrêt",
        tier: "impossible",
      },
      {
        id: "battery-1-heat",
        optionA: "Téléphone bloqué à 1% et en mode éco mais qui ne meurt jamais",
        optionB: "Téléphone à 100 % mais qui chauffe en permanence",
        tier: "impossible",
      },
      {
        id: "squeaky-chair-slam-door",
        optionA: "Toutes les chaises grincent sous toi",
        optionB: "Toutes les portes claquent derrière toi",
        tier: "impossible",
      },
      {
        id: "tooth-stuck-cold",
        optionA: "Toujours un truc coincé entre les dents",
        optionB: "Toujours une dent sensible au froid",
        tier: "impossible",
      },
      {
        id: "blurry-tinnitus",
        optionA: "Vision toujours floue de 5 %",
        optionB: "Un léger acouphène en permanence",
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
