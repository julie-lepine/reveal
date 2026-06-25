# REVEAL — Checklist playtest / retest

Checklist globale issue des soirées test. Une section par jeu ou zone à corriger.  
Légende : ☐ à tester · ✅ OK · ❌ bug (noter en bas)

---

## Vue d'ensemble

| Jeu | Patch / sujet | Statut code |
|-----|---------------|-------------|
| **Spot the fake** | Fin manche 1 : choix hôte visible (boutons désactivés invités) | ✅ patché |
| **Spot the fake** | Clôture globale du vote par l'hôte (votes partiels OK) | ✅ patché |
| **Spot the fake** | Phase révélation des mots : tour dédié + compteur prêts | ✅ patché |
| **Spot the fake** | Tour des mots à l'oral : phase collective (plus de tour par tour) | ✅ patché |
| **Spot the fake** | Recommencer : tous en prep + nouvelle paire de mots | ✅ patché |
| **Spot the fake** | Points « majorité » | ⏸ reporté |
| **Global (app native)** | Bannière pub : contenu non rogné sous la bannière | ✅ patché |
| **Dilemma** | Hôte bloqué sur « Révéler maintenant 5/5 » (manche 2+) | ✅ patché |
| **Global** | Scroll en haut à chaque changement d'écran | ✅ patché |
| **Global** | Prep MP : « pas prêt » ne repasse pas « prêt » au poll | ✅ patché |
| **Global** | Transfert volontaire du rôle d'hôte (menu jeux) | ✅ patché |
| **Global** | Invités Résultats / Classement suivent le nouveau jeu | ✅ patché |
| **Global** | Prep MP : lancer quand même (roster prêts + hôte) | ✅ patché |
| **TruthMeter** | Hôte : passer auteur absent (phase writing) | ✅ patché |
| **Global** | Onglet Jeux sans quitter prep/partie + reprise lobby | ✅ patché |
| **Global** | Rejoin mid-soirée : pas de reset lobby d'attente | ✅ patché |
| **Consensus** | Réponses imputées (50 %) : avertissement hôte + label résultats + merge MP | ✅ patché |
| **Hot Take** | Ton outsider : règles, prep, vote, bandeau révélation, badge | ✅ patché |
| *(autres jeux)* | - | - |

---

## Spot the fake 🎭

### Tour des mots à l'oral (phase collective)

- [ ] 🧪 Titre écran : **« Tour des mots à l'oral »**
- [ ] 🧪 Sous-titre : **« X survivant(s) · tour des mots N »**
- [ ] 🧪 Carte : **« Tour des mots — manche N »** + consigne ordre libre (sans prononcer son mot)
- [ ] 🧪 **Pas** de liste numérotée ni de joueur « en cours »
- [ ] 🧪 Tous les survivants visibles en grille (avatars + prénoms)
- [ ] 🧪 **Hôte** : bouton **« Finaliser le tour des mots → »** (un seul clic pour clôturer la manche)
- [ ] 🧪 **Joueur non-hôte** : *« En attente que l'hôte finalise le tour quand tout le monde a parlé… »*
- [ ] 🧪 **Manche 1** : finalisation → écran **« Fin de manche 1 »** pour tout le lobby
- [ ] 🧪 **Manche 2+** : finalisation → phase **vote** pour tout le lobby
- [ ] 🧪 **Manche 2+** : rappel « indices différents des manches précédentes »
- [ ] 🧪 **Égalité au vote** : bandeau égalité puis retour tour des mots (mêmes mots)
- [ ] 🧪 Sync multijoueur : invités voient la même UI sans recharger

### Recommencer une partie (MP)

- [ ] 🧪 Fin de partie → hôte **Recommencer une partie** → **tous** les joueurs arrivent sur **Préparation** (sans passer par Jeux)
- [ ] 🧪 Invité encore sur l'écran de jeu (révélation / tour des mots) : bascule auto vers prep
- [ ] 🧪 **2ᵉ lancement** : nouvelle paire de mots (différente de la partie précédente)
- [ ] 🧪 Fake et civils n'ont **pas** tous le même mot secret
- [ ] 🧪 Prêts / lancement 2ᵉ partie : sync OK pour tout le lobby

