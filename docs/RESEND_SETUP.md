# REVEAL — Emails transactionnels avec Resend + OVH

Supabase envoie les mails d’auth (inscription, **reset mot de passe**, confirmations).  
Par défaut, les quotas Supabase sont limités → **Resend** sert de relais SMTP professionnel.

Checklist rapide : voir sections **Emails** dans [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) et [STORE_CHECKLIST.md](./STORE_CHECKLIST.md).

---

## Pourquoi Resend ?

| Sans Resend | Avec Resend |
|-------------|-------------|
| Quota email Supabase limité | Volume adapté à une vraie app |
| Expéditeur `@supabase.io` | Expéditeur `@ton-domaine.com` (plus pro) |
| Risque de spam / rate limit en soirée | Meilleure délivrabilité (SPF/DKIM) |

Cas REVEAL concernés : **mot de passe oublié**, confirmations email (si activées), futurs emails système.

---

## Étape 1 — Compte Resend

1. [resend.com](https://resend.com) → créer un compte
2. **Domains** → **Add domain**
3. Saisir ton domaine (ex. `reveal-party.fr` ou un sous-domaine dédié `mail.ton-domaine.fr`)

> Astuce : un **sous-domaine** (`mail.…`) isole la réputation email du site principal.

---

## Étape 2 — DNS OVH (tu es ici)

Resend affiche des enregistrements à créer. **Copie-les tels quels** depuis le dashboard Resend (ils peuvent varier légèrement).

### Où les ajouter

1. [OVH Manager](https://www.ovh.com/manager/) → **Noms de domaine** → ton domaine
2. Onglet **Zone DNS**
3. **Ajouter une entrée** pour chaque ligne demandée par Resend

### Enregistrements typiques Resend

| Type | Nom / Host | Valeur | Notes |
|------|------------|--------|--------|
| **TXT** | `@` ou sous-domaine | vérification domaine | Fourni par Resend |
| **TXT** ou **CNAME** | `resend._domainkey` (ou similaire) | DKIM | **Obligatoire** pour signer les mails |
| **TXT** | `@` | SPF (`v=spf1 include:…`) | Si Resend le propose |
| **TXT** | `_dmarc` | politique DMARC | Recommandé (optionnel au début) |

### Points d’attention OVH

- **Nom d’hôte** : si Resend demande `resend._domainkey` et ton domaine est `mail.example.com`, mets souvent `resend._domainkey.mail` ou la forme indiquée par Resend (OVH ajoute parfois le domaine automatiquement).
- **TTL** : laisse par défaut (ou 3600). Propagation : **5 min à 48 h** (souvent < 1 h).
- Ne supprime pas les enregistrements MX existants si tu utilises déjà la messagerie OVH sur le **même** domaine racine — d’où l’intérêt d’un sous-domaine `mail.…` pour l’envoi Resend uniquement.

### Vérification

1. Retour sur **Resend → Domains**
2. Statut passe de *Pending* / *Checking DNS* → **Verified** ✅
3. Si ça reste bloqué > 24 h : bouton **Verify** / **Refresh** dans Resend, puis compare caractère par caractère avec OVH (espaces, guillemets, sous-domaine).

---

## Étape 3 — Clé API Resend

1. Resend → **API Keys** → **Create API Key**
2. Permission : **Sending access** (suffisant pour SMTP Supabase)
3. Copie la clé `re_…` — **visible une seule fois**

Ne commite **jamais** cette clé dans le repo Git.

---

## Étape 4 — Brancher Supabase sur Resend (SMTP)

1. Supabase → **Project Settings** → **Authentication**
2. Section **SMTP Settings** → activer **Custom SMTP**
3. Renseigner (valeurs Resend standard) :

| Champ Supabase | Valeur |
|----------------|--------|
| **Host** | `smtp.resend.com` |
| **Port** | `465` (SSL) ou `587` (TLS) |
| **Username** | `resend` |
| **Password** | ta clé API `re_…` |
| **Sender email** | adresse sur domaine vérifié, ex. `noreply@mail.ton-domaine.fr` |
| **Sender name** | `REVEAL` |

4. **Save**
5. (Optionnel) **Authentication → Email Templates** : personnaliser reset MDP — modèle de base dans `supabase/email-reset-password.html`

---

## Étape 5 — Tests

- [ ] Supabase → envoyer un **test email** depuis SMTP settings (si proposé)
- [ ] App REVEAL → **Mot de passe oublié** avec ton email → mail reçu (boîte + spam)
- [ ] Lien reset → ouvre l’app (web ou deep link native)
- [ ] Vérifier expéditeur affiché (`REVEAL <noreply@…>`)

---

## Dépannage

| Symptôme | Piste |
|----------|--------|
| Resend « Checking DNS » longtemps | Attendre propagation ; revérifier TXT/CNAME dans OVH |
| Domaine non vérifié | Erreur de host OVH (mauvais sous-domaine) |
| Supabase « SMTP error » | Clé API invalide ; port 465 vs 587 ; sender pas sur domaine vérifié |
| Mail en spam | DKIM OK ? ; ajouter DMARC ; éviter `@gmail.com` comme sender |
| Reset reçu mais lien cassé | Redirect URLs Supabase (web + `com.reveal.partygames://auth/callback`) |

---

## Checklist résumée

```
[ ] Domaine ajouté dans Resend
[ ] Enregistrements DNS créés dans OVH          ← étape en cours
[ ] Domaine Verified dans Resend
[ ] Clé API Resend créée
[ ] SMTP custom activé dans Supabase
[ ] Test « mot de passe oublié » OK
```

---

## Liens

- [Resend — Domains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend — SMTP](https://resend.com/docs/send-with-smtp)
- [Supabase — Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
