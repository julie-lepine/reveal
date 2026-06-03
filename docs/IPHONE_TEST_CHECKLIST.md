# REVEAL — Checklist test iPhone (Mac + Xcode)

À utiliser **le jour où tu as le Mac** (équivalent Android Studio pour iOS).  
Complète la section **E** de [STORE_CHECKLIST.md](./STORE_CHECKLIST.md) quand tout est coché ici.

Légende : ☐ à faire · 🧪 test sur device · ✅ OK · ❌ bug (noter en bas)

---

## Avant d’ouvrir Xcode (sur le Mac)

- [ ] **Node.js ≥ 22** : `node -v`
- [ ] Repo à jour (clone ou clé USB / Git depuis ton PC Windows)
- [ ] `js/config/supabase.js` présent (clés — **org de test** OK pour ces essais)
- [ ] `js/config/turnstile.js` présent (Site Key Cloudflare)
- [ ] iPhone : câble USB, déverrouillé, **Faire confiance** à l’ordinateur
- [ ] iOS **Mode développeur** activé si Xcode le demande (Réglages → Confidentialité et sécurité)
- [ ] Compte **Apple ID** connecté dans Xcode (Settings → Accounts)

```bash
cd chemin/vers/PARTYGAMES-APP
npm install
npm run cap:sync
# optionnel si tu veux régénérer icône/splash :
# npm run assets:sync
npm run cap:open:ios
```

---

## B. Premier lancement dans Xcode

- [ ] Projet ouvert (workspace dans `ios/`)
- [ ] Target **App** sélectionnée
- [ ] En haut : **ton iPhone physique** (pas seulement « iPhone 16 Simulator »)
- [ ] **Signing & Capabilities** :
  - [ ] Team = ton compte Apple
  - [ ] Bundle Identifier = `com.reveal.partygames` (sans conflit)
  - [ ] Signing réussi (pas d’erreur rouge)
- [ ] ▶ **Run** → l’app s’installe et démarre sur l’iPhone
- [ ] 🧪 Lancer aussi **depuis l’icône** sur l’écran d’accueil (pas seulement depuis Xcode)

| Problème fréquent | Piste |
|-------------------|--------|
| « Untrusted Developer » sur l’iPhone | Réglages → Général → VPN et gestion de l’appareil → faire confiance |
| Erreur de signature | Changer Team ou créer un profil automatique dans Signing |
| Build échoue Node | Relancer `npm run cap:sync` sur le Mac |

---

## C. Parcours de base (sans réseau critique)

- [ ] 🧪 **Welcome** → accueil / connexion
- [ ] 🧪 **Écran d’intro** puis navigation normale
- [ ] 🧪 **Icône** correcte sur l’écran d’accueil iOS
- [ ] 🧪 **Splash** au cold start (logo, fond sombre — pas logo Capacitor bleu par défaut)
- [ ] 🧪 Rotation / encoche : UI lisible (pas de boutons sous la barre système)

Après chaque changement de code web :

```bash
npm run cap:sync
```

Puis ▶ Run dans Xcode (ou *Product → Clean Build Folder* si comportement bizarre).

---

## D. Auth & Turnstile (WebView iOS)

- [ ] 🧪 **Connexion email** + mot de passe (widget Turnstile visible, pas d’erreur 600010 en console Safari si tu branches le Mac)
- [ ] 🧪 **Inscription** email
- [ ] 🧪 **Invité** + pseudo + code lobby (Turnstile sur le flux invité si affiché)
- [ ] 🧪 **Mot de passe oublié** : saisie email → mail reçu (Resend)

Réf. Turnstile hostnames : `localhost`, `127.0.0.1`, `julie-lepine.github.io` — pas besoin d’ajouter un hostname « iPhone » ; c’est la WebView de l’app.

---

## E. Deep link — reset mot de passe (priorité store)

**Deep link** = le lien du mail doit **rouvrir l’app** sur l’écran **nouveau mot de passe**, pas rester bloqué dans Safari.

URL attendue côté Supabase : `com.reveal.partygames://auth/callback`  
(déjà dans [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) / [CAPACITOR.md](./CAPACITOR.md))

