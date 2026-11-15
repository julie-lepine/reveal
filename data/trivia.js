import { EVENING_POINTS } from "./eveningScoring.js";

export const TRIVIA_RANDOM_THEME_ID = "random";
export const TRIVIA_QUESTION_COUNT_PRESETS = [5, 10, 15, 20];
export const TRIVIA_POINTS_CORRECT = EVENING_POINTS.WIN;
export const TRIVIA_POINTS_FASTEST = 5;
export const TRIVIA_LOBBY_PODIUM_POINTS = [15, 10, 5];

export const TRIVIA_THEMES = [
  { id: "cinema", label: "Cinéma" },
  { id: "music", label: "Musique" },
  { id: "geography", label: "Géographie" },
  { id: "sport", label: "Sport" },
  { id: "videogames", label: "Jeux vidéo" },
  { id: "series", label: "Séries / animés" },
  { id: "food", label: "Food" },
  { id: "general", label: "Culture Générale" },
  { id: "memes", label: "Internet / Mèmes" },
  { id: TRIVIA_RANDOM_THEME_ID, label: "Aléatoire" },
];

export const TRIVIA_QUESTIONS = [
  /* CINEMA */
  {
    id: "cinema-001",
    theme: "cinema",
    question: "Quel film a remporté l'Oscar du meilleur film en 1998 ?",
    answers: ["Titanic", "Gladiator", "Forrest Gump", "Braveheart"],
    correct: 0,
    difficulty: "medium",
  },
  {
    id: "cinema-002",
    theme: "cinema",
    question: "Qui réalise 'Inception' ?",
    answers: ["Christopher Nolan","Steven Spielberg","James Cameron","David Fincher"],
    correct: 0,
    difficulty: "medium",
  },
  {
    id: "cinema-003",
    theme: "cinema",
    question: "Dans Star Wars, qui est le père de Luke Skywalker ?",
    answers: ["Obi-Wan Kenobi","Dark Vador","Han Solo","Yoda"],
    correct: 1,
    difficulty: "easy",
  },
  {
    id: "cinema-004",
    theme: "cinema",
    question: "Quel film contient le personnage Jack Sparrow ?",
    answers: ["Pirates des Caraïbes","Titanic","Le Seigneur des Anneaux","Avatar"],
    correct: 0,
    difficulty: "easy",
  },
  {
    id: "cinema-005",
    theme: "cinema",
    question: "Quel film commence par un braquage de banque avec le Joker ?",
    answers: ["Batman Begins","The Dark Knight","Joker","The Batman"],
    correct: 1,
    difficulty: "hard",
  },
  {
    id: "cinema-006",
    theme: "cinema",
    question: "Quel acteur joue Iron Man ?",
    answers: ["Chris Evans","Robert Downey Jr.","Chris Hemsworth","Tom Holland"],
    correct: 1,
    difficulty: "medium",
  },
  {
    id: "cinema-007",
    theme: "cinema",
    question: "Quel film parle d'un naufrage célèbre ?",
    answers: ["Titanic","Interstellar","Jaws","Avatar"],
    correct: 0,
    difficulty: "easy",
  },
  {
    id: "cinema-008",
    theme: "cinema",
    question: "Dans Harry Potter, comment s'appelle le meilleur ami d'Harry ?",
    answers: ["Neville","Drago","Ron","Cedric"],
    correct: 2,
    difficulty: "easy",
  },
  {
    id: "cinema-009",
    theme: "cinema",
    question: "Quel film contient Pandora ?",
    answers: ["Avatar","Dune","Star Wars","Matrix"],
    correct: 0,
    difficulty: "easy",
  },
  {
    id: "cinema-010",
    theme: "cinema",
    question: "Quel acteur joue Wolverine ?",
    answers: ["Ryan Reynolds","Chris Pratt","Hugh Jackman","Tom Hardy"],
    correct: 2,
    difficulty: "medium",
  },
  {
    id: "cinema-011",
    theme: "cinema",
    question: "Quel studio a créé les films 'Le Voyage de Chihiro' et 'Mon Voisin Totoro' ?",
    answers: ["Pixar","Studio Ghibli","DreamWorks","Disney"],
    correct: 1,
    difficulty: "medium",
  },
  {
    id: "cinema-012",
    theme: "cinema",
    question: "Quel film de la saga 'Harry Potter' est le plus long ?",
    answers: ["Harry Potter et la Chambre des secrets","Harry Potter et le Prisonnier d'Azkaban","Harry Potter et le Prince de sang-mêlé","Harry Potter et les Reliques de la Mort"],
    correct: 0,
    difficulty: "hard",
  },
  {
    id: "cinema-014",
    theme: "cinema",
    question: "Quel acteur a joué dans 'The Matrix' ?",
    answers: ["Keanu Reeves","Tom Hanks","Brad Pitt","Johnny Depp"],
    correct: 0,
    difficulty: "medium",
  },
  {
    id: "cinema-015",
    theme: "cinema",
    question: "Quel film de la saga 'Star Wars' est le plus récent ?",
    answers: ["Star Wars: Episode VII - The Force Awakens","Star Wars: Episode VIII - The Last Jedi","Star Wars: Episode IX - The Rise of Skywalker","Star Wars: Episode I - The Phantom Menace"],
    correct: 2,
    difficulty: "medium",
  },
  {
    id: "cinema-016",
    theme: "cinema",
    question: "Quel film de la saga 'Harry Potter' est le plus récent ?",
    answers: ["Harry Potter et la Chambre des secrets","Harry Potter et le Prisonnier d'Azkaban","Harry Potter et le Prince de sang-mêlé","Harry Potter et les Reliques de la Mort"],
    correct: 3,
    difficulty: "medium",
  },
  {
    id: "cinema-017",
    theme: "cinema",
    question: "Quel film Pixar met en scène des émotions dans la tête d’une jeune fille ?",
    answers: ["Soul","Vice-Versa","Coco","Luca"],
    correct: 1,
    difficulty: "easy",
  },
  {
    id: "cinema-019",
    theme: "cinema",
    question: "Quel film Disney raconte l’histoire de Simba ?",
    answers: ["Aladdin","Le Roi Lion","Mulan","Tarzan"],
    correct: 1,
    difficulty: "easy",
  },
  {
    id: "cinema-022",
    theme: "cinema",
    question: "Quel dessin animé met en scène une famille jaune ?",
    answers: ["Family Guy","Les Simpson","South Park","Rick & Morty"],
    correct: 1,
    difficulty: "easy",
  },
  {
    id: "cinema-023",
    theme: "cinema",
    question: "Quel film d’animation met en scène un garçon nommé Miguel et la fête des morts ?",
    answers: ["Encanto","Coco","Vaiana","Soul"],
    correct: 1,
    difficulty: "medium",
  },
  {
    id: "cinema-025",
    theme: "cinema",
    question: "Quel film Pixar met en scène des voitures vivantes ?",
    answers: ["Cars","Toy Story","Finding Nemo","Ratatouille"],
    correct: 0,
    difficulty: "easy",
  },
  {
    id: "cinema-027",
    theme: "cinema",
    question: "Quel film d’animation met en scène un poisson clown nommé Marin ?",
    answers: ["Le Monde de Nemo","Shark Tale","Moana","Rio"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "cinema-028",
    theme: "cinema",
    question: "Qui a réalisé « Pulp Fiction » ?",
    answers: ["Martin Scorsese", "Stanley Kubrick", "Quentin Tarantino", "Ridley Scott"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "cinema-029",
    theme: "cinema",
    question: "Quel acteur incarne Jack Dawson dans « Titanic » ?",
    answers: ["Brad Pitt", "Matt Damon", "Leonardo DiCaprio", "Johnny Depp"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "cinema-030",
    theme: "cinema",
    question: "Dans « Le Seigneur des anneaux », comment s'appelle le porteur de l'Anneau ?",
    answers: ["Samsagace Gamegie", "Bilbon Sacquet", "Frodon Sacquet", "Aragorn"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "cinema-031",
    theme: "cinema",
    question: "Qui a réalisé « Le Parrain » (1972) ?",
    answers: ["Martin Scorsese", "Brian De Palma", "Sidney Lumet", "Francis Ford Coppola"],
    correct: 3,
    difficulty: "hard",
  },

  {
    id: "cinema-032",
    theme: "cinema",
    question: "Quel film a remporté la Palme d'or à Cannes en 2019 ?",
    answers: ["Once Upon a Time… in Hollywood", "Parasite", "Joker", "Roma"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "cinema-033",
    theme: "cinema",
    question: "Quel film d'animation met en scène un rat qui rêve de devenir cuisinier à Paris ?",
    answers: ["Les Aristochats", "Cars", "Ratatouille", "Rio"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "cinema-034",
    theme: "cinema",
    question: "Quel acteur joue le Joker dans « The Dark Knight » ?",
    answers: ["Joaquin Phoenix", "Jared Leto", "Heath Ledger", "Jack Nicholson"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "cinema-035",
    theme: "cinema",
    question: "Dans quel film Tom Hanks est-il naufragé sur une île avec un ballon nommé Wilson ?",
    answers: ["Forrest Gump", "Seul au monde", "La Ligne verte", "Il faut sauver le soldat Ryan"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "cinema-036",
    theme: "cinema",
    question: "Quel studio a produit « Toy Story », premier long-métrage entièrement en images de synthèse ?",
    answers: ["DreamWorks", "Pixar", "Illumination", "Blue Sky"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "cinema-037",
    theme: "cinema",
    question: "Quel film d'Alfred Hitchcock contient la célèbre scène de la douche ?",
    answers: ["Les Oiseaux", "Fenêtre sur cour", "Psychose", "Sueurs froides"],
    correct: 2,
    difficulty: "hard",
  },

  /* MUSIC */
  {
    id: "music-001",
    theme: "music",
    question: "Quel groupe a sorti l'album 'A Night at the Opera' ?",
    answers: ["ABBA", "Queen", "Coldplay", "U2"],
    correct: 1,
    difficulty: "medium",
  },
  
  {
    id: "music-002",
    theme: "music",
    question: "Quel groupe chante 'Bohemian Rhapsody' ?",
    answers: ["Queen","ABBA","Coldplay","Muse"],
    correct: 0,
    difficulty: "easy",
  },
  
  {
    id: "music-003",
    theme: "music",
    question: "Quel groupe a sorti l'album 'The Dark Side of the Moon' ?",
    answers: ["Pink Floyd","Led Zeppelin","The Beatles","Queen"],
    correct: 0,
    difficulty: "hard",
  },
  
  {
    id: "music-004",
    theme: "music",
    question: "Quel groupe a sorti l'album 'The Wall' ?",
    answers: ["Pink Floyd","Led Zeppelin","The Beatles","Queen"],
    correct: 0,
    difficulty: "medium",
  },
  
  {
    id: "music-005",
    theme: "music",
    question: "Combien de cordes possède une guitare classique ?",
    answers: ["5","6","7","8"],
    correct: 1,
    difficulty: "medium",
  },
  
  {
    id: "music-006",
    theme: "music",
    question: "Qui chante 'Shape of You' ?",
    answers: ["Ed Sheeran","Justin Bieber","Harry Styles","Shawn Mendes"],
    correct: 0,
    difficulty: "easy",
  },
  
  {
    id: "music-008",
    theme: "music",
    question: "Quel instrument possède 88 touches ?", 
    answers: ["Violon","Guitare","Piano","Harpe"],
    correct: 2,
    difficulty: "medium",
  },
  
  {
    id: "music-009",
    theme: "music",
    question: "Quel artiste est surnommé 'The King of Pop' ?",  
    answers: ["Michael Jackson","Elvis Presley","John Lennon","Jim Morrison"],
    correct: 0,
    difficulty: "easy",
  },
  
  {
    id: "music-010",
    theme: "music",
    question: "Quel groupe chante 'Yellow' ?",
    answers: ["Maroon 5","Imagine Dragons","U2","Coldplay"],
    correct: 3,
    difficulty: "hard",
  },
  
  {
    id: "music-007",
    theme: "music",
    question: "Quel style musical vient de Jamaïque ?",
    answers: ["Electro","Jazz","Rock","Reggae"],
    correct: 3,
    difficulty: "easy",
  },
  
  {
    id: "music-012",
    theme: "music",
    question: "Quel artiste chante 'Rolling in the Deep' ?",
    answers: ["Adele","Rihanna","Taylor Swift","Dua Lipa"],
    correct: 0,
    difficulty: "medium",
  },
  
  {
    id: "music-013",
    theme: "music",
    question: "Quel artiste chante 'Billie Jean' ?",
    answers: ["Michael Jackson","Elvis Presley","John Lennon","Jim Morrison"],
    correct: 0,
    difficulty: "easy",
  },
  
  {
    id: "music-014",
    theme: "music",
    question: "Quel artiste chante 'Imagine' ?",
    answers: ["Michael Jackson","Elvis Presley","Jim Morrison","John Lennon"],
    correct: 3,
    difficulty: "medium",
  },
  
  {
    id: "music-015",
    theme: "music",
    question: "Quel artiste chante 'Stairway to Heaven' ?",
    answers: ["John Lennon","Pink Floyd","Led Zeppelin","Jim Morrison"],
    correct: 2,
    difficulty: "medium",
  },
  
  {
    id: "music-016",
    theme: "music",
    question: "Combien de membres composent les Beatles ?",
    answers: ["1","2","3","4"],
    correct: 3,
    difficulty: "easy",
  },
  
  {
    id: "music-017",
    theme: "music",
    question: "Quel instrument souffle-t-on ?",
    answers: ["Guitare","Piano","Saxophone","Batterie"],
    correct: 2,
    difficulty: "easy",
  },
  
  {
    id: "music-018",
    theme: "music",
    question: "Quel artiste a sorti l’album 'After Hours' avec le titre 'Blinding Lights' ?",
    answers: ["The Weeknd","Drake","Post Malone","Travis Scott"],
    correct: 0,
    difficulty: "medium",
  },
  
  {
    id: "music-019",
    theme: "music",
    question: "Quel réseau social a explosé la carrière de nombreux sons viraux (ex : Lil Nas X) ?",
    answers: ["Facebook","TikTok","Twitter","Snapchat"],
    correct: 1,
    difficulty: "easy",
  },
  
  {
    id: "music-020",
    theme: "music",
    question: "Quel artiste est connu pour les albums 'Sour' et 'Guts' ?",
    answers: ["Billie Eilish","Olivia Rodrigo","Dua Lipa","Ariana Grande"],
    correct: 1,
    difficulty: "medium",
  },
  
  {
    id: "music-021",
    theme: "music",
    question: "Quel rappeur français est connu pour le morceau 'La danse des bandits' ?",
    answers: ["Ninho","PLK","Naps","Jul"],
    correct: 2,
    difficulty: "easy",
  },
  
  {
    id: "music-022",
    theme: "music",
    question: "Quel artiste est connu pour le morceau 'Levitating' ?",
    answers: ["Dua Lipa","Ariana Grande","Billie Eilish","Olivia Rodrigo"],
    correct: 0,
    difficulty: "easy",
  },
  
  {
    id: "music-023",
    theme: "music",
    question: "Quel artiste est connu pour les titres 'God's Plan' et 'One Dance' ?",
    answers: ["Drake","Kanye West","Lil Baby","Future"],
    correct: 0,
    difficulty: "medium",
  },
  
  {
    id: "music-024",
    theme: "music",
    question: "Quel style musical est associé à la scène 'trap' actuelle ?",
    answers: ["Jazz","Classique","Hip-hop","Reggae"],
    correct: 2,
    difficulty: "easy",
  },
  
  {
    id: "music-025",
    theme: "music",
    question: "Quel DJ français est derrière « Never Be Alone » avec Aloe Blacc ?",
    answers: ["David Guetta","DJ Snake","Martin Solveig","Madeon"],
    correct: 0,
    difficulty: "medium",
  },
  
  {
    id: "music-026",
    theme: "music",
    question: "Quel artiste est connu pour le morceau 'Don't Start Now' ?",
    answers: ["Dua Lipa","Ariana Grande","Billie Eilish","Olivia Rodrigo"],
    correct: 0,
    difficulty: "medium",
  },
  
  {
    id: "music-027",
    theme: "music",
    question: "Quel groupe K-pop est mondialement connu avec 'Dynamite' ?",
    answers: ["BLACKPINK","BTS","EXO","TWICE"],
    correct: 1,
    difficulty: "easy",
  },
  
  {
    id: "music-028",
    theme: "music",
    question: "Qui a sorti « Fade Up » avec Hamza et SCH en 2022 ?",
    answers: ["Zeg P","Soolking","Gazo","Ninho"],
    correct: 0,
    difficulty: "easy",
  },
  
  {
    id: "music-029",
    theme: "music",
    question: "Quel festival belge, créé en 2005 à Boom, accueille chaque été des centaines de milliers de fans d'électro ?",
    answers: ["Tomorrowland", "Sunburn", "Electric Daisy Carnival", "Creamfields"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "music-030",
    theme: "music",
    question: "Quel chanteur américain est surnommé « The Boss » ?",
    answers: ["Bob Dylan", "Billy Joel", "Bruce Springsteen", "Neil Young"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "music-031",
    theme: "music",
    question: "Quel groupe britannique a chanté « Wonderwall » ?",
    answers: ["Blur", "Oasis", "Radiohead", "Pulp"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "music-032",
    theme: "music",
    question: "Quelle chanteuse est surnommée « Queen B » ?",
    answers: ["Rihanna", "Lady Gaga", "Beyoncé", "Nicki Minaj"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "music-033",
    theme: "music",
    question: "Quel compositeur a écrit la 9e Symphonie et son « Ode à la joie » ?",
    answers: ["Mozart", "Bach", "Beethoven", "Vivaldi"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "music-034",
    theme: "music",
    question: "Quel chanteur est connu pour le titre « Papaoutai » ?",
    answers: ["Maître Gims", "Soprano", "Black M", "Stromae"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "music-035",
    theme: "music",
    question: "Quel groupe a sorti l'album « Nevermind » en 1991 ?",
    answers: ["Pearl Jam", "Soundgarden", "Nirvana", "Alice in Chains"],
    correct: 2,
    difficulty: "hard",
  },

  {
    id: "music-036",
    theme: "music",
    question: "Quel chanteur interprète « Uptown Funk » avec Mark Ronson ?",
    answers: ["Justin Timberlake", "Pharrell Williams", "Bruno Mars", "The Weeknd"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "music-037",
    theme: "music",
    question: "Quelle artiste a sorti l'album « Folklore » en 2020 ?",
    answers: ["Billie Eilish", "Taylor Swift", "Lorde", "Lana Del Rey"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "music-038",
    theme: "music",
    question: "Quel rappeur américain est surnommé « Hova » ?",
    answers: ["Nas", "Jay-Z", "Eminem", "50 Cent"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "music-039",
    theme: "music",
    question: "Quelle chanteuse québécoise est célèbre pour « My Heart Will Go On » ?",
    answers: ["Avril Lavigne", "Shania Twain", "Céline Dion", "Alanis Morissette"],
    correct: 2,
    difficulty: "easy",
  },

  /* GEOGRAPHYY */
  {
    id: "geography-001",
    theme: "geography",
    question: "Quelle est la capitale du Mexique ?",
    answers: ["Mexico", "Guadalajara", "Monterrey", "Tijuana"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "geography-002",
    theme: "geography",
    question: "Quelle est la capitale de la France ?",
    answers: ["Paris", "Lyon", "Marseille", "Nice"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "geography-003",
    theme: "geography",
    question: "Quel est le plus grand océan ?",
    answers: ["Atlantique","Pacifique","Indien","Arctique"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "geography-004",
    theme: "geography",
    question: "Quel désert est le plus grand du monde ?",
    answers: ["Sahara","Gobi","Antarctique","Mojave"],
    correct: 2,
    difficulty: "hard",
  },

  {
    id: "geography-005",
    theme: "geography",
    question: "Quel est le plus grand pays du monde ?",
    answers: ["Russie","Chine","États-Unis","Canada"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "geography-006",
    theme: "geography",
    question: "Le Mont Everest se trouve principalement dans quel pays ?",
    answers: ["Bhoutan","Chine","Inde","Népal"],
    correct: 3,
    difficulty: "medium",
  },

  {
    id: "geography-007",
    theme: "geography",
    question: "Quel est le plus grand pays d'Afrique par sa superficie ?",
    answers: ["Éthiopie","Algérie","Nigeria","Afrique du Sud"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "geography-008",
    theme: "geography",
    question: "Quel est le plus grand pays d'Amérique du Nord ?",
    answers: ["États-Unis","Canada","Mexique","Brésil"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "geography-009",
    theme: "geography",
    question: "Quel est le plus grand pays d'Europe ?",
    answers: ["Russie","France","Allemagne","Italie"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "geography-010",
    theme: "geography",
    question: "Quel est le plus grand pays entièrement situé en Asie ?",
    answers: ["Russie", "Chine", "Inde", "Japon"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "geography-011",
    theme: "geography",
    question: "Quel est le plus grand pays d'Océanie ?",
    answers: ["Australie","Nouvelle-Zélande","Indonésie","Philippines"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "geography-012",
    theme: "geography",
    question: "Quelle est la capitale de l’Italie ?",
    answers: ["Milan","Rome","Naples","Venise"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "geography-013",
    theme: "geography",
    question: "Quelle est la capitale de l’Allemagne ?",
    answers: ["Berlin","Munich","Hambourg","Francfort"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "geography-014",
    theme: "geography",
    question: "Quel océan borde la côte ouest de la France ?",
    answers: ["Océan Indien","Océan Atlantique","Océan Pacifique","Océan Arctique"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "geography-015",
    theme: "geography",
    question: "Quel est le plus grand pays d'Amérique du Sud ?",
    answers: ["Brésil","Argentine","Chili","Colombie"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "geography-016",
    theme: "geography",
    question: "Quel fleuve traverse Paris ?",
    answers: ["Rhône","Loire","Seine","Garonne"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "geography-017",
    theme: "geography",
    question: "Combien y a-t-il de continents sur Terre ?",
    answers: ["5","6","7","8"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "geography-018",
    theme: "geography",
    question: "Quelle est la capitale de l’Australie ?",
    answers: ["Sydney","Melbourne","Canberra","Perth"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "geography-019",
    theme: "geography",
    question: "Quel pays est surnommé le pays du Soleil Levant ?",
    answers: ["Chine","Japon","Inde","Corée"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "geography-020",
    theme: "geography",
    question: "Quel est le plus haut sommet du monde ?",
    answers: ["Mont Blanc","Kilimandjaro","Everest","K2"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "geography-021",
    theme: "geography",
    question: "Quelle mer borde le sud de la France ?",
    answers: ["Mer du Nord","Mer Noire","Mer Méditerranée","Mer Rouge"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "geography-022",
    theme: "geography",
    question: "Quel pays possède la plus grande population au monde ?",
    answers: ["Inde","États-Unis","Chine","Brésil"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "geography-023",
    theme: "geography",
    question: "Quelle chaîne de montagnes sépare la France de l’Espagne ?",
    answers: ["Alpes","Pyrénées","Carpates","Andes"],
    correct: 1,
    difficulty: "easy",
  },


  {
    id: "geography-024",
    theme: "geography",
    question: "Quelle est la capitale du Canada ?",
    answers: ["Toronto", "Montréal", "Ottawa", "Vancouver"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "geography-025",
    theme: "geography",
    question: "Quel est le plus long fleuve de France ?",
    answers: ["La Seine", "Le Rhône", "La Loire", "La Garonne"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "geography-026",
    theme: "geography",
    question: "Quelle est la capitale de la Turquie ?",
    answers: ["Istanbul", "Ankara", "Izmir", "Antalya"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "geography-027",
    theme: "geography",
    question: "De quel pays Buenos Aires est-elle la capitale ?",
    answers: ["Chili", "Uruguay", "Argentine", "Paraguay"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "geography-028",
    theme: "geography",
    question: "Quel est le plus haut sommet des Alpes ?",
    answers: ["Le Cervin", "Le Mont Blanc", "Le Mont Rose", "L'Eiger"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "geography-029",
    theme: "geography",
    question: "Quel pays est entièrement enclavé à l'intérieur de l'Afrique du Sud ?",
    answers: ["Eswatini", "Lesotho", "Botswana", "Namibie"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "geography-030",
    theme: "geography",
    question: "Quel fleuve traverse Le Caire ?",
    answers: ["Le Congo", "Le Niger", "Le Nil", "Le Zambèze"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "geography-031",
    theme: "geography",
    question: "Quelle est la capitale de la Suisse ?",
    answers: ["Zurich", "Genève", "Berne", "Bâle"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "geography-032",
    theme: "geography",
    question: "Quel détroit sépare l'Espagne du Maroc ?",
    answers: ["Le Bosphore", "Le détroit de Gibraltar", "Le canal de Suez", "Le détroit de Magellan"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "geography-033",
    theme: "geography",
    question: "Dans quel pays se trouve le site du Machu Picchu ?",
    answers: ["Bolivie", "Colombie", "Pérou", "Équateur"],
    correct: 2,
    difficulty: "medium",
  },

  /* SPORT */
  {
    id: "sport-001",
    theme: "sport",
    question: "Dans quel sport remporte-t-on la Coupe Stanley ?",
    answers: ["Basketball", "Baseball", "Rugby", "Hockey sur glace"],
    correct: 3,
    difficulty: "medium",
  },

  {
    id: "sport-003",
    theme: "sport",
    question: "Combien de joueurs dans une équipe de football sur le terrain ?",
    answers: ["9","10","11","12"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "sport-004",
    theme: "sport",
    question: "Quel sport pratique Carlos Alcaraz ?",
    answers: ["Football","Tennis","Golf","Basket"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "sport-005",
    theme: "sport",
    question: "Combien de points vaut un panier classique au basket ?",
    answers: ["1","2","3","4"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "sport-006",
    theme: "sport",
    question: "Quel pays a gagné la Coupe du Monde de football 2018 ?",
    answers: ["France","Brésil","Allemagne","Argentine"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "sport-007",
    theme: "sport",
    question: "Quel sport utilise un volant ?",
    answers: ["Tennis","Ping-pong","Badminton","Squash"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "sport-008",
    theme: "sport",
    question: "Combien de joueurs dans une équipe de basket ?",
    answers: ["4","5","6","7"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "sport-027",
    theme: "sport",
    question: "Quel sport se joue à Roland-Garros ?",
    answers: ["Football","Golf","Tennis","Rugby"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "sport-009",
    theme: "sport",
    question: "Quel sport pratique Usain Bolt ?",
    answers: ["Cyclisme","Athlétisme","Natation","Boxe"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "sport-010",
    theme: "sport",
    question: "Quel sport est pratiqué sur une table rectangulaire avec des raquettes ?",
    answers: ["Tennis","Badminton","Volley-ball","Tennis de table"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "sport-011",
    theme: "sport",
    question: "Quel sport utilise un ballon ovale ?",
    answers: ["Football","Basketball","Rugby","Hockey"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "sport-012",
    theme: "sport",
    question: "Quel sport est pratiqué sur une piste circulaire avec des vélos ?",
    answers: ["Cyclisme","Athlétisme","Natation","Boxe"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "sport-013",
    theme: "sport",
    question: "Quelle discipline se pratique en marchant avec des bâtons ?",
    answers: ["Sprint", "Marche nordique", "Saut en hauteur", "Saut en longueur"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "sport-014",
    theme: "sport",
    question: "Dans quel sport peut-on réaliser un 'hole in one' ?",
    answers: ["Golf","Tennis","Basket","Rugby"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "sport-015",
    theme: "sport",
    question: "Combien de manches minimum faut-il gagner pour remporter un match de tennis en Grand Chelem masculin ?",
    answers: ["2","3","4","5"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "sport-016",
    theme: "sport",
    question: "Combien de joueurs dans une équipe de rugby ?",
    answers: ["15","16","17","18"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "sport-017",
    theme: "sport",
    question: "Quel sport est associé à la NBA ?",
    answers: ["Football","Basketball","Tennis","Golf"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "sport-018",
    theme: "sport",
    question: "Quel sport est pratiqué sur une piste circulaire avec des voitures ?",
    answers: ["Cyclisme","Athlétisme","Natation","Formule 1"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "sport-019",
    theme: "sport",
    question: "Dans quel sport utilise-t-on des gants et un ring ?",
    answers: ["Lutte","Boxe","Judo","MMA"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "sport-020",
    theme: "sport",
    question: "Quel pays est connu pour le sumo ?",
    answers: ["Chine","Japon","Corée","Thaïlande"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "sport-022",
    theme: "sport",
    question: "Dans quel sport peut-on marquer un essai ?",
    answers: ["Rugby","Football","Tennis","Basket"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "sport-023",
    theme: "sport",
    question: "Quel pays est connu pour avoir inventé le football moderne ?",
    answers: ["France","Angleterre","Brésil","Italie"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "sport-024",
    theme: "sport",
    question: "Dans quel sport joue-t-on sur un court en terre battue, en gazon ou en dur ?",
    answers: ["Basket", "Tennis", "Football", "Rugby"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "sport-025",
    theme: "sport",
    question: "Quel sport est basé sur des figures artistiques sur glace ?",
    answers: ["Hockey sur glace","Patinage artistique","Curling","Basketball"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "sport-026",
    theme: "sport",
    question: "Dans quel sport marque-t-on un « strike » en renversant les 10 quilles d'un seul lancer ?",
    answers: ["Golf", "Bowling", "Tennis", "Rugby"],
    correct: 1,
    difficulty: "easy",
  },


  {
    id: "sport-028",
    theme: "sport",
    question: "Quel pays a accueilli les Jeux olympiques d'été de 2016 ?",
    answers: ["Chine", "Royaume-Uni", "Brésil", "Japon"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "sport-029",
    theme: "sport",
    question: "Quel tennisman est surnommé « le Roi de la terre battue » ?",
    answers: ["Roger Federer", "Rafael Nadal", "Novak Djokovic", "Andy Murray"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "sport-030",
    theme: "sport",
    question: "Combien de joueurs une équipe de volley-ball aligne-t-elle sur le terrain ?",
    answers: ["5", "6", "7", "8"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "sport-031",
    theme: "sport",
    question: "Quelle est la distance officielle d'un marathon ?",
    answers: ["38,195 km", "40 km", "42,195 km", "45 km"],
    correct: 2,
    difficulty: "hard",
  },

  {
    id: "sport-032",
    theme: "sport",
    question: "Quel pays a remporté la Coupe du monde de football en 2014 ?",
    answers: ["Argentine", "Pays-Bas", "Allemagne", "Brésil"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "sport-033",
    theme: "sport",
    question: "Quel club de football est surnommé « les Merengues » ?",
    answers: ["FC Barcelone", "Atlético de Madrid", "Real Madrid", "FC Valence"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "sport-034",
    theme: "sport",
    question: "Combien de titres de champion du monde de Formule 1 Michael Schumacher a-t-il remportés ?",
    answers: ["5", "6", "7", "8"],
    correct: 2,
    difficulty: "hard",
  },

  {
    id: "sport-035",
    theme: "sport",
    question: "Quelle ville a accueilli les Jeux olympiques d'été de 2024 ?",
    answers: ["Los Angeles", "Tokyo", "Paris", "Londres"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "sport-036",
    theme: "sport",
    question: "Combien de points rapporte un essai transformé au rugby à XV ?",
    answers: ["5", "6", "7", "8"],
    correct: 2,
    difficulty: "hard",
  },

  {
    id: "sport-037",
    theme: "sport",
    question: "Combien de joueurs par équipe (gardien compris) sont sur la glace au hockey ?",
    answers: ["5", "6", "7", "8"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "sport-038",
    theme: "sport",
    question: "Quel tournoi du Grand Chelem se joue sur gazon à Londres ?",
    answers: ["Roland-Garros", "US Open", "Wimbledon", "Open d'Australie"],
    correct: 2,
    difficulty: "medium",
  },

  /* VIDEOGAMES */
  {
    id: "videogames-001",
    theme: "videogames",
    question: "Quel studio a créé la saga 'The Legend of Zelda' ?",
    answers: ["Capcom", "Sega", "Nintendo", "Square Enix"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "videogames-002",
    theme: "videogames",
    question: "Quel plombier célèbre porte une casquette rouge ?",
    answers: ["Sonic","Mario","Crash Bandicoot","Link"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "videogames-003",
    theme: "videogames",
    question: "Dans Minecraft, quel matériau faut-il principalement pour fabriquer une pioche en pierre ?",
    answers: ["Diamant","Bois","Pierre","Fer"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "videogames-005",
    theme: "videogames",
    question: "Dans Fortnite, combien de joueurs participent généralement à une partie Battle Royale ?",
    answers: ["100","50","10","200"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "videogames-006",
    theme: "videogames",
    question: "Quel personnage est la mascotte de Sega ?",
    answers: ["Mario","Kirby","Sonic","Pikachu"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "videogames-007",
    theme: "videogames",
    question: "Dans Pokémon, quel Pokémon est le plus connu comme mascotte ?",
    answers: ["Salamèche","Pikachu","Dracaufeu","Bulbizarre"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "videogames-008",
    theme: "videogames",
    question: "Quel jeu consiste principalement à construire avec des blocs ?",
    answers: ["Valorant","Minecraft","Rocket League","FIFA"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "videogames-009",
    theme: "videogames",
    question: "Dans Mario Kart, quel objet permet souvent d'aller plus vite ?",
    answers: ["Banane","Carapace rouge","Champignon","Bob-omb"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "videogames-010",
    theme: "videogames",
    question: "Quel jeu populaire oppose Terroristes et Antiterroristes ?",
    answers: ["Overwatch","Counter-Strike","Minecraft","Among Us"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "videogames-011",
    theme: "videogames",
    question: "Quel jeu est connu pour son mode 'Battle Royale' avec des constructions ?",
    answers: ["Valorant","League of Legends","Fortnite","Rocket League"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "videogames-012",
    theme: "videogames",
    question: "Dans Among Us, quel est le rôle secret du joueur qui sabote ?",
    answers: ["Ingénieur","Imposteur","Capitaine","Détective"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "videogames-013",
    theme: "videogames",
    question: "Dans League of Legends, combien de joueurs sont dans une équipe classique ?",
    answers: ["3","4","5","6"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "videogames-014",
    theme: "videogames",
    question: "Quel studio a développé Grand Theft Auto (GTA) ?",
    answers: ["Ubisoft","Rockstar Games","EA","Bethesda"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "videogames-015",
    theme: "videogames",
    question: "Quel est le type de jeu d'Animal Crossing ?",
    answers: ["Survie","Simulation de vie","FPS","Course"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "videogames-016",
    theme: "videogames",
    question: "Quel jeu est connu pour la phrase 'Finish Him!' ?",
    answers: ["Street Fighter","Mortal Kombat","Tekken","Soulcalibur"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "videogames-017",
    theme: "videogames",
    question: "Dans Pokémon, quel type est super efficace contre le type Eau ?",
    answers: ["Feu","Combat","Normal","Électrique"],
    correct: 3,
    difficulty: "medium",
  },

  {
    id: "videogames-018",
    theme: "videogames",
    question: "À quel sport joue-t-on dans FIFA ?",
    answers: ["Football","Basketball","Tennis","Golf"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "videogames-019",
    theme: "videogames",
    question: "Quel est le studio qui a développé 'The Witcher' ?",
    answers: ["CD Projekt Red","EA","Ubisoft","Rockstar Games"],
    correct: 0,
    difficulty: "hard",
  },

  {
    id: "videogames-020",
    theme: "videogames",
    question: "Quel jeu est célèbre pour le personnage Kratos ?",
    answers: ["God of War","Hades","Dark Souls","Skyrim"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "videogames-021",
    theme: "videogames",
    question: "Quel jeu est un FPS compétitif avec des agents comme Jett et Phoenix ?",
    answers: ["Overwatch","Valorant","CS:GO","Apex Legends"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "videogames-022",
    theme: "videogames",
    question: "Dans Call of Duty, quel mode est basé sur la survie contre des vagues d’ennemis ?",
    answers: ["Campagne","Zombie","Battle Royale","Domination"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "videogames-023",
    theme: "videogames",
    question: "Quel jeu propose un monde ouvert médiéval avec dragons et magie ?",
    answers: ["Skyrim","GTA V","Cyberpunk 2077","Minecraft"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "videogames-024",
    theme: "videogames",
    question: "Quel studio a développé la série « Dark Souls » ?",
    answers: ["Capcom", "FromSoftware", "Konami", "Square Enix"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "videogames-025",
    theme: "videogames",
    question: "Dans « The Legend of Zelda », comment s'appelle le héros que l'on incarne ?",
    answers: ["Zelda", "Ganon", "Link", "Epona"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "videogames-026",
    theme: "videogames",
    question: "Dans Minecraft, quel monstre explose lorsqu'il s'approche du joueur ?",
    answers: ["Le zombie", "Le squelette", "Le creeper", "L'enderman"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "videogames-027",
    theme: "videogames",
    question: "Quel jeu de 2013 permet d'incarner Michael, Franklin et Trevor ?",
    answers: ["Red Dead Redemption", "GTA IV", "GTA V", "Watch Dogs"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "videogames-028",
    theme: "videogames",
    question: "Quelle console Nintendo est sortie en mars 2017 ?",
    answers: ["Wii U", "Switch", "3DS", "GameCube"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "videogames-029",
    theme: "videogames",
    question: "Dans Pac-Man, que doit manger Pac-Man pour pouvoir croquer les fantômes ?",
    answers: ["Des cerises", "Des super pastilles", "Des champignons", "Des étoiles"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "videogames-030",
    theme: "videogames",
    question: "Quelle entreprise a créé « Fortnite » ?",
    answers: ["Valve", "Riot Games", "Epic Games", "Activision"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "videogames-031",
    theme: "videogames",
    question: "Dans l'univers de Mario, comment s'appelle le frère de Mario ?",
    answers: ["Wario", "Toad", "Luigi", "Yoshi"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "videogames-032",
    theme: "videogames",
    question: "Dans quel jeu rencontre-t-on l'intelligence artificielle GLaDOS ?",
    answers: ["Half-Life", "Portal", "BioShock", "Doom"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "videogames-033",
    theme: "videogames",
    question: "Quel jeu se déroule sur la carte « Faille de l'invocateur » ?",
    answers: ["Dota 2", "Heroes of the Storm", "League of Legends", "Smite"],
    correct: 2,
    difficulty: "medium",
  },

  /* SÉRIES / ANIMÉS */
  {
    id: "series-001",
    theme: "series",
    question: "Dans 'Breaking Bad', quel est le surnom de Walter White ?",
    answers: ["Heisenberg", "Saul Good", "El Camino", "Blue Sky"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "series-002",
    theme: "series",
    question: "Dans Friends, comment s'appelle le singe de Ross ?",
    answers: ["Joey","Marcel","Ben","Mike"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "series-003",
    theme: "series",
    question: "Dans 'The Big Bang Theory', quel est le nom du personnage principal ?",
    answers: ["Sheldon Cooper","Leonard Hofstadter","Howard Wolowitz","Penny"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "series-004",
    theme: "series",
    question: "Dans 'The Office', quel est le nom du directeur ?",
    answers: ["Pam Beesly","Jim Halpert","Dwight Schrute","Michael Scott"],
    correct: 3,
    difficulty: "hard",
  },

  {
    id: "series-005",
    theme: "series",
    question: "Dans 'The Simpsons', comment s'appelle le père de Homer ?",
    answers: ["Ned Flanders","Herbert Powell","Abraham Simpson","Barney Gumble"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "series-006",
    theme: "series",
    question: "Dans 'The Walking Dead', quel est le nom du personnage principal ?",
    answers: ["Rick Grimes","Daryl Dixon","Michonne","Negan"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "series-007",
    theme: "series",
    question: "Dans Stranger Things, comment s'appelle la fille aux pouvoirs télékinésiques ?",
    answers: ["Dustin Henderson","Mike Wheeler","Eleven","Lucas Sinclair"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "series-008",
    theme: "series",
    question: "Dans « Game of Thrones », quelle maison a pour emblème un dragon à trois têtes ?",
    answers: ["Stark", "Lannister", "Targaryen", "Baratheon"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "series-009",
    theme: "series",
    question: "Quelle série contient le personnage Walter White ?",
    answers: ["Narcos","Breaking Bad","The Office","Lost"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "series-010",
    theme: "series",
    question: "Dans Game of Thrones, quelle famille possède le loup comme symbole ?",
    answers: ["Lannister","Targaryen","Stark","Baratheon"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "series-011",
    theme: "series",
    question: "Quelle série se déroule principalement dans une entreprise de papier ?",
    answers: ["Brooklyn Nine-Nine","The Office","How I Met Your Mother","Friends"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "series-012",
    theme: "series",
    question: "Dans How I Met Your Mother, qui raconte l'histoire ?",
    answers: ["Marshall","Barney","Ted","Robin"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "series-013",
    theme: "series",
    question: "Quel personnage de Friends est connu pour dire 'How you doin?'",
    answers: ["Ross","Joey","Chandler","Monica"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "series-014",
    theme: "series",
    question: "Quelle série met en scène les Shelby ?",
    answers: ["Narcos","Peaky Blinders","Suits","Vikings"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "series-016",
    theme: "series",
    question: "Quelle émission de télé-réalité a lancé la famille Kardashian en 2007 ?",
    answers: ["The Kardashians", "Keeping Up with the Kardashians", "Kourtney and Kim Take New York", "Kourtney and Khloe Take Miami"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "series-017",
    theme: "series",
    question: "Dans Stranger Things, quelle ville est le cadre principal de la série ?",
    answers: ["Hawkins","Riverdale","Springfield","Sunnydale"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "series-018",
    theme: "series",
    question: "Dans Friends, combien de personnages principaux composent le groupe ?",
    answers: ["5","6","7","8"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "series-019",
    theme: "series",
    question: "Dans La Casa de Papel, quel est le surnom du leader du braquage ?",
    answers: ["Berlin","Tokyo","Le Professeur","Denver"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "series-020",
    theme: "series",
    question: "Dans The Crown, quel est le nom de la reine ?",
    answers: ["Elizabeth II","Elizabeth I","Anne","Mary"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "series-021",
    theme: "series",
    question: "Dans Squid Game, quel numéro porte le joueur principal ?",
    answers: ["001","067","456","218"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "series-022",
    theme: "series",
    question: "Dans Vikings, quel explorateur est un personnage principal ?",
    answers: ["Ragnar Lothbrok","Marco Polo","Erik le Rouge","William le Conquérant"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "series-024",
    theme: "series",
    question: "Dans « Friends », quel est le métier de Monica Geller ?",
    answers: ["Actrice", "Chef cuisinière", "Journaliste", "Styliste"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "series-025",
    theme: "series",
    question: "Dans « Game of Thrones », quelle est la devise de la maison Stark ?",
    answers: ["La nuit est sombre", "L'hiver vient", "Nous ne semons pas", "Feu et sang"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "series-026",
    theme: "series",
    question: "Dans « Breaking Bad », quel est le métier de Walter White au début de la série ?",
    answers: ["Pharmacien", "Médecin", "Professeur de chimie", "Mécanicien"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "series-027",
    theme: "series",
    question: "Quelle série met en scène les policiers du 99e commissariat de Brooklyn, dirigés par le capitaine Holt ?",
    answers: ["The Office", "Brooklyn Nine-Nine", "Parks and Recreation", "Superstore"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "series-028",
    theme: "series",
    question: "Dans « The Mandalorian », comment s'appelle « l'Enfant » ?",
    answers: ["Yoda", "Grogu", "Ahsoka", "Kanan"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "series-029",
    theme: "series",
    question: "Dans « Squid Game », quel jeu d'enfant ouvre la compétition ?",
    answers: ["Les billes", "1, 2, 3, soleil", "Le tir à la corde", "Le pont de verre"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "series-030",
    theme: "series",
    question: "Dans la première partie de « La Casa de Papel », quel lieu les braqueurs attaquent-ils ?",
    answers: ["La Banque d'Espagne", "La Fabrique nationale de la monnaie et du timbre", "Le musée du Prado", "Le Parlement espagnol"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "series-031",
    theme: "series",
    question: "Dans « Les Simpson », comment s'appelle le bar où Homer retrouve ses amis ?",
    answers: ["Le Kwik-E-Mart", "Le Krusty Burger", "Le Duff", "Chez Moe"],
    correct: 3,
    difficulty: "medium",
  },

  {
    id: "series-032",
    theme: "series",
    question: "Quel acteur joue Assane Diop dans la série « Lupin » ?",
    answers: ["Jamel Debbouze", "Omar Sy", "Franck Dubosc", "Dany Boon"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "series-033",
    theme: "series",
    question: "Dans « Dexter », quel est le métier de Dexter Morgan à la police de Miami ?",
    answers: ["Médecin légiste", "Expert en traces de sang", "Avocat", "Journaliste"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "series-034",
    theme: "series",
    question: "Dans Dragon Ball Z, comment s'appelle la transformation la plus connue de Goku ?",
    answers: ["Bankai","Titan","Super Saiyan","Gear 5"],
    correct: 2,
    difficulty: "hard",
  },

  {
    id: "series-035",
    theme: "series",
    question: "Dans Naruto, quel est le rêve de Naruto ?",
    answers: ["Devenir Hokage","Devenir pirate","Devenir samouraï","Devenir ninja légendaire"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "series-036",
    theme: "series",
    question: "Dans One Piece, comment s’appelle le capitaine de l’équipage ?",
    answers: ["Luffy","Zoro","Sanji","Nami"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "series-037",
    theme: "series",
    question: "Dans Attack on Titan, que sont les Titans ?",
    answers: ["Des robots","Des humains géants","Des démons marins","Des aliens"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "series-038",
    theme: "series",
    question: "Dans Death Note, quel objet permet de tuer quelqu’un en écrivant son nom ?",
    answers: ["Un sabre","Un carnet","Une bague","Un livre magique"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "series-039",
    theme: "series",
    question: "Dans Demon Slayer, quel est le nom du sabre utilisé ?",
    answers: ["Katana classique","Nichirin","Chidori","Bankai"],
    correct: 1,
    difficulty: "hard",
  },

  /* FOOD */
  {
    id: "food-001",
    theme: "food",
    question: "Quel fromage est traditionnellement utilisé dans une salade grecque ?",
    answers: ["Feta", "Mozzarella", "Cheddar", "Comté"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "food-002",
    theme: "food",
    question: "Quel pays est à l'origine des sushis ?",
    answers: ["Corée","Japon","Chine","Thaïlande"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "food-003",
    theme: "food",
    question: "Quel fromage est traditionnellement utilisé dans une raclette ?",
    answers: ["Camembert","Comté","Raclette","Mozzarella"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "food-004",
    theme: "food",
    question: "Quel ingrédient principal compose le guacamole ?",
    answers: ["Tomate","Avocat","Poivron","Concombre"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "food-005",
    theme: "food",
    question: "Quel aliment est connu pour être riche en fer ?",
    answers: ["Pois chiches","Tomates","Pommes de terre","Bananes"],
    correct: 0,
    difficulty: "hard",
  },

  {
    id: "food-006",
    theme: "food",
    question: "Quel fruit est connu pour être riche en potassium ?",
    answers: ["Pommes","Bananes","Poires","Fraises"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "food-007",
    theme: "food",
    question: "Quel aliment est connu pour être riche en vitamine C ?",
    answers: ["Pommes","Bananes","Poires","Fraises"],
    correct: 3,
    difficulty: "hard",
  },

  {
    id: "food-008",
    theme: "food",
    question: "Quelle boisson est fabriquée à partir de grains torréfiés ?",
    answers: ["Thé","Chocolat chaud","Café","Jus d'orange"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "food-009",
    theme: "food",
    question: "Quel fruit est souvent considéré comme un légume ?",
    answers: ["Pomme","Tomate","Poire","Banane"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "food-010",
    theme: "food",
    question: "Quel aliment est indispensable dans une omelette classique ?",
    answers: ["Farine","Pâtes","Riz","Œufs"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "food-011",
    theme: "food",
    question: "De quoi est principalement composé le houmous ?",
    answers: ["Pommes de terre","Lentilles","Pois chiches","Haricots rouges"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "food-012",
    theme: "food",
    question: "Quel pays est célèbre pour ses tacos ?",
    answers: ["Espagne","Mexique","Brésil","Argentine"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "food-013",
    theme: "food",
    question: "Quel ingrédient donne sa couleur principale au pesto vert ?",
    answers: ["Menthe","Basilic","Persil","Coriandre"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "food-014",
    theme: "food",
    question: "Quel aliment est utilisé pour faire des frites classiques ?",
    answers: ["Patate douce","Pomme de terre","Navet","Carotte"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "food-015",
    theme: "food",
    question: "Quelle sauce accompagne traditionnellement les pâtes carbonara italiennes authentiques ?",
    answers: ["Pesto","Aucune des trois, enfin !","Beurre","Crème"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "food-016",
    theme: "food",
    question: "Quel aliment est traditionnellement utilisé pour faire du popcorn ?",
    answers: ["Maïs","Pomme de terre","Navet","Carotte"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "food-017",
    theme: "food",
    question: "Quel fromage est souvent utilisé sur une pizza margherita ?",
    answers: ["Brie","Mozzarella","Comté","Roquefort"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "food-018",
    theme: "food",
    question: "Quel ingrédient principal compose les sushis ?",
    answers: ["Pommes de terre","Pâtes","Pain","Riz"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "food-019",
    theme: "food",
    question: "Quel pays est célèbre pour ses gaufres ?",
    answers: ["Suisse","France","Belgique","Allemagne"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "food-020",
    theme: "food",
    question: "Quel pays est célèbre pour ses crêpes ?",
    answers: ["France","Belgique","Suisse","Allemagne"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "food-021",
    theme: "food",
    question: "Quel aliment est traditionnellement utilisé pour faire des lasagnes ?",
    answers: ["Pâtes","Pomme de terre","Navet","Carotte"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "food-022",
    theme: "food",
    question: "Quel fruit sec est souvent utilisé dans le Nutella ?",
    answers: ["Noisette","Amande","Noix","Pistache"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "food-023",
    theme: "food",
    question: "Quelle viande est utilisée dans un jambon classique ?",
    answers: ["Bœuf","Porc","Poulet","Agneau"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "food-024",
    theme: "food",
    question: "Quel aliment est obtenu en faisant fermenter du lait ?",
    answers: ["Yaourt","Pain","Compote","Confiture"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "food-025",
    theme: "food",
    question: "Quel fruit est souvent associé à la tarte tatin ?",
    answers: ["Fraise","Poire","Cerise","Pomme"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "food-026",
    theme: "food",
    question: "De quel pays vient le parmesan (Parmigiano Reggiano) ?",
    answers: ["France", "Suisse", "Italie", "Espagne"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "food-027",
    theme: "food",
    question: "Quelle épice est généralement considérée comme la plus chère au monde ?",
    answers: ["La vanille", "Le safran", "La cannelle", "La cardamome"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "food-028",
    theme: "food",
    question: "De quel pays vient la paella ?",
    answers: ["Portugal", "Italie", "Espagne", "Mexique"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "food-029",
    theme: "food",
    question: "De quel pays vient le kimchi ?",
    answers: ["Japon", "Chine", "Corée", "Vietnam"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "food-030",
    theme: "food",
    question: "Quel produit laitier est la base du tzatziki ?",
    answers: ["La feta", "Le yaourt", "La crème fraîche", "Le lait de coco"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "food-031",
    theme: "food",
    question: "La vanille est issue d'une plante de quelle famille ?",
    answers: ["Les palmiers", "Les orchidées", "Les cactus", "Les fougères"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "food-032",
    theme: "food",
    question: "Quel pain plat est traditionnellement cuit dans un four tandoor ?",
    answers: ["Le pita", "La tortilla", "Le naan", "La focaccia"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "food-033",
    theme: "food",
    question: "Quel fromage bleu français est fabriqué avec du lait de brebis ?",
    answers: ["Le comté", "Le roquefort", "Le reblochon", "Le munster"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "food-034",
    theme: "food",
    question: "Quel pays est à l'origine du cocktail mojito ?",
    answers: ["Mexique", "Cuba", "Brésil", "Porto Rico"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "food-035",
    theme: "food",
    question: "Que signifie « al dente » pour des pâtes ?",
    answers: ["Très cuites", "Cuites mais encore fermes sous la dent", "Cuites au four", "Cuites sans sel"],
    correct: 1,
    difficulty: "medium",
  },

  /* GENERAL */
  {
    id: "general-001",
    theme: "general",
    question: "Combien de continents compte la Terre ?",
    answers: ["5", "6", "7", "8"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "general-002",
    theme: "general",
    question: "Combien de jours compte une semaine ?",
    answers: ["6", "7", "8", "9"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-003",
    theme: "general",
    question: "Combien de lettres compte l'alphabet ?",
    answers: ["26", "27", "28", "29"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "general-004",
    theme: "general",
    question: "Combien de planètes compte le système solaire ?",
    answers: ["8", "9", "10", "11"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "general-005",
    theme: "general",
    question: "Combien y a-t-il de jours dans une année bissextile ?",
    answers: ["365","366","367","364"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-006",
    theme: "general",
    question: "Quelle planète est la plus proche du Soleil ?",
    answers: ["Terre","Mars","Vénus","Mercure"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "general-007",
    theme: "general",
    question: "Combien de côtés possède un hexagone ?",
    answers: ["5","6","7","8"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-008",
    theme: "general",
    question: "Quel est le plus grand continent du monde ?",
    answers: ["Europe","Asie","Afrique","Amérique"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-009",
    theme: "general",
    question: "Quel est le plus petit continent du monde ?",
    answers: ["Europe","Asie","Afrique","Océanie"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "general-010",
    theme: "general",
    question: "Quel animal est surnommé le roi de la jungle ?",
    answers: ["Tigre","Lion","Éléphant","Panthère"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-011",
    theme: "general",
    question: "Quel pays est célèbre pour ses pâtes ?",
    answers: ["Italie","France","Espagne","Portugal"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "general-012",
    theme: "general",
    question: "Quelle couleur obtient-on avec du bleu et du jaune ?",
    answers: ["Rouge","Vert","Orange","Violet"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-013",
    theme: "general",
    question: "Quel est le plus grand océan du monde ?",
    answers: ["Atlantique","Pacifique","Indien","Arctique"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-014",
    theme: "general",
    question: "Quel est le plus grand mammifère du monde ?",
    answers: ["Éléphant","Baleine bleue","Girafe","Orque"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-016",
    theme: "general",
    question: "Quelle saison vient après le printemps ?",
    answers: ["Automne","Été","Hiver","Aucune"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-017",
    theme: "general",
    question: "Quel métal précieux est jaune ?",
    answers: ["Cuivre","Platine","Argent","Or"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "general-018",
    theme: "general",
    question: "Sur le pavé numérique d'un ordinateur, quel chiffre se trouve au-dessus du 6 ?",
    answers: ["7","8","9","4"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "general-019",
    theme: "general",
    question: "Quel pays a attaqué Pearl Harbor en décembre 1941 ?",
    answers: ["Russie","Canada","Chine","Japon"],
    correct: 3,
    difficulty: "hard",
  },

  {
    id: "general-020",
    theme: "general",
    question: "Quelle romancière britannique a créé l'école de Poudlard ?",
    answers: ["J.K. Rowling","Suzanne Collins","George R.R. Martin","Stephenie Meyer"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "general-021",
    theme: "general",
    question: "Quelle figure de style correspond à l'expression : monter en haut ?",
    answers: ["Personnification","Métaphore","Pléonasme","Allitération"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "general-022",
    theme: "general",
    question: "Quel est le plus grand lac d'eau douce du monde par sa superficie ?",
    answers: ["Lac Supérieur","Lac Tanganyika","Lac Victoria","Lac Baïkal"],
    correct: 0,
    difficulty: "hard",
  },

  {
    id: "general-023",
    theme: "general",
    question: "Quel est le symbole chimique de l'or ?",
    answers: ["Ag", "Au", "Or", "Fe"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "general-024",
    theme: "general",
    question: "Qui a peint « La Joconde » ?",
    answers: ["Michel-Ange", "Raphaël", "Léonard de Vinci", "Botticelli"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "general-025",
    theme: "general",
    question: "En quelle année l'être humain a-t-il posé le pied sur la Lune pour la première fois ?",
    answers: ["1965", "1969", "1972", "1975"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "general-026",
    theme: "general",
    question: "Quel élément chimique a pour symbole O ?",
    answers: ["L'or", "L'osmium", "L'oxygène", "L'oganesson"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "general-027",
    theme: "general",
    question: "Quel physicien est connu pour la théorie de la relativité ?",
    answers: ["Isaac Newton", "Albert Einstein", "Niels Bohr", "Stephen Hawking"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "general-028",
    theme: "general",
    question: "Combien d'os compte le squelette d'un adulte ?",
    answers: ["186", "206", "226", "256"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "general-029",
    theme: "general",
    question: "Quel est le plus long os du corps humain ?",
    answers: ["Le tibia", "L'humérus", "Le fémur", "Le péroné"],
    correct: 2,
    difficulty: "hard",
  },

  {
    id: "general-030",
    theme: "general",
    question: "En quelle année a débuté la Révolution française ?",
    answers: ["1776", "1789", "1799", "1815"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "general-031",
    theme: "general",
    question: "Quel est le plus petit pays du monde par sa superficie ?",
    answers: ["Monaco", "Saint-Marin", "La Cité du Vatican", "Le Liechtenstein"],
    correct: 2,
    difficulty: "hard",
  },

  {
    id: "general-032",
    theme: "general",
    question: "Quel gaz les plantes absorbent-elles pour réaliser la photosynthèse ?",
    answers: ["L'oxygène", "L'azote", "Le dioxyde de carbone", "L'hydrogène"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "general-033",
    theme: "general",
    question: "Quelle est la monnaie du Royaume-Uni ?",
    answers: ["L'euro", "Le dollar", "La livre sterling", "Le franc"],
    correct: 2,
    difficulty: "easy",
  },

  /* MEMES */
  {
    id: "memes-001",
    theme: "memes",
    question: "Quel mot est souvent associé au mème du chien Shiba Inu ?",
    answers: ["Bruh", "Doge", "Sus", "Ratio"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "memes-002",
    theme: "memes",
    question: "Que signifie 'LOL' ?",
    answers: ["Lots of Love","Laughing Out Loud","Love Online Life","Long Online Laugh"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "memes-003",
    theme: "memes",
    question: "Quel réseau social est connu pour ses vidéos courtes verticales ?",
    answers: ["LinkedIn","TikTok","Discord","Reddit"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "memes-004",
    theme: "memes",
    question: "Que signifie 'AFK' dans les jeux vidéo ?",
    answers: ["Away From Keyboard","All For Kills","Ask For Key","Away For King"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "memes-005",
    theme: "memes",
    question: "Que veut dire 'DM' sur les réseaux sociaux ?",
    answers: ["Data Mode","Direct Message","Digital Memory","Daily Meme"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "memes-006",
    theme: "memes",
    question: "Quel mot désigne une image drôle qui circule sur Internet ?",
    answers: ["Widget","Stream","Pixel","Mème"],
    correct: 3,
    difficulty: "easy",
  },

  {
    id: "memes-007",
    theme: "memes",
    question: "Quel emoji est souvent utilisé pour représenter le rire ?",
    answers: ["😂","😍","😘","😊"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "memes-008",
    theme: "memes",
    question: "Que signifie 'NPC' dans les jeux vidéo ?",
    answers: ["New Player Card","Non Playable Character","Network Player Control","Next Play Choice"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "memes-009",
    theme: "memes",
    question: "Quel mot désigne le fait de regarder plusieurs épisodes d'une série d'affilée ?",
    answers: ["Spam","Loop","Binge-watch","Farm"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "memes-010",
    theme: "memes",
    question: "Quel mot désigne une personne qui diffuse en direct sur Internet ?",
    answers: ["Streamer","Modérateur","Admin","Monteur"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "memes-011",
    theme: "memes",
    question: "Que signifie généralement 'GG' dans un jeu vidéo ?",
    answers: ["Great Game","Good Game","Go Gaming","Global Goal"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "memes-012",
    theme: "memes",
    question: "Que signifie 'POV' sur TikTok ?",
    answers: ["Point Of View","Power Of Video","Proof Of Value","Play On Video"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "memes-013",
    theme: "memes",
    question: "Que veut dire 'sus' dans le langage internet récent ?",
    answers: ["Super","Suspect","Success","Surprise"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "memes-014",
    theme: "memes",
    question: "Quel emoji est souvent utilisé pour exprimer le malaise ou la gêne ?",
    answers: ["😂","😭","😬","🔥"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "memes-015",
    theme: "memes",
    question: "Quel mème est souvent associé à un squelette dansant ?",
    answers: ["Spooky Scary Skeleton","Dancing Bones","Grave Meme","Halloween Dance"],
    correct: 0,
    difficulty: "hard",
  },

  {
    id: "memes-016",
    theme: "memes",
    question: "Que signifie 'rizz' dans le slang internet ?",
    answers: ["Argent","Charisme/séduction","Colère","Chance"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "memes-017",
    theme: "memes",
    question: "Quel mème est associé à la phrase 'This is fine' ?",
    answers: ["Un chien dans une maison en feu","Un chien policier","Un squelette","Un robot"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "memes-018",
    theme: "memes",
    question: "Que signifie 'ratio' sur les réseaux sociaux ?",
    answers: ["Une réponse qui a plus de likes que le post d'origine","Une vidéo devenue virale","Un abonnement payant","Un post supprimé par son auteur"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "memes-019",
    theme: "memes",
    question: "Quel personnage est souvent utilisé dans les mèmes 'Pepe' ?",
    answers: ["Grenouille","Chien","Chat","Lapin"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "memes-020",
    theme: "memes",
    question: "Que signifie 'irl' ?",
    answers: ["In Real Life","Internet Random Laugh","Internal Replay Loop","Instant Replay Link"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "memes-021",
    theme: "memes",
    question: "Que signifie 'GOAT' sur internet ?",
    answers: ["Un animal mignon","Greatest Of All Time","Game Over All Time","Good Online Answer Team"],
    correct: 1,
    difficulty: "easy",
  },

  {
    id: "memes-022",
    theme: "memes",
    question: "Que signifie 'cringe' ?",
    answers: ["Quelque chose de gênant","Quelque chose de drôle","Quelque chose de stylé","Quelque chose de rapide"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "memes-023",
    theme: "memes",
    question: "Que signifie « FOMO » ?",
    answers: ["Fun Online Mood Overload", "Fear Of Missing Out", "Free Of Money Obligations", "Friends Of My Others"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "memes-024",
    theme: "memes",
    question: "Que signifie « TBH » dans un message ?",
    answers: ["Take Back Home", "To Be Honest", "Too Bad Honey", "Think Before Hitting"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "memes-025",
    theme: "memes",
    question: "Que signifie « YOLO » ?",
    answers: ["Your Own Life Online", "Young Online Lovers Only", "You Only Live Once", "You Owe Lots Online"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "memes-026",
    theme: "memes",
    question: "Quel mème montre Kermit la grenouille en train de boire une tasse de thé ?",
    answers: ["Trollface", "But That's None of My Business", "Grumpy Cat", "Success Kid"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "memes-027",
    theme: "memes",
    question: "Comment appelle-t-on le fait de piéger quelqu'un avec un lien qui diffuse une vieille chanson de Rick Astley ?",
    answers: ["Trollface", "Rickroll", "Nyan Cat", "Harlem Shake"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "memes-028",
    theme: "memes",
    question: "Quel mème montre un homme qui se retourne vers une autre femme alors que sa compagne le regarde, indignée ?",
    answers: ["Woman Yelling at Cat", "Drake Hotline Bling", "Two Buttons", "Distracted Boyfriend"],
    correct: 3,
    difficulty: "hard",
  },

  {
    id: "memes-029",
    theme: "memes",
    question: "Que signifie « bg » dans le langage des réseaux sociaux francophones ?",
    answers: ["Bon Goût", "Beau Gosse", "Big Game", "Bonne Gestion"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "memes-030",
    theme: "memes",
    question: "Que veut dire « ghoster » quelqu'un ?",
    answers: ["L'effrayer", "Cesser soudainement de lui répondre, sans explication", "Le filmer", "L'inviter à une soirée"],
    correct: 1,
    difficulty: "medium",
  },

  {
    id: "memes-031",
    theme: "memes",
    question: "Que signifie « slay » dans le langage internet actuel ?",
    answers: ["Rater complètement", "Réussir quelque chose avec brio", "Dormir", "Se moquer de quelqu'un"],
    correct: 1,
    difficulty: "hard",
  },

  {
    id: "memes-032",
    theme: "memes",
    question: "Quel réseau social avait un oiseau bleu pour logo avant de devenir X ?",
    answers: ["Snapchat", "Pinterest", "Twitter", "Tumblr"],
    correct: 2,
    difficulty: "easy",
  },

  {
    id: "memes-033",
    theme: "memes",
    question: "Que signifie « BRB » dans une conversation en ligne ?",
    answers: ["Big Red Button", "Bring Rice Back", "Back In Ten", "Be Right Back"],
    correct: 3,
    difficulty: "easy",
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