### Fin de manche 1 — choix hôte

- [X] 🧪 **4+ joueurs** : après le tour des mots de la manche 1, tous arrivent sur « Fin de manche 1 »
- [ ] 🧪 **Joueur non-hôte** : voit « Continuer (indices) » et « Voter maintenant » **grisés**
- [ ] 🧪 **Joueur non-hôte** : message « Choix de l'hôte — tu ne peux pas agir. »
- [x] 🧪 **Hôte** : « Continuer » → tour des mots manche 2 pour tout le lobby
- [x] 🧪 **Hôte** : « Voter maintenant » → phase vote pour tout le lobby
- [X] 🧪 Sync multijoueur : les invités voient le changement sans recharger

### Clôture du vote (hôte)

- [X] 🧪 **0 vote** : bouton « Clôturer le vote » désactivé
- [KO] 🧪 **2/5 ont voté** : hôte clique « Clôturer » → résolution immédiate (seuls les votes exprimés comptent)
- [X] 🧪 **Tous ont voté** : résolution auto **ou** clôture manuelle — les deux OK
- [X] 🧪 **Égalité** (ex. 2 vs 2) : bandeau égalité + nouveau tour des mots
- [X] 🧪 **Joueur non-hôte** : pas de bouton clôturer
- [ ] 🧪 **Joueur éliminé** : ne vote pas ; clôture possible avec moins de votes que de survivants

### Révélation des mots (début de partie) TOUT KO

- [ ] 🧪 Titre écran : **« Révélation des mots »**
- [ ] 🧪 Bandeau : « Tour dédié — lis ton mot en privé »
- [ ] 🧪 Compteur **X/Y joueur(s) prêt(s)** visible et synchronisé
- [ ] 🧪 Après validation : « ✓ Mot mémorisé — en attente des autres joueurs… »
- [ ] 🧪 Dernier joueur valide → passage auto au **tour des mots à l'oral** (hôte)

### Non-régression Spot the fake

- [X] 🧪 Partie complète M1 → continuer → tour des mots M2 → vote → élimination → suite
- [ ] 🧪 Fake dans les 2 derniers → victoire fake + points
- [X] 🧪 Fake éliminé → révélation + scores (+20 vote correct)
- [X] 🧪 Égalité au vote → tour des mots supplémentaire
- [X] 🧪 Minimum 3 joueurs : lancement OK
- [ ] 🧪 Retour menu jeux sans bloquer le lobby

### À faire plus tard (Spot the fake)

- [ ] Points bonus « dans la majorité » (règle à définir)

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

### Scroll en haut à chaque écran

- [ ] 🧪 Lobby → prep → jeu → résultats : contenu toujours affiché depuis le haut
- [ ] 🧪 Barre du bas (Accueil / Jeux / Résultats) : pas de scroll conservé
- [ ] 🧪 Retour arrière (‹) : remonte en haut
- [ ] 🧪 iPhone + Android (WebView)

### Bouton « Je suis prêt » (tous les preps MP)

- [ ] 🧪 Hot Take : prête → **pas prête** → reste pas prête après 30 s
- [ ] 🧪 Dilemma / SpeedVote / autre prep : même test
- [ ] 🧪 Les autres joueurs peuvent toujours apparaître prêts pendant que tu ne l'es pas

### Transfert d'hôte (menu jeux)

- [ ] 🧪 **Hôte**, 3+ joueurs : bouton « Transférer l'hôte » visible sur la liste des jeux
- [ ] 🧪 Pop-up : texte explicatif + liste déroulante des joueurs (sans soi)
- [ ] 🧪 Confirmation → message chat « X est maintenant l'hôte »
- [ ] 🧪 **Nouvel hôte** : peut lancer un jeu, modifier les réglages prep, piloter la manche en cours
- [ ] 🧪 **Ancien hôte** : plus de boutons hôte ; peut quitter le lobby **sans** fermer la soirée
- [ ] 🧪 **Invités** : voient le changement (couronne / couleur) sans recharger
- [ ] 🧪 Erreur si RPC non déployée : message clair (pas de crash)
- [ ] 🧪 Spot the fake en cours : nouvel hôte peut faire avancer la partie

