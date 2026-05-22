import { FIL_ROUGE_TILE } from "../../data/filRouge.js";
import {
  getLocalFilRougeMission,
  setFilRougeMissionAck,
} from "../core/filRougeSession.js";
import { requireLobbyPlay } from "../core/gameGuard.js";
import { getSupabaseUserId } from "../core/supabaseAuth.js";
import { ackMyFilRougeMission } from "../core/filRougePrivate.js";
import { escapeHtml, pageShell } from "../core/ui.js";
import { bindNav } from "./nav.js";
import { navigate } from "../core/router.js";
import { getFilRougeSession } from "../core/filRougeSession.js";
import { userIdForName } from "../core/gameSync.js";
import { getLocalDisplayName } from "../core/state.js";

export function mountFilRougeMission(app) {
  if (!requireLobbyPlay()) return null;

  async function render() {
    const session = getFilRougeSession();
    if (session.status === "setup") {
      navigate("filrouge-setup", { navStack: ["home", "lobby", "game-select", "filrouge-setup"] });
      return;
    }
    if (session.status === "idle") {
      navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
      return;
    }

    const mission = await getLocalFilRougeMission();
    if (!mission) {
      app.innerHTML = pageShell({
        backTarget: "game-select",
        content: `<p class="hint">Mission en cours de préparation…</p>`,
      });
      bindNav(app);
      return;
    }

    const uid = getSupabaseUserId() || userIdForName(getLocalDisplayName());
    const acked = session.missionAcks?.[uid];
    if (acked) {
      navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
      return;
    }

    app.innerHTML = pageShell({
      backTarget: "game-select",
      content: `
        <p class="label-upper label-upper--muted">${FIL_ROUGE_TILE.emoji} Mission secrète</p>
        <div class="card card--fil-rouge-mission">
          <p class="fil-rouge-mission__label">Fais dire :</p>
          <p class="fil-rouge-mission__word">« ${escapeHtml(mission.word)} »</p>
          <p class="fil-rouge-mission__label">à</p>
          <p class="fil-rouge-mission__target">${escapeHtml(mission.targetName)}</p>
        </div>
        <p class="hint fil-rouge-mission__secret">Ne révèle ton mot à personne.</p>
        <button type="button" class="btn btn-primary btn--spaced" id="fil-rouge-ack">Mission reçue</button>
        <button type="button" class="btn btn-accent" data-nav="game-select">Retour aux jeux</button>
      `,
    });

    bindNav(app);

    app.querySelector("#fil-rouge-ack")?.addEventListener("click", async () => {
      if (uid) {
        await ackMyFilRougeMission();
        setFilRougeMissionAck(uid);
      }
      navigate("game-select", { navStack: ["home", "lobby", "game-select"] });
    });
  }

  render();

  return () => {};
}