- [ ] 🧪 Depuis l’**app sur iPhone** : Mot de passe oublié → envoyer le mail
- [ ] 🧪 Ouvrir le mail sur le **même iPhone** (app Mail ou Gmail)
- [ ] 🧪 **Tap sur le lien** → REVEAL s’ouvre (ou revient au premier plan)
- [ ] 🧪 Écran **`reset-password`** (nouveau MDP + confirmation)
- [ ] 🧪 Enregistrer → se reconnecter avec le **nouveau** mot de passe
- [ ] ❌ Si Safari s’ouvre sans repasser par l’app : noter le comportement + URL affichée dans la barre d’adresse

Test variante (optionnel) : ouvrir le lien depuis Notes / Messages pour voir si le schéma `com.reveal.partygames://` est bien enregistré.

---

## F. Multijoueur Supabase

Utilise l’**org / projet de test** actuel (egress : 1 onglet, fermer le lobby après).

**2ᵉ joueur** (au choix) :

- un **2ᵉ iPhone** (même procédure Xcode ou TestFlight plus tard), ou
- **navigateur** : [https://julie-lepine.github.io/reveal/](https://julie-lepine.github.io/reveal/), ou
- ton **Android** déjà configuré

- [ ] 🧪 **Créer lobby** (hôte) sur iPhone
- [ ] 🧪 **Rejoindre** avec le 2ᵉ client (code ou lien d’invitation)
- [ ] 🧪 Liste joueurs, prêt, wizz hôte
- [ ] 🧪 **Lancer une soirée** → menu jeux
- [ ] 🧪 **1 jeu court** (ex. Hot Take ou Trivia) : sync votes / écran hôte ↔ invité
- [ ] 🧪 **Fil Rouge** (optionnel) : setup + mission si tu l’utilises souvent
- [ ] 🧪 **Quitter / fermer lobby** (hôte) → invité bien renvoyé
- [ ] 🧪 **Reprendre** après kill app + réouverture (session / lobby selon ton scénario)

---

## G. Publicité AdMob & confidentialité (iOS)

- [ ] 🧪 **Pas** de bannière sur : welcome, home, reset-password, écrans de connexion pure
- [ ] 🧪 Bannière **visible** à partir du **lobby** / jeux (haut de l’écran)
- [ ] 🧪 Au premier lancement pub : popup **consentement** (UMP / RGPD) en UE
- [ ] 🧪 Popup **ATT** iOS (« Autoriser le suivi ») — accepter / refuser : l’app ne plante pas
- [ ] 🧪 Mode test AdMob OK (`ADMOB_USE_TEST_ADS = true` dans `data/admobConfig.js`)

---

## H. Stabilité & confort

- [ ] 🧪 Passage **lobby → jeu → résultats → menu jeux** sans écran blanc
- [ ] 🧪 App en **arrière-plan** 30 s pendant une partie → retour, sync OK
- [ ] 🧪 **Paramètres** / politique de confidentialité : liens HTTPS OK
- [ ] 🧪 Pas de crash au retour arrière (geste iOS ou bouton in-app)

---

## I. Soirée pilote (optionnel, même jour ou lendemain)

- [ ] 3–4 personnes, 1 iPhone hôte + autres (web ou Android)
- [ ] 2–3 jeux différents, 30–45 min
- [ ] Noter bugs UX (clavier, safe area, perf)

---

## J. Notes de bugs (remplir sur place)

| # | Écran / action | Attendu | Obtenu |
|---|----------------|---------|--------|
| 1 | | | |
| 2 | | | |
| 3 | | | |

---

## K. Quand tout est vert

- [ ] Cocher **🧪 iPhone** et les lignes associées dans [STORE_CHECKLIST.md](./STORE_CHECKLIST.md) § E
- [ ] Corriger les bugs sur Windows → `npm run cap:sync` → retest rapide au Mac
- [ ] **Ne pas** soumettre au store depuis l’org Supabase en dépassement : nouvelle org REVEAL avant launch (cf. [SUPABASE_EGRESS.md](./SUPABASE_EGRESS.md))

---

## Liens utiles

| Doc | Sujet |
|-----|--------|
| [CAPACITOR.md](./CAPACITOR.md) | Workflow `cap:sync` / iOS |
| [STORE_CHECKLIST.md](./STORE_CHECKLIST.md) | Publication globale |
| [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) | Redirect URLs, Realtime |
| [RESEND_SETUP.md](./RESEND_SETUP.md) | Mails reset MDP |

**Bundle ID** : `com.reveal.partygames`  
**Deep link auth** : `com.reveal.partygames://auth/callback`
