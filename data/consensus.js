export const CONSENSUS_TIMER_SEC = 15;
export const CONSENSUS_QUESTION_COUNT_PRESETS = [5, 10, 15, 20];
export const CONSENSUS_REVEAL_PENDING_MS = 650;
export const CONSENSUS_LOBBY_PODIUM_POINTS = [50, 25, 10];

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
  { id: 1, question: "À quel point ce lobby est-il compétitif ?", category: "Social" },
  { id: 2, question: "À quel point ce groupe est du genre à annuler au dernier moment ?", category: "Social" },
  { id: 3, question: "À quel point ce lobby est prêt à partir en voyage sur un coup de tête ?", category: "Lifestyle" },
  { id: 4, question: "À quel point ce groupe juge les playlists des autres ?", category: "Musique" },
  { id: 5, question: "À quel point les gens ici répondent vite aux messages ?", category: "Social" },
  { id: 6, question: "À quel point ce lobby aime le drama inutile ?", category: "Chaos" },
  { id: 7, question: "À quel point ce groupe pourrait survivre 48h sans téléphone ?", category: "Lifestyle" },
  { id: 8, question: "À quel point les joueurs ici sont du genre à stalker une story sans liker ?", category: "Internet" },
  { id: 9, question: "À quel point ce lobby oserait karaoké devant des inconnus ?", category: "Party" },
  { id: 10, question: "À quel point ce groupe est du genre à arriver en retard ?", category: "Social" },
  { id: 11, question: "À quel point les joueurs ici sont susceptibles en débat ?", category: "Psychologie" },
  { id: 12, question: "À quel point ce groupe aime les plans improvisés ?", category: "Party" },
  { id: 13, question: "À quel point ce lobby serait crédible dans une téléréalité ?", category: "Pop culture" },
  { id: 14, question: "À quel point les gens ici sont du genre à répondre à un ex après minuit ?", category: "Romance" },
  { id: 15, question: "À quel point ce groupe pourrait garder un secret gênant pendant une semaine ?", category: "Psychologie" },
  { id: 16, question: "À quel point ce lobby est fan de théories farfelues ?", category: "Chaos" },
  { id: 17, question: "À quel point les joueurs ici sont du genre à commander le même plat à chaque fois ?", category: "Food" },
  { id: 18, question: "À quel point ce groupe serait fort pour bluff au poker ?", category: "Jeu" },
  { id: 19, question: "À quel point ce lobby est influençable par TikTok / Insta ?", category: "Internet" },
  { id: 20, question: "À quel point les gens ici pourraient dormir n'importe où ?", category: "Lifestyle" },
  { id: 21, question: "À quel point ce groupe est du genre à se remettre avec la mauvaise personne ?", category: "Romance" },
  { id: 22, question: "À quel point ce lobby aime les opinions controversées ?", category: "Hot takes" },
  { id: 23, question: "À quel point les joueurs ici seraient chaotiques dans une escape room ?", category: "Party" },
  { id: 24, question: "À quel point ce groupe ferait confiance à son intuition plutôt qu'aux faits ?", category: "Psychologie" },
  { id: 25, question: "À quel point ce lobby est du genre à mentir pour éviter une sortie ?", category: "Social" },
  { id: 26, question: "À quel point les gens ici pourraient vivre en colocation sans se détester ?", category: "Lifestyle" },
  { id: 27, question: "À quel point ce groupe est prêt à se ridiculiser pour faire rire les autres ?", category: "Party" },
  { id: 28, question: "À quel point les joueurs ici sont du genre à juger en silence ?", category: "Psychologie" },
  { id: 29, question: "À quel point ce lobby se pense plus mystérieux qu'il ne l'est vraiment ?", category: "Social" },
  { id: 30, question: "À quel point ce groupe pourrait former une secte en moins de 24h ?", category: "Chaos" },
  { id: 31, question: "À quel point ce lobby serait capable d'improviser un mensonge crédible sur-le-champ ?", category: "Psychologie" },
  { id: 32, question: "À quel point les joueurs ici pourraient survivre à un road trip de 12h sans s'embrouiller ?", category: "Voyage" },
  { id: 33, question: "À quel point ce groupe est du genre à ghoster sans explication ?", category: "Romance" },
  { id: 34, question: "À quel point ce lobby est susceptible de lancer un business totalement absurde ?", category: "Chaos" },
  { id: 35, question: "À quel point les gens ici feraient confiance à quelqu'un juste parce qu'il a l'air sûr de lui ?", category: "Psychologie" },
  { id: 36, question: "À quel point ce groupe pourrait tenir une conversation entière juste en références pop culture ?", category: "Culture pop" },
  { id: 37, question: "À quel point ce lobby est du genre à commander trop de nourriture puis regretter après ?", category: "Food" },
  { id: 38, question: "À quel point les joueurs ici seraient bons pour cacher une surprise jusqu'au bout ?", category: "Social" },
  { id: 39, question: "À quel point ce groupe pourrait tout arrêter pour aller en soirée à la dernière minute ?", category: "Party" },
  { id: 40, question: "À quel point ce lobby est du genre à lire les messages sans répondre pendant des heures ?", category: "Internet" },
  { id: 41, question: "À quel point les gens ici seraient prêts à faire un prank douteux juste pour rire ?", category: "Chaos" },
  { id: 42, question: "À quel point ce groupe pourrait se mettre d'accord sur une série à regarder en moins de 3 minutes ?", category: "Lifestyle" },
  { id: 43, question: "À quel point ce lobby est du genre à tomber amoureux d'une red flag évidente ?", category: "Romance" },
  { id: 44, question: "À quel point les joueurs ici sont bons pour faire semblant d'aller bien en public ?", category: "Psychologie" },
  { id: 45, question: "À quel point ce groupe jugerait ton appartement en silence en arrivant chez toi ?", category: "Social" },
  { id: 46, question: "À quel point ce lobby serait efficace dans un jeu de bluff type Loups-Garous ?", category: "Jeu" },
  { id: 47, question: "À quel point les gens ici ont besoin de validation extérieure pour une grosse décision ?", category: "Psychologie" },
  { id: 48, question: "À quel point ce groupe serait capable de se perdre même avec Google Maps ?", category: "Voyage" },
  { id: 49, question: "À quel point ce lobby est du genre à tout raconter après deux verres ?", category: "Party" },
  { id: 50, question: "À quel point les joueurs ici pourraient survivre à une coloc sans règles écrites ?", category: "Lifestyle" },
  { id: 51, question: "À quel point ce groupe est du genre à stalker LinkedIn d'un crush ou d'un ex ?", category: "Internet" },
  { id: 52, question: "À quel point ce lobby pourrait convaincre quelqu'un d'une idée complètement idiote ?", category: "Chaos" },
  { id: 53, question: "À quel point les gens ici sont du genre à re-regarder leurs propres stories ?", category: "Internet" },
  { id: 54, question: "À quel point ce groupe ferait des excuses douteuses pour ne pas venir à un brunch ?", category: "Social" },
  { id: 55, question: "À quel point ce lobby serait fort pour faire semblant de s'y connaître sur un sujet ?", category: "Psychologie" },
  { id: 56, question: "À quel point les joueurs ici seraient prêts à tout pour avoir raison dans un débat nul ?", category: "Chaos" },
  { id: 57, question: "À quel point ce groupe aime secrètement les dramas relationnels des autres ?", category: "Romance" },
  { id: 58, question: "À quel point ce lobby pourrait passer une nuit blanche juste pour discuter ?", category: "Social" },
  { id: 59, question: "À quel point les gens ici sont du genre à exagérer une anecdote pour qu'elle soit meilleure ?", category: "Psychologie" },
  { id: 60, question: "À quel point ce groupe serait crédible comme jury d'une émission de talents ?", category: "Culture pop" },
  { id: 61, question: "À quel point ce lobby est du genre à envoyer un message puis regretter instantanément ?", category: "Romance" },
  { id: 62, question: "À quel point les joueurs ici seraient prêts à mentir sur leur heure d'arrivée réelle ?", category: "Social" },
  { id: 63, question: "À quel point ce groupe pourrait faire de la télé-réalité sans imploser au bout de 2 jours ?", category: "Culture pop" },
  { id: 64, question: "À quel point ce lobby est du genre à vouloir tout optimiser, même les vacances ?", category: "Lifestyle" },
  { id: 65, question: "À quel point les gens ici pourraient finir dans une théorie du complot par ennui ?", category: "Chaos" },
  { id: 66, question: "À quel point ce groupe serait du genre à parler derrière quelqu'un puis redevenir adorable devant lui ?", category: "Social" },
  { id: 67, question: "À quel point ce lobby pourrait tenir un silence gênant sans paniquer ?", category: "Psychologie" },
  { id: 68, question: "À quel point les joueurs ici seraient prêts à tout plaquer pour déménager dans un autre pays ?", category: "Voyage" },
  { id: 69, question: "À quel point ce groupe est du genre à comparer ses relations à celles des autres ?", category: "Romance" },
  { id: 70, question: "À quel point ce lobby aurait besoin d'un leader en voyage de groupe ?", category: "Voyage" },
  { id: 71, question: "À quel point les gens ici seraient capables de garder leur calme dans un énorme bug ou imprévu ?", category: "Psychologie" },
  { id: 72, question: "À quel point ce groupe pourrait organiser une fête réussie en moins d'une heure ?", category: "Party" },
  { id: 73, question: "À quel point ce lobby est du genre à trop réfléchir après un date ?", category: "Romance" },
  { id: 74, question: "À quel point les joueurs ici pourraient vivre sans café pendant une semaine ?", category: "Lifestyle" },
  { id: 75, question: "À quel point ce groupe serait tenté par une aventure complètement illégale dans une fiction ?", category: "Chaos" },
  { id: 76, question: "À quel point ce lobby est du genre à faire un achat impulsif à 2h du mat ?", category: "Argent" },
  { id: 77, question: "À quel point les gens ici pourraient faire croire qu'ils ont lu un livre qu'ils n'ont jamais ouvert ?", category: "Culture pop" },
  { id: 78, question: "À quel point ce groupe jugerait un plat juste à son visuel avant même de goûter ?", category: "Food" },
  { id: 79, question: "À quel point ce lobby aime avoir le dernier mot ?", category: "Psychologie" },
  { id: 80, question: "À quel point les joueurs ici seraient capables de spoiler sans s'en rendre compte ?", category: "Culture pop" },
  { id: 81, question: "À quel point ce groupe pourrait fonctionner comme un gang d'arnaqueurs dans un film ?", category: "Chaos" },
  { id: 82, question: "À quel point ce lobby est du genre à vouloir être ami avec tout le monde ?", category: "Social" },
  { id: 83, question: "À quel point les gens ici seraient prêts à se battre pour choisir la musique en voiture ?", category: "Musique" },
  { id: 84, question: "À quel point ce groupe pourrait tenir un budget en voyage sans exploser dès le 2e jour ?", category: "Argent" },
  { id: 85, question: "À quel point ce lobby serait bon pour lire les intentions cachées des autres ?", category: "Psychologie" },
  { id: 86, question: "À quel point les joueurs ici sont du genre à overthink après avoir envoyé un vocal ?", category: "Internet" },
  { id: 87, question: "À quel point ce groupe aime secrètement être au centre de l'attention ?", category: "Social" },
  { id: 88, question: "À quel point ce lobby pourrait faire croire à une fausse expertise juste avec du charisme ?", category: "Psychologie" },
  { id: 89, question: "À quel point les gens ici seraient capables de tout plaquer pour un coup de tête romantique ?", category: "Romance" },
  { id: 90, question: "À quel point ce groupe pourrait improviser un plan B crédible quand tout part en vrille ?", category: "Lifestyle" },
  { id: 91, question: "À quel point ce lobby est du genre à aimer les gens qu'il prétend détester ?", category: "Psychologie" },
  { id: 92, question: "À quel point les joueurs ici pourraient garder un poker face après une énorme gaffe ?", category: "Jeu" },
  { id: 93, question: "À quel point ce groupe serait influencé par l'avis de la personne la plus confiante dans la pièce ?", category: "Social" },
  { id: 94, question: "À quel point ce lobby serait prêt à chanter faux mais fort en fin de soirée ?", category: "Party" },
  { id: 95, question: "À quel point les gens ici pourraient survivre à un festival sous la pluie pendant 3 jours ?", category: "Party" },
  { id: 96, question: "À quel point ce groupe est du genre à faire semblant d'être posé alors qu'il panique intérieurement ?", category: "Psychologie" },
  { id: 97, question: "À quel point ce lobby aimerait secrètement qu'on lui consacre une chanson ?", category: "Romance" },
  { id: 98, question: "À quel point les joueurs ici pourraient accepter un pari stupide juste pour l'ego ?", category: "Chaos" },
  { id: 99, question: "À quel point ce groupe serait capable d'adopter un animal sur un coup de tête ?", category: "Lifestyle" },
  { id: 100, question: "À quel point ce lobby pourrait finir célèbre sur Internet pour une raison absurde ?", category: "Internet" },
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
