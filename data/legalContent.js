/** Contenu politique de confidentialité REVEAL (FR) — aligné sur havefuncorp.fr/reveal/privacy. */

import {
  ACCOUNT_DELETION_PUBLIC_URL,
  CONTACT_EMAIL,
  INSTAGRAM_HANDLE,
  INSTAGRAM_PROFILE_URL,
} from "./appConfig.js";

export const PRIVACY_POLICY = {
  title: "Politique de confidentialité",
  updated: "5 septembre 2026",
  sections: [
    {
      heading: "Qui sommes-nous ?",
      body: "REVEAL est une application de jeux de soirée multijoueur. Cette politique décrit comment nous traitons vos données lorsque vous utilisez l'application (iOS ou Android).",
    },
    {
      heading: "Données collectées",
      body: "Selon votre mode d'utilisation, nous pouvons traiter : pseudo et emoji de profil, couleur de pseudo et cadre / badge (compte Signature), photo de profil optionnelle (cercle, JPEG, hébergée sur Supabase Storage ; l'emoji reste le secours si l'image ne charge pas), carnet personnel (comptes Signature : stats agrégées, jusqu'à 20 soirées avec date, jeux, rang et score du joueur, prénoms des amis encore amis — jamais le code salon), adresse e-mail (compte enregistré), identifiant de session anonyme (mode invité), liste d'amis et demandes d'amitié (comptes inscrits uniquement ; découverte uniquement dans un lobby privé, sans recherche publique ni fil social), invitations de soirée éphémères (entre amis inscrits, liées à un lobby vivant, sans le code salon), joueurs récemment croisés en salon (inscrits seulement, 24 h après la fin du lobby commun, sans le code salon), données de jeu (scores, votes, messages de lobby), et données techniques (appareil, logs d'erreur).",
    },
    {
      heading: "Finalités",
      body: "Authentification, synchronisation multijoueur en temps réel, affichage des classements, gestion d'une liste d'amis privée (comptes inscrits), envoi d'invitations de soirée privées (amis inscrits, depuis un lobby), affichage des joueurs récemment croisés pour proposer de les ajouter en ami (24 h), prévention des abus (captcha Cloudflare Turnstile), et monétisation par publicités (Google AdMob) sur l'application mobile, personnalisation d'identité Signature (couleur, cadre, emojis extra, photo), carnet personnel privé.",
    },
    {
      heading: "Hébergement et sous-traitants",
      body: "Les données sont hébergées via Supabase (base de données, authentification, temps réel). Supabase Storage héberge la photo de profil Signature. Cloudflare Turnstile protège les formulaires sensibles. Google AdMob affiche des publicités sur l'app mobile native. RevenueCat relaie l'état des achats in-app (Sans pub et Signature) afin de les associer au compte (RevenueCat n'encaisse pas les paiements). Les polices Inter sont chargées depuis Google Fonts.",
    },
    {
      heading: "Publicité (AdMob)",
      body: "Sur l'application mobile, des bannières publicitaires peuvent s'afficher en dehors des manches de jeu. Google peut utiliser un identifiant publicitaire selon votre consentement (formulaire UMP en UE). Vous pouvez refuser la personnalisation via le bandeau de consentement.",
    },
    {
      heading: "Achat Sans pub",
      body: "L'option Sans pub à vie (2,99 € TTC) est un achat in-app. Le paiement est encaissé par Google Play ou l'App Store (Apple), pas par HAVEFUNCORP. RevenueCat transmet l'état de l'achat pour l'associer au compte REVEAL (pas à l'appareil). Les invités ne peuvent pas acheter. L'achat se restaure après réinstallation ou changement de téléphone, en se connectant au même compte.",
    },
    {
      heading: "Achat Signature",
      body: "L'option Signature à vie (6,99 € TTC) est un achat in-app. Elle inclut Sans pub. Si vous avez déjà Sans pub, l'upgrade coûte 4,00 € TTC. Le paiement est encaissé par Google Play ou l'App Store (Apple), pas par HAVEFUNCORP. RevenueCat transmet l'état de l'achat pour l'associer au compte REVEAL (pas à l'appareil). Les invités et le web ne peuvent pas acheter. L'achat se restaure après réinstallation ou changement de téléphone, en se connectant au même compte. Signature débloque la personnalisation d'identité (couleur, cadre, emojis extra, photo de profil) et un carnet personnel privé (pas un historique de salons : pas de code lobby, pas de rejoin).",
    },
    {
      heading: "Conservation",
      body: `Les données de session et de lobby sont conservées le temps de la soirée et liées à votre compte Supabase. Les invitations de soirée sont éphémères : elles disparaissent à la fermeture du lobby, au refus ou à l'acceptation. Les joueurs récemment croisés en salon sont oubliés 24 h après la fin du lobby commun. Le carnet Signature (soirées et stats) est lié au compte tant qu'il n'est pas supprimé. La photo de profil Signature est conservée tant que vous la gardez ou jusqu'à la suppression du compte. Vous pouvez supprimer votre compte enregistré à tout moment depuis l'application (Menu → Aide & légal → Supprimer mon compte) : la suppression est immédiate. Si vous n'avez plus l'application, utilisez la page de suppression de compte (${ACCOUNT_DELETION_PUBLIC_URL}) ou écrivez à ${CONTACT_EMAIL} (traité sous 30 jours ouvrés).`,
    },
    {
      heading: "Suppression de compte",
      body: `Les comptes enregistrés (e-mail) peuvent être supprimés à tout moment depuis l'application : Menu → Aide & légal → Supprimer mon compte. La suppression est immédiate et définitive. Nous effaçons le compte Supabase Auth, le profil (pseudo, emoji), photo de profil et fichier Storage associé, préférences d'identité Signature (couleur, cadre), et le carnet (soirées archivées), les demandes d'amitié et amitiés associées (suppression en cascade), les invitations de soirée associées (suppression en cascade), les joueurs récemment croisés associés (suppression en cascade), et les données de jeu associées. Si vous n'avez plus l'application, utilisez la page publique de suppression de compte (${ACCOUNT_DELETION_PUBLIC_URL}) ou écrivez à ${CONTACT_EMAIL} (demande traitée sous 30 jours ouvrés). Le mode invité ne crée pas de compte permanent : les données de session expirent automatiquement.`,
    },
    {
      heading: "Vos droits (RGPD)",
      body: `Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation et d'opposition. Pour exercer vos droits : consultez la page de suppression de compte (${ACCOUNT_DELETION_PUBLIC_URL}) ou contactez l'éditeur à ${CONTACT_EMAIL}.`,
    },
    {
      heading: "Contact et retours",
      body: `Bug, idée d'amélioration ou question sur l'application : ${CONTACT_EMAIL}. Vous pouvez aussi nous écrire en message privé sur Instagram @${INSTAGRAM_HANDLE} (${INSTAGRAM_PROFILE_URL}).`,
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
