# Site légal REVEAL sur revealthepartygame.fr (OVH)

Repo **séparé** du projet Party Games (pages statiques : `index.html`, `privacy.html`, `suppression-compte.html`, `mentions-legales.html`, `legal.css`, `reveal.png`).

Checklist associée : [LAUNCH.md](./LAUNCH.md) (bloc site & AdMob).

---

## Équivalent Hostinger → OVH

| Hostinger | OVH |
|-----------|-----|
| hPanel → Gestionnaire de fichiers | **Hébergement Web** → **FTP - SSH** ou client FTP (FileZilla) |
| Glisser-déposer dans `public_html` | Dossier **`www`** (ou `www/revealthepartygame.fr` selon offre) |
| SSL automatique | **Hébergement** → domaine → **SSL** / certificat Let’s Encrypt |
| DNS géré par Hostinger | **Noms de domaine** → **Zone DNS** (ne pas toucher `send.*` pour Resend) |

OVH ne propose pas toujours un « copier-coller » visuel aussi simple que Hostinger : en pratique tu **uploades les fichiers** via le **gestionnaire FTP** du navigateur ou **FileZilla**.

---

## Prérequis

1. **Repo Git** du site légal créé et fichiers prêts (placeholders `[…]` complétés dans les mentions).
2. **Hébergement Web OVH** lié au domaine `revealthepartygame.fr`  
   - Si tu n’as **que** le nom de domaine (sans hébergement) : OVH Manager → commander un **Hébergement Web** (Perso / Starter) ou utiliser **Cloudflare Pages** (gratuit) — voir fin de doc.
3. Le domaine est déjà chez OVH (emails Resend sur `send.` OK).

---

## Étape 1 — Lier le domaine à l’hébergement

