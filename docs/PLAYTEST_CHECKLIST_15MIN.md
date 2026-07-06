# REVEAL — Checklist playtest 15 min

Session courte pour valider les correctifs récents (sync MP, votes, navigation, badges, TierNight).  
**Setup :** 4 joueurs (1 hôte + 3 invités, ou 2 comptes + 2 invités), multijoueur actif, ~3–5 min par bloc.

Légende : ☐ à tester · ✅ OK · ❌ bug (noter en bas)

**Correctifs couverts par cette checklist :**
- Vote en 2 étapes (sélection → « Valider mon vote ») — Hot Take, Dilemma, Traître
- Sync reveal MP (hôte + invités passent au reveal ensemble)
- Prêt prep / navigation Classement–menu jeux
- Badges synchronisés en multijoueur
- TierNight : sync invités, médiane groupe, forcer résultats, renommage Rank it

---

## Bloc A — Sync fondations (~5 min)

### Hot Take **et** Dilemma (1 manche chacun, ou au moins les deux scénarios)

**Vote en 2 étapes**

- [ ] Clic sur une option = **sélection locale** seulement (pas de reveal auto)
- [ ] « Valider mon vote » **envoie** le vote · bouton se grise après validation
- [ ] Invité peut **changer d’avis** avant validation (re-cliquer une autre option, puis re-valider)
- [ ] Hôte voit **4/4** sur « Révéler maintenant » quand les 4 ont **validé** (pas seulement sélectionné)

**Reveal synchronisé (fix récent)**

- [ ] Hôte clique « Révéler maintenant » → **les 4 écrans** passent au reveal **en même temps** (pas l’hôte seul)
- [ ] Invités voient les **résultats / barres / scores manche** (pas bloqués sur l’écran de vote)
- [ ] Reveal forcé à **3/4** (un joueur n’a pas validé) : hôte révèle quand même → invités suivent
- [ ] Tester sur **Hot Take** et sur **Dilemma** (les deux jeux)

**Prep — prêt**

- [ ] N’importe quel prep, relance rapide : tous cliquent **Prêt** → l’hôte voit **4/4** prêts (pas de joueur « fantôme »)

**Navigation**

- [ ] Invité ouvre **Classement** entre deux jeux → **pas** de flash retour vers le dernier jeu
- [ ] Hôte relance un jeu depuis le menu → invité sur Classement bascule vers la **prep** sans clic

---

## Bloc B — Scores & badges (~4 min)

- [ ] Invité **quitte puis rejoint** le lobby → ses points soirée sont **restaurés** (pas 0)
- [ ] **Résultats** : ligne « En tête » affiche le **badge** (ex. « Alice · Le détective »)
- [ ] **Classement** : même joueur a le **même badge** sous son nom (podium ou liste) — **vérifier sur 2 appareils** (hôte + invité)
- [ ] Pendant une partie : classement in-game trié par **score de la manche**, pas score soirée

---

## Bloc C — Spot the Fake (~4 min)

- [ ] Lancement : les **4 écrans** arrivent en jeu (pas un invité bloqué en prep)
- [ ] **Tour 1** : hôte choisit Continuer ou Voter · **Tour 2+** : vote auto
- [ ] Fin de partie : détail des points (survivant / détective / intuition / survie fake)
- [ ] Bouton **Rejouer** visible en fin de partie

---

## Bloc D — TierNight (~5 min)

**Setup TierNight :** 4 joueurs (**2 comptes + 2 invités**), liste intégrée (pas de tier list custom).  
Tester les **3 modes dans l’ordre d’affichage** : Rank it → Classe le groupe → En direct.

### Rank it (ex-Consensus)

- [ ] Les **4 écrans** arrivent en jeu (invités ne restent pas sur « Choisis un mode »)
- [ ] Les 4 classent et valident → écran d’attente puis **récap commun**
- [ ] **Board groupe** : sur un item test, 2 joueurs en **A** + 2 en **D** → le groupe affiche **B** (médiane)
- [ ] Fin : bloc **« Détail de tes points »** (item · ton tier · groupe · +X)
- [ ] Pendant le classement : hint **+15 / +10** visible sous le titre

### Classe le groupe

- [ ] Lancement : les **4 invités** suivent l’hôte (pas bloqués sur `tiernight-select`)
- [ ] Les comptes jouent ; si 2 invités **n’arrivent pas** en jeu → hôte voit **« Voir les résultats (X/4) »**
- [ ] Forcer les résultats → récap s’affiche ; absents **non comptés** dans le board groupe

### En direct

- [ ] Lancement : les **4 écrans** arrivent en mode live (pas de rebond vers la sélection de mode)
- [ ] Hôte peut **« Révéler maintenant »** si un joueur n’a pas voté
- [ ] Fin de partie : board groupe cohérent (pas tout en **D** à cause des absents)
- [ ] Scores alignés avec le board groupe

### Polish (rapide)

- [ ] Emojis profil : grille **scrollable**
- [ ] Réponse choisie **bien visible** (surbrillance forte) dans un jeu à choix

---

## Notes bugs

| # | Bloc | Description | Joueur / rôle |
|---|------|-------------|---------------|
| 1 | | | |
| 2 | | | |

---

## Si tout est ✅
