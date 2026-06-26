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

## Global — navigation & prep

- [ ] Toast sur nouvel hote quand transfert 

### Bouton « Je suis prêt » (tous les preps MP)

- [ ] 🧪 Hot Take : prête → **pas prête** → reste pas prête après 30 s
- [ ] 🧪 Dilemma / SpeedVote / autre prep : même test
- [ ] 🧪 Les autres joueurs peuvent toujours apparaître prêts pendant que tu ne l'es pas

### Résultats / Classement → nouveau jeu (MP)

- [X] 🧪 Fin de partie → invité sur **Classement** → hôte relance un jeu → invité redirigé vers prep/jeu **sans** cliquer « Jeux »
- [X] 🧪 Même test invité sur **Résultats**
- [ ] 🧪 Enchaînement 2 jeux (Dilemma → SpeedVote) : aucun invité bloqué sur Classement
- [ ] 🧪 Consulter Classement **pendant** une manche en cours → pas renvoyé dans le jeu (suppress OK)

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

---

## Hot Take 🔥
- [ ] Fin de manche : renvoi sur prépa au lieu de résultats