1. [OVH Manager](https://www.ovh.com/manager/) → **Hébergements Web** → ton offre.
2. Onglet **Multisite** (ou **Domaines associés**).
3. **Ajouter un domaine** → `revealthepartygame.fr` (et optionnel `www.revealthepartygame.fr`).
4. Dossier racine : souvent **`www`** ou **`www/revealthepartygame.fr`** — note le chemin affiché.

---

## Étape 2 — Retirer la page « Site en construction »

1. **Noms de domaine** → `revealthepartygame.fr` → **Zone DNS**.
2. Repère les entrées **A** / **CNAME** sur `@` ou `www` qui pointent vers le **parking** OVH.
3. **Ne modifie pas** les enregistrements du sous-domaine **`send`** (Resend).
4. Si l’hébergement est sur le même compte OVH, la multisite met souvent les bons enregistrements automatiquement ; sinon suis les valeurs indiquées dans l’onglet **Informations DNS** de l’hébergement.

Attendre 15 min à 2 h (parfois 24 h) pour la propagation.

---

## Étape 3 — Envoyer les fichiers (comme sur Hostinger)

### Option A — Explorateur FTP dans le navigateur (le plus proche de Hostinger)

1. **Hébergements Web** → ton hébergement → **FTP - SSH**.
2. Clique **Explorer FTP** (ouvre une interface web de fichiers).
3. Identifiants : utilisateur FTP + mot de passe (affichés sur la même page ; « Réinitialiser » si besoin).
4. Ouvre le dossier indiqué à l’étape 1 (`www` ou sous-dossier du domaine).
5. **Supprime** ou remplace l’éventuel `index.html` « en construction ».
6. **Upload** depuis ton repo local :
   - `index.html`
   - `privacy.html`
   - `mentions-legales.html`
   - `legal.css`
   - `reveal.png`
7. Vérifie que `index.html` est **à la racine** du site (pas dans un sous-dossier oublié).

### Option B — FileZilla (classique)

1. Télécharge [FileZilla](https://filezilla-project.org/).
2. Hôte : `ftp.cluster0XX.hosting.ovh.net` (valeur exacte dans **FTP - SSH**).
3. Utilisateur / mot de passe FTP, port **21**.
4. Panneau droit → dossier `www` → glisse les mêmes fichiers depuis ton PC.

---

## Étape 4 — HTTPS

1. **Hébergements Web** → **Multisite** / **SSL**.
2. Active le certificat **Let’s Encrypt** pour `revealthepartygame.fr` et `www`.
3. Teste : `https://www.revealthepartygame.fr/privacy.html` (cadenas vert).

---

## Étape 5 — Vérifications

- [x] `https://www.revealthepartygame.fr/` → accueil légal (pas « Site en construction ») — 25 août 2026
- [x] `…/privacy.html` et `…/mentions-legales.html` OK — 25 août 2026 (2,99 € TTC, Google = paiement)
- [x] `privacy.html` : liste d’amis privée + cascade suppression — 27 août 2026
- [x] `privacy.html` : invitations de soirée éphémères + cascade compte — FEATURE-FRIENDS-02 — 27 août 2026
- [x] `privacy.html` : joueurs récemment croisés 24 h + cascade compte — FEATURE-FRIENDS-04 — 27 août 2026
- [x] Logo `reveal.png` s’affiche
- [x] Liens footer entre les pages
- [x] **Liens téléchargement app** (Play Store / App Store) sur `index.html` — 25 août 2026

---

## Étape 6 — Mettre à jour le projet REVEAL (repo Party Games)

Dans ce repo :

- [x] `data/appConfig.js` → `PRIVACY_POLICY_PUBLIC_URL` =  
  `https://revealthepartygame.fr/privacy.html`
- [x] Fiches **Play Console** / **App Store Connect** : même URL confidentialité (`https://revealthepartygame.fr/privacy.html`) — ASC 24 août 2026
- [ ] Optionnel : Cloudflare Turnstile → hostname `revealthepartygame.fr` / `www` si un jour l’app web y est hébergée

---

## Liens « Télécharger l’app » (à ajouter dans le repo légal)

Quand les fiches store sont en ligne, ajoute sur **`index.html`** (pilule ou bouton) et dans **`mentions-legales.html`** (section dédiée) :

| Store | URL type |
|-------|----------|
| Google Play | `https://play.google.com/store/apps/details?id=com.reveal.partygames` (à confirmer après publication) |
| App Store | `https://apps.apple.com/app/id6785256450` (fiche créée ; lien public après acceptation Apple) |

Tant que l’app n’est pas publiée : texte du type « Bientôt sur Google Play et l’App Store » ou masquer les boutons.

---

## Pas d’hébergement OVH ? Alternative gratuite (Cloudflare Pages)

1. [Cloudflare](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Pages** → connecter le **repo Git** du site légal (déploiement auto à chaque `git push`).
2. **Custom domain** : `www.revealthepartygame.fr`.
3. OVH Zone DNS : **CNAME** `www` → cible indiquée par Cloudflare.
4. Redirection `@` → `www` dans OVH si besoin.

Tu n’uploades plus à la main : chaque push sur le repo met le site à jour (proche de « déployer depuis Git », sans interface Hostinger).

---

## Dépannage

| Problème | Piste |
|----------|--------|
| Toujours « Site en construction » | DNS `@`/`www` pointe encore vers le parking ; ou fichiers pas dans le bon dossier `www` |
| 404 sur `privacy.html` | Fichier absent ou mauvais sous-dossier FTP |
| CSS cassé | `legal.css` pas uploadé ou mauvais chemin dans le `<link>` |
| Resend cassé | Tu as modifié des entrées **`send`** — restaurer depuis la doc Resend |

---

## Fichiers de ce repo (référence)

L’app principale reste sur GitHub Pages. Le site légal est **un autre dépôt** ; seule l’URL publique dans `data/appConfig.js` doit pointer vers le domaine une fois en ligne.

---

## MAJ `privacy.html` — FEATURE-FRIENDS-01 (27 août 2026)

Source de vérité in-app : [`data/legalContent.js`](../data/legalContent.js) (`updated` : **27 août 2026**).

**Ne pas** modifier les fiches App Privacy Apple / Play Data safety tant qu’un **nouveau store build** n’embarque pas la feature. Ensuite seulement : relations sociales / user IDs, toujours *No public social feed*, *private friend list*, *lobby-only discovery*.

### Prompt à coller dans le repo du site OVH

```
Tu mets à jour privacy.html du site légal REVEAL (revealthepartygame.fr) pour coller à la politique in-app du 27 août 2026.

Contexte produit (ne pas inventer d’autre graphe social) :
- REVEAL a une liste d’amis PRIVÉE, comptes inscrits seulement (pas les invités anonymes).
- Découverte uniquement via le roster d’un lobby privé (code). Pas de recherche de joueurs, pas de fil public, pas de suggestions, pas de DM.
- Demandes d’amitié + liste d’amis (pseudo / emoji lus depuis le profil). Refus = suppression de la demande.
- Suppression de compte : les lignes friend_requests, friendships et cooldowns partent en cascade avec auth.users (ON DELETE CASCADE).
- Ne pas présenter ça comme un réseau social public.

Fichier : privacy.html (et seulement ce fichier, sauf si la date apparaît aussi en footer commun).

1) Date « Dernière mise à jour » → 27 août 2026.

2) Section « Données collectées » — remplacer le paragraphe par :

Selon votre mode d'utilisation, nous pouvons traiter : pseudo et emoji de profil, adresse e-mail (compte enregistré), identifiant de session anonyme (mode invité), liste d’amis et demandes d’amitié (comptes inscrits uniquement ; découverte uniquement dans un lobby privé, sans recherche publique ni fil social), données de jeu (scores, votes, messages de lobby), et données techniques (appareil, logs d'erreur).

3) Section « Finalités » — garder le texte existant (auth, sync, classements, Turnstile, AdMob) et y ajouter, sans retirer IAP/AdMob :

gestion d’une liste d’amis privée (comptes inscrits)

Formulation cible (si le paragraphe actuel est encore celui d’août sans amis) :

Authentification, synchronisation multijoueur en temps réel, affichage des classements, gestion d’une liste d’amis privée (comptes inscrits), prévention des abus (captcha Cloudflare Turnstile), et monétisation par publicités (Google AdMob) sur l'application mobile.

Si la page a déjà RevenueCat / Sans pub dans Finalités, insère seulement la mention liste d’amis privée, ne supprime rien.

4) Section « Suppression de compte » — après « le profil (pseudo, emoji) », ajouter que les demandes d’amitié et amitiés associées sont effacées en cascade. Phrase cible :

Nous effaçons le compte Supabase Auth, le profil (pseudo, emoji), les demandes d’amitié et amitiés associées (suppression en cascade), et les données de jeu associées, sous 30 jours ouvrés.

5) Interdits :
- Ne pas ajouter de recherche d’utilisateurs, de fil, de messagerie privée, de push marketing.
- Ne pas changer les prix IAP, AdMob, UMP, contact e-mail, Instagram, liens Play/App Store.
- Ne pas toucher mentions-legales.html ni suppression-compte.html sauf si un titre de date globale le force (alors 27 août 2026).
- Conserver HTTPS, footer, CSS, logo.

6) Vérif après MAJ :
- https://www.revealthepartygame.fr/privacy.html affiche 27 août 2026
- Ctrl+F « amis » et « cascade » OK
- Ctrl+F : pas de « recherche de joueurs » / « fil d’actualité » / « réseau social public »

Aligne-toi mot pour mot sur les paragraphes ci-dessus (mêmes apostrophes typographiques si le fichier les utilise déjà).
```

En ligne (27 août 2026) : [privacy.html](https://revealthepartygame.fr/privacy.html) — liste d’amis, finalités, cascade. Recocher LAUNCH fait.

---

## MAJ `privacy.html` — FEATURE-FRIENDS-02 (27 août 2026)

Source de vérité in-app : [`data/legalContent.js`](../data/legalContent.js) (`updated` : **27 août 2026**).

La page live a **déjà** la liste d’amis (FEATURE-FRIENDS-01). Ici on **ajoute** les invitations de soirée, sans retirer les amis ni IAP/AdMob/RevenueCat.

**Ne pas** modifier les fiches App Privacy Apple / Play Data safety tant qu’un **nouveau store build** n’embarque pas la feature.

### Prompt à coller dans le repo du site OVH

```
Tu mets à jour privacy.html du site légal REVEAL (https://revealthepartygame.fr/privacy.html) pour coller à la politique in-app du 27 août 2026 (FEATURE-FRIENDS-02).

Contexte produit (ne pas inventer d’autre graphe social ni de canal public) :
- REVEAL a déjà une liste d’amis PRIVÉE (comptes inscrits seulement, découverte roster lobby, pas de recherche, pas de fil).
- NOUVEAU : invitations de soirée PRIVÉES, éphémères, uniquement entre amis inscrits.
- L’émetteur doit déjà être membre d’un lobby vivant. Les invités anonymes ne peuvent ni envoyer ni recevoir une invitation.
- L’invitation est liée à CE lobby : elle disparaît si le lobby est fermé / dissous (cascade), si on refuse, ou si on accepte (on rejoint).
- Rejoindre se fait sans taper le code 6 lettres. La ligne d’invitation ne contient PAS le code salon. Ce n’est PAS un lien public, PAS un QR, PAS un deep link, PAS un e-mail d’invitation, PAS une notification push.
- Ce n’est PAS un message dans le chat du lobby. Canal privé.
- Suppression de compte : les invitations de soirée partent aussi en cascade (comme les demandes d’amitié / amitiés).
- Ne pas présenter ça comme un réseau social public, ni comme des invitations e-mail / SMS.

Fichier : privacy.html seulement (sauf si une date globale est aussi dans un footer commun).

Garde tout le texte déjà en ligne (amis, AdMob, UMP, Sans pub 2,99 € TTC, RevenueCat, HAVEFUNCORP si présent, contact, Instagram, liens stores). N’écrase pas ces paragraphes : tu INSERTES les mentions ci-dessous.

1) Date « Dernière mise à jour »
Garder 27 août 2026. Si une autre date est affichée, mets 27 août 2026.

2) Section « Données collectées »
Après la clause sur la liste d’amis / demandes d’amitié (celle qui dit « sans recherche publique ni fil social »), AVANT « données de jeu », insère exactement :

, invitations de soirée éphémères (entre amis inscrits, liées à un lobby vivant, sans le code salon)

Paragraphe cible (si tu réécris tout le bloc, mot pour mot, apostrophes comme le fichier actuel) :

Selon votre mode d'utilisation, nous pouvons traiter : pseudo et emoji de profil, adresse e-mail (compte enregistré), identifiant de session anonyme (mode invité), liste d’amis et demandes d’amitié (comptes inscrits uniquement ; découverte uniquement dans un lobby privé, sans recherche publique ni fil social), invitations de soirée éphémères (entre amis inscrits, liées à un lobby vivant, sans le code salon), données de jeu (scores, votes, messages de lobby), et données techniques (appareil, logs d'erreur).

3) Section « Finalités »
Après « gestion d’une liste d’amis privée (comptes inscrits) », insère :

, envoi d’invitations de soirée privées (amis inscrits, depuis un lobby)

Ne retire rien d’autre (Turnstile, AdMob, classements, auth). Formulation cible si le paragraphe n’a pas encore RevenueCat dans Finalités :

Authentification, synchronisation multijoueur en temps réel, affichage des classements, gestion d’une liste d’amis privée (comptes inscrits), envoi d’invitations de soirée privées (amis inscrits, depuis un lobby), prévention des abus (captcha Cloudflare Turnstile), et monétisation par publicités (Google AdMob) sur l'application mobile.

4) Section « Conservation »
Après la phrase sur les données de session / lobby (temps de la soirée), ajoute cette phrase (sans supprimer le reste du paragraphe, e-mail, 30 jours, lien suppression) :

Les invitations de soirée sont éphémères : elles disparaissent à la fermeture du lobby, au refus ou à l’acceptation.

5) Section « Suppression de compte »
Après « les demandes d’amitié et amitiés associées (suppression en cascade) », insère :

, les invitations de soirée associées (suppression en cascade)

Phrase cible :

Nous effaçons le compte Supabase Auth, le profil (pseudo, emoji), les demandes d’amitié et amitiés associées (suppression en cascade), les invitations de soirée associées (suppression en cascade), et les données de jeu associées, sous 30 jours ouvrés.

6) Interdits (très important) :
- Ne pas ajouter de recherche d’utilisateurs, fil d’actualité, messagerie privée (DM), push marketing, QR, lien #join=, invitation par e-mail/SMS.
- Ne pas citer de noms de tables SQL (lobby_invites, friend_requests, etc.) ni de RPC.
- Ne pas changer les prix IAP, AdMob, UMP, RevenueCat, HAVEFUNCORP, contact e-mail, Instagram, boutons Play/App Store.
- Ne pas toucher index.html, mentions-legales.html, suppression-compte.html, legal.css, logo — sauf date globale forcée (alors 27 août 2026).
- Ne pas présenter REVEAL comme un réseau social public.
- Ne pas modifier les questionnaires App Privacy Apple / Play Data safety (autre repo / consoles stores).

7) Vérif après mise en ligne :
- https://www.revealthepartygame.fr/privacy.html et https://revealthepartygame.fr/privacy.html
- Date : 27 août 2026
- Ctrl+F « invitations de soirée éphémères » → 1 occurrence (Données collectées)
- Ctrl+F « invitations de soirée privées » → 1 (Finalités)
- Ctrl+F « disparaissent à la fermeture du lobby » → 1 (Conservation)
- Ctrl+F « invitations de soirée associées » → 1 (Suppression)
- Ctrl+F « amis » toujours présent (ne pas avoir écrasé FEATURE-FRIENDS-01)
- Ctrl+F : pas de « recherche de joueurs », « fil d’actualité », « réseau social public », « lobby_invites », « push »

Aligne-toi mot pour mot sur les inserts ci-dessus (mêmes apostrophes typographiques que le fichier déjà en ligne : si la page utilise ' ASCII, garde-les ; si elle utilise ’, garde-les).
```

En ligne (27 août 2026) : [privacy.html](https://revealthepartygame.fr/privacy.html) — invitations éphémères, finalités, conservation, cascade compte.

---

## MAJ `privacy.html` — FEATURE-FRIENDS-04 (27 août 2026)

Source de vérité in-app : [`data/legalContent.js`](../data/legalContent.js) (`updated` : **27 août 2026**).

La page live a **déjà** la liste d’amis (F01) et les invitations de soirée (F02). Ici on **ajoute** les joueurs récemment croisés (24 h), sans retirer amis, invitations, IAP, AdMob, RevenueCat.

**Ne pas** modifier les fiches App Privacy Apple / Play Data safety tant qu’un **nouveau store build** n’embarque pas la feature.

### Prompt à coller dans le repo du site OVH

```
Tu mets à jour privacy.html du site légal REVEAL (https://revealthepartygame.fr/privacy.html) pour coller à la politique in-app du 27 août 2026 (FEATURE-FRIENDS-04).

Contexte produit (ne pas inventer d’autre graphe social ni de recherche) :
- REVEAL a déjà une liste d’amis PRIVÉE (comptes inscrits, découverte roster lobby, pas de recherche, pas de fil).
- REVEAL a déjà des invitations de soirée PRIVÉES, éphémères, entre amis inscrits, liées à un lobby vivant, sans le code salon.
- NOUVEAU : après une soirée, on peut revoir pendant 24 h les joueurs INSCRITS avec qui on a partagé le même lobby, pour les ajouter en ami. Ce n’est PAS une recherche, PAS des suggestions d’inconnus, PAS des amis d’amis, PAS un fil.
- Uniquement des gens déjà croisés dans un salon (les deux inscrits). Jamais un invité anonyme. Jamais quelqu’un jamais vu en salon.
- Tant qu’on est encore dans le même lobby, cette liste ne s’en occupe pas (le roster suffit).
- Fenêtre : 24 h après la fin du lobby commun (leave / fermeture). Puis oublié.
- On ne stocke PAS le code salon dans cette liste.
- Suppression de compte : ces croisés récents partent aussi en cascade (comme demandes d’amitié / amitiés / invitations de soirée).
- Ne pas présenter ça comme un réseau social public, ni comme un historique de salons, ni comme de la géolocalisation.

Fichier : privacy.html seulement (sauf si une date globale est aussi dans un footer commun).

Garde tout le texte déjà en ligne (amis, invitations de soirée, AdMob, UMP, Sans pub 2,99 € TTC, RevenueCat, HAVEFUNCORP si présent, contact, Instagram, liens stores). N’écrase pas ces paragraphes : tu INSERTES les mentions ci-dessous.

1) Date « Dernière mise à jour »
Garder 27 août 2026. Si une autre date est affichée, mets 27 août 2026.

2) Section « Données collectées »
Après la clause sur les invitations de soirée éphémères (celle qui dit « sans le code salon »), AVANT « données de jeu », insère exactement :

, joueurs récemment croisés en salon (inscrits seulement, 24 h après la fin du lobby commun, sans le code salon)

Paragraphe cible si tu réécris tout le bloc (mot pour mot ; apostrophes = celles déjà utilisées dans le fichier en ligne, ASCII ' ou typographiques ’) :

Selon votre mode d'utilisation, nous pouvons traiter : pseudo et emoji de profil, adresse e-mail (compte enregistré), identifiant de session anonyme (mode invité), liste d'amis et demandes d'amitié (comptes inscrits uniquement ; découverte uniquement dans un lobby privé, sans recherche publique ni fil social), invitations de soirée éphémères (entre amis inscrits, liées à un lobby vivant, sans le code salon), joueurs récemment croisés en salon (inscrits seulement, 24 h après la fin du lobby commun, sans le code salon), données de jeu (scores, votes, messages de lobby), et données techniques (appareil, logs d'erreur).

3) Section « Finalités »
Après « envoi d'invitations de soirée privées (amis inscrits, depuis un lobby) », insère :

, affichage des joueurs récemment croisés pour proposer de les ajouter en ami (24 h)

Ne retire rien d’autre (Turnstile, AdMob, classements, auth, liste d’amis, invitations). Formulation cible si tu réécris le paragraphe (sans RevenueCat dans Finalités, comme la page live actuelle) :

Authentification, synchronisation multijoueur en temps réel, affichage des classements, gestion d'une liste d'amis privée (comptes inscrits), envoi d'invitations de soirée privées (amis inscrits, depuis un lobby), affichage des joueurs récemment croisés pour proposer de les ajouter en ami (24 h), prévention des abus (captcha Cloudflare Turnstile), et monétisation par publicités (Google AdMob) sur l'application mobile.

4) Section « Conservation »
Après la phrase sur les invitations de soirée éphémères (fermeture du lobby, refus, acceptation), ajoute cette phrase, sans supprimer le reste du paragraphe (e-mail, 30 jours, lien suppression) :

Les joueurs récemment croisés en salon sont oubliés 24 h après la fin du lobby commun.

5) Section « Suppression de compte »
Après « les invitations de soirée associées (suppression en cascade) », insère :

, les joueurs récemment croisés associés (suppression en cascade)

Phrase cible :

Nous effaçons le compte Supabase Auth, le profil (pseudo, emoji), les demandes d'amitié et amitiés associées (suppression en cascade), les invitations de soirée associées (suppression en cascade), les joueurs récemment croisés associés (suppression en cascade), et les données de jeu associées, sous 30 jours ouvrés.

6) Interdits (très important) :
- Ne pas ajouter de recherche d’utilisateurs, suggestions d’inconnus, amis d’amis, fil d’actualité, messagerie privée (DM), push marketing, QR, lien #join=, historique de salons, géolocalisation, « Vous venez de jouer avec » comme nom de table.
- Ne pas citer de noms de tables SQL (lobby_encounters, lobby_invites, friend_requests, etc.) ni de RPC.
- Ne pas changer les prix IAP, AdMob, UMP, RevenueCat, HAVEFUNCORP, contact e-mail, Instagram, boutons Play/App Store.
- Ne pas toucher index.html, mentions-legales.html, suppression-compte.html, legal.css, logo — sauf date globale forcée (alors 27 août 2026).
- Ne pas présenter REVEAL comme un réseau social public.
- Ne pas modifier les questionnaires App Privacy Apple / Play Data safety (autre repo / consoles stores).
- Ne pas retirer les mentions amis (F01) ni invitations de soirée (F02).

7) Vérif après mise en ligne :
- https://www.revealthepartygame.fr/privacy.html et https://revealthepartygame.fr/privacy.html
- Date : 27 août 2026
- Ctrl+F « joueurs récemment croisés en salon » → au moins 2 (Données collectées + Conservation)
- Ctrl+F « proposer de les ajouter en ami (24 h) » → 1 (Finalités)
- Ctrl+F « oubliés 24 h » → 1 (Conservation)
- Ctrl+F « joueurs récemment croisés associés » → 1 (Suppression)
- Ctrl+F « invitations de soirée éphémères » toujours présent (ne pas avoir écrasé F02)
- Ctrl+F « liste d'amis » ou « liste d’amis » toujours présent (ne pas avoir écrasé F01)
- Ctrl+F : pas de « recherche de joueurs », « fil d’actualité », « réseau social public », « lobby_encounters », « suggestions »

Aligne-toi mot pour mot sur les inserts ci-dessus. Apostrophes : celles déjà en ligne sur privacy.html (si la page utilise ' ASCII, garde-les ; si elle utilise ’, garde-les).
```

En ligne (27 août 2026) : [privacy.html](https://revealthepartygame.fr/privacy.html) — croisés 24 h, finalités, conservation, cascade compte. Stores inchangés.

