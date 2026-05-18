import { canPlay } from "./auth.js";
import { hasActiveLobby } from "./lobby.js";
import { navigate } from "./router.js";

export function requireLobbyPlay() {
  if (!canPlay()) {
    navigate("home", { reset: true });
    return false;
  }
  if (!hasActiveLobby()) {
    navigate("home", { reset: true });
    return false;
  }
  return true;
}
