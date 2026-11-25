/**
 * Audit carnet et cosmétiques n°3 — quitter depuis l'Accueil quand l'archive carnet échoue.
 * Avant : départ refusé tant que l'archive échouait, sans autre choix.
 * Après : le joueur peut réessayer plus tard ou partir sans enregistrer la soirée.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serverLeaveArchiveFailedConfirm } from "../js/core/lobbyServerLeave.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("serverLeaveArchiveFailedConfirm", () => {
  it("libellés membre et hôte", () => {
    const member = serverLeaveArchiveFailedConfirm("member");
    assert.equal(member.confirmLabel, "Quitter sans enregistrer");
    assert.equal(member.cancelLabel, "Réessayer plus tard");
    assert.match(member.message, /quitter maintenant sans l'enregistrer/);

    const host = serverLeaveArchiveFailedConfirm("host");
    assert.equal(host.confirmLabel, "Fermer sans enregistrer");
    assert.match(host.message, /fermer maintenant sans l'enregistrer/);
  });
});

describe("leaveLobbyMembershipFromServer : skipArchive", () => {
  const lobby = read("js/core/lobby.js");
  const fn = lobby.slice(
    lobby.indexOf("export async function leaveLobbyMembershipFromServer"),
    lobby.indexOf("export async function transferLobbyHost")
  );

  it("l'option saute l'archive, sinon l'archive reste obligatoire avant le départ", () => {
    assert.match(fn, /\(membership, \{ skipArchive = false \} = \{\}\)/);
    assert.match(fn, /if \(!hasActiveLobby\(\) && !skipArchive\) \{/);
    assert.ok(fn.indexOf("archiveSignatureEveningForServerLeave") < fn.indexOf("runServerOnlyLeave"));
  });
});

describe("Accueil : choix après un échec d'archive", () => {
  const home = read("js/screens/home.js");
  const start = home.indexOf('e.target.closest("#btn-leave-lobby-server")');
  const block = home.slice(start, home.indexOf('e.target.closest("#btn-leave-lobby")', start));

  it("demande avant de partir sans enregistrer, et ne relance qu'avec skipArchive", () => {
    assert.match(block, /if \(!archiveErr\?\.archiveFailed\) throw archiveErr;/);
    assert.match(block, /serverLeaveArchiveFailedConfirm\(membership\.role\)/);
    const confirmIdx = block.indexOf("const skip = await showAppConfirm(archiveCfg.message");
    const retryIdx = block.indexOf("leaveLobbyMembershipFromServer(leaveInput, { skipArchive: true })");
    assert.ok(confirmIdx > 0 && retryIdx > confirmIdx);
    assert.match(block, /if \(!skip\) \{\s+scheduleRender\(true\);\s+return;\s+\}/);
  });

  it("le flag en cours est toujours relâché (finally)", () => {
    assert.match(block, /finally \{\s+serverLeaveInFlight = false;/);
  });
});
