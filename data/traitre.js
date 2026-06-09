/** Le Traître — paires de mots (majorité = a, intrus = b). */

export const TRAITRE_MIN_PLAYERS = 4;

export const TRAITRE_POINTS = {
  INTRUS_WIN: 50,
  INTRUS_SURVIVE_VOTE: 10,
  CIVIL_CORRECT_VOTE: 20,
};

export const TRAITRE_WORD_PAIRS = [
  [
    { id: "social_1", a: "TikTok", b: "Instagram", theme: "réseaux sociaux" },
    { id: "social_2", a: "Snapchat", b: "BeReal", theme: "réseaux sociaux" },
    { id: "social_3", a: "Discord", b: "WhatsApp", theme: "messagerie" },
    { id: "social_4", a: "Reel", b: "Story", theme: "formats de contenu" },
    { id: "social_5", a: "Influenceur", b: "Streamer", theme: "créateurs de contenu" },
  
    { id: "gaming_1", a: "Fortnite", b: "Minecraft", theme: "jeux vidéo" },
    { id: "gaming_2", a: "Valorant", b: "Counter-Strike", theme: "FPS" },
    { id: "gaming_3", a: "Roblox", b: "Minecraft", theme: "jeux sandbox" },
    { id: "gaming_4", a: "Mario", b: "Sonic", theme: "personnages de jeux vidéo" },
    { id: "gaming_6", a: "PlayStation", b: "Xbox", theme: "consoles" },
    { id: "gaming_7", a: "Nintendo Switch", b: "Steam Deck", theme: "consoles portables" },
    { id: "gaming_8", a: "Zelda", b: "Elden Ring", theme: "jeux d'aventure" },
    { id: "gaming_9", a: "Among Us", b: "Loup-Garou", theme: "jeu de déduction" },
  
    { id: "stream_1", a: "Netflix", b: "Disney+", theme: "streaming" },
    { id: "stream_2", a: "Prime Video", b: "Max", theme: "streaming" },
    { id: "stream_3", a: "Stranger Things", b: "Mercredi", theme: "séries" },
    { id: "stream_4", a: "Squid Game", b: "Alice in Borderland", theme: "séries" },
    { id: "stream_5", a: "Marvel", b: "DC", theme: "univers de super-héros" },
    { id: "stream_6", a: "Harry Potter", b: "Percy Jackson", theme: "fantasy" },
    { id: "stream_7", a: "Star Wars", b: "Star Trek", theme: "science-fiction" },
    { id: "stream_8", a: "One Piece", b: "Naruto", theme: "anime" },
  
    { id: "music_1", a: "Spotify", b: "Deezer", theme: "musique" },
    { id: "music_2", a: "Rap", b: "Trap", theme: "genres musicaux" },
    { id: "music_3", a: "Playlist", b: "Album", theme: "écoute musicale" },
    { id: "music_4", a: "Concert", b: "Festival", theme: "événements musicaux" },
    { id: "music_5", a: "Jul", b: "Ninho", theme: "rap français" },
    { id: "music_6", a: "Billie Eilish", b: "Olivia Rodrigo", theme: "pop" },
    { id: "music_7", a: "Taylor Swift", b: "Sabrina Carpenter", theme: "pop" },
    { id: "music_8", a: "Daft Punk", b: "Justice", theme: "électro française" },
  
    { id: "tech_1", a: "iPhone", b: "Samsung", theme: "smartphones" },
    { id: "tech_2", a: "AirPods", b: "Galaxy Buds", theme: "écouteurs" },
    { id: "tech_3", a: "MacBook", b: "Surface", theme: "ordinateurs portables" },
    { id: "tech_4", a: "ChatGPT", b: "Gemini", theme: "IA" },
    { id: "tech_5", a: "Uber", b: "Bolt", theme: "VTC" },
    { id: "tech_7", a: "Google Maps", b: "Waze", theme: "navigation" },
  
    { id: "food_1", a: "Bubble Tea", b: "Matcha Latte", theme: "boissons tendance" },
    { id: "food_2", a: "Sushi", b: "Poke Bowl", theme: "cuisine asiatique" },
    { id: "food_3", a: "Burger", b: "Wrap", theme: "fast-food" },
    { id: "food_4", a: "Tacos", b: "Burrito", theme: "cuisine mexicaine" },
    { id: "food_5", a: "Starbucks", b: "Columbus", theme: "cafés" },
    { id: "food_6", a: "Red Bull", b: "Monster", theme: "boissons énergétiques" },
    { id: "food_7", a: "Cookie", b: "Brownie", theme: "desserts" },
    { id: "food_8", a: "Donut", b: "Muffin", theme: "pâtisseries" },
  
    { id: "lifestyle_1", a: "Télétravail", b: "Coworking", theme: "travail moderne" },
    { id: "lifestyle_2", a: "Airbnb", b: "Hôtel", theme: "hébergement" },
    { id: "lifestyle_3", a: "Yoga", b: "Pilates", theme: "bien-être" },
    { id: "lifestyle_4", a: "Running", b: "Trail", theme: "sport" },
    { id: "lifestyle_5", a: "Festival", b: "Rave", theme: "événements" },
    { id: "lifestyle_6", a: "Vinted", b: "LeBonCoin", theme: "seconde main" },
    { id: "lifestyle_7", a: "Tinder", b: "Bumble", theme: "applications de rencontre" },
    { id: "lifestyle_8", a: "Road Trip", b: "City Break", theme: "voyage" },
  
    { id: "culture_1", a: "Meme", b: "GIF", theme: "culture internet" },
    { id: "culture_2", a: "Podcast", b: "Vlog", theme: "création de contenu" },
    { id: "culture_3", a: "Emoji", b: "Sticker", theme: "communication numérique" },
    { id: "culture_4", a: "Croissant", b: "Pain au chocolat", theme: "viennoiseries" },
    { id: "culture_5", a: "Pokémon", b: "Palworld", theme: "créatures de collection" },
    { id: "culture_6", a: "Air Fryer", b: "Thermomix", theme: "électroménager tendance" }
  ]  
];

export function getTraitrePairById(id) {
  return TRAITRE_WORD_PAIRS.find((p) => p.id === id) || null;
}

export function pickRandomTraitrePair() {
  const idx = Math.floor(Math.random() * TRAITRE_WORD_PAIRS.length);
  return TRAITRE_WORD_PAIRS[idx];
}