### Résultats / Classement → nouveau jeu (MP)

- [ ] 🧪 Fin de partie → invité sur **Classement** → hôte relance un jeu → invité redirigé vers prep/jeu **sans** cliquer « Jeux »
- [ ] 🧪 Même test invité sur **Résultats**
- [ ] 🧪 Invité ouvre l'onglet **Classement** pendant la prep → suit quand l'hôte lance la partie
- [ ] 🧪 Hôte part au menu via onglet **Jeux** (barre du bas) puis lance → invités suivent
- [ ] 🧪 Enchaînement 2 jeux (Dilemma → SpeedVote) : aucun invité bloqué sur Classement
- [ ] 🧪 Consulter Classement **pendant** une manche en cours → pas renvoyé dans le jeu (suppress OK)

### Lancer quand même (prep MP, hôte)

- [ ] 🧪 **5 joueurs, 3 prêts** (min. atteint) : hôte voit « Lancer quand même (3 joueurs) »
- [ ] 🧪 Clic → modale liste **inclus** / **exclus** → confirmation
- [ ] 🧪 Partie démarre pour les prêts + hôte ; les absents restent dans le lobby sans jouer
- [ ] 🧪 **TruthMeter** : `authorOrder` = uniquement les participants (pas les absents)
- [ ] 🧪 **Spot the fake** : `alive` = roster au lancement
- [ ] 🧪 **VibeCheck** : votes ciblent uniquement les participants
- [ ] 🧪 Tous prêts → bouton normal « Lancer » (pas de « quand même »)
- [ ] 🧪 Moins que le minimum prêts → pas de bouton « quand même »
- [ ] 🧪 Hot Take / Dilemma / SpeedVote / Consensus / Trivia : même flux hôte

### TruthMeter — auteur absent

