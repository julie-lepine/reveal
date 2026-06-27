# REVEAL — Checklist playtest / retest

Checklist globale issue des soirées test. Une section par jeu ou zone à corriger.  
Légende : ☐ à tester · ✅ OK · ❌ bug (noter en bas)

---

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

### Onglet Jeux & reprise (MP)

- [ ] 🧪 **Partie en cours** : invité clique **Jeux** → menu des jeux **sans** reset des prêts prep / lobby
- [ ] 🧪 **Partie en cours** : hôte clique **Jeux** → menu des jeux, partie **non** terminée pour le lobby
- [ ] 🧪 **Rester ici** (invité) : pas renvoyé dans le jeu au prochain poll (15 min)
- [ ] 🧪 **Lobby par erreur** (prep ou partie active) : écran « Jeu en cours » + retour auto ~2 s ou **Rejoindre maintenant**
- [ ] 🧪 Lobby par erreur : **pas** de `resetAllParticipantsReady` tant qu'une session est active
- [ ] 🧪 **Quitter la partie** (bouton en jeu) : comportement inchangé - menu jeux + suppress invité OK
- [ ] 🧪 Hôte lance un **nouveau** jeu depuis le menu pendant qu'un invité est sur **Jeux** : invité suit la prep

---

## Clutch 💥 — nouveau jeu
- [ ] 🧪 Menu « Prochainement » : tuile Clutch avec badge (quand `enabled:false`)
- [ ] 🧪 **Décompte 3 · 2 · 1** au début de chaque manche : la cible `🎯 Objectif : X s` reste affichée, le bouton **TAP est désactivé/grisé**, puis le chrono démarre sa montée
- [ ] 🧪 **Chrono au millième** : le compteur défile en `8,342 s` (3 décimales) pendant la phase visible
- [ ] 🧪 Phase aveugle : le chrono se cache (`👀`) au délai aléatoire, punchlines + vibration, chips « X a tapé ! » uniquement caché
- [ ] 🧪 **Verdict** : chaque joueur affiché « tapé à X,XXX s · écart ±Y,YY s » + classement + points (25/15/10)
- [ ] 🧪 Tap impossible pendant le décompte (clic ignoré tant que le chrono n'a pas démarré)
- [ ] 🧪 MP (plusieurs fenêtres) : décompte + montée cohérents par client ; tous voient le verdict après clôture (grâce 3 s)

## Navigation scores (global) 📊🏆 — politique centralisée
- [ ] 🧪 En **prépa** ou **en jeu** : onglets « Résultats » / « Classement » de la barre du bas **grisés + non cliquables**
- [ ] 🧪 Sur accueil / menu jeux / lobby / résultats / classement / paramètres : onglets **cliquables**
- [ ] 🧪 Hôte sur `game-select` : les autres joueurs peuvent **consulter** Résultats / Classement sans être réjectés
- [ ] 🧪 L'hôte lance un jeu → les joueurs sont **transférés automatiquement** dans la prépa (et les onglets se grisent)
- [ ] 🧪 Boutons in-screen « Résultats » / « Classement » / « Autre jeu » (results, leaderboard, game-select) : même règle, plus de renvoi intempestif vers `game-select`

## TierNight 🏆 — placement & validation
- [ ] 🧪 Placer une tuile **ne fait plus sauter la page en haut** ; la position de scroll est conservée à chaque placement/retrait
- [ ] 🧪 **Aucun** bouton de validation tant que tous les items ne sont pas classés (plus de « Terminer maintenant »)
- [ ] 🧪 Une fois **tout classé** : bouton **« Valider ma tierlist »** ; on peut encore réajuster les tuiles avant de valider
- [ ] 🧪 La partie ne se clôture **que** sur clic « Valider ma tierlist » (plus de clôture auto au dernier placement)
- [ ] 🧪 MP : après validation, attente du lobby puis bascule vers les résultats quand tout le monde a terminé

---

## Audit complet — corrections 🔧

## Repli d'hôte absent (MP) 👑 *(corrigé ⚪ — approche présence)*

> Si l'hôte se déconnecte en pleine manche, un autre joueur peut désormais débloquer.
> Détection par heartbeat : un hôte est « absent » après ~2 min sans ping (`HOST_PRESENCE_STALE_MS`).

- [ ] 🧪 **Hôte présent** (cas normal) : comportement **strictement identique** à avant (l'acting-host = l'hôte réel)
- [ ] 🧪 **Hôte se déconnecte** pendant une manche (vote/reveal) → après ~2 min, **un seul** invité (le présent au plus petit userId) voit apparaître **Révéler / Manche suivante** et peut débloquer
- [ ] 🧪 L'invité de repli peut **révéler**, **scorer la manche** et passer à la **suivante** ; les autres suivent bien
- [ ] 🧪 Fin de partie : l'invité de repli peut atteindre le **podium / résultats** si l'hôte est absent
- [ ] 🧪 **Déterminisme** : un seul acting-host à la fois (pas de double reveal / double score) sur tous les jeux votants
- [ ] 🧪 L'hôte **revient** (re-heartbeat) → il **reprend** la main, l'invité de repli perd les contrôles
- [ ] 🧪 Contrôles restés **hôte-only** : relance « Rejouer » / réglages (Trivia, Consensus), rôle privé Traître — **pas** délégués à l'acting-host
- [ ] 🧪 Tester sur les jeux votants : Consensus, Trivia, Dilemma, Hot Take, SpeedVote, Guess The Lie, TruthMeter, VibeCheck, Spot the fake

