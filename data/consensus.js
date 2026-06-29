export const CONSENSUS_QUESTION_COUNT_PRESETS = [5, 10, 15, 20];
export const CONSENSUS_REVEAL_PENDING_MS = 650;
/** Délai max avant abandon d'un patch Supabase (révélation, etc.). */
export const CONSENSUS_SYNC_PATCH_TIMEOUT_MS = 20000;
export const CONSENSUS_LOBBY_PODIUM_POINTS = [50, 25, 10];
/** Position neutre du slider ; imputée si le joueur ne valide pas avant la révélation. */
export const CONSENSUS_DEFAULT_SLIDER_VALUE = 50;

export const CONSENSUS_MODES = [
  {
    id: "standard",
    label: "Standard",
    desc: "Vise la perception moyenne du groupe.",
    setupTitle: "But du mode",
    setupBody:
      "Rapproche-toi de la moyenne finale du groupe. Le plus proche de cette perception collective marque le plus.",
    questionBody:
      "Vise le centre du groupe : la cible est la moyenne finale des réponses.",
  },
  /*
  {
    id: "extremes",
    label: "Extrêmes",
    desc: "Une cible haute ou basse est tirée à chaque manche.",
    setupTitle: "But du mode",
    setupBody:
      "Le jeu choisit Plus haut ou Plus bas. Tu dois aller vers cet extrême, mais sans te couper complètement du reste du groupe.",
    questionBody:
      "Va vers l'extrême demandé par la manche. Le score récompense les réponses proches du bord visé par le groupe.",
  },
  */
];