- [ ] 🧪 Phase **writing**, auteur parti / inactif : hôte voit « Passer cet auteur (absent) »
- [ ] 🧪 Clic → manche suivante pour tout le lobby (sans affirmation ni points pour l'auteur sauté)
- [ ] 🧪 Dernier auteur sauté → résultats finaux
- [ ] 🧪 Invité : pas de bouton passer ; sync OK après action hôte
- [ ] 🧪 Phase **vote** : « Révéler maintenant » inchangé (filet déjà en place)

### Onglet Jeux & reprise (MP)

- [ ] 🧪 **Partie en cours** : invité clique **Jeux** → menu des jeux **sans** reset des prêts prep / lobby
- [ ] 🧪 **Partie en cours** : hôte clique **Jeux** → menu des jeux, partie **non** terminée pour le lobby
- [ ] 🧪 **Invité** sur menu jeux pendant une manche : bandeau « X en cours » + **Rejoindre** / **Rester ici**
- [ ] 🧪 **Rester ici** (invité) : pas renvoyé dans le jeu au prochain poll (15 min)
- [ ] 🧪 **Lobby par erreur** (prep ou partie active) : écran « Jeu en cours » + retour auto ~2 s ou **Rejoindre maintenant**
- [ ] 🧪 Lobby par erreur : **pas** de `resetAllParticipantsReady` tant qu'une session est active
- [ ] 🧪 **Quitter la partie** (bouton en jeu) : comportement inchangé - menu jeux + suppress invité OK
- [ ] 🧪 Hôte lance un **nouveau** jeu depuis le menu pendant qu'un invité est sur **Jeux** : invité suit la prep

### Rejoin mid-soirée (4ᵉ joueur, entre deux jeux)

- [ ] 🧪 **2 jeux joués** : tout le monde sur le **menu jeux** (pas lobby d'attente)
- [ ] 🧪 **4ᵉ joueur rejoint** : il arrive sur le **menu jeux** (ou résultats), **pas** « Commencer la soirée » / « L'hôte va lancer la soirée… »
- [ ] 🧪 Les **3 déjà là** restent sur le menu jeux (pas renvoyés au lobby d'attente)
- [ ] 🧪 Accueil : bouton **« Reprendre la soirée »** (pas « Retour au lobby ») tant que la soirée a commencé
- [ ] 🧪 **Reprise app** (F5) entre deux jeux → menu jeux, scores conservés
- [ ] 🧪 Ouvrir l'écran lobby par erreur mid-soirée → redirection menu jeux (pas reset des prêts)

---

## Dilemma ⚖️

### Révélation (vote → résultats)

- [ ] 🧪 **Manche 2+**, 5 joueurs, tous votent → révélation auto (hôte + invités)
- [ ] 🧪 **Manche 2+**, hôte clique « Révéler maintenant (5/5) » → écran résultats immédiat
- [ ] 🧪 **Manche suivante** → nouveau vote OK (pas de blocage)
- [ ] 🧪 Partie complète jusqu'aux résultats finaux
- [ ] 🧪 Réseau coupé au clic « Révéler » → toast erreur, pas d'écran figé sur 5/5
- [ ] 🧪 Après erreur réseau, re-clic ou resync → révélation OK sans double points

---

## Consensus 🤝

### Validation de la réponse (slider)

- [ ] 🧪 **Avant validation** : le **% affiché** correspond bien à la position du slider (pas seulement le doigt)
- [ ] 🧪 Déplacer le slider **sans** cliquer « Valider ma réponse » → réponse **non** comptée
- [ ] 🧪 Après **« Réponse enregistrée ✓ »** : slider verrouillé, le % affiché est **définitif**
- [ ] 🧪 Geste vertical sur le slider interprété comme scroll → le % ne change pas (re-tester le réglage avant de valider)

### Révélation (hôte, MP)

- [ ] 🧪 Compteur **X/Y** sur « Révéler maintenant » se met à jour quand un joueur valide
- [ ] 🧪 **X &lt; Y** : message d'avertissement « → 50 % par défaut si tu révèles maintenant »
- [ ] 🧪 Clic **Révéler maintenant** avec joueurs manquants : modale de confirmation (noms + 50 % par défaut)
- [ ] 🧪 **Annuler** la modale → manche toujours en cours, pas de révélation
- [ ] 🧪 **Y/Y** sans clic force : révélation **auto** pour tout le lobby
- [ ] 🧪 Invité : pas de bouton « Révéler maintenant »

### Résultats & imputation

- [ ] 🧪 Joueur sans validation forcée par l'hôte : ligne **« X / 100 · non validé »** (50 % imputé)
- [ ] 🧪 Joueur ayant validé : **pas** de mention « non validé »
- [ ] 🧪 **4+ joueurs**, manche complète : scores cohérents avec les réponses validées
- [ ] 🧪 Manche suivante : nouveau slider à 50 %, validation OK

### Non-régression Consensus

- [ ] 🧪 Partie solo / local : NPC répondent, révélation auto OK
- [ ] 🧪 Partie MP complète jusqu'au podium
- [ ] 🧪 Réseau lent : pas d'écrasement d'une réponse validée (ex. 72) par un 50 imputé côté joueur

---

## Hot Take 🔥

### Ton outsider

- [ ] 🧪 **Prep** : intro « troupeau (+10) / outsider (+15) » visible
- [ ] 🧪 **Avant vote** : rappel « parfois mieux d'être outsider »
- [ ] 🧪 **Phase vote** : tip +15 vs +10 affiché
- [ ] 🧪 **Révélation** : bandeau outsider (solo ou camp) avec noms + points
- [ ] 🧪 **Joueur local outsider** : message perso « pas dans le troupeau »
- [ ] 🧪 **Joueur local troupeau** : message perso + rappel +15 outsiders
- [ ] 🧪 **Liste votes** : tag « outsider » + 🔥 sur les camps minoritaires
- [ ] 🧪 **Égalité** : aucun point, pas de bandeau outsider
- [ ] 🧪 **Badge soirée** : « L'outsider en chef » sur le bon profil

---

## Autres jeux

*(Sections à compléter au fil des retours playtest.)*

---

## Bugs rencontrés en retest

| Date | Jeu | Device / joueurs | Étape | Description |
|------|-----|------------------|-------|-------------|
|      |     |                  |       |             |
