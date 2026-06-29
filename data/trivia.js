import { EVENING_POINTS } from "./eveningScoring.js";

export const TRIVIA_RANDOM_THEME_ID = "random";
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
    answers: ["Harry Potter et la Chambre des secrets","Harry Potter et le Prisoner d'Azkaban","Harry Potter et le Prince de sang-mêlé","Harry Potter et les Reliques de la Mort"],
    correct: 3,
    difficulty: "hard",
  },
  {
    id: "cinema-013",
    theme: "cinema",
    question: "Dans Dragon Ball Z, comment s'appelle la transformation la plus connue de Goku ?",
    answers: ["Bankai","Titan","Super Saiyan","Gear 5"],
    correct: 2,
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
    correct: 3,
    difficulty: "medium",
  },
  {
    id: "cinema-016",
    theme: "cinema",
    question: "Quel film de la saga 'Harry Potter' est le plus récent ?",
    answers: ["Harry Potter et la Chambre des secrets","Harry Potter et le Prisoner d'Azkaban","Harry Potter et le Prince de sang-mêlé","Harry Potter et les Reliques de la Mort"],
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
    id: "cinema-018",
    theme: "cinema",
    question: "Dans Naruto, quel est le rêve de Naruto ?",
    answers: ["Devenir Hokage","Devenir pirate","Devenir samouraï","Devenir ninja légendaire"],
    correct: 0,
    difficulty: "medium",
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
    id: "cinema-020",
    theme: "cinema",
    question: "Dans One Piece, comment s’appelle le capitaine de l’équipage ?",
    answers: ["Luffy","Zoro","Sanji","Nami"],
    correct: 0,
    difficulty: "easy",
  },
  {
    id: "cinema-021",
    theme: "cinema",
    question: "Dans Attack on Titan, que sont les Titans ?",
    answers: ["Des robots","Des humains géants","Des démons marins","Des aliens"],
    correct: 1,
    difficulty: "medium",
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
    id: "cinema-024",
    theme: "cinema",
    question: "Dans Death Note, quel objet permet de tuer quelqu’un en écrivant son nom ?",
    answers: ["Un sabre","Un carnet","Une bague","Un livre magique"],
    correct: 1,
    difficulty: "easy",
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
    id: "cinema-026",
    theme: "cinema",
    question: "Dans Demon Slayer, quel est le nom du sabre utilisé ?",
    answers: ["Katana classique","Nichirin","Chidori","Bankai"],
    correct: 1,
    difficulty: "hard",
  },
  {
    id: "cinema-027",
    theme: "cinema",
    question: "Quel film d’animation met en scène un poisson clown nommé Marin ?",
    answers: ["Le Monde de Nemo","Shark Tale","Moana","Rio"],
    correct: 0,
    difficulty: "easy",
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
    answers: ["Maroon 5","Imagine Dragons","U2"," Coldplay"],
    correct: 2,
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
    answers: ["Ninho","PLK","Gazo","SCH"],
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
    question: "Quel DJ français a produit 'Never Be Alone' et 'Alone' ?",
    answers: ["David Guetta","DJ Snake","Martin Solveig","Madeon"],
    correct: 1,
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
    question: "Quel artiste français est connu pour 'Fade Up' et 'Avant toi' ?",
    answers: ["Ninho","PNL","Soolking","Damso"],
    correct: 2,
    difficulty: "easy",
  },
  
  {
    id: "music-029",
    theme: "music",
    question: "Quel festival est connu pour accueillir de nombreux artistes électro en Europe ?",
    answers: ["Tomorrowland","Sunburn","Electric Daisy Carnival","Creamfields"],
    correct: 0,
    difficulty: "easy",
  },

  /* GEOGRAPHYY */
  {
    id: "geography-001",
    theme: "geography",
    question: "Quelle est la capitale du Mexique ?",
    answers: ["Mexico City", "Guadalajara", "Monterrey", "Tijuana"],
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
    question: "Quel est le plus grand pays d'Afrique ?",
    answers: ["Éthiopie","Kenya","Nigeria","Afrique du Sud"],
    correct: 2,
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
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "geography-010",
    theme: "geography",
    question: "Quel est le plus grand pays d'Asie ?",
    answers: ["Russie","Chine","Inde","Japon"],
    correct: 0,
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
    answers: ["Berlin","Munich","Hamburg","Frankfurt"],
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
    answers: ["Brésil","Argentine","Chile","Colombie"],
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
    id: "sport-002",
    theme: "sport",
    question: "Quel sport est considéré comme le plus dangereux ?",
    answers: ["Football", "Basketball", "Hockey sur glace", "Tennis"],
    correct: 2,
    difficulty: "hard",
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
    id: "sport-008",
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
    question: "Quel sport utilise un ballon ovalué ?",
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
    question: "Quel sport utilise des bâtons pour courir ?",
    answers: ["Sprint","Marche nordique","Saut en hauteur","Saut en longueur"],
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
    id: "sport-021",
    theme: "sport",
    question: "Quel sport utilise des bâtes et des balles ?",
    answers: ["Tennis","Golf","Basketball","Rugby"],
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
    question: "Dans quel sport utilise-t-on un terrain appelé 'court' ?",
    answers: ["Basket","Tennis","Football","Rugby"],
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
    question: "Dans quel sport peut-on faire un 'strike' ?",
    answers: ["Golf","Bowling","Baseball","Cricket"],
    correct: 1,
    difficulty: "easy",
  },


  /* VIDEOGAMES */
  {
    id: "videogames-001",
    theme: "videogames",
    question: "Quel studio a cree la saga 'The Legend of Zelda' ?",
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
    id: "videogames-004",
    theme: "videogames",
    question: "Quel jeu de la série 'The Elder Scrolls' est connu pour ses mondes ouverts et ses quêtes longues ?",
    answers: ["The Elder Scrolls III: Morrowind","The Elder Scrolls IV: Oblivion","The Elder Scrolls V: Skyrim","The Elder Scrolls VI: Skyrim"],
    correct: 3,
    difficulty: "hard",
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
    answers: ["Feu","Plante","Normal","Électrique"],
    correct: 3,
    difficulty: "medium",
  },

  {
    id: "videogames-018",
    theme: "videogames",
    question: "A quel sport joue-t-on dans FIFA ?",
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
    question: "Dans Mario Kart, quel objet te fait lancer des carapaces rouges ?",
    answers: ["Étoile","Carapace rouge","Champignon","Éclair"],
    correct: 1,
    difficulty: "easy",
  },

  /* TV SHOWS */
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
    question: "Dans 'Game of Thrones', quel est le nom du personnage principal ?",
    answers: ["Daenerys Targaryen","Jon Snow","Tyrion Lannister","Arya Stark"],
    correct: 1,
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
    id: "series-015",
    theme: "series",
    question: "",
    answers: [""],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "series-016",
    theme: "series",
    question: "Quelle série met en scène les frères et sœurs Kardashian ?",
    answers: ["The Kardashians","Keeping Up with the Kardashians","Kourtney and Kim Take New York","Kourtney and Khloe Take Miami"],
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
    id: "series-023",
    theme: "series",
    question: "Dans Breaking Bad, quel est le surnom de Walter White ?",
    answers: ["Heisenberg","Saul Good","El Camino","Blue Sky"],
    correct: 0,
    difficulty: "medium",
  },

  /* FOOD */
  {
    id: "food-001",
    theme: "food",
    question: "Quel fromage est traditionnellement utilise dans une salade grecque ?",
    answers: ["Feta", "Mozzarella", "Cheddar", "Comte"],
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
    correct: 0,
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
    correct: 3,
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
    answers: ["Europe","Asie","Afrique","Amérique"],
    correct: 0,
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
    id: "general-015",
    theme: "general",
    question: "Quel est le plus grand pays du monde ?",
    answers: ["Russie","Canada","Chine","États-Unis"],
    correct: 0,
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
    answers: ["Personnification","Metaphore","Pléonasme","Allitération"],
    correct: 2,
    difficulty: "medium",
  },

  {
    id: "general-022",
    theme: "general",
    question: "Quel est le plus grand lac du monde ?",
    answers: ["Lac Supérieur","Lac Michigan","Lac Victoria","Lac Baïkal"],
    correct: 3,
    difficulty: "hard",
  },

  /* MEMES */
  {
    id: "memes-001",
    theme: "memes",
    question: "Quel mot est souvent associe au meme du chien Shiba Inu ?",
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
    question: "Quel meme est souvent associé à un squelette dansant ?",
    answers: ["Spooky Skeleton","Dancing Bones","Grave Meme","Halloween Dance"],
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
    question: "Quel meme est associé à la phrase 'This is fine' ?",
    answers: ["Un chien dans une maison en feu","Un chien policier","Un squelette","Un robot"],
    correct: 0,
    difficulty: "medium",
  },

  {
    id: "memes-018",
    theme: "memes",
    question: "Que signifie 'ratio' sur les réseaux sociaux ?",
    answers: ["Plus de likes que de commentaires","Plus de commentaires négatifs que de likes","Une vidéo virale","Un abonnement"],
    correct: 0,
    difficulty: "easy",
  },

  {
    id: "memes-019",
    theme: "memes",
    question: "Quel personnage est souvent utilisé dans les memes 'Pepe' ?",
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