export const CONSENSUS_QUESTIONS = [
  // --- Social ---
  { id: 1, question: "À quel point ce groupe est-il compétitif ?", category: "Social" },
  { id: 2, question: "À quel point ce groupe est du genre à annuler au dernier moment ?", category: "Social" },
  { id: 5, question: "À quel point les gens ici répondent vite aux messages ?", category: "Social" },
  { id: 10, question: "À quel point les joueurs de ce groupe sont du genre à arriver en retard ?", category: "Social" },
  { id: 25, question: "À quel point ce groupe est du genre à mentir pour éviter une sortie ?", category: "Social" },
  { id: 29, question: "À quel point ce groupe se pense plus mystérieux qu'il ne l'est vraiment ?", category: "Social" },
  { id: 38, question: "À quel point les joueurs ici seraient bons pour cacher une surprise jusqu'au bout ?", category: "Social" },
  { id: 45, question: "À quel point ce groupe jugerait ton appartement en silence en arrivant chez toi ?", category: "Social" },
  { id: 54, question: "À quel point ce groupe trouverait des excuses douteuses pour ne pas venir à un brunch ?", category: "Social" },
  { id: 58, question: "À quel point ce groupe pourrait passer une nuit blanche juste pour discuter ?", category: "Social" },
  { id: 62, question: "À quel point les joueurs ici seraient prêts à mentir sur leur heure d'arrivée réelle ?", category: "Social" },
  { id: 66, question: "À quel point ce groupe serait du genre à parler derrière quelqu'un puis redevenir adorable devant lui ?", category: "Social" },
  { id: 82, question: "À quel point ce groupe est du genre à vouloir être ami avec tout le monde ?", category: "Social" },
  { id: 87, question: "À quel point ce groupe aime secrètement être au centre de l'attention ?", category: "Social" },
  { id: 93, question: "À quel point ce groupe serait influencé par l'avis de la personne la plus confiante dans la pièce ?", category: "Social" },
  { id: 101, question: "À quel point ce groupe est du genre à faire un débrief de soirée dès le lendemain matin ?", category: "Social" },
  { id: 102, question: "À quel point les gens ici se rappellent vraiment du prénom des gens qu'ils rencontrent ?", category: "Social" },
  { id: 103, question: "À quel point ce groupe est capable de monopoliser une conversation à plusieurs ?", category: "Social" },
  { id: 104, question: "À quel point les joueurs ici sont du genre à dire « on se capte bientôt » sans jamais le faire ?", category: "Social" },
  { id: 105, question: "À quel point ce groupe juge les gens qui parlent fort au téléphone en public ?", category: "Social" },
  { id: 106, question: "À quel point les gens ici sont du genre à rester dans une soirée qu'ils n'aiment pas par politesse ?", category: "Social" },
  { id: 107, question: "À quel point ce groupe est capable de se faire de nouveaux amis n'importe où ?", category: "Social" },
  { id: 167, question: "À quel point ce groupe est du genre à laisser quelqu'un en « vu » pendant plusieurs jours ?", category: "Social" },
  { id: 168, question: "À quel point les gens ici font semblant de connaître quelqu'un pour éviter le malaise ?", category: "Social" },
  { id: 169, question: "À quel point ce groupe oublie systématiquement de répondre à une invitation ?", category: "Social" },
  { id: 170, question: "À quel point les joueurs ici parlent de gens absents dès qu'ils ont quitté la pièce ?", category: "Social" },
  { id: 171, question: "À quel point ce groupe se sentirait obligé d'inviter quelqu'un qu'il n'apprécie pas vraiment ?", category: "Social" },

  // --- Psychologie ---
  { id: 11, question: "À quel point les joueurs de ce groupe sont susceptibles en débat ?", category: "Psychologie" },
  { id: 15, question: "À quel point ce groupe pourrait garder un secret gênant pendant une semaine ?", category: "Psychologie" },
  { id: 24, question: "À quel point ce groupe ferait confiance à son intuition plutôt qu'aux faits ?", category: "Psychologie" },
  { id: 28, question: "À quel point les joueurs ici sont du genre à juger en silence ?", category: "Psychologie" },
  { id: 31, question: "À quel point ce groupe serait capable d'improviser un mensonge crédible sur-le-champ ?", category: "Psychologie" },
  { id: 35, question: "À quel point les gens ici feraient confiance à quelqu'un juste parce qu'il a l'air sûr de lui ?", category: "Psychologie" },
  { id: 44, question: "À quel point les joueurs ici sont bons pour faire semblant d'aller bien en public ?", category: "Psychologie" },
  { id: 47, question: "À quel point les gens ici ont besoin de validation extérieure pour une grosse décision ?", category: "Psychologie" },
  { id: 55, question: "À quel point ce groupe serait fort pour faire semblant de s'y connaître sur un sujet ?", category: "Psychologie" },
  { id: 59, question: "À quel point les gens ici sont du genre à exagérer une anecdote pour qu'elle soit meilleure ?", category: "Psychologie" },
  { id: 67, question: "À quel point ce groupe pourrait tenir un silence gênant sans paniquer ?", category: "Psychologie" },
  { id: 71, question: "À quel point les gens ici seraient capables de garder leur calme dans un énorme bug ou imprévu ?", category: "Psychologie" },
  { id: 79, question: "À quel point ce groupe aime avoir le dernier mot ?", category: "Psychologie" },
  { id: 85, question: "À quel point ce groupe serait bon pour lire les intentions cachées des autres ?", category: "Psychologie" },
  { id: 88, question: "À quel point ce groupe pourrait faire croire à une fausse expertise juste avec du charisme ?", category: "Psychologie" },
  { id: 91, question: "À quel point ce groupe est du genre à aimer les gens qu'il prétend détester ?", category: "Psychologie" },
  { id: 96, question: "À quel point ce groupe est du genre à faire semblant d'être posé alors qu'il panique intérieurement ?", category: "Psychologie" },
  { id: 114, question: "À quel point ce groupe prend les choses personnellement alors que ça ne les concerne pas ?", category: "Psychologie" },
  { id: 115, question: "À quel point les gens ici sont du genre à analyser un message pendant 10 minutes avant de répondre ?", category: "Psychologie" },
  { id: 116, question: "À quel point ce groupe est rancunier sans jamais l'avouer ?", category: "Psychologie" },
  { id: 118, question: "À quel point ce groupe a besoin d'avoir le dernier mot dans une dispute ?", category: "Psychologie" },
  { id: 119, question: "À quel point les gens ici font passer leur fierté avant leur intérêt ?", category: "Psychologie" },
  { id: 120, question: "À quel point ce groupe est du genre à s'excuser même quand ce n'est pas sa faute ?", category: "Psychologie" },
  { id: 176, question: "À quel point ce groupe rejoue mentalement une situation gênante des années après ?", category: "Psychologie" },
  { id: 177, question: "À quel point les gens ici disent « ça va » alors que ça ne va pas du tout ?", category: "Psychologie" },
  { id: 178, question: "À quel point ce groupe a du mal à accepter un compliment sans le minimiser ?", category: "Psychologie" },
  { id: 179, question: "À quel point les joueurs ici se comparent en permanence aux autres ?", category: "Psychologie" },
  { id: 180, question: "À quel point ce groupe préfère avoir raison plutôt qu'être heureux ?", category: "Psychologie" },

  // --- Romance ---
  { id: 14, question: "À quel point les gens ici sont du genre à répondre à un ex après minuit ?", category: "Romance" },
  { id: 21, question: "À quel point ce groupe est du genre à se remettre avec la mauvaise personne ?", category: "Romance" },
  { id: 33, question: "À quel point ce groupe est du genre à ghoster sans explication ?", category: "Romance" },
  { id: 43, question: "À quel point ce groupe est du genre à tomber amoureux d'un/e red flag évidente ?", category: "Romance" },
  { id: 57, question: "À quel point ce groupe aime secrètement les dramas relationnels des autres ?", category: "Romance" },
  { id: 69, question: "À quel point ce groupe est du genre à comparer ses relations à celles des autres ?", category: "Romance" },
  { id: 73, question: "À quel point ce groupe est du genre à trop réfléchir après un date ?", category: "Romance" },
  { id: 89, question: "À quel point les gens ici seraient capables de tout plaquer pour un coup de tête romantique ?", category: "Romance" },
  { id: 97, question: "À quel point ce groupe aimerait secrètement qu'on lui consacre une chanson ?", category: "Romance" },
  { id: 122, question: "À quel point les gens ici sont du genre à stalker un crush sur les réseaux pendant des heures ?", category: "Romance" },
  { id: 123, question: "À quel point ce groupe confond « red flag » et « challenge » ?", category: "Romance" },
  { id: 124, question: "À quel point les joueurs ici sont du genre à idéaliser quelqu'un après un seul date ?", category: "Romance" },
  { id: 125, question: "À quel point ce groupe garde des conversations qu'il devrait supprimer ?", category: "Romance" },
  { id: 126, question: "À quel point les gens ici donnent des conseils amoureux qu'ils n'appliquent jamais ?", category: "Romance" },
  { id: 181, question: "À quel point ce groupe attend que l'autre écrive en premier par fierté ?", category: "Romance" },
  { id: 182, question: "À quel point les gens ici tombent amoureux beaucoup trop vite ?", category: "Romance" },
  { id: 183, question: "À quel point ce groupe analyse un simple emoji comme un message codé ?", category: "Romance" },
  { id: 184, question: "À quel point les joueurs ici restent amis avec leurs ex « juste au cas où » ?", category: "Romance" },

  // --- Party ---
  { id: 9, question: "À quel point ce groupe oserait faire un karaoké devant des inconnus ?", category: "Party" },
  { id: 12, question: "À quel point ce groupe aime les plans improvisés ?", category: "Party" },
  { id: 23, question: "À quel point les joueurs ici seraient chaotiques dans une escape room ?", category: "Party" },
  { id: 27, question: "À quel point ce groupe est prêt à se ridiculiser pour faire rire les autres ?", category: "Party" },
  { id: 39, question: "À quel point ce groupe pourrait tout arrêter pour aller en soirée à la dernière minute ?", category: "Party" },
  { id: 49, question: "À quel point ce groupe est du genre à tout raconter après deux verres ?", category: "Party" },
  { id: 72, question: "À quel point ce groupe pourrait organiser une fête réussie en moins d'une heure ?", category: "Party" },
  { id: 94, question: "À quel point ce groupe serait prêt à chanter faux mais fort en fin de soirée ?", category: "Party" },
  { id: 95, question: "À quel point les gens ici pourraient survivre à un festival sous la pluie pendant 3 jours ?", category: "Party" },
  { id: 127, question: "À quel point ce groupe est du genre à promettre « juste un verre » et finir à 4h ?", category: "Party" },
  { id: 128, question: "À quel point les gens ici deviennent les meilleurs amis de tout le monde après deux verres ?", category: "Party" },
  { id: 129, question: "À quel point ce groupe est du genre à perdre quelqu'un en soirée sans s'en rendre compte ?", category: "Party" },
  { id: 130, question: "À quel point les joueurs ici dansent mieux dans leur tête que dans la réalité ?", category: "Party" },
  { id: 131, question: "À quel point ce groupe est capable de transformer un apéro tranquille en grosse soirée ?", category: "Party" },
  { id: 185, question: "À quel point ce groupe disparaît à l'anglaise sans dire au revoir ?", category: "Party" },
  { id: 186, question: "À quel point les gens ici racontent les mêmes anecdotes à chaque soirée ?", category: "Party" },
  { id: 187, question: "À quel point ce groupe est du genre à organiser un afterwork qui finit en after tout court ?", category: "Party" },
  { id: 188, question: "À quel point les joueurs ici regrettent un message envoyé en soirée ?", category: "Party" },

  // --- Chaos ---
  { id: 6, question: "À quel point ce groupe aime le drama inutile ?", category: "Chaos" },
  { id: 16, question: "À quel point ce groupe est fan de théories farfelues ?", category: "Chaos" },
  { id: 30, question: "À quel point ce groupe pourrait former une secte en moins de 24h ?", category: "Chaos" },
  { id: 34, question: "À quel point ce groupe est susceptible de lancer un business totalement absurde ?", category: "Chaos" },
  { id: 41, question: "À quel point les gens ici seraient prêts à faire un prank douteux juste pour rire ?", category: "Chaos" },
  { id: 52, question: "À quel point ce groupe pourrait convaincre quelqu'un d'une idée complètement idiote ?", category: "Chaos" },
  { id: 56, question: "À quel point les joueurs ici seraient prêts à tout pour avoir raison dans un débat nul ?", category: "Chaos" },
  { id: 65, question: "À quel point les gens ici pourraient finir dans une théorie du complot par ennui ?", category: "Chaos" },
  { id: 75, question: "À quel point ce groupe serait tenté par une aventure complètement illégale dans une fiction ?", category: "Chaos" },
  { id: 81, question: "À quel point ce groupe pourrait fonctionner comme un gang d'arnaqueurs dans un film ?", category: "Chaos" },
  { id: 98, question: "À quel point les joueurs ici pourraient accepter un pari stupide juste pour l'ego ?", category: "Chaos" },
  { id: 132, question: "À quel point ce groupe pourrait déclencher une embrouille dans un groupe WhatsApp familial ?", category: "Chaos" },
  { id: 133, question: "À quel point les gens ici diraient oui à un défi débile juste pour voir ce qui se passe ?", category: "Chaos" },
  { id: 134, question: "À quel point ce groupe est capable de transformer une décision simple en débat de 2h ?", category: "Chaos" },
  { id: 135, question: "À quel point les joueurs ici seraient les premiers suspects dans une enquête de quartier ?", category: "Chaos" },
  { id: 136, question: "À quel point ce groupe pourrait se faire bannir d'un Airbnb ?", category: "Chaos" },
  { id: 189, question: "À quel point ce groupe pourrait improviser un road trip sans aucune destination ?", category: "Chaos" },
  { id: 190, question: "À quel point les gens ici aggravent une situation en essayant d'aider ?", category: "Chaos" },
  { id: 192, question: "À quel point les joueurs ici répéteraient un secret « sous le sceau du secret » à plusieurs personnes ?", category: "Chaos" },

  // --- Lifestyle ---
  { id: 3, question: "À quel point ce groupe est prêt à partir en voyage sur un coup de tête ?", category: "Lifestyle" },
  { id: 7, question: "À quel point ce groupe pourrait survivre 48h sans téléphone ?", category: "Lifestyle" },
  { id: 20, question: "À quel point les gens ici pourraient dormir n'importe où ?", category: "Lifestyle" },
  { id: 26, question: "À quel point les gens ici pourraient vivre en colocation sans se détester ?", category: "Lifestyle" },
  { id: 42, question: "À quel point ce groupe pourrait se mettre d'accord sur une série à regarder en moins de 3 minutes ?", category: "Lifestyle" },
  { id: 50, question: "À quel point les joueurs ici pourraient survivre à une coloc sans règles écrites ?", category: "Lifestyle" },
  { id: 64, question: "À quel point ce groupe est du genre à vouloir tout optimiser, même les vacances ?", category: "Lifestyle" },
  { id: 74, question: "À quel point les joueurs ici pourraient vivre sans café pendant une semaine ?", category: "Lifestyle" },
  { id: 90, question: "À quel point ce groupe pourrait improviser un plan B crédible quand tout part en vrille ?", category: "Lifestyle" },
  { id: 99, question: "À quel point ce groupe serait capable d'adopter un animal sur un coup de tête ?", category: "Lifestyle" },
  { id: 108, question: "À quel point ce groupe est du genre à acheter du matériel de sport puis ne jamais s'en servir ?", category: "Lifestyle" },
  { id: 109, question: "À quel point les gens ici reportent toujours les trucs importants ?", category: "Lifestyle" },
  { id: 110, question: "À quel point ce groupe pourrait tenir une routine matinale plus de trois jours ?", category: "Lifestyle" },
  { id: 112, question: "À quel point ce groupe est du genre à dire « je commence lundi » sans jamais commencer ?", category: "Lifestyle" },
  { id: 113, question: "À quel point les gens ici pourraient vivre une semaine entière sans faire la vaisselle ?", category: "Lifestyle" },
  { id: 172, question: "À quel point ce groupe achète des trucs juste parce qu'ils étaient en promo ?", category: "Lifestyle" },
  { id: 173, question: "À quel point les gens ici remettent l'alarme cinq fois avant de se lever ?", category: "Lifestyle" },
  { id: 174, question: "À quel point ce groupe range sa chambre uniquement quand il devrait faire autre chose ?", category: "Lifestyle" },
  { id: 175, question: "À quel point les joueurs ici gardent des vêtements qu'ils ne mettront plus jamais ?", category: "Lifestyle" },

  // --- Internet ---
  { id: 8, question: "À quel point les joueurs ici sont du genre à stalker une story sans liker ?", category: "Internet" },
  { id: 19, question: "À quel point ce groupe est influençable par TikTok / Insta ?", category: "Internet" },
  { id: 40, question: "À quel point ce groupe est du genre à lire les messages sans répondre pendant des heures ?", category: "Internet" },
  { id: 51, question: "À quel point ce groupe est du genre à stalker le LinkedIn d'un crush ou d'un ex ?", category: "Internet" },
  { id: 53, question: "À quel point les gens ici sont du genre à re-regarder leurs propres stories ?", category: "Internet" },
  { id: 86, question: "À quel point les joueurs ici sont du genre à overthink (sur-réfléchir) après avoir envoyé un vocal ?", category: "Internet" },
  { id: 100, question: "À quel point ce groupe pourrait finir célèbre sur Internet pour une raison absurde ?", category: "Internet" },
  { id: 138, question: "À quel point les gens ici connaissent des memes que leurs parents ne comprendront jamais ?", category: "Internet" },
  { id: 139, question: "À quel point ce groupe vérifie qui a vu sa story avant de faire autre chose ?", category: "Internet" },
  { id: 140, question: "À quel point les joueurs ici sont du genre à supprimer un post s'il ne fait pas assez de likes ?", category: "Internet" },
  { id: 141, question: "À quel point ce groupe passe plus de temps à choisir un filtre qu'à vivre le moment ?", category: "Internet" },
  { id: 193, question: "À quel point ce groupe ouvre un débat dans les commentaires d'un inconnu ?", category: "Internet" },
  { id: 194, question: "À quel point les gens ici sauvegardent des vidéos qu'ils ne reverront jamais ?", category: "Internet" },
  { id: 195, question: "À quel point ce groupe vérifie son téléphone dès qu'il vibre, même en pleine conversation ?", category: "Internet" },
  { id: 196, question: "À quel point les joueurs ici croient un titre d'article sans lire le contenu ?", category: "Internet" },

  // --- Food ---
  { id: 17, question: "À quel point les joueurs ici sont du genre à commander le même plat à chaque fois ?", category: "Food" },
  { id: 37, question: "À quel point ce groupe est du genre à commander trop de nourriture puis regretter après ?", category: "Food" },
  { id: 78, question: "À quel point ce groupe jugerait un plat juste à son visuel avant même de goûter ?", category: "Food" },
  { id: 142, question: "À quel point ce groupe est du genre à voler des frites dans l'assiette des autres ?", category: "Food" },
  { id: 143, question: "À quel point les gens ici prennent une photo de leur plat avant d'y toucher ?", category: "Food" },
  { id: 144, question: "À quel point ce groupe mettrait 20 minutes à choisir un resto puis prendrait toujours pareil ?", category: "Food" },
  { id: 145, question: "À quel point les joueurs ici jugent quelqu'un sur sa pizza préférée ?", category: "Food" },
  { id: 146, question: "À quel point ce groupe est du genre à dire « j'ai plus faim » puis finir le dessert des autres ?", category: "Food" },
  { id: 197, question: "À quel point ce groupe commande un dessert « à partager » pour le manger seul ?", category: "Food" },
  { id: 198, question: "À quel point les gens ici jugent un resto avant même d'avoir goûté ?", category: "Food" },
  { id: 199, question: "Au restau, à quel point ce groupe est du genre à reprendre exactement le même plat à chaque fois ?", category: "Food" },

  // --- Argent ---
  { id: 76, question: "À quel point ce groupe est du genre à faire un achat impulsif à 2h du mat ?", category: "Argent" },
  { id: 84, question: "À quel point ce groupe pourrait tenir un budget en voyage sans exploser dès le 2e jour ?", category: "Argent" },
  { id: 147, question: "À quel point ce groupe galère à se répartir une addition à plusieurs ?", category: "Argent" },
  { id: 148, question: "À quel point les gens ici justifient un achat inutile par « je le mérite » ?", category: "Argent" },
  { id: 149, question: "À quel point ce groupe est du genre à oublier de rembourser un pote ?", category: "Argent" },
  { id: 150, question: "À quel point les joueurs ici regardent le prix en dernier au resto ?", category: "Argent" },
  { id: 200, question: "À quel point ce groupe dépense plus quand il est triste ?", category: "Argent" },
  { id: 201, question: "À quel point les gens ici regardent leur compte en banque les yeux à moitié fermés ?", category: "Argent" },
  { id: 202, question: "À quel point ce groupe est du genre à prendre l'option la plus chère « pour être tranquille » ?", category: "Argent" },

  // --- Voyage ---
  { id: 32, question: "À quel point les joueurs ici pourraient survivre à un road trip de 12h sans s'embrouiller ?", category: "Voyage" },
  { id: 48, question: "À quel point ce groupe serait capable de se perdre même avec Google Maps ?", category: "Voyage" },
  { id: 68, question: "À quel point les joueurs ici seraient prêts à tout plaquer pour déménager dans un autre pays ?", category: "Voyage" },
  { id: 70, question: "À quel point ce groupe aurait besoin d'un leader en voyage de groupe ?", category: "Voyage" },
  { id: 151, question: "À quel point ce groupe prépare un voyage à la dernière minute ?", category: "Voyage" },
  { id: 152, question: "À quel point les gens ici sont du genre à rater un avion pour un café de trop ?", category: "Voyage" },
  { id: 153, question: "À quel point ce groupe surcharge sa valise « au cas où » ?", category: "Voyage" },
  { id: 154, question: "À quel point les joueurs ici se disputeraient pour le siège côté fenêtre ?", category: "Voyage" },
  { id: 203, question: "À quel point ce groupe planifie chaque minute d'un voyage censé être relax ?", category: "Voyage" },
  { id: 204, question: "À quel point les gens ici se perdent volontiers « pour l'aventure » ?", category: "Voyage" },
  { id: 205, question: "À quel point ce groupe ramène des souvenirs inutiles à tout le monde ?", category: "Voyage" },

  // --- Musique ---
  { id: 4, question: "À quel point ce groupe juge les goûts musicaux des autres ?", category: "Musique" },
  { id: 83, question: "À quel point les gens ici seraient prêts à se battre pour choisir la musique en voiture ?", category: "Musique" },
  { id: 155, question: "À quel point ce groupe a une chanson honteuse cachée dans ses playlists ?", category: "Musique" },
  { id: 156, question: "À quel point les gens ici s'approprient l'enceinte dès qu'ils le peuvent ?", category: "Musique" },
  { id: 157, question: "À quel point ce groupe connaît mal les paroles mais chante quand même à fond ?", category: "Musique" },
  { id: 206, question: "À quel point ce groupe juge quelqu'un sur son artiste préféré ?", category: "Musique" },
  { id: 207, question: "À quel point les gens ici écoutent la même chanson en boucle jusqu'à la détester ?", category: "Musique" },
  { id: 208, question: "À quel point ce groupe prétend avoir connu un artiste « avant tout le monde » ?", category: "Musique" },

  // --- Culture pop ---
  { id: 13, question: "À quel point ce groupe serait crédible dans une téléréalité ?", category: "Culture pop" },
  { id: 36, question: "À quel point ce groupe pourrait tenir une conversation entière juste en références Culture pop ?", category: "Culture pop" },
  { id: 60, question: "À quel point ce groupe serait crédible comme jury d'une émission de talents ?", category: "Culture pop" },
  { id: 63, question: "À quel point ce groupe pourrait faire de la télé-réalité sans imploser au bout de 2 jours ?", category: "Culture pop" },
  { id: 77, question: "À quel point les gens ici pourraient faire croire qu'ils ont lu un livre qu'ils n'ont jamais ouvert ?", category: "Culture pop" },
  { id: 80, question: "À quel point les joueurs ici seraient capables de spoiler sans s'en rendre compte ?", category: "Culture pop" },
  { id: 158, question: "À quel point ce groupe prétend avoir vu une série culte qu'il n'a jamais regardée ?", category: "Culture pop" },
  { id: 159, question: "À quel point les gens ici spoilent un film sans même s'en rendre compte ?", category: "Culture pop" },
  { id: 160, question: "À quel point ce groupe pourrait débattre d'un film pendant des heures sans tomber d'accord ?", category: "Culture pop" },
  { id: 209, question: "À quel point ce groupe a un avis très tranché sur une fin de série que tout le monde déteste ?", category: "Culture pop" },
  { id: 210, question: "À quel point les gens ici citent des répliques de films au mauvais moment ?", category: "Culture pop" },
  { id: 211, question: "À quel point ce groupe surcote un film juste parce qu'il était à la mode ?", category: "Culture pop" },

  // --- Jeu ---
  { id: 18, question: "À quel point ce groupe serait fort pour bluff au poker ?", category: "Jeu" },
  { id: 46, question: "À quel point ce groupe serait efficace dans un jeu de bluff type Loups-Garous ?", category: "Jeu" },
  { id: 92, question: "À quel point les joueurs ici pourraient garder un poker face après une énorme gaffe ?", category: "Jeu" },
  { id: 161, question: "À quel point ce groupe devient ultra compétitif sur un simple jeu de société ?", category: "Jeu" },
  { id: 162, question: "À quel point les gens ici sont du genre à accuser tout le monde dans un jeu de bluff ?", category: "Jeu" },
  { id: 163, question: "À quel point ce groupe est mauvais perdant sans vouloir l'admettre ?", category: "Jeu" },
  { id: 212, question: "À quel point ce groupe relit les règles « vite fait » et joue n'importe comment ?", category: "Jeu" },
  { id: 213, question: "À quel point les gens ici forment des alliances secrètes pendant une partie ?", category: "Jeu" },
  { id: 214, question: "À quel point ce groupe retourne le plateau (au sens figuré) quand il perd ?", category: "Jeu" },

  // --- Hot takes ---
  { id: 22, question: "À quel point ce groupe aime les opinions controversées ?", category: "Hot takes" },
  { id: 164, question: "À quel point ce groupe assume ses opinions impopulaires en public ?", category: "Hot takes" },
  { id: 165, question: "À quel point les gens ici changent d'avis dès que la majorité n'est pas d'accord ?", category: "Hot takes" },
  { id: 166, question: "À quel point ce groupe est prêt à défendre un avis juste pour ne pas perdre la face ?", category: "Hot takes" },
  { id: 215, question: "À quel point ce groupe pense secrètement avoir le meilleur goût de tout le monde ?", category: "Hot takes" },
  { id: 216, question: "À quel point les gens ici lancent une opinion clivante juste pour voir la réaction ?", category: "Hot takes" },
  { id: 217, question: "À quel point ce groupe juge un classique adoré comme totalement surcoté ?", category: "Hot takes" },
];

