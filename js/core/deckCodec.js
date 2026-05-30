// Déshydratation / réhydratation des decks de jeu stockés dans game_sessions.state.
//
// Objectif (optimisation egress #7) : ne pas stocker les objets de questions
// complets dans le state Supabase (téléchargés à chaque lecture / pré-fetch),
// mais seulement une référence vers la banque locale (id) + les éléments
// "custom" (ajoutés par les joueurs) en inline.
//
// Règles de robustesse :
// - Idempotent : ré-appliquer dehydrate sur un deck déjà déshydraté ne casse rien.
// - Rétro-compatible : un deck "legacy" (objets complets déjà stockés en base)
//   est renvoyé tel quel par rehydrate.
// - Tolérant aux versions : un id introuvable dans la banque locale (skew de
//   version) renvoie un placeholder marqué `__missing` plutôt que de planter.
//
// Toutes les apps clientes chargent la même version hébergée pendant une soirée,
// donc les id de banque sont garantis résolvables en conditions normales.

import { TRIVIA_QUESTIONS } from "../../data/trivia.js";
import { CONSENSUS_QUESTIONS } from "../../data/consensus.js";
import { getDilemmaDeckItems, DILEMMA_CATALOG_ID } from "../../data/dilemma.js";
import { PLAYLIST_GUESS_SONGS } from "../../data/vibecheckSongs.js";

function buildIndex(items) {
  const map = Object.create(null);
  (items || []).forEach((it) => {
    if (it && it.id != null) map[String(it.id)] = it;
  });
  return map;
}

let _triviaIdx;
function triviaIndex() {
  return (_triviaIdx ||= buildIndex(TRIVIA_QUESTIONS));
}
let _consensusIdx;
function consensusIndex() {
  return (_consensusIdx ||= buildIndex(CONSENSUS_QUESTIONS));
}
let _dilemmaIdx;
function dilemmaIndex() {
  return (_dilemmaIdx ||= buildIndex(getDilemmaDeckItems(DILEMMA_CATALOG_ID)));
}
let _songIdx;
function songIndex() {
  return (_songIdx ||= buildIndex(PLAYLIST_GUESS_SONGS));
}

/** Un élément déjà déshydraté ? (réf banque `{ r }` ou custom inline `{ c }`). */
function isRef(entry) {
  return (
    entry &&
    typeof entry === "object" &&
    (typeof entry.r === "string" || "c" in entry)
  );
}

// --- Jeux à items "plats" (id au premier niveau) : consensus, dilemma --------

function dehydrateById(deck, index) {
  if (!Array.isArray(deck)) return deck;
  return deck.map((item) => {
    if (isRef(item)) return item;
    if (item && item.id != null && index[String(item.id)]) {
      return { r: String(item.id) };
    }
    return { c: item }; // custom / inconnu -> inline (auto-suffisant)
  });
}

function rehydrateById(deck, index) {
  if (!Array.isArray(deck)) return deck;
  return deck.map((entry) => {
    if (entry && typeof entry === "object") {
      if (typeof entry.r === "string") {
        const found = index[entry.r];
        if (found) return found;
        return { id: entry.r, __missing: true };
      }
      if ("c" in entry) return entry.c;
    }
    return entry; // legacy : objet complet déjà stocké
  });
}

export function dehydrateConsensusDeck(deck) {
  return dehydrateById(deck, consensusIndex());
}
export function rehydrateConsensusDeck(deck) {
  return rehydrateById(deck, consensusIndex());
}

export function dehydrateDilemmaDeck(deck) {
  return dehydrateById(deck, dilemmaIndex());
}
export function rehydrateDilemmaDeck(deck) {
  return rehydrateById(deck, dilemmaIndex());
}

// --- PlaylistGuess : item = { song: { id, title, artist, albumImage } } ------

export function dehydratePlaylistGuessDeck(deck) {
  if (!Array.isArray(deck)) return deck;
  const index = songIndex();
  return deck.map((item) => {
    if (isRef(item)) return item;
    const song = item && item.song;
    if (song && song.id != null && index[String(song.id)]) {
      return { r: String(song.id) };
    }
    return { c: item };
  });
}

export function rehydratePlaylistGuessDeck(deck) {
  if (!Array.isArray(deck)) return deck;
  const index = songIndex();
  return deck.map((entry) => {
    if (entry && typeof entry === "object") {
      if (typeof entry.r === "string") {
        const song = index[entry.r];
        if (song) {
          return {
            song: {
              id: song.id,
              title: song.title,
              artist: song.artist,
              albumImage: song.albumImage || null,
            },
          };
        }
        return { song: { id: entry.r, __missing: true } };
      }
      if ("c" in entry) return entry.c;
    }
    return entry;
  });
}

// --- Trivia : les réponses sont mélangées par partie ------------------------
// On stocke l'id + une permutation `a` (position d'affichage -> index banque),
// pour reconstruire à l'identique l'ordre des réponses et l'index `correct`.

export function dehydrateTriviaDeck(deck) {
  if (!Array.isArray(deck)) return deck;
  const index = triviaIndex();
  return deck.map((item) => {
    if (isRef(item)) return item;
    const bank = item && item.id != null ? index[String(item.id)] : null;
    if (!bank || !Array.isArray(item.answers) || !Array.isArray(bank.answers)) {
      return { c: item };
    }
    const perm = item.answers.map((ans) => bank.answers.indexOf(ans));
    if (perm.some((i) => i < 0)) return { c: item }; // réponse non résolvable -> inline
    return { r: String(item.id), a: perm };
  });
}

export function rehydrateTriviaDeck(deck) {
  if (!Array.isArray(deck)) return deck;
  const index = triviaIndex();
  return deck.map((entry) => {
    if (entry && typeof entry === "object") {
      if (typeof entry.r === "string") {
        const bank = index[entry.r];
        if (!bank) return { id: entry.r, __missing: true };
        const perm = Array.isArray(entry.a) ? entry.a : null;
        const answers = perm
          ? perm.map((i) => bank.answers[i])
          : (bank.answers || []).slice();
        const correct = perm ? perm.indexOf(bank.correct) : bank.correct;
        return { ...bank, answers, correct };
      }
      if ("c" in entry) return entry.c;
    }
    return entry;
  });
}
