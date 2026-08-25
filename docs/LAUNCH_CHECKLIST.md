# REVEAL — Lancement web

Prod : **https://julie-lepine.github.io/reveal/**  
Stores : [STORE_CHECKLIST.md](./STORE_CHECKLIST.md) · Sans pub : [FEATURE_ADFREE_CHECKLIST.md](./FEATURE_ADFREE_CHECKLIST.md)

---

## Avant une soirée (web)

- [ ] Save All → `git status` propre ou commit → **push** (branche GitHub Pages)
- [ ] Hard refresh (Ctrl+Shift+R) ou fenêtre privée
- [ ] Si l’ancienne UI reste : bumper `?v=` dans `index.html` — aujourd’hui **main.js v=97** / **style.css v=22**
- [ ] `js/config/supabase.js` et `js/config/turnstile.js` présents en prod (pas les `*.example.js`)

### Pilote (~30 min, 3–4 personnes)

- [ ] Hôte : compte e-mail → lobby → code / lien
- [ ] Invité (2e navigateur ou téléphone) : onglet Invité + code
- [ ] Un jeu court (SpeedVote, Consensus, Clutch…) → arrêter → autre jeu
- [ ] Quitter / fermer le lobby

Wrong Answer Only est encore en « Bientôt » (`data/games.js`). VibeCheck / Blind Test : **retirés**.

---

## Déjà en place

Auth e-mail + invité, Turnstile (web), Resend + SMTP, Realtime, schema lobby / game_sessions. Détail : [SUPABASE_SETUP.md](./SUPABASE_SETUP.md), [RESEND_SETUP.md](./RESEND_SETUP.md).

**App Store** : 1.0.0 (build 4) en review — 24 août 2026.  
**Play** : test fermé (12 installs × 14 j) + 02B.

---

## Si ça casse

| Symptôme | Piste |
|----------|--------|
| Modifs invisibles | Save → push → `?v=` dans `index.html` |
| `no captcha_token` | Turnstile pas validé, ou app native (pas de widget) |
| Turnstile 600010 | Hostname Cloudflare, bloqueur, onglet caché |
| Invité impossible | Anonymous sign-ins Supabase |
| Sync cassée | Realtime + RLS — [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) |
| Pas de mail reset | [RESEND_SETUP.md](./RESEND_SETUP.md) (DNS OVH + SMTP) |
