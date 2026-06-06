/** Le Traître — paires de mots (majorité = a, intrus = b). */

export const TRAITRE_MIN_PLAYERS = 4;

export const TRAITRE_POINTS = {
  INTRUS_WIN: 50,
  INTRUS_SURVIVE_VOTE: 10,
  CIVIL_CORRECT_VOTE: 20,
};

export const TRAITRE_WORD_PAIRS = [
  { id: "mobile-os", a: "Android", b: "iOS", theme: "téléphones" },
  { id: "coffee", a: "Espresso", b: "Cappuccino", theme: "café" },
  { id: "sport-ball", a: "Football", b: "Rugby", theme: "sports de ballon" },
  { id: "pet", a: "Chat", b: "Chien", theme: "animaux" },
  { id: "fruit", a: "Pomme", b: "Poire", theme: "fruits" },
  { id: "car", a: "Berline", b: "SUV", theme: "voitures" },
  { id: "cheese", a: "Comté", b: "Roquefort", theme: "fromages" },
  { id: "stream", a: "Netflix", b: "Disney+", theme: "streaming" },
  { id: "console", a: "PlayStation", b: "Xbox", theme: "consoles" },
  { id: "weather", a: "Pluie", b: "Neige", theme: "météo" },
  { id: "transport", a: "Train", b: "Avion", theme: "transport" },
  { id: "pizza", a: "Margherita", b: "4 fromages", theme: "pizzas" },
  { id: "color", a: "Rouge", b: "Orange", theme: "couleurs" },
  { id: "school", a: "Crayon", b: "Stylo", theme: "école" },
  { id: "music", a: "Guitare", b: "Piano", theme: "instruments" },
  { id: "sea", a: "Plage", b: "Montagne", theme: "vacances" },
  { id: "drink", a: "Thé", b: "Coca", theme: "boissons" },
  { id: "social", a: "Instagram", b: "TikTok", theme: "réseaux sociaux" },
  { id: "fastfood", a: "McDonald's", b: "KFC", theme: "fast-food" },
  { id: "hero", a: "Batman", b: "Superman", theme: "super-héros" },
];

export function getTraitrePairById(id) {
  return TRAITRE_WORD_PAIRS.find((p) => p.id === id) || null;
}

export function pickRandomTraitrePair() {
  const idx = Math.floor(Math.random() * TRAITRE_WORD_PAIRS.length);
  return TRAITRE_WORD_PAIRS[idx];
}