function normalizeConsensusQuestionId(question) {
  return String(question?.id || question?.question || "").trim().toLowerCase();
}

function shuffleWithRandom(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function getConsensusMode(modeId) {
  return CONSENSUS_MODES.find((mode) => mode.id === modeId) || CONSENSUS_MODES[0];
}

export function getConsensusModeLabel(modeId) {
  return getConsensusMode(modeId).label;
}

export function decorateConsensusQuestionForMode(question, modeId, questionIdx = 0) {
  if (!question) return null;
  const mode = getConsensusMode(modeId);

  if (mode.id === "extremes") {
    const target = ((Number(question?.id) || 0) + questionIdx) % 2 === 0 ? "high" : "low";
    const targetLabel = target === "high" ? "Plus haut" : "Plus bas";
    const objective =
      target === "high"
        ? "Monte le plus haut possible, mais reste proche du bord haut que le groupe va réellement créer."
        : "Descends le plus bas possible, mais reste proche du bord bas que le groupe va réellement créer.";
    return {
      ...question,
      modeId: mode.id,
      modeLabel: mode.label,
      modeDesc: mode.desc,
      modeSetupBody: mode.setupBody,
      modeQuestionBody: mode.questionBody,
      modeObjectiveTitle: `Objectif : ${targetLabel}`,
      modeObjective: objective,
      modeTarget: target,
      modeTargetLabel: targetLabel,
    };
  }

  return {
    ...question,
    modeId: mode.id,
    modeLabel: mode.label,
    modeDesc: mode.desc,
    modeSetupBody: mode.setupBody,
    modeQuestionBody: mode.questionBody,
    modeObjectiveTitle: "Objectif : moyenne",
    modeObjective: "Rapproche-toi au maximum de la moyenne finale du groupe.",
    modeTarget: "mean",
    modeTargetLabel: "Moyenne",
  };
}

export function getConsensusQuestionPool(bank = CONSENSUS_QUESTIONS) {
  const seen = new Set();
  const unique = [];
  bank.forEach((question) => {
    const key = normalizeConsensusQuestionId(question);
    if (!key || seen.has(key)) return;
    seen.add(key);
    unique.push(question);
  });
  return unique;
}

export function prepareConsensusDeck(
  questionCount,
  bank = CONSENSUS_QUESTIONS,
  random = Math.random
) {
  const pool = getConsensusQuestionPool(bank);
  if (pool.length < questionCount) {
    return {
      ok: false,
      requested: questionCount,
      poolSize: pool.length,
      missing: Math.max(0, questionCount - pool.length),
      deck: [],
    };
  }

  return {
    ok: true,
    requested: questionCount,
    poolSize: pool.length,
    missing: 0,
    deck: shuffleWithRandom(pool, random).slice(0, questionCount),
  };
}
