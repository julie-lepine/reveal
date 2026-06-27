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

### Hot Take — auteur exclu du verdict *(corrigé ⚪)*

- [ ] 🧪 Take **custom** (« Hot take de X ») : le vote de **X** ne compte **pas** dans la majorité ni dans les points (comme TruthMeter)
- [ ] 🧪 Le vote de l'auteur reste **affiché** dans la liste des votes (juste non scoré)
- [ ] 🧪 Take du **pool** (sans vraie paternité) : **tous** les votes comptent (l'auteur round-robin interne n'est pas exclu)

---

## Clutch 💥 — nouveau jeu

> Chrono qui monte de 0 vers une cible (9–12 s), se masque un délai **aléatoire** avant la cible (1,5–3,5 s), tap à l'aveugle, podium 25/15/10 par manche.

### Mécanique de base
- [ ] 🧪 Prépa : choix 3 / 5 / 8 manches (hôte seul), invités voient le réglage se synchroniser
- [ ] 🧪 Le chrono **monte** de 0 et reste visible, puis **disparaît** (👀) avant la cible
- [ ] 🧪 Le délai de masquage **change à chaque manche** (pas toujours le même « avant la fin »)
- [ ] 🧪 Cible toujours entre **9 s et 12 s** (jamais > 12 s)
- [ ] 🧪 Tap autorisé **à tout moment** (chrono visible OU caché)
- [ ] 🧪 Verdict : classement par écart absolu à la cible, podium **+25 / +15 / +10**
- [ ] 🧪 Égalité d'écart → départage au **tap le plus tôt**
- [ ] 🧪 Pas de tap dans les temps (grâce 3 s) → **0 pt**, joueur listé « pas tapé »

### Phase aveugle « fun »
- [ ] 🧪 Bouton TAP qui **pulse** dès le masquage (s'arrête une fois tapé)
- [ ] 🧪 Punchlines qui **défilent** (👀 Bientôt… / 😬 / 🫣 / 🔥) à vitesse constante
- [ ] 🧪 **Vibration** au masquage et au tap (mobile)
- [ ] 🧪 **Pop** du bouton quand le tap est validé (passage au vert)
- [ ] 🧪 Chips « **X a tapé !** » visibles **uniquement** en phase aveugle (jamais quand le chrono est visible → pas de fuite d'estimation)
- [ ] 🧪 `prefers-reduced-motion` : animations coupées, jeu toujours jouable

### Multijoueur (plusieurs fenêtres)
- [ ] 🧪 Tous les clients **masquent le chrono au même moment** (délai synchronisé par l'hôte)
- [ ] 🧪 Un tap distant met à jour les chips + compteur **sans** réinitialiser mon chrono/animation
- [ ] 🧪 Compteur « Révéler maintenant (n/total) » cohérent (total = joueurs actifs)
- [ ] 🧪 Quand tout le monde a tapé → reveal automatique (hôte), invités suivent
- [ ] 🧪 Repli d'hôte absent : un invité peut **révéler / passer la manche**
- [ ] 🧪 Menu « Prochainement » : tuile Clutch avec badge (quand `enabled:false`)

---

## Audit complet — corrections 🔧

### 🔴 Robustesse / bugs logiques *(corrigés)*

- [ ] 🧪 **Guess The Lie** : l'indice de vote reconnaît la lettre **A** (index 0) une fois choisie (plus « Choisis la lettre… » à tort)
- [ ] 🧪 **Lobby** : aucun crash si `getLobby()` est null (messages / addMessage protégés par `?.`)
- [ ] 🧪 **Stockage** : navigation privée / quota plein → pas de crash (`localStorage`/`sessionStorage` en `try/catch` : auth, reset mdp, traître, fil rouge, état jeu)

### 🟠 Performance / synchro *(corrigés)*

- [ ] 🧪 **Lobby (heartbeat cosmétique)** : pas de re-render hub / refetch session à chaque ping quand rien d'utile n'a changé (signature)
- [ ] 🧪 **Menu des jeux** : le bandeau « Rejoindre » apparaît/disparaît via snapshot (plus de re-render forcé systématique)
- [ ] 🧪 **Sync en jeu** : pas de réécriture `localStorage` inutile quand la signature distante est inchangée
- [ ] 🧪 **Dilemma** : animation des barres annulée au démontage (plus de rAF orphelin) ; **reprise** : timer arrêté à 0 s

### 🟡 Erreurs runtime *(corrigées)*

- [ ] 🧪 **Trivia** : pas de crash si `answers` manquant (chaînage optionnel sur la bonne réponse)
- [ ] 🧪 **Tous les jeux** : `setLobbyPlaying(...)` fire-and-forget ne génère plus de rejet de promesse non géré

---

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

### Débounce « manche suivante » *(corrigé ⚪)*

- [ ] 🧪 Double-clic rapide sur **Manche suivante / Question suivante** ne saute **pas** de manche (helper `withClickLock`, 6 jeux)
- [ ] 🧪 Le bouton se **désactive** pendant l'action puis disparaît au re-render

### SpeedVote — compteur *(corrigé ⚪)*

- [ ] 🧪 « Révéler maintenant (n/total) » : le **total** = nombre de votants attendus (joueurs actifs), cohérent entre l'affichage initial et la mise à jour
