/**
 * Mapping erreurs métier sondages (sans dépendance Supabase — testable Node).
 */

/** Extrait le code métier depuis error.message / details PostgREST. */
export function extractLobbyPollErrorCode(error) {
  const raw = [
    error?.message,
    error?.details,
    error?.hint,
    typeof error === "string" ? error : "",
  ]
    .filter(Boolean)
    .join(" ");
  const codes = [
    "poll_already_open",
    "poll_creation_not_allowed_in_current_phase",
    "poll_not_open",
    "poll_vote_game_id_not_in_options",
    "poll_not_found",
    "poll_options_invalid",
    "poll_options_too_few",
    "poll_options_too_many",
    "poll_options_too_large",
    "poll_options_invalid_keys",
    "poll_options_invalid_types",
    "poll_options_empty_field",
    "poll_options_field_too_long",
    "poll_options_invalid_game_id",
    "poll_options_duplicate_game_id",
    "poll_options_game_id_not_allowed",
    "poll_vote_invalid_game_id",
    "poll_close_invalid_reason",
  ];
  for (const code of codes) {
    if (raw.includes(code)) return code;
  }
  if (/pas membre|not.*member|Tu n'es pas membre/i.test(raw)) {
    return "not_lobby_member";
  }
  if (/Clôture réservée|hôte ou à l'acting|acting host/i.test(raw)) {
    return "not_host_or_acting";
  }
  if (/Authentification requise/i.test(raw)) {
    return "auth_required";
  }
  return null;
}

export function lobbyPollErrorMessage(error) {
  const code = extractLobbyPollErrorCode(error);
  switch (code) {
    case "poll_already_open":
      return "Un sondage est déjà en cours dans ce lobby.";
    case "poll_creation_not_allowed_in_current_phase":
      return "Impossible de créer un sondage pour le moment (partie ou préparation en cours).";
    case "poll_not_open":
      return "Ce sondage est fermé.";
    case "poll_vote_game_id_not_in_options":
      return "Ce jeu ne fait pas partie du sondage.";
    case "poll_not_found":
      return "Sondage introuvable.";
    case "poll_options_too_few":
      return "Choisis au moins 2 jeux.";
    case "poll_options_too_many":
    case "poll_options_too_large":
      return "Trop d'options pour le sondage.";
    case "poll_options_game_id_not_allowed":
    case "poll_options_invalid_game_id":
      return "Un jeu sélectionné n'est pas autorisé.";
    case "poll_options_duplicate_game_id":
      return "Jeux en double dans le sondage.";
    case "not_lobby_member":
      return "Tu n'es plus membre de ce lobby.";
    case "not_host_or_acting":
      return "Seul l'hôte (ou le remplaçant) peut fermer le sondage.";
    case "auth_required":
      return "Connexion requise.";
    default:
      return null;
  }
}

export function formatLobbyPollRpcError(error) {
  return (
    lobbyPollErrorMessage(error) ||
    error?.message ||
    "Action sondage impossible. Réessaie."
  );
}
