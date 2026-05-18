import { navigate, goBack } from "../core/router.js";
import { goToLobby } from "../core/lobby.js";

export function bindNav(root, handlers = {}) {
  root.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const target = el.getAttribute("data-nav");
      if (target === "back") {
        goBack();
        return;
      }
      if (handlers[target]) {
        handlers[target]();
        return;
      }
      if (target === "home") {
        navigate("home", { reset: true });
        return;
      }
      if (target === "lobby") {
        goToLobby();
        return;
      }
      if (target === "guesslie") {
        navigate("guesslie-menu");
        return;
      }
      navigate(target);
    });
  });
}
