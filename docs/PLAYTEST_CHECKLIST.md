# REVEAL — Checklist playtest / retest

Checklist globale issue des soirées test. Une section par jeu ou zone à corriger.  
Légende : ☐ à tester · ✅ OK · ❌ bug (noter en bas)

---

- [ ] App qui plante au transfert d'hôte

## Global — bannière pub (app native) 📢

- [ ] 🧪 **Lobby** : titre / contenu entièrement visible sous la bannière
- [ ] 🧪 **Dilemma** : logo « DILEMMA » et carte question non coupés
- [ ] 🧪 **SpeedVote** : logo et question non coupés
- [ ] 🧪 **Spot the fake** : titre d'écran et bouton retour visibles
- [ ] 🧪 **Changement d'écran** (lobby → jeu → résultats) : pas de flash où le haut passe sous la pub
- [ ] 🧪 **Retour accueil** (sans pub) puis re-lobby : espacement correct à nouveau
- [ ] 🧪 **Encoche / barre de statut** (iPhone) : bouton ‹ retour bien placé
- [ ] 🧪 **Android** : même vérif sur au moins un device

---

### Résultats / Classement → nouveau jeu (MP)

- [ ] 🧪 Fin de partie → invité sur **Classement** → hôte relance un jeu → invité redirigé vers prep/jeu **sans** cliquer « Jeux » *(corrigé : le re-render du classement n'écrase plus la prépa)*
- [ ] 🧪 Même test invité sur **Résultats** *(corrigé idem)*
- [ ] 🧪 Invité **ouvre** le Classement alors que l'hôte est **déjà** en prépa → l'invité bascule bien en prépa (pas ré-écrasé sur le classement au montage)
- [ ] 🧪 Enchaînement 2 jeux (Dilemma → SpeedVote) : aucun invité bloqué sur Classement / Résultats
- [ ] 🧪 Consulter Classement **pendant** une manche en cours → pas renvoyé dans le jeu (suppress OK)

### Relance « Rejouer » (MP) — invité 🔁 *(corrigé)*

- [ ] 🧪 Hôte clique **Rejouer** depuis le podium → invité (sur podium/résultats) arrive bien en **prépa** du jeu relancé (pas renvoyé au podium)
- [ ] 🧪 Invité clique **prêt** en prépa juste après la relance → **reste** en prépa puis entre en jeu quand l'hôte lance (ne rebascule **pas** sur le podium)
- [ ] 🧪 Tester sur **plusieurs jeux** (Consensus, TruthMeter, Dilemma, SpeedVote, Hot Take…) : comportement identique
- [ ] 🧪 **Rejoindre la partie en cours** : invité au menu des jeux voit le bandeau « Rejoindre » apparaître **sans** repasser par l'Accueil dès que l'hôte (re)lance
- [ ] 🧪 Fin de partie *normale* (hôte → Résultats) : l'invité suit toujours bien vers **Résultats** (non régressé par l'inférence lobby)

### Lancer quand même (prep MP, hôte)

- [ ] 🧪 **TruthMeter** : `authorOrder` = uniquement les participants (pas les absents)
- [ ] 🧪 **Spot the fake** : `alive` = roster au lancement

### Onglet Jeux & reprise (MP)

- [ ] 🧪 **Partie en cours** : invité clique **Jeux** → menu des jeux **sans** reset des prêts prep / lobby
- [ ] 🧪 **Partie en cours** : hôte clique **Jeux** → menu des jeux, partie **non** terminée pour le lobby
- [ ] 🧪 **Rester ici** (invité) : pas renvoyé dans le jeu au prochain poll (15 min)
- [ ] 🧪 **Lobby par erreur** (prep ou partie active) : écran « Jeu en cours » + retour auto ~2 s ou **Rejoindre maintenant**
- [ ] 🧪 Lobby par erreur : **pas** de `resetAllParticipantsReady` tant qu'une session est active
- [ ] 🧪 **Quitter la partie** (bouton en jeu) : comportement inchangé - menu jeux + suppress invité OK
- [ ] 🧪 Hôte lance un **nouveau** jeu depuis le menu pendant qu'un invité est sur **Jeux** : invité suit la prep

### Retour arrière depuis une prépa (MP) 🔙 *(corrigé)*

- [ ] 🧪 **Invité** entre en prépa puis **retour** (plus envie de jouer) → reste sur le **menu des jeux**, **pas** de loop qui le renvoie dans la prépa quittée
- [ ] 🧪 Même test via l'onglet **Jeux** du bas (et pas seulement la flèche retour)
- [ ] 🧪 Après être sorti, l'hôte lance un **autre** jeu → l'invité **suit** bien vers la nouvelle prépa (la suppression ne bloque que le jeu quitté)
- [ ] 🧪 **Hôte** sort d'une prépa (retour) → session fermée ; l'invité encore en prépa est ramené au **lobby** (pas figé sur la prépa fantôme), y compris en polling (Realtime KO)
- [ ] 🧪 Tester sur plusieurs jeux (Consensus, SpeedVote, Dilemma…)

---

## Consensus 🤝 — joueur absent *(corrigé)*

- [ ] 🧪 Un joueur ne répond pas → l'hôte force le reveal → l'absent **n'est pas** compté dans la moyenne (la moyenne reflète uniquement les présents)
- [ ] 🧪 L'absent reçoit **0 pt** sur la manche mais **reste** au classement
- [ ] 🧪 Reveal : l'absent apparaît en « n'a pas répondu · non compté » (pas de valeur 50 %, pas d'écart, pas de tags bonus)
- [ ] 🧪 Message « Révéler maintenant » : libellé cohérent (« ne seront pas comptés », plus « recevront 50 % »)
- [ ] 🧪 2 joueurs, 1 absent : la moyenne = la réponse du seul présent (et pas tirée vers 50 %)
- [ ] 🧪 Tout le monde absent (force reveal) : manche non scorée, pas de plantage
- [ ] 🧪 Tout le monde répond : scoring/moyenne inchangés (non-régression)

---

## TruthMeter 📏 — curseur entre manches *(corrigé)*

- [ ] 🧪 **Invité** qui a voté à une manche puis devient **auteur** à une manche suivante → son curseur d'auteur s'ouvre bien à **50 %** (et pas sur sa valeur précédente)
- [ ] 🧪 Curseur de **vote** : toujours à 50 % au début de chaque manche (non régressé)
- [ ] 🧪 La saisie en cours de l'auteur n'est **pas** réinitialisée pendant sa propre manche (reset seulement au changement de manche)

---

## Hot Take 🔥
- [ ] Fin de manche : renvoi sur prépa au lieu de résultats
