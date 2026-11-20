/**
 * Lance une nouvelle manche côté hôte. Si l'envoi échoue, le téléphone de l'hôte
 * revient à la manche d'avant (celle affichée chez les invités) et l'erreur remonte.
 * Sans ça, la nouvelle manche restait enregistrée chez l'hôte (sync « enregistre
 * puis envoie ») et il la lançait seul au prochain événement.
 *
 * @param {{ previous: object, send: () => Promise<unknown>, restore: (previous: object) => void }} opts
 */
export async function startRoundWithRollback({ previous, send, restore }) {
  try {
    return await send();
  } catch (err) {
    restore(previous);
    throw err;
  }
}
