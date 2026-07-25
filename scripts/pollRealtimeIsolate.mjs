/**
 * Lance les probes Realtime A/B/C hors navigateur.
 * Usage: node scripts/pollRealtimeIsolate.mjs [lobbyUuid]
 *
 * Sans UUID : Test C utilise un UUID placeholder (filtre seul).
 * Avec session anonyme : proche du client invité.
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Charger la config app (même URL/clé que le client)
const configUrl = pathToFileURL(join(root, "js/config/supabase.js")).href;
const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import(configUrl);

const diagnoseUrl = pathToFileURL(
  join(root, "js/core/lobbyPollRealtimeDiagnose.js")
).href;
const { runPollRealtimeIsolationProbes, inspectLobbyIdForRealtimeFilter } =
  await import(diagnoseUrl);

const lobbyId =
  process.argv[2] || "00000000-0000-4000-8000-000000000001";

console.log("=== POLL Realtime isolate ===");
console.log("url", SUPABASE_URL);
console.log("lobbyId inspect", inspectLobbyIdForRealtimeFilter(lobbyId));

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: anonData, error: anonErr } = await supabase.auth.signInAnonymously();
console.log("anon auth", {
  ok: !anonErr,
  userId: anonData?.user?.id ?? null,
  error: anonErr?.message ?? null,
});

const results = await runPollRealtimeIsolationProbes(supabase, lobbyId);
console.log("=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));

await supabase.auth.signOut();
process.exit(
  results.A?.status === "SUBSCRIBED" ||
    results.B?.status === "SUBSCRIBED" ||
    results.C?.status === "SUBSCRIBED"
    ? 0
    : 2
);
