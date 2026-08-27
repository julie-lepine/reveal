/**
 * FEATURE-FRIENDS-02 Palier 9 — docs prod + client web Pages (pas le 1.0.0 App Store).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("FEATURE-FRIENDS-02 Palier 9 — docs / Pages", () => {
  it("FRIENDS.md palier 9 coché ; Phase 2 close sauf stores", () => {
    const friends = read("docs/FRIENDS.md");
    assert.match(friends, /Palier 9 validé/);
    assert.match(friends, /FEATURE-FRIENDS-02 Phase 2 close/);
    assert.match(friends, /julie-lepine\.github\.io\/reveal/);
    assert.match(friends, /pas.*1\.0\.0 App Store/);
    assert.match(friends, /Ne pas.*relancer le runbook/);
    assert.doesNotMatch(friends, /\*\*Prochain : palier 9\.\*\*/);
  });

  it("DEPLOYMENTS_SQL §14 : Pages, pas wrappers-only", () => {
    const dep = read("docs/DEPLOYMENTS_SQL.md");
    assert.match(dep, /## 14\. FEATURE-FRIENDS-02/);
    assert.match(dep, /Palier 9 — web Pages/);
    assert.match(dep, /pas le build App Store 1\.0\.0 en review/);
    assert.doesNotMatch(dep, /Phase 2 palier 2 — wrappers, pas d’UI/);
    assert.match(dep, /ne pas relancer/);
  });

  it("SUPABASE.md : Realtime lobby_invites + SQL friends 01/02", () => {
    const supabase = read("docs/SUPABASE.md");
    assert.match(supabase, /lobby_invites.*FEATURE-FRIENDS-02/);
    assert.match(supabase, /feature-friends-02\.sql/);
    assert.match(supabase, /feature-friends-01\.sql/);
    assert.match(supabase, /invitation d.ami \(FEATURE-FRIENDS-02\)/);
    assert.match(supabase, /pas `friend_request_cooldowns`/);
  });

  it("LAUNCH.md : invitations live web, pas le 1.0.0 en review", () => {
    const launch = read("docs/LAUNCH.md");
    assert.match(launch, /Amis \/ invitations de soirée/);
    assert.match(launch, /julie-lepine\.github\.io\/reveal/);
    assert.match(launch, /pas.*le 1\.0\.0 App Store en review/);
  });
});
