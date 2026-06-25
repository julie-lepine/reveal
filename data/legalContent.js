/** Contenu politique de confidentialité REVEAL (FR). */

import {
  CONTACT_EMAIL,
  INSTAGRAM_HANDLE,
  INSTAGRAM_PROFILE_URL,
} from "./appConfig.js";

export const PRIVACY_POLICY = {
  title: "Politique de confidentialité",
  updated: "15 juin 2026",
  sections: [
    {
      heading: "Qui sommes-nous ?",
      body: "REVEAL est une application de jeux de soirée multijoueur. Cette politique décrit comment nous traitons vos données lorsque vous utilisez l'application (web ou mobile).",
    },
    {
      heading: "Données collectées",
      body: "Selon votre mode d'utilisation, nous pouvons traiter : pseudo et emoji de profil, adresse e-mail (compte enregistré), identifiant de session anonyme (mode invité), données de jeu (scores, votes, messages de lobby), et données techniques (appareil, logs d'erreur).",
    },
    {
      heading: "Finalités",
      body: "Authentification, synchronisation multijoueur en temps réel, affichage des classements, prévention des abus (captcha Cloudflare Turnstile), et monétisation par publicités (Google AdMob) sur l'application mobile.",
    },
    {
      heading: "Hébergement et sous-traitants",
      body: "Les données sont hébergées via Supabase (base de données, authentification, temps réel). Cloudflare Turnstile protège les formulaires sensibles. Google AdMob affiche des publicités sur l'app mobile native. Les polices Inter sont chargées depuis Google Fonts.",
    },
    {
      heading: "Publicité (AdMob)",
      body: "Sur l'application mobile, des bannières publicitaires peuvent s'afficher en dehors des manches de jeu. Google peut utiliser un identifiant publicitaire selon votre consentement (formulaire UMP en UE). Vous pouvez refuser la personnalisation via le bandeau de consentement.",
    },
    {
      heading: "Conservation",
      body: `Les données de session et de lobby sont conservées le temps de la soirée et liées à votre compte Supabase. Vous pouvez demander la suppression de votre compte via la page dédiée (voir ci-dessous) ou par e-mail à ${CONTACT_EMAIL}.`,
    },
    {
      heading: "Suppression de compte",
      body: `Les comptes enregistrés (e-mail) peuvent être supprimés à tout moment. Envoyez une demande depuis l'application (Paramètres) ou depuis la page publique de suppression de compte. Nous effaçons le compte Supabase Auth, le profil (pseudo, emoji) et les données de jeu associées, sous 30 jours ouvrés. Le mode invité ne crée pas de compte permanent : les données de session expirent automatiquement.`,
    },
    {
      heading: "Vos droits (RGPD)",
      body: `Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation et d'opposition. Pour exercer vos droits : écrivez à ${CONTACT_EMAIL}.`,
    },
    {
      heading: "Contact et retours",
      body: `Bug, idée d'amélioration ou question sur l'app : ${CONTACT_EMAIL}. Vous pouvez aussi nous écrire en DM sur Instagram @${INSTAGRAM_HANDLE} (${INSTAGRAM_PROFILE_URL}).`,
    },
    {
      heading: "Sécurité",
      body: "Les échanges avec nos serveurs passent par HTTPS. Les mots de passe ne sont jamais stockés en clair (gérés par Supabase Auth).",
    },
    {
      heading: "Mineurs",
      body: "L'application est destinée à un public majeur en soirée entre amis. Ne pas utiliser si vous avez moins de 16 ans sans accord parental.",
    },
    {
      heading: "Modifications",
      body: "Cette politique peut être mise à jour. La date de dernière révision figure en haut de cette page.",
    },
  ],
};
