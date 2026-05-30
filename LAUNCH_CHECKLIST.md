# REVEAL — Checklist lancement (web)

App en production : **https://julie-lepine.github.io/reveal/**

Utilise cette liste avant une soirée pilote ou une « vraie » ouverture. Coche au fur et à mesure.

---

## 1. Code & déploiement

- [ ] Toutes les modifs locales sont **sauvegardées** (Ctrl+S / Save All)
- [ ] `git status` propre ou commit prêt
- [ ] **Push** sur la branche GitHub Pages
- [ ] Après deploy : **hard refresh** (Ctrl+Shift+R) ou navigation privée
- [ ] Si l’ancienne version s’affiche : incrémenter `?v=` dans `index.html` (`main.js`, `style.css`) — actuellement **v=74** / **v=17**

Fichiers de config à ne pas oublier en prod (déjà dans le repo si tu as commit) :

| Fichier | Rôle |
|---------|------|
| `js/config/supabase.js` | URL + clé anon |
| `js/config/turnstile.js` | Site Key Cloudflare |

---

## 2. Supabase (dashboard)

Référence détaillée : [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)

### Auth

- [ ] **Email** activé
- [ ] **Anonymous** activé (onglet Invité obligatoire)
- [ ] **Confirm email** : désactivé si tu veux inscription immédiate
- [ ] **URL Configuration** : `https://julie-lepine.github.io/reveal/` (+ `/index.html` si tu l’utilises)
- [ ] Même URL en local si tu testes : `http://localhost:…`

### Turnstile (Attack Protection)

- [ ] Captcha **activé** (Turnstile)
- [ ] **Secret Key** Supabase = secret du widget « Reveal »
- [ ] **Site Key** = celle dans `js/config/turnstile.js`
- [ ] Hostnames Cloudflare : `julie-lepine.github.io` (+ `localhost` pour dev)

### Base de données

- [ ] `supabase/schema.sql` exécuté
- [ ] `supabase/game-sessions.sql`
- [ ] `supabase/fil-rouge-private.sql`
- [ ] `supabase/lobby-nudge.sql`
- [ ] `supabase/lobby-members-unique-name.sql` (pseudo unique par lobby)
- [ ] Correctifs RLS si besoin : `fix-rls-recursion.sql`, `fix-lobbies-insert.sql`, `lobby-host-close.sql`

### Realtime

Réplication activée sur : `lobbies`, `lobby_members`, `lobby_messages`, `game_sessions` (+ `fil_rouge_private` si Fil Rouge privé)

### Emails

- [ ] Template reset MDP (optionnel) : `supabase/email-reset-password.html`
- [ ] Quotas email OK ou SMTP (Resend) si beaucoup d’inscriptions / resets

---

## 3. Cloudflare Turnstile

- [ ] Connexion : widget visible → pas d’erreur **600010** dans la console
- [ ] Inscription : idem
- [ ] Mot de passe oublié : widget dans la modale email
- [ ] Test **sans bloqueur** (uBlock, Brave Shields…) sur la prod

---

## 4. Test soirée pilote (~30 min, 3–4 personnes)

- [ ] Hôte : compte email → créer lobby → code / QR
- [ ] Invité : onglet **Invité** + code (ou 2e navigateur / téléphone)
- [ ] Lancer **SpeedVote** ou **Consensus** (court)
- [ ] **Arrêter la partie** → retour menu jeux → autre jeu
- [ ] **Quitter le lobby** / réinitialiser l’app si besoin
- [ ] Optionnel : Fil Rouge + TierNight

---

## 5. Contenu & jeux

- [ ] Questions à jour dans `data/*.js` (commit + push faits)
- [ ] Blind Test retiré du menu si tu ne le veux pas (`data/games.js`)
- [ ] Logos TierNight (`assets/tiers/*.png`) : optionnel (emoji de secours sinon)

---

## 6. Pas bloquant pour la v1 web

- Refactor architecture (métier / DOM)
- Verrouillage viewport 100vh sur tous les jeux
- Connexion Facebook / Instagram
- **App native Capacitor** → voir [CAPACITOR.md](./CAPACITOR.md) (phase 2)

---

## En cas de problème

| Symptôme | Piste |
|----------|--------|
| Modifs invisible en prod | Save All → push → `?v=` dans `index.html` |
| `no captcha_token` | Turnstile pas validé ou app pas à jour |
| Turnstile 600010 | Hostname Cloudflare, bloqueur, ou widget dans onglet caché |
| Invité impossible | Anonymous sign-ins dans Supabase |
| Sync multijoueur cassée | Realtime + `game-sessions.sql` + politiques RLS |
| VibeCheck bloqué | 3 joueurs min ; jaquettes via `node scripts/fetchVibeCheckCovers.mjs` |

---

**Quand tout est coché en sections 1–4** : tu peux lancer REVEAL en web pour une vraie soirée.
